'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
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
import { createClient } from '@/lib/supabase/client'
import { AppShell, Topbar } from '@/components/AppShell'
import {
  applyFilters,
  categoryBreakdown,
  DEFAULT_FILTERS,
  isOverdue,
  monthlyTrend,
  severityDistribution,
  severityHex,
  summarize,
  topDepartments,
  uniqueMonths,
  uniqueValues,
  type Incident,
  type IrFilters,
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

type Tab = 'overview' | 'dept' | 'severity' | 'rca' | 'table'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dept', label: 'By Department' },
  { id: 'severity', label: 'Severity Analysis' },
  { id: 'rca', label: 'RCA & II Tracker' },
  { id: 'table', label: 'Incident Table' },
]

const PAGE_SIZE = 20

export default function IrPage() {
  const [rows, setRows] = useState<Incident[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<IrFilters>(DEFAULT_FILTERS)
  const [tab, setTab] = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Initial fetch
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
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
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => (rows ? applyFilters(rows, filters) : []), [rows, filters])
  const summary = useMemo(() => summarize(filtered), [filtered])
  const trend = useMemo(() => monthlyTrend(filtered), [filtered])
  const sev = useMemo(() => severityDistribution(filtered), [filtered])
  const top = useMemo(() => topDepartments(filtered), [filtered])
  const cats = useMemo(() => categoryBreakdown(filtered), [filtered])

  const monthOpts = useMemo(() => uniqueMonths(rows ?? []), [rows])
  const deptOpts = useMemo(() => uniqueValues(rows ?? [], 'dept_code'), [rows])
  const sevOpts = useMemo(() => uniqueValues(rows ?? [], 'severity_real'), [rows])
  const setOpts = useMemo(() => uniqueValues(rows ?? [], 'care_setting'), [rows])

  // Reset page when filters/search change
  useEffect(() => {
    setPage(1)
  }, [filters, search, tab])

  const Filters = (
    <div className="px-3 py-3">
      <div className="mb-2 px-1 text-[9px] font-bold uppercase tracking-widest text-[#5A6070]">
        Filters
      </div>
      <FilterSelect
        label="Month"
        value={filters.month}
        onChange={(v) => setFilters({ ...filters, month: v })}
        options={[{ value: 'all', label: 'All months' }, ...monthOpts]}
      />
      <FilterSelect
        label="Department"
        value={filters.dept}
        onChange={(v) => setFilters({ ...filters, dept: v })}
        options={[{ value: 'all', label: 'All depts' }, ...deptOpts.map((v) => ({ value: v, label: v }))]}
      />
      <FilterSelect
        label="Severity"
        value={filters.severity}
        onChange={(v) => setFilters({ ...filters, severity: v })}
        options={[{ value: 'all', label: 'All severities' }, ...sevOpts.map((v) => ({ value: v, label: v }))]}
      />
      <FilterSelect
        label="Care Setting"
        value={filters.careSetting}
        onChange={(v) => setFilters({ ...filters, careSetting: v })}
        options={[{ value: 'all', label: 'All settings' }, ...setOpts.map((v) => ({ value: v, label: v }))]}
      />
      <FilterSelect
        label="Case Status"
        value={filters.caseStatus}
        onChange={(v) => setFilters({ ...filters, caseStatus: v })}
        options={[
          { value: 'all', label: 'All cases' },
          { value: 'open', label: 'Open only' },
          { value: 'closed', label: 'Closed only' },
        ]}
      />
      <button
        onClick={() => setFilters(DEFAULT_FILTERS)}
        className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs text-[var(--sidebar-text)] hover:bg-white/[0.11] hover:text-white"
      >
        Reset filters
      </button>
    </div>
  )

  return (
    <AppShell sidebarExtra={Filters}>
      <Topbar
        title="Patient Safety Incident Dashboard 2026"
        meta="Hospital Al-Sultan Abdullah UiTM · RMCQ"
        right={
          <span className="rounded-full bg-[var(--blue-lt)] px-3 py-1 text-xs font-bold text-[var(--blue)]">
            {rows == null ? 'Loading…' : `${filtered.length.toLocaleString()} record${filtered.length === 1 ? '' : 's'}`}
          </span>
        }
      />

      <main className="flex-1 px-6 py-5">
        {rows == null ? (
          <Loader />
        ) : loadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load incidents: {loadError}
          </div>
        ) : (
          <>
            <SummaryCards s={summary} />

            <div className="mt-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-t-md px-4 py-2 text-xs font-medium transition-colors ${
                    tab === t.id
                      ? 'border border-b-0 border-[var(--border)] bg-white text-[var(--blue)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="-mt-px rounded-b-md rounded-tr-md border border-[var(--border)] bg-white p-5 min-h-[400px]">
              {tab === 'overview' && <OverviewTab trend={trend} sev={sev} top={top} />}
              {tab === 'dept' && <DeptTab top={topDepartments(filtered, 20)} total={filtered.length} />}
              {tab === 'severity' && <SeverityTab sev={sev} cats={cats} />}
              {tab === 'rca' && <RcaIiTab rows={filtered} />}
              {tab === 'table' && (
                <TableTab
                  rows={filtered}
                  search={search}
                  setSearch={setSearch}
                  page={page}
                  setPage={setPage}
                />
              )}
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}

/* ===================================================================== */
/* Components                                                            */
/* ===================================================================== */

function Loader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--blue)]" />
        Loading incidents…
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="mb-2">
      <label className="mb-0.5 block text-[10px] text-[var(--sidebar-mute)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-white/10 bg-[#1E2B3C] px-2 py-1.5 text-xs text-[var(--sidebar-text)] outline-none focus:border-[var(--blue-md)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#1E2B3C] text-[var(--sidebar-text)]">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function SummaryCards({ s }: { s: ReturnType<typeof summarize> }) {
  const cards = [
    { label: 'Total Incidents', value: s.total, accent: 'var(--blue)', bg: 'var(--blue-lt)' },
    { label: 'Sentinel Events', value: s.sentinel, accent: 'var(--purple)', bg: 'var(--purple-lt)' },
    { label: 'Open Cases', value: s.open, accent: 'var(--red)', bg: 'var(--red-lt)' },
    { label: 'RCA Required', value: s.rcaRequired, accent: 'var(--amber)', bg: 'var(--amber-lt)' },
    { label: 'II Required', value: s.iiRequired, accent: 'var(--teal)', bg: 'var(--teal-lt)' },
    { label: 'Near Miss', value: s.nearMiss, accent: 'var(--green)', bg: 'var(--green-lt)' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-[10px] border border-[var(--border)] bg-white p-4 shadow-sm"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {c.label}
          </div>
          <div className="mt-1 text-2xl font-bold" style={{ color: c.accent }}>
            {c.value.toLocaleString()}
          </div>
          <div
            className="mt-2 inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: c.bg, color: c.accent }}
          >
            {c.value === 0 ? '—' : `${Math.round((c.value / Math.max(s.total, 1)) * 100)}% of total`}
          </div>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ title, children, height = 280 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-white p-4">
      <div className="mb-2 text-sm font-semibold text-[var(--text)]">{title}</div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

function OverviewTab({
  trend,
  sev,
  top,
}: {
  trend: ReturnType<typeof monthlyTrend>
  sev: ReturnType<typeof severityDistribution>
  top: ReturnType<typeof topDepartments>
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Monthly trend">
        <Line
          data={{
            labels: trend.labels,
            datasets: [
              {
                label: 'Incidents',
                data: trend.data,
                borderColor: '#185FA5',
                backgroundColor: 'rgba(55,138,221,0.18)',
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointBackgroundColor: '#185FA5',
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, grid: { color: '#E0DED6' } },
              x: { grid: { display: false } },
            },
          }}
        />
      </ChartCard>

      <ChartCard title="Severity distribution">
        <Doughnut
          data={{
            labels: sev.labels,
            datasets: [{ data: sev.data, backgroundColor: sev.colors, borderWidth: 0 }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } },
            cutout: '62%',
          }}
        />
      </ChartCard>

      <ChartCard title="Top departments by incidents">
        <Bar
          data={{
            labels: top.labels,
            datasets: [
              {
                label: 'Incidents',
                data: top.data,
                backgroundColor: '#378ADD',
                borderRadius: 4,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, grid: { color: '#E0DED6' } },
              x: { grid: { display: false } },
            },
          }}
        />
      </ChartCard>

      <ChartCard title="Top categories">
        <Bar
          data={{
            labels: top.labels.slice(0, 6),
            datasets: [
              {
                label: 'Incidents',
                data: top.data.slice(0, 6),
                backgroundColor: '#1D9E75',
                borderRadius: 4,
              },
            ],
          }}
          options={{
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, grid: { color: '#E0DED6' } },
              y: { grid: { display: false } },
            },
          }}
        />
      </ChartCard>
    </div>
  )
}

function DeptTab({ top, total }: { top: ReturnType<typeof topDepartments>; total: number }) {
  const max = Math.max(1, ...top.data)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Incidents by department" height={Math.max(320, top.labels.length * 22)}>
        <Bar
          data={{
            labels: top.labels,
            datasets: [
              {
                label: 'Incidents',
                data: top.data,
                backgroundColor: '#185FA5',
                borderRadius: 4,
              },
            ],
          }}
          options={{
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, grid: { color: '#E0DED6' } },
              y: { grid: { display: false } },
            },
          }}
        />
      </ChartCard>

      <div className="rounded-[10px] border border-[var(--border)] bg-white p-4">
        <div className="mb-3 text-sm font-semibold">Department share</div>
        <div className="space-y-3">
          {top.labels.map((l, i) => {
            const v = top.data[i]
            const pct = (v / max) * 100
            const sharePct = total ? (v / total) * 100 : 0
            return (
              <div key={l}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text)]">{l}</span>
                  <span className="text-[var(--muted)]">
                    {v} ({sharePct.toFixed(1)}%)
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                  <div className="h-full rounded-full bg-[var(--blue-md)]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SeverityTab({
  sev,
  cats,
}: {
  sev: ReturnType<typeof severityDistribution>
  cats: ReturnType<typeof categoryBreakdown>
}) {
  const total = sev.data.reduce((a, b) => a + b, 0) || 1
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Severity distribution" height={320}>
        <Doughnut
          data={{
            labels: sev.labels,
            datasets: [{ data: sev.data, backgroundColor: sev.colors, borderWidth: 0 }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } },
            cutout: '62%',
          }}
        />
      </ChartCard>

      <div className="rounded-[10px] border border-[var(--border)] bg-white p-4">
        <div className="mb-3 text-sm font-semibold">Severity breakdown</div>
        <div className="space-y-3">
          {sev.labels.map((l, i) => (
            <div key={l} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: sev.colors[i] }} />
                <SeverityBadge sev={l} />
              </div>
              <div className="text-right">
                <div className="font-semibold text-[var(--text)]">{sev.data[i]}</div>
                <div className="text-[11px] text-[var(--muted)]">{((sev.data[i] / total) * 100).toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        <ChartCard title="Categories with most incidents" height={Math.max(280, cats.labels.length * 26)}>
          <Bar
            data={{
              labels: cats.labels,
              datasets: [
                {
                  label: 'Incidents',
                  data: cats.data,
                  backgroundColor: '#A32D2D',
                  borderRadius: 4,
                },
              ],
            }}
            options={{
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { beginAtZero: true, grid: { color: '#E0DED6' } },
                y: { grid: { display: false } },
              },
            }}
          />
        </ChartCard>
      </div>
    </div>
  )
}

function RcaIiTab({ rows }: { rows: Incident[] }) {
  const tracker = rows.filter((r) => (r.is_rca ?? 0) > 0 || (r.is_ii ?? 0) > 0)
  if (tracker.length === 0) {
    return <div className="text-sm text-[var(--muted)]">No incidents currently flagged for RCA or II.</div>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="min-w-full text-xs">
        <thead className="bg-[var(--bg)] text-left text-[var(--muted)]">
          <tr>
            <Th>IR No</Th>
            <Th>Dept</Th>
            <Th>Category</Th>
            <Th>Severity</Th>
            <Th>RCA</Th>
            <Th>RCA Status</Th>
            <Th>II</Th>
            <Th>II Status</Th>
            <Th>Due</Th>
          </tr>
        </thead>
        <tbody>
          {tracker.map((r) => {
            const overdue = isOverdue(r.action_due_date)
            return (
              <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--bg)]">
                <Td className="font-mono">{r.incident_id ?? '—'}</Td>
                <Td>{r.dept_code ?? '—'}</Td>
                <Td>{r.category ?? '—'}</Td>
                <Td>
                  <SeverityBadge sev={r.severity_real ?? ''} />
                </Td>
                <Td>{(r.is_rca ?? 0) > 0 ? <FlagBadge color="amber">RCA</FlagBadge> : '—'}</Td>
                <Td>{r.rca_status ?? '—'}</Td>
                <Td>{(r.is_ii ?? 0) > 0 ? <FlagBadge color="teal">II</FlagBadge> : '—'}</Td>
                <Td>{r.ii_status ?? '—'}</Td>
                <Td className={overdue ? 'font-semibold text-[var(--red)]' : ''}>
                  {r.action_due_date ?? '—'}
                  {overdue && <span className="ml-1 rounded bg-[var(--red-lt)] px-1 text-[10px]">overdue</span>}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TableTab({
  rows,
  search,
  setSearch,
  page,
  setPage,
}: {
  rows: Incident[]
  search: string
  setSearch: (s: string) => void
  page: number
  setPage: (n: number) => void
}) {
  const q = search.trim().toLowerCase()
  const matched = useMemo(
    () =>
      q
        ? rows.filter((r) =>
            [
              r.incident_id,
              r.dept_code,
              r.ward,
              r.category,
              r.sub_category,
              r.severity_real,
              r.incident_type,
            ]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          )
        : rows,
    [rows, q]
  )
  const totalPages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const slice = matched.slice(start, start + PAGE_SIZE)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          placeholder="Search incidents (IR no, dept, ward, category…)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-xs outline-none focus:border-[var(--blue-md)]"
        />
        <div className="text-xs text-[var(--muted)]">
          Showing {matched.length === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, matched.length)} of{' '}
          {matched.length}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--bg)] text-left text-[var(--muted)]">
            <tr>
              <Th>IR No</Th>
              <Th>Month</Th>
              <Th>Dept</Th>
              <Th>Ward</Th>
              <Th>Category</Th>
              <Th>Severity</Th>
              <Th>Type</Th>
              <Th>Sentinel</Th>
              <Th>Case</Th>
              <Th>RCA</Th>
              <Th>II</Th>
              <Th>Due</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const overdue = isOverdue(r.action_due_date)
              return (
                <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--bg)]">
                  <Td className="font-mono">{r.incident_id ?? '—'}</Td>
                  <Td>{r.incident_month ?? '—'}</Td>
                  <Td>{r.dept_code ?? '—'}</Td>
                  <Td>{r.ward ?? '—'}</Td>
                  <Td className="max-w-[220px] truncate" title={r.category ?? ''}>{r.category ?? '—'}</Td>
                  <Td><SeverityBadge sev={r.severity_real ?? ''} /></Td>
                  <Td>{r.incident_type ?? '—'}</Td>
                  <Td>{r.sentinel ? <FlagBadge color="purple">SENTINEL</FlagBadge> : '—'}</Td>
                  <Td>
                    {r.case_closed ? (
                      <FlagBadge color="green">CLOSED</FlagBadge>
                    ) : (
                      <FlagBadge color="red">OPEN</FlagBadge>
                    )}
                  </Td>
                  <Td>{(r.is_rca ?? 0) > 0 ? <FlagBadge color="amber">RCA</FlagBadge> : '—'}</Td>
                  <Td>{(r.is_ii ?? 0) > 0 ? <FlagBadge color="teal">II</FlagBadge> : '—'}</Td>
                  <Td className={overdue ? 'font-semibold text-[var(--red)]' : ''}>
                    {r.action_due_date ?? '—'}
                  </Td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr>
                <td colSpan={12} className="p-4 text-center text-[var(--muted)]">
                  No matching incidents.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          onClick={() => setPage(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          className="rounded-md border border-[var(--border)] bg-white px-3 py-1 disabled:opacity-50"
        >
          Prev
        </button>
        <span className="text-[var(--muted)]">
          Page {safePage} of {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages, safePage + 1))}
          disabled={safePage >= totalPages}
          className="rounded-md border border-[var(--border)] bg-white px-3 py-1 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  )
}

/* ===================================================================== */
/* Tiny helpers                                                          */
/* ===================================================================== */

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide">{children}</th>
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={`px-3 py-2 align-middle ${className}`} title={title}>
      {children}
    </td>
  )
}

function SeverityBadge({ sev }: { sev: string }) {
  if (!sev) return <span className="text-[var(--muted)]">—</span>
  const color = severityHex(sev)
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}1F`, color }}
    >
      {sev}
    </span>
  )
}

function FlagBadge({
  color,
  children,
}: {
  color: 'red' | 'green' | 'amber' | 'purple' | 'teal' | 'blue'
  children: React.ReactNode
}) {
  const map: Record<typeof color, { bg: string; fg: string }> = {
    red: { bg: 'var(--red-lt)', fg: 'var(--red)' },
    green: { bg: 'var(--green-lt)', fg: 'var(--green)' },
    amber: { bg: 'var(--amber-lt)', fg: 'var(--amber)' },
    purple: { bg: 'var(--purple-lt)', fg: 'var(--purple)' },
    teal: { bg: 'var(--teal-lt)', fg: 'var(--teal)' },
    blue: { bg: 'var(--blue-lt)', fg: 'var(--blue)' },
  }
  const c = map[color]
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  )
}
