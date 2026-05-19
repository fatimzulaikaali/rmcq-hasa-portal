'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Legend, Filler, Title,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import {
  KpiDefinition, KpiDataRow, KpiSiqRecord, KpiDepartment,
  Frequency, Period, AchievementStatus, FREQUENCIES, PERIODS,
} from '@/lib/kpi/types'
import {
  compliance, deptCompliance, isOverdueDeadline,
  computeAchievement, scheduledPeriodsFor, detectSiqTrigger,
  KpiPeriodKey, KPI_PERIOD_OPTIONS, kpiPeriodLabel, kpiPeriodMonths, fmtDate,
} from '@/lib/kpi/dashboard-helpers'
import { parseKpiWorkbook } from '@/lib/kpi/excel-mapper'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Tooltip, Legend, Filler, Title)

type TabId =
  | 'overview' | 'by-dept' | 'compliance' | 'achievement'
  | 'performance' | 'siq' | 'kpi-list' | 'report-card' | 'upload'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',    label: 'Overview',             icon: '📊' },
  { id: 'by-dept',     label: 'By Department',        icon: '🏢' },
  { id: 'compliance',  label: 'Submission Compliance',icon: '📅' },
  { id: 'achievement', label: 'Achievement',          icon: '🎯' },
  { id: 'performance', label: 'Performance Grid',     icon: '📈' },
  { id: 'siq',         label: 'SIQ Tracker',          icon: '⚠️' },
  { id: 'kpi-list',    label: 'KPI List',             icon: '📋' },
  { id: 'report-card', label: 'Report Card',          icon: '📄' },
  { id: 'upload',      label: 'Upload Workbook',      icon: '⬆' },
]

interface KpiFilters {
  year: number
  dept: string
  frequency: string
  period: string
  achievement: string
}
const DEFAULT_FILTERS: KpiFilters = {
  year: 2026, dept: 'all', frequency: 'all', period: 'all', achievement: 'all',
}

const PAGE_SIZE = 25

export default function KpiPage() {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [defs, setDefs] = useState<KpiDefinition[] | null>(null)
  const [data, setData] = useState<KpiDataRow[] | null>(null)
  const [siq, setSiq] = useState<KpiSiqRecord[] | null>(null)
  const [depts, setDepts] = useState<KpiDepartment[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<KpiFilters>(DEFAULT_FILTERS)
  const [tab, setTab] = useState<TabId>('overview')
  const [refreshTick, setRefreshTick] = useState(0)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // initial fetch + on refresh
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    // PostgREST silently caps SELECT responses at 1000 rows by default (Supabase cloud).
    // To avoid losing data, fetch in explicit 1000-row pages and concat.
    async function fetchAll<T>(table: string): Promise<T[]> {
      const PAGE = 1000
      const acc: T[] = []
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .range(offset, offset + PAGE - 1)
        if (error) throw new Error(`${table}: ${error.message}`)
        if (!data || data.length === 0) break
        acc.push(...(data as T[]))
        if (data.length < PAGE) break
      }
      return acc
    }
    ;(async () => {
      try {
        // Module access gate — dept-scoped Risk users get bounced to /risk
        const access = await getModuleAccess(supabase)
        if (!access.allModules) {
          router.replace('/risk')
          return
        }

        const [allDefsRaw, allData, allSiq, allDepts] = await Promise.all([
          fetchAll<KpiDefinition>('kpi_definitions'),
          fetchAll<KpiDataRow>('kpi_data'),
          fetchAll<KpiSiqRecord>('kpi_siq_records'),
          fetchAll<KpiDepartment>('kpi_departments'),
        ])
        if (cancelled) return
        // Only show KPIs marked active. Use `?? true` so rows missing an active flag default to active.
        setDefs(allDefsRaw.filter((d) => d.active ?? true))
        setData(allData)
        setSiq(allSiq)
        setDepts(allDepts)
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load KPI data')
      }
    })()
    return () => { cancelled = true }
  }, [refreshTick])

  const loading = defs == null || data == null || siq == null || depts == null
  const filteredDefs = useMemo(() => {
    if (!defs) return []
    return defs.filter((d) => {
      if (filters.dept !== 'all' && d.dept_code !== filters.dept) return false
      if (filters.frequency !== 'all' && d.frequency !== filters.frequency) return false
      return true
    })
  }, [defs, filters])

  const filteredData = useMemo(() => {
    if (!data) return []
    return data.filter((r) => {
      if (r.year !== filters.year) return false
      if (filters.period !== 'all' && r.period !== filters.period) return false
      // dept/frequency filters apply via the def lookup
      return true
    })
  }, [data, filters])

  const deptOptions = useMemo(() => {
    if (!defs) return []
    const set = new Set<string>()
    for (const d of defs) if (d.dept_code) set.add(d.dept_code)
    return Array.from(set).sort()
  }, [defs])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">📊 KPI Monitor</div>
          <div className="sb-sub">Performance Indicators 2026</div>
        </div>

        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/ir" className="nav-item">
            <span className="nav-icon">🩺</span>
            <span>IR Dashboard</span>
          </Link>
          <Link href="/pscs" className="nav-item">
            <span className="nav-icon">🛡️</span>
            <span>Safety Culture</span>
          </Link>
          <Link href="/risk" className="nav-item">
            <span className="nav-icon">⚠️</span>
            <span>Risk Register</span>
          </Link>
        </div>

        <div className="sb-filters">
          <div className="sf-lbl">🔎 Filters</div>
          <FilterSelect
            label="Year"
            value={String(filters.year)}
            onChange={(v) => setFilters({ ...filters, year: parseInt(v, 10) })}
            options={[{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }]}
          />
          <FilterSelect
            label="Department"
            value={filters.dept}
            onChange={(v) => setFilters({ ...filters, dept: v })}
            options={[{ value: 'all', label: 'All Departments' }, ...deptOptions.map((v) => ({ value: v, label: v }))]}
          />
          <FilterSelect
            label="Frequency"
            value={filters.frequency}
            onChange={(v) => setFilters({ ...filters, frequency: v })}
            options={[{ value: 'all', label: 'All Frequencies' }, ...FREQUENCIES.map((f) => ({ value: f, label: f }))]}
          />
          <FilterSelect
            label="Period"
            value={filters.period}
            onChange={(v) => setFilters({ ...filters, period: v })}
            options={[{ value: 'all', label: 'All Periods' }, ...PERIODS.map((p) => ({ value: p, label: p }))]}
          />
          <FilterSelect
            label="Achievement"
            value={filters.achievement}
            onChange={(v) => setFilters({ ...filters, achievement: v })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Achieved', label: 'Achieved' },
              { value: 'Not Achieved', label: 'Not Achieved' },
              { value: 'No Data', label: 'No Data' },
              { value: 'Not Applicable', label: 'Not Applicable' },
            ]}
          />
          <button className="reset-btn" onClick={() => setFilters(DEFAULT_FILTERS)} type="button">
            ↺ Reset Filters
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="hamburger"
              aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}
            >☰</button>
            <div>
              <div className="tb-title">Performance Indicators Dashboard {filters.year}</div>
              <div className="tb-meta">Hospital Al-Sultan Abdullah UiTM · RMCQ</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="rec-badge">
              {loading ? 'Loading…' : `${filteredDefs.length.toLocaleString()} KPI${filteredDefs.length === 1 ? '' : 's'}`}
            </div>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <nav className="tab-nav">
          {TABS.map((t) => (
            <button key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              type="button">
              {t.icon} {t.label}
            </button>
          ))}
        </nav>

        <main className="tab-pane">
          {loadError && (
            <div className="ac red">
              <div className="ai">⚠️</div>
              <div>
                <div className="at">Failed to load KPI data</div>
                <div className="as">{loadError}</div>
              </div>
            </div>
          )}
          {loading && !loadError && <Loader />}
          {!loading && !loadError && (
            <>
              {tab === 'overview'    && <OverviewTab defs={filteredDefs} data={filteredData} siq={siq!} year={filters.year} />}
              {tab === 'by-dept'     && <ByDeptTab defs={filteredDefs} data={filteredData} year={filters.year} />}
              {tab === 'compliance'  && <ComplianceTab defs={filteredDefs} data={filteredData} year={filters.year} />}
              {tab === 'achievement' && <AchievementTab defs={filteredDefs} data={filteredData} year={filters.year} achievementFilter={filters.achievement} />}
              {tab === 'siq'         && <SiqTab siq={siq!} />}
              {tab === 'kpi-list'    && <KpiListTab defs={filteredDefs} data={filteredData} year={filters.year} achievementFilter={filters.achievement} />}
              {tab === 'report-card' && <ReportCardTab defs={defs!} data={data!} siq={siq!} />}
              {tab === 'upload'      && <UploadTab onUploaded={() => setRefreshTick((t) => t + 1)} />}
              {tab === 'performance' && <PerformanceTab defs={filteredDefs} data={filteredData} year={filters.year} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* =========================================================================
 * Shared primitives
 * ========================================================================= */

function Loader() {
  return (
    <div className="loader">
      <div className="loader-inner">
        <div className="spin" />
        <div>Loading KPI data…</div>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  return (
    <div className="sf-g">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function MetricCard({ tone, label, value, sub }: {
  tone: 'blue'|'red'|'amber'|'green'|'gray'|'teal'|'purple'
  label: string; value: number | string; sub?: string
}) {
  return (
    <div className={`mc ${tone}`}>
      <div className="ml">{label}</div>
      <div className="mv">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="ms">{sub}</div>}
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="pf">
        <div>
          <div className="pt">{title}</div>
          {subtitle && <div className="psub">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

function FreqBadge({ freq }: { freq: Frequency }) {
  const tone = freq === 'Monthly' ? 'blue' : freq === 'Quarterly' ? 'teal' : freq === 'Biannual' ? 'amber' : 'purple'
  return <span className={`b b-${tone}`}>{freq}</span>
}

function complianceTone(pct: number): string {
  if (pct >= 80) return 'green'
  if (pct >= 50) return 'amber'
  return 'red'
}


/* =========================================================================
 * TAB — OVERVIEW
 * ========================================================================= */

function OverviewTab({ defs, data, siq, year }: { defs: KpiDefinition[]; data: KpiDataRow[]; siq: KpiSiqRecord[]; year: number }) {
  const today = new Date()

  // Counts
  const kpiCount = defs.length
  const monthly  = defs.filter((d) => d.frequency === 'Monthly').length
  const quarterly= defs.filter((d) => d.frequency === 'Quarterly').length
  const biannual = defs.filter((d) => d.frequency === 'Biannual').length
  const yearly   = defs.filter((d) => d.frequency === 'Yearly').length

  // Aggregate compliance + achievement across all KPIs
  let scheduledDue = 0, submitted = 0, pending = 0
  let achieved = 0, notAchieved = 0, noData = 0, notApplicable = 0
  for (const def of defs) {
    const c = compliance(def, data, year, today)
    scheduledDue += c.scheduledDue
    submitted += c.submitted
    pending += c.pending
    // achievement: across all rows (filtered) for this kpi
    const periods = scheduledPeriodsFor(def.frequency)
    for (const p of periods) {
      const row = data.find((r) => r.kpi_id === def.kpi_id && r.year === year && r.period === p)
      const status = computeAchievement(row?.result ?? null, def.target_operator, def.target_value)
      if (status === 'Achieved') achieved++
      else if (status === 'Not Achieved') notAchieved++
      else if (status === 'Not Applicable') notApplicable++
      else noData++
    }
  }
  const compliancePct = scheduledDue ? Math.round((submitted / scheduledDue) * 100) : 0
  const achievementPct = (achieved + notAchieved) ? Math.round((achieved / (achieved + notAchieved)) * 100) : 0

  // SIQ counts
  const siqOpen = siq.filter((s) => s.status === 'Open' || s.status === 'In Progress' || s.status === 'Pending Department Feedback').length
  const siqClosed = siq.filter((s) => s.status === 'Closed').length

  // Triggered SIQs (computed live from data)
  const liveSiqs = defs.filter((d) => detectSiqTrigger(d, data, year).triggered).length

  // Achievement chart
  const achData = { Achieved: achieved, 'Not Achieved': notAchieved, 'No Data': noData, 'Not Applicable': notApplicable }
  const achColors = ['#3B6D11', '#A32D2D', '#888780', '#B4B2A9']

  // Top problem KPIs (Not Achieved count, descending)
  const problem = defs
    .map((d) => {
      let na = 0
      for (const r of data) {
        if (r.kpi_id !== d.kpi_id || r.year !== year) continue
        if (computeAchievement(r.result, d.target_operator, d.target_value) === 'Not Achieved') na++
      }
      return { def: d, na }
    })
    .filter((p) => p.na > 0)
    .sort((a, b) => b.na - a.na)
    .slice(0, 10)

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue"  label="Total KPIs"          value={kpiCount} />
        <MetricCard tone="teal"  label="Submission Compliance" value={`${compliancePct}%`} sub={`${submitted}/${scheduledDue} due`} />
        <MetricCard tone="green" label="Achievement Rate"    value={`${achievementPct}%`} sub={`${achieved} achieved`} />
        <MetricCard tone="red"   label="Pending Submission"  value={pending} sub="Past 25th deadline" />
        <MetricCard tone="amber" label="Active SIQs"         value={siqOpen} sub={`${siqClosed} closed`} />
        <MetricCard tone="purple" label="Live SIQ Triggers"  value={liveSiqs} sub="From current data" />
      </div>

      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginBottom: 14 }}>
        <MetricCard tone="blue"   label="Monthly KPIs"   value={monthly} />
        <MetricCard tone="teal"   label="Quarterly KPIs" value={quarterly} />
        <MetricCard tone="amber"  label="Biannual KPIs"  value={biannual} />
        <MetricCard tone="purple" label="Yearly KPIs"    value={yearly} />
      </div>

      <div className="g2">
        <Panel title="Achievement Distribution">
          <div style={{ height: 220 }}>
            <Doughnut
              data={{
                labels: Object.keys(achData),
                datasets: [{ data: Object.values(achData), backgroundColor: achColors, borderWidth: 0 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false, cutout: '60%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </div>
        </Panel>

        <Panel title="KPIs by Frequency">
          <div style={{ height: 220 }}>
            <Bar
              data={{
                labels: ['Monthly', 'Quarterly', 'Biannual', 'Yearly'],
                datasets: [{ label: 'KPIs', data: [monthly, quarterly, biannual, yearly], backgroundColor: ['#185FA5', '#1D9E75', '#EF9F27', '#534AB7'], borderRadius: 4 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                  x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </Panel>
      </div>

      <Panel title="Top Problem KPIs (Most 'Not Achieved')">
        {problem.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>All KPIs on track ✓</div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>KPI ID</th><th>Department</th><th>KPI</th><th>Frequency</th><th>Not Achieved</th>
                </tr>
              </thead>
              <tbody>
                {problem.map((p) => (
                  <tr key={p.def.kpi_id}>
                    <td style={{ fontFamily: 'monospace' }}>{p.def.kpi_id}</td>
                    <td>{p.def.dept_code}</td>
                    <td>{p.def.kpi_name}</td>
                    <td><FreqBadge freq={p.def.frequency} /></td>
                    <td><span className="b b-red">{p.na}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB — BY DEPARTMENT
 * ========================================================================= */

function ByDeptTab({ defs, data, year }: { defs: KpiDefinition[]; data: KpiDataRow[]; year: number }) {
  const today = new Date()
  const deptSet = new Set<string>(); defs.forEach((d) => deptSet.add(d.dept_code))
  const byDept = Array.from(deptSet).map((dc) => {
    const c = deptCompliance(defs, data, dc, year, today)
    return { dept: dc, ...c }
  }).sort((a, b) => b.kpiCount - a.kpiCount)

  return (
    <>
      <Panel title="Department KPI Compliance" subtitle="Submission compliance per dept (only periods past 25th deadline)">
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Department</th>
                <th>KPIs</th>
                <th>Due</th>
                <th>Submitted</th>
                <th>Pending</th>
                <th>Compliance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {byDept.map((d) => (
                <tr key={d.dept}>
                  <td style={{ fontWeight: 600 }}>{d.dept}</td>
                  <td>{d.kpiCount}</td>
                  <td>{d.scheduledDue}</td>
                  <td>{d.submitted}</td>
                  <td>{d.pending > 0 ? <span className="b b-red">{d.pending}</span> : 0}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 80, height: 8, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${d.pct}%`, height: '100%', background: d.pct >= 80 ? 'var(--green-md)' : d.pct >= 50 ? 'var(--amber-md)' : 'var(--red-md)' }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: d.pct >= 80 ? 'var(--green)' : d.pct >= 50 ? 'var(--amber)' : 'var(--red)' }}>{d.pct}%</span>
                    </div>
                  </td>
                  <td>
                    <span className={`b b-${complianceTone(d.pct)}`}>
                      {d.pct >= 80 ? 'On Track' : d.pct >= 50 ? 'At Risk' : 'Critical'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB — SUBMISSION COMPLIANCE
 * ========================================================================= */

function ComplianceTab({ defs, data, year }: { defs: KpiDefinition[]; data: KpiDataRow[]; year: number }) {
  const today = useMemo(() => new Date(), [])
  const [search, setSearch] = useState('')

  // Roll-up per dept
  const deptStats = useMemo(() => {
    const acc = new Map<string, { kpis: number; due: number; submitted: number; pending: number }>()
    for (const def of defs) {
      const e = acc.get(def.dept_code) ?? { kpis: 0, due: 0, submitted: 0, pending: 0 }
      e.kpis++
      const periods = scheduledPeriodsFor(def.frequency)
      for (const p of periods) {
        if (!isOverdueDeadline(year, p, today)) continue
        e.due++
        const r = data.find((x) => x.kpi_id === def.kpi_id && x.year === year && x.period === p)
        if (r && r.result) e.submitted++
        else e.pending++
      }
      acc.set(def.dept_code, e)
    }
    return Array.from(acc.entries())
      .map(([dept, s]) => ({ dept, ...s, pct: s.due ? Math.round((s.submitted / s.due) * 100) : 100 }))
      // Critical first (lowest pct), then by absolute pending count
      .sort((a, b) => (a.pct - b.pct) || (b.pending - a.pending))
  }, [defs, data, year, today])

  // KPIs that have at least one overdue period — for the grid below
  const overdueDefs = useMemo(() => {
    const filtered = defs.filter((def) => {
      const periods = scheduledPeriodsFor(def.frequency)
      for (const p of periods) {
        if (!isOverdueDeadline(year, p, today)) continue
        const r = data.find((x) => x.kpi_id === def.kpi_id && x.year === year && x.period === p)
        if (!r || !r.result) return true
      }
      return false
    })
    if (!search.trim()) return filtered
    const q = search.trim().toLowerCase()
    return filtered.filter((d) => `${d.kpi_id} ${d.dept_code} ${d.kpi_name}`.toLowerCase().includes(q))
  }, [defs, data, year, today, search])

  const dataByKey = useMemo(() => {
    const m = new Map<string, KpiDataRow>()
    for (const r of data) m.set(`${r.kpi_id}|${r.year}|${r.period}`, r)
    return m
  }, [data])

  // Hospital totals
  const total = deptStats.reduce((s, d) => s + d.due, 0)
  const submittedTotal = deptStats.reduce((s, d) => s + d.submitted, 0)
  const pendingTotal = deptStats.reduce((s, d) => s + d.pending, 0)
  const overallPct = total ? Math.round((submittedTotal / total) * 100) : 0

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue"  label="Past Deadline"      value={total} sub="Periods due" />
        <MetricCard tone="green" label="Submitted"          value={submittedTotal} />
        <MetricCard tone="red"   label="Overdue (No Data)"  value={pendingTotal} />
        <MetricCard tone={overallPct >= 80 ? 'green' : overallPct >= 50 ? 'amber' : 'red'} label="Overall On-time %" value={`${overallPct}%`} />
      </div>

      <Panel title="🚨 Overdue Submission — by Department" subtitle="Worst compliance first · click a dept name to filter the grid below">
        {deptStats.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No data.</div>
        ) : (
          <div className="dept-compliance-grid">
            {deptStats.map((d) => {
              const tone = d.pct >= 80 ? 'green' : d.pct >= 50 ? 'amber' : 'red'
              const hex = tone === 'green' ? '#3B6D11' : tone === 'amber' ? '#854F0B' : '#A32D2D'
              const bg  = tone === 'green' ? '#EAF3DE' : tone === 'amber' ? '#FAEEDA' : '#FCEBEB'
              return (
                <button
                  key={d.dept}
                  type="button"
                  onClick={() => setSearch(d.dept)}
                  className="dept-comp-card"
                  style={{ background: bg, color: hex, borderColor: hex }}
                  title={`Click to filter overdue grid below to ${d.dept}`}
                >
                  <div className="dc-head">
                    <div className="dc-dept">{d.dept}</div>
                    <div className="dc-pct">{d.due ? `${d.pct}%` : '—'}</div>
                  </div>
                  <div className="dc-bar"><div className="dc-bar-fill" style={{ width: `${d.due ? d.pct : 0}%`, background: hex }} /></div>
                  <div className="dc-stats">
                    <span><b>{d.kpis}</b> KPIs</span>
                    <span><b>{d.submitted}</b> submitted</span>
                    <span style={{ color: d.pending > 0 ? hex : 'inherit', fontWeight: d.pending > 0 ? 700 : 400 }}>
                      <b>{d.pending}</b> pending
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="🗓️ Overdue Submission Details"
        subtitle={`${overdueDefs.length} KPI${overdueDefs.length === 1 ? '' : 's'} with at least one overdue period · cells: ! = overdue, value = submitted, — = not yet due, × = not scheduled`}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by KPI ID, dept, or name… (or click a dept card above)"
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, width: 380, fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 11 }}>
              Clear filter
            </button>
          )}
          <PerfLegend />
        </div>

        {overdueDefs.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12, padding: 12 }}>
            {search ? 'No overdue KPIs match your search.' : 'All due submissions are in ✓'}
          </div>
        ) : (
          <div className="tw" style={{ overflowX: 'auto' }}>
            <table className="kpi-grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 200, maxWidth: 240 }}>KPI</th>
                  <th style={{ minWidth: 50 }}>Dept</th>
                  <th style={{ minWidth: 56 }}>Target</th>
                  {PERIODS.map((p) => <th key={p} style={{ textAlign: 'center', minWidth: 38 }}>{p}</th>)}
                  <th style={{ textAlign: 'center', minWidth: 60 }}>Compl.</th>
                </tr>
              </thead>
              <tbody>
                {overdueDefs.slice(0, 100).map((d) => {
                  const scheduled = new Set(scheduledPeriodsFor(d.frequency))
                  const c = compliance(d, data, year, today)
                  return (
                    <tr key={d.kpi_id}>
                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>{d.kpi_id}</span>
                          <FreqBadge freq={d.frequency} />
                        </div>
                        <div title={d.kpi_name} style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}>{d.kpi_name}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>{d.dept_code}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.target ?? '—'}</td>
                      {PERIODS.map((p) => (
                        <PerfCell
                          key={p}
                          def={d}
                          year={year}
                          period={p}
                          scheduled={scheduled.has(p)}
                          row={dataByKey.get(`${d.kpi_id}|${year}|${p}`)}
                          today={today}
                        />
                      ))}
                      <td style={{ textAlign: 'center' }}>
                        {c.scheduledDue ? (
                          <span className={`b b-${complianceTone(c.pct)}`}>{c.pct}%</span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {overdueDefs.length > 100 && (
                  <tr><td colSpan={16} style={{ color: 'var(--muted)', textAlign: 'center', padding: 8 }}>… and {overdueDefs.length - 100} more — refine the search to see them all</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB — ACHIEVEMENT
 * ========================================================================= */

function AchievementTab({ defs, data, year, achievementFilter }: { defs: KpiDefinition[]; data: KpiDataRow[]; year: number; achievementFilter: string }) {
  const today = useMemo(() => new Date(), [])
  const [search, setSearch] = useState('')

  // Status counts across all (KPI x scheduled period) cells
  const counts: Record<AchievementStatus, number> = { Achieved: 0, 'Not Achieved': 0, 'No Data': 0, 'Not Applicable': 0 }
  // Heatmap: not-achieved count per dept
  const notAchievedByDept = new Map<string, number>()
  for (const def of defs) {
    const periods = scheduledPeriodsFor(def.frequency)
    for (const p of periods) {
      const r = data.find((x) => x.kpi_id === def.kpi_id && x.year === year && x.period === p)
      const status = computeAchievement(r?.result ?? null, def.target_operator, def.target_value)
      counts[status]++
      if (status === 'Not Achieved') notAchievedByDept.set(def.dept_code, (notAchievedByDept.get(def.dept_code) ?? 0) + 1)
    }
  }
  const dHeat = Array.from(notAchievedByDept.entries()).sort(([, a], [, b]) => b - a)

  // KPIs to show in the grid:
  // - if sidebar achievement filter set to a specific status → use that
  // - otherwise default to 'Not Achieved' (since Performance Grid covers the all-status case)
  const effectiveFilter = achievementFilter === 'all' ? 'Not Achieved' : achievementFilter
  const filteredDefs = useMemo(() => {
    const pool = defs.filter((def) => {
      const periods = scheduledPeriodsFor(def.frequency)
      for (const p of periods) {
        const r = data.find((x) => x.kpi_id === def.kpi_id && x.year === year && x.period === p)
        const status = computeAchievement(r?.result ?? null, def.target_operator, def.target_value)
        if (status === effectiveFilter) return true
      }
      return false
    })
    if (!search.trim()) return pool
    const q = search.trim().toLowerCase()
    return pool.filter((d) => `${d.kpi_id} ${d.dept_code} ${d.kpi_name}`.toLowerCase().includes(q))
  }, [defs, data, year, effectiveFilter, search])

  const dataByKey = useMemo(() => {
    const m = new Map<string, KpiDataRow>()
    for (const r of data) m.set(`${r.kpi_id}|${r.year}|${r.period}`, r)
    return m
  }, [data])

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="green" label="Achieved"        value={counts.Achieved} />
        <MetricCard tone="red"   label="Not Achieved"    value={counts['Not Achieved']} />
        <MetricCard tone="gray"  label="No Data"         value={counts['No Data']} />
        <MetricCard tone="gray"  label="Not Applicable"  value={counts['Not Applicable']} />
      </div>

      <Panel title="🚨 &apos;Not Achieved&apos; by Department" subtitle="Click a dept card to filter the grid below">
        {dHeat.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>No &apos;Not Achieved&apos; results ✓</div>
        ) : (
          <div className="dept-heat">
            {dHeat.map(([d, n]) => (
              <button
                type="button"
                className="dh-cell dh-red"
                key={d}
                onClick={() => setSearch(d)}
                style={{ cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                title={`Click to filter grid below to ${d}`}
              >
                <div className="dh-dept">{d}</div>
                <div className="dh-num">{n}</div>
                <div className="dh-label">Not Achieved</div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="🎯 Achievement Details"
        subtitle={`${filteredDefs.length} KPI${filteredDefs.length === 1 ? '' : 's'} with at least one '${effectiveFilter}' period · cells colored by achievement status${achievementFilter === 'all' ? ' · use sidebar filter to view other statuses' : ''}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by KPI ID, dept, or name… (or click a dept card above)"
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, width: 380, fontFamily: 'inherit' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 11 }}>
              Clear filter
            </button>
          )}
          <PerfLegend />
        </div>

        {filteredDefs.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, padding: 12 }}>No KPIs match.</div>
        ) : (
          <div className="tw" style={{ overflowX: 'auto' }}>
            <table className="kpi-grid">
              <thead>
                <tr>
                  <th style={{ minWidth: 200, maxWidth: 240 }}>KPI</th>
                  <th style={{ minWidth: 50 }}>Dept</th>
                  <th style={{ minWidth: 56 }}>Target</th>
                  {PERIODS.map((p) => <th key={p} style={{ textAlign: 'center', minWidth: 38 }}>{p}</th>)}
                  <th style={{ textAlign: 'center', minWidth: 60 }}>Compl.</th>
                </tr>
              </thead>
              <tbody>
                {filteredDefs.slice(0, 100).map((d) => {
                  const scheduled = new Set(scheduledPeriodsFor(d.frequency))
                  const c = compliance(d, data, year, today)
                  return (
                    <tr key={d.kpi_id}>
                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>{d.kpi_id}</span>
                          <FreqBadge freq={d.frequency} />
                        </div>
                        <div title={d.kpi_name} style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}>{d.kpi_name}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>{d.dept_code}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.target ?? '—'}</td>
                      {PERIODS.map((p) => (
                        <PerfCell
                          key={p}
                          def={d}
                          year={year}
                          period={p}
                          scheduled={scheduled.has(p)}
                          row={dataByKey.get(`${d.kpi_id}|${year}|${p}`)}
                          today={today}
                        />
                      ))}
                      <td style={{ textAlign: 'center' }}>
                        {c.scheduledDue ? (
                          <span className={`b b-${complianceTone(c.pct)}`}>{c.pct}%</span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filteredDefs.length > 100 && (
                  <tr><td colSpan={16} style={{ color: 'var(--muted)', textAlign: 'center', padding: 8 }}>… and {filteredDefs.length - 100} more — refine the search to see them all</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB — SIQ TRACKER
 * ========================================================================= */

function SiqTab({ siq }: { siq: KpiSiqRecord[] }) {
  // Stored SIQ records
  const open = siq.filter((s) => s.status === 'Open' || s.status === 'In Progress' || s.status === 'Pending Department Feedback')
  const closed = siq.filter((s) => s.status === 'Closed')

  const today = new Date()

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="amber" label="Open SIQs"         value={open.length} />
        <MetricCard tone="green" label="Closed SIQs"       value={closed.length} />
        <MetricCard tone="blue"  label="Total SIQ Records" value={siq.filter((s) => s.siq_id).length} />
      </div>

      <Panel title="Open SIQs" subtitle="From SIQ_Tracker workbook sheet">
        {open.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No open SIQs.</div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>SIQ ID</th><th>KPI ID</th><th>Dept</th><th>KPI</th><th>Frequency</th>
                  <th>Trigger Period</th><th>Date Issued</th><th>Due</th><th>Risk</th><th>Owner</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {open.map((s) => {
                  const overdue = s.due_date && new Date(s.due_date) < today
                  return (
                    <tr key={s.id}>
                      <td style={{ fontFamily: 'monospace' }}>{s.siq_id ?? '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{s.kpi_id ?? '—'}</td>
                      <td>{s.dept_code ?? '—'}</td>
                      <td title={s.kpi_name ?? ''} style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.kpi_name ?? '—'}</td>
                      <td>{s.frequency ?? '—'}</td>
                      <td>{s.trigger_period ?? '—'}</td>
                      <td>{fmtDate(s.date_issued)}</td>
                      <td className={overdue ? 'b b-red' : ''}>{fmtDate(s.due_date)}</td>
                      <td>{s.risk_level ? <span className={`b b-${s.risk_level === 'Extreme' ? 'red' : s.risk_level === 'High' ? 'red' : s.risk_level === 'Moderate' ? 'amber' : 'gray'}`}>{s.risk_level}</span> : '—'}</td>
                      <td>{s.owner ?? '—'}</td>
                      <td><span className={`b b-${s.status === 'Closed' ? 'green' : s.status === 'In Progress' ? 'blue' : 'amber'}`}>{s.status}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Closed SIQs">
        {closed.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No closed SIQs.</div>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>SIQ ID</th><th>KPI ID</th><th>Dept</th><th>Closure Date</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontFamily: 'monospace' }}>{s.siq_id ?? '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{s.kpi_id ?? '—'}</td>
                    <td>{s.dept_code ?? '—'}</td>
                    <td>{fmtDate(s.closure_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB — KPI LIST
 * ========================================================================= */

function KpiListTab({ defs, data, year, achievementFilter }: { defs: KpiDefinition[]; data: KpiDataRow[]; year: number; achievementFilter: string }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { setPage(1) }, [search, achievementFilter])

  const q = search.trim().toLowerCase()
  const enriched = useMemo(() => {
    const today = new Date()
    return defs.map((d) => {
    const c = compliance(d, data, year, today)
    const t = detectSiqTrigger(d, data, year)
    // overall achievement: count Achieved / Total Reported (Achieved+NotAchieved)
    let ach = 0, nach = 0
    const periods = scheduledPeriodsFor(d.frequency)
    for (const p of periods) {
      const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
      const s = computeAchievement(r?.result ?? null, d.target_operator, d.target_value)
      if (s === 'Achieved') ach++
      else if (s === 'Not Achieved') nach++
    }
    return { def: d, comp: c, siq: t, ach, nach }
  })
  }, [defs, data, year])

  const filtered = enriched
    .filter(({ def, ach, nach }) => {
      if (q && !`${def.kpi_id} ${def.dept_code} ${def.kpi_name}`.toLowerCase().includes(q)) return false
      if (achievementFilter === 'Achieved' && ach === 0) return false
      if (achievementFilter === 'Not Achieved' && nach === 0) return false
      if (achievementFilter === 'No Data' && ach + nach > 0) return false
      return true
    })
    .sort((a, b) => a.def.kpi_id.localeCompare(b.def.kpi_id, undefined, { numeric: true }))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const slice = filtered.slice(start, start + PAGE_SIZE)

  return (
    <Panel title="KPI List" subtitle={`Showing ${filtered.length === 0 ? 0 : start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`}>
      <div style={{ marginBottom: 8 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search KPI ID, dept, or name…"
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, width: 320, fontFamily: 'inherit' }}
        />
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>KPI ID</th><th>Dept</th><th>KPI</th><th>Freq</th><th>Target</th>
              <th>Achieved</th><th>Not Achieved</th><th>Compliance</th><th>SIQ</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(({ def, comp, siq, ach, nach }) => (
              <tr key={def.kpi_id}>
                <td style={{ fontFamily: 'monospace' }}>{def.kpi_id}</td>
                <td>{def.dept_code}</td>
                <td title={def.kpi_name} style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.kpi_name}</td>
                <td><FreqBadge freq={def.frequency} /></td>
                <td>{def.target ?? '—'}</td>
                <td>{ach > 0 ? <span className="b b-green">{ach}</span> : '—'}</td>
                <td>{nach > 0 ? <span className="b b-red">{nach}</span> : '—'}</td>
                <td>
                  <span className={`b b-${complianceTone(comp.pct)}`}>
                    {comp.scheduledDue ? `${comp.pct}% (${comp.submitted}/${comp.scheduledDue})` : 'Not yet due'}
                  </span>
                </td>
                <td>{siq.triggered ? <span className="b b-amber">Triggered</span> : '—'}</td>
              </tr>
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>No KPIs match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10, fontSize: 11 }}>
        <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
          style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }}>Prev</button>
        <span style={{ color: 'var(--muted)' }}>Page {safePage} of {totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
          style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }}>Next</button>
      </div>
    </Panel>
  )
}

/* =========================================================================
 * TAB — PERFORMANCE GRID
 * One row per KPI · 12 month columns · color-coded cells.
 * - Cell shows the result string when submitted
 * - "—" gray = scheduled but not yet due (deadline future)
 * - red empty cell = scheduled, deadline passed, still no data (overdue)
 * - "×" gray = month not scheduled for this KPI (e.g. Yearly only DEC)
 * - Cell tinted green if Achieved, red if Not Achieved
 * ========================================================================= */

function PerformanceTab({ defs, data, year }: { defs: KpiDefinition[]; data: KpiDataRow[]; year: number }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PER_PAGE = 30
  useEffect(() => { setPage(1) }, [search, defs])
  const today = useMemo(() => new Date(), [])

  const dataByKey = useMemo(() => {
    const m = new Map<string, KpiDataRow>()
    for (const r of data) m.set(`${r.kpi_id}|${r.year}|${r.period}`, r)
    return m
  }, [data])

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => defs
    .filter((d) => !q || `${d.kpi_id} ${d.dept_code} ${d.kpi_name}`.toLowerCase().includes(q))
    .sort((a, b) => a.kpi_id.localeCompare(b.kpi_id, undefined, { numeric: true })),
  [defs, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PER_PAGE
  const slice = filtered.slice(start, start + PER_PAGE)

  return (
    <Panel
      title="KPI Performance Grid"
      subtitle={`Showing ${filtered.length === 0 ? 0 : start + 1}–${Math.min(start + PER_PAGE, filtered.length)} of ${filtered.length} KPIs · ${year}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search KPI ID, dept, or name…"
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, width: 320, fontFamily: 'inherit' }}
        />
        <PerfLegend />
      </div>

      <div className="tw" style={{ overflowX: 'auto' }}>
        <table className="kpi-grid">
          <thead>
            <tr>
              <th style={{ minWidth: 200, maxWidth: 240 }}>KPI</th>
              <th style={{ minWidth: 50 }}>Dept</th>
              <th style={{ minWidth: 56 }}>Target</th>
              {PERIODS.map((p) => <th key={p} style={{ textAlign: 'center', minWidth: 38 }}>{p}</th>)}
              <th style={{ textAlign: 'center', minWidth: 60 }}>Compl.</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((d) => {
              const scheduled = new Set(scheduledPeriodsFor(d.frequency))
              const c = compliance(d, data, year, today)
              return (
                <tr key={d.kpi_id}>
                  <td>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{d.kpi_id}</span>
                      <FreqBadge freq={d.frequency} />
                    </div>
                    <div title={d.kpi_name} style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.3 }}>{d.kpi_name}</div>
                  </td>
                  <td style={{ fontSize: 11 }}>{d.dept_code}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{d.target ?? '—'}</td>
                  {PERIODS.map((p) => (
                    <PerfCell
                      key={p}
                      def={d}
                      year={year}
                      period={p}
                      scheduled={scheduled.has(p)}
                      row={dataByKey.get(`${d.kpi_id}|${year}|${p}`)}
                      today={today}
                    />
                  ))}
                  <td style={{ textAlign: 'center' }}>
                    {c.scheduledDue ? (
                      <span className={`b b-${complianceTone(c.pct)}`}>{c.pct}%</span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr><td colSpan={16} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>No KPIs match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10, fontSize: 11 }}>
        <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}
          style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }}>Prev</button>
        <span style={{ color: 'var(--muted)' }}>Page {safePage} of {totalPages}</span>
        <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}
          style={{ padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--rs)' }}>Next</button>
      </div>
    </Panel>
  )
}

function PerfCell({
  def, year, period, scheduled, row, today,
}: {
  def: KpiDefinition; year: number; period: Period; scheduled: boolean
  row: KpiDataRow | undefined; today: Date
}) {
  // Not scheduled — × gray
  if (!scheduled) {
    return (
      <td style={{ textAlign: 'center', background: '#F1EFE8', color: '#888780', fontSize: 11 }}>
        <span title="Not scheduled">×</span>
      </td>
    )
  }

  const overdue = isOverdueDeadline(year, period, today)
  const hasResult = row && row.result !== null && row.result !== ''

  // Submitted — show result, color by achievement
  if (hasResult) {
    const status = computeAchievement(row!.result, def.target_operator, def.target_value)
    if (status === 'Achieved') {
      return (
        <td style={{ textAlign: 'center', background: '#EAF3DE', color: '#3B6D11', fontWeight: 700, fontSize: 11 }}>
          <span title={`Achieved: ${row!.result}`}>{row!.result}</span>
        </td>
      )
    }
    if (status === 'Not Achieved') {
      return (
        <td style={{ textAlign: 'center', background: '#FCEBEB', color: '#A32D2D', fontWeight: 700, fontSize: 11 }}>
          <span title={`Not Achieved: ${row!.result} (target ${def.target ?? ''})`}>{row!.result}</span>
        </td>
      )
    }
    if (status === 'Not Applicable') {
      return (
        <td style={{ textAlign: 'center', background: '#F1EFE8', color: '#5F5E5A', fontSize: 11 }}>
          <span title="Not Applicable">N/A</span>
        </td>
      )
    }
    // No Data fallback (unparseable result string)
    return (
      <td style={{ textAlign: 'center', color: '#5F5E5A', fontSize: 11 }}>
        <span title={`Result: ${row!.result}`}>{row!.result}</span>
      </td>
    )
  }

  // Scheduled & overdue, no data — red empty
  if (overdue) {
    return (
      <td style={{ textAlign: 'center', background: '#FCEBEB', color: '#A32D2D', fontWeight: 700, fontSize: 13 }}>
        <span title="Overdue — no data submitted">!</span>
      </td>
    )
  }

  // Scheduled but not yet due — gray dash
  return (
    <td style={{ textAlign: 'center', color: '#888780', fontSize: 13 }}>
      <span title="Not yet due">—</span>
    </td>
  )
}

function PerfLegend() {
  const Item = ({ bg, fg, txt, label }: { bg: string; fg: string; txt: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
      <span style={{ background: bg, color: fg, fontWeight: 700, padding: '1px 6px', borderRadius: 4, minWidth: 28, textAlign: 'center' }}>{txt}</span>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Item bg="#EAF3DE" fg="#3B6D11" txt="✓" label="Achieved" />
      <Item bg="#FCEBEB" fg="#A32D2D" txt="!" label="Not achieved / Overdue" />
      <Item bg="transparent" fg="#888780" txt="—" label="Not yet due" />
      <Item bg="#F1EFE8" fg="#888780" txt="×" label="Not scheduled" />
    </div>
  )
}

/* =========================================================================
 * TAB — UPLOAD WORKBOOK
 * ========================================================================= */

interface UploadResult {
  departments: number
  definitions: number
  data: number
  siq: number
  errors: string[]
}

function UploadTab({ onUploaded }: { onUploaded: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const fileRef = useState<HTMLInputElement | null>(null)[0]
  const [filename, setFilename] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ReturnType<typeof parseKpiWorkbook> | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  async function handleFile(f: File) {
    setError(null)
    setResult(null)
    setParsed(null)
    setFilename(f.name)
    setParsing(true)
    try {
      const buf = await f.arrayBuffer()
      const out = parseKpiWorkbook(buf)
      setParsed(out)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to parse workbook')
    } finally {
      setParsing(false)
    }
  }

  async function importNow() {
    if (!parsed) return
    setError(null)
    setResult(null)
    setImporting(true)
    try {
      const errs: string[] = []

      // 1. Departments — upsert by dept_code
      if (parsed.departments.length > 0) {
        const { error: e } = await supabase.from('kpi_departments').upsert(parsed.departments, { onConflict: 'dept_code' })
        if (e) errs.push(`kpi_departments: ${e.message}`)
      }

      // 2. Definitions — upsert by kpi_id
      // Insert in chunks
      const defChunk = 200
      for (let i = 0; i < parsed.definitions.length; i += defChunk) {
        const chunk = parsed.definitions.slice(i, i + defChunk)
        const { error: e } = await supabase.from('kpi_definitions').upsert(chunk, { onConflict: 'kpi_id' })
        if (e) errs.push(`kpi_definitions ${i}-${i + chunk.length}: ${e.message}`)
      }

      // 3. Data — upsert by (kpi_id, year, period). Compute achievement_status before insert.
      const dataChunk = 500
      const defByKpi = new Map(parsed.definitions.map((d) => [d.kpi_id, d]))
      const dataWithStatus = parsed.data.map((r) => {
        const def = defByKpi.get(r.kpi_id)
        const status = def ? computeAchievement(r.result, def.target_operator, def.target_value) : 'No Data'
        return {
          kpi_id: r.kpi_id,
          year: r.year,
          period: r.period,
          period_order: r.period_order,
          result: r.result,
          achievement_status: status,
        }
      })
      for (let i = 0; i < dataWithStatus.length; i += dataChunk) {
        const chunk = dataWithStatus.slice(i, i + dataChunk)
        const { error: e } = await supabase.from('kpi_data').upsert(chunk, { onConflict: 'kpi_id,year,period' })
        if (e) errs.push(`kpi_data ${i}-${i + chunk.length}: ${e.message}`)
      }

      // 4. SIQ records — upsert by siq_id (skip those without an siq_id)
      const siqWithIds = parsed.siqRecords.filter((s) => s.siq_id)
      for (let i = 0; i < siqWithIds.length; i += defChunk) {
        const chunk = siqWithIds.slice(i, i + defChunk)
        const { error: e } = await supabase.from('kpi_siq_records').upsert(chunk, { onConflict: 'siq_id' })
        if (e) errs.push(`kpi_siq_records ${i}-${i + chunk.length}: ${e.message}`)
      }

      setResult({
        departments: parsed.departments.length,
        definitions: parsed.definitions.length,
        data: dataWithStatus.length,
        siq: siqWithIds.length,
        errors: errs,
      })
      onUploaded()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setFilename(null); setParsed(null); setResult(null); setError(null)
    if (fileRef) fileRef.value = ''
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <Panel title="Upload KPI Workbook" subtitle="Drop the KPI Monitor xlsx with sheets: Department_Mapping, KPI_Master, KPI_Data, SIQ_Tracker.">
        <div
          onDrop={async (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) await handleFile(f) }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onClick={() => document.getElementById('kpi-upload-input')?.click()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: 36, border: `2px dashed ${drag ? 'var(--blue)' : 'var(--border)'}`,
            background: drag ? 'var(--blue-lt)' : '#fff', borderRadius: 'var(--rs)', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 32 }}>📥</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{filename ? filename : 'Drag & drop xlsx, or click to browse'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Workbook stays in your browser until you press Import</div>
          <input id="kpi-upload-input" type="file" accept=".xlsx,.xls" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
        {parsing && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Parsing…</div>}
      </Panel>

      {parsed && (
        <Panel title="Workbook Preview">
          <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <MetricCard tone="blue"  label="Departments"   value={parsed.departments.length} />
            <MetricCard tone="teal"  label="KPI Definitions" value={parsed.definitions.length} />
            <MetricCard tone="green" label="Data Rows"     value={parsed.data.length} />
            <MetricCard tone="amber" label="SIQ Records"   value={parsed.siqRecords.length} sub="(non-empty)" />
          </div>

          {parsed.errors.length > 0 && (
            <div className="ac amber" style={{ marginTop: 8 }}>
              <div className="ai">⚠️</div>
              <div>
                <div className="at">{parsed.errors.length} parse warning(s)</div>
                <ul style={{ margin: '4px 0 0 18px', fontSize: 11 }}>
                  {parsed.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button onClick={reset} disabled={importing}
              style={{ padding: '7px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 600 }}>
              Reset
            </button>
            <button onClick={importNow} disabled={importing}
              style={{ padding: '7px 14px', border: 0, background: 'var(--blue)', color: '#fff', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 600 }}>
              {importing ? 'Importing…' : 'Import to Database'}
            </button>
          </div>
        </Panel>
      )}

      {error && (
        <div className="ac red" style={{ marginTop: 8 }}>
          <div className="ai">⚠️</div>
          <div><div className="at">Import error</div><div className="as">{error}</div></div>
        </div>
      )}
      {result && (
        <div className="ac green" style={{ marginTop: 8 }}>
          <div className="ai">✓</div>
          <div>
            <div className="at">Import complete</div>
            <div className="as">
              {result.departments} departments · {result.definitions} KPIs · {result.data} data rows · {result.siq} SIQ records
              {result.errors.length > 0 && <> · <span style={{ color: 'var(--red)' }}>{result.errors.length} batch error(s)</span></>}
            </div>
            {result.errors.length > 0 && (
              <ul style={{ margin: '4px 0 0 18px', fontSize: 11, color: 'var(--red)' }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* =========================================================================
 * TAB — REPORT CARD
 * ========================================================================= */

function ReportCardTab({ defs, data, siq }: { defs: KpiDefinition[]; data: KpiDataRow[]; siq: KpiSiqRecord[] }) {
  const deptOptions = useMemo(() => {
    const set = new Set<string>(); defs.forEach((d) => set.add(d.dept_code))
    return Array.from(set).sort()
  }, [defs])
  const [dept, setDept] = useState<string>(deptOptions[0] ?? '')
  const [period, setPeriod] = useState<KpiPeriodKey>('YTD')
  const [year, setYear] = useState<number>(2026)
  const [generated, setGenerated] = useState<{ dept: string; period: KpiPeriodKey; year: number; whole: boolean } | null>(null)

  useEffect(() => {
    if (!dept && deptOptions[0]) setDept(deptOptions[0])
  }, [dept, deptOptions])

  function downloadPdf() {
    if (typeof window === 'undefined') return
    const preview = document.getElementById('kpi-rc-preview')
    if (!preview) return
    const pages = Array.from(preview.querySelectorAll<HTMLElement>('.rc-page'))
    if (pages.length === 0) return

    // Convert any <canvas> chart to a static <img> before serializing — outerHTML
    // captures the canvas tag but not its bitmap, so charts vanish in the print window.
    const clonedPages = pages.map((page) => {
      const clone = page.cloneNode(true) as HTMLElement
      const originals = Array.from(page.querySelectorAll('canvas'))
      const clonedCanvases = Array.from(clone.querySelectorAll('canvas'))
      originals.forEach((orig, i) => {
        const target = clonedCanvases[i]
        if (!target) return
        try {
          const dataUrl = orig.toDataURL('image/png')
          const img = clone.ownerDocument!.createElement('img')
          img.src = dataUrl
          const rect = orig.getBoundingClientRect()
          img.style.width = `${rect.width}px`
          img.style.height = `${rect.height}px`
          img.style.display = 'block'
          target.replaceWith(img)
        } catch { /* tainted canvas — leave as-is */ }
      })
      return clone
    })

    const pageHtml = clonedPages.map((p) => p.outerHTML).join('\n')
    const css = Array.from(document.styleSheets).map((s) => {
      try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
      catch { return '' }
    }).join('\n')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>KPI Report Card</title><style>${css}\n@page{size:A4;margin:0}body{margin:0;padding:0;background:#fff;}</style></head><body>${pageHtml}<script>window.onload=()=>window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.open(); w.document.write(html); w.document.close()
  }

  return (
    <>
      <div className="rc-controls">
        <div className="pf">
          <div>
            <div className="pt">KPI Department Report Card {year}</div>
            <div className="psub">Select department + period to generate. Includes KPI performance, submission compliance, and SIQ status.</div>
          </div>
        </div>
        <div className="row">
          <div>
            <label>Year</label>
            <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
              <option value={2026}>2026</option>
              <option value={2025}>2025</option>
            </select>
          </div>
          <div>
            <label>Department</label>
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as KpiPeriodKey)}>
              {KPI_PERIOD_OPTIONS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <button className="btn" type="button" onClick={() => setGenerated({ dept, period, year, whole: false })}>Generate Report</button>
          <button className="btn ghost" type="button" onClick={() => setGenerated({ dept: '', period, year, whole: true })}>🏥 Whole Hospital</button>
          <button className="btn ghost" type="button" onClick={downloadPdf} disabled={!generated}>⬇ Download PDF</button>
        </div>
      </div>

      <div className="rc-preview" id="kpi-rc-preview">
        {!generated && (
          <div style={{ background: '#fff', padding: 30, borderRadius: 6, color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
            Choose a department + period and press <b>Generate Report</b>.
          </div>
        )}
        {generated?.whole && <KpiHospitalReport defs={defs} data={data} siq={siq} year={generated.year} period={generated.period} />}
        {generated && !generated.whole && (
          <KpiDeptReport defs={defs} data={data} siq={siq} dept={generated.dept} year={generated.year} period={generated.period} />
        )}
      </div>
    </>
  )
}

function ReportFooter() {
  const today = new Date().toISOString().slice(0, 10)
  return <div className="rc-foot">Quality Assurance and Document Management Unit, RMCQ · Confidential · Not for circulation · Generated: {today}</div>
}

function KpiDeptReport({ defs, data, siq, dept, year, period }: { defs: KpiDefinition[]; data: KpiDataRow[]; siq: KpiSiqRecord[]; dept: string; year: number; period: KpiPeriodKey }) {
  const today = new Date()
  const periodMonths = kpiPeriodMonths(period)
  const deptDefs = defs
    .filter((d) => d.dept_code === dept && d.active)
    .sort((a, b) => a.kpi_id.localeCompare(b.kpi_id, undefined, { numeric: true }))

  // Compliance for the period
  let due = 0, sub = 0, pend = 0
  for (const d of deptDefs) {
    const periods = scheduledPeriodsFor(d.frequency).filter((p) => periodMonths.includes(p))
    for (const p of periods) {
      if (!isOverdueDeadline(year, p, today)) continue
      due++
      const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
      if (r && r.result) sub++; else pend++
    }
  }
  const compPct = due ? Math.round((sub / due) * 100) : 0

  // Achievement for the period
  let ach = 0, nach = 0
  for (const d of deptDefs) {
    const periods = scheduledPeriodsFor(d.frequency).filter((p) => periodMonths.includes(p))
    for (const p of periods) {
      const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
      const s = computeAchievement(r?.result ?? null, d.target_operator, d.target_value)
      if (s === 'Achieved') ach++
      else if (s === 'Not Achieved') nach++
    }
  }
  const achPct = ach + nach ? Math.round((ach / (ach + nach)) * 100) : 0

  // SIQ for dept (live triggers + stored)
  const liveSiqs = deptDefs.filter((d) => detectSiqTrigger(d, data, year).triggered)
  const storedSiqs = siq.filter((s) => s.dept_code === dept)

  // Frequency breakdown
  const fByFreq: Record<Frequency, number> = { Monthly: 0, Quarterly: 0, Biannual: 0, Yearly: 0 }
  for (const d of deptDefs) fByFreq[d.frequency]++

  // Paginate KPIs across multiple A4 pages
  const KPIS_PER_PAGE = 22
  const kpiPages: KpiDefinition[][] = []
  for (let i = 0; i < deptDefs.length; i += KPIS_PER_PAGE) {
    kpiPages.push(deptDefs.slice(i, i + KPIS_PER_PAGE))
  }
  if (kpiPages.length === 0) kpiPages.push([])

  return (
    <>
      <div className="rc-page">
        <div className="rc-h">
          <div className="t1">{dept} — KPI Performance Report</div>
          <div className="t2">{kpiPeriodLabel(period)} {year}</div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 1 — Department KPI Summary</div>
          <div className="rc-kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <div className="rc-kpi"><div className="l">Total KPIs</div><div className="v" style={{ color: 'var(--blue)' }}>{deptDefs.length}</div></div>
            <div className="rc-kpi"><div className="l">Compliance</div>{due === 0 ? (<div className="v" style={{ color: 'var(--muted)' }}>—</div>) : (<div className="v" style={{ color: compPct >= 80 ? 'var(--green)' : compPct >= 50 ? 'var(--amber)' : 'var(--red)' }}>{compPct >= 80 ? '🟢' : compPct >= 50 ? '🟡' : '🔴'} {compPct}%</div>)}<div className="s">{due === 0 ? 'No deadlines yet' : `${sub}/${due}`}</div></div>
            <div className="rc-kpi"><div className="l">Achievement</div>{(ach + nach) === 0 ? (<div className="v" style={{ color: 'var(--muted)' }}>—</div>) : (<div className="v" style={{ color: achPct >= 80 ? 'var(--green)' : achPct >= 50 ? 'var(--amber)' : 'var(--red)' }}>{achPct >= 80 ? '🟢' : achPct >= 50 ? '🟡' : '🔴'} {achPct}%</div>)}<div className="s">{(ach + nach) === 0 ? 'No reports yet' : `${ach} achieved`}</div></div>
            <div className="rc-kpi"><div className="l">Pending</div><div className="v" style={{ color: 'var(--red)' }}>{pend}</div></div>
            <div className="rc-kpi"><div className="l">SIQs (live)</div><div className="v" style={{ color: 'var(--amber)' }}>{liveSiqs.length}</div></div>
            <div className="rc-kpi"><div className="l">SIQs (stored)</div><div className="v" style={{ color: 'var(--blue)' }}>{storedSiqs.length}</div></div>
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 2 — KPIs by Frequency</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {(['Monthly','Quarterly','Biannual','Yearly'] as Frequency[]).map((f) => (
              <div key={f} className="rc-kpi"><div className="l">{f}</div><div className="v" style={{ color: 'var(--blue)' }}>{fByFreq[f]}</div></div>
            ))}
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 3 — KPI Performance Detail (page 1 of {kpiPages.length})</div>
          <KpiDetailTable rows={kpiPages[0]} data={data} year={year} periodMonths={periodMonths} />
        </div>

        <ReportFooter />
      </div>

      {kpiPages.slice(1).map((chunk, idx) => (
        <div className="rc-page" key={`detail-page-${idx + 2}`}>
          <div className="rc-h"><div className="t1">{dept} — KPI Performance Detail (page {idx + 2} of {kpiPages.length})</div></div>
          <div className="rc-section">
            <KpiDetailTable rows={chunk} data={data} year={year} periodMonths={periodMonths} />
          </div>
          <ReportFooter />
        </div>
      ))}

      {/* Page — SIQ section */}
      <div className="rc-page">
        <div className="rc-h"><div className="t1">{dept} — SIQ Status</div></div>

        <div className="rc-section">
          <div className="rc-st">Live SIQ Triggers (from current data)</div>
          {liveSiqs.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--green)' }}>No live SIQ triggers ✓</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPI ID</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPI</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Freq</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Trigger</th>
                </tr>
              </thead>
              <tbody>
                {liveSiqs.map((d) => {
                  const t = detectSiqTrigger(d, data, year)
                  return (
                    <tr key={d.kpi_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{d.kpi_id}</td>
                      <td style={{ padding: '3px 5px', minWidth: 220, lineHeight: 1.3 }}>{d.kpi_name}</td>
                      <td style={{ padding: '3px 5px' }}>{d.frequency}</td>
                      <td style={{ padding: '3px 5px' }}>{t.consecutive} consecutive Not Achieved → {t.triggerPeriod}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="rc-section">
          <div className="rc-st">Stored SIQ Records</div>
          {storedSiqs.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>No SIQ records on file.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>SIQ ID</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPI</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Trigger</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Issued</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Due</th>
                  <th style={{ textAlign: 'left', padding: '3px 5px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {storedSiqs.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{s.siq_id ?? '—'}</td>
                    <td style={{ padding: '3px 5px', minWidth: 200, lineHeight: 1.3 }}>{s.kpi_name ?? '—'}</td>
                    <td style={{ padding: '3px 5px' }}>{s.trigger_period ?? '—'}</td>
                    <td style={{ padding: '3px 5px' }}>{fmtDate(s.date_issued)}</td>
                    <td style={{ padding: '3px 5px' }}>{fmtDate(s.due_date)}</td>
                    <td style={{ padding: '3px 5px' }}>{s.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ReportFooter />
      </div>
    </>
  )
}

function KpiDetailTable({ rows, data, year, periodMonths }: {
  rows: KpiDefinition[]
  data: KpiDataRow[]
  year: number
  periodMonths: Period[]
}) {
  const today = useMemo(() => new Date(), [])
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
      <thead>
        <tr style={{ background: 'var(--bg)' }}>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPI ID</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPI</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Freq</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Target</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Achieved</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Not Ach.</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Compl.</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>SIQ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const periods = scheduledPeriodsFor(d.frequency).filter((p) => periodMonths.includes(p))
          let a = 0, na2 = 0
          for (const p of periods) {
            const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
            const s = computeAchievement(r?.result ?? null, d.target_operator, d.target_value)
            if (s === 'Achieved') a++; else if (s === 'Not Achieved') na2++
          }
          const c = compliance(d, data, year, today)
          const t = detectSiqTrigger(d, data, year)
          return (
            <tr key={d.kpi_id} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
              <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{d.kpi_id}</td>
              <td style={{ padding: '3px 5px', minWidth: 180, lineHeight: 1.3 }}>{d.kpi_name}</td>
              <td style={{ padding: '3px 5px' }}>{d.frequency}</td>
              <td style={{ padding: '3px 5px' }}>{d.target ?? '—'}</td>
              <td style={{ padding: '3px 5px' }}>{a}</td>
              <td style={{ padding: '3px 5px', color: na2 > 0 ? 'var(--red)' : undefined, fontWeight: na2 > 0 ? 700 : undefined }}>{na2}</td>
              <td style={{ padding: '3px 5px', color: c.pct >= 80 ? 'var(--green)' : c.pct >= 50 ? 'var(--amber)' : 'var(--red)', fontWeight: 700 }}>{c.scheduledDue ? `${c.pct}%` : '—'}</td>
              <td style={{ padding: '3px 5px', color: t.triggered ? 'var(--red)' : undefined, fontWeight: t.triggered ? 700 : undefined }}>{t.triggered ? '⚠ Yes' : '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function KpiHospitalReport({ defs, data, siq, year, period }: { defs: KpiDefinition[]; data: KpiDataRow[]; siq: KpiSiqRecord[]; year: number; period: KpiPeriodKey }) {
  const today = new Date()
  const periodMonths = kpiPeriodMonths(period)
  const allDefs = defs.filter((d) => d.active)

  let due = 0, sub = 0, pend = 0
  let ach = 0, nach = 0
  for (const d of allDefs) {
    const periods = scheduledPeriodsFor(d.frequency).filter((p) => periodMonths.includes(p))
    for (const p of periods) {
      if (isOverdueDeadline(year, p, today)) {
        due++
        const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
        if (r && r.result) sub++; else pend++
      }
      const r = data.find((x) => x.kpi_id === d.kpi_id && x.year === year && x.period === p)
      const s = computeAchievement(r?.result ?? null, d.target_operator, d.target_value)
      if (s === 'Achieved') ach++; else if (s === 'Not Achieved') nach++
    }
  }
  const compPct = due ? Math.round((sub / due) * 100) : 0
  const achPct = ach + nach ? Math.round((ach / (ach + nach)) * 100) : 0

  const liveSiqs = allDefs.filter((d) => detectSiqTrigger(d, data, year).triggered).length
  const storedOpen = siq.filter((s) => s.status === 'Open' || s.status === 'In Progress' || s.status === 'Pending Department Feedback').length

  // ALL depts (no slice). Sorted: critical first (lowest compliance), then by KPI count desc.
  const deptSet = new Set<string>(); allDefs.forEach((d) => deptSet.add(d.dept_code))
  const allDeptComp = Array.from(deptSet).map((dc) => {
    const c = deptCompliance(allDefs, data, dc, year, today)
    return { dept: dc, ...c }
  }).sort((a, b) => {
    // Depts with no due periods get sorted at the end
    if (a.scheduledDue === 0 && b.scheduledDue !== 0) return 1
    if (b.scheduledDue === 0 && a.scheduledDue !== 0) return -1
    return (a.pct - b.pct) || (b.kpiCount - a.kpiCount)
  })

  // Paginate dept rows across A4 pages — first page also has the KPI summary,
  // so it gets fewer dept rows. Subsequent pages are dept-only.
  const FIRST_PAGE_DEPTS = 18
  const MORE_PAGE_DEPTS = 30
  const deptPages: typeof allDeptComp[] = []
  if (allDeptComp.length === 0) {
    deptPages.push([])
  } else {
    deptPages.push(allDeptComp.slice(0, FIRST_PAGE_DEPTS))
    let i = FIRST_PAGE_DEPTS
    while (i < allDeptComp.length) {
      deptPages.push(allDeptComp.slice(i, i + MORE_PAGE_DEPTS))
      i += MORE_PAGE_DEPTS
    }
  }

  const renderDeptTable = (rows: typeof allDeptComp) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
      <thead>
        <tr style={{ background: 'var(--bg)' }}>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Dept</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>KPIs</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Due</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Submitted</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Pending</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Compliance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => (
          <tr key={d.dept} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '3px 5px', fontWeight: 600 }}>{d.dept}</td>
            <td style={{ padding: '3px 5px' }}>{d.kpiCount}</td>
            <td style={{ padding: '3px 5px' }}>{d.scheduledDue}</td>
            <td style={{ padding: '3px 5px' }}>{d.submitted}</td>
            <td style={{ padding: '3px 5px', color: d.pending > 0 ? 'var(--red)' : undefined }}>{d.pending}</td>
            <td style={{ padding: '3px 5px', color: d.scheduledDue === 0 ? 'var(--muted)' : (d.pct >= 80 ? 'var(--green)' : d.pct >= 50 ? 'var(--amber)' : 'var(--red)'), fontWeight: 700 }}>
              {d.scheduledDue === 0 ? 'No due' : `${d.pct}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <>
      <div className="rc-page">
        <div className="rc-h">
          <div className="t1">Hospital-Wide KPI Summary</div>
          <div className="t2">Hospital Al-Sultan Abdullah UiTM · {kpiPeriodLabel(period)} {year}</div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 1 — Hospital KPIs</div>
          <div className="rc-kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <div className="rc-kpi"><div className="l">Total KPIs</div><div className="v" style={{ color: 'var(--blue)' }}>{allDefs.length}</div></div>
            <div className="rc-kpi"><div className="l">Compliance</div>{due === 0 ? (<div className="v" style={{ color: 'var(--muted)' }}>—</div>) : (<div className="v" style={{ color: compPct >= 80 ? 'var(--green)' : compPct >= 50 ? 'var(--amber)' : 'var(--red)' }}>{compPct}%</div>)}<div className="s">{due === 0 ? 'No deadlines yet' : `${sub}/${due}`}</div></div>
            <div className="rc-kpi"><div className="l">Achievement</div>{(ach + nach) === 0 ? (<div className="v" style={{ color: 'var(--muted)' }}>—</div>) : (<div className="v" style={{ color: achPct >= 80 ? 'var(--green)' : achPct >= 50 ? 'var(--amber)' : 'var(--red)' }}>{achPct}%</div>)}<div className="s">{(ach + nach) === 0 ? 'No reports yet' : `${ach} achieved`}</div></div>
            <div className="rc-kpi"><div className="l">Pending</div><div className="v" style={{ color: 'var(--red)' }}>{pend}</div></div>
            <div className="rc-kpi"><div className="l">Live SIQs</div><div className="v" style={{ color: 'var(--amber)' }}>{liveSiqs}</div></div>
            <div className="rc-kpi"><div className="l">Open SIQs</div><div className="v" style={{ color: 'var(--blue)' }}>{storedOpen}</div></div>
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 2 — Compliance by Department (lowest first) · page 1 of {deptPages.length}</div>
          {renderDeptTable(deptPages[0])}
        </div>

        <ReportFooter />
      </div>

      {deptPages.slice(1).map((rows, idx) => (
        <div className="rc-page" key={`hw-page-${idx + 2}`}>
          <div className="rc-h"><div className="t1">Hospital-Wide KPI Summary — page {idx + 2} of {deptPages.length}</div></div>
          <div className="rc-section">
            <div className="rc-st">Compliance by Department (continued)</div>
            {renderDeptTable(rows)}
          </div>
          <ReportFooter />
        </div>
      ))}
    </>
  )
}
