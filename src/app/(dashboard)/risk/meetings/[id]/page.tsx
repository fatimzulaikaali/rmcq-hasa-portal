'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import type {
  RiskMeeting, RiskMeetingAgenda, RiskActionItem, Risk, RiskReview, RiskUser,
  CommitteeOutcome, MeetingStatus, ActionType,
} from '@/lib/risk/types'
import {
  computeRiskScore, outcomeToStatus, allowedOutcomes,
  COMMITTEE_OUTCOME_LABEL, MEETING_TYPE_LABEL, MEETING_STATUS_LABEL,
  ACTION_TYPE_LABEL, ACTION_STATUS_LABEL,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
} from '@/lib/risk/scoring'

const MEETING_STATUSES: MeetingStatus[] = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export default function RiskMeetingDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const meetingId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [meeting, setMeeting] = useState<RiskMeeting | null>(null)
  const [agenda, setAgenda] = useState<RiskMeetingAgenda[]>([])
  const [risksById, setRisksById] = useState<Map<number, Risk>>(new Map())
  const [latestReviewByRisk, setLatestReviewByRisk] = useState<Map<number, RiskReview>>(new Map())
  const [available, setAvailable] = useState<Risk[]>([])
  const [actions, setActions] = useState<RiskActionItem[]>([])
  const [users, setUsers] = useState<RiskUser[]>([])
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map())
  const [isRC, setIsRC] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Add-to-agenda picker
  const [pickRiskId, setPickRiskId] = useState<string>('')
  // Minutes editing
  const [minutesText, setMinutesText] = useState('')

  useEffect(() => { void load() }, [meetingId]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabledStatus = (mt: RiskMeeting['meeting_type']) => (mt === 'RTC' ? 'TABLED_RTC' : 'TABLED_ROC')

  async function load() {
    if (!Number.isFinite(meetingId)) { setNotFound(true); setLoading(false); return }
    setLoading(true); setLoadError(null); setAccessDenied(false); setNotFound(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.allModules) { setAccessDenied(true); return }
      setIsRC(access.activeRole?.role === 'RC')
      setCurrentUserId(access.riskUser?.riskUserId ?? null)

      const { data: mData, error: mErr } = await supabase
        .from('risk_meetings').select('*').eq('id', meetingId).maybeSingle()
      if (mErr) throw new Error(`Meeting: ${mErr.code ?? ''} ${mErr.message}`)
      if (!mData) { setNotFound(true); return }
      const m = mData as RiskMeeting
      setMeeting(m)
      setMinutesText(m.minutes ?? '')

      const [
        { data: agendaData, error: agErr },
        { data: actionsData, error: acErr },
        { data: usersData, error: uErr },
      ] = await Promise.all([
        supabase.from('risk_meeting_agenda').select('*').eq('meeting_id', meetingId).order('seq'),
        supabase.from('risk_action_items').select('*').eq('meeting_id', meetingId).order('id'),
        supabase.from('risk_users').select('id,auth_user_id,name,email,is_active,created_at,last_login'),
      ])
      if (agErr) throw new Error(`Agenda: ${agErr.code ?? ''} ${agErr.message}`)
      if (acErr) throw new Error(`Actions: ${acErr.code ?? ''} ${acErr.message}`)
      if (uErr)  throw new Error(`Users: ${uErr.code ?? ''} ${uErr.message}`)

      const ag = (agendaData ?? []) as RiskMeetingAgenda[]
      setAgenda(ag)
      setActions((actionsData ?? []) as RiskActionItem[])
      setUsers((usersData ?? []) as RiskUser[])

      // Risks on the agenda + risks available to be tabled (matching tabled status, not yet on agenda)
      const agendaRiskIds = ag.map((a) => a.risk_id)
      const tStatus = tabledStatus(m.meeting_type)
      const [{ data: agendaRisks, error: arErr }, { data: tabledRisks, error: trErr }] = await Promise.all([
        agendaRiskIds.length
          ? supabase.from('risks').select('*').in('id', agendaRiskIds)
          : Promise.resolve({ data: [], error: null } as { data: Risk[]; error: null }),
        supabase.from('risks').select('*').eq('status', tStatus),
      ])
      if (arErr) throw new Error(`Agenda risks: ${arErr.code ?? ''} ${arErr.message}`)
      if (trErr) throw new Error(`Tabled risks: ${trErr.code ?? ''} ${trErr.message}`)

      const rMap = new Map<number, Risk>()
      for (const r of (agendaRisks ?? []) as Risk[]) rMap.set(r.id, r)
      setRisksById(rMap)
      const onAgenda = new Set(agendaRiskIds)
      setAvailable(((tabledRisks ?? []) as Risk[]).filter((r) => !onAgenda.has(r.id)))

      // Latest review per risk (for scoring display + re-score prefill)
      const allRiskIds = Array.from(new Set([...agendaRiskIds, ...((tabledRisks ?? []) as Risk[]).map((r) => r.id)]))
      if (allRiskIds.length) {
        const { data: reviews } = await supabase.from('risk_reviews')
          .select('*').in('risk_id', allRiskIds).order('cycle_number', { ascending: false })
        const lr = new Map<number, RiskReview>()
        for (const rv of (reviews ?? []) as RiskReview[]) if (!lr.has(rv.risk_id)) lr.set(rv.risk_id, rv)
        setLatestReviewByRisk(lr)
      }

      // Dept names for the risks involved
      const deptCodes = Array.from(new Set([
        ...Array.from(rMap.values()).map((r) => r.dept_code),
        ...((tabledRisks ?? []) as Risk[]).map((r) => r.dept_code),
      ]))
      if (deptCodes.length) {
        const { data: depts } = await supabase.from('pscs_departments').select('code,name_en').in('code', deptCodes)
        const dm = new Map<string, string>()
        for (const d of (depts ?? []) as { code: string; name_en: string }[]) dm.set(d.code, d.name_en)
        setDeptNames(dm)
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  function nameOf(uid: number | null | undefined): string {
    if (!uid) return '—'
    return users.find((u) => u.id === uid)?.name ?? `user #${uid}`
  }
  function deptLabel(code: string): string { return deptNames.get(code) ?? code }

  async function setMeetingStatus(status: MeetingStatus) {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meetings')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', meeting.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function saveMinutes() {
    if (!meeting) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meetings')
        .update({ minutes: minutesText.trim() || null, updated_at: new Date().toISOString() }).eq('id', meeting.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function addToAgenda() {
    if (!meeting || !pickRiskId) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meeting_agenda').insert({
        meeting_id: meeting.id,
        risk_id: parseInt(pickRiskId, 10),
        seq: agenda.length + 1,
      })
      if (error) throw new Error(`Add to agenda: ${error.code ?? ''} ${error.message}`)
      setPickRiskId('')
      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function removeAgendaItem(item: RiskMeetingAgenda) {
    if (item.outcome) { alert('This item already has a recorded decision and cannot be removed.'); return }
    if (!window.confirm('Remove this risk from the agenda?')) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_meeting_agenda').delete().eq('id', item.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  /* Record a committee decision on one agenda item — the heart of the flow. */
  async function recordDecision(
    item: RiskMeetingAgenda,
    risk: Risk,
    opts: { outcome: CommitteeOutcome; notes: string; rescore: ScoreInputs | null },
  ) {
    if (!meeting || !currentUserId) return
    setBusy(true); setActionError(null)
    try {
      let reviewId: number | null = item.review_id
      // 1) Optional re-score → new review cycle
      if (opts.rescore) {
        const computed = computeRiskScore(opts.rescore.likelihood, [
          opts.rescore.impact_manusia, opts.rescore.impact_reputasi, opts.rescore.impact_kewangan,
          opts.rescore.impact_operasi, opts.rescore.impact_objektif])
        const latest = latestReviewByRisk.get(risk.id)
        const nextCycle = (latest?.cycle_number ?? 0) + 1
        const { data: rv, error: rvErr } = await supabase.from('risk_reviews').insert({
          risk_id: risk.id,
          cycle_number: nextCycle,
          reviewed_by: currentUserId,
          review_date: new Date().toISOString().slice(0, 10),
          likelihood: opts.rescore.likelihood,
          impact_manusia: opts.rescore.impact_manusia,
          impact_reputasi: opts.rescore.impact_reputasi,
          impact_kewangan: opts.rescore.impact_kewangan,
          impact_operasi: opts.rescore.impact_operasi,
          impact_objektif: opts.rescore.impact_objektif,
          avg_impact: computed.avgImpact,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
        }).select('id').single()
        if (rvErr) throw new Error(`Re-score: ${rvErr.code ?? ''} ${rvErr.message}`)
        reviewId = rv.id as number
      }

      // 2) Update the agenda item with the decision
      const { error: agErr } = await supabase.from('risk_meeting_agenda').update({
        outcome: opts.outcome,
        discussion_notes: opts.notes.trim() || null,
        review_id: reviewId,
        decided_by: currentUserId,
        decided_at: new Date().toISOString(),
      }).eq('id', item.id)
      if (agErr) throw new Error(`Decision: ${agErr.code ?? ''} ${agErr.message}`)

      // 3) Move the risk to its next status
      const newStatus = outcomeToStatus(opts.outcome)
      const riskPatch: Partial<Risk> = { status: newStatus }
      if (opts.outcome === 'SEND_BACK_DEPT') {
        const note = opts.notes.trim() || `Sent back by ${meeting.meeting_type} for rework`
        riskPatch.rejection_reason = note.slice(0, 50)
        riskPatch.rejection_comment = note
        riskPatch.rejected_by = currentUserId
        riskPatch.rejected_at = new Date().toISOString()
      }
      const { error: rErr } = await supabase.from('risks').update(riskPatch).eq('id', risk.id)
      if (rErr) throw new Error(`Risk status: ${rErr.code ?? ''} ${rErr.message}`)

      // 4) Audit log on the risk
      await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk',
        entity_id: risk.id,
        action_type: `${meeting.meeting_type}_${opts.outcome}`,
        performed_by: currentUserId,
        user_role: 'RC',
        old_value: { status: risk.status },
        new_value: { status: newStatus, ...(reviewId !== item.review_id ? { rescored: true } : {}) },
        comment: `${MEETING_TYPE_LABEL[meeting.meeting_type]} — ${COMMITTEE_OUTCOME_LABEL[opts.outcome]}${opts.notes.trim() ? `: ${opts.notes.trim()}` : ''}`,
      })

      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function addActionItem(a: { action_type: ActionType; description: string; assigned_to: number | null; due_date: string | null }) {
    if (!meeting || !a.description.trim()) return
    setBusy(true); setActionError(null)
    try {
      const { error } = await supabase.from('risk_action_items').insert({
        meeting_id: meeting.id,
        action_type: a.action_type,
        description: a.description.trim(),
        assigned_to: a.assigned_to,
        due_date: a.due_date || null,
        status: 'PENDING',
        created_by: currentUserId,
      })
      if (error) throw new Error(`Action item: ${error.code ?? ''} ${error.message}`)
      await load()
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">⚠️ Risk Register</div>
          <div className="sb-sub">Risk Management &amp; Clinical Quality (RMCQ)</div>
        </div>
        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/ir" className="nav-item"><span className="nav-icon">🩺</span><span>IR Dashboard</span></Link>
          <Link href="/kpi" className="nav-item"><span className="nav-icon">📈</span><span>KPI Monitor</span></Link>
          <Link href="/pscs" className="nav-item"><span className="nav-icon">🛡️</span><span>Safety Culture</span></Link>
          <Link href="/risk" className="nav-item"><span className="nav-icon">⚠️</span><span>Risk Register</span></Link>
          <Link href="/risk/meetings" className="nav-item active"><span className="nav-icon">📋</span><span>Committees</span></Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">{meeting ? `${meeting.meeting_type} · ${meeting.title}` : (notFound ? 'Not found' : '…')}</div>
              <div className="tb-meta">{meeting ? `${MEETING_TYPE_LABEL[meeting.meeting_type]} · ${meeting.meeting_date}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk/meetings" className="signout-btn">← All meetings</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>
          )}
          {actionError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Action error</div><div className="as">{actionError}</div></div></div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Committee area is hospital-wide</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}
          {notFound && !loading && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Meeting not found</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk/meetings" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← All meetings</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && !notFound && meeting && (
            <>
              {/* Meeting header */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">{meeting.title}</div>
                  <div className="psub">
                    {MEETING_TYPE_LABEL[meeting.meeting_type]} · {meeting.meeting_date}
                    {meeting.location ? ` · ${meeting.location}` : ''} · chaired by {nameOf(meeting.chaired_by)}
                  </div>
                </div></div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Status:</span>
                  {MEETING_STATUSES.map((s) => (
                    <button key={s} type="button" className="signout-btn"
                      disabled={!isRC || busy || meeting.status === s}
                      onClick={() => setMeetingStatus(s)}
                      style={{
                        fontSize: 11, padding: '4px 10px',
                        background: meeting.status === s ? 'var(--blue)' : '#fff',
                        color: meeting.status === s ? '#fff' : 'var(--text)',
                        borderColor: meeting.status === s ? 'var(--blue)' : 'var(--border)',
                        cursor: (!isRC || meeting.status === s) ? 'default' : 'pointer',
                        opacity: (!isRC && meeting.status !== s) ? 0.6 : 1,
                      }}>
                      {MEETING_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agenda */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Agenda — risks for discussion</div>
                  <div className="psub">
                    {agenda.length} item{agenda.length === 1 ? '' : 's'} · the committee records one decision per risk
                  </div>
                </div></div>

                {isRC && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <select value={pickRiskId} onChange={(e) => setPickRiskId(e.target.value)}
                      style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, minWidth: 280 }}>
                      <option value="">
                        {available.length ? `— add a risk tabled for ${meeting.meeting_type} —` : `No risks tabled for ${meeting.meeting_type}`}
                      </option>
                      {available.map((r) => (
                        <option key={r.id} value={r.id}>{r.risk_id} · {deptLabel(r.dept_code)}</option>
                      ))}
                    </select>
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 12, padding: '6px 12px', background: pickRiskId ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: pickRiskId ? 'var(--blue)' : '#9CA3AF' }}
                      disabled={!pickRiskId || busy} onClick={addToAgenda}>
                      + Add to agenda
                    </button>
                  </div>
                )}

                {agenda.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>No risks on the agenda yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {agenda.map((item) => {
                      const risk = risksById.get(item.risk_id)
                      if (!risk) return null
                      return (
                        <AgendaItemCard
                          key={item.id}
                          item={item}
                          risk={risk}
                          latest={latestReviewByRisk.get(item.risk_id) ?? null}
                          deptLabel={deptLabel(risk.dept_code)}
                          meetingType={meeting.meeting_type}
                          isRC={isRC}
                          busy={busy}
                          decidedByName={nameOf(item.decided_by)}
                          onDecide={(opts) => recordDecision(item, risk, opts)}
                          onRemove={() => removeAgendaItem(item)}
                        />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Action items */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Action Items</div>
                  <div className="psub">Clarifications and directives raised in this meeting</div>
                </div></div>
                {actions.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', marginBottom: isRC ? 12 : 0 }}>
                    No action items yet.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', marginBottom: isRC ? 12 : 0 }}>
                    <table className="risk-table">
                      <thead>
                        <tr>
                          <th>Type</th><th>Description</th><th>Assigned to</th><th>Due</th>
                          <th style={{ textAlign: 'center' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actions.map((a) => (
                          <tr key={a.id}>
                            <td>{ACTION_TYPE_LABEL[a.action_type]}</td>
                            <td>{a.description}</td>
                            <td>{nameOf(a.assigned_to)}</td>
                            <td>{a.due_date ?? '—'}</td>
                            <td style={{ textAlign: 'center' }}>{ACTION_STATUS_LABEL[a.status]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isRC && <AddActionForm users={users} busy={busy} onAdd={addActionItem} />}
              </div>

              {/* Minutes */}
              <div className="panel">
                <div className="pf"><div><div className="pt">Minutes</div></div></div>
                {isRC ? (
                  <>
                    <textarea rows={5} value={minutesText} onChange={(e) => setMinutesText(e.target.value)}
                      placeholder="Meeting minutes / summary…"
                      style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button type="button" className="signout-btn"
                        style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)', fontSize: 12 }}
                        disabled={busy} onClick={saveMinutes}>Save minutes</button>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
                    {meeting.minutes || <em style={{ color: 'var(--muted)' }}>No minutes recorded.</em>}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ---------- Agenda item card ---------- */

interface ScoreInputs {
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
}

function AgendaItemCard({
  item, risk, latest, deptLabel, meetingType, isRC, busy, decidedByName, onDecide, onRemove,
}: {
  item: RiskMeetingAgenda
  risk: Risk
  latest: RiskReview | null
  deptLabel: string
  meetingType: RiskMeeting['meeting_type']
  isRC: boolean
  busy: boolean
  decidedByName: string
  onDecide: (opts: { outcome: CommitteeOutcome; notes: string; rescore: ScoreInputs | null }) => void
  onRemove: () => void
}) {
  const [outcome, setOutcome] = useState<CommitteeOutcome | ''>('')
  const [notes, setNotes] = useState('')
  const [rescoreOpen, setRescoreOpen] = useState(false)
  const [scores, setScores] = useState<ScoreInputs>({
    likelihood: latest?.likelihood ?? 0,
    impact_manusia: latest?.impact_manusia ?? 0,
    impact_reputasi: latest?.impact_reputasi ?? 0,
    impact_kewangan: latest?.impact_kewangan ?? 0,
    impact_operasi: latest?.impact_operasi ?? 0,
    impact_objektif: latest?.impact_objektif ?? 0,
  })

  const decided = !!item.outcome
  const opts = allowedOutcomes(meetingType)

  const scoreComplete = scores.likelihood > 0 && scores.impact_manusia > 0 && scores.impact_reputasi > 0 &&
    scores.impact_kewangan > 0 && scores.impact_operasi > 0 && scores.impact_objektif > 0
  const computed = (rescoreOpen && scoreComplete)
    ? computeRiskScore(scores.likelihood, [scores.impact_manusia, scores.impact_reputasi, scores.impact_kewangan, scores.impact_operasi, scores.impact_objektif])
    : null

  const canSave = !!outcome && !busy && (!rescoreOpen || scoreComplete)

  return (
    <div className="panel" style={{ margin: 0, border: '1px solid var(--border)', boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Link href={`/risk/${risk.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blue)' }}>
            {risk.risk_id}
          </Link>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {deptLabel}</span>
          <div style={{ fontSize: 13, marginTop: 4 }}>{risk.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {latest && (
            <span style={{
              display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
              color: RISK_LEVEL_COLOR[latest.risk_level], background: RISK_LEVEL_BG[latest.risk_level],
            }}>{RISK_LEVEL_LABEL[latest.risk_level]} · {(Math.round(latest.risk_score * 10) / 10).toFixed(1)}</span>
          )}
          <span style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            color: RISK_STATUS_BADGE[risk.status].fg, background: RISK_STATUS_BADGE[risk.status].bg,
          }}>{RISK_STATUS_LABEL[risk.status]}</span>
        </div>
      </div>

      {decided ? (
        <div className="ac" style={{ marginTop: 10, background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <div className="ai">✓</div>
          <div>
            <div className="at">Decision: {COMMITTEE_OUTCOME_LABEL[item.outcome as CommitteeOutcome]}</div>
            <div className="as">
              Recorded by {decidedByName}{item.decided_at ? ` on ${item.decided_at.slice(0, 10)}` : ''}
              {item.review_id ? ' · re-scored' : ''}
              {item.discussion_notes ? ` — ${item.discussion_notes}` : ''}
            </div>
          </div>
        </div>
      ) : !isRC ? (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>
          Awaiting the committee&apos;s decision (recorded by the RC).
        </div>
      ) : (
        <div style={{ marginTop: 12, borderTop: '1px dashed var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as CommitteeOutcome)}
              style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="">— decision —</option>
              {opts.map((o) => <option key={o} value={o}>{COMMITTEE_OUTCOME_LABEL[o]}</option>)}
            </select>
            <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '6px 10px' }}
              onClick={() => setRescoreOpen((v) => !v)}>
              {rescoreOpen ? 'Cancel re-score' : '✎ Re-score'}
            </button>
            {outcome && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                → moves risk to <b>{RISK_STATUS_LABEL[outcomeToStatus(outcome)]}</b>
              </span>
            )}
          </div>

          {rescoreOpen && (
            <div style={{ marginTop: 10 }}>
              <div className="risk-form-grid">
                <ScorePicker label="Likelihood" value={scores.likelihood} onChange={(v) => setScores({ ...scores, likelihood: v })} />
                <ScorePicker label="Manusia" value={scores.impact_manusia} onChange={(v) => setScores({ ...scores, impact_manusia: v })} />
                <ScorePicker label="Reputasi" value={scores.impact_reputasi} onChange={(v) => setScores({ ...scores, impact_reputasi: v })} />
                <ScorePicker label="Kewangan" value={scores.impact_kewangan} onChange={(v) => setScores({ ...scores, impact_kewangan: v })} />
                <ScorePicker label="Operasi" value={scores.impact_operasi} onChange={(v) => setScores({ ...scores, impact_operasi: v })} />
                <ScorePicker label="Objektif" value={scores.impact_objektif} onChange={(v) => setScores({ ...scores, impact_objektif: v })} />
              </div>
              {computed && (
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  New score: <b>{(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</b> ·{' '}
                  <span style={{ color: RISK_LEVEL_COLOR[computed.riskLevel], fontWeight: 700 }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                </div>
              )}
            </div>
          )}

          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Discussion notes (shown to the department if sent back)…"
            style={{ width: '100%', marginTop: 10, padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button type="button" className="role-pill" onClick={onRemove} disabled={busy}>Remove from agenda</button>
            <button type="button" className="signout-btn"
              style={{ fontSize: 12, padding: '6px 14px', background: canSave ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: canSave ? 'var(--blue)' : '#9CA3AF', cursor: canSave ? 'pointer' : 'not-allowed' }}
              disabled={!canSave}
              onClick={() => onDecide({ outcome: outcome as CommitteeOutcome, notes, rescore: rescoreOpen ? scores : null })}>
              Record decision
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScorePicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="risk-field">
      <label style={{ fontSize: 11 }}>{label}</label>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}

/* ---------- Add action item form ---------- */

function AddActionForm({ users, busy, onAdd }: {
  users: RiskUser[]
  busy: boolean
  onAdd: (a: { action_type: ActionType; description: string; assigned_to: number | null; due_date: string | null }) => void
}) {
  const [type, setType] = useState<ActionType>('DIRECTIVE')
  const [desc, setDesc] = useState('')
  const [assignee, setAssignee] = useState<string>('')
  const [due, setDue] = useState('')

  const submit = () => {
    if (!desc.trim()) return
    onAdd({ action_type: type, description: desc, assigned_to: assignee ? parseInt(assignee, 10) : null, due_date: due || null })
    setDesc(''); setAssignee(''); setDue(''); setType('DIRECTIVE')
  }

  return (
    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>+ Add action item</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={type} onChange={(e) => setType(e.target.value as ActionType)}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <option value="DIRECTIVE">{ACTION_TYPE_LABEL.DIRECTIVE}</option>
          <option value="CLARIFICATION">{ACTION_TYPE_LABEL.CLARIFICATION}</option>
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
          <option value="">— assign to —</option>
          {users.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
          style={{ fontSize: 12, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
      </div>
      <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What needs to be done…"
        style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="signout-btn"
          style={{ fontSize: 12, padding: '6px 14px', background: desc.trim() ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: desc.trim() ? 'var(--blue)' : '#9CA3AF' }}
          disabled={!desc.trim() || busy} onClick={submit}>Add action</button>
      </div>
    </div>
  )
}
