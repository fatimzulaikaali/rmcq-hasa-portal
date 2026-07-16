'use client'

/* "Import from PDF" for the Risk module — free, fully client-side.
 *
 * Drops onto both the Log Risk form (mode="register", Form 0044) and the RTP
 * editor (mode="rtp", Form 0045). It extracts text with pdf.js, OCR-fallbacks
 * scanned pages with Tesseract, pre-fills what it can via onParsed, and ALWAYS
 * shows the raw extracted text so the Coordinator can copy anything the mapper
 * missed. Nothing is sent to a server. */

import { useRef, useState } from 'react'
import {
  extractPdfText, parseForm0044, parseForm0045,
  type ExtractProgress, type ParsedRegister, type ParsedRtp,
} from '@/lib/risk/pdfImport'

type Props =
  | { mode: 'register'; onParsed: (r: ParsedRegister) => void; disabled?: boolean }
  | { mode: 'rtp'; onParsed: (r: ParsedRtp) => void; disabled?: boolean }

function progressText(p: ExtractProgress): string {
  switch (p.phase) {
    case 'loading': return 'Opening PDF…'
    case 'text':    return `Reading page ${p.page} of ${p.total}…`
    case 'ocr':     return `Scanned page ${p.page} of ${p.total} — running OCR (slower)…`
    case 'done':    return 'Done'
  }
}

export function RiskPdfImport(props: Props) {
  const { mode, disabled } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExtractProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rawText, setRawText] = useState('')
  const [usedOcr, setUsedOcr] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [fileName, setFileName] = useState('')

  async function handleFile(file: File) {
    setBusy(true); setError(null); setRawText(''); setUsedOcr(false); setFileName(file.name)
    try {
      const res = await extractPdfText(file, setProgress)
      setRawText(res.fullText)
      setUsedOcr(res.usedOcr)
      setShowRaw(true)
      if (!res.fullText.trim()) {
        setError('No text could be read from this PDF. If it is a scanned image, the scan may be too faint for OCR — try a clearer scan.')
        return
      }
      if (mode === 'register') props.onParsed(parseForm0044(res.fullText))
      else props.onParsed(parseForm0045(res.fullText))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false); setProgress(null)
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) void handleFile(f)
    e.target.value = '' // allow re-picking the same file
  }

  return (
    <div className="banner blue" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <input ref={inputRef} type="file" accept=".pdf,application/pdf"
        style={{ display: 'none' }} onChange={onPick} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>🤖</span>
        <span style={{ flex: '1 1 240px' }}>
          <strong>Import from PDF</strong> — upload the {mode === 'register' ? 'register (Form 0044)' : 'RTP (Form 0045)'} and
          the portal reads it and pre-fills the fields below for you to check. Typed PDFs work best; scanned pages are read with OCR.
        </span>
        <button type="button" className="btn primary" disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading…' : '⬆ Import from PDF'}
        </button>
      </div>

      {busy && progress && (
        <div style={{ fontSize: 12, color: 'var(--blue)' }}>{progressText(progress)}</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>⚠️ {error}</div>
      )}

      {!busy && rawText && (
        <div style={{ fontSize: 12 }}>
          <div style={{ marginBottom: 4 }}>
            ✅ Read <strong>{fileName}</strong>{usedOcr ? ' (some pages via OCR)' : ''}. Fields below were pre-filled where possible —
            please check them against the paper form.
          </div>
          <button type="button" className="btn" style={{ fontSize: 12, padding: '5px 12px' }}
            onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide extracted text' : 'Show extracted text'}
          </button>
          {showRaw && (
            <textarea readOnly value={rawText}
              style={{
                width: '100%', marginTop: 8, minHeight: 140, fontSize: 12,
                fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.4,
                border: '1px solid #CFE3F7', borderRadius: 8, padding: 10, background: '#fff', color: 'var(--text)',
              }} />
          )}
        </div>
      )}
    </div>
  )
}
