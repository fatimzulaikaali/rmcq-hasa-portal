/* /api/risk/parse-upload — free flexible Excel parser.
 *
 * No external API, no API key. Reads any .xlsx the user uploads with SheetJS,
 * detects the header row, fuzzy-matches header names (English + Malay) to the
 * known risk fields, and builds the same risks JSON the bulk-upload page
 * already consumes.
 *
 * Trade-offs vs. an AI-based parser:
 *   - Excel only (PDF returns a clean "not supported" message).
 *   - Best-effort: ambiguous headers get skipped. RC reviews everything before
 *     saving anyway, so anything we miss they fill in by hand.
 *   - Deterministic: no token budget, no rate limits, runs instantly. */

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

interface RiskDraft {
  description: string
  cause: string
  impact: string
  category: string
  scope: string
  existing_controls: string
  additional_controls: string
  action_owner_dept_names: string[]
  implementation_period: string
  likelihood: number | null
  impact_manusia: number | null
  impact_reputasi: number | null
  impact_kewangan: number | null
  impact_operasi: number | null
  impact_objektif: number | null
  _source_note?: string
}

type FieldKey =
  | 'description' | 'cause' | 'impact'
  | 'category' | 'scope'
  | 'existing_controls' | 'additional_controls'
  | 'action_owner' | 'implementation_period'
  | 'likelihood'
  | 'impact_manusia' | 'impact_reputasi' | 'impact_kewangan' | 'impact_operasi' | 'impact_objektif'
  | 'dept'

/* Each entry is a list of substring keywords the header must contain — order
 * matters within a list (first listed = strongest match) but not across lists.
 * All comparisons are lowercase + space-collapsed. Both English and Malay
 * terms (the form fields are bilingual in MOH paperwork) are included. */
const HEADER_PATTERNS: { field: FieldKey; patterns: string[] }[] = [
  { field: 'description',         patterns: ['risk description', 'description of risk', 'huraian risiko', 'penerangan risiko', 'risk statement', 'description'] },
  { field: 'cause',               patterns: ['root cause', 'cause', 'punca', 'sebab'] },
  { field: 'impact',              patterns: ['consequence', 'impact description', 'impact', 'kesan'] },
  { field: 'category',            patterns: ['category', 'kategori'] },
  { field: 'scope',               patterns: ['scope', 'skop'] },
  { field: 'existing_controls',   patterns: ['existing control', 'current control', 'kawalan sedia ada', 'control in place'] },
  { field: 'additional_controls', patterns: ['additional control', 'proposed control', 'kawalan tambahan', 'kawalan cadangan', 'new control', 'treatment'] },
  { field: 'action_owner',        patterns: ['action owner', 'owner', 'tindakan oleh', 'pemilik tindakan', 'responsible', 'risk owner'] },
  { field: 'implementation_period', patterns: ['implementation period', 'tempoh pelaksanaan', 'due date', 'deadline', 'target date', 'tempoh', 'period'] },
  { field: 'dept',                patterns: ['department', 'jabatan', 'unit'] },
  // Scoring — order matters: longer/more specific patterns first so we don't
  // accidentally match "L" or "K" inside a longer word.
  { field: 'impact_manusia',      patterns: ['impact: manusia', 'impact manusia', 'manusia', 'human impact', 'human'] },
  { field: 'impact_reputasi',     patterns: ['impact: reputasi', 'impact reputasi', 'reputasi', 'reputation'] },
  { field: 'impact_kewangan',     patterns: ['impact: kewangan', 'impact kewangan', 'kewangan', 'financial impact', 'financial'] },
  { field: 'impact_operasi',      patterns: ['impact: operasi', 'impact operasi', 'operasi', 'operational impact', 'operations'] },
  { field: 'impact_objektif',     patterns: ['impact: objektif', 'impact objektif', 'objektif', 'objective impact', 'objective'] },
  { field: 'likelihood',          patterns: ['likelihood', 'kebarangkalian', 'probability'] },
]

/* Category labels can appear in various forms in dept Excels. Map best-effort. */
const CATEGORY_KEYWORDS: { code: string; words: string[] }[] = [
  { code: 'OPS', words: ['operational', 'operasi', 'process', 'operations', 'ops'] },
  { code: 'KEW', words: ['financial', 'kewangan', 'budget', 'finance', 'kew'] },
  { code: 'REP', words: ['reputational', 'reputasi', 'reputation', 'public', 'media', 'rep'] },
  { code: 'PER', words: ['personnel', 'staffing', 'human resource', 'hr', 'people', 'staff', 'per'] },
  { code: 'STR', words: ['strategic', 'strategy', 'strategik', 'str'] },
  { code: 'PRJ', words: ['project', 'projek', 'initiative', 'prj'] },
]

const SCOPE_KEYWORDS: { code: string; words: string[] }[] = [
  { code: 'INSTITUSI', words: ['institusi', 'institutional', 'hospital-wide', 'hospital wide', 'institution', 'enterprise'] },
  { code: 'UNIT',      words: ['unit', 'department', 'jabatan', 'local', 'dept'] },
]

function normHeader(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/[():*\-_]/g, ' ').trim()
}

function matchField(rawHeader: string): FieldKey | null {
  const h = normHeader(rawHeader)
  if (!h) return null
  // Walk patterns in declared order so more specific ones win.
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

function pickCategory(v: unknown): string {
  if (!v) return ''
  const s = String(v).toLowerCase()
  // Direct code match
  for (const c of ['OPS', 'KEW', 'REP', 'PER', 'STR', 'PRJ']) {
    if (s === c.toLowerCase()) return c
  }
  for (const { code, words } of CATEGORY_KEYWORDS) {
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

/* Detect the header row in a 2D grid: the first row whose cells, when mapped
 * via matchField, cover at least three distinct fields. This skips title /
 * preamble rows that dept Excels often have above the real table. */
function detectHeader(rows: unknown[][]): { headerIdx: number; headerMap: Record<number, FieldKey> } | null {
  const maxLook = Math.min(rows.length, 20)
  for (let i = 0; i < maxLook; i++) {
    const map: Record<number, FieldKey> = {}
    const seen = new Set<FieldKey>()
    rows[i].forEach((cell, col) => {
      const f = matchField(String(cell ?? ''))
      if (f && !(col in map)) { map[col] = f; seen.add(f) }
    })
    if (seen.size >= 3 && (seen.has('description') || seen.has('cause') || seen.has('impact'))) {
      return { headerIdx: i, headerMap: map }
    }
  }
  return null
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
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
    if (!rows.length) continue

    const detected = detectHeader(rows as unknown[][])
    if (!detected) {
      noteLines.push(`Sheet "${sheetName}": couldn't find a recognisable header row, skipped.`)
      continue
    }
    const { headerIdx, headerMap } = detected
    const foundFields = Array.from(new Set(Object.values(headerMap)))
    noteLines.push(`Sheet "${sheetName}": header detected on row ${headerIdx + 1}; mapped fields: ${foundFields.join(', ')}.`)

    // Iterate data rows
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] as unknown[]
      // Skip blank rows
      if (row.every((c) => c === '' || c === null || c === undefined)) continue

      const get = (field: FieldKey): unknown => {
        for (const [colStr, f] of Object.entries(headerMap)) {
          if (f === field) {
            const col = parseInt(colStr, 10)
            return row[col]
          }
        }
        return undefined
      }
      const text = (v: unknown): string => (v === null || v === undefined) ? '' : String(v).trim()

      const description = text(get('description'))
      const cause = text(get('cause'))
      const impact = text(get('impact'))
      // Skip rows that have nothing useful (often blank spacer rows).
      if (!description && !cause && !impact) continue

      // Action owner: text → array of dept-name guesses split by , or ;
      const ownerRaw = text(get('action_owner'))
      const action_owner_dept_names = ownerRaw
        ? ownerRaw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
        : []

      allRisks.push({
        description,
        cause,
        impact,
        category: pickCategory(get('category')),
        scope: pickScope(get('scope')),
        existing_controls: text(get('existing_controls')),
        additional_controls: text(get('additional_controls')),
        action_owner_dept_names,
        implementation_period: text(get('implementation_period')),
        likelihood: parseScore(get('likelihood')),
        impact_manusia: parseScore(get('impact_manusia')),
        impact_reputasi: parseScore(get('impact_reputasi')),
        impact_kewangan: parseScore(get('impact_kewangan')),
        impact_operasi: parseScore(get('impact_operasi')),
        impact_objektif: parseScore(get('impact_objektif')),
      })
    }
  }

  if (allRisks.length === 0) {
    return NextResponse.json({
      risks: [],
      general_notes:
        'No risks were extracted. Make sure your Excel has a header row with recognisable column names like ' +
        '"Description / Huraian Risiko", "Cause / Punca", "Impact / Kesan", "Likelihood", and the 5 impact dimensions. ' +
        noteLines.join(' '),
    })
  }

  return NextResponse.json({
    risks: allRisks,
    general_notes: noteLines.join(' '),
    model: 'free-xlsx-parser',
  })
}
