'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { Risk, RiskReview, RiskDept, TreatmentStatus } from '@/lib/risk/types'
import {
  computeRiskScore,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
} from '@/lib/risk/scoring'

interface FormState {
  review_date: string                    // YYYY-MM-DD
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
  treatment_status: TreatmentStatus | ''
  treatment_update: string
}

const TREATMENT_LABEL: Record<TreatmentStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED:   'Completed',
  VERIFIED:    'Verified',
}

export default function NewReviewPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const riskRowId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [risk, setRisk]   = useState<Risk | null>(null)
  const [dept, setDept]   = useState<RiskDept | null>(null)
  const [latest, setLatest] = useState<RiskReview | null>(null)
  const [nextCycle, setNextCycle] = useState<number>(1)
  const [riskUserId, setRiskUserId] = useState<number | null>(null)
  const [riskUserName, setRiskUserName] = useState<string>('')

  const [form, setForm] = useState<FormState>({
    review_date: new Date().toISOString().slice(0, 10),
    likelihood: 0,
    impact_manusia: 0, impact_reputasi: 0, impact_kewangan: 0,
    impact_operasi: 0, impact_objektif: 0,
    treatment_status: '',
    treatment_update: '',
  })

  useEffect(() => { void load() }, [riskRowId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!Number.isFinite(riskRowId)) { setLoadError('Invalid risk id'); setLoading(false); return }
    setLoading(true); setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: ru, error: ruErr } = await supabase.from('risk_users')
        .select('id,name,is_active').eq('auth_user_id', user.id).maybeSingle()
      if (ruErr) throw new Error(`risk_users: ${ruErr.code ?? ''} ${ruErr.message}`)
      if (!ru || !ru.is_active) throw new Error('No active risk_users record linked to your account.')
      setRiskUserId(ru.id)
      setRiskUserName(ru.name)

      const { data: riskData, error: riskErr } = await supabase
        .from('risks').select('*').eq('id', riskRowId).maybeSingle()
      if (riskErr) throw new Error(`Risk: ${riskErr.code ?? ''} ${riskErr.message}`)
      if (!riskData) throw new Error('Risk not found.')
      setRisk(riskData as Risk)

      const [{ data: deptData, error: deptErr }, { data: reviewsData, error: rvErr }] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', (riskData as Risk).dept_code).maybeSingle(),
        supabase.from('risk_reviews').select('*')
          .eq('risk_id', riskRowId).order('cycle_number', { ascending: false }),
      ])
      if (deptErr) throw new Error(`Department: ${deptErr.code ?? ''} ${deptErr.message}`)
      if (rvErr)   throw new Error(`Reviews: ${rvErr.code ?? ''} ${rvErr.message}`)
      setDept(deptData as RiskDept | null)

      const reviews = (reviewsData ?? []) as RiskReview[]
      const last = reviews[0] ?? null
      setLatest(last)
      setNextCycle((last?.cycle_number ?? 0) + 1)

      // Pre-fill from latest review so reviewer can see the prior numbers
      if (last) {
        setForm((prev) => ({
          ...prev,
          likelihood:      last.likelihood,
          impact_manusia:  last.impact_manusia,
          impact_reputasi: last.impact_reputasi,
          impact_kewangan: last.impact_kewangan,
          impact_operasi:  last.impact_operasi,
          impact_objektif: last.impact_objektif,
          treatment_status: last.treatment_status ?? '',
        }))
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

  const scoreInputs = form.likelihood > 0 &&
    form.impact_manusia > 0 && form.impact_reputasi > 0 && form.impact_kewangan > 0 &&
    form.impact_operasi > 0 && form.impact_objektif > 0
  const computed = scoreInputs
    ? computeRiskScore(form.likelihood, [
        form.impact_manusia, form.impact_reputasi, form.impact_kewangan,
        form.impact_operasi, form.impact_objektif,
      ])
    : null

  const errors: string[] = []
  if (!form.review_date) errors.push('Review date is required')
  if (!scoreInputs) errors.push('All scoring inputs must be 1-5')
  const canSubmit = !submitting && errors.length === 0 && riskUserId !== null && risk !== null

  async function handleSubmit() {
    if (!canSubmit || !computed || !riskUserId || !risk) return
    setSubmitting(true); setSubmitError(null)
    try {
      const { error: revErr } = await supabase.from('risk_reviews').insert({
        risk_id: risk.id,
        cycle_number: nextCycle,
        reviewed_by: riskUserId,
        review_date: form.review_date,
        likelihood: form.likelihood,
        impact_manusia: form.impact_manusia,
        impact_reputasi: form.impact_reputasi,
        impact_kewangan: form.impact_kewangan,
        impact_operasi: form.impact_operasi,
        impact_objektif: form.impact_objektif,
        avg_impact: computed.avgImpact,
        risk_score: computed.riskScore,
        risk_level: computed.riskLevel,
        treatment_status: form.treatment_status || null,
        treatment_update: form.treatment_update.trim() || null,
      })
      if (revErr) throw new Error(`Insert review: ${revErr.code ?? ''} ${revErr.message}`)

      const { error: auditErr } = await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk_review',
        action_type: 'ADD_REVIEW_CYCLE',
        performed_by: riskUserId,
        user_role: 'RLO',
        new_value: {
          cycle_number: nextCycle,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
          treatment_status: form.treatment_status || null,
        },
        comment: `Added review cycle ${nextCycle} via /risk/${risk.id}/review`,
      })
      if (auditErr) console.warn('Audit log insert failed:', auditErr)

      router.push(`/risk/${risk.id}`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
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
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">
                Add Review · <span style={{ fontFamily: 'monospace' }}>{risk?.risk_id ?? '…'}</span>
              </div>
              <div className="tb-meta">
                {dept?.name_en ?? ''} · Cycle <b>{nextCycle}</b> · reviewed by {riskUserName || '…'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href={risk ? `/risk/${risk.id}` : '/risk'} className="signout-btn">← Back to risk</Link>
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

          {!loading && !loadError && risk && (
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
              {/* Context — what we're reviewing */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Risk being reviewed</div>
                  <div className="psub">{risk.risk_id} · {dept?.name_en ?? risk.dept_code}</div>
                </div></div>
                <div className="risk-def-block">
                  <div className="risk-def-label">Description</div>
                  <div className="risk-def-block-value">{risk.description}</div>
                </div>
                {latest && (
                  <div className="risk-score-preview" style={{ marginTop: 4 }}>
                    <div className="rsp-block">
                      <div className="rsp-label">Previous Cycle</div>
                      <div className="rsp-value">{latest.cycle_number}</div>
                    </div>
                    <div className="rsp-block">
                      <div className="rsp-label">Previous Score</div>
                      <div className="rsp-value">{(Math.round(latest.risk_score * 10) / 10).toFixed(1)}</div>
                    </div>
                    <div className="rsp-block">
                      <div className="rsp-label">Previous Level</div>
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
                )}
              </div>

              {/* New review inputs */}
              <div className="panel">
                <div className="pf"><div><div className="pt">Cycle {nextCycle} — Scoring</div><div className="psub">Re-score the risk based on current conditions. Form is pre-filled from the previous cycle.</div></div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Review date<span style={{ color: 'var(--red)' }}> *</span></label>
                    <input type="date" value={form.review_date}
                      onChange={(e) => set('review_date', e.target.value)} />
                  </div>
                  <ScoreField label="Likelihood (Kebarangkalian)" value={form.likelihood}
                    onChange={(v) => set('likelihood', v)} />
                  <ScoreField label="Impact: Manusia" value={form.impact_manusia}
                    onChange={(v) => set('impact_manusia', v)} />
                  <ScoreField label="Impact: Reputasi" value={form.impact_reputasi}
                    onChange={(v) => set('impact_reputasi', v)} />
                  <ScoreField label="Impact: Kewangan" value={form.impact_kewangan}
                    onChange={(v) => set('impact_kewangan', v)} />
                  <ScoreField label="Impact: Operasi" value={form.impact_operasi}
                    onChange={(v) => set('impact_operasi', v)} />
                  <ScoreField label="Impact: Objektif" value={form.impact_objektif}
                    onChange={(v) => set('impact_objektif', v)} />
                </div>

                <div className="risk-score-preview">
                  {computed ? (
                    <>
                      <div className="rsp-block">
                        <div className="rsp-label">New Avg Impact</div>
                        <div className="rsp-value">{(Math.round(computed.avgImpact * 10) / 10).toFixed(1)}</div>
                      </div>
                      <div className="rsp-block">
                        <div className="rsp-label">New Risk Score</div>
                        <div className="rsp-value">{(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</div>
                      </div>
                      <div className="rsp-block">
                        <div className="rsp-label">New Risk Level</div>
                        <div className="rsp-value">
                          <span style={{
                            display: 'inline-block', padding: '4px 14px', borderRadius: 4,
                            fontSize: 14, fontWeight: 700,
                            color: RISK_LEVEL_COLOR[computed.riskLevel],
                            background: RISK_LEVEL_BG[computed.riskLevel],
                          }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                        </div>
                      </div>
                      {latest && (
                        <div className="rsp-block">
                          <div className="rsp-label">vs Previous</div>
                          <div className="rsp-value" style={{
                            color: computed.riskScore > latest.risk_score ? 'var(--red)'
                              : computed.riskScore < latest.risk_score ? 'var(--green)'
                              : 'var(--muted)',
                          }}>
                            {computed.riskScore > latest.risk_score ? '↑'
                              : computed.riskScore < latest.risk_score ? '↓'
                              : '→'} {Math.abs(Math.round((computed.riskScore - latest.risk_score) * 10) / 10).toFixed(1)}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
                      Pick all 6 scoring inputs to see the new score.
                    </div>
                  )}
                </div>
              </div>

              {/* Treatment progress */}
              <div className="panel">
                <div className="pf"><div><div className="pt">Treatment Progress</div><div className="psub">How are the controls/actions tracking since last review?</div></div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Treatment status</label>
                    <select value={form.treatment_status}
                      onChange={(e) => set('treatment_status', e.target.value as TreatmentStatus | '')}>
                      <option value="">— not set —</option>
                      {(Object.keys(TREATMENT_LABEL) as TreatmentStatus[]).map((t) => (
                        <option key={t} value={t}>{TREATMENT_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="risk-field full">
                    <label>Treatment update / notes</label>
                    <textarea rows={3} value={form.treatment_update}
                      onChange={(e) => set('treatment_update', e.target.value)}
                      placeholder="What's progressed, what's blocked, what's changed since last cycle?" />
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="panel">
                {errors.length > 0 && (
                  <div className="ac amber" style={{ marginBottom: 10 }}>
                    <div className="ai">!</div>
                    <div>
                      <div className="at">Form needs more info</div>
                      <ul className="as" style={{ margin: '4px 0 0 16px' }}>
                        {errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
                {submitError && (
                  <div className="ac red" style={{ marginBottom: 10 }}>
                    <div className="ai">⚠️</div>
                    <div><div className="at">Could not save</div><div className="as">{submitError}</div></div>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Link href={risk ? `/risk/${risk.id}` : '/risk'} className="signout-btn">Cancel</Link>
                  <button type="submit" className="signout-btn"
                    style={{ background: canSubmit ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: canSubmit ? 'var(--blue)' : '#9CA3AF', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
                    disabled={!canSubmit}>
                    {submitting ? 'Saving…' : `💾 Save Cycle ${nextCycle}`}
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
                  After saving, the new cycle becomes the latest review and you&apos;ll return to the risk detail page.
                </div>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  )
}

function ScoreField({ label, value, onChange }: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="risk-field">
      <label>{label}<span style={{ color: 'var(--red)' }}> *</span></label>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button"
            className={`score-pill ${value === n ? 'active' : ''}`}
            onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}
