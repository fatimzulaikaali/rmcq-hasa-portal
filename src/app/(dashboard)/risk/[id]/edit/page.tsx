'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { DeptOwnerPicker } from '@/components/DeptOwnerPicker'
import { Risk, RiskReview, RiskDept, RiskNature, TreatmentOption, RiskScope, RiskRole } from '@/lib/risk/types'
import { resolveCurrentRiskUser } from '@/lib/risk/auth'
import { resolveActiveRole } from '@/lib/risk/activeRole'
import {
  computeSeverityScore,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_NATURE_LABEL, TREATMENT_OPTION_LABEL, RISK_SCOPE_LABEL, RISK_STATUS_LABEL,
} from '@/lib/risk/scoring'

interface FormState {
  context: string
  risk_nature: RiskNature | ''
  treatment_option: TreatmentOption | ''
  scope: RiskScope | ''
  description: string
  cause_description: string
  impact_description: string
  existing_controls: string
  additional_controls: string
  action_owner_depts: string[]
  implementation_period: string
  notes: string
  likelihood: number
  severity: number
  residual_likelihood: number
  residual_severity: number
}

/* Human labels for the editable fields, used to describe an amendment in the
 * audit log (so it reads "updated risk description, controls" rather than the
 * old hard-coded "scoring updated"). */
const FIELD_LABEL: Partial<Record<keyof FormState, string>> = {
  context: 'context',
  risk_nature: 'nature',
  treatment_option: 'treatment option',
  scope: 'scope',
  description: 'risk description',
  cause_description: 'cause',
  impact_description: 'consequence',
  existing_controls: 'existing controls',
  additional_controls: 'additional controls',
  action_owner_depts: 'action owner',
  implementation_period: 'implementation period',
  notes: 'notes',
}
const SCORE_KEYS: (keyof FormState)[] = [
  'likelihood', 'severity', 'residual_likelihood', 'residual_severity',
]

function sameVal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return (a ?? '') === (b ?? '')
}
function changedFields(orig: FormState | null, form: FormState): string[] {
  if (!orig) return []
  const out: string[] = []
  for (const k of Object.keys(FIELD_LABEL) as (keyof FormState)[]) {
    if (!sameVal(form[k], orig[k])) out.push(FIELD_LABEL[k]!)
  }
  if (SCORE_KEYS.some((k) => form[k] !== orig[k])) out.push('scoring')
  return out
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
  const [allDepts, setAllDepts] = useState<{ code: string; name_en: string }[]>([])
  const [orig, setOrig] = useState<FormState | null>(null)

  const [form, setForm] = useState<FormState>({
    context: '', risk_nature: '', treatment_option: '', scope: '',
    description: '', cause_description: '', impact_description: '',
    existing_controls: '', additional_controls: '',
    action_owner_depts: [], implementation_period: '', notes: '',
    likelihood: 0, severity: 0, residual_likelihood: 0, residual_severity: 0,
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

      // Editability check: gated on the user's single ACTIVE role (the hat they
      // chose in the account switcher), not the union of all their roles. The
      // active role must match the role allowed to edit at this status and be
      // either hospital-wide or scoped to this risk's dept.
      const active = resolveActiveRole(res.user.roles)
      const has = (roles: RiskRole[]) => !!active &&
        roles.includes(active.role) &&
        (active.dept_code === null || active.dept_code === r.dept_code)
      let allowed = false
      if (r.status === 'DRAFT' && has(['RLO']))            { allowed = true; setActorRole('RLO') }
      else if (r.status === 'PENDING_HOD' && has(['HOD'])) { allowed = true; setActorRole('HOD') }
      else if (r.status === 'PENDING_RC' && has(['RC']))   { allowed = true; setActorRole('RC') }
      if (!allowed) { setDenied(true); return }

      const [{ data: deptData }, { data: reviewsData, error: rvErr }, { data: allDeptsData }] = await Promise.all([
        supabase.from('pscs_departments')
          .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
          .eq('code', r.dept_code).maybeSingle(),
        supabase.from('risk_reviews').select('*')
          .eq('risk_id', riskRowId).order('cycle_number', { ascending: false }),
        supabase.from('pscs_departments').select('code,name_en')
          .eq('kind', 'department').not('risk_code', 'is', null).order('name_en'),
      ])
      if (rvErr) throw new Error(`Reviews: ${rvErr.code ?? ''} ${rvErr.message}`)
      setDept(deptData as RiskDept | null)
      setAllDepts((allDeptsData ?? []) as { code: string; name_en: string }[])

      const latest = ((reviewsData ?? []) as RiskReview[])[0] ?? null
      setLatestReviewId(latest?.id ?? null)
      setLatestCycle(latest?.cycle_number ?? 1)

      const initial: FormState = {
        context: r.context ?? '',
        risk_nature: r.risk_nature ?? '',
        treatment_option: r.treatment_option ?? '',
        scope: r.scope,
        description: r.description,
        cause_description: r.cause_description,
        impact_description: r.impact_description,
        existing_controls: r.existing_controls ?? '',
        additional_controls: r.additional_controls ?? '',
        action_owner_depts: r.action_owner_depts ?? [],
        implementation_period: r.implementation_period ?? '',
        notes: r.notes ?? '',
        likelihood:          latest?.likelihood ?? 0,
        severity:            latest?.severity ?? 0,
        residual_likelihood: latest?.residual_likelihood ?? 0,
        residual_severity:   latest?.residual_severity ?? 0,
      }
      setForm(initial)
      setOrig(initial)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  const scoreInputs = form.likelihood > 0 && form.severity > 0
  const computed = scoreInputs
    ? computeSeverityScore(form.likelihood, form.severity)
    : null
  const hasResidual = form.residual_likelihood > 0 && form.residual_severity > 0
  const residual = hasResidual
    ? computeSeverityScore(form.residual_likelihood, form.residual_severity)
    : null

  const errors: string[] = []
  if (!form.context.trim()) errors.push('Context is required')
  if (!form.risk_nature) errors.push('Risk nature is required')
  if (!form.scope) errors.push('Scope is required')
  if (!form.description.trim()) errors.push('Risk description is required')
  if (!form.cause_description.trim()) errors.push('Cause is required')
  if (!form.impact_description.trim()) errors.push('Consequence is required')
  if (!scoreInputs) errors.push('Likelihood and Severity must both be 1-5')
  const canSave = !submitting && errors.length === 0 && risk !== null && riskUserId !== null

  async function handleSave() {
    if (!canSave || !computed || !risk || !riskUserId) return
    setSubmitting(true); setSubmitError(null)
    try {
      // Work out what actually changed, so the audit entry is honest (the old
      // code always claimed "scoring updated" even on a description-only edit).
      const changed = changedFields(orig, form)
      const scoringChanged = !orig || SCORE_KEYS.some((k) => form[k] !== orig[k])

      const { error: upErr } = await supabase.from('risks').update({
        context: form.context.trim(),
        risk_nature: form.risk_nature || null,
        treatment_option: form.treatment_option || null,
        scope: form.scope,
        description: form.description.trim(),
        cause_description: form.cause_description.trim(),
        impact_description: form.impact_description.trim(),
        existing_controls: form.existing_controls.trim() || null,
        additional_controls: form.additional_controls.trim() || null,
        action_owner: null,
        action_owner_depts: form.action_owner_depts.length ? form.action_owner_depts : null,
        implementation_period: form.implementation_period.trim() || null,
        notes: form.notes.trim() || null,
      }).eq('id', risk.id)
      if (upErr) throw new Error(`Update risk: ${upErr.code ?? ''} ${upErr.message}`)

      // Only touch the review row when the scoring actually changed — otherwise a
      // text-only amendment would needlessly re-stamp the reviewer + date.
      if (latestReviewId && scoringChanged) {
        const { error: rvErr } = await supabase.from('risk_reviews').update({
          likelihood: form.likelihood,
          severity: form.severity,
          risk_score: computed.riskScore,
          risk_level: computed.riskLevel,
          residual_likelihood: hasResidual ? form.residual_likelihood : null,
          residual_severity: hasResidual ? form.residual_severity : null,
          residual_score: residual ? residual.riskScore : null,
          residual_level: residual ? residual.riskLevel : null,
          reviewed_by: riskUserId,
          review_date: new Date().toISOString().slice(0, 10),
        }).eq('id', latestReviewId)
        if (rvErr) throw new Error(`Update review: ${rvErr.code ?? ''} ${rvErr.message}`)
      }

      const summary = changed.length ? `updated ${changed.join(', ')}` : 'no field changes'
      await supabase.from('risk_audit_logs').insert({
        risk_id: risk.id,
        entity_type: 'risk',
        entity_id: risk.id,
        action_type: 'AMEND',
        performed_by: riskUserId,
        user_role: actorRole,
        new_value: { changed, risk_score: computed.riskScore, risk_level: computed.riskLevel, status: risk.status },
        comment: `Amended by ${actorRole} — ${summary}`,
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
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="risk" />

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

        <main className="tab-pane risk-skin">
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
                  <Field label="Context" required full hint="Free-text context as the department sees it. The Risk Coordinator maps this to a UiTM domain later.">
                    <textarea rows={2} value={form.context} onChange={(e) => set('context', e.target.value)}
                      placeholder="e.g. Patient safety during medication dispensing" />
                  </Field>
                  <Field label="Risk nature" required>
                    <div style={{ display: 'flex', gap: 12 }}>
                      {(Object.keys(RISK_NATURE_LABEL) as RiskNature[]).map((n) => (
                        <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <input type="radio" name="risk_nature" value={n} checked={form.risk_nature === n} onChange={() => set('risk_nature', n)} />
                          {RISK_NATURE_LABEL[n]}
                        </label>
                      ))}
                    </div>
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
                  <Field label="Consequence" required full>
                    <textarea rows={3} value={form.impact_description} onChange={(e) => set('impact_description', e.target.value)} />
                  </Field>
                  <Field label="Existing controls" full>
                    <textarea rows={2} value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)} />
                  </Field>
                  <Field label="Treatment option" hint="Avoid / Transfer / Control / Accept — the chosen response to this risk.">
                    <select value={form.treatment_option} onChange={(e) => set('treatment_option', e.target.value as TreatmentOption)}>
                      <option value="">— pick a treatment —</option>
                      {(Object.keys(TREATMENT_OPTION_LABEL) as TreatmentOption[]).map((t) => (
                        <option key={t} value={t}>{TREATMENT_OPTION_LABEL[t]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Additional controls proposed" full>
                    <textarea rows={2} value={form.additional_controls} onChange={(e) => set('additional_controls', e.target.value)} />
                  </Field>
                  <Field label="Action owner (department)" hint="Department(s) responsible for the action — add more than one if it's shared or sits with another department.">
                    <DeptOwnerPicker depts={allDepts} value={form.action_owner_depts}
                      onChange={(codes) => set('action_owner_depts', codes)} />
                  </Field>
                  <Field label="Implementation period" hint="Optional. A date, quarter, or free text like “Ongoing” or “Pending external party”.">
                    <input type="text" value={form.implementation_period} onChange={(e) => set('implementation_period', e.target.value)}
                      placeholder="e.g. Q3 2026, by 31 Dec 2026, Ongoing, Pending external party" />
                  </Field>
                  <Field label="Notes" full>
                    <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                  </Field>
                </div>
              </div>

              <div className="panel">
                <div className="pf"><div><div className="pt">Risk Assessment (Cycle {latestCycle})</div><div className="psub">Re-score if needed. Risk Rating = Likelihood × Severity. This overwrites the current cycle&apos;s scoring.</div></div></div>
                <div className="risk-form-grid">
                  <ScoreField label="Likelihood" value={form.likelihood} onChange={(v) => set('likelihood', v)} />
                  <ScoreField label="Severity" value={form.severity} onChange={(v) => set('severity', v)} />
                </div>
                <div className="risk-score-preview">
                  {computed ? (
                    <>
                      <div className="rsp-block"><div className="rsp-label">Likelihood</div><div className="rsp-value">{form.likelihood}</div></div>
                      <div className="rsp-block"><div className="rsp-label">Severity</div><div className="rsp-value">{form.severity}</div></div>
                      <div className="rsp-block"><div className="rsp-label">Risk Score</div><div className="rsp-value">{computed.riskScore}</div></div>
                      <div className="rsp-block"><div className="rsp-label">Risk Level</div>
                        <div className="rsp-value">
                          <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 4, fontSize: 14, fontWeight: 700,
                            color: RISK_LEVEL_COLOR[computed.riskLevel], background: RISK_LEVEL_BG[computed.riskLevel] }}>
                            {RISK_LEVEL_LABEL[computed.riskLevel]}</span>
                        </div>
                      </div>
                    </>
                  ) : <div style={{ color: 'var(--muted)', fontSize: 13, fontStyle: 'italic' }}>Pick both Likelihood and Severity.</div>}
                </div>
              </div>

              <div className="panel">
                <div className="pf"><div><div className="pt">Residual Risk (optional)</div><div className="psub">Expected rating after the proposed controls are in place. Leave blank if not yet assessed.</div></div></div>
                <div className="risk-form-grid">
                  <ScoreFieldOptional label="Residual Likelihood" value={form.residual_likelihood} onChange={(v) => set('residual_likelihood', v)} />
                  <ScoreFieldOptional label="Residual Severity" value={form.residual_severity} onChange={(v) => set('residual_severity', v)} />
                </div>
                {residual && (
                  <div className="risk-score-preview">
                    <div className="rsp-block"><div className="rsp-label">Residual Score</div><div className="rsp-value">{residual.riskScore}</div></div>
                    <div className="rsp-block"><div className="rsp-label">Residual Level</div>
                      <div className="rsp-value">
                        <span style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 4, fontSize: 14, fontWeight: 700,
                          color: RISK_LEVEL_COLOR[residual.riskLevel], background: RISK_LEVEL_BG[residual.riskLevel] }}>
                          {RISK_LEVEL_LABEL[residual.riskLevel]}</span>
                      </div>
                    </div>
                  </div>
                )}
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

function Field({ label, required, full, hint, children }: {
  label: string; required?: boolean; full?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div className={`risk-field ${full ? 'full' : ''}`}>
      <label>{label}{required && <span style={{ color: 'var(--red)' }}> *</span>}</label>
      {children}
      {hint && <div className="risk-field-hint">{hint}</div>}
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

function ScoreFieldOptional({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="risk-field">
      <label>{label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`}
            onClick={() => onChange(value === n ? 0 : n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}
