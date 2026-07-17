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
import type { RiskActionItem, ActionStatus } from '@/lib/risk/types'
import { ACTION_TYPE_LABEL, ACTION_STATUS_LABEL } from '@/lib/risk/scoring'
import { exportActionItemsXlsx, exportActionItemsPdf, type ActionItemListItem } from '@/lib/risk/exports'

interface ActionRow extends RiskActionItem {
  risks: { id: number; risk_id: string; dept_code: string; description: string } | null
  risk_meetings: { id: number; title: string; meeting_type: string; meeting_date: string } | null
}

const STATUS_BADGE: Record<ActionStatus, { bg: string; fg: string }> = {
  PENDING:   { bg: '#FEF3C7', fg: '#92400E' },
  RESPONDED: { bg: '#DBEAFE', fg: '#1E40AF' },
  ACCEPTED:  { bg: '#DCFCE7', fg: '#166534' },
  OVERDUE:   { bg: '#FEE2E2', fg: '#991B1B' },
  ESCALATED: { bg: '#EDE9FE', fg: '#5B21B6' },
}

type Tab = 'open' | 'responded' | 'closed'
const isOpen     = (s: ActionStatus) => s === 'PENDING' || s === 'OVERDUE'
const isResponded = (s: ActionStatus) => s === 'RESPONDED'
const isClosed   = (s: ActionStatus) => s === 'ACCEPTED' || s === 'ESCALATED'

export default function RiskActionsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const [rows, setRows] = useState<ActionRow[]>([])
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map())
  const [isRC, setIsRC] = useState(false)
  const [canRespond, setCanRespond] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [roleName, setRoleName] = useState<string>('RLO')
  const [tab, setTab] = useState<Tab>('open')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.riskUser) { setAccessDenied(true); return }
      const role = access.activeRole?.role
      setIsRC(role === 'RC')
      setCanRespond(role === 'RLO' || role === 'HOD')
      setCurrentUserId(access.riskUser.riskUserId)
      if (role) setRoleName(role)

      const { data, error } = await supabase
        .from('risk_action_items')
        .select('*, risks(id,risk_id,dept_code,description), risk_meetings(id,title,meeting_type,meeting_date)')
        .order('id', { ascending: false })
      if (error) throw new Error(`Action items: ${error.code ?? ''} ${error.message}`)

      let items = (data ?? []) as ActionRow[]
      // Dept-scoped roles only see items ASSIGNED to their department (not by the
      // risk's own dept — a risk can task another department).
      if (access.deptScopes !== null) {
        const scopes = new Set(access.deptScopes)
        items = items.filter((a) => (a.assigned_depts ?? []).some((c) => scopes.has(c)))
      }
      setRows(items)

      // dept names for everything referenced (assigned depts + risk depts)
      const deptCodes = Array.from(new Set([
        ...items.flatMap((a) => a.assigned_depts ?? []),
        ...items.map((a) => a.risks?.dept_code).filter((d): d is string => !!d),
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

  async function audit(item: ActionRow, action_type: string, role: string, comment: string) {
    if (!item.risk_id) return
    await supabase.from('risk_audit_logs').insert({
      risk_id: item.risk_id, entity_type: 'action_item', entity_id: item.id,
      action_type, performed_by: currentUserId, user_role: role, comment,
    })
  }

  async function respond(item: ActionRow, text: string) {
    if (!text.trim()) return
    setBusy(true); setLoadError(null)
    try {
      const { error } = await supabase.from('risk_action_items')
        .update({ response: text.trim(), status: 'RESPONDED', updated_at: new Date().toISOString() })
        .eq('id', item.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      await audit(item, 'ACTION_RESPONDED', roleName, `Feedback on directive: ${text.trim()}`)
      await load()
    } catch (e) { setLoadError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function setStatus(item: ActionRow, status: ActionStatus) {
    setBusy(true); setLoadError(null)
    try {
      const { error } = await supabase.from('risk_action_items')
        .update({ status, updated_at: new Date().toISOString() }).eq('id', item.id)
      if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
      if (status === 'ACCEPTED') await audit(item, 'ACTION_ACCEPTED', 'RC', 'RC accepted the department feedback')
      else if (status === 'ESCALATED') await audit(item, 'ACTION_ESCALATED', 'RC', 'RC escalated this directive for committee review')
      await load()
    } catch (e) { setLoadError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const counts = useMemo(() => ({
    open:      rows.filter((a) => isOpen(a.status)).length,
    responded: rows.filter((a) => isResponded(a.status)).length,
    closed:    rows.filter((a) => isClosed(a.status)).length,
  }), [rows])

  const shown = useMemo(() => rows.filter((a) =>
    tab === 'open' ? isOpen(a.status) : tab === 'responded' ? isResponded(a.status) : isClosed(a.status)),
    [rows, tab])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="actions" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Action Items</div>
              <div className="tb-meta">{accessDenied ? 'Access denied' : 'Committee directives &amp; clarifications'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk" className="signout-btn">← Risk Register</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <RiskTabs active="actions" />

        <main className="tab-pane risk-skin">
          {loadError && (
            <div className="ac red"><div className="ai">⚠️</div>
              <div><div className="at">Error</div><div className="as">{loadError}</div></div></div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>No Risk module account</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Risk Register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <>
              <div className="risk-tabs">
                <button type="button" className={`risk-tab risk-tab-attention ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
                  Awaiting response <span className="risk-tab-count">{counts.open}</span>
                </button>
                <button type="button" className={`risk-tab ${tab === 'responded' ? 'active' : ''}`} onClick={() => setTab('responded')}>
                  Responded <span className="risk-tab-count">{counts.responded}</span>
                </button>
                <button type="button" className={`risk-tab ${tab === 'closed' ? 'active' : ''}`} onClick={() => setTab('closed')}>
                  Closed <span className="risk-tab-count">{counts.closed}</span>
                </button>
              </div>

              <div className="panel">
                <div className="pf" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="pt">{tab === 'open' ? 'Awaiting Response' : tab === 'responded' ? 'Responded' : 'Closed'}</div>
                    <div className="psub">
                      {isRC ? 'You can review responses and accept or escalate each item.' : canRespond ? 'Record your department’s feedback on each directive.' : 'Read-only view of committee action items.'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      disabled={shown.length === 0}
                      title="Download the current tab as Excel"
                      onClick={() => {
                        const items: ActionItemListItem[] = shown.map((a) => ({ item: a, risk: a.risks }))
                        const depts = Array.from(deptNames.entries()).map(([code, name_en]) => ({ code, name_en }))
                        exportActionItemsXlsx(items, { view: tab, deptScope: null }, depts)
                      }}>
                      📊 Excel
                    </button>
                    <button type="button" className="signout-btn"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      disabled={shown.length === 0}
                      title="Print or save the current tab as PDF"
                      onClick={() => {
                        const items: ActionItemListItem[] = shown.map((a) => ({ item: a, risk: a.risks }))
                        const depts = Array.from(deptNames.entries()).map(([code, name_en]) => ({ code, name_en }))
                        exportActionItemsPdf(items, { view: tab, deptScope: null }, depts)
                      }}>
                      🖨 PDF
                    </button>
                  </div>
                </div>

                {shown.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)', fontStyle: 'italic', padding: '20px 4px', textAlign: 'center' }}>
                    {tab === 'open' ? 'Nothing awaiting a response.' : tab === 'responded' ? 'Nothing responded yet.' : 'Nothing closed yet.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {shown.map((a) => (
                      <ActionCard
                        key={a.id}
                        item={a}
                        deptLabel={a.risks ? (deptNames.get(a.risks.dept_code) ?? a.risks.dept_code) : '—'}
                        assignedLabel={(a.assigned_depts ?? []).map((c) => deptNames.get(c) ?? c).join(', ') || '—'}
                        isRC={isRC}
                        canRespond={canRespond}
                        busy={busy}
                        onRespond={(t) => respond(a, t)}
                        onStatus={(s) => setStatus(a, s)}
                      />
                    ))}
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

function ActionCard({ item, deptLabel, assignedLabel, isRC, canRespond, busy, onRespond, onStatus }: {
  item: ActionRow
  deptLabel: string
  assignedLabel: string
  isRC: boolean
  canRespond: boolean
  busy: boolean
  onRespond: (text: string) => void
  onStatus: (status: ActionStatus) => void
}) {
  const [text, setText] = useState(item.response ?? '')
  const [editing, setEditing] = useState(false)
  const sb = STATUS_BADGE[item.status]
  const showForm = canRespond && (editing || (!item.response && (item.status === 'PENDING' || item.status === 'OVERDUE')))

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13 }}>
          {item.risks && (
            <Link href={`/risk/${item.risks.id}`} style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--blue)' }}>
              {item.risks.risk_id}
            </Link>
          )}
          <span style={{ color: 'var(--muted)' }}> · {deptLabel}</span>
          <span style={{ fontWeight: 600 }}> · {ACTION_TYPE_LABEL[item.action_type]}</span>
          {item.risk_meetings && (
            <span style={{ color: 'var(--muted)' }}> · {item.risk_meetings.meeting_type} {item.risk_meetings.meeting_date}</span>
          )}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, color: sb.fg, background: sb.bg }}>
          {ACTION_STATUS_LABEL[item.status]}
        </span>
      </div>

      <div style={{ fontSize: 13, marginTop: 6 }}>{item.description}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
        Assigned to {assignedLabel}
      </div>

      {item.response && !editing && (
        <div style={{ marginTop: 8, background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Department feedback</div>
          <div style={{ fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' }}>{item.response}</div>
        </div>
      )}

      {showForm ? (
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
              disabled={!text.trim() || busy} onClick={() => { onRespond(text); setEditing(false) }}>
              {item.response ? 'Update feedback' : 'Submit feedback'}
            </button>
          </div>
        </div>
      ) : canRespond && item.response && !isClosed(item.status) ? (
        <div style={{ marginTop: 6 }}>
          <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setEditing(true)}>✎ Edit feedback</button>
        </div>
      ) : null}

      {isRC && item.status === 'RESPONDED' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button type="button" className="signout-btn"
            style={{ fontSize: 11, padding: '4px 12px', background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
            disabled={busy} onClick={() => onStatus('ACCEPTED')}>✓ Accept</button>
          <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 12px' }}
            disabled={busy} onClick={() => onStatus('ESCALATED')}>↑ Escalate</button>
        </div>
      )}
    </div>
  )
}
