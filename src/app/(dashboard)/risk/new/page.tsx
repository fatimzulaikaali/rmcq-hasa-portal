'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  RiskDept, RiskCategory, RiskScope,
} from '@/lib/risk/types'
import {
  computeRiskScore, formatRiskId,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_SCOPE_LABEL,
} from '@/lib/risk/scoring'

interface FormState {
  dept_code: string
  category: RiskCategory | ''
  scope: RiskScope | ''
  description: string
  cause_description: string
  impact_description: string
  existing_controls: string
  additional_controls: string
  control_classification: string
  action_owner: string
  implementation_period: string
  notes: string
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
}

const EMPTY: FormState = {
  dept_code: '', category: '', scope: '',
  description: '', cause_description: '', impact_description: '',
  existing_controls: '', additional_controls: '',
  control_classification: '', action_owner: '', implementation_period: '',
  notes: '',
  likelihood: 0,
  impact_manusia: 0, impact_reputasi: 0, impact_kewangan: 0,
  impact_operasi: 0, impact_objektif: 0,
}

export default function NewRiskPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [depts, setDepts]   = useState<RiskDept[]>([])
  const [riskUserId, setRiskUserId] = useState<number | null>(null)
  const [riskUserName, setRiskUserName] = useState<string>('')

  const [form, setForm] = useState<FormState>(EMPTY)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null)
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr) throw new Error(`Auth: ${userErr.message}`)
      if (!user) { router.push('/login'); return }

      // Look up the matching risk_users row
      const { data: ru, error: ruErr } = await supabase
        .from('risk_users')
        .select('id,name,email,is_active')
        .eq('auth_user_id', user.id)
        .maybeSingle()
      if (ruErr) throw new Error(`risk_users: ${ruErr.code ?? ''} ${ruErr.message}`)
      if (!ru || !ru.is_active) {
        throw new Error('No active risk_users record linked to your account. Ask the RMCQ admin to add you.')
      }
      setRiskUserId(ru.id)
      setRiskUserName(ru.name)

      // Departments (those with a risk_code)
      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .eq('kind', 'department')
        .order('sort_order')
      if (deptsErr) throw new Error(`Departments: ${deptsErr.code ?? ''} ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])
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

  // Live risk-score preview
  const scoreInputs = form.likelihood > 0 &&
    form.impact_manusia > 0 && form.impact_reputasi > 0 && form.impact_kewangan > 0 &&
    form.impact_operasi > 0 && form.impact_objektif > 0
  const computed = scoreInputs
    ? computeRiskScore(form.likelihood, [
        form.impact_manusia, form.impact_reputasi, form.impact_kewangan,
        form.impact_operasi, form.impact_objektif,
      ])
    : null

  // Validation
  const errors: string[] = []
  if (!form.dept_code)             errors.push('Department is required')
  if (!form.category)              errors.push('Category is required')
  if (!form.scope)                 errors.push('Scope is required')
  if (!form.description.trim())    errors.push('Risk description is required')
  if (!form.cause_description.trim()) errors.push('Cause is required')
  if (!form.impact_description.trim()) errors.push('Impact is required')
  if (!scoreInputs) errors.push('All scoring inputs (likelihood + 5 impacts) must be 1-5')

  const canSubmit = !submitting && errors.length === 0 && riskUserId !== null

  async function handleSubmit(targetStatus: 'DRAFT' | 'PENDING_HOD') {
    if (!canSubmit || !computed || !riskUserId) return
    setSubmitting(true); setSubmitError(null)
    try {
      const dept = depts.find((d) => d.code === form.dept_code)
      if (!dept || !dept.risk_code) throw new Error('Selected department has no risk_code mapping.')
      const year = new Date().getFullYear()

      // Atomic sequence allocation via the server-side function
      const { data: seqData, error: seqErr } = await supabase
        .rpc('next_risk_seq', { p_dept_code: form.dept_code, p_year: year })
      if (seqErr) throw new Error(`Sequence allocation: ${seqErr.code ?? ''} ${seqErr.message}`)
      const seq = seqData as number
      const risk_id = formatRiskId(dept.risk_code, year, seq)

      // INSERT risk (status=DRAFT) — generate own UUID is unnecessary since risks uses integer pk
      const { data: insertedRisk, error: riskErr } = await supabase
        .from('risks')
        .insert({
          risk_id,
          dept_code: form.dept_code,
          created_by: riskUserId,
          risk_owner_id: riskUserId,
          category: form.category,
          scope: form.scope,
          description: form.description.trim(),
          cause_description: form.cause_description.trim(),
          impact_description: form.impact_description.trim(),
          existing_controls: form.existing_controls.trim() || null,
          additional_controls: form.additional_controls.trim() || null,
          control_classification: form.control_classification.trim() || null,
          action_owner: form.action_owner.trim() || null,
          implementation_period: form.implementation_period.trim() || null,
          notes: form.notes.trim() || null,
          status: targetStatus,
        })
        .select('id')
        .single()
      if (riskErr) throw new Error(`Insert risk: ${riskErr.code ?? ''} ${riskErr.message}`)

      const newRiskRowId = insertedRisk.id as number

      // INSERT first risk_review (cycle 1)
      const { error: reviewErr } = await supabase
        .from('risk_reviews')
        .insert({
          risk_id: newRiskRowId,
          cycle_number: 1,
          reviewed_by: riskUserId,
          review_date: new Date().toISOString().slice(0, 10),
          likelihood: form.likelihood,
          impact_manusia: form.impact_manusia,
          impact_reputasi: form.impact_reputasi,
          impact_kewangan: form.impact_kewangan,
          impact_operasi: form.impact_operasi,
          impact_objektif: form.impact_objektif,
          avg_impact: computed.avgImpact,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
        })
      if (reviewErr) throw new Error(`Insert review: ${reviewErr.code ?? ''} ${reviewErr.message}`)

      // Audit log entry
      const { error: auditErr } = await supabase
        .from('risk_audit_logs')
        .insert({
          risk_id: newRiskRowId,
          entity_type: 'risk',
          entity_id: newRiskRowId,
          action_type: targetStatus === 'PENDING_HOD' ? 'CREATE_AND_SUBMIT' : 'CREATE',
          performed_by: riskUserId,
          user_role: 'RLO',
          new_value: { risk_id, status: targetStatus, dept_code: form.dept_code },
          comment: targetStatus === 'PENDING_HOD'
            ? 'Risk created and submitted to HOD via /risk/new'
            : 'Risk created via /risk/new',
        })
      if (auditErr) {
        // Non-fatal — audit log failure shouldn't block redirect
        console.warn('Audit log insert failed:', auditErr)
      }

      router.push('/risk')
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
              <div className="tb-title">New Risk</div>
              <div className="tb-meta">
                Submitted by {riskUserName || '…'} · status will be saved as <b>DRAFT</b>
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

          {!loading && !loadError && (
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmit('DRAFT') }}>
              {/* Section 1 — Identification */}
              <div className="panel">
                <div className="pf"><div><div className="pt">1. Risk Identification</div><div className="psub">Department, category, and scope of the risk.</div></div></div>
                <div className="risk-form-grid">
                  <Field label="Department" required>
                    <select value={form.dept_code} onChange={(e) => set('dept_code', e.target.value)}>
                      <option value="">— pick a department —</option>
                      {depts.map((d) => (
                        <option key={d.code} value={d.code}>{d.risk_code} — {d.name_en}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Category" required>
                    <select value={form.category} onChange={(e) => set('category', e.target.value as RiskCategory)}>
                      <option value="">— pick a category —</option>
                      {(Object.keys(RISK_CATEGORY_LABEL) as RiskCategory[]).map((c) => (
                        <option key={c} value={c}>{c} — {RISK_CATEGORY_LABEL[c]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Scope" required>
                    <div style={{ display: 'flex', gap: 12 }}>
                      {(Object.keys(RISK_SCOPE_LABEL) as RiskScope[]).map((s) => (
                        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <input type="radio" name="scope" value={s} checked={form.scope === s}
                            onChange={() => set('scope', s)} />
                          {RISK_SCOPE_LABEL[s]}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>

              {/* Section 2 — Description */}
              <div className="panel">
                <div className="pf"><div><div className="pt">2. Risk Description</div><div className="psub">What is the risk, what causes it, and what would the impact be?</div></div></div>
                <div className="risk-form-grid">
                  <Field label="Risk description" required full>
                    <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)}
                      placeholder="A clear one-paragraph statement of the risk." />
                  </Field>
                  <Field label="Cause" required full>
                    <textarea rows={3} value={form.cause_description} onChange={(e) => set('cause_description', e.target.value)}
                      placeholder="What conditions or events could trigger this risk?" />
                  </Field>
                  <Field label="Impact" required full>
                    <textarea rows={3} value={form.impact_description} onChange={(e) => set('impact_description', e.target.value)}
                      placeholder="If the risk occurs, what are the consequences?" />
                  </Field>
                </div>
              </div>

              {/* Section 3 — Controls */}
              <div className="panel">
                <div className="pf"><div><div className="pt">3. Controls &amp; Treatment</div><div className="psub">Optional but recommended. RC will validate this section.</div></div></div>
                <div className="risk-form-grid">
                  <Field label="Existing controls" full>
                    <textarea rows={2} value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)}
                      placeholder="What's already in place to manage this risk?" />
                  </Field>
                  <Field label="Additional controls proposed" full>
                    <textarea rows={2} value={form.additional_controls} onChange={(e) => set('additional_controls', e.target.value)}
                      placeholder="What new controls are you planning?" />
                  </Field>
                  <Field label="Action owner">
                    <input type="text" value={form.action_owner} onChange={(e) => set('action_owner', e.target.value)}
                      placeholder="Person responsible for implementing the controls" />
                  </Field>
                  <Field label="Implementation period">
                    <input type="text" value={form.implementation_period} onChange={(e) => set('implementation_period', e.target.value)}
                      placeholder="e.g. Q3 2026, by 31 Dec 2026" />
                  </Field>
                  <Field label="Notes" full>
                    <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
                      placeholder="Anything else worth noting." />
                  </Field>
                </div>
              </div>

              {/* Section 4 — Initial Assessment */}
              <div className="panel">
                <div className="pf"><div><div className="pt">4. Initial Risk Assessment (Cycle 1)</div><div className="psub">Rate likelihood and 5 impact dimensions 1-5. Risk score updates live below.</div></div></div>
                <div className="risk-form-grid">
                  <ScoreField label="Likelihood (Kebarangkalian)" value={form.likelihood}
                    onChange={(v) => set('likelihood', v)} />
                  <ScoreField label="Impact: Manusia (Human)" value={form.impact_manusia}
                    onChange={(v) => set('impact_manusia', v)} />
                  <ScoreField label="Impact: Reputasi (Reputation)" value={form.impact_reputasi}
                    onChange={(v) => set('impact_reputasi', v)} />
                  <ScoreField label="Impact: Kewangan (Financial)" value={form.impact_kewangan}
                    onChange={(v) => set('impact_kewangan', v)} />
                  <ScoreField label="Impact: Operasi (Operations)" value={form.impact_operasi}
                    onChange={(v) => set('impact_operasi', v)} />
                  <ScoreField label="Impact: Objektif (Objectives)" value={form.impact_objektif}
                    onChange={(v) => set('impact_objektif', v)} />
                </div>

                {/* Live score preview */}
                <div className="risk-score-preview">
                  {computed ? (
                    <>
                      <div className="rsp-block">
                        <div className="rsp-label">Average Impact</div>
                        <div className="rsp-value">{(Math.round(computed.avgImpact * 10) / 10).toFixed(1)}</div>
                      </div>
                      <div className="rsp-block">
                        <div className="rsp-label">Risk Score (L × Avg)</div>
                        <div className="rsp-value">{(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</div>
                      </div>
                      <div className="rsp-block">
                        <div className="rsp-label">Risk Level</div>
                        <div className="rsp-value">
                          <span style={{
                            display: 'inline-block', padding: '4px 14px', borderRadius: 4,
                            fontSize: 14, fontWeight: 700,
                            color: RISK_LEVEL_COLOR[computed.riskLevel],
                            background: RISK_LEVEL_BG[computed.riskLevel],
                          }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>
                      Pick all 6 scoring inputs above to see the live risk score and band.
                    </div>
                  )}
                </div>
              </div>

              {/* Submit row */}
              <div className="panel">
                {errors.length > 0 && (
                  <div className="ac amber" style={{ marginBottom: 10 }}>
                    <div className="ai">!</div>
                    <div>
                      <div className="at">Form needs more info before you can save</div>
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
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                  <Link href="/risk" className="signout-btn">Cancel</Link>
                  <button type="submit" className="signout-btn"
                    style={{ background: canSubmit ? '#fff' : '#9CA3AF', color: canSubmit ? 'var(--text)' : '#fff', borderColor: canSubmit ? 'var(--border)' : '#9CA3AF', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
                    disabled={!canSubmit}>
                    {submitting ? 'Saving…' : '💾 Save as DRAFT'}
                  </button>
                  <button type="button" className="signout-btn"
                    style={{ background: canSubmit ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: canSubmit ? 'var(--blue)' : '#9CA3AF', cursor: canSubmit ? 'pointer' : 'not-allowed' }}
                    disabled={!canSubmit}
                    onClick={() => void handleSubmit('PENDING_HOD')}>
                    {submitting ? 'Saving…' : '→ Submit to HOD'}
                  </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
                  <b>Save as DRAFT</b> — keep working on it; only you see it. <br />
                  <b>Submit to HOD</b> — send to your HOD for endorsement now. They will see it in their queue.
                </div>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  )
}

/* -------- Small form helpers -------- */

function Field({ label, required, hint, full, children }: {
  label: string
  required?: boolean
  hint?: string
  full?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`risk-field ${full ? 'full' : ''}`}>
      <label>
        {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {children}
      {hint && <div className="risk-field-hint">{hint}</div>}
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
