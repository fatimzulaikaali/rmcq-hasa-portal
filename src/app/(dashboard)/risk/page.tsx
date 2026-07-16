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
  RiskStatus, RiskLevel, TreatmentOption, RtpOverallStatus,
} from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_STATUS_LABEL, RISK_STATUS_BADGE, TREATMENT_OPTION_LABEL,
} from '@/lib/risk/scoring'
import { exportRegisterXlsx, exportRegisterPdf } from '@/lib/risk/exports'
import { sortDeptsAlpha } from '@/lib/risk/sortDepts'

type StatusFilter = 'all' | RiskStatus
type LevelFilter  = 'all' | RiskLevel
type DeptFilter   = 'all' | string
type ViewTab      = 'active' | 'archive'

/* Short treatment codes + colours, matching the register prototype. */
const TREATMENT_SHORT: Record<TreatmentOption, string> = {
  AVOID: 'Av', TRANSFER: 'T', CONTROL: 'C', ACCEPT: 'Ac',
}
const TREATMENT_BADGE: Record<TreatmentOption, { bg: string; fg: string }> = {
  AVOID:    { bg: '#EDE9FE', fg: '#5B21B6' },
  TRANSFER: { bg: '#DBEAFE', fg: '#1E40AF' },
  CONTROL:  { bg: '#E0E7FF', fg: '#3730A3' },
  ACCEPT:   { bg: '#F3F4F6', fg: '#4B5563' },
}

/* RTP overall-status badge — mirrors the prototype's RTP column. */
const RTP_BADGE: Record<RtpOverallStatus, { label: string; bg: string; fg: string }> = {
  NOT_STARTED: { label: 'Not started', bg: '#FEE2E2', fg: '#991B1B' },
  IN_PROGRESS: { label: 'In progress', bg: '#FEF3C7', fg: '#854D0E' },
  COMPLETED:   { label: 'Completed',   bg: '#DCFCE7', fg: '#166534' },
  VERIFIED:    { label: 'Verified',    bg: '#DCFCE7', fg: '#166534' },
}

/* An RTP still needs work while it isn't COMPLETED/VERIFIED. */
function rtpOutstanding(treatment: TreatmentOption | null, status: RtpOverallStatus | null): boolean {
  if (treatment === 'ACCEPT') return false
  if (!status) return true
  return status === 'NOT_STARTED' || status === 'IN_PROGRESS'
}

export default function RiskListPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows]   = useState<RiskListRow[]>([])
  const [depts, setDepts] = useState<RiskDept[]>([])
  const [rtpByRisk, setRtpByRisk] = useState<Map<number, RtpOverallStatus>>(new Map())

  const [view,    setView]    = useState<ViewTab>('active')
  const [statusF, setStatusF] = useState<StatusFilter>('all')
  const [levelF,  setLevelF]  = useState<LevelFilter>('all')
  const [deptF,   setDeptF]   = useState<DeptFilter>('all')

  const [allowedDepts, setAllowedDepts] = useState<string[] | null>(null)
  const [isAdminRole, setIsAdminRole]   = useState(false)
  const [notProvisioned, setNotProvisioned] = useState(false)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.riskUser) { setNotProvisioned(true); setLoading(false); return }
      setAllowedDepts(access.deptScopes)
      setIsAdminRole(access.activeRole?.role === 'ADMIN')

      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .order('sort_order')
      if (deptsErr) throw new Error(`Loading departments: ${deptsErr.code ?? ''} ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])

      const [{ data: risksData, error: risksErr }, { data: reviewsData, error: reviewsErr }, { data: rtpData, error: rtpErr }] = await Promise.all([
        supabase.from('risks').select('*').order('created_at', { ascending: false }),
        supabase.from('risk_reviews').select('*').order('cycle_number', { ascending: false }),
        supabase.from('risk_rtp').select('risk_id, overall_status'),
      ])
      if (risksErr) throw new Error(`Loading risks: ${risksErr.code ?? ''} ${risksErr.message}`)
      if (reviewsErr) throw new Error(`Loading reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)
      if (rtpErr) throw new Error(`Loading RTPs: ${rtpErr.code ?? ''} ${rtpErr.message}`)

      const rtpMap = new Map<number, RtpOverallStatus>()
      for (const r of (rtpData ?? []) as { risk_id: number; overall_status: RtpOverallStatus }[]) {
        rtpMap.set(r.risk_id, r.overall_status)
      }
      setRtpByRisk(rtpMap)

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

  // Rows this user is allowed to see (dept-scoped).
  const scopedRows = useMemo(() =>
    allowedDepts === null ? rows : rows.filter((r) => allowedDepts.includes(r.risk.dept_code)),
    [rows, allowedDepts])

  const isArchiveRow = (r: RiskListRow) => {
    const s = r.risk.status
    return s === 'CLOSED' || s === 'REJECTED' || s === 'OUT_OF_SCOPE'
  }
  const viewRows = useMemo(() =>
    scopedRows.filter((r) => (view === 'archive' ? isArchiveRow(r) : !isArchiveRow(r))),
    [scopedRows, view])
  const activeCount  = useMemo(() => scopedRows.filter((r) => !isArchiveRow(r)).length, [scopedRows])
  const archiveCount = useMemo(() => scopedRows.filter(isArchiveRow).length, [scopedRows])

  const ARCHIVE_STATUSES: RiskStatus[] = ['CLOSED', 'OUT_OF_SCOPE', 'REJECTED']
  const statusOptions = useMemo(() =>
    view === 'archive'
      ? ARCHIVE_STATUSES
      : (Object.keys(RISK_STATUS_LABEL) as RiskStatus[]).filter((s) => !ARCHIVE_STATUSES.includes(s)),
    [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => viewRows.filter((r) => {
    if (statusF !== 'all' && r.risk.status !== statusF) return false
    if (deptF   !== 'all' && r.risk.dept_code     !== deptF) return false
    if (levelF  !== 'all' && r.latest?.risk_level !== levelF) return false
    return true
  }), [viewRows, statusF, deptF, levelF])

  const activeFilters =
    (statusF !== 'all' ? 1 : 0) + (levelF !== 'all' ? 1 : 0) + (deptF !== 'all' ? 1 : 0)

  function resetFilters() { setStatusF('all'); setLevelF('all'); setDeptF('all') }

  function switchView(v: ViewTab) { setView(v); setStatusF('all') }

  // Summary tiles — computed across the current view (active vs archive).
  const counts = useMemo(() => {
    const byLevel: Record<RiskLevel, number> = { EKSTREM: 0, TINGGI: 0, SEDERHANA: 0, RENDAH: 0 }
    let rtpOut = 0
    for (const r of viewRows) {
      if (r.latest) byLevel[r.latest.risk_level]++
      if (rtpOutstanding(r.risk.treatment_option, rtpByRisk.get(r.risk.id) ?? null)) rtpOut++
    }
    return { byLevel, rtpOut }
  }, [viewRows, rtpByRisk])

  // Group the filtered rows by department, ordered like the dept picker.
  const grouped = useMemo(() => {
    const orderedDepts = sortDeptsAlpha(depts.filter((d) => d.kind === 'department'))
    const byCode = new Map<string, RiskListRow[]>()
    for (const r of filtered) {
      const arr = byCode.get(r.risk.dept_code) ?? []
      arr.push(r)
      byCode.set(r.risk.dept_code, arr)
    }
    const out: { dept: RiskDept | null; code: string; rows: RiskListRow[] }[] = []
    for (const d of orderedDepts) {
      const rs = byCode.get(d.code)
      if (rs && rs.length) { out.push({ dept: d, code: d.code, rows: rs }); byCode.delete(d.code) }
    }
    // Any rows whose dept isn't in the ordered list (safety net).
    for (const [code, rs] of Array.from(byCode.entries())) {
      out.push({ dept: null, code, rows: rs })
    }
    return out
  }, [filtered, depts])

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
              <Link href="/risk/users" className="signout-btn" title="Risk module user management (admin)">
                👥 Users
              </Link>
            )}
            <Link href="/risk/quick-add" className="signout-btn"
              style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
              ＋ Log Risk
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

          {!loading && notProvisioned && (
            <div className="panel" style={{ textAlign: 'center', padding: 36 }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>⏳</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Your account isn&apos;t set up yet</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 460, margin: '0 auto' }}>
                You&apos;re signed in, but you haven&apos;t been registered in the Risk module yet.
                Please ask the RMCQ administrator to add you and assign your role — then sign in again.
              </div>
              <div style={{ marginTop: 16 }}>
                <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
              </div>
            </div>
          )}

          {!loading && !loadError && !notProvisioned && (
            <>
              <div className="pscs-tiles" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="tile"><div className="tl">Extreme</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.EKSTREM }}>{counts.byLevel.EKSTREM}</div></div>
                <div className="tile"><div className="tl">High</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.TINGGI }}>{counts.byLevel.TINGGI}</div></div>
                <div className="tile"><div className="tl">Moderate</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.SEDERHANA }}>{counts.byLevel.SEDERHANA}</div></div>
                <div className="tile"><div className="tl">Low</div><div className="tv" style={{ color: RISK_LEVEL_COLOR.RENDAH }}>{counts.byLevel.RENDAH}</div></div>
                <div className="tile"><div className="tl">RTP Outstanding</div><div className="tv" style={{ color: '#B45309' }}>{counts.rtpOut}</div></div>
              </div>

              <div className="risk-tabs">
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
                <select value={deptF} onChange={(e) => setDeptF(e.target.value as DeptFilter)}>
                  <option value="all">All departments</option>
                  {sortDeptsAlpha(depts.filter((d) => d.kind === 'department')).map((d) => (
                    <option key={d.code} value={d.code}>{d.name_en}</option>
                  ))}
                </select>
                {activeFilters > 0 && (
                  <button type="button" className="reset-btn" onClick={resetFilters}>
                    Reset ({activeFilters})
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button type="button" className="signout-btn"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={filtered.length === 0}
                  title="Download the current view as Excel — full column set"
                  onClick={() => exportRegisterXlsx(filtered,
                    { view, status: statusF, level: levelF, domain: 'all', deptCode: deptF }, depts)}>
                  📊 Excel
                </button>
                <button type="button" className="signout-btn"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={filtered.length === 0}
                  title="Print or save the current view as PDF"
                  onClick={() => exportRegisterPdf(filtered,
                    { view, status: statusF, level: levelF, domain: 'all', deptCode: deptF }, depts)}>
                  🖨 PDF
                </button>
              </div>

              {filtered.length === 0 ? (
                <div className="panel" style={{ marginTop: 14 }}>
                  <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                    {viewRows.length === 0 ? (
                      <>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>{view === 'archive' ? '🗄️' : '📭'}</div>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                          {view === 'archive' ? 'Nothing archived yet' : 'No risks logged yet'}
                        </div>
                        <div style={{ fontSize: 12 }}>
                          {view === 'archive'
                            ? 'Closed and out-of-scope risks will appear here.'
                            : 'Use ＋ Log Risk to enter a department’s risk register.'}
                        </div>
                      </>
                    ) : (
                      <>No risks match the current filters. <button onClick={resetFilters} style={{ color: 'var(--blue)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Reset</button></>
                    )}
                  </div>
                </div>
              ) : (
                grouped.map(({ dept, code, rows: deptRows }) => {
                  const extreme = deptRows.filter((r) => r.latest?.risk_level === 'EKSTREM').length
                  return (
                    <div key={code} className="panel" style={{ marginTop: 14 }}>
                      <div className="pf">
                        <div>
                          <div className="pt">{dept?.name_en ?? code}</div>
                          <div className="psub">
                            {deptRows.length} risk{deptRows.length === 1 ? '' : 's'}
                            {extreme > 0 ? ` · ${extreme} extreme` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="risk-table">
                          <thead>
                            <tr>
                              <th>Risk ID</th>
                              <th>Nature</th>
                              <th>Description</th>
                              <th style={{ textAlign: 'center' }}>Current</th>
                              <th style={{ textAlign: 'center' }}>Treatment</th>
                              <th style={{ textAlign: 'center' }}>Residual</th>
                              <th style={{ textAlign: 'center' }}>RTP</th>
                              <th style={{ textAlign: 'center' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deptRows.map(({ risk, latest }) => {
                              const sb = RISK_STATUS_BADGE[risk.status]
                              const to = risk.treatment_option
                              const rtp = rtpByRisk.get(risk.id) ?? null
                              return (
                                <tr key={risk.id} className="clk" style={{ cursor: 'pointer' }}
                                  onClick={() => router.push(`/risk/${risk.id}`)}>
                                  <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11, borderLeftColor: latest ? RISK_LEVEL_COLOR[latest.risk_level] : 'transparent' }}>
                                    <Link href={`/risk/${risk.id}`} style={{ color: 'var(--blue)' }} onClick={(e) => e.stopPropagation()}>{risk.risk_id}</Link>
                                  </td>
                                  <td style={{ fontSize: 11 }}>
                                    {risk.risk_nature === 'ACTUAL'
                                      ? <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#991B1B', background: '#FEE2E2' }}>Actual</span>
                                      : risk.risk_nature === 'POTENTIAL'
                                        ? <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#4B5563', background: '#F3F4F6' }}>Potential</span>
                                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  <td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                      title={risk.description}>
                                    {risk.description}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {latest ? (
                                      <>
                                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RISK_LEVEL_COLOR[latest.risk_level], background: RISK_LEVEL_BG[latest.risk_level] }}>
                                          {RISK_LEVEL_LABEL[latest.risk_level]}
                                        </span>
                                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                          L{latest.likelihood} × S{latest.severity ?? '—'} = {Math.round(latest.risk_score)}
                                        </div>
                                      </>
                                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {to ? (
                                      <span title={TREATMENT_OPTION_LABEL[to]}
                                        style={{ display: 'inline-block', minWidth: 22, padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: TREATMENT_BADGE[to].fg, background: TREATMENT_BADGE[to].bg }}>
                                        {TREATMENT_SHORT[to]}
                                      </span>
                                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {latest && latest.residual_level ? (
                                      <>
                                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RISK_LEVEL_COLOR[latest.residual_level], background: RISK_LEVEL_BG[latest.residual_level] }}>
                                          {RISK_LEVEL_LABEL[latest.residual_level]}
                                        </span>
                                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                                          L{latest.residual_likelihood ?? '—'} × S{latest.residual_severity ?? '—'} = {latest.residual_score != null ? Math.round(latest.residual_score) : '—'}
                                        </div>
                                      </>
                                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {to === 'ACCEPT' ? (
                                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#4B5563', background: '#F3F4F6' }}>— Accepted</span>
                                    ) : rtp ? (
                                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RTP_BADGE[rtp].fg, background: RTP_BADGE[rtp].bg }}>{RTP_BADGE[rtp].label}</span>
                                    ) : (
                                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: '#991B1B', background: '#FEE2E2' }}>Not started</span>
                                    )}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: sb.fg, background: sb.bg }}>
                                      {RISK_STATUS_LABEL[risk.status]}
                                    </span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
