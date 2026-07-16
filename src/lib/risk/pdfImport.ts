/* Free, client-side PDF import for the Risk module.
 *
 * Two-stage, zero-cost pipeline (no paid API, nothing leaves the browser):
 *   1. pdf.js (pdfjs-dist)  — pulls the real text layer out of *typed* PDFs.
 *   2. Tesseract.js OCR     — fallback for *scanned / photographed* pages that
 *                             have no text layer. Each such page is rendered to
 *                             a canvas and OCR'd (English + Malay).
 *
 * Everything is dynamically imported so these heavy libraries never touch the
 * server bundle or SSR — they only load in the browser when the Coordinator
 * actually clicks "Import from PDF".
 *
 * The text extraction is reliable. The field mapping (parseForm0044 /
 * parseForm0045) is best-effort label matching and is meant to be *reviewed*
 * by the Coordinator — the raw extracted text is always kept so nothing is
 * silently lost. Tune the label lists below once we have a real sample form. */

import type { RiskNature, TreatmentOption, RtpAdequacy, RtpTaskStatus } from './types'

/* Path to the pdf.js worker we copied into /public. Must match the installed
 * pdfjs-dist version (see package.json). */
const PDF_WORKER_SRC = '/pdf.worker.min.mjs'

/* A page whose extracted text layer is shorter than this is treated as an
 * image-only (scanned) page and sent to OCR. */
const TEXT_LAYER_MIN_CHARS = 24

export interface ExtractProgress {
  phase: 'loading' | 'text' | 'ocr' | 'done'
  page: number
  total: number
}

export interface ExtractResult {
  fullText: string
  pages: string[]
  usedOcr: boolean
  pageCount: number
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

/** Extract text from every page of a PDF, OCR'ing any image-only pages. */
export async function extractPdfText(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC

  const buf = await file.arrayBuffer()
  onProgress?.({ phase: 'loading', page: 0, total: 0 })

  const doc = await pdfjs.getDocument({ data: buf }).promise
  const total = doc.numPages
  const pages: string[] = []
  let usedOcr = false

  // Lazily-created OCR worker so typed PDFs never pay the OCR download cost.
  let ocrWorker: Awaited<ReturnType<typeof createOcrWorker>> | null = null

  try {
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i)

      onProgress?.({ phase: 'text', page: i, total })
      const tc = await page.getTextContent()
      let text = tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim()

      // No usable text layer -> scanned page -> OCR.
      if (text.length < TEXT_LAYER_MIN_CHARS) {
        onProgress?.({ phase: 'ocr', page: i, total })
        const canvas = await renderPageToCanvas(page)
        if (canvas) {
          if (!ocrWorker) ocrWorker = await createOcrWorker()
          const { data } = await ocrWorker.recognize(canvas)
          text = (data.text || '').replace(/[ \t]+/g, ' ').trim()
          usedOcr = true
        }
      }

      pages.push(text)
    }
  } finally {
    if (ocrWorker) await ocrWorker.terminate()
    await doc.destroy()
  }

  onProgress?.({ phase: 'done', page: total, total })
  return { fullText: pages.join('\n\n'), pages, usedOcr, pageCount: total }
}

async function createOcrWorker() {
  const { createWorker } = await import('tesseract.js')
  // English + Malay — the forms are bilingual. Language data is fetched from
  // the free tessdata CDN on first use and cached by the browser.
  return createWorker(['eng', 'msa'])
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPageToCanvas(page: any): Promise<HTMLCanvasElement | null> {
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

/* ------------------------------------------------------------------ */
/* Field mapping (best-effort — always review against the raw text)   */
/* ------------------------------------------------------------------ */

export interface ParsedRisk {
  context: string
  risk_nature: RiskNature | ''
  description: string
  impact_description: string
  existing_controls: string
  treatment_option: TreatmentOption | ''
  additional_controls: string
  likelihood: number
  severity: number
  residual_likelihood: number
  residual_severity: number
}

export interface ParsedRegister {
  reviewDate: string
  registerRef: string
  preparedName: string
  approvedName: string
  risk: ParsedRisk
}

export interface ParsedRtpTask {
  task: string
  pic: string
  due: string
  status: RtpTaskStatus
}

export interface ParsedRtp {
  newControl: string
  adequacy: RtpAdequacy | ''
  riskOwner: string
  monitoredBy: string
  participatingDepts: string
  preparedName: string
  hodName: string
  rtcName: string
  rocName: string
  tasks: ParsedRtpTask[]
}

function emptyParsedRisk(): ParsedRisk {
  return {
    context: '', risk_nature: '', description: '', impact_description: '',
    existing_controls: '', treatment_option: '', additional_controls: '',
    likelihood: 0, severity: 0, residual_likelihood: 0, residual_severity: 0,
  }
}

/* Return the text that follows the first matching label, up to the end of the
 * line (or a sensible cut-off). Labels are matched case-insensitively and may
 * be English or Malay. */
function grabField(text: string, labels: string[], maxLen = 400): string {
  for (const label of labels) {
    const re = new RegExp(
      `${escapeRe(label)}\\s*[:\\-–]?\\s*(.+)`,
      'i',
    )
    const m = text.match(re)
    if (m && m[1]) {
      const val = m[1].split(/\r?\n/)[0].trim()
      if (val) return val.slice(0, maxLen)
    }
  }
  return ''
}

/* Find a 1–5 score that appears near a label, e.g. "Likelihood: 4" or
 * "Kebarangkalian 3". */
function grabScore(text: string, labels: string[]): number {
  for (const label of labels) {
    const re = new RegExp(`${escapeRe(label)}\\s*[:\\-–]?\\s*([1-5])(?!\\d)`, 'i')
    const m = text.match(re)
    if (m) return parseInt(m[1], 10)
  }
  return 0
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectNature(text: string): RiskNature | '' {
  const t = text.toLowerCase()
  if (/\bactual\b|sebenar/.test(t)) return 'ACTUAL'
  if (/\bpotential\b|berpotensi/.test(t)) return 'POTENTIAL'
  return ''
}

function detectTreatment(text: string): TreatmentOption | '' {
  const t = text.toLowerCase()
  if (/\bavoid\b|elak/.test(t)) return 'AVOID'
  if (/\btransfer\b|pindah/.test(t)) return 'TRANSFER'
  if (/\baccept\b|terima/.test(t)) return 'ACCEPT'
  if (/\bcontrol\b|kawal/.test(t)) return 'CONTROL'
  return ''
}

function detectAdequacy(text: string): RtpAdequacy | '' {
  const val = grabField(text, ['Adequacy', 'Kecukupan', 'Adequacy & effectiveness'])
  const t = (val || text).toLowerCase()
  if (/\bhigh\b|tinggi|\bh\b/.test(t)) return 'H'
  if (/\bmedium\b|sederhana|\bm\b/.test(t)) return 'M'
  if (/\blow\b|rendah|\bl\b/.test(t)) return 'L'
  return ''
}

/** Best-effort mapping of a Form 0044 (risk register) to a single risk block. */
export function parseForm0044(text: string): ParsedRegister {
  const risk = emptyParsedRisk()

  risk.context = grabField(text, ['Context', 'Konteks', 'Latar belakang'])
  risk.description = grabField(text, [
    'Description of risk', 'Risk description', 'Pernyataan risiko',
    'Penerangan risiko', 'Risiko',
  ])
  risk.impact_description = grabField(text, [
    'Consequence of risk', 'Consequence', 'Kesan', 'Akibat', 'Impak risiko',
  ])
  risk.existing_controls = grabField(text, [
    'Existing control', 'Kawalan sedia ada', 'Kawalan semasa',
  ])
  risk.additional_controls = grabField(text, [
    'Refer to RTP', 'Control description', 'Kawalan',
  ])
  risk.risk_nature = detectNature(text)
  risk.treatment_option = detectTreatment(text)

  risk.likelihood = grabScore(text, ['Likelihood', 'Kebarangkalian', 'Kemungkinan'])
  risk.severity = grabScore(text, ['Severity', 'Keterukan', 'Impak', 'Kesan teruk'])
  risk.residual_likelihood = grabScore(text, [
    'Residual likelihood', 'Baki kebarangkalian', 'Kebarangkalian baki',
  ])
  risk.residual_severity = grabScore(text, [
    'Residual severity', 'Baki keterukan', 'Keterukan baki',
  ])

  return {
    reviewDate: normalizeDate(grabField(text, [
      'Date of review', 'Tarikh semakan', 'Review date', 'Tarikh',
    ])),
    registerRef: grabField(text, ['Register reference', 'Reference', 'Rujukan']),
    preparedName: grabField(text, [
      'Prepared by', 'Disediakan oleh', 'Prepared / Updated by',
    ]),
    approvedName: grabField(text, [
      'Approved by', 'Diluluskan oleh', 'Reviewed / Approved by',
    ]),
    risk,
  }
}

/** Best-effort mapping of a Form 0045 (RTP). */
export function parseForm0045(text: string): ParsedRtp {
  return {
    newControl: grabField(text, [
      'New / additional control', 'Additional control', 'New control',
      'Kawalan tambahan', 'Kawalan baharu', 'Cadangan kawalan',
    ], 600),
    adequacy: detectAdequacy(text),
    riskOwner: grabField(text, ['Risk owner', 'Pemilik risiko']),
    monitoredBy: grabField(text, ['Monitored by', 'Dipantau oleh']),
    participatingDepts: grabField(text, [
      'Participating', 'Involving depts', 'Jabatan terlibat',
    ]),
    preparedName: grabField(text, ['Prepared by', 'Disediakan oleh']),
    hodName: grabField(text, ['Approved by (HOD)', 'HOD', 'Ketua Jabatan']),
    rtcName: grabField(text, ['Chairman RTC', 'RTC', 'Pengerusi RTC']),
    rocName: grabField(text, ['Chairman ROC', 'ROC', 'Pengerusi ROC']),
    tasks: parseTaskLines(text),
  }
}

/* Pull candidate task lines out of the text. Very heuristic: lines that look
 * like "1. do something" or "- do something" become task rows. */
function parseTaskLines(text: string): ParsedRtpTask[] {
  const tasks: ParsedRtpTask[] = []
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    const m = line.match(/^(?:\d+[.)]|[-•*])\s+(.{4,})$/)
    if (m) {
      tasks.push({ task: m[1].trim().slice(0, 300), pic: '', due: '', status: 'NOT_STARTED' })
    }
  }
  return tasks.slice(0, 20)
}

/* Turn a variety of written dates into an ISO yyyy-mm-dd for <input type=date>.
 * Returns '' if it can't be confidently parsed. */
function normalizeDate(s: string): string {
  if (!s) return ''
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/(\d{1,2})[/.\- ]+(\d{1,2})[/.\- ]+(\d{4})/)
  if (dmy) {
    const d = dmy[1].padStart(2, '0')
    const mo = dmy[2].padStart(2, '0')
    return `${dmy[3]}-${mo}-${d}`
  }
  return ''
}
