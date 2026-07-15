'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { Risk, RiskReview, RiskDept, TreatmentStatus } from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL, TREATMENT_OPTION_LABEL,
} from '@/lib/risk/scoring'
import { sortDeptsAlpha } from '@/lib/risk/sortDepts'

/* RTP (Risk Treatment Plan) monitoring — the Risk Coordinator's day-to-day
 * view. Once a risk is logged with a treatment option, the department is
 * expected to carry out its treatment plan; this page tracks whether that
 * plan is done, grouped by department.
 *
 * The RTP status comes from the latest review cycle's `treatment_status`.
 * Risks whose treatment option is ACCEPT need no plan, so they're excluded. */

// Treatment status = "is the RTP done?"
const TS_LABEL: Record<TreatmentStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED:   'Completed',
  VERIFIED:    'Verified',
}
const TS_BADGE: Record<TreatmentStatus, { fg: string; bg: string }> = {
  NOT_STARTED: { fg: '#A32D2D', bg: '#FCEBEB' },
  IN_PROGRESS: { fg: '#854F0B', bg: '#FBF1DD' },
  COMPLETED:   { fg: '#3B6D11', bg: '#EAF3E0' },
  VERIFIED:    { fg: '#0F6E56', bg: '#E3F5EF' },
}
// null treatment_status is treated as "Not started" for monitoring purposes.
function tsOf(r: RiskReview | null): TreatmentStatus {
  return (r?.treatment_status ?? 'NOT_STARTED') as TreatmentStatus
}
const OUTSTANDING: TreatmentStatus[] = ['NOT_STARTED', 'IN_PROGRESS']

type RtpFilter = 'outstanding' | 'all' | TreatmentStatus

interface RtpRow {
  risk: Risk
  dept: RiskDept | null
  latest: RiskReview | null
  ts: TreatmentStatus
}

export default function RtpMonitorPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notProvisioned, setNotProvisioned] = useState(false)

  const [rows, setRows] = useState<RtpRow[]>([])
  const [depts, setDepts] = useState<RiskDept[]>([])
  const [allowedDepts, setAllowedDepts] = useState<string[] | null>(null)

  const [statusF, setStatusF] = useState<RtpFilter>('outstanding')
  const [deptF, setDeptF] = useState<string>('all')

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.riskUser) { setNotProvisioned(true); setLoading(false); return }
      setAllowedDepts(access.deptScopes)

      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .order('sort_order')
      if (deptsErr) throw new Error(`Loading departments: ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])

      const [{ data: risksData, error: risksErr }, { data: reviewsData, error: reviewsErr }] =
        await Promise.all([
          supabase.from('risks').select('*').order('created_at', { ascending: false }),
          supabase.from('risk_reviews').select('*').order('cycle_number', { ascending: false }),
        ])
      if (risksErr) throw new Error(`Loading risks: ${risksErr.message}`)
      if (reviewsErr) throw new Error(`Loading reviews: ${reviewsErr.message}`)

      const latestByRisk = new Map<number, RiskReview>()
      for (const r of (reviewsData ?? []) as RiskReview[]) {
        if (!latestByRisk.has(r.risk_id)) latestByRisk.set(r.risk_id, r)
      }
      const deptByCode = new Map<string, RiskDept>()
      for (const d of (deptsData ?? []) as RiskDept[]) deptByCode.set(d.code, d)

      // Only risks that actually need a treatment plan tracked:
      //  - not ACCEPT (accepted risks need no RTP)
      //  - live in the register (exclude draft / closed / rejected / out-of-scope)
      const excludeStatus = new Set(['DRAFT', 'CLOSED', 'REJECTED', 'OUT_OF_SCOPE'])
      const built: RtpRow[] = ((risksData ?? []) as Risk[])
        .filter((risk) => risk.treatment_option !== 'ACCEPT' && !excludeStatus.has(risk.status))
        .map((risk) => {
          const latest = latestByRisk.get(risk.id) ?? null
          return { risk, dept: deptByCode.get(risk.dept_code) ?? null, latest, ts: tsOf(latest) }
        })
      setRows(built)
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

  const scopedRows = useMemo(() =>
    allowedDepts === null ? rows : rows.filter((r) => allowedDepts.includes(r.risk.dept_code)),
    [rows, allowedDepts])

  const counts = useMemo(() => {
    const c: Record<TreatmentStatus, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0, VERIFIED: 0 }
    for (const r of scopedRows) c[r.ts]++
    const outstanding = c.NOT_STARTED + c.IN_PROGRESS
    return { ...c, outstanding, total: scopedRows.length }
  }, [scopedRows])

  const filtered = useMemo(() => scopedRows.filter((r) => {
    if (deptF !== 'all' && r.risk.dept_code !== deptF) return false
    if (statusF === 'all') return true
    if (statusF === 'outstanding') return OUTSTANDING.includes(r.ts)
    return r.ts === statusF
  }), [scopedRows, statusF, deptF])

  // Group filtered rows by department for display.
  const groups = useMemo(() => {
    const byDept = new Map<string, RtpRow[]>()
    for (const r of filtered) {
      const key = r.risk.dept_code
      if (!byDept.has(key)) byDept.set(key, [])
      byDept.get(key)!.push(r)
    }
    const deptList = sortDeptsAlpha(depts.filter((d) => byDept.has(d.code)))
    const known = new Set(deptList.map((d) => d.code))
    const result = deptList.map((d) => ({
      code: d.code, name: d.name_en, rows: byDept.get(d.code)!,
    }))
    // Any dept codes not present in the depts table (defensive).
    for (const [code, rws] of Array.from(byDept)) {
      if (!known.has(code)) result.push({ code, name: code, rows: rws })
    }
    return result
  }, [filtered, depts])

  const scopedDepts = useMemo(
    () => sortDeptsAlpha(depts.filter((d) => d.kind === 'department'
      && (allowedDepts === null || allowedDepts.includes(d.code)))),
    [depts, allowedDepts])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="rtp" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">RTP Monitoring</div>
              <div className="tb-meta">Risk Treatment Plans by department · RMCQ</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <div className="rec-badge">
              {loading ? 'Loading…' : `${counts.outstanding} outstanding`}
            </div>
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
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}

          {!loading && notProvisioned && (
            <div className="panel" style={{ textAlign: 'center', padding: 36 }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>⏳</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Your account isn&apos;t set up yet</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 460, margin: '0 auto' }}>
                Ask the RMCQ administrator to register you in the Risk module, then sign in again.
              </div>
            </div>
          )}

          {!loading && !loadError && !notProvisioned && (
            <>
              <div className="pscs-tiles" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="tile"><div className="tl">Outstanding</div><div className="tv" style={{ color: 'var(--red)' }}>{counts.outstanding}</div></div>
                <div className="tile"><div className="tl">Not started</div><div className="tv" style={{ color: TS_BADGE.NOT_STARTED.fg }}>{counts.NOT_STARTED}</div></div>
                <div className="tile"><div className="tl">In progress</div><div className="tv" style={{ color: TS_BADGE.IN_PROGRESS.fg }}>{counts.IN_PROGRESS}</div></div>
                <div className="tile"><div className="tl">Completed</div><div className="tv" style={{ color: TS_BADGE.COMPLETED.fg }}>{counts.COMPLETED}</div></div>
                <div className="tile"><div className="tl">Verified</div><div className="tv" style={{ color: TS_BADGE.VERIFIED.fg }}>{counts.VERIFIED}</div></div>
              </div>

              <div className="risk-filterbar">
                <span className="rfb-label">🔎 Filters</span>
                <select value={statusF} onChange={(e) => setStatusF(e.target.value as RtpFilter)}>
                  <option value="outstanding">Outstanding (not done)</option>
                  <option value="all">All RTPs</option>
                  <option value="NOT_STARTED">Not started</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="VERIFIED">Verified</option>
                </select>
                <select value={deptF} onChange={(e) => setDeptF(e.target.value)}>
                  <option value="all">All departments</option>
                  {scopedDepts.map((d) => (
                    <option key={d.code} value={d.code}>{d.name_en}</option>
                  ))}
                </select>
                {(statusF !== 'outstanding' || deptF !== 'all') && (
                  <button type="button" className="reset-btn"
                    onClick={() => { setStatusF('outstanding'); setDeptF('all') }}>Reset</button>
                )}
              </div>

              {groups.length === 0 ? (
                <div className="panel" style={{ marginTop: 14, padding: '32px 16px', textAlign: 'center', color: 'var(--muted)' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {statusF === 'outstanding' ? 'No outstanding RTPs' : 'Nothing to show'}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {statusF === 'outstanding'
                      ? 'Every tracked treatment plan is completed or verified.'
                      : 'No risks match the current filters.'}
                  </div>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.code} className="panel" style={{ marginTop: 14 }}>
                    <div className="pf"><div>
                      <div className="pt">🏥 {g.name}</div>
                      <div className="psub">{g.rows.length} risk{g.rows.length === 1 ? '' : 's'} with a treatment plan</div>
                    </div></div>
                    <div style={{ overflowX: 'auto' }}>
                      <table className="risk-table">
                        <thead>
                          <tr>
                            <th>Risk ID</th>
                            <th>Description</th>
                            <th style={{ textAlign: 'center' }}>Level</th>
                            <th>Treatment</th>
                            <th>Target period</th>
                            <th style={{ textAlign: 'center' }}>RTP status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map(({ risk, latest, ts }) => {
                            const tb = TS_BADGE[ts]
                            return (
                              <tr key={risk.id}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11, borderLeftColor: latest ? RISK_LEVEL_COLOR[latest.risk_level] : 'transparent' }}>
                                  <Link href={`/risk/${risk.id}`} style={{ color: 'var(--blue)' }}>{risk.risk_id}</Link>
                                </td>
                                <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={risk.description}>{risk.description}</td>
                                <td style={{ textAlign: 'center' }}>
                                  {latest ? (
                                    <span style={{
                                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                      fontSize: 10, fontWeight: 700,
                                      color: RISK_LEVEL_COLOR[latest.risk_level], background: RISK_LEVEL_BG[latest.risk_level],
                                    }}>{RISK_LEVEL_LABEL[latest.risk_level]}</span>
                                  ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                </td>
                                <td style={{ fontSize: 11 }}>
                                  {risk.treatment_option
                                    ? TREATMENT_OPTION_LABEL[risk.treatment_option]
                                    : <span style={{ color: 'var(--muted)' }}>—</span>}
                                </td>
                                <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                                  {risk.implementation_period || '—'}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <span style={{
                                    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                    fontSize: 10, fontWeight: 700, color: tb.fg, background: tb.bg,
                                  }}>{TS_LABEL[ts]}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
