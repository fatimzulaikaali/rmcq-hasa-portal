'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AppShell, Topbar } from '@/components/AppShell'
import {
  Risk, RiskReview, RiskDept, RiskListRow,
  RiskStatus, RiskLevel, RiskCategory,
} from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
} from '@/lib/risk/scoring'

type StatusFilter   = 'all' | RiskStatus
type LevelFilter    = 'all' | RiskLevel
type CategoryFilter = 'all' | RiskCategory
type DeptFilter     = 'all' | string  // pscs_departments.code

export default function RiskListPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<RiskListRow[]>([])
  const [depts, setDepts] = useState<RiskDept[]>([])

  // Filters
  const [statusF, setStatusF]     = useState<StatusFilter>('all')
  const [levelF, setLevelF]       = useState<LevelFilter>('all')
  const [categoryF, setCategoryF] = useState<CategoryFilter>('all')
  const [deptF, setDeptF]         = useState<DeptFilter>('all')

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Departments (only those with a risk_code — the Risk module ignores sub-units)
      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .order('sort_order')
      if (deptsErr) throw new Error(`Loading departments: ${deptsErr.code ?? ''} ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])

      // Risks (joined with dept name); risk_reviews (latest per risk)
      const [{ data: risksData, error: risksErr }, { data: reviewsData, error: reviewsErr }] = await Promise.all([
        supabase.from('risks').select('*').order('created_at', { ascending: false }),
        supabase.from('risk_reviews').select('*').order('cycle_number', { ascending: false }),
      ])
      if (risksErr) throw new Error(`Loading risks: ${risksErr.code ?? ''} ${risksErr.message}`)
      if (reviewsErr) throw new Error(`Loading reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)

      // Build a lookup: risk.id → latest review (reviews already ordered desc by cycle_number)
      const latestByRisk = new Map<number, RiskReview>()
      for (const r of (reviewsData ?? []) as RiskReview[]) {
        if (!latestByRisk.has(r.risk_id)) latestByRisk.set(r.risk_id, r)
      }

      const deptByCode = new Map<string, RiskDept>()
      for (const d of (deptsData ?? []) as RiskDept[]) deptByCode.set(d.code, d)

      const allRows: RiskListRow[] = ((risksData ?? []) as Risk[]).map((risk) => {
        const d = deptByCode.get(risk.dept_code)
        return {
          risk,
          dept: d ? { code: d.code, risk_code: d.risk_code, name_en: d.name_en, name_ms: d.name_ms } : null,
          latest: latestByRisk.get(risk.id) ?? null,
        }
      })
      setRows(allRows)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusF   !== 'all' && r.risk.status      !== statusF)   return false
    if (categoryF !== 'all' && r.risk.category    !== categoryF) return false
    if (deptF     !== 'all' && r.risk.dept_code   !== deptF)     return false
    if (levelF    !== 'all' && r.latest?.risk_level !== levelF)  return false
    return true
  }), [rows, statusF, categoryF, deptF, levelF])

  const activeFilters =
    (statusF !== 'all' ? 1 : 0) +
    (levelF !== 'all' ? 1 : 0) +
    (categoryF !== 'all' ? 1 : 0) +
    (deptF !== 'all' ? 1 : 0)

  function resetFilters() {
    setStatusF('all'); setLevelF('all'); setCategoryF('all'); setDeptF('all')
  }

  // Counts for the headline tiles
  const counts = useMemo(() => {
    const byLevel: Record<RiskLevel, number> = { EKSTREM: 0, TINGGI: 0, SEDERHANA: 0, RENDAH: 0 }
    let open = 0
    let closed = 0
    for (const r of rows) {
      if (r.latest) byLevel[r.latest.risk_level]++
      if (r.risk.status === 'CLOSED' || r.risk.status === 'REJECTED') closed++
      else open++
    }
    return { byLevel, open, closed, total: rows.length }
  }, [rows])

  return (
    <AppShell>
      <Topbar
        title="Risk Register"
        meta="HASA · Risk Management & Clinical Quality (RMCQ)"
        right={
          <button
            className="cursor-not-allowed rounded-md bg-[var(--blue)] px-3 py-1.5 text-xs font-semibold text-white opacity-50"
            disabled
            title="Coming in Phase 3.2">
            + New Risk
          </button>
        } />

      <div className="p-6">
        {loadError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <b>Load error.</b> {loadError}
          </div>
        )}
        {loading && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Loading…
          </div>
        )}

        {/* Summary tiles */}
        {!loading && !loadError && (
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Tile label="Total risks"   value={String(counts.total)}  color="var(--blue)" />
            <Tile label="Open"          value={String(counts.open)}   color="#0EA5E9" />
            <Tile label="Closed"        value={String(counts.closed)} color="#6B7280" />
            <Tile label="Ekstrem"       value={String(counts.byLevel.EKSTREM)}   color={RISK_LEVEL_COLOR.EKSTREM} />
            <Tile label="Tinggi"        value={String(counts.byLevel.TINGGI)}    color={RISK_LEVEL_COLOR.TINGGI} />
            <Tile label="Sederhana"     value={String(counts.byLevel.SEDERHANA)} color={RISK_LEVEL_COLOR.SEDERHANA} />
          </div>
        )}

        {/* Filter bar */}
        {!loading && !loadError && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-[var(--border)] bg-[#FAFAFA] p-3">
            <Filter label="Status" value={statusF} onChange={(v) => setStatusF(v as StatusFilter)}
              options={[
                { value: 'all', label: 'All statuses' },
                ...(Object.keys(RISK_STATUS_LABEL) as RiskStatus[]).map((s) => ({ value: s, label: RISK_STATUS_LABEL[s] })),
              ]} />
            <Filter label="Risk level" value={levelF} onChange={(v) => setLevelF(v as LevelFilter)}
              options={[
                { value: 'all', label: 'All levels' },
                ...(Object.keys(RISK_LEVEL_LABEL) as RiskLevel[]).map((l) => ({ value: l, label: RISK_LEVEL_LABEL[l] })),
              ]} />
            <Filter label="Category" value={categoryF} onChange={(v) => setCategoryF(v as CategoryFilter)}
              options={[
                { value: 'all', label: 'All categories' },
                ...(Object.keys(RISK_CATEGORY_LABEL) as RiskCategory[]).map((c) => ({ value: c, label: `${c} — ${RISK_CATEGORY_LABEL[c]}` })),
              ]} />
            <Filter label="Department" value={deptF} onChange={(v) => setDeptF(v as DeptFilter)}
              options={[
                { value: 'all', label: 'All departments' },
                ...depts.filter((d) => d.kind === 'department').map((d) => ({ value: d.code, label: `${d.risk_code} — ${d.name_en}` })),
              ]} />
            {activeFilters > 0 && (
              <button
                onClick={resetFilters}
                className="ml-1 rounded-md border border-[var(--border)] bg-white px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-red-400 hover:text-red-600">
                Reset ({activeFilters})
              </button>
            )}
            <span className="ml-auto self-center text-[11px] text-[var(--muted)]">
              {filtered.length} of {rows.length} risks
            </span>
          </div>
        )}

        {/* Risks table or empty state */}
        {!loading && !loadError && (
          <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-white">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--muted)]">
                {rows.length === 0 ? (
                  <>
                    <div className="mb-2 text-2xl">📭</div>
                    <div className="mb-1 font-semibold text-[var(--text)]">No risks registered yet</div>
                    <div>The risk register is empty. Once Phase 3.2 ships the New Risk form, this is where you&apos;ll see all submissions.</div>
                  </>
                ) : (
                  <>No risks match the current filters. <button className="text-[var(--blue)] underline" onClick={resetFilters}>Reset</button></>
                )}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#F3F4F6] text-[10px] uppercase tracking-wide text-[#374151]">
                  <tr>
                    <th className="px-3 py-2 text-left">Risk ID</th>
                    <th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-center">Level</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ risk, dept, latest }) => {
                    const statusBadge = RISK_STATUS_BADGE[risk.status]
                    return (
                      <tr key={risk.id} className="border-t border-[var(--border)] hover:bg-[#F9FAFB]">
                        <td className="px-3 py-2 font-mono text-[11px] font-semibold">
                          <Link href={`/risk/${risk.id}`} className="text-[var(--blue)] hover:underline">
                            {risk.risk_id}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-[11px]">{dept?.name_en ?? risk.dept_code}</td>
                        <td className="px-3 py-2 text-[11px]">
                          <span className="font-semibold">{risk.category}</span>
                          <span className="text-[var(--muted)]"> — {RISK_CATEGORY_LABEL[risk.category]}</span>
                        </td>
                        <td className="px-3 py-2 max-w-[420px] truncate" title={risk.description}>
                          {risk.description}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {latest ? (
                            <span
                              className="inline-block rounded px-2 py-0.5 text-[10px] font-bold"
                              style={{
                                color: RISK_LEVEL_COLOR[latest.risk_level],
                                background: RISK_LEVEL_BG[latest.risk_level],
                              }}>
                              {RISK_LEVEL_LABEL[latest.risk_level]}
                            </span>
                          ) : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {latest ? Math.round(latest.risk_score * 10) / 10 : <span className="text-[var(--muted)]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className="inline-block rounded px-2 py-0.5 text-[10px] font-bold"
                            style={{ color: statusBadge.fg, background: statusBadge.bg }}>
                            {RISK_STATUS_LABEL[risk.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-[var(--muted)]">
                          {risk.date_opened.slice(0, 10)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="mt-3 text-[10px] text-[var(--muted)]">
          Phase 3.1 — read-only list. Coming soon: new risk form (3.2), risk detail page (3.3), review cycles (3.4),
          approval workflow (3.5), meetings (3.6), audit log (3.7), report cards (3.8).
        </div>
      </div>
    </AppShell>
  )
}

/* ---------------- small UI helpers ---------------- */

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none" style={{ color }}>{value}</div>
    </div>
  )
}

function Filter({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-[160px] rounded-md border border-[var(--border)] bg-white px-2 py-1 text-xs hover:border-[var(--blue)] focus:border-[var(--blue)] focus:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
