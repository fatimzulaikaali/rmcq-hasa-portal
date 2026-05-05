import {
  AchievementStatus,
  Frequency,
  KpiDataRow,
  KpiDefinition,
  Period,
  PERIODS,
  TargetOperator,
} from './types'

const PERIOD_NUM: Record<Period, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

/**
 * Submission deadline = 25th of the month AFTER the reporting period ends.
 * Monthly Jan 2026 → due 25 Feb 2026
 * Quarterly Q1 (Mar) → due 25 Apr 2026
 * Biannual H1 (Jun) → due 25 Jul 2026
 * Yearly (Dec) → due 25 Jan next year
 */
export function deadlineFor(year: number, period: Period): Date {
  const m = PERIOD_NUM[period]
  // due 25th of the next month
  const dueY = m === 12 ? year + 1 : year
  const dueM = m === 12 ? 0 : m // 0-indexed month, m+1 is the next month, which means JS month index m
  return new Date(Date.UTC(dueY, dueM, 25))
}

/**
 * Is the data for (year, period) overdue (past 25th of next month) and still missing/unsubmitted?
 */
export function isOverdueDeadline(year: number, period: Period, today = new Date()): boolean {
  const due = deadlineFor(year, period)
  return today.getTime() > due.getTime()
}

/**
 * Parse a result string like '73.33%' or '85.00' or '0' into a number.
 */
export function parseResultNumber(result: string | null): number | null {
  if (result === null || result === undefined) return null
  const s = String(result).trim()
  if (!s) return null
  if (s.toUpperCase() === 'NA' || s === '-' || s.toLowerCase() === 'not applicable') return null
  const cleaned = s.replace('%', '').trim()
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Compute achievement status given a result string and target operator/value.
 * Returns: 'Achieved' | 'Not Achieved' | 'No Data' | 'Not Applicable'
 */
export function computeAchievement(
  result: string | null,
  operator: TargetOperator | null,
  targetValue: number | null
): AchievementStatus {
  if (result === null || result === undefined || String(result).trim() === '') return 'No Data'
  const s = String(result).trim()
  if (s.toLowerCase() === 'not applicable' || s.toUpperCase() === 'NA') return 'Not Applicable'
  if (operator === null || targetValue === null) return 'No Data'
  const n = parseResultNumber(result)
  if (n === null) return 'No Data'
  switch (operator) {
    case '>=': return n >= targetValue ? 'Achieved' : 'Not Achieved'
    case '<=': return n <= targetValue ? 'Achieved' : 'Not Achieved'
    case '=':  return n === targetValue ? 'Achieved' : 'Not Achieved'
    case '>':  return n > targetValue ? 'Achieved' : 'Not Achieved'
    case '<':  return n < targetValue ? 'Achieved' : 'Not Achieved'
    case '!=': return n !== targetValue ? 'Achieved' : 'Not Achieved'
  }
  return 'No Data'
}

/**
 * Get scheduled periods for a frequency.
 */
export function scheduledPeriodsFor(freq: Frequency): Period[] {
  switch (freq) {
    case 'Monthly': return PERIODS
    case 'Quarterly': return ['MAR', 'JUN', 'SEP', 'DEC']
    case 'Biannual': return ['JUN', 'DEC']
    case 'Yearly': return ['DEC']
  }
}

/**
 * Submission compliance for a KPI: scheduled periods that are past-deadline,
 * vs how many were actually submitted (have non-null result).
 */
export interface ComplianceResult {
  scheduledDue: number    // scheduled periods whose deadline has passed
  submitted: number       // of those, how many have a result
  pending: number         // scheduled periods past deadline but no result (overdue)
  notYetDue: number       // scheduled periods whose deadline hasn't passed
  pct: number             // submitted / scheduledDue * 100
}

export function compliance(
  def: KpiDefinition,
  rows: KpiDataRow[],
  year: number,
  today = new Date()
): ComplianceResult {
  const periods = scheduledPeriodsFor(def.frequency)
  const byPeriod = new Map<Period, KpiDataRow>()
  for (const r of rows) {
    if (r.kpi_id === def.kpi_id && r.year === year) byPeriod.set(r.period, r)
  }
  let scheduledDue = 0
  let submitted = 0
  let pending = 0
  let notYetDue = 0
  for (const p of periods) {
    const due = isOverdueDeadline(year, p, today)
    const row = byPeriod.get(p)
    const hasResult = row && row.result !== null && row.result !== ''
    if (due) {
      scheduledDue++
      if (hasResult) submitted++
      else pending++
    } else {
      notYetDue++
    }
  }
  return {
    scheduledDue,
    submitted,
    pending,
    notYetDue,
    pct: scheduledDue ? Math.round((submitted / scheduledDue) * 100) : 0,
  }
}

/**
 * Department-level compliance: aggregate across all that dept's KPIs.
 */
export function deptCompliance(
  defs: KpiDefinition[],
  rows: KpiDataRow[],
  deptCode: string,
  year: number,
  today = new Date()
): ComplianceResult & { kpiCount: number } {
  const deptDefs = defs.filter((d) => d.dept_code === deptCode && d.active)
  let scheduledDue = 0, submitted = 0, pending = 0, notYetDue = 0
  for (const d of deptDefs) {
    const c = compliance(d, rows, year, today)
    scheduledDue += c.scheduledDue
    submitted += c.submitted
    pending += c.pending
    notYetDue += c.notYetDue
  }
  return {
    kpiCount: deptDefs.length,
    scheduledDue, submitted, pending, notYetDue,
    pct: scheduledDue ? Math.round((submitted / scheduledDue) * 100) : 0,
  }
}

/**
 * Detect SIQ trigger for a KPI: N consecutive Not Achieved results
 * (N depends on frequency: Monthly=3, Quarterly=2, Biannual/Yearly=1).
 */
export function detectSiqTrigger(
  def: KpiDefinition,
  rows: KpiDataRow[],
  year: number
): { triggered: boolean; triggerPeriod: Period | null; consecutive: number } {
  const periods = scheduledPeriodsFor(def.frequency)
  const byPeriod = new Map<Period, KpiDataRow>()
  for (const r of rows) {
    if (r.kpi_id === def.kpi_id && r.year === year) byPeriod.set(r.period, r)
  }
  let streak = 0
  let lastNotAchieved: Period | null = null
  for (const p of periods) {
    const row = byPeriod.get(p)
    if (!row) continue
    const status = computeAchievement(row.result, def.target_operator, def.target_value)
    if (status === 'Not Achieved') {
      streak++
      lastNotAchieved = p
      if (streak >= def.siq_trigger_consecutive) {
        return { triggered: true, triggerPeriod: lastNotAchieved, consecutive: streak }
      }
    } else if (status === 'Achieved') {
      streak = 0
    }
    // No Data / Not Applicable: don't reset streak; just skip
  }
  return { triggered: false, triggerPeriod: null, consecutive: streak }
}

/**
 * Period filter for report card (mirrors IR period semantics).
 */
export type KpiPeriodKey =
  | 'YTD'
  | 'M-1'|'M-2'|'M-3'|'M-4'|'M-5'|'M-6'|'M-7'|'M-8'|'M-9'|'M-10'|'M-11'|'M-12'
  | 'Q1'|'Q2'|'Q3'|'Q4'
  | 'H1'|'H2'
  | '9M'|'YEAR'

export const KPI_PERIOD_OPTIONS: { group: string; options: { value: KpiPeriodKey; label: string }[] }[] = [
  { group: 'Year-to-Date', options: [{ value: 'YTD', label: 'Year-to-Date (All Months)' }] },
  { group: 'Monthly', options: [
    { value: 'M-1',  label: 'January' },
    { value: 'M-2',  label: 'February' },
    { value: 'M-3',  label: 'March' },
    { value: 'M-4',  label: 'April' },
    { value: 'M-5',  label: 'May' },
    { value: 'M-6',  label: 'June' },
    { value: 'M-7',  label: 'July' },
    { value: 'M-8',  label: 'August' },
    { value: 'M-9',  label: 'September' },
    { value: 'M-10', label: 'October' },
    { value: 'M-11', label: 'November' },
    { value: 'M-12', label: 'December' },
  ]},
  { group: 'Quarterly', options: [
    { value: 'Q1', label: 'Q1 (Jan-Mar)' },
    { value: 'Q2', label: 'Q2 (Apr-Jun)' },
    { value: 'Q3', label: 'Q3 (Jul-Sep)' },
    { value: 'Q4', label: 'Q4 (Oct-Dec)' },
  ]},
  { group: '6-Monthly', options: [
    { value: 'H1', label: 'H1 (Jan-Jun)' },
    { value: 'H2', label: 'H2 (Jul-Dec)' },
  ]},
  { group: '9-Monthly', options: [{ value: '9M', label: '9 Months (Jan-Sep)' }] },
  { group: 'Yearly',    options: [{ value: 'YEAR', label: 'Full Year' }] },
]

export function kpiPeriodLabel(k: KpiPeriodKey): string {
  for (const g of KPI_PERIOD_OPTIONS) {
    const o = g.options.find((x) => x.value === k)
    if (o) return o.label
  }
  return k
}

export function kpiPeriodMonths(k: KpiPeriodKey): Period[] {
  switch (k) {
    case 'M-1': return ['JAN']
    case 'M-2': return ['FEB']
    case 'M-3': return ['MAR']
    case 'M-4': return ['APR']
    case 'M-5': return ['MAY']
    case 'M-6': return ['JUN']
    case 'M-7': return ['JUL']
    case 'M-8': return ['AUG']
    case 'M-9': return ['SEP']
    case 'M-10': return ['OCT']
    case 'M-11': return ['NOV']
    case 'M-12': return ['DEC']
    case 'Q1': return ['JAN','FEB','MAR']
    case 'Q2': return ['APR','MAY','JUN']
    case 'Q3': return ['JUL','AUG','SEP']
    case 'Q4': return ['OCT','NOV','DEC']
    case 'H1': return ['JAN','FEB','MAR','APR','MAY','JUN']
    case 'H2': return ['JUL','AUG','SEP','OCT','NOV','DEC']
    case '9M': return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP']
    case 'YEAR':
    case 'YTD':
    default:   return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  }
}

/**
 * Format an ISO date as 'DD MMM YYYY'.
 */
const MON_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function fmtDate(iso: string | Date | null): string {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MON_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
