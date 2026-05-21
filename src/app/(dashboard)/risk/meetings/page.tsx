'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import type { RiskMeeting, MeetingType } from '@/lib/risk/types'
import { MEETING_TYPE_LABEL, MEETING_STATUS_LABEL } from '@/lib/risk/scoring'

interface MeetingRow {
  meeting: RiskMeeting
  agendaCount: number
}

interface NewMeetingForm {
  meeting_type: MeetingType
  title: string
  meeting_date: string
  location: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const EMPTY_NEW: NewMeetingForm = { meeting_type: 'RTC', title: '', meeting_date: todayISO(), location: '' }

const MEETING_STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  PLANNED:     { bg: '#DBEAFE', fg: '#1E40AF' },
  IN_PROGRESS: { bg: '#FEF3C7', fg: '#854D0E' },
  COMPLETED:   { bg: '#DCFCE7', fg: '#166534' },
  CANCELLED:   { bg: '#E5E7EB', fg: '#4B5563' },
}

export default function RiskMeetingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const [rows, setRows] = useState<MeetingRow[]>([])
  const [isRC, setIsRC] = useState(false)
  const [riskUserId, setRiskUserId] = useState<number | null>(null)

  const [form, setForm] = useState<NewMeetingForm>(EMPTY_NEW)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Committees are hospital-wide; only global roles see the Meetings area.
      const access = await getModuleAccess(supabase)
      if (!access.allModules) { setAccessDenied(true); return }
      setIsRC(access.activeRole?.role === 'RC')
      setRiskUserId(access.riskUser?.riskUserId ?? null)

      const { data: meetingsData, error: mErr } = await supabase
        .from('risk_meetings').select('*').order('meeting_date', { ascending: false })
      if (mErr) throw new Error(`Meetings: ${mErr.code ?? ''} ${mErr.message}`)
      const meetings = (meetingsData ?? []) as RiskMeeting[]

      // Agenda counts per meeting
      const { data: agendaData, error: aErr } = await supabase
        .from('risk_meeting_agenda').select('meeting_id')
      if (aErr) throw new Error(`Agenda: ${aErr.code ?? ''} ${aErr.message}`)
      const counts = new Map<number, number>()
      for (const a of (agendaData ?? []) as { meeting_id: number }[]) {
        counts.set(a.meeting_id, (counts.get(a.meeting_id) ?? 0) + 1)
      }

      setRows(meetings.map((m) => ({ meeting: m, agendaCount: counts.get(m.id) ?? 0 })))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  async function handleCreate() {
    if (!form.title.trim() || !form.meeting_date) {
      setCreateError('Title and meeting date are required.'); return
    }
    setCreating(true); setCreateError(null)
    try {
      const { data: ins, error } = await supabase.from('risk_meetings').insert({
        meeting_type: form.meeting_type,
        title: form.title.trim(),
        meeting_date: form.meeting_date,
        location: form.location.trim() || null,
        status: 'PLANNED',
        created_by: riskUserId,
        chaired_by: riskUserId,
      }).select('id').single()
      if (error) throw new Error(`Create meeting: ${error.code ?? ''} ${error.message}`)
      router.push(`/risk/meetings/${ins.id}`)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="committees" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Committee Meetings</div>
              <div className="tb-meta">{accessDenied ? 'Access denied' : 'RTC &amp; ROC — agendas, decisions, action items'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk" className="signout-btn">← Back to register</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane risk-skin">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>
          )}
          {loading && !loadError && !accessDenied && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Committee area is hospital-wide</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Only hospital-wide roles (RC, Director, Admin) can view the RTC / ROC meetings. Switch your active role if you hold one.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <>
              {isRC && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">+ New Meeting</div>
                    <div className="psub">Schedule an RTC or ROC sitting. After creating it, add tabled risks to its agenda and record decisions.</div>
                  </div></div>
                  <div className="risk-form-grid">
                    <div className="risk-field">
                      <label>Committee<span style={{ color: 'var(--red)' }}> *</span></label>
                      <select value={form.meeting_type}
                        onChange={(e) => setForm({ ...form, meeting_type: e.target.value as MeetingType })}>
                        <option value="RTC">RTC — {MEETING_TYPE_LABEL.RTC}</option>
                        <option value="ROC">ROC — {MEETING_TYPE_LABEL.ROC}</option>
                      </select>
                    </div>
                    <div className="risk-field">
                      <label>Meeting date<span style={{ color: 'var(--red)' }}> *</span></label>
                      <input type="date" value={form.meeting_date}
                        onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                    </div>
                    <div className="risk-field full">
                      <label>Title<span style={{ color: 'var(--red)' }}> *</span></label>
                      <input type="text" value={form.title} placeholder="e.g. RTC Meeting 2/2026"
                        onChange={(e) => setForm({ ...form, title: e.target.value })} />
                    </div>
                    <div className="risk-field full">
                      <label>Location</label>
                      <input type="text" value={form.location} placeholder="e.g. Bilik Mesyuarat Utama / Online"
                        onChange={(e) => setForm({ ...form, location: e.target.value })} />
                    </div>
                  </div>
                  {createError && (
                    <div className="ac red" style={{ marginTop: 10 }}>
                      <div className="ai">⚠️</div><div><div className="at">Could not create</div><div className="as">{createError}</div></div></div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button type="button" className="signout-btn"
                      style={{ background: creating ? '#9CA3AF' : 'var(--blue)', color: '#fff', borderColor: creating ? '#9CA3AF' : 'var(--blue)' }}
                      disabled={creating} onClick={handleCreate}>
                      {creating ? 'Creating…' : '+ Create Meeting'}
                    </button>
                  </div>
                </div>
              )}

              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">All Meetings</div>
                  <div className="psub">{rows.length} meeting{rows.length === 1 ? '' : 's'}</div>
                </div></div>
                {rows.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic' }}>
                    No meetings yet.{isRC ? ' Create one above to start tabling risks.' : ''}
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="risk-table">
                      <thead>
                        <tr>
                          <th>Committee</th>
                          <th>Title</th>
                          <th>Date</th>
                          <th style={{ textAlign: 'center' }}>Agenda</th>
                          <th style={{ textAlign: 'center' }}>Status</th>
                          <th style={{ textAlign: 'right' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ meeting, agendaCount }) => (
                          <tr key={meeting.id}>
                            <td><b>{meeting.meeting_type}</b></td>
                            <td>{meeting.title}</td>
                            <td>{meeting.meeting_date}</td>
                            <td style={{ textAlign: 'center' }}>{agendaCount}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                                fontSize: 10, fontWeight: 700,
                                color: (MEETING_STATUS_BADGE[meeting.status] ?? MEETING_STATUS_BADGE.PLANNED).fg,
                                background: (MEETING_STATUS_BADGE[meeting.status] ?? MEETING_STATUS_BADGE.PLANNED).bg,
                              }}>{MEETING_STATUS_LABEL[meeting.status]}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <Link href={`/risk/meetings/${meeting.id}`} className="signout-btn"
                                style={{ fontSize: 11, padding: '4px 10px' }}>Open →</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
