'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import {
  Risk, RiskReview, RiskDept, RiskListRow,
  RiskStatus, RiskLevel, RiskCategory, RiskRole,
} from '@/lib/risk/types'
import type { ActiveRole } from '@/lib/risk/activeRole'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
} from '@/lib/risk/scoring'

type StatusFilter   = 'all' | RiskStatus
type LevelFilter    = 'all' | RiskLevel
type CategoryFilter = 'all' | RiskCategory
type DeptFilter     = 'all' | string

/* Which statuses are "awaiting action" for each active role, and the prompt to show. */
const ATTENTION_BY_ROLE: Record<RiskRole, RiskStatus[]> = {
  RLO:        ['DRAFT', 'RETURNED', 'OUT_OF_SCOPE'],
  HOD:        ['PENDING_HOD'],
  RC:         ['PENDING_RC', 'TABLED_RTC', 'TABLED_ROC', 'PENDING_CLOSURE'],
  ROC_MEMBER: [],
  RTC_MEMBER: [],
  DIRECTOR:   [],
  ADMIN:      [],
}

export default function RiskListPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows]   = useState<RiskListRow[]>([])
  const [depts, setDepts] = useState<RiskDept[]>([])

  const [view,      setView]      = useState<'attention' | 'active' | 'archive'>('active')
  const [viewTouched, setViewTouched] = useState(false)
  const [statusF,   setStatusF]   = useState<StatusFilter>('all')
  const [levelF,    setLevelF]    = useState<LevelFilter>('all')
  const [categoryF, setCategoryF] = useState<CategoryFilter>('all')
  const [deptF,     setDeptF]     = useState<DeptFilter>('all')

  // Dept access scope. null = hospital-wide / all data; array = restricted to these depts.
  const [allowedDepts, setAllowedDepts] = useState<string[] | null>(null)
  const [isAdminRole, setIsAdminRole]   = useState(false)
  const [activeRole,  setActiveRole]    = useState<ActiveRole | null>(null)
  const [openDirectives, setOpenDirectives] = useState<{ risk_id: number; depts: string[] }[]>([])
  const [escalatedRiskIds, setEscalatedRiskIds] = useState<Set<number>>(new Set())

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Resolve the user's module access (admin-style vs dept-scoped)
      const access = await getModuleAccess(supabase)
      setAllowedDepts(access.deptScopes)
      setIsAdminRole(access.activeRole?.role === 'ADMIN')
      setActiveRole(access.activeRole)

      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .order('sort_order')
      if (deptsErr) throw new Error(`Loading departments: ${deptsErr.code ?? ''} ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])

      const [{ data: risksData, error: risksErr }, { data: reviewsData, error: reviewsErr }, { data: openActions }] = await Promise.all([
        supabase.from('risks').select('*').order('created_at', { ascending: false }),
        supabase.from('risk_reviews').select('*').order('cycle_number', { ascending: false }),
        supabase.from('risk_action_items').select('risk_id, assigned_depts, status').in('status', ['PENDING', 'OVERDUE', 'ESCALATED']),
      ])
      if (risksErr) throw new Error(`Loading risks: ${risksErr.code ?? ''} ${risksErr.message}`)
      if (reviewsErr) throw new Error(`Loading reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)

      const actionRows = ((openActions ?? []) as { risk_id: number | null; assigned_depts: string[] | null; status: string }[])
        .filter((a) => a.risk_id !== null)
      // Directives awaiting the dept's feedback (PENDING/OVERDUE).
      setOpenDirectives(actionRows
        .filter((a) => a.status === 'PENDING' || a.status === 'OVERDUE')
        .map((a) => ({ risk_id: a.risk_id as number, depts: a.assigned_depts ?? [] })))
      // Directives the RC escalated — flagged for the RC to bring back to committee.
      setEscalatedRiskIds(new Set(actionRows.filter((a) => a.status === 'ESCALATED').map((a) => a.risk_id as number)))

      const latestByRisk = new Map<number, RiskReview>()
      for (const r of (reviewsData ?? []) as RiskReview[]) {
        if (!latestByRisk.has(r.risk_id)) latestByRisk.set(r.risk_id, r)
      }
      const deptByCode = new Map<string, RiskDept>()
      for (const d of (deptsData ?? []) as RiskDept[]) deptByCode.set(d.code, d)

      setRows(((risksData ?? []) as Risk[]).map((risk) => {
        const d = deptByCode.get(risk.dept_code)
        return {
          risk,
          dept: d ? { code: d.code, risk_code: d.risk_code, name_en: d.name_en, name_ms: d.name_ms } : null,
          latest: latestByRisk.get(risk.id) ?? null,
        }
      }))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Rows this user is allowed to see (dept-scoped), before any UI filters.
  // The summary tiles are computed from this set so they reflect the user's
  // scope (e.g. their department only), not the whole hospital.
  const scopedRows = useMemo(() =>
    allowedDepts === null ? rows : rows.filter((r) => allowedDepts.includes(r.risk.dept_code)),
    [rows, allowedDepts])

  // Risks awaiting the current active role's action (dept-scoped via scopedRows).
  // Out-of-scope only counts while it's still awaiting the RLO's acknowledgment.
  const attentionRows = useMemo(() => {
    if (!activeRole) return []
    const statuses = ATTENTION_BY_ROLE[activeRole.role] ?? []
    // The dept (RLO/HOD) also acts on risks with an open directive assigned to THEIR dept.
    const myDept = (activeRole.role === 'RLO' || activeRole.role === 'HOD') ? activeRole.dept_code : null
    const risksWithMyDirective = myDept
      ? new Set(openDirectives.filter((o) => o.depts.includes(myDept)).map((o) => o.risk_id))
      : new Set<number>()
    // RC: risks with an escalated directive flagged to bring back to committee.
    const isRC = activeRole.role === 'RC'
    if (statuses.length === 0 && risksWithMyDirective.size === 0 && !(isRC && escalatedRiskIds.size > 0)) return []
    return scopedRows.filter((r) =>
      (statuses.includes(r.risk.status) && (r.risk.status !== 'OUT_OF_SCOPE' || r.risk.pending_ack)) ||
      risksWithMyDirective.has(r.risk.id) ||
      (isRC && escalatedRiskIds.has(r.risk.id)))
  }, [scopedRows, activeRole, openDirectives, escalatedRiskIds])

  // Terminal statuses. Out-of-scope is terminal only ONCE the RLO has acknowledged
  // it; until then it lives solely in the attention tab (not active, not archive).
  const isArchiveRow = (r: RiskListRow) => {
    const s = r.risk.status
    if (s === 'CLOSED' || s === 'REJECTED') return true
    if (s === 'OUT_OF_SCOPE') return !r.risk.pending_ack
    return false
  }
  // Active register = the live workflow; never closed/out-of-scope/rejected.
  const isActiveRow = (r: RiskListRow) => {
    const s = r.risk.status
    return s !== 'CLOSED' && s !== 'REJECTED' && s !== 'OUT_OF_SCOPE'
  }

  // Rows belonging to the currently-selected tab.
  const viewRows = useMemo(() => {
    if (view === 'attention') return attentionRows
    if (view === 'archive')   return scopedRows.filter(isArchiveRow)
    return scopedRows.filter(isActiveRow)
  }, [scopedRows, attentionRows, view])
  const activeCount  = useMemo(() => scopedRows.filter(isActiveRow).length,  [scopedRows])
  const archiveCount = useMemo(() => scopedRows.filter(isArchiveRow).length, [scopedRows])

  // Status options offered in the filter, scoped to the current tab.
  const ARCHIVE_STATUSES: RiskStatus[] = ['CLOSED', 'OUT_OF_SCOPE', 'REJECTED']
  const statusOptions = useMemo(() => {
    if (view === 'attention') return activeRole ? (ATTENTION_BY_ROLE[activeRole.role] ?? []) : []
    if (view === 'archive') return ARCHIVE_STATUSES
    return (Object.keys(RISK_STATUS_LABEL) as RiskStatus[]).filter((s) => !ARCHIVE_STATUSES.includes(s))
  }, [view, activeRole]) // eslint-disable-line react-hooks/exhaustive-deps

  // Land on the attention tab on first load when the user has items waiting.
  useEffect(() => {
    if (!viewTouched && attentionRows.length > 0) setView('attention')
  }, [attentionRows, viewTouched])

  const filtered = useMemo(() => viewRows.filter((r) => {
    if (statusF   !== 'all' && r.risk.status        !== statusF)   return false
    if (categoryF !== 'all' && r.risk.category      !== categoryF) return false
    if (deptF     !== 'all' && r.risk.dept_code     !== deptF)     return false
    if (levelF    !== 'all' && r.latest?.risk_level !== levelF)    return false
    return true
  }), [viewRows, statusF, categoryF, deptF, levelF])

  const activeFilters =
    (statusF !== 'all' ? 1 : 0) + (levelF !== 'all' ? 1 : 0) +
    (categoryF !== 'all' ? 1 : 0) + (deptF !== 'all' ? 1 : 0)

  function resetFilters() {
    setStatusF('all'); setLevelF('all'); setCategoryF('all'); setDeptF('all')
  }

  // Switching tabs clears the status filter (its valid options differ per tab).
  function switchView(v: 'attention' | 'active' | 'archive') {
    setView(v)
    setStatusF('all')
    setViewTouched(true)
  }

  const counts = useMemo(() => {
    const byLevel: Record<RiskLevel, number> = { EKSTREM: 0, TINGGI: 0, SEDERHANA: 0, RENDAH: 0 }
    let open = 0, closed = 0
    for (const r of scopedRows) {
      if (r.latest) byLevel[r.latest.risk_level]++
      if (r.risk.status === 'CLOSED' || r.risk.status === 'OUT_OF_SCOPE' || r.risk.status === 'REJECTED') closed++; else open++
    }
    return { byLevel, open, closed, total: scopedRows.length }
  }, [scopedRows])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="risk" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Risk Register</div>
              <div className="tb-meta">Hospital Al-Sultan Abdullah UiTM · RMCQ</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <div className="rec-badge">
              {loading ? 'Loading…' : `${filtered.length.toLocaleString()} risk${filtered.length === 1 ? '' : 's'}`}
            </div>
            {isAdminRole && (
              <Link href="/risk/users" className="signout-btn"
                title="Risk module user management (admin)">
                👥 Users
              </Link>
            )}
            <Link href="/risk/new" className="signout-btn"
              style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
              + New Risk
            </Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane risk-skin">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div>
            </div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div>
              <div><div className="at">Loading…</div></div>
            </div>
          )}

          {!loading && !loadError && (
            <>
              <div className="pscs-tiles" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                <div className="tile"><div className="tl">Total risks</div><div className="tv" style={{ color: 'var(--blue)' }}>{counts.total}</div></div>
                <div className="tile"><div className="tl">Open</div><div className="tv" style={{ color: '#0EA5E9' }}>{counts.open}</div></div>
                <div className="tile"><div className="tl">Closed</div><div className="tv" style={{ color: '#6B7280' }}>{counts.closed}</div></div>
                <div className="tile"><div className="tl">Ekstrem</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.EKSTREM }}>{counts.byLevel.EKSTREM}</div></div>
                <div className="tile"><div className="tl">Tinggi</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.TINGGI }}>{counts.byLevel.TINGGI}</div></div>
                <div className="tile"><div className="tl">Sederhana</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.SEDERHANA }}>{counts.byLevel.SEDERHANA}</div></div>
              </div>

              <div className="risk-tabs">
                {attentionRows.length > 0 && (
                  <button type="button" className={`risk-tab risk-tab-attention ${view === 'attention' ? 'active' : ''}`}
                    onClick={() => switchView('attention')}>
                    ⚡ Needs your attention <span className="risk-tab-count">{attentionRows.length}</span>
                  </button>
                )}
                <button type="button" className={`risk-tab ${view === 'active' ? 'active' : ''}`}
                  onClick={() => switchView('active')}>
                  Active Register <span className="risk-tab-count">{activeCount}</span>
                </button>
                <button type="button" className={`risk-tab ${view === 'archive' ? 'active' : ''}`}
                  onClick={() => switchView('archive')}>
                  Archive <span className="risk-tab-count">{archiveCount}</span>
                </button>
              </div>

              <div className="risk-filterbar">
                <span className="rfb-label">🔎 Filters</span>
                <select value={statusF} onChange={(e) => setStatusF(e.target.value as StatusFilter)}>
                  <option value="all">{view === 'archive' ? 'All archived' : 'All statuses'}</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>{RISK_STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <select value={levelF} onChange={(e) => setLevelF(e.target.value as LevelFilter)}>
                  <option value="all">All levels</option>
                  {(Object.keys(RISK_LEVEL_LABEL) as RiskLevel[]).map((l) => (
                    <option key={l} value={l}>{RISK_LEVEL_LABEL[l]}</option>
                  ))}
                </select>
                <select value={categoryF} onChange={(e) => setCategoryF(e.target.value as CategoryFilter)}>
                  <option value="all">All categories</option>
                  {(Object.keys(RISK_CATEGORY_LABEL) as RiskCategory[]).map((c) => (
                    <option key={c} value={c}>{c} — {RISK_CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
                <select value={deptF} onChange={(e) => setDeptF(e.target.value as DeptFilter)}>
                  <option value="all">All departments</option>
                  {depts.filter((d) => d.kind === 'department').map((d) => (
                    <option key={d.code} value={d.code}>{d.name_en}</option>
                  ))}
                </select>
                {activeFilters > 0 && (
                  <button type="button" className="reset-btn" onClick={resetFilters}>
                    Reset ({activeFilters})
                  </button>
                )}
              </div>

              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf">
                  <div>
                    <div className="pt">{view === 'archive' ? 'Archive — Closed &amp; Out of Scope' : view === 'attention' ? 'Needs Your Attention' : 'Active Register'}</div>
                    <div className="psub">
                      {filtered.length} of {viewRows.length} {view === 'archive' ? 'archived risks' : view === 'attention' ? 'risks awaiting your action' : 'active risks'}
                      {view === 'archive'
                        ? ' · revising a returned risk moves it back to the Active Register'
                        : view === 'attention'
                          ? ' · these are waiting on your current role'
                          : ' · use the filters above to narrow down'}
                    </div>
                  </div>
                </div>

                {filtered.length === 0 ? (
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                    {viewRows.length === 0 ? (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>{view === 'archive' ? '🗄️' : view === 'attention' ? '✅' : '📭'}</div>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                          {view === 'archive' ? 'Nothing archived yet' : view === 'attention' ? 'Nothing waiting on you' : 'No active risks'}
                        </div>
                        <div style={{ fontSize: 12 }}>
                          {view === 'archive'
                            ? 'Closed and out-of-scope risks will appear here.'
                            : view === 'attention'
                              ? 'You’re all caught up — no risks need your action right now.'
                              : 'Risks move here as they progress through the workflow.'}
                        </div>
                      </>
                    ) : (
                      <>No risks match the current filters. <button onClick={resetFilters} style={{ color: 'var(--blue)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Reset</button></>
                    )}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="risk-table">
                      <thead>
                        <tr>
                          <th>Risk ID</th>
                          <th>Department</th>
                          <th>Category</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'center' }}>Level</th>
                          <th style={{ textAlign: 'right' }}>Score</th>
                          <th style={{ textAlign: 'center' }}>Cycle</th>
                          <th style={{ textAlign: 'center' }}>Status</th>
                          <th style={{ textAlign: 'right' }}>Opened</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(({ risk, dept, latest }) => {
                          const sb = RISK_STATUS_BADGE[risk.status]
                          return (
                            <tr key={risk.id}>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11, borderLeftColor: latest ? RISK_LEVEL_COLOR[latest.risk_level] : 'transparent' }}>
                                <Link href={`/risk/${risk.id}`} style={{ color: 'var(--blue)' }}>{risk.risk_id}</Link>
                                {escalatedRiskIds.has(risk.id) && (
                                  <span title="Escalated directive — bring back to committee"
                                    style={{ marginLeft: 5, color: '#DC2626' }}>⚑</span>
                                )}
                              </td>
                              <td style={{ fontSize: 11 }}>{dept?.name_en ?? risk.dept_code}</td>
                              <td style={{ fontSize: 11 }}>
                                <b>{risk.category}</b>
                                <span style={{ color: 'var(--muted)' }}> — {RISK_CATEGORY_LABEL[risk.category]}</span>
                              </td>
                              <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={risk.description}>
                                {risk.description}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {latest ? (
                                  <span style={{
                                    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                    fontSize: 10, fontWeight: 700,
                                    color: RISK_LEVEL_COLOR[latest.risk_level],
                                    background: RISK_LEVEL_BG[latest.risk_level],
                                  }}>{RISK_LEVEL_LABEL[latest.risk_level]}</span>
                                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                {latest ? Math.round(latest.risk_score * 10) / 10 : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'center', fontSize: 11 }}>
                                {latest ? latest.cycle_number : <span style={{ color: 'var(--muted)' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{
                                  display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                  fontSize: 10, fontWeight: 700,
                                  color: sb.fg, background: sb.bg,
                                }}>{RISK_STATUS_LABEL[risk.status]}</span>
                              </td>
                              <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
                                {risk.date_opened.slice(0, 10)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--muted)' }}>
                Phase 3.1 — read-only list. Coming soon: new risk form (3.2), risk detail (3.3),
                review cycles (3.4), approval workflow (3.5), meetings (3.6), audit log (3.7), report cards (3.8).
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
