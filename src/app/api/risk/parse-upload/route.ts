/* /api/risk/parse-upload — free flexible Excel parser.
 *
 * Handles the MOH Borang Risiko layout where:
 *   - Headers span TWO rows (parent label in row 1, sub-label in row 2)
 *   - Parent labels are merged across multiple columns (only the leftmost
 *     cell holds the value; SheetJS returns empty for the others)
 *   - Headers are in Malay (with some English mixed in)
 *
 * Approach:
 *   1. Read every sheet with SheetJS.
 *   2. For each candidate row, propagate non-empty values rightward (treats
 *      empty cells as merged continuations of the most recent label).
 *   3. Try single-row matching, then row+next combined matching. Pick the
 *      candidate that maps the most distinct fields.
 *   4. Walk data rows; for fields mapped to multiple columns, concat text
 *      values (a row with one column blank and the other filled still works).
 *
 * No external API, no API key. */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

interface RiskDraft {
  description: string
  cause: string
  impact: string
  context: string
  risk_nature: string
  treatment_option: string
  scope: string
  existing_controls: string
  additional_controls: string
  action_owner_dept_names: string[]
  implementation_period: string
  likelihood: number | null
  severity: number | null
  residual_likelihood: number | null
  residual_severity: number | null
  _source_note?: string
}

type FieldKey =
  | 'description' | 'cause' | 'impact'
  | 'context' | 'risk_nature' | 'treatment_option' | 'scope'
  | 'existing_controls' | 'additional_controls'
  | 'action_owner' | 'implementation_period'
  | 'likelihood' | 'severity'
  | 'residual_likelihood' | 'residual_severity'
  | 'dept'

/* Pattern order matters: the FIRST match wins for any given header string. So
 * the more specific patterns (per-dimension scoring) must come BEFORE the
 * general "impact" pattern, otherwise "Penilaian Impak (a) Manusia" would
 * match `impact` instead of `impact_manusia`. */
const HEADER_PATTERNS: { field: FieldKey; patterns: string[] }[] = [
  // Residual scoring (must come before base likelihood/severity so
  // "Risiko Baki - Kebarangkalian" maps to residual, not the current score).
  { field: 'residual_likelihood', patterns: [
    'risiko baki kebarangkalian', 'baki kebarangkalian',
    'residual likelihood', 'residual probability',
  ] },
  { field: 'residual_severity', patterns: [
    'risiko baki keterukan', 'baki keterukan', 'baki impak',
    'residual severity', 'residual impact',
  ] },

  // Current scoring
  { field: 'severity', patterns: ['severity', 'keterukan', 'tahap keterukan'] },
  { field: 'likelihood', patterns: ['likelihood', 'kebarangkalian', 'probability'] },

  // Risk text fields
  { field: 'description', patterns: [
    'risk description', 'description of risk', 'risk statement',
    'huraian risiko', 'penerangan risiko',
    'keterangan risiko', 'keterangan',
    'apakah risiko', 'risiko yang berlaku',
    'description',
  ] },
  { field: 'cause', patterns: ['punca', 'sebab', 'penyebab', 'root cause', 'cause'] },
  { field: 'impact', patterns: [
    'konsekuen', 'consequence', 'impak risiko', 'risk impact', 'impak', 'impact', 'kesan',
  ] },

  { field: 'context', patterns: ['konteks', 'context'] },
  { field: 'risk_nature', patterns: [
    'jenis risiko', 'sifat risiko', 'nature of risk', 'risk nature',
    'actual/potential', 'sebenar/berpotensi',
  ] },
  { field: 'treatment_option', patterns: [
    'pilihan rawatan', 'treatment option', 'opsyen rawatan', 'risk treatment',
  ] },
  { field: 'scope', patterns: [
    'risiko institusi atau unit', 'institusi atau unit',
    'risiko institusi', 'risiko unit',
    'scope', 'skop',
  ] },

  { field: 'existing_controls', patterns: [
    'kawalan sedia ada', 'existing control', 'current control', 'control in place',
  ] },
  { field: 'additional_controls', patterns: [
    'kawalan tambahan yang dicadangkan', 'kawalan tambahan',
    'additional control', 'proposed control', 'new control', 'treatment',
  ] },
  { field: 'action_owner', patterns: [
    'pemunya tindakan', 'action owner', 'tindakan oleh',
    'pemilik tindakan', 'risk owner', 'responsible',
  ] },
  { field: 'implementation_period', patterns: [
    'tempoh pelaksanaan', 'implementation period',
    'due date', 'deadline', 'target date',
    'tempoh', 'period',
  ] },
  { field: 'dept', patterns: ['department', 'jabatan'] },
]

const NATURE_KEYWORDS: { code: string; words: string[] }[] = [
  { code: 'ACTUAL',    words: ['actual', 'sebenar', 'sedia ada', 'existing'] },
  { code: 'POTENTIAL', words: ['potential', 'berpotensi', 'potensi', 'jangkaan'] },
]

const TREATMENT_KEYWORDS: { code: string; words: string[] }[] = [
  { code: 'AVOID',    words: ['avoid', 'elak', 'hindar'] },
  { code: 'TRANSFER', words: ['transfer', 'pindah', 'alih'] },
  { code: 'CONTROL',  words: ['control', 'kawal', 'mitigate', 'kurang'] },
  { code: 'ACCEPT',   words: ['accept', 'terima'] },
]

const SCOPE_KEYWORDS: { code: string; words: string[] }[] = [
  { code: 'INSTITUSI', words: ['institusi', 'institutional', 'hospital-wide', 'hospital wide', 'institution', 'enterprise'] },
  { code: 'UNIT',      words: ['unit', 'department', 'jabatan', 'local', 'dept'] },
]

function normHeader(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[()*\-_:.\/]/g, ' ').trim()
}

/* Headers that look like derived / log columns rather than data inputs — these
 * should NOT be mapped to any field. Catching them up front avoids spurious
 * matches like "8. Tahap Impak Risiko (Automatik)" hitting the general
 * `impact` pattern. */
const NEGATIVE_PATTERNS = [
  'tahap risiko', 'tahap impak',
  'automatik', 'purata',
  'tarikh dikemaskini', 'kemaskini pertama', 'kemaskini kedua',
  'status kawalan risiko', 'perubahan tahap risiko',
  'klasifikasi punca', 'klasifikasi kawalan',
  'pemilik isu',          // sub-unit identifier in MOH Borang, not action owner
  'tarikh didaftarkan',
  'catatan',
]

function matchField(rawHeader: string): FieldKey | null {
  const h = normHeader(rawHeader)
  if (!h) return null
  // Skip derived / log / metadata columns before considering positive patterns.
  for (const neg of NEGATIVE_PATTERNS) {
    if (h.includes(neg)) return null
  }
  for (const { field, patterns } of HEADER_PATTERNS) {
    for (const p of patterns) {
      if (h.includes(p)) return field
    }
  }
  return null
}

function parseScore(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.round(v)
    return n >= 1 && n <= 5 ? n : null
  }
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/[1-5]/)
  if (!m) return null
  return parseInt(m[0], 10)
}

function pickNature(v: unknown): string {
  if (!v) return ''
  const s = String(v).toLowerCase()
  for (const c of ['ACTUAL', 'POTENTIAL']) {
    if (s === c.toLowerCase()) return c
  }
  for (const { code, words } of NATURE_KEYWORDS) {
    if (words.some((w) => s.includes(w))) return code
  }
  return ''
}

function pickTreatment(v: unknown): string {
  if (!v) return ''
  const s = String(v).toLowerCase()
  for (const c of ['AVOID', 'TRANSFER', 'CONTROL', 'ACCEPT']) {
    if (s === c.toLowerCase()) return c
  }
  for (const { code, words } of TREATMENT_KEYWORDS) {
    if (words.some((w) => s.includes(w))) return code
  }
  return ''
}

function pickScope(v: unknown): string {
  if (!v) return ''
  const s = String(v).toLowerCase()
  for (const c of ['INSTITUSI', 'UNIT']) {
    if (s === c.toLowerCase()) return c
  }
  for (const { code, words } of SCOPE_KEYWORDS) {
    if (words.some((w) => s.includes(w))) return code
  }
  return ''
}

/* Treat empty cells as merged continuations of the previous non-empty cell.
 * This recovers the merged "parent" header label that SheetJS leaves as ""
 * in every cell except the leftmost of the merge. */
function propagateMerged(row: unknown[]): string[] {
  let last = ''
  return row.map((c) => {
    const s = String(c ?? '').trim()
    if (s) { last = s; return s }
    return last
  })
}

/* Combine two header rows into one — the parent label plus the sub-label. */
function combineHeaders(parent: string[], child: string[]): string[] {
  const n = Math.max(parent.length, child.length)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const p = parent[i] ?? ''
    const c = child[i] ?? ''
    out.push((p + ' ' + c).trim())
  }
  return out
}

function buildHeaderMap(headerCells: string[]): { map: Record<number, FieldKey>; fields: Set<FieldKey> } {
  const map: Record<number, FieldKey> = {}
  const fields = new Set<FieldKey>()
  headerCells.forEach((cell, col) => {
    const f = matchField(cell)
    if (f && !(col in map)) {
      map[col] = f
      fields.add(f)
    }
  })
  return { map, fields }
}

function passesHeaderTest(fields: Set<FieldKey>): boolean {
  // Require at least 3 distinct fields, and at least one of the primary risk
  // text fields so we don't mistake a stray block of metadata for a header.
  return fields.size >= 3 && (
    fields.has('description') || fields.has('cause') || fields.has('impact') ||
    fields.has('likelihood') || fields.has('severity') || fields.has('context')
  )
}

interface DetectedHeader {
  headerIdx: number
  headerMap: Record<number, FieldKey>
  fields: Set<FieldKey>
  spansRows: number
}

function detectHeader(rows: unknown[][]): DetectedHeader | null {
  const maxLook = Math.min(rows.length, 20)
  let best: DetectedHeader | null = null

  for (let i = 0; i < maxLook; i++) {
    const r1 = propagateMerged(rows[i] ?? [])
    // Try single-row header
    const { map: m1, fields: f1 } = buildHeaderMap(r1)
    if (passesHeaderTest(f1) && (!best || f1.size > best.fields.size)) {
      best = { headerIdx: i, headerMap: m1, fields: f1, spansRows: 1 }
    }
    // Try combined two-row header (parent + child). Only the PARENT row gets
    // merged-cell propagation — sub-labels in row 2 are per-column and would
    // otherwise smear across unrelated parent groups.
    if (i + 1 < rows.length) {
      const r2 = (rows[i + 1] ?? []).map((c) => String(c ?? '').trim())
      const combined = combineHeaders(r1, r2)
      const { map: m2, fields: f2 } = buildHeaderMap(combined)
      if (passesHeaderTest(f2) && (!best || f2.size > best.fields.size)) {
        best = { headerIdx: i, headerMap: m2, fields: f2, spansRows: 2 }
      }
    }
  }

  return best
}

function colsForField(map: Record<number, FieldKey>, field: FieldKey): number[] {
  const out: number[] = []
  for (const [colStr, f] of Object.entries(map)) {
    if (f === field) out.push(parseInt(colStr, 10))
  }
  return out
}

function concatColumns(row: unknown[], cols: number[]): string {
  const parts: string[] = []
  for (const c of cols) {
    const v = row[c]
    if (v === '' || v === null || v === undefined) continue
    const s = String(v).trim()
    if (s) parts.push(s)
  }
  // Dedup while preserving order — sometimes the parent and child columns
  // hold the same value.
  const seen = new Set<string>()
  const dedup = parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
  return dedup.join(' · ')
}

function firstColumn(row: unknown[], cols: number[]): unknown {
  for (const c of cols) {
    const v = row[c]
    if (v !== '' && v !== null && v !== undefined) return v
  }
  return undefined
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read upload.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })

  const name = (file.name ?? '').toLowerCase()
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf'
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')

  if (isPdf) {
    return NextResponse.json({
      error: 'PDF parsing is not enabled in this mode. Please upload the register as an Excel file (.xlsx). If you only have a PDF, copy the table into Excel first.',
    }, { status: 400 })
  }
  if (!isXlsx) {
    return NextResponse.json({ error: 'Only Excel (.xlsx) files are supported.' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch (e) {
    return NextResponse.json({
      error: `Could not parse Excel file: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 400 })
  }
  if (!wb.SheetNames.length) {
    return NextResponse.json({ error: 'Workbook is empty.' }, { status: 400 })
  }

  const allRisks: RiskDraft[] = []
  const noteLines: string[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][]
    if (!rows.length) continue

    const detected = detectHeader(rows)
    if (!detected) {
      noteLines.push(`Sheet "${sheetName}": no recognisable header row found, skipped.`)
      continue
    }
    const { headerIdx, headerMap, fields, spansRows } = detected
    noteLines.push(
      `Sheet "${sheetName}": header on row ${headerIdx + 1}` +
      (spansRows === 2 ? ` + ${headerIdx + 2}` : '') +
      `; ${fields.size} fields mapped (${Array.from(fields).join(', ')}).`,
    )

    const dataStart = headerIdx + spansRows
    let extracted = 0

    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r]
      if (row.every((c) => c === '' || c === null || c === undefined)) continue

      const description = concatColumns(row, colsForField(headerMap, 'description'))
      const cause = concatColumns(row, colsForField(headerMap, 'cause'))
      const impact = concatColumns(row, colsForField(headerMap, 'impact'))
      // Need at least one of these to be a real row of data.
      if (!description && !cause && !impact) continue

      const ownerRaw = concatColumns(row, colsForField(headerMap, 'action_owner'))
      const action_owner_dept_names = ownerRaw
        ? ownerRaw.split(/[,;·\n]/).map((s) => s.trim()).filter(Boolean)
        : []

      allRisks.push({
        description,
        cause,
        impact,
        context: concatColumns(row, colsForField(headerMap, 'context')),
        risk_nature: pickNature(firstColumn(row, colsForField(headerMap, 'risk_nature'))),
        treatment_option: pickTreatment(firstColumn(row, colsForField(headerMap, 'treatment_option'))),
        scope: pickScope(firstColumn(row, colsForField(headerMap, 'scope'))),
        existing_controls: concatColumns(row, colsForField(headerMap, 'existing_controls')),
        additional_controls: concatColumns(row, colsForField(headerMap, 'additional_controls')),
        action_owner_dept_names,
        implementation_period: concatColumns(row, colsForField(headerMap, 'implementation_period')),
        likelihood: parseScore(firstColumn(row, colsForField(headerMap, 'likelihood'))),
        severity: parseScore(firstColumn(row, colsForField(headerMap, 'severity'))),
        residual_likelihood: parseScore(firstColumn(row, colsForField(headerMap, 'residual_likelihood'))),
        residual_severity: parseScore(firstColumn(row, colsForField(headerMap, 'residual_severity'))),
      })
      extracted++
    }
    noteLines.push(`Sheet "${sheetName}": extracted ${extracted} risk${extracted === 1 ? '' : 's'}.`)
  }

  if (allRisks.length === 0) {
    return NextResponse.json({
      risks: [],
      general_notes:
        'No risks were extracted. Headers may be unusual; the parser looks for Malay or English terms ' +
        'like "Konteks / Context", "Huraian / Keterangan Risiko", "Punca / Sebab", "Konsekuen / Impak", ' +
        '"Kebarangkalian / Likelihood", "Keterukan / Severity", and "Risiko Baki" for residual scoring. ' +
        noteLines.join(' '),
    })
  }

  return NextResponse.json({
    risks: allRisks,
    general_notes: noteLines.join(' '),
    model: 'free-xlsx-parser-v3',
  })
}
