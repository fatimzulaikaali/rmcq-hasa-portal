export interface Incident {
  id: string
  incident_id: string | null
  incident_month: string | null
  dept_code: string | null
  action_dept: string | null
  reporting_dept: string | null
  care_setting: string | null
  ward: string | null
  category: string | null
  sub_category: string | null
  sentinel: boolean | null
  incident_type: string | null
  severity_real: string | null
  severity_potential: string | null
  action_taken: string | null
  case_closed: boolean | null
  is_rca: number | null
  rca_status: string | null
  is_ii: number | null
  ii_status: string | null
  action_due_date: string | null
  submission_date: string | null
}

export interface IrFilters {
  month: string // 'all' | 'YYYY-MM'
  dept: string // 'all' | dept_code
  careSetting: string // 'all' | INPATIENT etc
  type: string // 'all' | ACTUAL | NEARMISS
  category: string // 'all' | category name
}

export const DEFAULT_FILTERS: IrFilters = {
  month: 'all',
  dept: 'all',
  careSetting: 'all',
  type: 'all',
  category: 'all',
}

export const NON_PSI = 'Not Patient Safety Incident'

export const SEVERITY_ORDER = ['DEATH', 'SEVERE', 'MODERATE', 'MILD', 'NO HARM'] as const
export type Severity = typeof SEVERITY_ORDER[number]

export const SEVERITY_BG: Record<string, string> = {
  DEATH: '#501313',
  SEVERE: '#A32D2D',
  MODERATE: '#FAEEDA',
  MILD: '#E6F1FB',
  'NO HARM': '#EAF3DE',
}
export const SEVERITY_FG: Record<string, string> = {
  DEATH: '#FFFFFF',
  SEVERE: '#FFFFFF',
  MODERATE: '#854F0B',
  MILD: '#185FA5',
  'NO HARM': '#3B6D11',
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Not Patient Safety Incident': '#888780',
  'Pressure Injury': '#D85A30',
  'IV Line Complication': '#378ADD',
  'OG Related Incident': '#1D9E75',
  'Medication Error': '#E24B4A',
  'Radiology Related Incident': '#7F77DD',
  'Fall': '#EF9F27',
  'Others': '#B4B2A9',
  'Laboratory Related Incident': '#5DCAA5',
  'Process care process failure': '#D4537E',
  'Equipment Related Incidents': '#AFA9EC',
  'Medical Record Related Incident': '#9FE1CB',
  'Communication Error': '#F0997B',
}

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthKey(iso: string | null): string | null {
  if (!iso) return null
  return iso.slice(0, 7)
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  if (!y || !m) return key
  return `${MONTH_LABEL[parseInt(m, 10) - 1]} ${y}`
}
export function shortMonthLabel(key: string): string {
  const [y, m] = key.split('-')
  if (!y || !m) return key
  return `${MONTH_LABEL[parseInt(m, 10) - 1]} '${y.slice(2)}`
}

export function isPsi(r: Incident): boolean {
  return (r.category ?? '').trim() !== NON_PSI
}

export function applyFilters(rows: Incident[], f: IrFilters): Incident[] {
  return rows.filter((r) => {
    if (f.month !== 'all' && monthKey(r.incident_month) !== f.month) return false
    if (f.dept !== 'all' && r.dept_code !== f.dept) return false
    if (f.careSetting !== 'all' && (r.care_setting ?? '').toUpperCase() !== f.careSetting) return false
    if (f.type !== 'all' && (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '') !== f.type) return false
    if (f.category !== 'all' && r.category !== f.category) return false
    return true
  })
}

export function uniqueValues(rows: Incident[], key: keyof Incident): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'string' && v.trim()) set.add(v.trim())
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function uniqueMonths(rows: Incident[]): { value: string; label: string }[] {
  const set = new Set<string>()
  for (const r of rows) {
    const k = monthKey(r.incident_month)
    if (k) set.add(k)
  }
  return Array.from(set)
    .sort()
    .map((k) => ({ value: k, label: monthLabel(k) }))
}

export function activeMonthRange(rows: Incident[], f: IrFilters): string {
  if (f.month !== 'all') return monthLabel(f.month)
  const months = uniqueMonths(rows).map((m) => m.label)
  if (months.length === 0) return '—'
  if (months.length === 1) return months[0]
  return `${months[0]} – ${months[months.length - 1]}`
}

/* ===================== STATUS PARSERS ===================== */

export type IiStatus = 'Non-II' | 'Overdue' | 'Pending' | 'On Time' | 'Late' | 'Unknown'
export type RcaStatus = 'Non-RCA' | 'Overdue' | 'Pending' | 'Completed' | 'Unknown'

export function parseIiStatus(s: string | null): IiStatus {
  const t = (s ?? '').trim()
  if (!t) return 'Unknown'
  const lo = t.toLowerCase()
  if (lo.includes('non-internal') || lo === 'non-ii') return 'Non-II'
  if (lo.includes('overdue')) return 'Overdue'
  if (lo.includes('pending')) return 'Pending'
  if (lo.includes('on time') || lo.includes('on-time') || lo.includes('submitted on time')) return 'On Time'
  if (lo.includes('late') || lo.includes('submitted late')) return 'Late'
  return 'Unknown'
}

export function parseRcaStatus(s: string | null): RcaStatus {
  const t = (s ?? '').trim()
  if (!t) return 'Unknown'
  const lo = t.toLowerCase()
  if (lo === 'non-rca' || lo.includes('non-rca')) return 'Non-RCA'
  if (lo.includes('overdue')) return 'Overdue'
  if (lo.includes('pending')) return 'Pending'
  if (lo.includes('completed') || lo.includes('complete')) return 'Completed'
  return 'Unknown'
}

/* ===================== SUMMARIES ===================== */

export interface OverviewMetrics {
  total: number
  psi: number
  nonPsi: number
  open: number
  sentinel: number
  deaths: number
  nearMiss: number
  severe: number
}

export function overviewMetrics(rows: Incident[]): OverviewMetrics {
  let psi = 0, nonPsi = 0, open = 0, sentinel = 0, deaths = 0, nearMiss = 0, severe = 0
  for (const r of rows) {
    const psiFlag = isPsi(r)
    if (psiFlag) psi++; else nonPsi++
    if (!r.case_closed) open++
    if (r.sentinel) sentinel++
    const sev = (r.severity_real ?? '').toUpperCase()
    if (sev === 'DEATH') deaths++
    if (sev === 'SEVERE') severe++
    const t = (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '')
    if (t === 'NEARMISS' && psiFlag) nearMiss++
  }
  return { total: rows.length, psi, nonPsi, open, sentinel, deaths, nearMiss, severe }
}

/* ===================== AGGREGATIONS ===================== */

export function psiVsNonPsiByMonth(rows: Incident[]): {
  labels: string[]
  psi: number[]
  nonPsi: number[]
} {
  const acc = new Map<string, { psi: number; nonPsi: number }>()
  for (const r of rows) {
    const k = monthKey(r.incident_month)
    if (!k) continue
    if (!acc.has(k)) acc.set(k, { psi: 0, nonPsi: 0 })
    const a = acc.get(k)!
    if (isPsi(r)) a.psi++; else a.nonPsi++
  }
  const sorted = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
  return {
    labels: sorted.map(([k]) => monthLabel(k)),
    psi: sorted.map(([, v]) => v.psi),
    nonPsi: sorted.map(([, v]) => v.nonPsi),
  }
}

export function counts<T>(rows: T[], pick: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = (pick(r) ?? '').trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

export function sortedTop(map: Map<string, number>, n?: number): { labels: string[]; data: number[] } {
  const arr = Array.from(map.entries()).sort(([, a], [, b]) => b - a)
  const slice = n != null ? arr.slice(0, n) : arr
  return { labels: slice.map(([k]) => k), data: slice.map(([, v]) => v) }
}

export function severityCounts(rows: Incident[], pick: (r: Incident) => string | null = (r) => r.severity_real): Record<Severity, number> {
  const out: Record<Severity, number> = { DEATH: 0, SEVERE: 0, MODERATE: 0, MILD: 0, 'NO HARM': 0 }
  for (const r of rows) {
    const s = (pick(r) ?? '').toUpperCase() as Severity
    if (s in out) out[s]++
  }
  return out
}

export function severityByCategory(rows: Incident[]): Map<string, Record<Severity, number>> {
  const out = new Map<string, Record<Severity, number>>()
  for (const r of rows) {
    const c = (r.category ?? '').trim()
    if (!c) continue
    if (!out.has(c)) out.set(c, { DEATH: 0, SEVERE: 0, MODERATE: 0, MILD: 0, 'NO HARM': 0 })
    const s = (r.severity_real ?? '').toUpperCase() as Severity
    if (s in out.get(c)!) out.get(c)![s]++
  }
  return out
}

export function categoryByMonth(rows: Incident[]): {
  months: string[]
  categories: string[]
  matrix: number[][]  // matrix[catIdx][monthIdx]
} {
  const monthSet = new Set<string>()
  const catSet = new Set<string>()
  for (const r of rows) {
    const k = monthKey(r.incident_month); if (k) monthSet.add(k)
    const c = (r.category ?? '').trim(); if (c) catSet.add(c)
  }
  const months = Array.from(monthSet).sort()
  const categories = Array.from(catSet).sort()
  const matrix: number[][] = categories.map(() => months.map(() => 0))
  const monthIdx = new Map(months.map((m, i) => [m, i]))
  const catIdx = new Map(categories.map((c, i) => [c, i]))
  for (const r of rows) {
    const k = monthKey(r.incident_month); if (!k) continue
    const c = (r.category ?? '').trim(); if (!c) continue
    matrix[catIdx.get(c)!][monthIdx.get(k)!]++
  }
  return { months: months.map(monthLabel), categories, matrix }
}

/* II-specific aggregations */
export function iiBuckets(rows: Incident[]): {
  total: number
  overdue: Incident[]
  pending: Incident[]
  onTime: number
  late: number
  nonII: number
} {
  let onTime = 0, late = 0, nonII = 0
  const overdue: Incident[] = []
  const pending: Incident[] = []
  let total = 0
  for (const r of rows) {
    const status = parseIiStatus(r.ii_status)
    if (status === 'Non-II') { nonII++; continue }
    total++
    if (status === 'Overdue') overdue.push(r)
    else if (status === 'Pending') pending.push(r)
    else if (status === 'On Time') onTime++
    else if (status === 'Late') late++
  }
  return { total, overdue, pending, onTime, late, nonII }
}

export function rcaBuckets(rows: Incident[]): {
  total: number
  overdue: Incident[]
  pending: Incident[]
  completed: number
  nonRCA: number
} {
  let completed = 0, nonRCA = 0
  const overdue: Incident[] = []
  const pending: Incident[] = []
  let total = 0
  for (const r of rows) {
    const status = parseRcaStatus(r.rca_status)
    if (status === 'Non-RCA') { nonRCA++; continue }
    total++
    if (status === 'Overdue') overdue.push(r)
    else if (status === 'Pending') pending.push(r)
    else if (status === 'Completed') completed++
  }
  return { total, overdue, pending, completed, nonRCA }
}

export function deptCounts(items: Incident[], pick: (r: Incident) => string | null = (r) => r.action_dept): Map<string, number> {
  return counts(items, pick)
}

export function topNbyDept(items: Incident[], pick: (r: Incident) => string | null, n = 5): { labels: string[]; data: number[] } {
  return sortedTop(counts(items, pick), n)
}

/* Reporting trend by month, per top-N reporting depts */
export function reportingTrend(rows: Incident[], topN = 5): {
  months: string[]
  series: { dept: string; data: number[] }[]
} {
  const psi = rows.filter(isPsi)
  const top = sortedTop(counts(psi, (r) => r.reporting_dept), topN).labels
  const monthSet = new Set<string>()
  for (const r of psi) {
    const k = monthKey(r.incident_month); if (k) monthSet.add(k)
  }
  const months = Array.from(monthSet).sort()
  const monthIdx = new Map(months.map((m, i) => [m, i]))
  const series = top.map((dept) => ({ dept, data: months.map(() => 0) }))
  const seriesIdx = new Map(top.map((d, i) => [d, i]))
  for (const r of psi) {
    const k = monthKey(r.incident_month); if (!k) continue
    const d = (r.reporting_dept ?? '').trim(); if (!seriesIdx.has(d)) continue
    series[seriesIdx.get(d)!].data[monthIdx.get(k)!]++
  }
  return { months: months.map(monthLabel), series }
}

/* IR No → primary dept counts as paired bar (sums per primary dept) for Reporting tab */
export function primaryVsReporting(rows: Incident[], topN = 8): {
  depts: string[]
  primary: number[]
  reporting: number[]
} {
  const psi = rows.filter(isPsi)
  const allDepts = new Set<string>()
  for (const r of psi) {
    if (r.dept_code) allDepts.add(r.dept_code.trim())
    if (r.reporting_dept) allDepts.add(r.reporting_dept.trim())
  }
  // pick depts with most combined activity
  const score = new Map<string, number>()
  for (const d of Array.from(allDepts)) score.set(d, 0)
  for (const r of psi) {
    if (r.dept_code) score.set(r.dept_code.trim(), (score.get(r.dept_code.trim()) ?? 0) + 1)
    if (r.reporting_dept) score.set(r.reporting_dept.trim(), (score.get(r.reporting_dept.trim()) ?? 0) + 1)
  }
  const top = Array.from(score.entries()).sort(([, a], [, b]) => b - a).slice(0, topN).map(([k]) => k)
  const primary = top.map((d) => psi.filter((r) => (r.dept_code ?? '').trim() === d).length)
  const reporting = top.map((d) => psi.filter((r) => (r.reporting_dept ?? '').trim() === d).length)
  return { depts: top, primary, reporting }
}

/* Date helpers */
export function isOverdue(dueIso: string | null, today = new Date()): boolean {
  if (!dueIso) return false
  const due = new Date(dueIso + 'T00:00:00Z')
  if (Number.isNaN(due.getTime())) return false
  return due.getTime() < new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
}

/* Period filtering for report card */
export type PeriodKey =
  | 'YTD'
  | 'M-1' | 'M-2' | 'M-3' | 'M-4'
  | 'Q1' | 'Q2'
  | 'H1' | 'H2'
  | '9M'
  | 'YEAR'

export const PERIOD_OPTIONS: { group: string; options: { value: PeriodKey; label: string }[] }[] = [
  { group: 'Year-to-Date', options: [{ value: 'YTD', label: 'Year-to-Date (All Months)' }] },
  { group: 'Monthly', options: [
    { value: 'M-1', label: 'January 2026' },
    { value: 'M-2', label: 'February 2026' },
    { value: 'M-3', label: 'March 2026' },
    { value: 'M-4', label: 'April 2026' },
  ]},
  { group: 'Quarterly', options: [
    { value: 'Q1', label: 'Q1 2026 (Jan–Mar)' },
    { value: 'Q2', label: 'Q2 2026 (Apr–Jun)' },
  ]},
  { group: '6-Monthly', options: [
    { value: 'H1', label: 'H1 2026 (Jan–Jun)' },
    { value: 'H2', label: 'H2 2026 (Jul–Dec)' },
  ]},
  { group: '9-Monthly', options: [{ value: '9M', label: '9 Months 2026 (Jan–Sep)' }] },
  { group: 'Yearly', options: [{ value: 'YEAR', label: 'Full Year 2026' }] },
]

export function periodLabel(k: PeriodKey): string {
  for (const g of PERIOD_OPTIONS) {
    const o = g.options.find((x) => x.value === k)
    if (o) return o.label
  }
  return k
}

export function periodMonthRange(k: PeriodKey, year = 2026): { from: string; to: string } {
  const fmt = (m: number) => `${year}-${String(m).padStart(2, '0')}`
  switch (k) {
    case 'M-1': return { from: fmt(1), to: fmt(1) }
    case 'M-2': return { from: fmt(2), to: fmt(2) }
    case 'M-3': return { from: fmt(3), to: fmt(3) }
    case 'M-4': return { from: fmt(4), to: fmt(4) }
    case 'Q1': return { from: fmt(1), to: fmt(3) }
    case 'Q2': return { from: fmt(4), to: fmt(6) }
    case 'H1': return { from: fmt(1), to: fmt(6) }
    case 'H2': return { from: fmt(7), to: fmt(12) }
    case '9M': return { from: fmt(1), to: fmt(9) }
    case 'YEAR': case 'YTD': default: return { from: fmt(1), to: fmt(12) }
  }
}

export function filterByPeriod(rows: Incident[], k: PeriodKey): Incident[] {
  const { from, to } = periodMonthRange(k)
  return rows.filter((r) => {
    const m = monthKey(r.incident_month)
    if (!m) return false
    return m >= from && m <= to
  })
}

export const PRIMARY_DEPTS = ['MED','O&G','ED','SURG','ORTHO','PAEDS','CVTS','CARDIO','PCM','ORL','REHAB','PLASTIC','NEPHRO','PSY']
export const ACTION_DEPTS = ['AMO','ANAEST','CDL','DC','NURSING','PHARMACY','RAD','RMCQ']
