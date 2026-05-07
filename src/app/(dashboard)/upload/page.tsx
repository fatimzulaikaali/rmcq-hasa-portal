'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { AppShell, Topbar } from '@/components/AppShell'
import {
  parseRows,
  type IncidentRow,
  type ParseSummary,
  MAPPED_HEADERS,
  detectHeaderRow,
} from '@/lib/ir/excel-mapper'

type ImportMode = 'skip' | 'replace'

interface ImportResult {
  inserted: number
  skipped: number
  errors: string[]
}

const CHUNK = 200

export default function UploadPage() {
  const supabase = useMemo(() => createClient(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [mode, setMode] = useState<ImportMode>('skip')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    setResult(null)
    setSummary(null)
    setFileName(file.name)
    setParsing(true)
    try {
      const buf = await file.arrayBuffer()
      // Note: NO cellDates — we want date cells to come through as raw Excel
      // serial numbers, which we convert in toIsoDate() via UTC math. This
      // sidesteps every JS Date timezone quirk (the previous source of the
      // intermittent "Dec 2025" bug for Jan-1 dates in non-UTC browsers).
      const wb = XLSX.read(buf, { type: 'array' })
      if (wb.SheetNames.length === 0) throw new Error('Workbook has no sheets')

      // Score each sheet by how many MAPPED_HEADERS appear in its first few rows.
      // Pick the highest-scoring sheet — handles workbooks where the data isn't on sheet 1
      // (e.g. pivot summaries first, raw data on a later tab).
      const known = new Set(MAPPED_HEADERS.map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase()))
      let bestSheet = wb.SheetNames[0]
      let bestScore = -1
      let bestAoa: unknown[][] = []
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        if (!sheet) continue
        const aoaCandidate = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as unknown[][]
        let score = 0
        for (let i = 0; i < Math.min(6, aoaCandidate.length); i++) {
          for (const cell of aoaCandidate[i] ?? []) {
            if (typeof cell !== 'string') continue
            const k = cell.replace(/\s+/g, ' ').trim().toLowerCase()
            if (k && known.has(k)) score++
          }
        }
        if (score > bestScore) {
          bestScore = score
          bestSheet = name
          bestAoa = aoaCandidate
        }
      }

      const ws = wb.Sheets[bestSheet]
      const aoa = bestAoa
      const headerIdx = detectHeaderRow(aoa)
      const headerRow = (aoa[headerIdx] ?? []) as string[]

      if (bestScore <= 0) {
        throw new Error(
          `No sheet matched the expected IR headers. Sheets in this workbook: ${wb.SheetNames.join(', ')}.`
        )
      }

      // Re-parse rows starting from the detected header row, on the chosen sheet.
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: null,
        raw: true,
        range: headerIdx,
      })
      const s = parseRows(rawRows, headerRow.map(String))
      setSummary(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setParsing(false)
    }
  }

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) await handleFile(file)
  }, [])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  async function importNow() {
    if (!summary || summary.validRows.length === 0) return
    setError(null)
    setResult(null)
    setImporting(true)
    setProgress({ done: 0, total: summary.validRows.length })

    try {
      let inserted = 0
      let skipped = 0
      const errors: string[] = []

      if (mode === 'replace') {
        const ids = summary.validRows.map((r) => r.incident_id!).filter(Boolean)
        // delete in chunks (Supabase IN list size is fine for thousands but we batch to be safe)
        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500)
          const { error: delErr } = await supabase.from('incidents').delete().in('incident_id', slice)
          if (delErr) throw new Error(`Delete failed: ${delErr.message}`)
        }
      }

      for (let i = 0; i < summary.validRows.length; i += CHUNK) {
        const chunk = summary.validRows.slice(i, i + CHUNK)
        const { data, error: insErr } = await supabase
          .from('incidents')
          .upsert(chunk as IncidentRow[], {
            onConflict: 'incident_id',
            ignoreDuplicates: mode === 'skip',
          })
          .select('incident_id')

        if (insErr) {
          errors.push(`Rows ${i + 1}-${i + chunk.length}: ${insErr.message}`)
        } else {
          // In skip mode, only newly-inserted rows are returned.
          // In replace mode, all upserted rows are returned.
          const c = data?.length ?? 0
          inserted += c
          if (mode === 'skip') skipped += chunk.length - c
        }
        setProgress({ done: Math.min(i + chunk.length, summary.validRows.length), total: summary.validRows.length })
      }

      setResult({ inserted, skipped, errors })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setFileName(null)
    setSummary(null)
    setResult(null)
    setError(null)
    setProgress({ done: 0, total: 0 })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <AppShell>
      <Topbar title="Upload IR Database" meta="Bulk import incidents from Excel" />
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Upload IR Database</h1>
        <p className="mt-1 text-sm text-gray-600">
          Drop the latest <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">.xlsx</code> export here.
          Each row is mapped to an incident; rows with the same Incident ID are skipped or replaced based on your chosen mode.
        </p>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
      >
        <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1.5A4.5 4.5 0 0117 16h-1m-4-4v8m0 0l-3-3m3 3l3-3" />
        </svg>
        <p className="text-sm font-medium text-gray-700">
          {fileName ? fileName : 'Drag & drop the IR xlsx, or click to browse'}
        </p>
        <p className="text-xs text-gray-500">.xlsx files only · everything stays in your browser until you press Import</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onPick}
        />
      </div>

      {parsing && <p className="text-sm text-gray-600">Parsing…</p>}

      {summary && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Rows in file" value={summary.totalRows} />
            <Stat label="Valid (will import)" value={summary.validRows.length} tone="ok" />
            <Stat label="Skipped at parse" value={summary.errors.length} tone={summary.errors.length ? 'warn' : 'mute'} />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700">Headers matched</p>
            <p className="mt-1 text-xs text-gray-600">
              {summary.matchedHeaders.length} of {MAPPED_HEADERS.length} mapped headers found.
              {summary.unknownHeaders.length > 0 && (
                <>
                  {' '}Ignored extra columns:{' '}
                  <span className="text-gray-500">{summary.unknownHeaders.join(', ')}</span>
                </>
              )}
            </p>
          </div>

          {summary.validRows[0] && (
            <details className="rounded border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-gray-700">Preview first row (mapped)</summary>
              <pre className="mt-2 overflow-x-auto text-xs text-gray-700">
                {JSON.stringify(summary.validRows[0], null, 2)}
              </pre>
            </details>
          )}

          {summary.errors.length > 0 && (
            <details className="rounded border border-amber-200 bg-amber-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-amber-800">{summary.errors.length} row issue(s)</summary>
              <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
                {summary.errors.slice(0, 20).map((er, i) => (
                  <li key={i}>Row {er.row}: {er.reason}</li>
                ))}
                {summary.errors.length > 20 && <li>… and {summary.errors.length - 20} more</li>}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-4">
            <fieldset className="flex items-center gap-4">
              <legend className="sr-only">Import mode</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value="skip"
                  checked={mode === 'skip'}
                  onChange={() => setMode('skip')}
                />
                Skip duplicates (insert new only)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                Replace existing (delete then insert)
              </label>
            </fieldset>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={reset}
                disabled={importing}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Reset
              </button>
              <button
                onClick={importNow}
                disabled={importing || summary.validRows.length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? `Importing… ${progress.done}/${progress.total}` : `Import ${summary.validRows.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">Import finished.</p>
          <ul className="mt-1 list-inside list-disc">
            <li>{result.inserted} row(s) inserted{mode === 'replace' ? ' (existing replaced)' : ''}</li>
            {mode === 'skip' && <li>{result.skipped} duplicate(s) skipped</li>}
            {result.errors.length > 0 && (
              <li className="text-red-700">
                {result.errors.length} batch error(s):
                <ul className="mt-1 list-inside list-disc pl-4">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}
        </div>
      </main>
    </AppShell>
  )
}

function Stat({ label, value, tone = 'mute' }: { label: string; value: number; tone?: 'ok' | 'warn' | 'mute' }) {
  const toneClass =
    tone === 'ok' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-700'
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-center">
      <div className={`text-2xl font-semibold ${toneClass}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}
