'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  Risk, RiskReview, RiskDept, RiskUser, CrossCuttingTheme,
} from '@/lib/risk/types'
import {
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_STATUS_LABEL, RISK_STATUS_BADGE,
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
      setRisk(riskData as Risk)

      const [
        { data: deptData, error: deptErr },
        { data: reviewsData, error: reviewsErr },
        { data: logsData, error: logsErr },
        { data: usersData, error: usersErr },
        { data: tagsData, error: tagsErr },
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
      ])
      if (deptErr)    throw new Error(`Department: ${deptErr.code ?? ''} ${deptErr.message}`)
      if (reviewsErr) throw new Error(`Reviews: ${reviewsErr.code ?? ''} ${reviewsErr.message}`)
      if (logsErr)    throw new Error(`Audit logs: ${logsErr.code ?? ''} ${logsErr.message}`)
      if (usersErr)   throw new Error(`Users: ${usersErr.code ?? ''} ${usersErr.message}`)
      if (tagsErr)    throw new Error(`Theme tags: ${tagsErr.code ?? ''} ${tagsErr.message}`)

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
        </div>
      </aside>

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
            <Link href="/risk" className="signout-btn">← Back to register</Link>
            <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
          </div>
        </header>

        <main className="tab-pane">
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
              {/* Top summary tiles */}
              <div className="pscs-tiles" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="tile">
                  <div className="tl">Status</div>
                  <div className="tv" style={{ fontSize: 18 }}>
                    <span style={{
                      display: 'inline-block', padding: '4px 10px', borderRadius: 4,
                      fontSize: 12, fontWeight: 700,
                      color: RISK_STATUS_BADGE[risk.status].fg,
                      background: RISK_STATUS_BADGE[risk.status].bg,
                    }}>{RISK_STATUS_LABEL[risk.status]}</span>
                  </div>
                </div>
                <div className="tile">
                  <div className="tl">Risk Level</div>
                  <div className="tv" style={{ fontSize: 18 }}>
                    {latest ? (
                      <span style={{
                        display: 'inline-block', padding: '4px 10px', borderRadius: 4,
                        fontSize: 12, fontWeight: 700,
                        color: RISK_LEVEL_COLOR[latest.risk_level],
                        background: RISK_LEVEL_BG[latest.risk_level],
                      }}>{RISK_LEVEL_LABEL[latest.risk_level]}</span>
                    ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                  </div>
                </div>
                <div className="tile">
                  <div className="tl">Risk Score</div>
                  <div className="tv" style={{ color: latest ? RISK_LEVEL_COLOR[latest.risk_level] : 'var(--muted)' }}>
                    {latest ? (Math.round(latest.risk_score * 10) / 10).toFixed(1) : '—'}
                  </div>
                </div>
                <div className="tile">
                  <div className="tl">Review Cycles</div>
                  <div className="tv" style={{ color: 'var(--blue)' }}>{reviews.length}</div>
                </div>
                <div className="tile">
                  <div className="tl">Days Open</div>
                  <div className="tv" style={{ color: 'var(--teal)' }}>
                    {daysOpen(risk.date_opened, risk.date_closed)}
                  </div>
                </div>
              </div>

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
