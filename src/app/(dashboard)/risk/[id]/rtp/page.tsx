'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess, resolveCurrentRiskUser } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import {
  Risk, RiskDept, RiskUser, RiskRtp, RiskRtpTask, RiskRtpUpdate,
  RtpAdequacy, RtpOverallStatus, RtpTaskStatus,
} from '@/lib/risk/types'
import { TREATMENT_OPTION_LABEL } from '@/lib/risk/scoring'

const OVERALL_STATUS: RtpOverallStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED']
const OVERALL_LABEL: Record<RtpOverallStatus, string> = {
  NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', VERIFIED: 'Verified',
}
const TASK_STATUS: RtpTaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']
const TASK_LABEL: Record<RtpTaskStatus, string> = {
  NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETED: 'Completed',
}
const ADEQUACY: RtpAdequacy[] = ['H', 'M', 'L']
const ADEQUACY_LABEL: Record<RtpAdequacy, string> = { H: 'H — High', M: 'M — Medium', L: 'L — Low' }

/* Local editable task row — `id` present means it exists in the DB already. */
interface TaskEdit {
  id: string | null
  seq: number
  task: string
  pic: string
  due_date: string
  status: RtpTaskStatus
  updated_at: string | null
}

function blankTask(seq: number): TaskEdit {
  return { id: null, seq, task: '', pic: '', due_date: '', status: 'NOT_STARTED', updated_at: null }
}

export default function RtpEditorPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const riskRowId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [risk, setRisk] = useState<Risk | null>(null)
  const [dept, setDept] = useState<RiskDept | null>(null)
  const [rtp, setRtp] = useState<RiskRtp | null>(null)
  const [updates, setUpdates] = useState<RiskRtpUpdate[]>([])
  const [users, setUsers] = useState<Map<number, RiskUser>>(new Map())
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [canEdit, setCanEdit] = useState(false)

  // Editable fields (control / ownership / approval).
  const [newControl, setNewControl] = useState('')
  const [adequacy, setAdequacy] = useState<RtpAdequacy | ''>('')
  const [lastReviewed, setLastReviewed] = useState('')
  const [participatingDepts, setParticipatingDepts] = useState('')
  const [riskOwner, setRiskOwner] = useState('')
  const [monitoredBy, setMonitoredBy] = useState('')
  const [preparedName, setPreparedName] = useState(''); const [preparedDate, setPreparedDate] = useState('')
  const [hodName, setHodName] = useState(''); const [hodDate, setHodDate] = useState('')
  const [rtcName, setRtcName] = useState(''); const [rtcDate, setRtcDate] = useState('')
  const [rocName, setRocName] = useState(''); const [rocDate, setRocDate] = useState('')

  // Tasks + which existing task ids were loaded (to detect deletions on save).
  const [tasks, setTasks] = useState<TaskEdit[]>([])
  const [originalTaskIds, setOriginalTaskIds] = useState<string[]>([])

  // Coordinator update panel.
  const [panelStatus, setPanelStatus] = useState<RtpOverallStatus>('NOT_STARTED')
  const [panelNote, setPanelNote] = useState('')
  const [savingPanel, setSavingPanel] = useState(false)

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
        setNotFound(true); return
      }
      const role = access.activeRole?.role
      setCanEdit(role === 'RC' || role === 'ADMIN' || role === 'DIRECTOR')
      setRisk(riskData as Risk)

      const ruRes = await resolveCurrentRiskUser(supabase)
      if (ruRes.ok) setCurrentUserId(ruRes.user.riskUserId)

      const [
        { data: deptData },
        { data: rtpData, error: rtpErr },
        { data: usersData },
      ] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', (riskData as Risk).dept_code).maybeSingle(),
        supabase.from('risk_rtp').select('*').eq('risk_id', riskRowId).maybeSingle(),
        supabase.from('risk_users').select('id,auth_user_id,name,email,is_active,created_at,last_login'),
      ])
      if (rtpErr) throw new Error(`RTP: ${rtpErr.code ?? ''} ${rtpErr.message}`)

      setDept(deptData as RiskDept | null)
      const m = new Map<number, RiskUser>()
      for (const u of (usersData ?? []) as RiskUser[]) m.set(u.id, u)
      setUsers(m)

      const rtpRow = (rtpData ?? null) as RiskRtp | null
      setRtp(rtpRow)
      if (rtpRow) {
        setNewControl(rtpRow.new_control ?? '')
        setAdequacy(rtpRow.adequacy ?? '')
        setLastReviewed(rtpRow.last_reviewed ?? '')
        setParticipatingDepts(rtpRow.participating_depts ?? '')
        setRiskOwner(rtpRow.risk_owner ?? '')
        setMonitoredBy(rtpRow.monitored_by ?? '')
        setPreparedName(rtpRow.prepared_by_name ?? ''); setPreparedDate(rtpRow.prepared_by_date ?? '')
        setHodName(rtpRow.approved_hod_name ?? ''); setHodDate(rtpRow.approved_hod_date ?? '')
        setRtcName(rtpRow.reviewed_rtc_name ?? ''); setRtcDate(rtpRow.reviewed_rtc_date ?? '')
        setRocName(rtpRow.approved_roc_name ?? ''); setRocDate(rtpRow.approved_roc_date ?? '')
        setPanelStatus(rtpRow.overall_status)

        const [{ data: taskData }, { data: updData }] = await Promise.all([
          supabase.from('risk_rtp_tasks').select('*').eq('rtp_id', rtpRow.id).order('seq', { ascending: true }),
          supabase.from('risk_rtp_updates').select('*').eq('rtp_id', rtpRow.id).order('created_at', { ascending: false }),
        ])
        const trows = (taskData ?? []) as RiskRtpTask[]
        setTasks(trows.map((t) => ({
          id: t.id, seq: t.seq, task: t.task, pic: t.pic ?? '',
          due_date: t.due_date ?? '', status: t.status, updated_at: t.updated_at,
        })))
        setOriginalTaskIds(trows.map((t) => t.id))
        setUpdates((updData ?? []) as RiskRtpUpdate[])
      } else {
        // New RTP — seed one blank task row.
        setTasks([blankTask(1)])
        setOriginalTaskIds([])
        setUpdates([])
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

  /* Ensure an RTP row exists, returning its id. Creates one if needed. */
  async function ensureRtp(): Promise<string> {
    if (rtp) return rtp.id
    if (!risk) throw new Error('No risk loaded')
    const { data, error } = await supabase.from('risk_rtp').insert({
      risk_id: risk.id, created_by: currentUserId, overall_status: 'NOT_STARTED',
    }).select('*').single()
    if (error) throw new Error(`Create RTP: ${error.code ?? ''} ${error.message}`)
    const row = data as RiskRtp
    setRtp(row)
    return row.id
  }

  async function logUpdate(rtpId: string, note: string, status: string | null) {
    await supabase.from('risk_rtp_updates').insert({
      rtp_id: rtpId, note: note || null, status, created_by: currentUserId,
    })
  }

  async function refreshUpdates(rtpId: string) {
    const { data } = await supabase.from('risk_rtp_updates')
      .select('*').eq('rtp_id', rtpId).order('created_at', { ascending: false })
    setUpdates((data ?? []) as RiskRtpUpdate[])
  }

  /* Save the whole RTP (control / ownership / approval fields). */
  async function saveRtp() {
    if (!risk || !canEdit) return
    setSaving(true); setSaveError(null)
    try {
      const rtpId = await ensureRtp()
      const { error } = await supabase.from('risk_rtp').update({
        new_control: newControl.trim() || null,
        adequacy: adequacy || null,
        last_reviewed: lastReviewed || null,
        participating_depts: participatingDepts.trim() || null,
        risk_owner: riskOwner.trim() || null,
        monitored_by: monitoredBy.trim() || null,
        prepared_by_name: preparedName.trim() || null, prepared_by_date: preparedDate || null,
        approved_hod_name: hodName.trim() || null, approved_hod_date: hodDate || null,
        reviewed_rtc_name: rtcName.trim() || null, reviewed_rtc_date: rtcDate || null,
        approved_roc_name: rocName.trim() || null, approved_roc_date: rocDate || null,
        updated_at: new Date().toISOString(),
      }).eq('id', rtpId)
      if (error) throw new Error(`Save RTP: ${error.code ?? ''} ${error.message}`)
      router.push(`/risk/${risk.id}`)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  /* Save the task list — insert new, update changed, delete removed, log a summary. */
  async function saveTasks() {
    if (!risk || !canEdit) return
    setSaving(true); setSaveError(null)
    try {
      const rtpId = await ensureRtp()
      const now = new Date().toISOString()
      const keptIds = new Set(tasks.filter((t) => t.id).map((t) => t.id as string))
      const toDelete = originalTaskIds.filter((id) => !keptIds.has(id))

      // Deletions
      if (toDelete.length) {
        const { error } = await supabase.from('risk_rtp_tasks').delete().in('id', toDelete)
        if (error) throw new Error(`Delete tasks: ${error.code ?? ''} ${error.message}`)
      }
      // Upserts (skip fully-empty rows)
      let seq = 1
      for (const t of tasks) {
        if (!t.task.trim() && !t.pic.trim()) continue
        const payload = {
          rtp_id: rtpId, seq: seq++, task: t.task.trim(), pic: t.pic.trim() || null,
          due_date: t.due_date || null, status: t.status,
          updated_by: currentUserId, updated_at: now,
        }
        if (t.id) {
          const { error } = await supabase.from('risk_rtp_tasks').update(payload).eq('id', t.id)
          if (error) throw new Error(`Update task: ${error.code ?? ''} ${error.message}`)
        } else {
          const { error } = await supabase.from('risk_rtp_tasks').insert(payload)
          if (error) throw new Error(`Insert task: ${error.code ?? ''} ${error.message}`)
        }
      }
      await logUpdate(rtpId, 'Task list updated', null)
      await refreshUpdates(rtpId)
      await reloadTasks(rtpId)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function reloadTasks(rtpId: string) {
    const { data } = await supabase.from('risk_rtp_tasks')
      .select('*').eq('rtp_id', rtpId).order('seq', { ascending: true })
    const trows = (data ?? []) as RiskRtpTask[]
    setTasks(trows.length ? trows.map((t) => ({
      id: t.id, seq: t.seq, task: t.task, pic: t.pic ?? '',
      due_date: t.due_date ?? '', status: t.status, updated_at: t.updated_at,
    })) : [blankTask(1)])
    setOriginalTaskIds(trows.map((t) => t.id))
  }

  /* Coordinator update panel — sets overall status + logs a note. */
  async function savePanel() {
    if (!risk || !canEdit) return
    setSavingPanel(true); setSaveError(null)
    try {
      const rtpId = await ensureRtp()
      const { data, error } = await supabase.from('risk_rtp').update({
        overall_status: panelStatus,
        last_reviewed: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      }).eq('id', rtpId).select('*').single()
      if (error) throw new Error(`Save update: ${error.code ?? ''} ${error.message}`)
      setRtp(data as RiskRtp)
      setLastReviewed((data as RiskRtp).last_reviewed ?? '')
      await logUpdate(rtpId, panelNote.trim() || `Status → ${OVERALL_LABEL[panelStatus]}`, panelStatus)
      setPanelNote('')
      await refreshUpdates(rtpId)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingPanel(false)
    }
  }

  function updateTask(i: number, patch: Partial<TaskEdit>) {
    setTasks((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  function addTask() {
    setTasks((ts) => [...ts, blankTask(ts.length + 1)])
  }
  function removeTask(i: number) {
    setTasks((ts) => ts.filter((_, idx) => idx !== i))
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
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur',
    }).format(d).replace(',', '')
  }

  const tasksDone = tasks.filter((t) => t.status === 'COMPLETED' && t.task.trim()).length
  const tasksTotal = tasks.filter((t) => t.task.trim()).length

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="rtp" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Risk Treatment Plan</div>
              <div className="tb-meta">
                {risk ? `${risk.risk_id} · ${dept?.name_en ?? risk.dept_code}` : 'Form 0045'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            {risk && <Link href={`/risk/${risk.id}`} className="signout-btn">← Risk</Link>}
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
          {!loading && notFound && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Risk not found</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !notFound && risk && (
            <>
              {saveError && (
                <div className="ac red"><div className="ai">⚠️</div>
                  <div><div className="at">Save error</div><div className="as">{saveError}</div></div>
                </div>
              )}
              {risk.treatment_option === 'ACCEPT' && (
                <div className="ac amber"><div className="ai">ℹ️</div>
                  <div><div className="at">Treatment is Accept</div>
                    <div className="as">This risk was accepted — an RTP isn&apos;t normally required. You can still record one if the decision changes.</div></div>
                </div>
              )}

              {/* Coordinator update panel */}
              <div className="panel" style={{ borderLeft: '4px solid #0EA5A5' }}>
                <div className="pf"><div>
                  <div className="pt">🎯 Coordinator update</div>
                  <div className="psub">Keep the RTP current — each update is logged with your name + date.</div>
                </div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Overall RTP status</label>
                    <select value={panelStatus} disabled={!canEdit}
                      onChange={(e) => setPanelStatus(e.target.value as RtpOverallStatus)}>
                      {OVERALL_STATUS.map((s) => <option key={s} value={s}>{OVERALL_LABEL[s]}</option>)}
                    </select>
                  </div>
                  <div className="risk-field">
                    <label>Tasks done</label>
                    <input type="text" value={`${tasksDone} / ${tasksTotal}`} disabled />
                    <div className="risk-field-hint">Auto from the task list below</div>
                  </div>
                  <div className="risk-field">
                    <label>Last reviewed</label>
                    <input type="text" value={fmtDate(rtp?.last_reviewed)} disabled />
                  </div>
                  <div className="risk-field full">
                    <label>Update note (what changed this review)</label>
                    <textarea value={panelNote} disabled={!canEdit}
                      onChange={(e) => setPanelNote(e.target.value)}
                      placeholder="e.g. 'Flow-coordinator recruited, SOP training scheduled for Aug'" />
                  </div>
                </div>
                {canEdit && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" className="signout-btn"
                      style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                      disabled={savingPanel} onClick={savePanel}>
                      {savingPanel ? 'Saving…' : 'Save update'}
                    </button>
                  </div>
                )}
              </div>

              <div className="ac blue" style={{ marginTop: 14 }}>
                <div className="ai">🤖</div>
                <div><div className="at">Received the RTP as a PDF?</div>
                  <div className="as">PDF import to pre-fill this form is coming in a later update — for now, enter the details below.</div></div>
              </div>

              {/* 1 · Control */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div><div className="pt">1 · Control</div></div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Risk ID</label>
                    <input type="text" value={risk.risk_id} disabled />
                  </div>
                  <div className="risk-field">
                    <label>Date last reviewed</label>
                    <input type="date" value={lastReviewed} disabled={!canEdit}
                      onChange={(e) => setLastReviewed(e.target.value)} />
                  </div>
                  <div className="risk-field">
                    <label>Treatment option</label>
                    <input type="text" value={risk.treatment_option ? TREATMENT_OPTION_LABEL[risk.treatment_option] : '—'} disabled />
                  </div>
                  <div className="risk-field full">
                    <label>Description of new / additional control</label>
                    <textarea value={newControl} disabled={!canEdit}
                      onChange={(e) => setNewControl(e.target.value)}
                      placeholder="e.g. 'Add a second triage station and a flow-coordinator role during peak hours.'" />
                  </div>
                  <div className="risk-field full">
                    <label>Description of existing control <span style={{ fontWeight: 400, textTransform: 'none', color: '#1E40AF' }}>· auto from register</span></label>
                    <textarea value={risk.existing_controls ?? ''} disabled
                      style={{ background: '#F3F1EB', color: '#5B5A55' }} />
                    <div className="risk-field-hint">Pulled from {risk.risk_id} — must stay identical to the register. Edit it on the risk, not here.</div>
                  </div>
                  <div className="risk-field">
                    <label>Adequacy &amp; effectiveness of existing control</label>
                    <select value={adequacy} disabled={!canEdit}
                      onChange={(e) => setAdequacy(e.target.value as RtpAdequacy | '')}>
                      <option value="">—</option>
                      {ADEQUACY.map((a) => <option key={a} value={a}>{ADEQUACY_LABEL[a]}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* 2 · Task list */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div>
                  <div className="pt">2 · Detail task list</div>
                  <div className="psub">Tasks to implement the new control. RTP monitoring tracks these; every save is logged.</div>
                </div></div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th style={{ width: '32%' }}>Task</th>
                        <th>Person in-charge</th>
                        <th>Due</th>
                        <th style={{ textAlign: 'center' }}>Status</th>
                        <th>Last updated</th>
                        {canEdit && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t, i) => (
                        <tr key={t.id ?? `new-${i}`}>
                          <td>
                            <input type="text" value={t.task} disabled={!canEdit}
                              onChange={(e) => updateTask(i, { task: e.target.value })}
                              placeholder="Task description"
                              style={{ width: '100%', padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, fontFamily: 'inherit' }} />
                          </td>
                          <td>
                            <input type="text" value={t.pic} disabled={!canEdit}
                              onChange={(e) => updateTask(i, { pic: e.target.value })}
                              placeholder="Name / role"
                              style={{ width: '100%', padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, fontFamily: 'inherit' }} />
                          </td>
                          <td>
                            <input type="date" value={t.due_date} disabled={!canEdit}
                              onChange={(e) => updateTask(i, { due_date: e.target.value })}
                              style={{ padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, fontFamily: 'inherit' }} />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <select value={t.status} disabled={!canEdit}
                              onChange={(e) => updateTask(i, { status: e.target.value as RtpTaskStatus })}
                              style={{ padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, fontFamily: 'inherit' }}>
                              {TASK_STATUS.map((s) => <option key={s} value={s}>{TASK_LABEL[s]}</option>)}
                            </select>
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {t.updated_at ? fmtDate(t.updated_at) : '— not yet'}
                          </td>
                          {canEdit && (
                            <td style={{ textAlign: 'center' }}>
                              <button type="button" onClick={() => removeTask(i)}
                                title="Remove task"
                                style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button type="button" className="signout-btn" onClick={addTask}>＋ Add task</button>
                    <button type="button" className="signout-btn"
                      style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                      disabled={saving} onClick={saveTasks}>
                      {saving ? 'Saving…' : 'Save status changes'}
                    </button>
                  </div>
                )}

                {/* Update log */}
                <div style={{ marginTop: 16 }}>
                  <div className="psub" style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>🕑 Update log</div>
                  {updates.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No updates logged yet.</div>
                  ) : (
                    <div className="timeline">
                      {updates.map((u) => (
                        <div key={u.id} style={{ position: 'relative', paddingLeft: 16, paddingBottom: 12, borderLeft: '2px solid var(--border)', marginLeft: 4 }}>
                          <span style={{ position: 'absolute', left: -5, top: 2, width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />
                          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                            {fmtDate(u.created_at)} · {nameOf(u.created_by)}
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {u.status ? <b>{OVERALL_LABEL[u.status as RtpOverallStatus] ?? u.status} · </b> : null}
                            {u.note}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 3 · Ownership */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div><div className="pt">3 · Ownership</div></div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Participating / involving depts</label>
                    <input type="text" value={participatingDepts} disabled={!canEdit}
                      onChange={(e) => setParticipatingDepts(e.target.value)} placeholder="e.g. ED, Nursing, Facilities" />
                  </div>
                  <div className="risk-field">
                    <label>Risk owner</label>
                    <input type="text" value={riskOwner} disabled={!canEdit}
                      onChange={(e) => setRiskOwner(e.target.value)} placeholder="e.g. HOD, Emergency & Trauma" />
                  </div>
                  <div className="risk-field">
                    <label>Monitored by</label>
                    <input type="text" value={monitoredBy} disabled={!canEdit}
                      onChange={(e) => setMonitoredBy(e.target.value)} placeholder="e.g. Risk Coordinator, RMCQ" />
                  </div>
                </div>
              </div>

              {/* 4 · Approval chain */}
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="pf"><div>
                  <div className="pt">4 · Approval chain</div>
                  <div className="psub">RLO → HOD → Chairman RTC → Chairman ROC</div>
                </div></div>
                <div className="risk-form-grid">
                  <ApprovalStage label="Prepared by (RLO)" name={preparedName} date={preparedDate}
                    disabled={!canEdit} onName={setPreparedName} onDate={setPreparedDate} />
                  <ApprovalStage label="Approved by (HOD)" name={hodName} date={hodDate}
                    disabled={!canEdit} onName={setHodName} onDate={setHodDate} />
                  <ApprovalStage label="Reviewed by (Chairman RTC)" name={rtcName} date={rtcDate}
                    disabled={!canEdit} onName={setRtcName} onDate={setRtcDate} />
                  <ApprovalStage label="Approved by (Chairman ROC)" name={rocName} date={rocDate}
                    disabled={!canEdit} onName={setRocName} onDate={setRocDate} />
                </div>
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 24 }}>
                  <button type="button" className="signout-btn"
                    style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
                    disabled={saving} onClick={saveRtp}>
                    {saving ? 'Saving…' : 'Save RTP'}
                  </button>
                  <Link href={`/risk/${risk.id}`} className="signout-btn">Cancel</Link>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function ApprovalStage({ label, name, date, disabled, onName, onDate }: {
  label: string
  name: string
  date: string
  disabled: boolean
  onName: (v: string) => void
  onDate: (v: string) => void
}) {
  return (
    <div className="risk-field">
      <label>{label}</label>
      <input type="text" value={name} disabled={disabled}
        onChange={(e) => onName(e.target.value)} placeholder="Name" />
      <input type="date" value={date} disabled={disabled}
        onChange={(e) => onDate(e.target.value)} style={{ marginTop: 6 }} />
    </div>
  )
}
