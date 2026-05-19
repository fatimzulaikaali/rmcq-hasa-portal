'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  Title,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import {
  parseRows as parseIrRows,
  detectHeaderRow as detectIrHeaderRow,
  MAPPED_HEADERS as IR_MAPPED_HEADERS,
  type IncidentRow,
} from '@/lib/ir/excel-mapper'
import {
  applyFilters,
  CATEGORY_COLORS,
  categoryByMonth,
  counts,
  DEFAULT_FILTERS,
  filterByPeriod,
  iiBuckets,
  isOverdue,
  isPsi,
  monthLabel,
  monthKey,
  submissionMonthKey,
  isPrimaryDept,
  overviewMetrics,
  parseIiStatus,
  parseRcaStatus,
  PERIOD_OPTIONS,
  PRIMARY_DEPTS,
  ACTION_DEPTS,
  primaryVsReporting,
  rcaBuckets,
  reportingTrend,
  SEVERITY_BG,
  SEVERITY_FG,
  SEVERITY_CHART,
  SEVERITY_ORDER,
  severityByCategory,
  severityCounts,
  sortedTop,
  type Incident,
  type IrFilters,
  type PeriodKey,
  type Severity,
  uniqueMonths,
  uniqueValues,
  activeMonthRange,
} from '@/lib/ir/dashboard-helpers'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  Title
)

type TabId =
  | 'overview' | 'categories' | 'severity'
  | 'ii' | 'rca' | 'reporting'
  | 'non-psi' | 'report-card' | 'all-records' | 'upload'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',     label: 'Overview',              icon: '📊' },
  { id: 'categories',   label: 'PSI Categories',        icon: '🏷️' },
  { id: 'severity',     label: 'Severity',              icon: '⚠️' },
  { id: 'ii',           label: 'Internal Investigation',icon: '🔍' },
  { id: 'rca',          label: 'RCA',                   icon: '🧩' },
  { id: 'reporting',    label: 'Reporting Culture',     icon: '🏢' },
  { id: 'non-psi',      label: 'Non-PSI Incidents',     icon: '📁' },
  { id: 'report-card',  label: 'Report Card',           icon: '📄' },
  { id: 'all-records',  label: 'All Records',           icon: '📋' },
  { id: 'upload',       label: 'Upload Workbook',       icon: '⬆' },
]

const PAGE_SIZE = 20

const RC_ACT_CLR: Record<string, string> = {
  'MONITOR': '#185FA5',
  'NURSING RELATED INCIDENT': '#0F6E56',
  'INTERNAL INVESTIGATION': '#A32D2D',
  'INTERNAL INQUIRY': '#854F0B',
  'RCA': '#534AB7',
  'INFORM HEAD OF DEPARTMENT': '#993C1D',
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'ACTUAL', label: 'ACTUAL' },
  { value: 'NEARMISS', label: 'NEAR MISS' },
]
const CARE_OPTIONS = [
  { value: 'all', label: 'All Settings' },
  { value: 'INPATIENT', label: 'INPATIENT' },
  { value: 'EMERGENCY', label: 'EMERGENCY' },
  { value: 'OUTPATIENT', label: 'OUTPATIENT' },
]

/* =========================================================================
 * MAIN PAGE
 * ========================================================================= */

export default function IrPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Incident[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<IrFilters>(DEFAULT_FILTERS)
  const [tab, setTab] = useState<TabId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // Initial fetch
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      // Module access gate — dept-scoped Risk users get bounced to /risk
      const access = await getModuleAccess(supabase)
      if (!access.allModules) {
        router.replace('/risk')
        return
      }

      const { data, error } = await supabase
        .from('incidents')
        .select(
          'id,incident_id,incident_month,dept_code,action_dept,reporting_dept,care_setting,ward,category,sub_category,sentinel,incident_type,severity_real,severity_potential,action_taken,case_closed,is_rca,rca_status,is_ii,ii_status,action_due_date,submission_date'
        )
        .order('incident_month', { ascending: true })
        .limit(50000)
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setRows([])
      } else {
        setRows((data ?? []) as Incident[])
      }
    })()
    return () => { cancelled = true }
  }, [refreshTick, router])

  const filtered = useMemo(() => (rows ? applyFilters(rows, filters) : []), [rows, filters])

  const monthOpts = useMemo(() => uniqueMonths(rows ?? []), [rows])
  const deptOpts = useMemo(() => uniqueValues(rows ?? [], 'dept_code'), [rows])
  const catOpts = useMemo(() => uniqueValues(rows ?? [], 'category'), [rows])
  const meta = useMemo(() => activeMonthRange(rows ?? [], filters), [rows, filters])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">🏥 Patient Safety</div>
          <div className="sb-sub">Incident Reporting Dashboard 2026</div>
        </div>

        {/* Portal links — small section. View navigation lives in the top tab bar. */}
        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/kpi" className="nav-item">
            <span className="nav-icon">📈</span>
            <span>KPI Monitor</span>
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
            label="Month"
            value={filters.month}
            onChange={(v) => setFilters({ ...filters, month: v })}
            options={[{ value: 'all', label: 'All Months' }, ...monthOpts]}
          />
          <FilterSelect
            label="Department"
            value={filters.dept}
            onChange={(v) => setFilters({ ...filters, dept: v })}
            options={[{ value: 'all', label: 'All Departments' }, ...deptOpts.map((v) => ({ value: v, label: v }))]}
          />
          <FilterSelect
            label="Care Setting"
            value={filters.careSetting}
            onChange={(v) => setFilters({ ...filters, careSetting: v })}
            options={CARE_OPTIONS}
          />
          <FilterSelect
            label="Incident Type"
            value={filters.type}
            onChange={(v) => setFilters({ ...filters, type: v })}
            options={TYPE_OPTIONS}
          />
          <FilterSelect
            label="Category"
            value={filters.category}
            onChange={(v) => setFilters({ ...filters, category: v })}
            options={[{ value: 'all', label: 'All Categories' }, ...catOpts.map((v) => ({ value: v, label: v }))]}
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
              <div className="tb-title">Patient Safety Incident Reporting 2026</div>
              <div className="tb-meta">Hospital Al-Sultan Abdullah UiTM · {meta}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="rec-badge">
              {rows == null ? 'Loading…' : `${filtered.length.toLocaleString()} record${filtered.length === 1 ? '' : 's'}`}
            </div>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <nav className="tab-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => { setTab(t.id); setSidebarOpen(false); }}
              type="button"
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>

        <main className="tab-pane">
          {rows == null ? (
            <Loader />
          ) : loadError ? (
            <div className="ac red">
              <div className="ai">⚠️</div>
              <div>
                <div className="at">Failed to load incidents</div>
                <div className="as">{loadError}</div>
              </div>
            </div>
          ) : (
            <>
              {tab === 'overview'    && <OverviewTab rows={filtered} />}
              {tab === 'categories'  && <CategoriesTab rows={filtered} />}
              {tab === 'severity'    && <SeverityTab rows={filtered} />}
              {tab === 'ii'          && <IiTab rows={filtered} />}
              {tab === 'rca'         && <RcaTab rows={filtered} />}
              {tab === 'reporting'   && <ReportingTab rows={filtered} />}
              {tab === 'non-psi'     && <NonPsiTab rows={filtered} />}
              {tab === 'report-card' && <ReportCardTab rows={rows} />}
              {tab === 'all-records' && <AllRecordsTab rows={filtered} />}
              {tab === 'upload'      && <IrUploadTab onUploaded={() => setRefreshTick((t) => t + 1)} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* =========================================================================
 * SHARED UI PRIMITIVES
 * ========================================================================= */

function Loader() {
  return (
    <div className="loader">
      <div className="loader-inner">
        <div className="spin" />
        <div>Loading incidents…</div>
      </div>
    </div>
  )
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="sf-g">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function MetricCard({ tone, label, value, sub }: { tone: 'blue'|'red'|'amber'|'green'|'gray'|'teal'|'purple'; label: string; value: number | string; sub?: string }) {
  return (
    <div className={`mc ${tone}`}>
      <div className="ml">{label}</div>
      <div className="mv">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="ms">{sub}</div>}
    </div>
  )
}

function Panel({ title, subtitle, children, height }: { title: string; subtitle?: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="panel">
      <div className="pf">
        <div>
          <div className="pt">{title}</div>
          {subtitle && <div className="psub">{subtitle}</div>}
        </div>
      </div>
      <div className="cw" style={height ? { height } : undefined}>{children}</div>
    </div>
  )
}

function ProgressList({ items, color = '#378ADD' }: { items: { label: string; value: number; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      {items.map((it) => (
        <div className="pr-row" key={it.label}>
          <div className="pr-lbl" title={it.label}>{it.label}</div>
          <div className="pr-trk">
            <div className="pr-fill" style={{ width: `${(it.value / max) * 100}%`, background: it.color ?? color }} />
          </div>
          <div className="pr-n">{it.value}</div>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12, padding: '8px 0' }}>No data</div>}
    </div>
  )
}

function SevBadge({ sev }: { sev: string | null }) {
  const s = (sev ?? '').toUpperCase()
  if (!s) return <span className="b b-gray">—</span>
  const bg = SEVERITY_BG[s] ?? '#888780'
  const fg = SEVERITY_FG[s] ?? '#fff'
  return <span className="b" style={{ background: bg, color: fg }}>{s}</span>
}

function StatusBadge({ status, kind }: { status: string; kind: 'ii' | 'rca' }) {
  const tone = kind === 'ii' ? toneForIi(status) : toneForRca(status)
  return <span className={`b b-${tone}`}>{status}</span>
}

function toneForIi(s: string): string {
  if (s === 'Overdue') return 'red'
  if (s === 'Pending') return 'amber'
  if (s === 'On Time') return 'green'
  if (s === 'Late') return 'blue'
  return 'gray'
}
function toneForRca(s: string): string {
  if (s === 'Overdue') return 'red'
  if (s === 'Pending') return 'amber'
  if (s === 'Completed') return 'green'
  return 'gray'
}

function CaseBadge({ closed }: { closed: boolean | null }) {
  return closed
    ? <span className="b b-green">Closed</span>
    : <span className="b b-amber">Open</span>
}

function SentinelBadge({ on }: { on: boolean | null }) {
  return on ? <span className="b b-purple">YES</span> : <span className="b b-gray">NO</span>
}

function TypeBadge({ t }: { t: string | null }) {
  const v = (t ?? '').toUpperCase().replace(/\s+/g, '')
  if (v === 'ACTUAL') return <span className="b b-blue">ACTUAL</span>
  if (v === 'NEARMISS') return <span className="b b-teal">NEAR MISS</span>
  return <span className="b b-gray">{t ?? '—'}</span>
}

function fmtMonth(iso: string | null): string {
  const k = monthKey(iso); return k ? monthLabel(k) : '—'
}


/* =========================================================================
 * TAB 1 — OVERVIEW
 * ========================================================================= */

function OverviewTab({ rows }: { rows: Incident[] }) {
  const m = useMemo(() => overviewMetrics(rows), [rows])
  const psiSentinel = useMemo(() => rows.filter((r) => r.sentinel && isPsi(r)).length, [rows])
  const psiSentinelDeaths = useMemo(() => rows.filter((r) => r.sentinel && isPsi(r) && (r.severity_real ?? '').toUpperCase() === 'DEATH').length, [rows])
  const psiSentinelIds = useMemo(() => rows.filter((r) => r.sentinel && isPsi(r)).map((r) => r.incident_id).filter(Boolean) as string[], [rows])
  const severeReal = useMemo(() => rows.filter((r) => isPsi(r) && (r.severity_real ?? '').toUpperCase() === 'SEVERE' && !r.sentinel).length, [rows])

  // monthly trend (PSI vs Non-PSI) — by SUBMISSION date (date of reporting)
  const monthly = useMemo(() => {
    const acc = new Map<string, { psi: number; nonPsi: number; total: number }>()
    for (const r of rows) {
      const k = submissionMonthKey(r); if (!k) continue
      if (!acc.has(k)) acc.set(k, { psi: 0, nonPsi: 0, total: 0 })
      const a = acc.get(k)!
      a.total++
      if (isPsi(r)) a.psi++; else a.nonPsi++
    }
    const sorted = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
    return {
      labels: sorted.map(([k]) => monthLabel(k)),
      psi: sorted.map(([, v]) => v.psi),
      nonPsi: sorted.map(([, v]) => v.nonPsi),
      total: sorted.map(([, v]) => v.total),
    }
  }, [rows])

  const careCounts = useMemo(() => {
    const c = counts(rows, (r) => (r.care_setting ?? '').toUpperCase())
    return Array.from(c.entries())
  }, [rows])

  const topDept = useMemo(() => sortedTop(counts(rows.filter((r) => isPsi(r) && isPrimaryDept(r.dept_code)), (r) => r.dept_code), 10), [rows])
  const typeCounts = useMemo(() => {
    let actual = 0, near = 0
    for (const r of rows.filter(isPsi)) {
      const t = (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '')
      if (t === 'ACTUAL') actual++
      else if (t === 'NEARMISS') near++
    }
    return { actual, near }
  }, [rows])
  const actionTaken = useMemo(() => sortedTop(counts(rows.filter(isPsi), (r) => r.action_taken), 12), [rows])

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue"   label="Total Incidents"    value={m.total} />
        <MetricCard tone="teal"   label="Patient Safety PSI" value={m.psi} />
        <MetricCard tone="gray"   label="Non-PSI"            value={m.nonPsi} />
        <MetricCard tone="amber"  label="Open Cases"         value={m.open} />
        <MetricCard tone="red"    label="Sentinel Events"    value={psiSentinel} sub={psiSentinelDeaths > 0 ? `${psiSentinelDeaths} Death case(s)` : 'No Death cases'} />
        <MetricCard tone="green"  label="Near Miss"          value={m.nearMiss} sub="PSI — intercepted" />
        <MetricCard tone="red"    label="Severe (Real)"      value={severeReal} sub="Excl. Sentinel/Death" />
      </div>

      <div className="g2">
        <Panel title="Monthly Incident Trend">
          <div style={{ height: 210 }}>
            <Bar
              data={{
                labels: monthly.labels,
                datasets: [
                  { label: 'PSI',     data: monthly.psi,    backgroundColor: '#378ADD', borderRadius: 4 },
                  { label: 'Non-PSI', data: monthly.nonPsi, backgroundColor: '#B4B2A9', borderRadius: 4 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
                scales: {
                  y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                  x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </Panel>

        <Panel title="Care Setting">
          <div style={{ height: 210 }}>
            <Doughnut
              data={{
                labels: careCounts.map(([k]) => k),
                datasets: [{
                  data: careCounts.map(([, v]) => v),
                  backgroundColor: ['#185FA5', '#E24B4A', '#1D9E75', '#EF9F27'],
                  borderWidth: 0,
                }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false, cutout: '60%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </div>
        </Panel>
      </div>

      <Panel title="Incident Trend by Month">
        <div style={{ height: 220 }}>
          <Line
            data={{
              labels: monthly.labels,
              datasets: [
                { label: 'Total',   data: monthly.total,  borderColor: '#378ADD', backgroundColor: '#378ADD', tension: 0.3, fill: false, pointRadius: 3 },
                { label: 'PSI',     data: monthly.psi,    borderColor: '#1D9E75', backgroundColor: '#1D9E75', tension: 0.3, fill: false, pointRadius: 3 },
                { label: 'Non-PSI', data: monthly.nonPsi, borderColor: '#B4B2A9', backgroundColor: '#B4B2A9', borderDash: [5, 5], tension: 0.3, fill: false, pointRadius: 3 },
              ],
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
              scales: {
                y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                x: { ticks: { font: { size: 11 } }, grid: { display: false } },
              },
            }}
          />
        </div>
      </Panel>

      <div className="g2">
        <Panel title="Top Departments (Primary) — PSI Only">
          <ProgressList items={topDept.labels.map((l, i) => ({ label: l, value: topDept.data[i] }))} color="#378ADD" />
        </Panel>

        <Panel title="Actual vs Near Miss — PSI Only">
          <div style={{ height: 220 }}>
            <Bar
              data={{
                labels: ['ACTUAL', 'NEAR MISS'],
                datasets: [{
                  label: 'Count',
                  data: [typeCounts.actual, typeCounts.near],
                  backgroundColor: ['#378ADD', '#1D9E75'],
                  borderRadius: 4,
                }],
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

      <Panel title="Action Taken — PSI Incidents Only">
        <div style={{ height: 220 }}>
          <Bar
            data={{
              labels: actionTaken.labels,
              datasets: [{ label: 'Count', data: actionTaken.data, backgroundColor: actionTaken.labels.map((l) => RC_ACT_CLR[l.toUpperCase()] ?? '#888780'), borderRadius: 4 }],
            }}
            options={{
              indexAxis: 'y', responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                y: { ticks: { font: { size: 11 } }, grid: { display: false } },
              },
            }}
          />
        </div>
      </Panel>

      <Panel title="⚠️ Alerts & Watch Items">
        {psiSentinel > 0 && (
          <div className="ac red">
            <div className="ai">⚠️</div>
            <div>
              <div className="at">{psiSentinel} Sentinel Event{psiSentinel === 1 ? '' : 's'} reported</div>
              <div className="as">{psiSentinelIds.slice(0, 8).join(', ')}{psiSentinelIds.length > 8 ? ` (+${psiSentinelIds.length - 8} more)` : ''}{psiSentinelDeaths > 0 ? ` — ${psiSentinelDeaths} death${psiSentinelDeaths === 1 ? '' : 's'} recorded` : ''}.</div>
            </div>
          </div>
        )}
        {m.open > 0 && (
          <div className="ac amber">
            <div className="ai">⏰</div>
            <div>
              <div className="at">{m.open} cases still open</div>
              <div className="as">Requires follow-up to close out outstanding actions.</div>
            </div>
          </div>
        )}
        {m.nearMiss > 0 && (
          <div className="ac green">
            <div className="ai">✓</div>
            <div>
              <div className="at">{m.nearMiss} Near Miss incidents successfully intercepted</div>
              <div className="as">Demonstrates strong proactive safety culture.</div>
            </div>
          </div>
        )}
        {psiSentinel === 0 && m.open === 0 && m.nearMiss === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No items requiring attention.</div>
        )}
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB 2 — PSI CATEGORIES
 * ========================================================================= */

function CategoriesTab({ rows }: { rows: Incident[] }) {
  const psi = useMemo(() => rows.filter(isPsi), [rows])
  const cats = useMemo(() => sortedTop(counts(psi, (r) => r.category)), [psi])
  const top3 = useMemo(() => cats.labels.slice(0, 3).map((l, i) => ({ label: l, value: cats.data[i] })), [cats])

  const others = useMemo(() => sortedTop(counts(psi.filter((r) => (r.category ?? '').trim() === 'Others'), (r) => r.sub_category)), [psi])

  const trend = useMemo(() => categoryByMonth(psi), [psi])
  const orderedCats = useMemo(() =>
    cats.labels.length > 0
      ? cats.labels
      : trend.categories,
    [cats.labels, trend.categories]
  )

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="teal" label="Total PSI" value={psi.length} />
        <MetricCard tone="red" label="Top Category" value={top3[0]?.value ?? 0} sub={top3[0]?.label ?? '—'} />
        <MetricCard tone="blue" label="No. of Categories" value={cats.labels.length} />
        <MetricCard tone="green" label="Near Miss" value={psi.filter((r) => (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '') === 'NEARMISS').length} />
      </div>

      <div className="g2">
        <Panel title="Incidents by Category">
          <div style={{ height: 300 }}>
            <Bar
              data={{
                labels: cats.labels,
                datasets: [{
                  label: 'Count',
                  data: cats.data,
                  backgroundColor: cats.labels.map((l) => CATEGORY_COLORS[l] ?? '#888780'),
                  borderRadius: 4,
                }],
              }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                  y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </Panel>

        <Panel title="“Others” Sub-Category Breakdown" subtitle="Sub-categories for incidents classified as Others">
          <ProgressList items={others.labels.map((l, i) => ({ label: l, value: others.data[i] }))} color="#B4B2A9" />
        </Panel>
      </div>

      <Panel title="Category Trend by Month">
        <div className="legend">
          {orderedCats.map((c) => (
            <div className="ld" key={c}>
              <span className="ld-sw" style={{ background: CATEGORY_COLORS[c] ?? '#888780' }} />
              {c}
            </div>
          ))}
        </div>
        <div style={{ height: 260, marginTop: 6 }}>
          <Bar
            data={{
              labels: trend.months,
              datasets: trend.categories.map((c, i) => ({
                label: c,
                data: trend.matrix[i],
                backgroundColor: CATEGORY_COLORS[c] ?? '#888780',
                stack: 's',
              })),
            }}
            options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { stacked: true, ticks: { font: { size: 11 } }, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
              },
            }}
          />
        </div>
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB 3 — SEVERITY
 * ========================================================================= */

function SeverityTab({ rows }: { rows: Incident[] }) {
  const psi = useMemo(() => rows.filter(isPsi), [rows])
  const sevReal = useMemo(() => severityCounts(psi, (r) => r.severity_real), [psi])
  const sevPot = useMemo(() => severityCounts(psi, (r) => r.severity_potential), [psi])
  const sentinels = useMemo(() => psi.filter((r) => r.sentinel), [psi])
  const byCat = useMemo(() => severityByCategory(psi), [psi])
  const psiSentinel = sentinels.length
  const psiDeaths = sentinels.filter((r) => (r.severity_real ?? '').toUpperCase() === 'DEATH').length

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue" label="PSI Total" value={psi.length} />
        <MetricCard tone="red" label="Sentinel Events" value={psiSentinel} sub={psiDeaths > 0 ? `${psiDeaths} Death case(s)` : 'No Death cases'} />
        <MetricCard tone="red" label="Severe (Real)" value={sevReal.SEVERE} />
        <MetricCard tone="amber" label="Moderate" value={sevReal.MODERATE} />
        <MetricCard tone="blue" label="Mild" value={sevReal.MILD} />
        <MetricCard tone="green" label="No Harm" value={sevReal['NO HARM']} />
      </div>

      <div className="g2">
        <Panel title="Severity of Outcome (Real)">
          <SeverityDoughnut counts={sevReal} />
        </Panel>
        <Panel title="Severity of Outcome (Potential)">
          <SeverityDoughnut counts={sevPot} />
        </Panel>
      </div>

      <div className="g2">
        <Panel title="Sentinel Events">
          {sentinels.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>No sentinel events in current selection.</div>
          ) : (
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>IR No</th><th>Month</th><th>Dept</th><th>Category</th><th>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {sentinels.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
                      <td>{fmtMonth(r.incident_month)}</td>
                      <td>{r.dept_code ?? '—'}</td>
                      <td>{r.category ?? '—'}</td>
                      <td>
                        <SevBadge sev={r.severity_real} />
                        {(r.severity_real ?? '').toUpperCase() === 'DEATH' && (
                          <div style={{ color: 'var(--red)', fontSize: 10, marginTop: 3 }}>⚠️ Death recorded</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Severity by Category">
          {Array.from(byCat.entries()).length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>No data.</div>
          ) : (
            <div>
              {Array.from(byCat.entries())
                .sort(([, a], [, b]) => Object.values(b).reduce((x, y) => x + y, 0) - Object.values(a).reduce((x, y) => x + y, 0))
                .map(([cat, sevs]) => {
                  const total = Object.values(sevs).reduce((a, b) => a + b, 0)
                  if (total === 0) return null
                  return (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 3 }}>{cat}</div>
                      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--bg)' }}>
                        {SEVERITY_ORDER.map((s) => sevs[s] > 0 && (
                          <div
                            key={s}
                            title={`${s}: ${sevs[s]}`}
                            style={{ width: `${(sevs[s] / total) * 100}%`, background: SEVERITY_CHART[s] }}
                          />
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                        Total: {total}
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

function SeverityDoughnut({ counts: c }: { counts: Record<Severity, number> }) {
  const labels = SEVERITY_ORDER.filter((s) => c[s] > 0)
  if (labels.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 40 }}>No data</div>
  }
  return (
    <div style={{ height: 230 }}>
      <Doughnut
        data={{
          labels,
          datasets: [{
            data: labels.map((l) => c[l]),
            backgroundColor: labels.map((l) => SEVERITY_CHART[l]),
            borderWidth: 0,
          }],
        }}
        options={{
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0) || 1
                  const v = ctx.parsed as number
                  return `${ctx.label}: ${v} (${((v/total)*100).toFixed(1)}%)`
                },
              },
            },
          },
        }}
      />
    </div>
  )
}

/* =========================================================================
 * TAB 4 — INTERNAL INVESTIGATION
 * ========================================================================= */

function IiTab({ rows }: { rows: Incident[] }) {
  const iiCases = useMemo(() => rows.filter((r) => (r.is_ii ?? 0) === 1), [rows])
  const iiOverdue = useMemo(() => iiCases.filter((r) => (r.ii_status ?? '').includes('Overdue')), [iiCases])
  const iiPending = useMemo(() => iiCases.filter((r) => (r.ii_status ?? '').includes('Pending') && !(r.ii_status ?? '').includes('Overdue')), [iiCases])
  const iiOnTime = useMemo(() => iiCases.filter((r) => (r.ii_status ?? '').toLowerCase().includes('on time')), [iiCases])
  const iiLate = useMemo(() => iiCases.filter((r) => (r.ii_status ?? '').toLowerCase().includes('late') && !(r.ii_status ?? '').toLowerCase().includes('on time')), [iiCases])

  const overdueByDept = useMemo(() => sortedTop(counts(iiOverdue, (r) => r.action_dept)), [iiOverdue])
  const pendingByDept = useMemo(() => sortedTop(counts(iiPending, (r) => r.action_dept)), [iiPending])
  const onTimeByDept  = useMemo(() => sortedTop(counts(iiOnTime,  (r) => r.action_dept)), [iiOnTime])
  const lateByDept    = useMemo(() => sortedTop(counts(iiLate,    (r) => r.action_dept)), [iiLate])

  const byMonth = useMemo(() => {
    const acc = new Map<string, number>()
    for (const r of iiCases) {
      const k = submissionMonthKey(r); if (!k) continue
      acc.set(k, (acc.get(k) ?? 0) + 1)
    }
    const sorted = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
    return { labels: sorted.map(([k]) => monthLabel(k)), data: sorted.map(([, v]) => v) }
  }, [iiCases])

  const sevSummary = useMemo(() => severityCounts(iiCases), [iiCases])
  const catSummary = useMemo(() => sortedTop(counts(iiCases, (r) => r.category), 8), [iiCases])

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue"  label="Total II"   value={iiCases.length} />
        <MetricCard tone="red"   label="Overdue"    value={iiOverdue.length} />
        <MetricCard tone="amber" label="Pending"    value={iiPending.length} />
        <MetricCard tone="green" label="On Time"    value={iiOnTime.length} />
        <MetricCard tone="blue"  label="Late"       value={iiLate.length} />
      </div>

      <Panel title="Internal Investigations by Submission Month">
        <div style={{ height: 220 }}>
          <Line
            data={{
              labels: byMonth.labels,
              datasets: [{
                label: 'II',
                data: byMonth.data,
                borderColor: '#185FA5',
                backgroundColor: 'rgba(55, 138, 221, 0.18)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#185FA5',
              }],
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

      <div className="g2">
        <Panel title="Severity of II Cases">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            {SEVERITY_ORDER.map((s) => (
              <div key={s} style={{ padding: '10px 12px', borderRadius: 'var(--rs)', background: SEVERITY_BG[s], color: SEVERITY_FG[s] }}>
                <div style={{ fontSize: 10, opacity: 0.85, fontWeight: 600 }}>{s}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{sevSummary[s]}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Category of II Cases">
          <ProgressList items={catSummary.labels.map((l, i) => ({ label: l, value: catSummary.data[i], color: CATEGORY_COLORS[l] }))} />
        </Panel>
      </div>

      <Panel title="🚨 Overdue Cases — Requires Immediate Action">
        {iiOverdue.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>No Overdue cases ✓</div>
        ) : (
          <>
            <div className="psub" style={{ marginBottom: 6 }}>By Action Department</div>
            <div className="dept-heat">
              {overdueByDept.labels.map((d, i) => (
                <div className="dh-cell dh-red" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{overdueByDept.data[i]}</div>
                  <div className="dh-label">Overdue</div>
                </div>
              ))}
            </div>
            <div className="psub" style={{ marginTop: 12, marginBottom: 6 }}>Case List</div>
            <CompactCaseList rows={iiOverdue} status="Overdue" kind="ii" />
          </>
        )}
      </Panel>

      <Panel title="⏳ Pending Cases">
        {iiPending.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>No Pending cases ✓</div>
        ) : (
          <>
            <div className="psub" style={{ marginBottom: 6 }}>By Action Department</div>
            <div className="dept-heat">
              {pendingByDept.labels.map((d, i) => (
                <div className="dh-cell dh-amber" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{pendingByDept.data[i]}</div>
                  <div className="dh-label">Pending</div>
                </div>
              ))}
            </div>
            <div className="psub" style={{ marginTop: 12, marginBottom: 6 }}>Case List</div>
            <CompactCaseList rows={iiPending} status="Pending" kind="ii" />
          </>
        )}
      </Panel>

      <div className="g2">
        <Panel title="✅ On Time Submissions — by Action Department">
          {onTimeByDept.labels.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>None yet.</div>
          ) : (
            <div className="dept-heat">
              {onTimeByDept.labels.map((d, i) => (
                <div className="dh-cell dh-green" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{onTimeByDept.data[i]}</div>
                  <div className="dh-label">On Time</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="🔵 Late Submissions — by Action Department">
          {lateByDept.labels.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>None.</div>
          ) : (
            <div className="dept-heat">
              {lateByDept.labels.map((d, i) => (
                <div className="dh-cell dh-blue" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{lateByDept.data[i]}</div>
                  <div className="dh-label">Late</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

    </>
  )
}

function CompactCaseList({ rows, status, kind }: { rows: Incident[]; status: string; kind: 'ii' | 'rca' }) {
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th>Incident ID</th><th>Month</th><th>Dept</th><th>Category</th><th>Severity</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
              <td>{fmtMonth(r.incident_month)}</td>
              <td>{r.dept_code ?? '—'}</td>
              <td>{r.category ?? '—'}</td>
              <td><SevBadge sev={r.severity_real} /></td>
              <td><StatusBadge kind={kind} status={status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* =========================================================================
 * TAB 5 — RCA
 * ========================================================================= */

function RcaTab({ rows }: { rows: Incident[] }) {
  const rcaAll = useMemo(() => rows.filter((r) => (r.is_rca ?? 0) === 1), [rows])
  const rcaOverdue = useMemo(() => rcaAll.filter((r) => (r.rca_status ?? '').includes('Overdue')), [rcaAll])
  const rcaPendingOnly = useMemo(() => rcaAll.filter((r) => (r.rca_status ?? '').includes('Pending') && !(r.rca_status ?? '').includes('Overdue')), [rcaAll])
  const rcaOnTime = useMemo(() => rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('on time')), [rcaAll])
  const rcaLate = useMemo(() => rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('late') && !(r.rca_status ?? '').toLowerCase().includes('on time')), [rcaAll])

  const overdueByDept = useMemo(() => sortedTop(counts(rcaOverdue, (r) => r.action_dept)), [rcaOverdue])
  const pendingByDept = useMemo(() => sortedTop(counts(rcaPendingOnly, (r) => r.action_dept)), [rcaPendingOnly])
  const onTimeByDept  = useMemo(() => sortedTop(counts(rcaOnTime,  (r) => r.action_dept)), [rcaOnTime])
  const lateByDept    = useMemo(() => sortedTop(counts(rcaLate,    (r) => r.action_dept)), [rcaLate])

  const byMonth = useMemo(() => {
    const acc = new Map<string, number>()
    for (const r of rcaAll) {
      const k = submissionMonthKey(r); if (!k) continue
      acc.set(k, (acc.get(k) ?? 0) + 1)
    }
    const sorted = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
    return { labels: sorted.map(([k]) => monthLabel(k)), data: sorted.map(([, v]) => v) }
  }, [rcaAll])

  const rcaSev = useMemo(() => severityCounts(rcaAll), [rcaAll])
  const rcaCat = useMemo(() => sortedTop(counts(rcaAll, (r) => r.category), 8), [rcaAll])

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue"  label="Total RCA" value={rcaAll.length} />
        <MetricCard tone="red"   label="Overdue"   value={rcaOverdue.length} />
        <MetricCard tone="amber" label="Pending"   value={rcaPendingOnly.length} />
        <MetricCard tone="green" label="On Time"   value={rcaOnTime.length} />
        <MetricCard tone="blue"  label="Late"      value={rcaLate.length} />
      </div>

      <Panel title="RCA by Submission Month">
        <div style={{ height: 220 }}>
          <Line
            data={{
              labels: byMonth.labels,
              datasets: [{
                label: 'RCA',
                data: byMonth.data,
                borderColor: '#534AB7',
                backgroundColor: 'rgba(83, 74, 183, 0.18)',
                tension: 0.3,
                fill: true,
                pointRadius: 3,
                pointBackgroundColor: '#534AB7',
              }],
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

      <div className="g2">
        <Panel title="Severity of RCA Cases">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
            {SEVERITY_ORDER.map((s) => (
              <div key={s} style={{ padding: '10px 12px', borderRadius: 'var(--rs)', background: SEVERITY_BG[s], color: SEVERITY_FG[s] }}>
                <div style={{ fontSize: 10, opacity: 0.85, fontWeight: 600 }}>{s}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{rcaSev[s]}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Category of RCA Cases">
          <ProgressList items={rcaCat.labels.map((l, i) => ({ label: l, value: rcaCat.data[i], color: CATEGORY_COLORS[l] }))} />
        </Panel>
      </div>

      <Panel title="🚨 Overdue RCA Cases — Requires Immediate Action">
        {rcaOverdue.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>No Overdue RCA cases ✓</div>
        ) : (
          <>
            <div className="psub" style={{ marginBottom: 6 }}>By Action Department</div>
            <div className="dept-heat">
              {overdueByDept.labels.map((d, i) => (
                <div className="dh-cell dh-red" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{overdueByDept.data[i]}</div>
                  <div className="dh-label">Overdue</div>
                </div>
              ))}
            </div>
            <div className="psub" style={{ marginTop: 12, marginBottom: 6 }}>Case List</div>
            <CompactCaseList rows={rcaOverdue} status="Overdue" kind="rca" />
          </>
        )}
      </Panel>

      <Panel title="⏳ Pending RCA Cases">
        {rcaPendingOnly.length === 0 ? (
          <div style={{ color: 'var(--green)', fontSize: 12 }}>No Pending RCA cases ✓</div>
        ) : (
          <>
            <div className="psub" style={{ marginBottom: 6 }}>By Action Department</div>
            <div className="dept-heat">
              {pendingByDept.labels.map((d, i) => (
                <div className="dh-cell dh-amber" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{pendingByDept.data[i]}</div>
                  <div className="dh-label">Pending</div>
                </div>
              ))}
            </div>
            <div className="psub" style={{ marginTop: 12, marginBottom: 6 }}>Case List</div>
            <CompactCaseList rows={rcaPendingOnly} status="Pending" kind="rca" />
          </>
        )}
      </Panel>

      <div className="g2">
        <Panel title="✅ On Time Submissions — by Action Department">
          {onTimeByDept.labels.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>None yet.</div>
          ) : (
            <div className="dept-heat">
              {onTimeByDept.labels.map((d, i) => (
                <div className="dh-cell dh-green" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{onTimeByDept.data[i]}</div>
                  <div className="dh-label">On Time</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="🔵 Late Submissions — by Action Department">
          {lateByDept.labels.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>None.</div>
          ) : (
            <div className="dept-heat">
              {lateByDept.labels.map((d, i) => (
                <div className="dh-cell dh-blue" key={d}>
                  <div className="dh-dept">{d}</div>
                  <div className="dh-num">{lateByDept.data[i]}</div>
                  <div className="dh-label">Late</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

    </>
  )
}

/* =========================================================================
 * TAB 6 — REPORTING CULTURE
 * ========================================================================= */

function ReportingTab({ rows }: { rows: Incident[] }) {
  const psi = useMemo(() => rows.filter(isPsi), [rows])
  const reporters = useMemo(() => sortedTop(counts(psi, (r) => r.reporting_dept), 12), [psi])
  const totalReporters = useMemo(() => Array.from(counts(psi, (r) => r.reporting_dept).keys()).length, [psi])
  const actionDeptCount = useMemo(() => Array.from(counts(psi, (r) => r.action_dept).keys()).length, [psi])
  const mostActive = reporters.labels[0] ?? '—'

  const pvr = useMemo(() => primaryVsReporting(psi, 8), [psi])
  const trend = useMemo(() => reportingTrend(psi, 5), [psi])
  const actionWorkload = useMemo(() => sortedTop(counts(psi, (r) => r.action_dept), 12), [psi])

  const colors = ['#185FA5', '#1D9E75', '#EF9F27', '#A32D2D', '#534AB7']

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <MetricCard tone="blue" label="PSI Reports" value={psi.length} />
        <MetricCard tone="teal" label="Unique Reporting Depts" value={totalReporters} />
        <MetricCard tone="amber" label="Top Reporter" value={mostActive} />
        <MetricCard tone="purple" label="Action Depts" value={actionDeptCount} />
      </div>

      <div className="g2">
        <Panel title="Primary Dept vs Reporting Dept">
          <div style={{ height: 260 }}>
            <Bar
              data={{
                labels: pvr.depts,
                datasets: [
                  { label: 'Primary',   data: pvr.primary,   backgroundColor: '#185FA5', borderRadius: 4 },
                  { label: 'Reporting', data: pvr.reporting, backgroundColor: '#1D9E75', borderRadius: 4 },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
                scales: {
                  y: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                  x: { ticks: { font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </Panel>
        <Panel title="Who Files Reports">
          <ProgressList items={reporters.labels.map((l, i) => ({ label: l, value: reporters.data[i] }))} color="#1D9E75" />
        </Panel>
      </div>

      <Panel title="Reporting Trend by Month (Top 5 Reporting Depts)">
        <div className="legend">
          {trend.series.map((s, i) => (
            <div className="ld" key={s.dept}>
              <span className="ld-sw" style={{ background: colors[i % colors.length] }} />
              {s.dept}
            </div>
          ))}
        </div>
        <div style={{ height: 240, marginTop: 6 }}>
          <Line
            data={{
              labels: trend.months,
              datasets: trend.series.map((s, i) => ({
                label: s.dept,
                data: s.data,
                borderColor: colors[i % colors.length],
                backgroundColor: colors[i % colors.length],
                tension: 0.3,
                fill: false,
                pointRadius: 3,
              })),
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

      <Panel title="Action Dept Workload">
        <ProgressList items={actionWorkload.labels.map((l, i) => ({ label: l, value: actionWorkload.data[i] }))} color="#A32D2D" />
      </Panel>
    </>
  )
}

/* =========================================================================
 * TAB 7 — NON-PSI
 * ========================================================================= */

function NonPsiTab({ rows }: { rows: Incident[] }) {
  const nonPsi = useMemo(() => rows.filter((r) => !isPsi(r)), [rows])
  const closed = nonPsi.filter((r) => r.case_closed).length
  const subCats = useMemo(() => sortedTop(counts(nonPsi, (r) => r.sub_category), 12), [nonPsi])
  const byDept = useMemo(() => sortedTop(counts(nonPsi, (r) => r.dept_code), 12), [nonPsi])
  const byReportingDept = useMemo(() => sortedTop(counts(nonPsi, (r) => r.reporting_dept), 12), [nonPsi])
  const careCounts = useMemo(() => Array.from(counts(nonPsi, (r) => (r.care_setting ?? '').toUpperCase()).entries()), [nonPsi])
  const byMonth = useMemo(() => {
    const acc = new Map<string, number>()
    for (const r of nonPsi) {
      const k = monthKey(r.incident_month); if (!k) continue
      acc.set(k, (acc.get(k) ?? 0) + 1)
    }
    const sorted = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))
    return { labels: sorted.map(([k]) => monthLabel(k)), data: sorted.map(([, v]) => v) }
  }, [nonPsi])
  const monthCount = (k: string) => {
    const r = byMonth.labels.findIndex((l) => l === k)
    return r >= 0 ? byMonth.data[r] : 0
  }

  return (
    <>
      <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
        <MetricCard tone="gray"  label="Total Non-PSI" value={nonPsi.length} />
        <MetricCard tone="blue"  label="Dec 2025"      value={monthCount('Dec 2025')} />
        <MetricCard tone="blue"  label="Jan 2026"      value={monthCount('Jan 2026')} />
        <MetricCard tone="blue"  label="Feb 2026"      value={monthCount('Feb 2026')} />
        <MetricCard tone="blue"  label="Mar 2026"      value={monthCount('Mar 2026')} />
        <MetricCard tone="blue"  label="Apr 2026"      value={monthCount('Apr 2026')} />
        <MetricCard tone="green" label="Cases Closed"  value={closed} />
      </div>

      <Panel title="Non-PSI by Month">
        <div style={{ height: 220 }}>
          <Bar
            data={{ labels: byMonth.labels, datasets: [{ label: 'Non-PSI', data: byMonth.data, backgroundColor: '#888780', borderRadius: 4 }] }}
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

      <div className="g2">
        <Panel title="Care Setting (Non-PSI)">
          <div style={{ height: 220 }}>
            <Doughnut
              data={{
                labels: careCounts.map(([k]) => k),
                datasets: [{ data: careCounts.map(([, v]) => v), backgroundColor: ['#185FA5', '#E24B4A', '#1D9E75', '#EF9F27'], borderWidth: 0 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false, cutout: '60%',
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </div>
        </Panel>
        <Panel title="By Department">
          <ProgressList items={byDept.labels.map((l, i) => ({ label: l, value: byDept.data[i] }))} color="#888780" />
        </Panel>
      </div>

      <div className="g2">
        <Panel title="By Reporting Department">
          <ProgressList items={byReportingDept.labels.map((l, i) => ({ label: l, value: byReportingDept.data[i] }))} color="#378ADD" />
        </Panel>
        <Panel title="Sub-Category">
          <div style={{ height: 280 }}>
            <Bar
              data={{ labels: subCats.labels, datasets: [{ label: 'Count', data: subCats.data, backgroundColor: '#888780', borderRadius: 4 }] }}
              options={{
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: { beginAtZero: true, ticks: { font: { size: 11 } }, grid: { color: '#E0DED6' } },
                  y: { ticks: { font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </Panel>
      </div>

      <Panel title={`All Non-PSI Records (${nonPsi.length})`}>
        <div className="tw" style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>IR No</th><th>Month</th><th>Dept</th><th>Reporting Dept</th><th>Ward</th><th>Setting</th>
                <th>Sub-Category</th><th>Severity</th><th>Type</th><th>Action</th><th>Case</th>
              </tr>
            </thead>
            <tbody>
              {nonPsi.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
                  <td>{fmtMonth(r.incident_month)}</td>
                  <td>{r.dept_code ?? '—'}</td>
                  <td>{r.reporting_dept ?? '—'}</td>
                  <td>{r.ward ?? '—'}</td>
                  <td>{r.care_setting ?? '—'}</td>
                  <td>{r.sub_category ?? '—'}</td>
                  <td><SevBadge sev={r.severity_real} /></td>
                  <td><TypeBadge t={r.incident_type} /></td>
                  <td>{r.action_taken ?? '—'}</td>
                  <td><CaseBadge closed={r.case_closed} /></td>
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
 * TAB 8 — REPORT CARD
 * ========================================================================= */

type ReportMode = 'dept' | 'whole'

function ReportCardTab({ rows }: { rows: Incident[] }) {
  const [dept, setDept] = useState<string>(PRIMARY_DEPTS[0])
  const [period, setPeriod] = useState<PeriodKey>('YTD')
  const [generated, setGenerated] = useState<{ mode: ReportMode; dept: string; period: PeriodKey } | null>(null)

  const periodRows = useMemo(() => filterByPeriod(rows, period), [rows, period])

  function generate(mode: ReportMode) {
    setGenerated({ mode, dept, period })
  }

  function downloadPdf() {
    if (typeof window === 'undefined') return
    const preview = document.getElementById('rc-preview')
    if (!preview) return
    const pages = Array.from(preview.querySelectorAll<HTMLElement>('.rc-page'))
    if (pages.length === 0) return

    // Convert each <canvas> chart to a static <img> data-URL before serializing.
    // outerHTML preserves the canvas tag but not its bitmap, so Chart.js charts
    // would otherwise vanish in the new print window (where no JS redraws them).
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
        } catch {
          // toDataURL may throw if the canvas is tainted; leave the clone canvas as-is.
        }
      })
      return clone
    })

    const pageHtml = clonedPages.map((p) => p.outerHTML).join('\n')
    const css = Array.from(document.styleSheets)
      .map((s) => {
        try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
        catch { return '' }
      })
      .join('\n')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Report Card</title><style>${css}\n@page{size:A4;margin:0}body{margin:0;padding:0;background:#fff;}</style></head><body>${pageHtml}<script>window.onload=()=>window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  return (
    <>
      <div className="rc-controls">
        <div className="pf">
          <div>
            <div className="pt">Department Report Card 2026</div>
            <div className="psub">Select department and period to generate. Includes IR Overview, RCA, and Internal Investigation sections.</div>
          </div>
        </div>
        <div className="row">
          <div>
            <label>Department</label>
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <optgroup label="Primary Departments">
                {PRIMARY_DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </optgroup>
              <optgroup label="Action Departments">
                {ACTION_DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </optgroup>
            </select>
          </div>
          <div>
            <label>Period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
              {PERIOD_OPTIONS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <button className="btn" type="button" onClick={() => generate('dept')}>Generate Report</button>
          <button className="btn ghost" type="button" onClick={() => generate('whole')}>🏥 Whole Hospital</button>
          <button className="btn ghost" type="button" onClick={downloadPdf} disabled={!generated}>⬇ Download PDF</button>
        </div>
      </div>

      <div className="rc-preview" id="rc-preview">
        {!generated && (
          <div style={{ background: '#fff', padding: 30, borderRadius: 6, color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
            Choose a department + period and press <b>Generate Report</b>.
          </div>
        )}
        {generated?.mode === 'whole' && <HospitalReport rows={periodRows} period={generated.period} />}
        {generated?.mode === 'dept' && PRIMARY_DEPTS.includes(generated.dept) && (
          <PrimaryDeptReport rows={periodRows} dept={generated.dept} period={generated.period} />
        )}
        {generated?.mode === 'dept' && ACTION_DEPTS.includes(generated.dept) && (
          <ActionDeptReport rows={periodRows} dept={generated.dept} period={generated.period} />
        )}
      </div>
    </>
  )
}

function ReportFooter() {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="rc-foot">
      Clinical Risk Unit RMCQ · Confidential · Not for circulation · Generated: {today}
    </div>
  )
}

function periodLabelFor(p: PeriodKey): string {
  for (const g of PERIOD_OPTIONS) {
    const o = g.options.find((x) => x.value === p)
    if (o) return o.label
  }
  return p
}

function tlForRate(value: number, target: number, higherIsBetter: boolean): string {
  if (higherIsBetter ? value >= target : value <= target) return '🟢'
  if (higherIsBetter ? value >= target * 0.7 : value <= target * 1.3) return '🟡'
  return '🔴'
}

function HospitalReport({ rows, period }: { rows: Incident[]; period: PeriodKey }) {
  const psi = rows.filter(isPsi)
  const sentinel = psi.filter((r) => r.sentinel).length
  const nearMiss = psi.filter((r) => (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '') === 'NEARMISS').length
  const ii = iiBuckets(rows)
  const rca = rcaBuckets(rows)
  const cats = sortedTop(counts(psi, (r) => r.category), 10)
  const depts = sortedTop(counts(psi, (r) => r.dept_code), 10)
  const sev = severityCounts(psi)

  // monthly trend
  const acc = new Map<string, number>()
  for (const r of psi) { const k = monthKey(r.incident_month); if (k) acc.set(k, (acc.get(k) ?? 0) + 1) }
  const monthly = Array.from(acc.entries()).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">Hospital-Wide Summary</div>
        <div className="t2">Hospital Al-Sultan Abdullah UiTM · {periodLabelFor(period)}</div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 1 — Key Performance Indicators</div>
        <div className="rc-kpis">
          <div className="rc-kpi"><div className="l">Total PSI</div><div className="v" style={{ color: 'var(--blue)' }}>{psi.length}</div></div>
          <div className="rc-kpi"><div className="l">Sentinel</div><div className="v" style={{ color: 'var(--red)' }}>{sentinel}</div></div>
          <div className="rc-kpi"><div className="l">Near Miss</div><div className="v" style={{ color: 'var(--green)' }}>{nearMiss}</div></div>
          <div className="rc-kpi"><div className="l">II Overdue</div><div className="v" style={{ color: 'var(--red)' }}>{ii.overdue.length}</div></div>
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 2 — Monthly Trend</div>
        <div style={{ height: 130 }}>
          <Line
            data={{
              labels: monthly.map(([k]) => monthLabel(k)),
              datasets: [{ label: 'PSI', data: monthly.map(([, v]) => v), borderColor: '#185FA5', backgroundColor: '#185FA5', tension: 0.3, fill: false, pointRadius: 3 }],
            }}
            options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } }}
          />
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 3 — PSI by Category</div>
        <div style={{ height: 140 }}>
          <Bar
            data={{ labels: cats.labels, datasets: [{ data: cats.data, backgroundColor: '#1D9E75', borderRadius: 3 }] }}
            options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } }}
          />
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 4 — PSI by Department</div>
        <div style={{ height: 130 }}>
          <Bar
            data={{ labels: depts.labels, datasets: [{ data: depts.data, backgroundColor: '#378ADD', borderRadius: 3 }] }}
            options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } }}
          />
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 5 — Severity Breakdown</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {SEVERITY_ORDER.map((s) => (
            <div key={s} style={{ background: SEVERITY_BG[s], color: SEVERITY_FG[s], padding: 6, borderRadius: 4 }}>
              <div style={{ fontSize: 8, opacity: 0.85, fontWeight: 700 }}>{s}</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{sev[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Section 6 — II & RCA Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Internal Investigation</div>
            <SmallStatusRow color="var(--red)"   label="Overdue" n={ii.overdue.length} />
            <SmallStatusRow color="var(--amber)" label="Pending" n={ii.pending.length} />
            <SmallStatusRow color="var(--green)" label="On Time" n={ii.onTime} />
            <SmallStatusRow color="var(--blue)"  label="Late"    n={ii.late} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Root Cause Analysis</div>
            <SmallStatusRow color="var(--red)"   label="Overdue" n={rca.overdue.length} />
            <SmallStatusRow color="var(--amber)" label="Pending" n={rca.pending.length} />
            <SmallStatusRow color="var(--green)" label="On Time" n={rca.onTime} />
            <SmallStatusRow color="var(--blue)"  label="Late"    n={rca.late} />
          </div>
        </div>
      </div>

      <ReportFooter />
    </div>
  )
}

function SmallStatusRow({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, marginBottom: 3, fontSize: 10 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
        {label}
      </span>
      <span style={{ color, fontWeight: 700 }}>{n}</span>
    </div>
  )
}

function PrimaryDeptReport({ rows, dept, period }: { rows: Incident[]; dept: string; period: PeriodKey }) {
  const deptRows = rows.filter((r) => r.dept_code === dept)
  const psi = deptRows.filter(isPsi)
  const sentinel = psi.filter((r) => r.sentinel).length
  const deaths = psi.filter((r) => (r.severity_real ?? '').toUpperCase() === 'DEATH').length
  const actual = psi.filter((r) => (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '') === 'ACTUAL').length
  const near = psi.filter((r) => (r.incident_type ?? '').toUpperCase().replace(/\s+/g, '') === 'NEARMISS').length

  // Reporting culture (PSI only): self-reported = dept_code === reporting_dept
  const selfReported = psi.filter((r) => (r.reporting_dept ?? '').trim() === dept).length
  const otherReported = psi.length - selfReported
  const selfPct = psi.length ? Math.round((selfReported / psi.length) * 100) : 0

  // Monthly trend by submission date (date of reporting)
  const monthAcc = new Map<string, number>()
  for (const r of psi) { const k = submissionMonthKey(r); if (k) monthAcc.set(k, (monthAcc.get(k) ?? 0) + 1) }
  const monthly = Array.from(monthAcc.entries()).sort(([a], [b]) => a.localeCompare(b))

  const byCat = sortedTop(counts(psi, (r) => r.category), 10)
  const byWard = sortedTop(counts(psi, (r) => r.ward), 10)
  const sev = severityCounts(psi)
  const actionTaken = sortedTop(counts(psi, (r) => r.action_taken), 10)

  // Section 8 — Incidents Under Department Management (action_dept = selected dept), PSI only
  const underMgmt = rows.filter((r) => r.action_dept === dept && isPsi(r))

  // Section 9/10 — II & RCA (cases where action_dept = dept)
  const iiAll = underMgmt.filter((r) => (r.is_ii ?? 0) === 1)
  const iiOverdue = iiAll.filter((r) => (r.ii_status ?? '').includes('Overdue'))
  const iiPending = iiAll.filter((r) => (r.ii_status ?? '').includes('Pending') && !(r.ii_status ?? '').includes('Overdue'))
  const iiOnTime = iiAll.filter((r) => (r.ii_status ?? '').toLowerCase().includes('on time'))
  const iiLate = iiAll.filter((r) => (r.ii_status ?? '').toLowerCase().includes('late') && !(r.ii_status ?? '').toLowerCase().includes('on time'))

  const rcaAll = underMgmt.filter((r) => (r.is_rca ?? 0) === 1)
  const rcaOverdue = rcaAll.filter((r) => (r.rca_status ?? '').includes('Overdue'))
  const rcaPendingOnly = rcaAll.filter((r) => (r.rca_status ?? '').includes('Pending') && !(r.rca_status ?? '').includes('Overdue'))
  const rcaOnTime = rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('on time'))
  const rcaLate = rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('late') && !(r.rca_status ?? '').toLowerCase().includes('on time'))

  // Section 11 — IR Under Other Department Management
  // own (this dept's PSI) where action_dept !== dept AND action is II/RCA/Internal Inquiry/M&M
  const TARGET_ACTIONS = ['INTERNAL INVESTIGATION', 'RCA', 'INTERNAL INQUIRY', 'M&M']
  const otherMgmt = psi.filter((r) => {
    if (r.action_dept === dept || r.dept_code !== dept) return false
    const a = (r.action_taken ?? '').toUpperCase().trim()
    return TARGET_ACTIONS.includes(a)
  })
  const otherCounts = {
    ii: otherMgmt.filter((r) => (r.action_taken ?? '').toUpperCase().trim() === 'INTERNAL INVESTIGATION').length,
    rca: otherMgmt.filter((r) => (r.action_taken ?? '').toUpperCase().trim() === 'RCA').length,
    inquiry: otherMgmt.filter((r) => (r.action_taken ?? '').toUpperCase().trim() === 'INTERNAL INQUIRY').length,
    mm: otherMgmt.filter((r) => (r.action_taken ?? '').toUpperCase().trim() === 'M&M').length,
  }

  return (
    <>
      {/* PAGE 1 */}
      <div className="rc-page">
        <div className="rc-h">
          <div className="t1">{dept} — Department Report</div>
          <div className="t2">{periodLabelFor(period)} · Patient Safety Incidents Only</div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 1 — Department KPIs</div>
          <div className="rc-kpis">
            <div className="rc-kpi"><div className="l">Total PSI</div><div className="v" style={{ color: 'var(--blue)' }}>{tlForRate(psi.length, 5, false)} {psi.length}</div></div>
            <div className="rc-kpi"><div className="l">Sentinel</div><div className="v" style={{ color: 'var(--red)' }}>{sentinel === 0 ? '🟢' : '🔴'} {sentinel}</div><div className="s">{deaths} death(s)</div></div>
            <div className="rc-kpi"><div className="l">Actual</div><div className="v" style={{ color: 'var(--blue)' }}>{actual}</div></div>
            <div className="rc-kpi"><div className="l">Near Miss</div><div className="v" style={{ color: 'var(--green)' }}>🟢 {near}</div></div>
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 2 — Monthly Trend (PSI per Month)</div>
          <div style={{ height: 130 }}>
            <Line
              data={{
                labels: monthly.map(([k]) => monthLabel(k)),
                datasets: [{ label: 'PSI', data: monthly.map(([, v]) => v), borderColor: '#185FA5', backgroundColor: '#185FA5', tension: 0.3, fill: false, pointRadius: 3 }],
              }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } }}
            />
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 3 — Reporting Culture (IR by Staff)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div className="rc-kpi">
              <div className="l">Self-Reported (by {dept})</div>
              <div className="v" style={{ color: 'var(--green)' }}>{selfReported}</div>
            </div>
            <div className="rc-kpi">
              <div className="l">Reported by Other Depts</div>
              <div className="v" style={{ color: 'var(--blue)' }}>{otherReported}</div>
            </div>
            <div className="rc-kpi">
              <div className="l">Self-Reporting %</div>
              <div className="v" style={{ color: selfPct >= 70 ? 'var(--green)' : selfPct >= 40 ? 'var(--amber)' : 'var(--red)' }}>{selfPct >= 70 ? '🟢' : selfPct >= 40 ? '🟡' : '🔴'} {selfPct}%</div>
            </div>
          </div>
        </div>

        <ReportFooter />
      </div>

      {/* PAGE 2 */}
      <div className="rc-page">
        <div className="rc-h"><div className="t1">{dept} — Page 2</div></div>

        <div className="rc-section">
          <div className="rc-st">Section 4 — Incidents by Category</div>
          <div style={{ height: 150 }}>
            <Bar
              data={{ labels: byCat.labels, datasets: [{ data: byCat.data, backgroundColor: byCat.labels.map((c) => CATEGORY_COLORS[c] ?? '#888780'), borderRadius: 3 }] }}
              options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } }}
            />
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 5 — Location / Ward Breakdown</div>
          <CompactProgressList items={byWard.labels.map((l, i) => ({ label: l, value: byWard.data[i] }))} color="#185FA5" />
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 6 — Severity of Outcome (Real)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {SEVERITY_ORDER.map((s) => (
              <div key={s} style={{ background: SEVERITY_BG[s], color: SEVERITY_FG[s], padding: 6, borderRadius: 4 }}>
                <div style={{ fontSize: 8, opacity: 0.85, fontWeight: 700 }}>{s}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{sev[s]}</div>
              </div>
            ))}
          </div>
        </div>

        <ReportFooter />
      </div>

      {/* PAGE 3 */}
      <div className="rc-page">
        <div className="rc-h"><div className="t1">{dept} — Page 3</div></div>

        <div className="rc-section">
          <div className="rc-st">Section 7 — Action Taken</div>
          <div style={{ height: 150 }}>
            <Bar
              data={{ labels: actionTaken.labels, datasets: [{ data: actionTaken.data, backgroundColor: '#1D9E75', borderRadius: 3 }] }}
              options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } } }}
            />
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 8 — Incidents Under Department Management ({underMgmt.length})</div>
          <UnderMgmtTable rows={underMgmt.slice(0, 14)} />
          {underMgmt.length > 14 && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>… and {underMgmt.length - 14} more</div>}
        </div>

        <ReportFooter />
      </div>

      {/* PAGE 4 — II */}
      <DeptIiPageDetail
        dept={dept}
        all={iiAll}
        overdue={iiOverdue}
        pending={iiPending}
        onTime={iiOnTime}
        late={iiLate}
      />

      {/* PAGE 5 — RCA */}
      <DeptRcaPageDetail
        dept={dept}
        all={rcaAll}
        overdue={rcaOverdue}
        pending={rcaPendingOnly}
        onTime={rcaOnTime}
        late={rcaLate}
      />

      {/* PAGE 6 — IR under other dept mgmt */}
      <div className="rc-page">
        <div className="rc-h"><div className="t1">{dept} — Page 6</div></div>
        <div className="rc-section">
          <div className="rc-st">Section 11 — IR Under Other Department Management</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
            Patients belong to <b>{dept}</b> where action is handled by another department.
            Incidents involving {dept} patients that require formal investigation — action managed by another department.
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Total: {otherMgmt.length} incidents — II: {otherCounts.ii}  |  RCA: {otherCounts.rca}  |  Internal Inquiry: {otherCounts.inquiry}  |  M&amp;M: {otherCounts.mm}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Incident ID</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Month</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Severity</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Action Dept</th>
                <th style={{ textAlign: 'left', padding: '3px 5px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {otherMgmt.slice(0, 22).map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
                  <td style={{ padding: '3px 5px' }}>{fmtMonth(r.incident_month)}</td>
                  <td style={{ padding: '3px 5px' }}>{r.category ?? '—'}</td>
                  <td style={{ padding: '3px 5px' }}>{r.severity_real ?? '—'}</td>
                  <td style={{ padding: '3px 5px' }}>{r.action_taken ?? '—'}</td>
                  <td style={{ padding: '3px 5px' }}>{r.action_dept ?? '—'}</td>
                  <td style={{ padding: '3px 5px' }}>{r.case_closed ? 'Closed' : 'Open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {otherMgmt.length > 22 && <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>… and {otherMgmt.length - 22} more</div>}
        </div>
        <ReportFooter />
      </div>
    </>
  )
}

function CompactProgressList({ items, color }: { items: { label: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, marginBottom: 3 }}>
          <div style={{ width: 80, textAlign: 'right', color: 'var(--text)' }}>{it.label}</div>
          <div style={{ flex: 1, height: 8, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(it.value / max) * 100}%`, background: color }} />
          </div>
          <div style={{ width: 24, color: 'var(--muted)', textAlign: 'right' }}>{it.value}</div>
        </div>
      ))}
    </div>
  )
}

function SmallTable({ rows }: { rows: Incident[] }) {
  if (rows.length === 0) return <div style={{ fontSize: 9, color: 'var(--muted)' }}>None.</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
      <thead>
        <tr style={{ background: 'var(--bg)' }}>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>IR No</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Month</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Dept</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Category</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Severity</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{fmtMonth(r.incident_month)}</td>
            <td style={{ padding: '3px 5px' }}>{r.dept_code ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.category ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.severity_real ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.action_taken ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function UnderMgmtTable({ rows }: { rows: Incident[] }) {
  if (rows.length === 0) return <div style={{ fontSize: 9, color: 'var(--muted)' }}>None.</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
      <thead>
        <tr style={{ background: 'var(--bg)' }}>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>IR No</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Month</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Primary Dept</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Category</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Severity</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Action</th>
          <th style={{ textAlign: 'left', padding: '3px 5px' }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ padding: '3px 5px', fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{fmtMonth(r.incident_month)}</td>
            <td style={{ padding: '3px 5px' }}>{r.dept_code ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.category ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.severity_real ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.action_taken ?? '—'}</td>
            <td style={{ padding: '3px 5px' }}>{r.case_closed ? 'Closed' : 'Open'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DeptIiPageDetail({ dept, all, overdue, pending, onTime, late }: { dept: string; all: Incident[]; overdue: Incident[]; pending: Incident[]; onTime: Incident[]; late: Incident[] }) {
  const sev = severityCounts(all)
  const cats = sortedTop(counts(all, (r) => r.category), 8)
  const compliance = all.length ? Math.round(((onTime.length + late.length) / all.length) * 100) : 0
  const overdueByDept = sortedTop(counts(overdue, (r) => r.action_dept))
  const pendingByDept = sortedTop(counts(pending, (r) => r.action_dept))
  return (
    <div className="rc-page">
      <div className="rc-h"><div className="t1">{dept} — Section 9: Internal Investigation</div></div>
      <div className="rc-section">
        <div className="rc-kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <div className="rc-kpi"><div className="l">Total II</div><div className="v" style={{ color: 'var(--blue)' }}>{all.length}</div></div>
          <div className="rc-kpi"><div className="l">Overdue</div><div className="v" style={{ color: 'var(--red)' }}>{overdue.length}</div></div>
          <div className="rc-kpi"><div className="l">Pending</div><div className="v" style={{ color: 'var(--amber)' }}>{pending.length}</div></div>
          <div className="rc-kpi"><div className="l">On Time</div><div className="v" style={{ color: 'var(--green)' }}>{onTime.length}</div></div>
          <div className="rc-kpi"><div className="l">Late</div><div className="v" style={{ color: 'var(--blue)' }}>{late.length}</div></div>
          <div className="rc-kpi"><div className="l">Compliance</div><div className="v" style={{ color: compliance >= 70 ? 'var(--green)' : compliance >= 40 ? 'var(--amber)' : 'var(--red)' }}>{compliance}%</div></div>
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Severity of II Cases</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {SEVERITY_ORDER.map((s) => (
            <div key={s} style={{ background: SEVERITY_BG[s], color: SEVERITY_FG[s], padding: 6, borderRadius: 4 }}>
              <div style={{ fontSize: 8, opacity: 0.85, fontWeight: 700 }}>{s}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sev[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Category of II Cases</div>
        <CompactProgressList items={cats.labels.map((l, i) => ({ label: l, value: cats.data[i] }))} color="#185FA5" />
      </div>

      {overdue.length > 0 && (
        <div className="rc-section">
          <div className="rc-st">Overdue Cases</div>
          {overdueByDept.labels.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>By Action Dept: {overdueByDept.labels.map((d, i) => `${d} (${overdueByDept.data[i]})`).join(' · ')}</div>
          )}
          <SmallTable rows={overdue.slice(0, 8)} />
        </div>
      )}
      {pending.length > 0 && (
        <div className="rc-section">
          <div className="rc-st">Pending Cases</div>
          {pendingByDept.labels.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>By Action Dept: {pendingByDept.labels.map((d, i) => `${d} (${pendingByDept.data[i]})`).join(' · ')}</div>
          )}
          <SmallTable rows={pending.slice(0, 8)} />
        </div>
      )}

      <ReportFooter />
    </div>
  )
}

function DeptRcaPageDetail({ dept, all, overdue, pending, onTime, late }: { dept: string; all: Incident[]; overdue: Incident[]; pending: Incident[]; onTime: Incident[]; late: Incident[] }) {
  const sev = severityCounts(all)
  const cats = sortedTop(counts(all, (r) => r.category), 8)
  const compliance = all.length ? Math.round(((onTime.length + late.length) / all.length) * 100) : 0
  const overdueByDept = sortedTop(counts(overdue, (r) => r.action_dept))
  const pendingByDept = sortedTop(counts(pending, (r) => r.action_dept))
  return (
    <div className="rc-page">
      <div className="rc-h"><div className="t1">{dept} — Section 10: Root Cause Analysis</div></div>
      <div className="rc-section">
        <div className="rc-kpis" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <div className="rc-kpi"><div className="l">Total RCA</div><div className="v" style={{ color: 'var(--blue)' }}>{all.length}</div></div>
          <div className="rc-kpi"><div className="l">Overdue</div><div className="v" style={{ color: 'var(--red)' }}>{overdue.length}</div></div>
          <div className="rc-kpi"><div className="l">Pending</div><div className="v" style={{ color: 'var(--amber)' }}>{pending.length}</div></div>
          <div className="rc-kpi"><div className="l">On Time</div><div className="v" style={{ color: 'var(--green)' }}>{onTime.length}</div></div>
          <div className="rc-kpi"><div className="l">Late</div><div className="v" style={{ color: 'var(--blue)' }}>{late.length}</div></div>
          <div className="rc-kpi"><div className="l">Compliance</div><div className="v" style={{ color: compliance >= 70 ? 'var(--green)' : compliance >= 40 ? 'var(--amber)' : 'var(--red)' }}>{compliance}%</div></div>
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Severity of RCA Cases</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {SEVERITY_ORDER.map((s) => (
            <div key={s} style={{ background: SEVERITY_BG[s], color: SEVERITY_FG[s], padding: 6, borderRadius: 4 }}>
              <div style={{ fontSize: 8, opacity: 0.85, fontWeight: 700 }}>{s}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sev[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">Category of RCA Cases</div>
        <CompactProgressList items={cats.labels.map((l, i) => ({ label: l, value: cats.data[i] }))} color="#534AB7" />
      </div>

      {overdue.length > 0 && (
        <div className="rc-section">
          <div className="rc-st">Overdue Cases</div>
          {overdueByDept.labels.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>By Action Dept: {overdueByDept.labels.map((d, i) => `${d} (${overdueByDept.data[i]})`).join(' · ')}</div>
          )}
          <SmallTable rows={overdue.slice(0, 8)} />
        </div>
      )}
      {pending.length > 0 && (
        <div className="rc-section">
          <div className="rc-st">Pending Cases</div>
          {pendingByDept.labels.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>By Action Dept: {pendingByDept.labels.map((d, i) => `${d} (${pendingByDept.data[i]})`).join(' · ')}</div>
          )}
          <SmallTable rows={pending.slice(0, 8)} />
        </div>
      )}

      <ReportFooter />
    </div>
  )
}

function ActionDeptReport({ rows, dept, period }: { rows: Incident[]; dept: string; period: PeriodKey }) {
  // PSI ONLY incidents assigned to this dept (Action Dept)
  const allResp = rows.filter((r) => r.action_dept === dept && isPsi(r))

  // II / RCA computed inline
  const iiAll = allResp.filter((r) => (r.is_ii ?? 0) === 1)
  const iiOverdue = iiAll.filter((r) => (r.ii_status ?? '').includes('Overdue'))
  const iiPending = iiAll.filter((r) => (r.ii_status ?? '').includes('Pending') && !(r.ii_status ?? '').includes('Overdue'))
  const iiOnTime = iiAll.filter((r) => (r.ii_status ?? '').toLowerCase().includes('on time'))
  const iiLate = iiAll.filter((r) => (r.ii_status ?? '').toLowerCase().includes('late') && !(r.ii_status ?? '').toLowerCase().includes('on time'))
  const iiCompliance = iiAll.length ? Math.round(((iiOnTime.length + iiLate.length) / iiAll.length) * 100) : 0

  const rcaAll = allResp.filter((r) => (r.is_rca ?? 0) === 1)
  const rcaOverdue = rcaAll.filter((r) => (r.rca_status ?? '').includes('Overdue'))
  const rcaPending = rcaAll.filter((r) => (r.rca_status ?? '').includes('Pending') && !(r.rca_status ?? '').includes('Overdue'))
  const rcaOnTime = rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('on time'))
  const rcaLate = rcaAll.filter((r) => (r.rca_status ?? '').toLowerCase().includes('late') && !(r.rca_status ?? '').toLowerCase().includes('on time'))
  const rcaCompliance = rcaAll.length ? Math.round(((rcaOnTime.length + rcaLate.length) / rcaAll.length) * 100) : 0

  // Monthly trend (by submission date)
  const monthAcc = new Map<string, number>()
  for (const r of allResp) { const k = submissionMonthKey(r); if (k) monthAcc.set(k, (monthAcc.get(k) ?? 0) + 1) }
  const monthly = Array.from(monthAcc.entries()).sort(([a], [b]) => a.localeCompare(b))

  // Page 2 content
  const cats = sortedTop(counts(allResp, (r) => r.category), 10)
  const sev = severityCounts(allResp)
  const actionTaken = sortedTop(counts(allResp, (r) => r.action_taken), 10)
  const primaryDepts = sortedTop(counts(allResp, (r) => r.dept_code), 10)

  return (
    <>
      <div className="rc-page">
        <div className="rc-h">
          <div className="t1">{dept} — Action Department Report</div>
          <div className="t2">{periodLabelFor(period)}</div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 1 — Summary</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', alignItems: 'stretch', gap: 8 }}>
            <div className="rc-kpi" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="l">Total Assigned</div>
              <div style={{ fontSize: 40, fontWeight: 700, color: 'var(--blue)', lineHeight: 1 }}>{allResp.length}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div className="rc-kpi"><div className="l">Total II</div><div className="v" style={{ color: 'var(--blue)' }}>{iiAll.length}</div></div>
              <div className="rc-kpi"><div className="l">II Overdue</div><div className="v" style={{ color: 'var(--red)' }}>{iiOverdue.length}</div></div>
              <div className="rc-kpi" style={{ gridColumn: '1 / -1' }}>
                <div className="l">II Submission Compliance</div>
                <div className="v" style={{ color: iiCompliance >= 70 ? 'var(--green)' : iiCompliance >= 40 ? 'var(--amber)' : 'var(--red)' }}>{iiCompliance >= 70 ? '🟢' : iiCompliance >= 40 ? '🟡' : '🔴'} {iiCompliance}%</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div className="rc-kpi"><div className="l">Total RCA</div><div className="v" style={{ color: 'var(--blue)' }}>{rcaAll.length}</div></div>
              <div className="rc-kpi"><div className="l">RCA Overdue</div><div className="v" style={{ color: 'var(--red)' }}>{rcaOverdue.length}</div></div>
              <div className="rc-kpi" style={{ gridColumn: '1 / -1' }}>
                <div className="l">RCA Submitted %</div>
                <div className="v" style={{ color: rcaCompliance >= 70 ? 'var(--green)' : rcaCompliance >= 40 ? 'var(--amber)' : 'var(--red)' }}>{rcaCompliance >= 70 ? '🟢' : rcaCompliance >= 40 ? '🟡' : '🔴'} {rcaCompliance}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 2 — Monthly Trend (Assigned per Month)</div>
          <div style={{ height: 130 }}>
            <Line
              data={{ labels: monthly.map(([k]) => monthLabel(k)), datasets: [{ data: monthly.map(([, v]) => v), borderColor: '#185FA5', backgroundColor: '#185FA5', tension: 0.3, fill: false, pointRadius: 3 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } }}
            />
          </div>
        </div>

        <ReportFooter />
      </div>

      <div className="rc-page">
        <div className="rc-h"><div className="t1">{dept} — Page 2</div></div>

        <div className="rc-section">
          <div className="rc-st">Section 3 — Category of Incidents</div>
          <CompactProgressList items={cats.labels.map((l, i) => ({ label: l, value: cats.data[i] }))} color="#1D9E75" />
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 4 — Severity of Incidents</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {SEVERITY_ORDER.map((s) => (
              <div key={s} style={{ background: SEVERITY_BG[s], color: SEVERITY_FG[s], padding: 6, borderRadius: 4 }}>
                <div style={{ fontSize: 8, opacity: 0.85, fontWeight: 700 }}>{s}</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{sev[s]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 5 — Action Taken Summary</div>
          <CompactProgressList items={actionTaken.labels.map((l, i) => ({ label: l, value: actionTaken.data[i] }))} color="#378ADD" />
        </div>

        <div className="rc-section">
          <div className="rc-st">Section 6 — Patient&rsquo;s Primary Departments</div>
          <CompactProgressList items={primaryDepts.labels.map((l, i) => ({ label: l, value: primaryDepts.data[i] }))} color="#185FA5" />
        </div>

        <ReportFooter />
      </div>

      <DeptIiPageDetail
        dept={dept}
        all={iiAll}
        overdue={iiOverdue}
        pending={iiPending}
        onTime={iiOnTime}
        late={iiLate}
      />

      <DeptRcaPageDetail
        dept={dept}
        all={rcaAll}
        overdue={rcaOverdue}
        pending={rcaPending}
        onTime={rcaOnTime}
        late={rcaLate}
      />
    </>
  )
}

/* =========================================================================
 * TAB 9 — ALL RECORDS
 * ========================================================================= */

function AllRecordsTab({ rows }: { rows: Incident[] }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [search, rows])

  const q = search.trim().toLowerCase()
  const matched = useMemo(() =>
    q
      ? rows.filter((r) =>
          [r.incident_id, r.dept_code, r.category, r.ward]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : rows
  , [rows, q])

  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const slice = matched.slice(start, start + PAGE_SIZE)

  return (
    <div className="panel">
      <div className="pf">
        <div>
          <div className="pt">All Records</div>
          <div className="psub">Showing {matched.length === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, matched.length)} of {matched.length} records</div>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search IR No, dept, category, ward…"
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 'var(--rs)', fontSize: 12, width: 280, fontFamily: 'inherit' }}
        />
      </div>

      <div className="tw" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>IR No</th><th>Month</th><th>Dept</th><th>Ward</th>
              <th>Category</th><th>Sub-Category</th><th>Severity Real</th>
              <th>Type</th><th>Sentinel</th><th>Case</th>
              <th>RCA</th><th>II</th><th>Due Date</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const rcaState = parseRcaStatus(r.rca_status)
              const iiState = parseIiStatus(r.ii_status)
              const overdue = isOverdue(r.action_due_date)
              return (
                <tr key={r.id}>
                  <td style={{ fontFamily: 'monospace' }}>{r.incident_id ?? '—'}</td>
                  <td>{fmtMonth(r.incident_month)}</td>
                  <td>{r.dept_code ?? '—'}</td>
                  <td>{r.ward ?? '—'}</td>
                  <td title={r.category ?? ''} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.category ?? '—'}</td>
                  <td title={r.sub_category ?? ''} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub_category ?? '—'}</td>
                  <td><SevBadge sev={r.severity_real} /></td>
                  <td><TypeBadge t={r.incident_type} /></td>
                  <td><SentinelBadge on={r.sentinel} /></td>
                  <td><CaseBadge closed={r.case_closed} /></td>
                  <td>
                    {(r.is_rca ?? 0) === 1 && rcaState !== 'Non-RCA' && rcaState !== 'Unknown'
                      ? <StatusBadge kind="rca" status={rcaState} />
                      : <span className="b b-gray">Non-RCA</span>}
                  </td>
                  <td>
                    {(r.is_ii ?? 0) === 1 && iiState !== 'Non-II' && iiState !== 'Unknown'
                      ? <StatusBadge kind="ii" status={iiState} />
                      : <span className="b b-gray">Non-II</span>}
                  </td>
                  <td style={overdue ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                    {r.action_due_date ?? '—'}
                  </td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr>
                <td colSpan={13} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No records.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10, fontSize: 11 }}>
        <button
          className="reset-btn"
          style={{ width: 'auto', padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)' }}
          onClick={() => setPage(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
        >
          Prev
        </button>
        <span style={{ color: 'var(--muted)' }}>Page {safePage} of {totalPages}</span>
        <button
          className="reset-btn"
          style={{ width: 'auto', padding: '5px 12px', background: '#fff', color: 'var(--text)', border: '1px solid var(--border)' }}
          onClick={() => setPage(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  )
}


/* =========================================================================
 * TAB — UPLOAD WORKBOOK (IR)
 * Drag-drop xlsx → parse with sheet/header autodetect → bulk upsert into incidents.
 * Mirrors the layout of the standalone /upload page so dashboard users have it built-in.
 * ========================================================================= */

interface IrUploadResult {
  inserted: number
  skipped: number
  errors: string[]
}

function IrUploadTab({ onUploaded }: { onUploaded: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [filename, setFilename] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ReturnType<typeof parseIrRows> | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<IrUploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [mode, setMode] = useState<'skip' | 'replace'>('skip')

  async function handleFile(f: File) {
    setError(null); setResult(null); setParsed(null); setFilename(f.name); setParsing(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      if (wb.SheetNames.length === 0) throw new Error('Workbook has no sheets')

      // Find best sheet by header-match score
      const known = new Set(IR_MAPPED_HEADERS.map((h: string) => h.replace(/\s+/g, ' ').trim().toLowerCase()))
      let bestAoa: unknown[][] = []
      let bestSheet = wb.SheetNames[0]
      let bestScore = -1
      for (const name of wb.SheetNames) {
        const sheet = wb.Sheets[name]
        if (!sheet) continue
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false }) as unknown[][]
        let score = 0
        for (let i = 0; i < Math.min(6, aoa.length); i++) {
          for (const cell of aoa[i] ?? []) {
            if (typeof cell !== 'string') continue
            const k = cell.replace(/\s+/g, ' ').trim().toLowerCase()
            if (k && known.has(k)) score++
          }
        }
        if (score > bestScore) { bestScore = score; bestSheet = name; bestAoa = aoa }
      }
      if (bestScore <= 0) {
        throw new Error(`No sheet matched the expected IR headers. Sheets: ${wb.SheetNames.join(', ')}.`)
      }

      const ws = wb.Sheets[bestSheet]
      const headerIdx = detectIrHeaderRow(bestAoa)
      const headerRow = (bestAoa[headerIdx] ?? []) as string[]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true, range: headerIdx })
      const s = parseIrRows(rawRows, headerRow.map(String))
      setParsed(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    } finally {
      setParsing(false)
    }
  }

  async function importNow() {
    if (!parsed || parsed.validRows.length === 0) return
    setError(null); setResult(null); setImporting(true)
    setProgress({ done: 0, total: parsed.validRows.length })
    try {
      let inserted = 0, skipped = 0
      const errors: string[] = []

      if (mode === 'replace') {
        const ids = parsed.validRows.map((r) => r.incident_id!).filter(Boolean)
        for (let i = 0; i < ids.length; i += 500) {
          const slice = ids.slice(i, i + 500)
          const { error: delErr } = await supabase.from('incidents').delete().in('incident_id', slice)
          if (delErr) throw new Error(`Delete failed: ${delErr.message}`)
        }
      }

      const CHUNK = 200
      for (let i = 0; i < parsed.validRows.length; i += CHUNK) {
        const chunk = parsed.validRows.slice(i, i + CHUNK)
        const { data, error: insErr } = await supabase
          .from('incidents')
          .upsert(chunk as IncidentRow[], { onConflict: 'incident_id', ignoreDuplicates: mode === 'skip' })
          .select('incident_id')
        if (insErr) {
          errors.push(`Rows ${i + 1}-${i + chunk.length}: ${insErr.message}`)
        } else {
          const c = data?.length ?? 0
          inserted += c
          if (mode === 'skip') skipped += chunk.length - c
        }
        setProgress({ done: Math.min(i + chunk.length, parsed.validRows.length), total: parsed.validRows.length })
      }

      setResult({ inserted, skipped, errors })
      onUploaded()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setFilename(null); setParsed(null); setResult(null); setError(null); setProgress({ done: 0, total: 0 })
    const input = document.getElementById('ir-upload-input') as HTMLInputElement | null
    if (input) input.value = ''
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <Panel title="Upload IR Workbook" subtitle="Drop the IR xlsx — sheet and header row are auto-detected.">
        <div
          onDrop={async (e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) await handleFile(f) }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onClick={() => document.getElementById('ir-upload-input')?.click()}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: 36, border: `2px dashed ${drag ? 'var(--blue)' : 'var(--border)'}`,
            background: drag ? 'var(--blue-lt)' : '#fff', borderRadius: 'var(--rs)', cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 32 }}>📥</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{filename ? filename : 'Drag & drop xlsx, or click to browse'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Workbook stays in your browser until you press Import</div>
          <input id="ir-upload-input" type="file" accept=".xlsx,.xls" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
        {parsing && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Parsing…</div>}
      </Panel>

      {parsed && (
        <Panel title="Workbook Preview">
          <div className="mrow" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <MetricCard tone="blue"  label="Rows in file"      value={parsed.totalRows} />
            <MetricCard tone="green" label="Valid (will import)" value={parsed.validRows.length} />
            <MetricCard tone="amber" label="Skipped at parse"   value={parsed.errors.length} />
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
            <b>Headers matched:</b> {parsed.matchedHeaders.length} of {IR_MAPPED_HEADERS.length}
            {parsed.unknownHeaders.length > 0 && (
              <span> · Ignored: <span style={{ opacity: 0.8 }}>{parsed.unknownHeaders.slice(0, 8).join(', ')}{parsed.unknownHeaders.length > 8 ? '…' : ''}</span></span>
            )}
          </div>

          {parsed.errors.length > 0 && (
            <details style={{ marginTop: 8, background: 'var(--amber-lt)', border: '1px solid #E9D5B2', borderRadius: 'var(--rs)', padding: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>{parsed.errors.length} row issue(s)</summary>
              <ul style={{ margin: '4px 0 0 18px', fontSize: 11, color: 'var(--amber)' }}>
                {parsed.errors.slice(0, 12).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                {parsed.errors.length > 12 && <li>… and {parsed.errors.length - 12} more</li>}
              </ul>
            </details>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <fieldset style={{ display: 'flex', gap: 12, border: 0, padding: 0, fontSize: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="radio" name="ir-mode" checked={mode === 'skip'} onChange={() => setMode('skip')} />
                Skip duplicates
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="radio" name="ir-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                Replace existing
              </label>
            </fieldset>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={reset} disabled={importing}
                style={{ padding: '7px 14px', border: '1px solid var(--border)', background: '#fff', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 600 }}>Reset</button>
              <button onClick={importNow} disabled={importing}
                style={{ padding: '7px 14px', border: 0, background: 'var(--blue)', color: '#fff', borderRadius: 'var(--rs)', fontSize: 12, fontWeight: 600 }}>
                {importing ? `Importing… ${progress.done}/${progress.total}` : `Import ${parsed.validRows.length} rows`}
              </button>
            </div>
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
              {result.inserted} row(s) inserted
              {mode === 'skip' && ` · ${result.skipped} duplicate(s) skipped`}
              {result.errors.length > 0 && <span style={{ color: 'var(--red)' }}> · {result.errors.length} batch error(s)</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
