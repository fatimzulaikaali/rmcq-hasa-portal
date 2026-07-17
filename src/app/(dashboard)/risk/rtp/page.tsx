'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { RiskTabs } from '@/components/RiskTabs'
import { Risk, RiskDept, RiskRtp, RiskRtpTask, RtpOverallStatus, RtpAdequacy } from '@/lib/risk/types'
import { sortDeptsAlpha } from '@/lib/risk/sortDepts'

/* RTP (Risk Treatment Plan) monitoring — the Risk Coordinator's day-to-day
 * view. For every live, non-accepted risk we track whether the department is
 * actually carrying out its treatment plan: task progress, the next due date
 * (flagged when overdue), where the plan sits in the approval chain, and its
 * overall status. Data comes from the new `risk_rtp` / `risk_rtp_tasks` tables.
 * Accepted risks need no plan and are excluded. */

const OVERALL_LABEL: Record<RtpOverallStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED:   'Completed',
  VERIFIED:    'Verified',
}
const OVERALL_BADGE: Record<RtpOverallStatus, { fg: string; bg: string }> = {
  NOT_STARTED: { fg: '#A32D2D', bg: '#FCEBEB' },
  IN_PROGRESS: { fg: '#854F0B', bg: '#FBF1DD' },
  COMPLETED:   { fg: '#3B6D11', bg: '#EAF3E0' },
  VERIFIED:    { fg: '#0F6E56', bg: '#E3F5EF' },
}
const ADEQUACY_BADGE: Record<RtpAdequacy, { fg: string; bg: string }> = {
  H: { fg: '#3B6D11', bg: '#EAF3E0' },
  M: { fg: '#854F0B', bg: '#FBF1DD' },
  L: { fg: '#A32D2D', bg: '#FCEBEB' },
}
const OUTSTANDING: RtpOverallStatus[] = ['NOT_STARTED', 'IN_PROGRESS']

type RtpFilter = 'outstanding' | 'all' | RtpOverallStatus | 'overdue'

interface RtpRow {
  risk: Risk
  dept: RiskDept | null
  rtp: RiskRtp | null
  tasks: RiskRtpTask[]
  status: RtpOverallStatus
  tasksDone: number
  tasksTotal: number
  nextDue: string | null      // ISO date of earliest incomplete task, or null
  nextDueOverdue: boolean
  overdueCount: number        // incomplete tasks past due
  approval: string            // human-readable approval-chain position
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/* Where does the plan sit in prepared → HOD → RTC → ROC? Show the last stage
 * signed off, plus the next one still pending. */
function approvalText(rtp: RiskRtp | null): string {
  if (!rtp) return 'Not yet submitted'
  const chain: [string, boolean][] = [
    ['Prepared', !!rtp.prepared_by_name],
    ['HOD',      !!rtp.approved_hod_name],
    ['RTC',      !!rtp.reviewed_rtc_name],
    ['ROC',      !!rtp.approved_roc_name],
  ]
  const done = chain.filter(([, ok]) => ok)
  if (done.length === 0) return 'Not yet submitted'
  const last = done[done.length - 1][0]
  const next = chain.find(([, ok]) => !ok)
  if (last === 'ROC') return 'ROC ✔ complete'
  return next ? `${last} ✔ · ${next[0]} pending` : `${last} ✔`
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

      const [
        { data: risksData, error: risksErr },
        { data: rtpData, error: rtpErr },
        { data: taskData, error: taskErr },
      ] = await Promise.all([
        supabase.from('risks').select('*').order('created_at', { ascending: false }),
        supabase.from('risk_rtp').select('*'),
        supabase.from('risk_rtp_tasks').select('*').order('seq', { ascending: true }),
      ])
      if (risksErr) throw new Error(`Loading risks: ${risksErr.message}`)
      if (rtpErr) throw new Error(`Loading RTPs: ${rtpErr.message}`)
      if (taskErr) throw new Error(`Loading RTP tasks: ${taskErr.message}`)

      const rtpByRisk = new Map<number, RiskRtp>()
      for (const r of (rtpData ?? []) as RiskRtp[]) rtpByRisk.set(r.risk_id, r)

      const tasksByRtp = new Map<string, RiskRtpTask[]>()
      for (const t of (taskData ?? []) as RiskRtpTask[]) {
        if (!tasksByRtp.has(t.rtp_id)) tasksByRtp.set(t.rtp_id, [])
        tasksByRtp.get(t.rtp_id)!.push(t)
      }
      const deptByCode = new Map<string, RiskDept>()
      for (const d of (deptsData ?? []) as RiskDept[]) deptByCode.set(d.code, d)

      const today = todayISO()
      // Live risks that need a plan tracked: not ACCEPT, and in the register.
      const excludeStatus = new Set(['DRAFT', 'CLOSED', 'REJECTED', 'OUT_OF_SCOPE'])
      const built: RtpRow[] = ((risksData ?? []) as Risk[])
        .filter((risk) => risk.treatment_option !== 'ACCEPT' && !excludeStatus.has(risk.status))
        .map((risk) => {
          const rtp = rtpByRisk.get(risk.id) ?? null
          const tasks = rtp ? (tasksByRtp.get(rtp.id) ?? []) : []
          const tasksTotal = tasks.length
          const tasksDone = tasks.filter((t) => t.status === 'COMPLETED').length
          const incomplete = tasks.filter((t) => t.status !== 'COMPLETED' && t.due_date)
          incomplete.sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
          const nextDue = incomplete.length ? incomplete[0].due_date : null
          const overdueCount = incomplete.filter((t) => t.due_date! < today).length
          return {
            risk,
            dept: deptByCode.get(risk.dept_code) ?? null,
            rtp,
            tasks,
            status: rtp ? rtp.overall_status : 'NOT_STARTED',
            tasksDone,
            tasksTotal,
            nextDue,
            nextDueOverdue: !!nextDue && nextDue < today,
            overdueCount,
            approval: approvalText(rtp),
          }
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
    const c: Record<RtpOverallStatus, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, COMPLETED: 0, VERIFIED: 0 }
    let overdueTasks = 0
    for (const r of scopedRows) { c[r.status]++; overdueTasks += r.overdueCount }
    const outstanding = c.NOT_STARTED + c.IN_PROGRESS
    return { ...c, outstanding, overdueTasks, total: scopedRows.length }
  }, [scopedRows])

  const filtered = useMemo(() => scopedRows.filter((r) => {
    if (deptF !== 'all' && r.risk.dept_code !== deptF) return false
    if (statusF === 'all') return true
    if (statusF === 'outstanding') return OUTSTANDING.includes(r.status)
    if (statusF === 'overdue') return r.overdueCount > 0
    return r.status === statusF
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

        <RiskTabs active="rtp" />

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
              <div className="pscs-tiles" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div className="tile"><div className="tl">Not started</div><div className="tv" style={{ color: OVERALL_BADGE.NOT_STARTED.fg }}>{counts.NOT_STARTED}</div></div>
                <div className="tile"><div className="tl">In progress</div><div className="tv" style={{ color: OVERALL_BADGE.IN_PROGRESS.fg }}>{counts.IN_PROGRESS}</div></div>
                <div className="tile"><div className="tl">Completed</div><div className="tv" style={{ color: OVERALL_BADGE.COMPLETED.fg }}>{counts.COMPLETED + counts.VERIFIED}</div></div>
                <div className="tile"><div className="tl">Overdue tasks</div><div className="tv" style={{ color: 'var(--red)' }}>{counts.overdueTasks}</div></div>
              </div>

              <div className="risk-filterbar">
                <span className="rfb-label">🔎 Filters</span>
                <select value={statusF} onChange={(e) => setStatusF(e.target.value as RtpFilter)}>
                  <option value="outstanding">Outstanding (not done)</option>
                  <option value="all">All RTPs</option>
                  <option value="overdue">Has overdue task</option>
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
                groups.map((g) => {
                  const gOverdue = g.rows.reduce((s, r) => s + r.overdueCount, 0)
                  return (
                    <div key={g.code} className="panel risk-dept-panel" style={{ marginTop: 14 }}>
                      <div className="pf"><div>
                        <div className="pt">🏥 {g.name}</div>
                        <div className="psub">
                          {g.rows.length} RTP{g.rows.length === 1 ? '' : 's'}
                          {gOverdue > 0 ? ` · ${gOverdue} overdue task${gOverdue === 1 ? '' : 's'}` : ''}
                        </div>
                      </div></div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="risk-table">
                          <thead>
                            <tr>
                              <th>Risk</th>
                              <th style={{ textAlign: 'center' }}>Adequacy</th>
                              <th style={{ textAlign: 'center' }}>Tasks done</th>
                              <th>Next due</th>
                              <th>Approval</th>
                              <th style={{ textAlign: 'center' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((row) => {
                              const sb = OVERALL_BADGE[row.status]
                              const adq = row.rtp?.adequacy ?? null
                              return (
                                <tr key={row.risk.id} className="clk"
                                  onClick={() => router.push(`/risk/${row.risk.id}/rtp`)}
                                  style={{ cursor: 'pointer' }}>
                                  <td style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>
                                    <Link href={`/risk/${row.risk.id}/rtp`} style={{ color: 'var(--blue)' }}
                                      onClick={(e) => e.stopPropagation()}>{row.risk.risk_id}</Link>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    {adq ? (
                                      <span style={{
                                        display: 'inline-block', width: 20, height: 20, lineHeight: '20px',
                                        borderRadius: 4, fontSize: 11, fontWeight: 700,
                                        color: ADEQUACY_BADGE[adq].fg, background: ADEQUACY_BADGE[adq].bg,
                                      }}>{adq}</span>
                                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'center', fontSize: 11 }}>
                                    {row.tasksTotal ? `${row.tasksDone} / ${row.tasksTotal}` : '—'}
                                  </td>
                                  <td style={{ fontSize: 11, color: row.nextDueOverdue ? 'var(--red)' : 'var(--muted)', fontWeight: row.nextDueOverdue ? 600 : 400 }}>
                                    {row.nextDue ? `${fmtDate(row.nextDue)}${row.nextDueOverdue ? ' · overdue' : ''}` : '—'}
                                  </td>
                                  <td style={{ fontSize: 11 }}>{row.approval}</td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span style={{
                                      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                      fontSize: 10, fontWeight: 700, color: sb.fg, background: sb.bg,
                                    }}>{OVERALL_LABEL[row.status]}</span>
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
