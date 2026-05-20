'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { Risk, RiskReview, RiskDept, RiskCategory, RiskScope, RiskRole } from '@/lib/risk/types'
import { resolveCurrentRiskUser } from '@/lib/risk/auth'
import {
  computeRiskScore,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_SCOPE_LABEL, RISK_STATUS_LABEL,
} from '@/lib/risk/scoring'

interface FormState {
  category: RiskCategory | ''
  scope: RiskScope | ''
  description: string
  cause_description: string
  impact_description: string
  existing_controls: string
  additional_controls: string
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

export default function EditRiskPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])
  const riskRowId = useMemo(() => parseInt(params.id, 10), [params.id])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [risk, setRisk] = useState<Risk | null>(null)
  const [dept, setDept] = useState<RiskDept | null>(null)
  const [latestReviewId, setLatestReviewId] = useState<number | null>(null)
  const [latestCycle, setLatestCycle] = useState<number>(1)
  const [riskUserId, setRiskUserId] = useState<number | null>(null)
  const [actorRole, setActorRole] = useState<RiskRole>('RLO')

  const [form, setForm] = useState<FormState>({
    category: '', scope: '',
    description: '', cause_description: '', impact_description: '',
    existing_controls: '', additional_controls: '',
    action_owner: '', implementation_period: '', notes: '',
    likelihood: 0, impact_manusia: 0, impact_reputasi: 0,
    impact_kewangan: 0, impact_operasi: 0, impact_objektif: 0,
  })

  useEffect(() => { void load() }, [riskRowId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    if (!Number.isFinite(riskRowId)) { setLoadError('Invalid risk id'); setLoading(false); return }
    setLoading(true); setLoadError(null); setDenied(false)
    try {
      const res = await resolveCurrentRiskUser(supabase)
      if (!res.ok) {
        if (res.reason === 'not_logged_in') { router.push('/login'); return }
        throw new Error(res.message)
      }
      setRiskUserId(res.user.riskUserId)

      const { data: riskData, error: riskErr } = await supabase
        .from('risks').select('*').eq('id', riskRowId).maybeSingle()
      if (riskErr) throw new Error(`Risk: ${riskErr.code ?? ''} ${riskErr.message}`)
      if (!riskData) throw new Error('Risk not found.')
      const r = riskData as Risk
      setRisk(r)

      // Editability check: which role can edit at this status, scoped to dept
      const has = (roles: RiskRole[]) => res.user.roles.some((ur) =>
        roles.includes(ur.role) && (ur.dept_code === null || ur.dept_code === r.dept_code))
      let allowed = false
      if (r.status === 'DRAFT' && has(['RLO']))            { allowed = true; setActorRole('RLO') }
      else if (r.status === 'PENDING_HOD' && has(['HOD'])) { allowed = true; setActorRole('HOD') }
      else if (r.status === 'PENDING_RC' && has(['RC']))   { allowed = true; setActorRole('RC') }
      if (!allowed) { setDenied(true); return }

      const [{ data: deptData }, { data: reviewsData, error: rvErr }] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', r.dept_code).maybeSingle(),
        supabase.from('risk_reviews').select('*')
          .eq('risk_id', riskRowId).order('cycle_number', { ascending: false }),
      ])
      if (rvErr) throw new Error(`Reviews: ${rvErr.code ?? ''} ${rvErr.message}`)
      setDept(deptData as RiskDept | null)

      const latest = ((reviewsData ?? []) as RiskReview[])[0] ?? null
      setLatestReviewId(latest?.id ?? null)
      setLatestCycle(latest?.cycle_number ?? 1)

      setForm({
        category: r.category,
        scope: r.scope,
        description: r.description,
        cause_description: r.cause_description,
        impact_description: r.impact_description,
        existing_controls: r.existing_controls ?? '',
        additional_controls: r.additional_controls ?? '',
        action_owner: r.action_owner ?? '',
        implementation_period: r.implementation_period ?? '',
        notes: r.notes ?? '',
        likelihood:      latest?.likelihood ?? 0,
        impact_manusia:  latest?.impact_manusia ?? 0,
        impact_reputasi: latest?.impact_reputasi ?? 0,
        impact_kewangan: latest?.impact_kewangan ?? 0,
        impact_operasi:  latest?.impact_operasi ?? 0,
        impact_objektif: latest?.impact_objektif ?? 0,
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  const scoreInputs = form.likelihood > 0 &&
    form.impact_manusia > 0 && form.impact_reputasi > 0 && form.impact_kewangan > 0 &&
    form.impact_operasi > 0 && form.impact_objektif > 0
  const computed = scoreInputs
    ? computeRiskScore(form.likelihood, [
        form.impact_manusia, form.impact_reputasi, form.impact_kewangan,
        form.impact_operasi, form.impact_objektif])
    : null

  const errors: string[] = []
  if (!form.category) errors.push('Category is required')
  if (!form.scope) errors.push('Scope is required')
  if (!form.description.trim()) errors.push('Risk description is required')
  if (!form.cause_description.trim()) errors.push('Cause is required')
  if (!form.impact_description.trim()) errors.push('Impact is required')
  if (!scoreInputs) errors.push('All scoring inputs must be 1-5')
  const canSave = !submitting && errors.length === 0 && risk !== null && riskUserId !== null

  async function handleSave() {
    if (!canSave || !computed || !risk || !riskUserId) return
    setSubmitting(true); setSubmitError(null)
    try {
      const { error: upErr } = await supabase.from('risks').update({
        category: form.category,
        scope: form.scope,
        description: form.description.trim(),
        cause_description: form.cause_description.trim(),
        impact_description: form.impact_description.trim(),
        existing_controls: form.existing_controls.trim() || null,
        additional_controls: form.additional_controls.trim() || null,
        action_owner: form.action_owner.trim() || null,
        implementation_period: form.implementation_period.trim() || null,
        notes: form.notes.trim() || null,
      }).eq('id', risk.id)
      if (upErr) throw new Error(`Update risk: ${upErr.code ?? ''} ${upErr.message}`)

      // Overwrite the latest review's scores (or create cycle 1 if somehow none exists)
      if (latestReviewId) {
        const { error: rvErr } = await supabase.from('risk_reviews').update({
          likelihood: form.likelihood,
          impact_manusia: form.impact_manusia,
          impact_reputasi: form.impact_reputasi,
          impact_kewangan: form.impact_kewangan,
          impact_operasi: form.impact_operasi,
          impact_objektif: form.impact_objektif,
          avg_impact: computed.avgImpact,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
          reviewed_by: riskUserId,
          review_date: new Date().toISOString().slice(0, 10),
        }).eq('id', latestReviewId)
        if (rvErr) throw new Error(`Update review: ${rvErr.code ?? ''} ${rvErr.message}`)
      }

      await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk',
        entity_id: risk.id,
        action_type: 'AMEND',
        performed_by: riskUserId,
        user_role: actorRole,
        new_value: { risk_score: computed.riskScore, risk_level: computed.riskLevel, status: risk.status },
        comment: `Amended by ${actorRole} (cycle ${latestCycle} scoring updated)`,
      })

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
          <Link href="/risk" className="nav-item"><span className="nav-icon">⚠️</span><span>Risk Register</span></Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Edit Risk · <span style={{ fontFamily: 'monospace' }}>{risk?.risk_id ?? '…'}</span></div>
              <div className="tb-meta">
                {dept?.name_en ?? ''}{risk ? ` · status ${RISK_STATUS_LABEL[risk.status]} · editing as ${actorRole}` : ''}
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
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {denied && !loading && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Can&apos;t edit this risk</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {risk
                  ? `Editing is only allowed by the RLO (while DRAFT), the HOD (while Pending HOD), or RC (while Pending RC). This risk is currently "${RISK_STATUS_LABEL[risk.status]}".`
                  : 'You do not have permission to edit this risk.'}
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href={risk ? `/risk/${risk.id}` : '/risk'} className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to risk</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !denied && risk && (
            <form onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
              <div className="panel">
                <div className="pf"><div><div className="pt">Risk Details</div><div className="psub">Department: {dept?.name_en ?? risk.dept_code} · risk ID stays {risk.risk_id}</div></div></div>
                <div className="risk-form-grid">
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
                          <input type="radio" name="scope" value={s} checked={form.scope === s} onChange={() => set('scope', s)} />
                          {RISK_SCOPE_LABEL[s]}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Risk description" required full>
                    <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
                  </Field>
                  <Field label="Cause" required full>
                    <textarea rows={3} value={form.cause_description} onChange={(e) => set('cause_description', e.target.value)} />
                  </Field>
                  <Field label="Impact" required full>
                    <textarea rows={3} value={form.impact_description} onChange={(e) => set('impact_description', e.target.value)} />
                  </Field>
                  <Field label="Existing controls" full>
                    <textarea rows={2} value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)} />
                  </Field>
                  <Field label="Additional controls proposed" full>
                    <textarea rows={2} value={form.additional_controls} onChange={(e) => set('additional_controls', e.target.value)} />
                  </Field>
                  <Field label="Action owner">
                    <input type="text" value={form.action_owner} onChange={(e) => set('action_owner', e.target.value)} />
                  </Field>
                  <Field label="Implementation period">
                    <input type="text" value={form.implementation_period} onChange={(e) => set('implementation_period', e.target.value)} />
                  </Field>
                  <Field label="Notes" full>
                    <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                  </Field>
                </div>
              </div>

              <div className="panel">
                <div className="pf"><div><div className="pt">Risk Assessment (Cycle {latestCycle})</div><div className="psub">Re-score if needed. This overwrites the current cycle&apos;s scoring.</div></div></div>
                <div className="risk-form-grid">
                  <ScoreField label="Likelihood (Kebarangkalian)" value={form.likelihood} onChange={(v) => set('likelihood', v)} />
                  <ScoreField label="Impact: Manusia" value={form.impact_manusia} onChange={(v) => set('impact_manusia', v)} />
                  <ScoreField label="Impact: Reputasi" value={form.impact_reputasi} onChange={(v) => set('impact_reputasi', v)} />
                  <ScoreField label="Impact: Kewangan" value={form.impact_kewangan} onChange={(v) => set('impact_kewangan', v)} />
                  <ScoreField label="Impact: Operasi" value={form.impact_operasi} onChange={(v) => set('impact_operasi', v)} />
                  <ScoreField label="Impact: Objektif" value={form.impact_objektif} onChange={(v) => set('impact_objektif', v)} />
                </div>
                <div className="risk-score-preview">
                  {computed ? (
                    <>
                      <div className="rsp-block"><div className="rsp-label">Avg Impact</div><div className="rsp-value">{(Math.round(computed.avgImpact * 10) / 10).toFixed(1)}</div></div>
                      <div className="rsp-block"><div className="rsp-label">Risk Score</div><div className="rsp-value">{(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</div></div>
                      <div className="rsp-block"><div className="rsp-label">Risk Level</div>
                        <div className="rsp-value">
                          <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 4, fontSize: 14, fontWeight: 700,
                            color: RISK_LEVEL_COLOR[computed.riskLevel], background: RISK_LEVEL_BG[computed.riskLevel] }}>
                            {RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                        </div>
                      </div>
                    </>
                  ) : <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>Pick all 6 scoring inputs.</div>}
                </div>
              </div>

              <div className="panel">
                {errors.length > 0 && (
                  <div className="ac amber" style={{ marginBottom: 10 }}>
                    <div className="ai">!</div>
                    <div><div className="at">Form needs more info</div>
                      <ul className="as" style={{ margin: '4px 0 0 16px' }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                  </div>
                )}
                {submitError && (
                  <div className="ac red" style={{ marginBottom: 10 }}>
                    <div className="ai">⚠️</div><div><div className="at">Could not save</div><div className="as">{submitError}</div></div></div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Link href={`/risk/${risk.id}`} className="signout-btn">Cancel</Link>
                  <button type="submit" className="signout-btn"
                    style={{ background: canSave ? 'var(--blue)' : '#9CA3AF', color: '#fff', borderColor: canSave ? 'var(--blue)' : '#9CA3AF', cursor: canSave ? 'pointer' : 'not-allowed' }}
                    disabled={!canSave}>
                    {submitting ? 'Saving…' : '💾 Save changes'}
                  </button>
                </div>
              </div>
            </form>
          )}
        </main>
      </div>
    </div>
  )
}

function Field({ label, required, full, children }: {
  label: string; required?: boolean; full?: boolean; children: React.ReactNode
}) {
  return (
    <div className={`risk-field ${full ? 'full' : ''}`}>
      <label>{label}{required && <span style={{ color: 'var(--red)' }}> *</span>}</label>
      {children}
    </div>
  )
}

function ScoreField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="risk-field">
      <label>{label}<span style={{ color: 'var(--red)' }}> *</span></label>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}
