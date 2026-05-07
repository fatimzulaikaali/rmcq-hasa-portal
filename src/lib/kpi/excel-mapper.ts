import { Frequency, Period, RiskLevel, SiqStatus, TargetOperator } from './types'

export interface ParsedDeptRow {
  dept_code: string
  kpi_pdf_dept: string | null
  official_dept_unit: string | null
  mapping_status: string | null
  remarks: string | null
}

export interface ParsedDefinitionRow {
  kpi_id: string
  website_kpi_id: string | null
  dept_code: string
  department: string | null
  kpi_name: string
  target: string | null
  frequency: Frequency
  siq_trigger_consecutive: number
  target_operator: TargetOperator | null
  target_value: number | null
  scheduled_periods: string | null
}

export interface ParsedDataRow {
  kpi_id: string
  year: number
  period: Period
  period_order: number | null
  result: string | null
}

export interface ParsedSiqRow {
  siq_id: string | null
  kpi_id: string | null
  website_kpi_id: string | null
  dept_code: string | null
  department: string | null
  kpi_name: string | null
  frequency: string | null
  trigger_year: number | null
  trigger_period: string | null
  trigger_basis: string | null
  date_issued: string | null
  due_date: string | null
  owner: string | null
  risk_level: RiskLevel | null
  status: SiqStatus | null
  action_plan: string | null
  progress_update: string | null
  closure_date: string | null
  evidence_link: string | null
  remarks: string | null
}

export interface KpiParseResult {
  departments: ParsedDeptRow[]
  definitions: ParsedDefinitionRow[]
  data: ParsedDataRow[]
  siqRecords: ParsedSiqRow[]
  errors: string[]
  sheetCounts: Record<string, number>
}

const FREQUENCY_SET: Frequency[] = ['Monthly', 'Quarterly', 'Biannual', 'Yearly']
const PERIOD_SET: Period[] = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const OPERATOR_SET: TargetOperator[] = ['>=', '<=', '=', '>', '<', '!=']
const RISK_SET: RiskLevel[] = ['Low', 'Moderate', 'High', 'Extreme']
const STATUS_SET: SiqStatus[] = ['Open', 'In Progress', 'Pending Department Feedback', 'Closed']

const trim = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  if (s.toUpperCase() === 'NA' || s === '-') return null
  return s
}

const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace('%', '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Convert any plausible cell value (Excel serial number, JS Date, or string)
 * to a YYYY-MM-DD calendar day. Timezone-independent.
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
  if (typeof v === 'number') return excelSerialToYmd(v)
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    if (v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0) {
      return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`
    }
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  if (!s || s.toUpperCase() === 'NA' || s === '-') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return toIsoDate(d)
}

function asFrequency(v: unknown): Frequency | null {
  const s = trim(v)
  if (!s) return null
  const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return FREQUENCY_SET.includes(cap as Frequency) ? (cap as Frequency) : null
}

function asPeriod(v: unknown): Period | null {
  const s = trim(v)
  if (!s) return null
  const up = s.toUpperCase().slice(0, 3)
  return PERIOD_SET.includes(up as Period) ? (up as Period) : null
}

function asOperator(v: unknown): TargetOperator | null {
  const s = trim(v)
  if (!s) return null
  return OPERATOR_SET.includes(s as TargetOperator) ? (s as TargetOperator) : null
}

function asRiskLevel(v: unknown): RiskLevel | null {
  const s = trim(v)
  if (!s) return null
  const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return RISK_SET.includes(cap as RiskLevel) ? (cap as RiskLevel) : null
}

function asStatus(v: unknown): SiqStatus | null {
  const s = trim(v)
  if (!s) return null
  return STATUS_SET.includes(s as SiqStatus) ? (s as SiqStatus) : null
}

function getCol(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const norm = k.replace(/\s+/g, ' ').trim()
    for (const rk of Object.keys(row)) {
      if (rk.replace(/\s+/g, ' ').trim() === norm) return row[rk]
    }
  }
  return undefined
}

import * as XLSX from 'xlsx'

export function parseKpiWorkbook(buf: ArrayBuffer): KpiParseResult {
  // No cellDates — date cells come through as raw Excel serials, converted in toIsoDate()
  // via UTC math (timezone-bulletproof).
  const wb = XLSX.read(buf, { type: 'array' })
  const errors: string[] = []
  const sheetCounts: Record<string, number> = {}

  // ------ Department_Mapping ------
  const departments: ParsedDeptRow[] = []
  if (wb.Sheets['Department_Mapping']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Department_Mapping'], { defval: null })
    for (const r of rows) {
      const code = trim(getCol(r, 'Dept_Code'))
      if (!code) continue
      departments.push({
        dept_code: code,
        kpi_pdf_dept: trim(getCol(r, 'KPI_PDF_Department')),
        official_dept_unit: trim(getCol(r, 'Official_Department_Unit')),
        mapping_status: trim(getCol(r, 'Mapping_Status')),
        remarks: trim(getCol(r, 'Remarks')),
      })
    }
    sheetCounts['Department_Mapping'] = departments.length
  } else {
    errors.push("Missing sheet 'Department_Mapping'")
  }

  // ------ KPI_Master ------
  const definitions: ParsedDefinitionRow[] = []
  if (wb.Sheets['KPI_Master']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['KPI_Master'], { defval: null })
    for (const r of rows) {
      const kpi_id = trim(getCol(r, 'KPI_ID'))
      if (!kpi_id) continue
      const dept_code = trim(getCol(r, 'Dept_Code'))
      const kpi_name = trim(getCol(r, 'KPI_Name'))
      const freq = asFrequency(getCol(r, 'Frequency'))
      if (!dept_code || !kpi_name || !freq) {
        errors.push(`KPI_Master row missing required fields (KPI_ID=${kpi_id})`)
        continue
      }
      definitions.push({
        kpi_id,
        website_kpi_id: trim(getCol(r, 'Website_KPI_ID')),
        dept_code,
        department: trim(getCol(r, 'Department')),
        kpi_name,
        target: trim(getCol(r, 'Target')),
        frequency: freq,
        siq_trigger_consecutive: toInt(getCol(r, 'SIQ_Trigger_Consecutive')) ?? 1,
        target_operator: asOperator(getCol(r, 'Target_Operator')),
        target_value: toNum(getCol(r, 'Target_Value')),
        scheduled_periods: trim(getCol(r, 'Scheduled_Periods')),
      })
    }
    sheetCounts['KPI_Master'] = definitions.length
  } else {
    errors.push("Missing sheet 'KPI_Master'")
  }

  // ------ KPI_Data ------
  const data: ParsedDataRow[] = []
  if (wb.Sheets['KPI_Data']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['KPI_Data'], { defval: null })
    for (const r of rows) {
      const kpi_id = trim(getCol(r, 'KPI_ID'))
      const year = toInt(getCol(r, 'Year'))
      const period = asPeriod(getCol(r, 'Period'))
      if (!kpi_id || !year || !period) continue
      data.push({
        kpi_id,
        year,
        period,
        period_order: toInt(getCol(r, 'Period_Order')),
        result: trim(getCol(r, 'Result')),
      })
    }
    sheetCounts['KPI_Data'] = data.length
  } else {
    errors.push("Missing sheet 'KPI_Data'")
  }

  // ------ SIQ_Tracker ------
  const siqRecords: ParsedSiqRow[] = []
  if (wb.Sheets['SIQ_Tracker']) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['SIQ_Tracker'], { defval: null })
    for (const r of rows) {
      const siq_id = trim(getCol(r, 'SIQ_ID'))
      const kpi_id = trim(getCol(r, 'KPI_ID'))
      if (!siq_id && !kpi_id) continue // skip empty rows
      siqRecords.push({
        siq_id,
        kpi_id,
        website_kpi_id: trim(getCol(r, 'Website_KPI_ID')),
        dept_code: trim(getCol(r, 'Dept_Code')),
        department: trim(getCol(r, 'Department')),
        kpi_name: trim(getCol(r, 'KPI_Name')),
        frequency: trim(getCol(r, 'Frequency')),
        trigger_year: toInt(getCol(r, 'Trigger_Year')),
        trigger_period: trim(getCol(r, 'Trigger_Period')),
        trigger_basis: trim(getCol(r, 'Trigger_Basis')),
        date_issued: toIsoDate(getCol(r, 'Date_Issued')),
        due_date: toIsoDate(getCol(r, 'Due_Date')),
        owner: trim(getCol(r, 'Owner')),
        risk_level: asRiskLevel(getCol(r, 'Risk_Level')),
        status: asStatus(getCol(r, 'Status')),
        action_plan: trim(getCol(r, 'Action_Plan')),
        progress_update: trim(getCol(r, 'Progress_Update')),
        closure_date: toIsoDate(getCol(r, 'Closure_Date')),
        evidence_link: trim(getCol(r, 'Evidence_Link')),
        remarks: trim(getCol(r, 'Remarks')),
      })
    }
    sheetCounts['SIQ_Tracker'] = siqRecords.length
  } else {
    errors.push("Missing sheet 'SIQ_Tracker'")
  }

  return { departments, definitions, data, siqRecords, errors, sheetCounts }
}
