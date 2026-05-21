'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess, resolveCurrentRiskUser } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import type { ActiveRole } from '@/lib/risk/activeRole'
import type { RiskRole } from '@/lib/risk/types'
import {
  Risk, RiskReview, RiskDept, RiskUser, CrossCuttingTheme,
  RiskMeeting, RiskMeetingAgenda, RiskActionItem, CommitteeOutcome, ActionStatus,
} from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
  RISK_SCOPE_LABEL, RISK_ROLE_LABEL,
  COMMITTEE_OUTCOME_LABEL, ACTION_TYPE_LABEL, ACTION_STATUS_LABEL,
} from '@/lib/risk/scoring'

/* An agenda decision joined with its meeting (for the Committee Reviews section). */
interface CommitteeReview extends RiskMeetingAgenda {
  risk_meetings: RiskMeeting | null
}

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
  const [themes, setThemes]   = useState<CrossCuttingTheme[]>([])
  const [committeeReviews, setCommitteeReviews] = useState<CommitteeReview[]>([])
  const [actionItems, setActionItems] = useState<RiskActionItem[]>([])
  const [actionDeptNames, setActionDeptNames] = useState<Map<string, string>>(new Map())
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [activeRole, setActiveRole] = useState<ActiveRole | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)

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

      // Dept-scope guard — dept-restricted users can't see risks outside their dept
      const access = await getModuleAccess(supabase)
      setActiveRole(access.activeRole)
      if (access.deptScopes !== null && !access.deptScopes.includes((riskData as Risk).dept_code)) {
        setNotFound(true)
        return
      }

      setRisk(riskData as Risk)

      // Resolve the current Risk-module user id for audit-log attribution
      const ruRes = await resolveCurrentRiskUser(supabase)
      if (ruRes.ok) {
        setCurrentUserId(ruRes.user.riskUserId)
      }

      const [
        { data: deptData, error: deptErr },
        { data: reviewsData, error: reviewsErr },
        { data: logsData, error: logsErr },
        { data: usersData, error: usersErr },
        { data: tagsData, error: tagsErr },
        { data: agendaData, error: agendaErr },
        { data: actionData, error: actionErr },
      ] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', (riskData as Risk).dept_code).maybeSingle(),
        supabase.from('risk_reviews').select('*')
          .eq('risk_id', riskRowId).order('cycle_number', { ascending: false }),
        supabase.from('risk_audit_logs').select('*')
          .eq('risk_id', riskRowId).order('performed_at', { ascending: false }),
        supabase.from('risk_users').select('id,auth_user_id,name,email,is_active,created_at,last_login'),
        supabase.from('risk_theme_tags').select('theme_id, cross_cutting_themes(*)').eq('risk_id', riskRowId),
        supabase.from('risk_meeting_agenda').select('*, risk_meetings(*)')
          .eq('risk_id', riskRowId).order('created_at', { ascending: false }),
        supabase.from('risk_action_items').select('*')
          .eq('risk_id', riskRowId).order('id', { ascending: false }),
      ])
      if (deptErr)    throw new Error(`Department: ${deptErr.code ?? ''} ${deptErr.message}`)
      if (reviewsErr) throw new Error(`Reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)
      if (logsErr)    throw new Error(`Audit logs: ${logsErr.code ?? ''} ${logsErr.message}`)
      if (usersErr)   throw new Error(`Users: ${usersErr.code ?? ''} ${usersErr.message}`)
      if (tagsErr)    throw new Error(`Theme tags: ${tagsErr.code ?? ''} ${tagsErr.message}`)
      if (agendaErr)  throw new Error(`Committee reviews: ${agendaErr.code ?? ''} ${agendaErr.message}`)
      if (actionErr)  throw new Error(`Action items: ${actionErr.code ?? ''} ${actionErr.message}`)

      setDept(deptData as RiskDept | null)
      setReviews((reviewsData ?? []) as RiskReview[])
      setLogs((logsData ?? []) as AuditLog[])

      const m = new Map<number, RiskUser>()
      for (const u of (usersData ?? []) as RiskUser[]) m.set(u.id, u)
      setUsers(m)

      // unwrap nested cross_cutting_themes from the join
      const themeRows = (tagsData ?? []) as { theme_id: number; cross_cutting_themes: CrossCuttingTheme | CrossCuttingTheme[] | null }[]
      const ts: CrossCuttingTheme[] = []
      for (const t of themeRows) {
        const cct = Array.isArray(t.cross_cutting_themes) ? t.cross_cutting_themes[0] : t.cross_cutting_themes
        if (cct) ts.push(cct)
      }
      setThemes(ts)

      // committee decisions (only those that have actually been decided) + action items
      const reviews = ((agendaData ?? []) as CommitteeReview[]).filter((a) => a.outcome)
      setCommitteeReviews(reviews)
      const actions = (actionData ?? []) as RiskActionItem[]
      setActionItems(actions)

      // Names for the departments these action items are assigned to.
      const actionDeptCodes = Array.from(new Set(actions.flatMap((a) => a.assigned_depts ?? [])))
      if (actionDeptCodes.length) {
        const { data: adepts } = await supabase.from('pscs_departments').select('code,name_en').in('code', actionDeptCodes)
        const adm = new Map<string, string>()
        for (const d of (adepts ?? []) as { code: string; name_en: string }[]) adm.set(d.code, d.name_en)
        setActionDeptNames(adm)
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

  /* Transition the risk to a new status + write an audit log entry. */
  async function transition(opts: {
    newStatus: Risk['status']
    action: string                    // audit action_type
    role?: 'RLO' | 'HOD' | 'RC' | 'ADMIN'
    comment?: string
    extras?: Partial<Risk>             // additional fields to update (e.g. rejection_* on reject)
  }) {
    if (!risk || !currentUserId) return
    setTransitioning(true); setTransitionError(null)
    try {
      const payload: Partial<Risk> = {
        status: opts.newStatus,
        ...(opts.extras ?? {}),
      }
      const { data: updated, error: upErr } = await supabase.from('risks')
        .update(payload).eq('id', risk.id).select('*').single()
      if (upErr) throw new Error(`Status update: ${upErr.code ?? ''} ${upErr.message}`)
      setRisk(updated as Risk)

      const { error: auditErr } = await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk',
        entity_id: risk.id,
        action_type: opts.action,
        performed_by: currentUserId,
        user_role: opts.role ?? 'ADMIN',
        old_value: { status: risk.status },
        new_value: { status: opts.newStatus, ...(opts.extras ?? {}) },
        comment: opts.comment ?? null,
      })
      if (auditErr) console.warn('Audit log insert failed:', auditErr)

      // Refresh logs locally so timeline updates immediately
      const { data: logsData } = await supabase.from('risk_audit_logs')
        .select('*').eq('risk_id', risk.id).order('performed_at', { ascending: false })
      setLogs((logsData ?? []) as AuditLog[])
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : String(e))
    } finally {
      setTransitioning(false)
    }
  }

  /* HOD / committee returns the risk to the RLO to amend — NOT terminal.
   * Stays in the Active register; the RLO revises and resubmits. */
  async function handleReturn(role: 'HOD' | 'RC') {
    const text = window.prompt('What needs amending? (this note will be shown to the RLO):', '')?.trim()
    if (!text) return
    await transition({
      newStatus: 'RETURNED',
      action: 'RETURN_FOR_AMENDMENT',
      role,
      comment: `Returned for amendment: ${text}`,
      extras: {
        // rejection_* columns are reused as the amendment note (reason is varchar(50)).
        rejection_reason: text.slice(0, 50),
        rejection_comment: text,
        rejected_by: currentUserId ?? undefined,
        rejected_at: new Date().toISOString(),
      },
    })
  }

  /* RC declines the risk — it doesn't meet the criteria for the register.
   * Terminal: lands in the Archive. The RC can reopen it later. */
  async function handleOutOfScope() {
    const text = window.prompt('Why is this out of scope for the risk register? (this note will be recorded):', '')?.trim()
    if (!text) return
    await transition({
      newStatus: 'OUT_OF_SCOPE',
      action: 'MARK_OUT_OF_SCOPE',
      role: 'RC',
      comment: `Out of scope: ${text}`,
      extras: {
        rejection_reason: text.slice(0, 50),
        rejection_comment: text,
        rejected_by: currentUserId ?? undefined,
        rejected_at: new Date().toISOString(),
        // Waits in the RLO's attention queue until they acknowledge it.
        pending_ack: true,
      },
    })
  }

  /* RLO acknowledges the RC's out-of-scope decision — it then moves to the Archive. */
  async function handleAcknowledgeOutOfScope() {
    if (!risk) return
    await transition({
      newStatus: 'OUT_OF_SCOPE',
      action: 'ACK_OUT_OF_SCOPE',
      role: 'RLO',
      comment: 'Acknowledged out-of-scope decision',
      extras: { pending_ack: false },
    })
  }

  async function handleReviseResubmit() {
    if (!risk) return
    if (!window.confirm('Reopen this risk for amendment? It goes back to DRAFT so you can revise it and resubmit to the HOD. The reviewer\'s note stays visible to guide you.')) return
    await transition({
      newStatus: 'DRAFT',
      action: 'REVISE_REOPEN',
      role: 'RLO',
      comment: 'Reopened for amendment',
      // keep rejection_* fields so the DRAFT shows the reviewer's note
    })
  }

  async function handleClose() {
    const closingNote = window.prompt('Closing note (optional):', '')
    if (closingNote === null) return  // cancel
    await transition({
      newStatus: 'CLOSED',
      action: 'CLOSE',
      role: 'RC',
      comment: closingNote.trim() || 'Risk closed',
      extras: {
        date_closed: new Date().toISOString(),
        closed_by: currentUserId ?? undefined,
      },
    })
  }

  /* RLO/HOD records feedback against a committee directive. */
  async function respondToAction(item: RiskActionItem, text: string) {
    if (!text.trim()) return
    setTransitionError(null)
    try {
      const { error } = await supabase.from('risk_action_items')
        .update({ response: text.trim(), status: 'RESPONDED', updated_at: new Date().toISOString() })
        .eq('id', item.id)
      if (error) throw new Error(`Respond: ${error.code ?? ''} ${error.message}`)

      // Record the department's feedback in the audit trail.
      if (item.risk_id) {
        await supabase.from('risk_audit_logs').insert({
          risk_id: item.risk_id, entity_type: 'action_item', entity_id: item.id,
          action_type: 'ACTION_RESPONDED',
          performed_by: currentUserId, user_role: activeRole?.role ?? 'RLO',
          comment: `Feedback on directive: ${text.trim()}`,
        })
      }
      const { data } = await supabase.from('risk_action_items')
        .select('*').eq('risk_id', riskRowId).order('id', { ascending: false })
      setActionItems((data ?? []) as RiskActionItem[])
      // refresh the audit log too
      const { data: logsData } = await supabase.from('risk_audit_logs')
        .select('*').eq('risk_id', riskRowId).order('performed_at', { ascending: false })
      setLogs((logsData ?? []) as AuditLog[])
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : String(e))
    }
  }

  function nameOf(uid: number | null | undefined): string {
    if (!uid) return '—'
    return users.get(uid)?.name ?? `user #${uid}`
  }

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—'
    // ISO date / timestamp — slice to YYYY-MM-DD HH:MM
    return s.length > 10 ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s.slice(0, 10)
  }

  const latest = reviews[0] ?? null

  /* Role-based capability checks for the workflow buttons.
   * Driven by the user's single ACTIVE role (the one chosen in the account
   * switcher), NOT the union of every role they hold — acting as RC and acting
   * as RLO are deliberately separate hats. The clinical workflow is STRICTLY
   * role-based: ADMIN is a system-admin hat (user management) and does NOT act
   * in the risk approval workflow. The active role qualifies if it matches one
   * of the listed roles AND is either hospital-wide (dept_code null) or scoped
   * to this risk's dept. */
  function hasRole(roles: RiskRole[], deptCode?: string): boolean {
    if (!activeRole) return false
    return roles.includes(activeRole.role) &&
      (activeRole.dept_code === null || !deptCode || activeRole.dept_code === deptCode)
  }
  const riskDept = risk?.dept_code
  const canSubmit       = hasRole(['RLO'], riskDept)             // RLO of this dept
  const canEndorse      = hasRole(['HOD'], riskDept)             // HOD of this dept
  const canValidate     = hasRole(['RC'])                        // Risk Coordinator (hospital-wide)
  const canManageActive = hasRole(['RC'])                        // monitoring / reactivate / reopen
  const canRequestClose = hasRole(['RLO', 'HOD'], riskDept)      // RLO or HOD of this dept
  const canClose        = hasRole(['RC'])                        // RC closes
  const canRespond      = hasRole(['RLO', 'HOD'], riskDept)      // dept responds to committee directives

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
            <Link href="/risk" className="signout-btn">← Back to register</Link>
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
                No risk with id <code>{riskRowId}</code> exists. It may have been deleted or you typed the URL by hand.
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
                    <span>· <b>{risk.category}</b> {RISK_CATEGORY_LABEL[risk.category]}</span>
                    <span>· {RISK_SCOPE_LABEL[risk.scope]}</span>
                  </div>
                  <div className="risk-hero-chips">
                    <span className="risk-chip" style={{ color: RISK_STATUS_BADGE[risk.status].fg, background: RISK_STATUS_BADGE[risk.status].bg }}>
                      {RISK_STATUS_LABEL[risk.status]}
                    </span>
                    <span className="risk-chip" style={{ color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)' }}>
                      Cycle {latest?.cycle_number ?? '—'}
                    </span>
                    <span className="risk-chip" style={{ color: 'var(--muted)', background: '#fff', border: '1px solid var(--border)' }}>
                      {daysOpen(risk.date_opened, risk.date_closed)} days open
                    </span>
                  </div>
                </div>
                <div className="risk-hero-score">
                  {latest ? (
                    <>
                      <div className="risk-hero-score-num" style={{ color: RISK_LEVEL_COLOR[latest.risk_level] }}>
                        {(Math.round(latest.risk_score * 10) / 10).toFixed(1)}
                      </div>
                      <div className="risk-hero-score-lvl" style={{ color: RISK_LEVEL_COLOR[latest.risk_level], background: '#fff' }}>
                        {RISK_LEVEL_LABEL[latest.risk_level]}
                      </div>
                    </>
                  ) : <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Not yet scored</div>}
                </div>
              </div>

              {/* Status & Workflow Actions */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div>
                  <div className="pt">Status &amp; Workflow</div>
                  <div className="psub">Current: <b>{RISK_STATUS_LABEL[risk.status]}</b>. Pick the next action below.</div>
                </div></div>
                {transitionError && (
                  <div className="ac red" style={{ marginBottom: 10 }}>
                    <div className="ai">⚠️</div>
                    <div><div className="at">Workflow error</div><div className="as">{transitionError}</div></div>
                  </div>
                )}
                {/* Reviewer's amendment note — shown while back in DRAFT */}
                {risk.status === 'DRAFT' && risk.rejection_comment && (
                  <div className="ac amber" style={{ marginBottom: 10 }}>
                    <div className="ai">↩</div>
                    <div>
                      <div className="at">Returned for amendment — please address before resubmitting</div>
                      <div className="as">{risk.rejection_comment}</div>
                    </div>
                  </div>
                )}
                <div className="risk-workflow-actions">
                  {risk.status === 'DRAFT' && (
                    canSubmit ? (
                      <>
                        <Link href={`/risk/${risk.id}/edit`} className="signout-btn">✎ Edit</Link>
                        <WfBtn primary disabled={transitioning} onClick={() =>
                          transition({ newStatus: 'PENDING_HOD', action: 'SUBMIT_TO_HOD', role: 'RLO', comment: 'Submitted to HOD for endorsement' })}>
                          → Submit to HOD
                        </WfBtn>
                        <WfHint>Edit the details if needed, then submit to the department HOD for endorsement.</WfHint>
                      </>
                    ) : <WfHint>This risk is in draft. Only the RLO can edit and submit it to the HOD.</WfHint>
                  )}
                  {risk.status === 'PENDING_HOD' && (
                    canEndorse ? (
                      <>
                        <Link href={`/risk/${risk.id}/edit`} className="signout-btn">✎ Amend</Link>
                        <WfBtn primary disabled={transitioning} onClick={() =>
                          transition({ newStatus: 'PENDING_RC', action: 'ENDORSE', role: 'HOD', comment: 'Endorsed by HOD' })}>
                          ✓ Endorse (HOD)
                        </WfBtn>
                        <WfBtn danger disabled={transitioning} onClick={() => handleReturn('HOD')}>↩ Return for Amendment</WfBtn>
                        <WfHint>Amend the risk yourself if it needs minor tweaks, then Endorse → forwards to RC. Or Return it for the RLO to amend and resubmit.</WfHint>
                      </>
                    ) : <WfHint>Awaiting HOD endorsement. Only the department HOD can act here.</WfHint>
                  )}
                  {risk.status === 'PENDING_RC' && (
                    canValidate ? (
                      <>
                        <WfBtn primary disabled={transitioning} onClick={() =>
                          transition({ newStatus: 'TABLED_RTC', action: 'VALIDATE_TABLE_RTC', role: 'RC', comment: 'Validated by RC — tabled for Risk Technical Committee' })}>
                          ✓ Validate &amp; table for RTC
                        </WfBtn>
                        <WfBtn disabled={transitioning} onClick={() => handleReturn('RC')}>↩ Return for Amendment</WfBtn>
                        <WfBtn danger disabled={transitioning} onClick={handleOutOfScope}>✗ Out of Scope</WfBtn>
                        <WfHint>RC validates a true risk and tables it for the RTC. Return it if the RLO needs to amend something. Mark Out of Scope if it doesn&apos;t meet the criteria for the register (this archives it).</WfHint>
                      </>
                    ) : <WfHint>Awaiting Risk Coordinator validation. Only RC can act here.</WfHint>
                  )}
                  {risk.status === 'TABLED_RTC' && (
                    <WfHint>
                      Tabled for the Risk Technical Committee (RTC). Add it to an RTC meeting&apos;s agenda from the {' '}
                      <Link href="/risk/meetings" style={{ color: 'var(--blue)' }}>Meetings</Link> page — the committee&apos;s
                      recorded decision there (endorse, escalate to ROC, send back, or recommend closure) moves the risk forward.
                    </WfHint>
                  )}
                  {risk.status === 'TABLED_ROC' && (
                    <WfHint>
                      Escalated to the Risk Owner Committee (ROC). Add it to an ROC meeting&apos;s agenda from the {' '}
                      <Link href="/risk/meetings" style={{ color: 'var(--blue)' }}>Meetings</Link> page — the committee&apos;s
                      recorded decision there moves the risk forward.
                    </WfHint>
                  )}
                  {risk.status === 'ACTIVE' && (
                    (canManageActive || canRequestClose) ? (
                      <>
                        {canClose && (
                          <WfBtn primary disabled={transitioning} onClick={handleClose}>✓ Close Risk (RC)</WfBtn>
                        )}
                        {canManageActive && (
                          <WfBtn disabled={transitioning} onClick={() =>
                            transition({ newStatus: 'MONITORING', action: 'MOVE_TO_MONITORING', role: 'RC', comment: 'Moved to monitoring' })}>
                            → Move to Monitoring
                          </WfBtn>
                        )}
                        {canRequestClose && (
                          <WfBtn disabled={transitioning} onClick={() =>
                            transition({ newStatus: 'PENDING_CLOSURE', action: 'REQUEST_CLOSURE', role: 'RLO', comment: 'Closure requested' })}>
                            Request Closure
                          </WfBtn>
                        )}
                        <WfHint>Active risks are being treated. The RC can close the risk directly (e.g. after a committee decision), move it to Monitoring, or the RLO/HOD can request closure for the RC to confirm.</WfHint>
                      </>
                    ) : <WfHint>This risk is active and being treated.</WfHint>
                  )}
                  {risk.status === 'MONITORING' && (
                    (canRequestClose || canManageActive) ? (
                      <>
                        {canClose && (
                          <WfBtn primary disabled={transitioning} onClick={handleClose}>✓ Close Risk (RC)</WfBtn>
                        )}
                        {canRequestClose && (
                          <WfBtn disabled={transitioning} onClick={() =>
                            transition({ newStatus: 'PENDING_CLOSURE', action: 'REQUEST_CLOSURE', role: 'RLO', comment: 'Closure requested' })}>
                            Request Closure
                          </WfBtn>
                        )}
                        {canManageActive && (
                          <WfBtn disabled={transitioning} onClick={() =>
                            transition({ newStatus: 'ACTIVE', action: 'REACTIVATE', role: 'RC', comment: 'Reactivated from monitoring' })}>
                            ← Back to Active
                          </WfBtn>
                        )}
                        <WfHint>Risk is being monitored. The RC can close it directly, or the RLO/HOD can request closure. Send back to Active if treatment needs to resume.</WfHint>
                      </>
                    ) : <WfHint>This risk is being monitored.</WfHint>
                  )}
                  {risk.status === 'PENDING_CLOSURE' && (
                    canClose ? (
                      <>
                        <WfBtn primary disabled={transitioning} onClick={handleClose}>✓ Close Risk (RC)</WfBtn>
                        <WfBtn disabled={transitioning} onClick={() =>
                          transition({ newStatus: 'ACTIVE', action: 'REOPEN_TO_ACTIVE', role: 'RC', comment: 'Closure rejected — back to active' })}>
                          ← Reject closure
                        </WfBtn>
                        <WfHint>RC has the final say on closure. Approve close, or send back to ACTIVE.</WfHint>
                      </>
                    ) : <WfHint>Closure requested — awaiting Risk Coordinator decision.</WfHint>
                  )}
                  {(risk.status === 'RETURNED' || risk.status === 'REJECTED') && (
                    <>
                      {risk.rejection_comment && (
                        <div className="risk-def-block-value" style={{ marginBottom: 8, flexBasis: '100%' }}>
                          <b>Returned for amendment:</b><br />
                          {risk.rejection_comment}
                        </div>
                      )}
                      {canSubmit ? (
                        <>
                          <WfBtn primary disabled={transitioning} onClick={handleReviseResubmit}>
                            ↻ Revise &amp; Resubmit
                          </WfBtn>
                          <WfHint>Address the reviewer&apos;s note above, then resubmit. This reopens the same risk ({risk.risk_id}) as a draft so you can amend and send it back through.</WfHint>
                        </>
                      ) : <WfHint>This risk was returned to the RLO for amendment. The originating RLO can revise &amp; resubmit it.</WfHint>}
                    </>
                  )}
                  {risk.status === 'OUT_OF_SCOPE' && (
                    <>
                      {risk.rejection_comment && (
                        <div className="risk-def-block-value" style={{ marginBottom: 8, flexBasis: '100%' }}>
                          <b>Out of scope:</b><br />
                          {risk.rejection_comment}
                        </div>
                      )}
                      {risk.pending_ack && canSubmit && (
                        <>
                          <WfBtn primary disabled={transitioning} onClick={handleAcknowledgeOutOfScope}>✓ Acknowledge</WfBtn>
                          <WfHint>The RC has marked this risk out of scope for the register. Please acknowledge that you&apos;ve seen the decision and the reason above — it then moves to the Archive.</WfHint>
                        </>
                      )}
                      {risk.pending_ack && !canSubmit && (
                        <WfHint>Marked out of scope by the RC — awaiting the RLO&apos;s acknowledgment before it&apos;s archived.</WfHint>
                      )}
                      {!risk.pending_ack && (
                        canValidate ? (
                          <>
                            <WfBtn disabled={transitioning} onClick={() =>
                              transition({ newStatus: 'PENDING_RC', action: 'REOPEN_FROM_OUT_OF_SCOPE', role: 'RC', comment: 'Reopened for re-evaluation', extras: { pending_ack: false } })}>
                              ↻ Reopen for review
                            </WfBtn>
                            <WfHint>Acknowledged and archived. Reopen it for review if you reconsider.</WfHint>
                          </>
                        ) : <WfHint>The RC marked this out of scope for the register — acknowledged and archived. Only the RC can reopen it.</WfHint>
                      )}
                    </>
                  )}
                  {risk.status === 'CLOSED' && (
                    canManageActive ? (
                      <>
                        <WfHint>Risk is closed. Reopen if further treatment is needed.</WfHint>
                        <WfBtn disabled={transitioning} onClick={() =>
                          transition({ newStatus: 'ACTIVE', action: 'REOPEN', role: 'RC', comment: 'Risk reopened',
                            extras: { date_closed: undefined, closed_by: undefined } })}>
                          ↻ Reopen
                        </WfBtn>
                      </>
                    ) : <WfHint>This risk is closed.</WfHint>
                  )}
                </div>
              </div>

              {/* Committee Reviews — decisions from RTC/ROC meetings */}
              {committeeReviews.length > 0 && (
                <div className="panel" style={{ marginTop: 14 }}>
                  <div className="pf"><div>
                    <div className="pt">Committee Reviews</div>
                    <div className="psub">Decisions recorded for this risk at RTC / ROC meetings</div>
                  </div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {committeeReviews.map((cr) => {
                      const mt = cr.risk_meetings
                      return (
                        <div key={cr.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {mt ? (
                                <Link href={`/risk/meetings/${mt.id}`} style={{ color: 'var(--blue)' }}>
                                  {mt.meeting_type} · {mt.title}
                                </Link>
                              ) : 'Meeting'}
                              <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {mt?.meeting_date ?? fmtDate(cr.decided_at)}</span>
                            </div>
                            {cr.outcome && (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 4, color: '#166534', background: '#DCFCE7' }}>
                                {COMMITTEE_OUTCOME_LABEL[cr.outcome as CommitteeOutcome]}
                              </span>
                            )}
                          </div>
                          {cr.discussion_notes && (
                            <div style={{ fontSize: 12, marginTop: 6 }}>{cr.discussion_notes}</div>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            Recorded by {nameOf(cr.decided_by)}{cr.decided_at ? ` on ${cr.decided_at.slice(0, 10)}` : ''}
                            {cr.review_id ? ' · risk was re-scored at this meeting' : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Committee Action Items — directives & clarifications, with RLO feedback */}
              {actionItems.length > 0 && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">Committee Action Items</div>
                    <div className="psub">Directives &amp; clarifications from the committee — the department&apos;s feedback is reviewed at the next meeting</div>
                  </div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {actionItems.map((a) => {
                      const assignedLabel = (a.assigned_depts ?? []).map((c) => actionDeptNames.get(c) ?? c).join(', ') || '—'
                      // Only the assigned department's RLO/HOD responds.
                      const itemCanRespond = canRespond && !!activeRole?.dept_code && (a.assigned_depts ?? []).includes(activeRole.dept_code)
                      return (
                        <ActionItemBlock
                          key={a.id}
                          item={a}
                          assignedLabel={assignedLabel}
                          canRespond={itemCanRespond}
                          onRespond={(text) => respondToAction(a, text)}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Section 1 — Identification */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div><div className="pt">1. Risk Identification</div></div></div>
                <div className="risk-detail-grid">
                  <DefLine label="Risk ID" mono>{risk.risk_id}</DefLine>
                  <DefLine label="Department">{dept ? `${dept.name_en}` : risk.dept_code} <span style={{ color: 'var(--muted)' }}>({risk.dept_code})</span></DefLine>
                  <DefLine label="Category">
                    <b>{risk.category}</b> <span style={{ color: 'var(--muted)' }}>— {RISK_CATEGORY_LABEL[risk.category]}</span>
                  </DefLine>
                  <DefLine label="Scope">{RISK_SCOPE_LABEL[risk.scope]}</DefLine>
                  <DefLine label="Risk owner">{dept?.name_en ?? risk.dept_code}</DefLine>
                  <DefLine label="Created by">{nameOf(risk.created_by)}</DefLine>
                  <DefLine label="Date opened">{fmtDate(risk.date_opened)}</DefLine>
                  <DefLine label="Date closed">{fmtDate(risk.date_closed)}</DefLine>
                  {risk.is_isu_melintang && (
                    <DefLine label="Isu Melintang" full>
                      <span style={{ color: 'var(--amber)' }}>⚠ Tagged as cross-cutting hospital-wide issue</span>
                    </DefLine>
                  )}
                  {themes.length > 0 && (
                    <DefLine label="Themes" full>
                      {themes.map((t) => (
                        <span key={t.id} className="theme-pill" style={{ marginRight: 6 }}>{t.name}</span>
                      ))}
                    </DefLine>
                  )}
                </div>
              </div>

              {/* Section 2 — Description */}
              <div className="panel">
                <div className="pf"><div><div className="pt">2. Risk Description</div></div></div>
                <DefBlock label="Risk description">{risk.description}</DefBlock>
                <DefBlock label="Cause">{risk.cause_description}</DefBlock>
                <DefBlock label="Impact">{risk.impact_description}</DefBlock>
              </div>

              {/* Section 3 — Controls */}
              <div className="panel">
                <div className="pf"><div><div className="pt">3. Controls &amp; Treatment</div></div></div>
                <DefBlock label="Existing controls">{risk.existing_controls || <em style={{ color: 'var(--muted)' }}>not specified</em>}</DefBlock>
                <DefBlock label="Additional controls proposed">{risk.additional_controls || <em style={{ color: 'var(--muted)' }}>not specified</em>}</DefBlock>
                <div className="risk-detail-grid">
                  <DefLine label="Action owner">{risk.action_owner || <em style={{ color: 'var(--muted)' }}>—</em>}</DefLine>
                  <DefLine label="Implementation period">{risk.implementation_period || <em style={{ color: 'var(--muted)' }}>—</em>}</DefLine>
                </div>
                {risk.notes && <DefBlock label="Notes">{risk.notes}</DefBlock>}
              </div>

              {/* Section 4 — Latest Review */}
              {latest && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">4. Latest Review — Cycle {latest.cycle_number}</div>
                    <div className="psub">Reviewed by {nameOf(latest.reviewed_by)} on {fmtDate(latest.review_date)}</div>
                  </div></div>
                  <div className="risk-score-preview" style={{ marginTop: 0 }}>
                    <div className="rsp-block">
                      <div className="rsp-label">Likelihood</div>
                      <div className="rsp-value">{latest.likelihood}</div>
                    </div>
                    <div className="rsp-block">
                      <div className="rsp-label">Avg Impact</div>
                      <div className="rsp-value">{(Math.round(latest.avg_impact * 10) / 10).toFixed(1)}</div>
                    </div>
                    <div className="rsp-block">
                      <div className="rsp-label">Risk Score</div>
                      <div className="rsp-value">{(Math.round(latest.risk_score * 10) / 10).toFixed(1)}</div>
                    </div>
                    <div className="rsp-block">
                      <div className="rsp-label">Risk Level</div>
                      <div className="rsp-value">
                        <span style={{
                          display: 'inline-block', padding: '4px 14px', borderRadius: 4,
                          fontSize: 14, fontWeight: 700,
                          color: RISK_LEVEL_COLOR[latest.risk_level],
                          background: RISK_LEVEL_BG[latest.risk_level],
                        }}>{RISK_LEVEL_LABEL[latest.risk_level]}</span>
                      </div>
                    </div>
                  </div>
                  <table className="risk-table" style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>Manusia</th><th>Reputasi</th><th>Kewangan</th><th>Operasi</th><th>Objektif</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{latest.impact_manusia}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{latest.impact_reputasi}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{latest.impact_kewangan}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{latest.impact_operasi}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{latest.impact_objektif}</td>
                      </tr>
                    </tbody>
                  </table>
                  {latest.treatment_update && (
                    <DefBlock label="Treatment update">{latest.treatment_update}</DefBlock>
                  )}
                </div>
              )}

              {/* Section 5 — Review History */}
              {reviews.length > 1 && (
                <div className="panel">
                  <div className="pf"><div><div className="pt">5. Review History</div><div className="psub">{reviews.length} cycles total</div></div></div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="risk-table">
                      <thead>
                        <tr>
                          <th>Cycle</th><th>Date</th><th>Reviewer</th>
                          <th style={{ textAlign: 'center' }}>L</th>
                          <th style={{ textAlign: 'center' }}>M</th>
                          <th style={{ textAlign: 'center' }}>R</th>
                          <th style={{ textAlign: 'center' }}>K</th>
                          <th style={{ textAlign: 'center' }}>O</th>
                          <th style={{ textAlign: 'center' }}>Obj</th>
                          <th style={{ textAlign: 'right' }}>Score</th>
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
                            <td style={{ textAlign: 'center' }}>{rv.impact_manusia}</td>
                            <td style={{ textAlign: 'center' }}>{rv.impact_reputasi}</td>
                            <td style={{ textAlign: 'center' }}>{rv.impact_kewangan}</td>
                            <td style={{ textAlign: 'center' }}>{rv.impact_operasi}</td>
                            <td style={{ textAlign: 'center' }}>{rv.impact_objektif}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{(Math.round(rv.risk_score * 10) / 10).toFixed(1)}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                fontSize: 10, fontWeight: 700,
                                color: RISK_LEVEL_COLOR[rv.risk_level],
                                background: RISK_LEVEL_BG[rv.risk_level],
                              }}>{RISK_LEVEL_LABEL[rv.risk_level]}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Section 6 — Audit log */}
              <div className="panel">
                <div className="pf"><div><div className="pt">6. Audit Log</div><div className="psub">{logs.length} event{logs.length === 1 ? '' : 's'}</div></div></div>
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

              {/* Status workflow next-step hint */}
              <div style={{ marginTop: 10, fontSize: 10, color: 'var(--muted)' }}>
                Phase 3.3 — read-only detail page. Add Review Cycle (3.4) and Approval Workflow buttons (3.5) coming next.
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ---- helpers ---- */

function daysOpen(opened: string, closed: string | null): number {
  const start = new Date(opened).getTime()
  const end = closed ? new Date(closed).getTime() : Date.now()
  return Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)))
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

const ACTION_STATUS_BADGE: Record<ActionStatus, { bg: string; fg: string }> = {
  PENDING:   { bg: '#FEF3C7', fg: '#92400E' },
  RESPONDED: { bg: '#DBEAFE', fg: '#1E40AF' },
  ACCEPTED:  { bg: '#DCFCE7', fg: '#166534' },
  OVERDUE:   { bg: '#FEE2E2', fg: '#991B1B' },
  ESCALATED: { bg: '#EDE9FE', fg: '#5B21B6' },
}

function ActionItemBlock({ item, assignedLabel, canRespond, onRespond }: {
  item: RiskActionItem
  assignedLabel: string
  canRespond: boolean
  onRespond: (text: string) => void
}) {
  const [text, setText] = useState(item.response ?? '')
  const [editing, setEditing] = useState(false)
  const sb = ACTION_STATUS_BADGE[item.status]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {ACTION_TYPE_LABEL[item.action_type]}
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
            {' '}· assigned to {assignedLabel}{item.due_date ? ` · due ${item.due_date}` : ''}
          </span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, color: sb.fg, background: sb.bg }}>
          {ACTION_STATUS_LABEL[item.status]}
        </span>
      </div>
      <div style={{ fontSize: 13, marginTop: 5 }}>{item.description}</div>

      {item.response && !editing && (
        <div style={{ marginTop: 8, background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Department feedback</div>
          <div style={{ fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' }}>{item.response}</div>
        </div>
      )}

      {canRespond && (editing || !item.response) ? (
        <div style={{ marginTop: 8 }}>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Your feedback / progress on this directive…"
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            {editing && (
              <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => { setText(item.response ?? ''); setEditing(false) }}>Cancel</button>
            )}
            <button type="button" className="signout-btn"
              style={{ fontSize: 11, padding: '4px 12px', background: text.trim() ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: text.trim() ? 'var(--blue)' : '#9CA3AF' }}
              disabled={!text.trim()} onClick={() => { onRespond(text); setEditing(false) }}>
              {item.response ? 'Update feedback' : 'Submit feedback'}
            </button>
          </div>
        </div>
      ) : canRespond && item.response ? (
        <div style={{ marginTop: 6 }}>
          <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setEditing(true)}>✎ Edit feedback</button>
        </div>
      ) : null}
    </div>
  )
}

function WfBtn({ children, primary, danger, disabled, onClick }: {
  children: React.ReactNode
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  const bg = primary ? 'var(--blue)' : danger ? 'var(--red)' : '#fff'
  const fg = (primary || danger) ? '#fff' : 'var(--text)'
  const border = primary ? 'var(--blue)' : danger ? 'var(--red)' : 'var(--border)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="signout-btn"
      style={{
        background: disabled ? '#9CA3AF' : bg,
        color: fg,
        borderColor: disabled ? '#9CA3AF' : border,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}>
      {children}
    </button>
  )
}

function WfHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--muted)', flexBasis: '100%' }}>
      {children}
    </div>
  )
}
