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
  severity: string // 'all' | severity name
  careSetting: string // 'all' | setting
  caseStatus: string // 'all' | 'open' | 'closed'
}

export const DEFAULT_FILTERS: IrFilters = {
  month: 'all',
  dept: 'all',
  severity: 'all',
  careSetting: 'all',
  caseStatus: 'all',
}

const monthKey = (iso: string | null): string | null => {
  if (!iso) return null
  return iso.slice(0, 7) // YYYY-MM
}

export function applyFilters(rows: Incident[], f: IrFilters): Incident[] {
  return rows.filter((r) => {
    if (f.month !== 'all' && monthKey(r.incident_month) !== f.month) return false
    if (f.dept !== 'all' && r.dept_code !== f.dept) return false
    if (f.severity !== 'all' && r.severity_real !== f.severity) return false
    if (f.careSetting !== 'all' && r.care_setting !== f.careSetting) return false
    if (f.caseStatus === 'open' && r.case_closed) return false
    if (f.caseStatus === 'closed' && !r.case_closed) return false
    return true
  })
}

export interface SummaryMetrics {
  total: number
  sentinel: number
  open: number
  rcaRequired: number
  iiRequired: number
  nearMiss: number
}

export function summarize(rows: Incident[]): SummaryMetrics {
  let sentinel = 0
  let open = 0
  let rcaRequired = 0
  let iiRequired = 0
  let nearMiss = 0
  for (const r of rows) {
    if (r.sentinel) sentinel++
    if (!r.case_closed) open++
    if ((r.is_rca ?? 0) > 0) rcaRequired++
    if ((r.is_ii ?? 0) > 0) iiRequired++
    if ((r.incident_type ?? '').trim().toUpperCase() === 'NEAR MISS') nearMiss++
  }
  return { total: rows.length, sentinel, open, rcaRequired, iiRequired, nearMiss }
}

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthlyTrend(rows: Incident[]): { labels: string[]; data: number[] } {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = monthKey(r.incident_month)
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const sorted = Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b))
  return {
    labels: sorted.map(([k]) => {
      const [y, m] = k.split('-')
      return `${MONTH_LABEL[parseInt(m, 10) - 1]} '${y.slice(2)}`
    }),
    data: sorted.map(([, v]) => v),
  }
}

const SEVERITY_ORDER = ['LOW', 'MODERATE', 'MAJOR', 'CATASTROPHIC'] as const

export function severityDistribution(rows: Incident[]): {
  labels: string[]
  data: number[]
  colors: string[]
} {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = (r.severity_real ?? 'UNKNOWN').toUpperCase()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const ordered = [
    ...SEVERITY_ORDER.filter((s) => counts.has(s)),
    ...Array.from(counts.keys()).filter((k) => !SEVERITY_ORDER.includes(k as typeof SEVERITY_ORDER[number])),
  ]
  return {
    labels: ordered,
    data: ordered.map((k) => counts.get(k) ?? 0),
    colors: ordered.map((k) => severityHex(k)),
  }
}

export function severityHex(sev: string): string {
  const s = (sev || '').toUpperCase()
  if (s === 'LOW') return '#639922'
  if (s === 'MODERATE') return '#EF9F27'
  if (s === 'MAJOR') return '#E24B4A'
  if (s === 'CATASTROPHIC') return '#534AB7'
  return '#888780'
}

export function topDepartments(rows: Incident[], n = 10): { labels: string[]; data: number[] } {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = (r.dept_code ?? 'UNKNOWN').trim()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const sorted = Array.from(counts.entries()).sort(([, a], [, b]) => b - a).slice(0, n)
  return { labels: sorted.map(([k]) => k), data: sorted.map(([, v]) => v) }
}

export function categoryBreakdown(rows: Incident[], n = 10): { labels: string[]; data: number[] } {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = (r.category ?? 'UNKNOWN').trim()
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const sorted = Array.from(counts.entries()).sort(([, a], [, b]) => b - a).slice(0, n)
  return { labels: sorted.map(([k]) => k), data: sorted.map(([, v]) => v) }
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
  return Array.from(set).sort().map((k) => {
    const [y, m] = k.split('-')
    return { value: k, label: `${MONTH_LABEL[parseInt(m, 10) - 1]} ${y}` }
  })
}

export function isOverdue(dueIso: string | null, today = new Date()): boolean {
  if (!dueIso) return false
  const due = new Date(dueIso + 'T00:00:00Z')
  if (Number.isNaN(due.getTime())) return false
  return due.getTime() < new Date(today.toISOString().slice(0, 10) + 'T00:00:00Z').getTime()
}
