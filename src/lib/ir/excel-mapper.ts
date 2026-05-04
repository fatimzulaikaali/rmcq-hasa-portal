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

const toIsoDate = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    // YYYY-MM-DD
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    const d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  if (!s || s.toUpperCase() === 'NA' || s === '-') return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return toIsoDate(d)
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
  'Action Due Date': 'action_due_date',
  'Date Reported': 'submission_date',
}

export const MAPPED_HEADERS = Object.keys(HEADER_MAP)

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
