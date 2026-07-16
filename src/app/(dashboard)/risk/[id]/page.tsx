'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess, resolveCurrentRiskUser } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { RiskAttachments } from '@/components/RiskAttachments'
import {
  Risk, RiskReview, RiskDept, RiskUser,
  RiskRtp, RiskRtpTask, RiskDeptResponse, RtpOverallStatus,
} from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_DOMAIN_LABEL, RISK_NATURE_LABEL, TREATMENT_OPTION_LABEL,
  RISK_STATUS_LABEL, RISK_STATUS_BADGE,
  RISK_SCOPE_LABEL, RISK_ROLE_LABEL,
} from '@/lib/risk/scoring'

interface AuditLog {
  id: number
  risk_id: number | null
  entity_type: string | null
  entity_id: number | null
  action_type: string
  performed_by: number
  user_role: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  comment: string | null
  performed_at: string
}

/* Committee stage labels for the trail. */
const STAGE_LABEL: Record<NonNullable<Risk['committee_stage']>, string> = {
  NOT_TABLED:      'Not yet tabled',
  TABLED_RTC:      'Tabled at Risk Technical Committee (RTC)',
  ENDORSED_ROC:    'Endorsed at Risk Owner Committee (ROC)',
  SENT_BACK:       'Sent back to department',
  RECOMMEND_CLOSE: 'Recommended for closure',
}

const RTP_STATUS_LABEL: Record<RtpOverallStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED:   'Completed',
  VERIFIED:    'Verified',
}
const RTP_STATUS_BADGE: Record<RtpOverallStatus, { bg: string; fg: string }> = {
  NOT_STARTED: { bg: '#FEE2E2', fg: '#991B1B' },
  IN_PROGRESS: { bg: '#FEF3C7', fg: '#854D0E' },
  COMPLETED:   { bg: '#DCFCE7', fg: '#166534' },
  VERIFIED:    { bg: '#DCFCE7', fg: '#166534' },
}

const RECEIVED_VIA = ['Email', 'Meeting', 'WhatsApp / call', 'Paper', 'Other'] as const

export default function RiskDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const riskRowId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const [risk, setRisk]       = useState<Risk | null>(null)
  const [dept, setDept]       = useState<RiskDept | null>(null)
  const [reviews, setReviews] = useState<RiskReview[]>([])
  const [logs, setLogs]       = useState<AuditLog[]>([])
  const [users, setUsers]     = useState<Map<number, RiskUser>>(new Map())
  const [rtp, setRtp]         = useState<RiskRtp | null>(null)
  const [rtpTasks, setRtpTasks] = useState<RiskRtpTask[]>([])
  const [responses, setResponses] = useState<RiskDeptResponse[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)

  // Department-response form state.
  const [respDirective, setRespDirective] = useState('')
  const [respText, setRespText] = useState('')
  const [respOn, setRespOn] = useState('')
  const [respVia, setRespVia] = useState<string>('Email')
  const [savingResp, setSavingResp] = useState(false)

  useEffect(() => { void load() }, [riskRowId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!Number.isFinite(riskRowId)) { setNotFound(true); setLoading(false); return }
    setLoading(true); setLoadError(null); setNotFound(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: riskData, error: riskErr } = await supabase
        .from('risks').select('*').eq('id', riskRowId).maybeSingle()
      if (riskErr) throw new Error(`Risk: ${riskErr.code ?? ''} ${riskErr.message}`)
      if (!riskData) { setNotFound(true); return }

      const access = await getModuleAccess(supabase)
      if (access.deptScopes !== null && !access.deptScopes.includes((riskData as Risk).dept_code)) {
        setNotFound(true)
        return
      }
      const role = access.activeRole?.role
      setCanEdit(role === 'RC' || role === 'ADMIN' || role === 'DIRECTOR')

      setRisk(riskData as Risk)

      const ruRes = await resolveCurrentRiskUser(supabase)
      if (ruRes.ok) setCurrentUserId(ruRes.user.riskUserId)

      const [
        { data: deptData, error: deptErr },
        { data: reviewsData, error: reviewsErr },
        { data: logsData, error: logsErr },
        { data: usersData, error: usersErr },
        { data: rtpData, error: rtpErr },
        { data: respData, error: respErr },
      ] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', (riskData as Risk).dept_code).maybeSingle(),
        supabase.from('risk_reviews').select('*')
          .eq('risk_id', riskRowId).order('cycle_number', { ascending: false }),
        supabase.from('risk_audit_logs').select('*')
          .eq('risk_id', riskRowId).order('performed_at', { ascending: false }),
        supabase.from('risk_users').select('id,auth_user_id,name,email,is_active,created_at,last_login'),
        supabase.from('risk_rtp').select('*').eq('risk_id', riskRowId).maybeSingle(),
        supabase.from('risk_dept_responses').select('*')
          .eq('risk_id', riskRowId).order('created_at', { ascending: false }),
      ])
      if (deptErr)    throw new Error(`Department: ${deptErr.code ?? ''} ${deptErr.message}`)
      if (reviewsErr) throw new Error(`Reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)
      if (logsErr)    throw new Error(`Audit logs: ${logsErr.code ?? ''} ${logsErr.message}`)
      if (usersErr)   throw new Error(`Users: ${usersErr.code ?? ''} ${usersErr.message}`)
      if (rtpErr)     throw new Error(`RTP: ${rtpErr.code ?? ''} ${rtpErr.message}`)
      if (respErr)    throw new Error(`Responses: ${respErr.code ?? ''} ${respErr.message}`)

      setDept(deptData as RiskDept | null)
      setReviews((reviewsData ?? []) as RiskReview[])
      setLogs((logsData ?? []) as AuditLog[])
      setResponses((respData ?? []) as RiskDeptResponse[])

      const m = new Map<number, RiskUser>()
      for (const u of (usersData ?? []) as RiskUser[]) m.set(u.id, u)
      setUsers(m)

      const rtpRow = (rtpData ?? null) as RiskRtp | null
      setRtp(rtpRow)
      if (rtpRow) {
        const { data: taskData } = await supabase.from('risk_rtp_tasks')
          .select('*').eq('rtp_id', rtpRow.id).order('seq', { ascending: true })
        setRtpTasks((taskData ?? []) as RiskRtpTask[])
      } else {
        setRtpTasks([])
      }
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

  /* Update the risk status + write an audit-log entry. */
  async function transition(opts: {
    newStatus: Risk['status']
    action: string
    comment?: string
    extras?: Partial<Risk>
  }) {
    if (!risk || !currentUserId) return
    setTransitioning(true); setTransitionError(null)
    try {
      const payload: Partial<Risk> = { status: opts.newStatus, ...(opts.extras ?? {}) }
      const { data: updated, error: upErr } = await supabase.from('risks')
        .update(payload).eq('id', risk.id).select('*').single()
      if (upErr) throw new Error(`Status update: ${upErr.code ?? ''} ${upErr.message}`)
      setRisk(updated as Risk)

      const { error: auditErr } = await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id, entity_type: 'risk', entity_id: risk.id,
        action_type: opts.action, performed_by: currentUserId, user_role: 'RC',
        old_value: { status: risk.status },
        new_value: { status: opts.newStatus, ...(opts.extras ?? {}) },
        comment: opts.comment ?? null,
      })
      if (auditErr) console.warn('Audit log insert failed:', auditErr)

      const { data: logsData } = await supabase.from('risk_audit_logs')
        .select('*').eq('risk_id', risk.id).order('performed_at', { ascending: false })
      setLogs((logsData ?? []) as AuditLog[])
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : String(e))
    } finally {
      setTransitioning(false)
    }
  }

  async function handleClose() {
    const note = window.prompt('Closing note (optional):', '')
    if (note === null) return
    await transition({
      newStatus: 'CLOSED', action: 'CLOSE', comment: note.trim() || 'Risk closed',
      extras: { date_closed: new Date().toISOString(), closed_by: currentUserId ?? undefined },
    })
  }

  async function handleEscalate() {
    if (!window.confirm('Manually escalate this risk to the Risk Owner Committee (ROC)?')) return
    await transition({
      newStatus: 'TABLED_ROC', action: 'ESCALATE_MANUAL', comment: 'Manually escalated to ROC',
      extras: { escalation_type: 'MANUAL', committee_stage: 'TABLED_RTC' },
    })
  }

  /* Record a department's response to a committee directive (the Coordinator
   * enters what the department communicated outside the portal). */
  async function saveResponse() {
    if (!risk || !currentUserId) return
    if (!respText.trim() && !respDirective.trim()) return
    setSavingResp(true); setTransitionError(null)
    try {
      const { error } = await supabase.from('risk_dept_responses').insert({
        risk_id: risk.id,
        directive: respDirective.trim() || null,
        response: respText.trim() || null,
        received_on: respOn || null,
        received_via: respVia,
        recorded_by: currentUserId,
      })
      if (error) throw new Error(`Save response: ${error.code ?? ''} ${error.message}`)
      setRespDirective(''); setRespText(''); setRespOn(''); setRespVia('Email')
      const { data } = await supabase.from('risk_dept_responses').select('*')
        .eq('risk_id', risk.id).order('created_at', { ascending: false })
      setResponses((data ?? []) as RiskDeptResponse[])
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingResp(false)
    }
  }

  function nameOf(uid: number | null | undefined): string {
    if (!uid) return '—'
    return users.get(uid)?.name ?? `user #${uid}`
  }

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—'
    if (s.length <= 10) return s
    const d = new Date(s)
    if (isNaN(d.getTime())) return s.slice(0, 10)
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Kuala_Lumpur',
    }).format(d).replace(',', '')
  }

  const latest = reviews[0] ?? null
  const rtpTasksDone = rtpTasks.filter((t) => t.status === 'COMPLETED').length

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="risk" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title" style={{ fontFamily: 'monospace' }}>
                {risk?.risk_id ?? (notFound ? 'Not Found' : '…')}
              </div>
              <div className="tb-meta">
                {dept ? `${dept.name_en} · ${dept.risk_code}` : risk?.dept_code ?? ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            {risk && (
              <Link href={`/risk/${risk.id}/review`} className="signout-btn"
                style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
                + New Review Cycle
              </Link>
            )}
            <Link href="/risk" className="signout-btn">← Register</Link>
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
          {!loading && !loadError && notFound && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Risk not found</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                No risk with id <code>{riskRowId}</code> exists.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
                  ← Back to register
                </Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !notFound && risk && (
            <>
              {/* Hero header — anchored by severity */}
              <div className="risk-hero" style={{
                ['--hero-accent' as string]: latest ? RISK_LEVEL_COLOR[latest.risk_level] : '#9CA3AF',
                ['--hero-bg' as string]: latest ? RISK_LEVEL_BG[latest.risk_level] : '#F8FAFC',
              } as React.CSSProperties}>
                <div style={{ minWidth: 0 }}>
                  <div className="risk-hero-id">{risk.risk_id}</div>
                  <div className="risk-hero-meta">
                    <span>{dept?.name_en ?? risk.dept_code}</span>
                    <span>· {risk.risk_nature ? RISK_NATURE_LABEL[risk.risk_nature] : '—'}</span>
                    <span>· {risk.treatment_option ? TREATMENT_OPTION_LABEL[risk.treatment_option] : 'No treatment'}</span>
                    <span>· {RISK_SCOPE_LABEL[risk.scope]}</span>
                  </div>
                  <div className="risk-hero-chips">
                    <span className="risk-chip" style={{ color: RISK_STATUS_BADGE[risk.status].fg, background: RISK_STATUS_BADGE[risk.status].bg }}>
                      {RISK_STATUS_LABEL[risk.status]}
                    </span>
                    {risk.entry_mode === 'rmcq_managed' && (
                      <span className="risk-chip" style={{ color: '#92400E', background: '#FEF3C7' }}
                        title="Paper submission entered by the Coordinator">📝 Paper-logged</span>
                    )}
                    {risk.submit_to_erms && (
                      <span className="risk-chip" style={{ color: '#166534', background: '#DCFCE7' }}
                        title="Flagged for submission to ERMS UiTM">✔ ERMS UiTM</span>
                    )}
                    <span className="risk-chip" style={{ color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)' }}>
                      Cycle {latest?.cycle_number ?? '—'}
                    </span>
                  </div>
                </div>
                <div className="risk-hero-score">
                  {latest ? (
                    <>
                      <div className="risk-hero-score-num" style={{ color: RISK_LEVEL_COLOR[latest.risk_level] }}>
                        {Math.round(latest.risk_score)}
                      </div>
                      <div className="risk-hero-score-lvl" style={{ color: RISK_LEVEL_COLOR[latest.risk_level], background: '#fff' }}>
                        {RISK_LEVEL_LABEL[latest.risk_level]}
                      </div>
                    </>
                  ) : <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Not yet scored</div>}
                </div>
              </div>

              <div className="risk-detail-cols">
                {/* ---- Main column ---- */}
                <div className="risk-detail-main">
                  {/* Risk detail */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">🪪 Risk detail</div></div></div>
                    <div className="risk-detail-grid">
                      <DefLine label="Risk ID" mono>{risk.risk_id}</DefLine>
                      <DefLine label="Department">{dept?.name_en ?? risk.dept_code}</DefLine>
                      <DefLine label="UiTM domain">
                        {risk.uitm_domain ? <b>{RISK_DOMAIN_LABEL[risk.uitm_domain]}</b> : <em style={{ color: 'var(--muted)' }}>Unassigned</em>}
                      </DefLine>
                      <DefLine label="Nature">{risk.risk_nature ? RISK_NATURE_LABEL[risk.risk_nature] : '—'}</DefLine>
                      <DefLine label="Scope">{RISK_SCOPE_LABEL[risk.scope]}</DefLine>
                      <DefLine label="Treatment">
                        {risk.treatment_option ? TREATMENT_OPTION_LABEL[risk.treatment_option] : <em style={{ color: 'var(--muted)' }}>—</em>}
                      </DefLine>
                      <DefLine label="Context" full>{risk.context || <em style={{ color: 'var(--muted)' }}>—</em>}</DefLine>
                    </div>
                    <DefBlock label="Description">{risk.description}</DefBlock>
                    <DefBlock label="Cause">{risk.cause_description || <em style={{ color: 'var(--muted)' }}>—</em>}</DefBlock>
                    <DefBlock label="Consequence">{risk.impact_description || <em style={{ color: 'var(--muted)' }}>—</em>}</DefBlock>
                    <DefBlock label="Existing control">{risk.existing_controls || <em style={{ color: 'var(--muted)' }}>not specified</em>}</DefBlock>
                    <DefBlock label="Additional controls">{risk.additional_controls || <em style={{ color: 'var(--muted)' }}>not specified</em>}</DefBlock>
                    {canEdit && (
                      <div style={{ marginTop: 6 }}>
                        <Link href={`/risk/${risk.id}/edit`} className="signout-btn">✎ Edit risk register entry</Link>
                      </div>
                    )}
                  </div>

                  {/* Current → Residual */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">📊 Current → Residual risk</div></div></div>
                    {latest ? (
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <ScoreBox label="Current" score={Math.round(latest.risk_score)}
                          level={latest.risk_level} hint={`L${latest.likelihood} × S${latest.severity ?? '—'}`} />
                        {latest.residual_level ? (
                          <ScoreBox label="Residual (target)"
                            score={latest.residual_score != null ? Math.round(latest.residual_score) : null}
                            level={latest.residual_level}
                            hint={`L${latest.residual_likelihood ?? '—'} × S${latest.residual_severity ?? '—'}`} />
                        ) : (
                          <div style={{ flex: 1, minWidth: 160, border: '1px dashed var(--border)', borderRadius: 8, padding: 14, color: 'var(--muted)', fontSize: 12 }}>
                            No residual score recorded yet.
                          </div>
                        )}
                      </div>
                    ) : <div style={{ fontSize: 12, color: 'var(--muted)' }}>Not yet scored.</div>}
                  </div>

                  {/* Committee trail */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">🕑 Committee trail</div></div></div>
                    <div className="timeline" style={{ marginTop: 6 }}>
                      <TrailItem date={fmtDate(risk.date_opened)} title="Logged from paper register">
                        {risk.entry_mode === 'rmcq_managed'
                          ? <>Entered by the Risk Coordinator{risk.paper_submitted_by ? <> · submitted by <b>{risk.paper_submitted_by}</b></> : null}{risk.paper_endorsed_by ? <> · HOD-endorsed by <b>{risk.paper_endorsed_by}</b></> : null}{risk.paper_reference ? <> · ref <i>{risk.paper_reference}</i></> : null}.</>
                          : <>Created in the portal.</>}
                      </TrailItem>
                      {risk.committee_stage && risk.committee_stage !== 'NOT_TABLED' && (
                        <TrailItem date={risk.roc_ref || risk.rtc_ref || '—'} title={STAGE_LABEL[risk.committee_stage]}>
                          {risk.rtc_ref && <>RTC ref: <b>{risk.rtc_ref}</b>. </>}
                          {risk.roc_ref && <>ROC ref: <b>{risk.roc_ref}</b>. </>}
                          {risk.escalation_type === 'AUTO' && <>Auto-escalated (score ≥ High). </>}
                          {risk.escalation_type === 'MANUAL' && <>Manually escalated. </>}
                          {risk.submit_to_erms && <><strong>Submit to ERMS UiTM:</strong> ✔ Yes.</>}
                        </TrailItem>
                      )}
                      {risk.committee_notes && (
                        <TrailItem date="Decision notes" title="Committee decision">
                          {risk.committee_notes}
                        </TrailItem>
                      )}
                    </div>
                  </div>

                  {/* Committee decision & department response — recorded by the Coordinator */}
                  <div className="panel" style={{ borderLeft: '4px solid var(--amber, #F59E0B)' }}>
                    <div className="pf"><div>
                      <div className="pt">🗣️ Committee decision &amp; department response</div>
                      <div className="psub">Recorded by the Coordinator — departments don&apos;t log in; they communicate outside the portal.</div>
                    </div></div>

                    {responses.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                        {responses.map((r) => (
                          <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px' }}>
                            {r.directive && (
                              <div style={{ fontSize: 12, marginBottom: 4 }}>
                                <span style={{ fontWeight: 700, color: '#92400E' }}>Directive: </span>{r.directive}
                              </div>
                            )}
                            {r.response && (
                              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                                <span style={{ fontWeight: 700 }}>Response: </span>{r.response}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                              {r.received_on ? `Received ${r.received_on}` : 'Received —'}
                              {r.received_via ? ` · via ${r.received_via}` : ''}
                              {` · recorded by ${nameOf(r.recorded_by)}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {canEdit ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className="risk-field">
                          <label>Committee directive</label>
                          <textarea rows={2} value={respDirective} onChange={(e) => setRespDirective(e.target.value)}
                            placeholder="e.g. 'Implement RTP and re-submit residual scoring by next review.'" />
                        </div>
                        <div className="risk-field">
                          <label>Department&apos;s response (email / meeting / WhatsApp)</label>
                          <textarea rows={2} value={respText} onChange={(e) => setRespText(e.target.value)}
                            placeholder="e.g. 'ED confirmed 2nd triage station approved, procurement in progress.'" />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <div className="risk-field" style={{ flex: '1 1 160px' }}>
                            <label>Received on</label>
                            <input type="date" value={respOn} onChange={(e) => setRespOn(e.target.value)} />
                          </div>
                          <div className="risk-field" style={{ flex: '1 1 160px' }}>
                            <label>Received via</label>
                            <select value={respVia} onChange={(e) => setRespVia(e.target.value)}>
                              {RECEIVED_VIA.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </div>
                        </div>
                        <div>
                          <button type="button" className="signout-btn"
                            style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                            disabled={savingResp || (!respText.trim() && !respDirective.trim())}
                            onClick={saveResponse}>
                            {savingResp ? 'Saving…' : 'Save response'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Only the Risk Coordinator can record responses.</div>
                    )}
                  </div>

                  {/* Review history */}
                  {reviews.length > 1 && (
                    <div className="panel">
                      <div className="pf"><div><div className="pt">🕘 Review history</div><div className="psub">{reviews.length} cycles</div></div></div>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="risk-table">
                          <thead>
                            <tr>
                              <th>Cycle</th><th>Date</th><th>Reviewer</th>
                              <th style={{ textAlign: 'center' }}>L</th>
                              <th style={{ textAlign: 'center' }}>S</th>
                              <th style={{ textAlign: 'right' }}>Score</th>
                              <th style={{ textAlign: 'center' }}>Res L</th>
                              <th style={{ textAlign: 'center' }}>Res S</th>
                              <th style={{ textAlign: 'right' }}>Res Score</th>
                              <th style={{ textAlign: 'center' }}>Level</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reviews.map((rv) => (
                              <tr key={rv.id}>
                                <td>{rv.cycle_number}</td>
                                <td>{fmtDate(rv.review_date)}</td>
                                <td>{nameOf(rv.reviewed_by)}</td>
                                <td style={{ textAlign: 'center' }}>{rv.likelihood}</td>
                                <td style={{ textAlign: 'center' }}>{rv.severity ?? '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(rv.risk_score)}</td>
                                <td style={{ textAlign: 'center' }}>{rv.residual_likelihood ?? '—'}</td>
                                <td style={{ textAlign: 'center' }}>{rv.residual_severity ?? '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{rv.residual_score != null ? Math.round(rv.residual_score) : '—'}</td>
                                <td style={{ textAlign: 'center' }}>
                                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RISK_LEVEL_COLOR[rv.risk_level], background: RISK_LEVEL_BG[rv.risk_level] }}>
                                    {RISK_LEVEL_LABEL[rv.risk_level]}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Audit log */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">🧾 Audit log</div><div className="psub">{logs.length} event{logs.length === 1 ? '' : 's'}</div></div></div>
                    {logs.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No audit events yet.</div>
                    ) : (
                      <ul className="audit-list">
                        {logs.map((log) => (
                          <li key={log.id}>
                            <span className="audit-action">{log.action_type}</span>
                            <span className="audit-meta">
                              {nameOf(log.performed_by)}
                              {log.user_role && <> · <span style={{ color: 'var(--muted)' }}>{RISK_ROLE_LABEL[log.user_role as keyof typeof RISK_ROLE_LABEL] ?? log.user_role}</span></>}
                              <> · {fmtDate(log.performed_at)}</>
                            </span>
                            {log.comment && <div className="audit-comment">{log.comment}</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* ---- Side column ---- */}
                <div className="risk-detail-side">
                  {transitionError && (
                    <div className="ac red"><div className="ai">⚠️</div>
                      <div><div className="at">Error</div><div className="as">{transitionError}</div></div>
                    </div>
                  )}

                  {/* Attachments */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">📎 Attachments</div></div></div>
                    <div style={{ padding: '4px 4px 8px' }}>
                      <RiskAttachments riskId={risk.id} canEdit={canEdit} />
                    </div>
                  </div>

                  {/* RTP status */}
                  <div className="panel">
                    <div className="pf"><div><div className="pt">🎯 RTP status</div></div></div>
                    {risk.treatment_option === 'ACCEPT' ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Treatment is <b>Accept</b> — no RTP required.</div>
                    ) : rtp ? (
                      <>
                        <div className="risk-detail-grid">
                          <DefLine label="Progress">
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: RTP_STATUS_BADGE[rtp.overall_status].fg, background: RTP_STATUS_BADGE[rtp.overall_status].bg }}>
                              {RTP_STATUS_LABEL[rtp.overall_status]}
                            </span>
                          </DefLine>
                          <DefLine label="Tasks">{rtpTasksDone} of {rtpTasks.length} done</DefLine>
                          <DefLine label="Adequacy">{rtp.adequacy ?? '—'}</DefLine>
                          <DefLine label="Last reviewed">{fmtDate(rtp.last_reviewed)}</DefLine>
                        </div>
                        <Link href={`/risk/${risk.id}/rtp`} className="signout-btn"
                          style={{ display: 'block', textAlign: 'center', marginTop: 10, background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
                          Open RTP →
                        </Link>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>No RTP created yet for this risk.</div>
                        {canEdit && (
                          <Link href={`/risk/${risk.id}/rtp`} className="signout-btn"
                            style={{ display: 'block', textAlign: 'center', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>
                            ＋ Create RTP
                          </Link>
                        )}
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  {canEdit && (
                    <div className="panel">
                      <div className="pf"><div><div className="pt">Actions</div></div></div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Link href={`/risk/${risk.id}/edit`} className="signout-btn" style={{ textAlign: 'center' }}>✎ Edit risk</Link>
                        {risk.status !== 'CLOSED' && risk.status !== 'TABLED_ROC' && (
                          <button type="button" className="signout-btn" disabled={transitioning} onClick={handleEscalate}>🔺 Escalate manually</button>
                        )}
                        {risk.status !== 'CLOSED' && risk.status !== 'PENDING_CLOSURE' && (
                          <button type="button" className="signout-btn" disabled={transitioning}
                            onClick={() => transition({ newStatus: 'PENDING_CLOSURE', action: 'RECOMMEND_CLOSE', comment: 'Recommended for closure', extras: { committee_stage: 'RECOMMEND_CLOSE' } })}>
                            🏁 Recommend closure
                          </button>
                        )}
                        {risk.status === 'PENDING_CLOSURE' && (
                          <button type="button" className="signout-btn" disabled={transitioning}
                            style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                            onClick={handleClose}>✓ Close risk</button>
                        )}
                        {risk.status === 'CLOSED' && (
                          <button type="button" className="signout-btn" disabled={transitioning}
                            onClick={() => transition({ newStatus: 'ACTIVE', action: 'REOPEN', comment: 'Risk reopened', extras: { date_closed: undefined, closed_by: undefined } })}>
                            ↻ Reopen
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ---- helpers ---- */

function ScoreBox({ label, score, level, hint }: {
  label: string
  score: number | null
  level: RiskReview['risk_level']
  hint: string
}) {
  return (
    <div style={{ flex: 1, minWidth: 160, border: '1px solid var(--border)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: RISK_LEVEL_COLOR[level], lineHeight: 1.1 }}>{score ?? '—'}</div>
      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, color: RISK_LEVEL_COLOR[level], background: RISK_LEVEL_BG[level] }}>
        {RISK_LEVEL_LABEL[level]}
      </span>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>
    </div>
  )
}

function TrailItem({ date, title, children }: { date: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 16, paddingBottom: 12, borderLeft: '2px solid var(--border)', marginLeft: 4 }}>
      <span style={{ position: 'absolute', left: -5, top: 2, width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{date}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{children}</div>
    </div>
  )
}

function DefLine({ label, children, full, mono }: {
  label: string
  children: React.ReactNode
  full?: boolean
  mono?: boolean
}) {
  return (
    <div className={`risk-def ${full ? 'full' : ''}`}>
      <div className="risk-def-label">{label}</div>
      <div className="risk-def-value" style={{ fontFamily: mono ? 'monospace' : 'inherit' }}>{children}</div>
    </div>
  )
}

function DefBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="risk-def-block">
      <div className="risk-def-label">{label}</div>
      <div className="risk-def-block-value">{children}</div>
    </div>
  )
}
