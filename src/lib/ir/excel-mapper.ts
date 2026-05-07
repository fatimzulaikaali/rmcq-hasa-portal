/**
 * Maps a row from the IR Excel database (e.g. latest_IR_database_30_April_2026.xlsx)
 * to a row matching the public.incidents table schema.
 */

export interface IncidentRow {
  incident_id: string | null
  incident_month: string | null
  dept_code: string | null
  action_dept: string | null
  reporting_dept: string | null
  care_setting: string | null
  ward: string | null
  category: string | null
  sub_category: string | null
  sentinel: boolean
  incident_type: string | null
  severity_real: string | null
  severity_potential: string | null
  action_taken: string | null
  case_closed: boolean
  is_rca: number
  rca_status: string | null
  is_ii: number
  ii_status: string | null
  action_due_date: string | null
  submission_date: string | null
}

const cleanKey = (k: string) => k.replace(/\s+/g, ' ').trim()

const trimStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s || s.toUpperCase() === 'NA' || s === '-') return null
  return s
}

const toBool = (v: unknown): boolean => {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toUpperCase()
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1'
}

const toInt = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/**
 * Convert any plausible cell value (Excel serial number, JS Date, or string)
 * to a YYYY-MM-DD calendar day. **Timezone-independent.**
 *
 * The primary path is the Excel serial number: SheetJS produces this when
 * `cellDates: true` is NOT set, so we read date cells as raw numbers and
 * convert via UTC math (Excel epoch = 1899-12-30 UTC). The Date fallback is
 * only used if a Date somehow slips through; we still smart-detect midnight
 * UTC vs midnight LOCAL there, but the number path is the bulletproof one.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30) // 1899-12-30 UTC

function excelSerialToYmd(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const days = Math.floor(serial)
  const ms = EXCEL_EPOCH_MS + days * 86400000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const toIsoDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null

  // Excel serial number — primary path when cellDates is off.
  if (typeof v === 'number') return excelSerialToYmd(v)

  // JS Date — fallback. Smart-detect midnight UTC vs midnight LOCAL.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) {
      return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
    }
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }

  // String
  const s = String(v).trim()
  if (!s || s.toUpperCase() === 'NA' || s === '-') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Source column → target field. Source headers are normalized (collapsed whitespace, trimmed). */
const HEADER_MAP: Record<string, keyof IncidentRow> = {
  'Incident ID': 'incident_id',
  'Incident Month': 'incident_month',
  'Department': 'dept_code',
  'Action Department': 'action_dept',
  'Reporting Department': 'reporting_dept',
  'Care Setting (Inpatient/ Outpatient)': 'care_setting',
  'Ward/Unit': 'ward',
  'Incident Category': 'category',
  'Sub Category': 'sub_category',
  'Sentinel Event (Y/N)': 'sentinel',
  'Incident Type (Actual/Near Miss)': 'incident_type',
  'Severity of Outcome (Real)': 'severity_real',
  'Severity of Outcome (Potential)': 'severity_potential',
  'ActionTaken': 'action_taken',
  'Case Closed': 'case_closed',
  'IsRCA': 'is_rca',
  'RCA_Status_Summary': 'rca_status',
  'IsInternalInvestigation': 'is_ii',
  'InternalInvestigation_Status_summary': 'ii_status',
  'Action Due Date': 'action_due_date',
  'Date Reported': 'submission_date',
}

export const MAPPED_HEADERS = Object.keys(HEADER_MAP)

/**
 * Scan the first few rows of a sheet (as a 2D array) and return the row index
 * that best matches our known IR headers. Returns 0 if no row beats row 0.
 */
export function detectHeaderRow(rows: unknown[][], maxScan = 6): number {
  const known = new Set(MAPPED_HEADERS.map((h) => h.replace(/\s+/g, ' ').trim().toLowerCase()))
  let bestIdx = 0
  let bestScore = -1
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    const row = rows[i] ?? []
    let score = 0
    for (const cell of row) {
      if (typeof cell !== 'string') continue
      const k = cell.replace(/\s+/g, ' ').trim().toLowerCase()
      if (k && known.has(k)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }
  return bestIdx
}

/** Extra fields we read but that aren't in HEADER_MAP (used as fallbacks). */
const FALLBACK_HEADERS = [
  'Date of Incident', // fallback for incident_month
  'Submission Date', // fallback for submission_date
]

export const READ_HEADERS = [...MAPPED_HEADERS, ...FALLBACK_HEADERS]

export function mapRow(raw: Record<string, unknown>): IncidentRow {
  // build a key-normalized lookup
  const norm: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) norm[cleanKey(k)] = v
  const get = (k: string) => norm[cleanKey(k)]

  const out: IncidentRow = {
    incident_id: trimStr(get('Incident ID')),
    incident_month:
      toIsoDate(get('Incident Month')) ?? toIsoDate(get('Date of Incident')),
    dept_code: trimStr(get('Department')),
    action_dept: trimStr(get('Action Department')),
    reporting_dept: trimStr(get('Reporting Department')),
    care_setting: trimStr(get('Care Setting (Inpatient/ Outpatient)')),
    ward: trimStr(get('Ward/Unit')),
    category: trimStr(get('Incident Category')),
    sub_category: trimStr(get('Sub Category')),
    sentinel: toBool(get('Sentinel Event (Y/N)')),
    incident_type: trimStr(get('Incident Type (Actual/Near Miss)')),
    severity_real: trimStr(get('Severity of Outcome (Real)')),
    severity_potential: trimStr(get('Severity of Outcome (Potential)')),
    action_taken: trimStr(get('ActionTaken')),
    case_closed: toBool(get('Case Closed')),
    is_rca: toInt(get('IsRCA')),
    rca_status: trimStr(get('RCA_Status_Summary')),
    is_ii: toInt(get('IsInternalInvestigation')),
    ii_status: trimStr(get('InternalInvestigation_Status_summary')),
    action_due_date: toIsoDate(get('Action Due Date')),
    submission_date:
      toIsoDate(get('Date Reported')) ?? toIsoDate(get('Submission Date')),
  }

  return out
}

export interface ParsedRowError {
  row: number
  reason: string
}

export interface ParseSummary {
  totalRows: number
  validRows: IncidentRow[]
  errors: ParsedRowError[]
  unknownHeaders: string[]
  matchedHeaders: string[]
}

export function parseRows(
  rawRows: Record<string, unknown>[],
  sourceHeaders: string[]
): ParseSummary {
  const cleanedSource = sourceHeaders.map(cleanKey)
  const known = new Set([...MAPPED_HEADERS, ...FALLBACK_HEADERS, 'No', 'Time of Incident', 'Patient Identifier (Y/N)', 'Patient Age', 'Patient Gender (M/F)', 'Reported To', 'Remarks'])
  const unknownHeaders = cleanedSource.filter((h) => h && !known.has(h))
  const matchedHeaders = MAPPED_HEADERS.filter((h) => cleanedSource.includes(h))

  const valid: IncidentRow[] = []
  const errors: ParsedRowError[] = []

  rawRows.forEach((raw, idx) => {
    try {
      const mapped = mapRow(raw)
      if (!mapped.incident_id) {
        errors.push({ row: idx + 2, reason: 'Missing Incident ID' })
        return
      }
      valid.push(mapped)
    } catch (e) {
      errors.push({ row: idx + 2, reason: e instanceof Error ? e.message : 'Parse error' })
    }
  })

  return {
    totalRows: rawRows.length,
    validRows: valid,
    errors,
    unknownHeaders,
    matchedHeaders,
  }
}
