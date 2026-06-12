'use client'

/* RMCQ-mode quick-add — RC enters a paper-submitted risk on behalf of a
 * department. Gated to global-role users (Admin / RC / Director). Three
 * triage outcomes lead to three different save paths so EVERY paper that
 * crosses Fatim's desk gets a portal record with an outcome:
 *
 *   - Valid & complete     → status TABLED_RTC, cycle-1 review created.
 *   - Out of scope         → status OUT_OF_SCOPE with reason; archived.
 *   - Incomplete (paper)   → status DRAFT with clarification note; sits in
 *                            RC's intake queue until the dept supplies the
 *                            missing info on paper.
 *
 * All three carry entry_mode='rmcq_managed' and the paper-source metadata
 * (who submitted, who endorsed, dates, reference). Cycle-1 scoring is only
 * required for the Valid path. */

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { DeptOwnerPicker } from '@/components/DeptOwnerPicker'
import { RiskDept, RiskCategory, RiskScope } from '@/lib/risk/types'
import {
  computeRiskScore, formatRiskId,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_SCOPE_LABEL,
} from '@/lib/risk/scoring'

type Triage = 'valid' | 'out_of_scope' | 'incomplete'

interface FormState {
  triage: Triage
  // identification
  dept_code: string
  category: RiskCategory | ''
  scope: RiskScope | ''
  // description
  description: string
  cause_description: string
  impact_description: string
  // controls
  existing_controls: string
  additional_controls: string
  action_owner_depts: string[]
  implementation_period: string
  notes: string
  // scoring (Valid only)
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
  // paper source
  paper_submitted_by: string
  paper_submission_date: string
  paper_endorsed_by: string
  paper_endorsement_date: string
  paper_reference: string
  // triage-specific
  out_of_scope_reason: string
  clarification_note: string
}

const EMPTY: FormState = {
  triage: 'valid',
  dept_code: '', category: '', scope: '',
  description: '', cause_description: '', impact_description: '',
  existing_controls: '', additional_controls: '',
  action_owner_depts: [], implementation_period: '', notes: '',
  likelihood: 0,
  impact_manusia: 0, impact_reputasi: 0, impact_kewangan: 0,
  impact_operasi: 0, impact_objektif: 0,
  paper_submitted_by: '', paper_submission_date: '',
  paper_endorsed_by: '', paper_endorsement_date: '',
  paper_reference: '',
  out_of_scope_reason: '',
  clarification_note: '',
}

export default function QuickAddPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [depts, setDepts]   = useState<RiskDept[]>([])
  const [allDepts, setAllDepts] = useState<{ code: string; name_en: string }[]>([])
  const [riskUserId, setRiskUserId] = useState<number | null>(null)
  const [riskUserName, setRiskUserName] = useState<string>('')

  const [form, setForm] = useState<FormState>(EMPTY)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr) throw new Error(`Auth: ${userErr.message}`)
      if (!user) { router.push('/login'); return }

      // Gate: quick-add is RMCQ-only — global-role users (Admin/RC/Director).
      // getModuleAccess.allModules is the gate.
      const access = await getModuleAccess(supabase)
      if (!access.allModules || !access.riskUser) { setAccessDenied(true); return }
      setRiskUserId(access.riskUser.riskUserId)
      setRiskUserName(access.riskUser.name)

      // Departments — unrestricted (RC may enter on behalf of any dept).
      const { data: deptsData, error: deptsErr } = await supabase
        .from('pscs_departments')
        .select('code,risk_code,name_en,name_ms,kind,parent_code,sort_order')
        .not('risk_code', 'is', null)
        .eq('kind', 'department')
        .order('sort_order')
      if (deptsErr) throw new Error(`Departments: ${deptsErr.code ?? ''} ${deptsErr.message}`)
      setDepts((deptsData ?? []) as RiskDept[])
      setAllDepts(((deptsData ?? []) as RiskDept[]).map((d) => ({ code: d.code, name_en: d.name_en })))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  // Live risk-score preview (Valid path only)
  const scoreInputs = form.triage === 'valid' &&
    form.likelihood > 0 &&
    form.impact_manusia > 0 && form.impact_reputasi > 0 && form.impact_kewangan > 0 &&
    form.impact_operasi > 0 && form.impact_objektif > 0
  const computed = scoreInputs
    ? computeRiskScore(form.likelihood, [
        form.impact_manusia, form.impact_reputasi, form.impact_kewangan,
        form.impact_operasi, form.impact_objektif,
      ])
    : null

  // Validation — adapts to triage choice. Common requirements first.
  const errors: string[] = []
  if (!form.dept_code) errors.push('Department is required')
  if (!form.paper_submitted_by.trim()) errors.push('Paper: submitter name is required')
  if (!form.paper_submission_date) errors.push('Paper: submission date is required')

  // Common across triages: the dept's paper at minimum identifies a risk kind.
  if (!form.category) errors.push('Category is required')
  if (!form.scope) errors.push('Scope is required')
  if (!form.description.trim()) errors.push('Risk description is required')
  if (form.triage === 'valid') {
    if (!form.cause_description.trim()) errors.push('Cause is required')
    if (!form.impact_description.trim()) errors.push('Impact is required')
    if (!form.paper_endorsed_by.trim()) errors.push('Paper: HOD endorser is required')
    if (!form.paper_endorsement_date) errors.push('Paper: HOD endorsement date is required')
    if (!scoreInputs) errors.push('All scoring inputs (likelihood + 5 impacts) must be 1–5')
  } else if (form.triage === 'out_of_scope') {
    if (!form.out_of_scope_reason.trim()) errors.push('Reason for declining is required')
  } else if (form.triage === 'incomplete') {
    if (!form.clarification_note.trim()) errors.push('Clarification note is required (what to ask the dept for)')
  }

  const canSubmit = !submitting && errors.length === 0 && riskUserId !== null

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /* Build the paper-source object common to all three save paths. */
  function paperSourceFields() {
    return {
      paper_submitted_by: form.paper_submitted_by.trim() || null,
      paper_submission_date: form.paper_submission_date || null,
      paper_endorsed_by: form.paper_endorsed_by.trim() || null,
      paper_endorsement_date: form.paper_endorsement_date || null,
      paper_reference: form.paper_reference.trim() || null,
    }
  }

  function paperSummaryText(): string {
    const parts: string[] = []
    if (form.paper_submitted_by.trim()) parts.push(`submitted by ${form.paper_submitted_by.trim()}`)
    if (form.paper_submission_date) parts.push(`on ${form.paper_submission_date}`)
    if (form.paper_endorsed_by.trim()) parts.push(`HOD-endorsed by ${form.paper_endorsed_by.trim()}`)
    if (form.paper_endorsement_date) parts.push(`on ${form.paper_endorsement_date}`)
    if (form.paper_reference.trim()) parts.push(`ref: ${form.paper_reference.trim()}`)
    return parts.length ? parts.join(' · ') : 'no paper-source metadata'
  }

  async function handleSubmit() {
    if (!canSubmit || !riskUserId) return
    setSubmitting(true); setSubmitError(null)
    try {
      const dept = depts.find((d) => d.code === form.dept_code)
      if (!dept || !dept.risk_code) throw new Error('Selected department has no risk_code mapping.')
      const year = new Date().getFullYear()

      // Atomic risk_id allocation
      const { data: seqData, error: seqErr } = await supabase
        .rpc('next_risk_seq', { p_dept_code: form.dept_code, p_year: year })
      if (seqErr) throw new Error(`Sequence allocation: ${seqErr.code ?? ''} ${seqErr.message}`)
      const seq = seqData as number
      const risk_id = formatRiskId(dept.risk_code, year, seq)

      // Choose status + extras per triage
      let status: 'TABLED_RTC' | 'OUT_OF_SCOPE' | 'DRAFT'
      let triageExtras: Record<string, unknown> = {}
      let actionType: string
      let auditComment: string
      const paperSummary = paperSummaryText()

      if (form.triage === 'valid') {
        status = 'TABLED_RTC'
        actionType = 'PAPER_SUBMISSION_ENTERED'
        auditComment = `Paper submission entered by RC — ${paperSummary}; tabled for RTC`
      } else if (form.triage === 'out_of_scope') {
        status = 'OUT_OF_SCOPE'
        triageExtras = {
          rejection_reason: form.out_of_scope_reason.slice(0, 50),
          rejection_comment: form.out_of_scope_reason,
          rejected_by: riskUserId,
          rejected_at: new Date().toISOString(),
          // RMCQ-mode skips the in-portal RLO acknowledgment step; the dept is
          // notified on paper.
          pending_ack: false,
        }
        actionType = 'PAPER_SUBMISSION_OUT_OF_SCOPE'
        auditComment = `Paper submission entered by RC — ${paperSummary}; declined as out of scope: ${form.out_of_scope_reason.trim()}`
      } else {
        status = 'DRAFT'
        actionType = 'PAPER_SUBMISSION_INCOMPLETE'
        auditComment = `Paper submission entered by RC — ${paperSummary}; held as DRAFT awaiting clarification: ${form.clarification_note.trim()}`
      }

      // Build the risk insert payload. Common fields + triage extras.
      const insertPayload: Record<string, unknown> = {
        risk_id,
        dept_code: form.dept_code,
        created_by: riskUserId,
        category: form.category || null,
        scope: form.scope || null,
        description: form.description.trim(),
        cause_description: form.cause_description.trim() || '',
        impact_description: form.impact_description.trim() || '',
        existing_controls: form.existing_controls.trim() || null,
        additional_controls: form.additional_controls.trim() || null,
        action_owner: null,
        action_owner_depts: form.action_owner_depts.length ? form.action_owner_depts : null,
        implementation_period: form.implementation_period.trim() || null,
        notes: form.triage === 'incomplete'
          ? `[Awaiting clarification — ${form.clarification_note.trim()}]${form.notes.trim() ? `\n${form.notes.trim()}` : ''}`
          : (form.notes.trim() || null),
        status,
        entry_mode: 'rmcq_managed',
        ...paperSourceFields(),
        ...triageExtras,
      }

      // NOT NULL fallbacks for incomplete entries (cause/impact may be blank
      // when the dept only sent partial info). Category and scope are required
      // up front in validation.
      if (!form.cause_description.trim()) insertPayload.cause_description = '(awaiting clarification)'
      if (!form.impact_description.trim()) insertPayload.impact_description = '(awaiting clarification)'

      const { data: insertedRisk, error: riskErr } = await supabase
        .from('risks').insert(insertPayload).select('id').single()
      if (riskErr) throw new Error(`Insert risk: ${riskErr.code ?? ''} ${riskErr.message}`)
      const newRiskRowId = insertedRisk.id as number

      // Cycle-1 review — only for Valid (we have scoring). The other paths
      // create their review when the dept supplies the data on paper.
      if (form.triage === 'valid' && computed) {
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
            // Cycle-1 paper source is the same as the original submission.
            paper_reviewed_by: form.paper_submitted_by.trim() || null,
            paper_review_date: form.paper_submission_date || null,
            paper_endorsed_by: form.paper_endorsed_by.trim() || null,
            paper_endorsement_date: form.paper_endorsement_date || null,
            paper_reference: form.paper_reference.trim() || null,
          })
        if (reviewErr) throw new Error(`Insert review: ${reviewErr.code ?? ''} ${reviewErr.message}`)
      }

      // Audit log
      await supabase.from('risk_audit_logs').insert({
        risk_id: newRiskRowId,
        entity_type: 'risk',
        entity_id: newRiskRowId,
        action_type: actionType,
        performed_by: riskUserId,
        user_role: 'RC',
        new_value: { risk_id, status, entry_mode: 'rmcq_managed', triage: form.triage, dept_code: form.dept_code },
        comment: auditComment,
      })

      router.push(`/risk/${newRiskRowId}`)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  /* UI ----------------------------------------------------------------- */
  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="quickadd" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Quick Add (Paper Submission)</div>
              <div className="tb-meta">
                Entering on behalf · RMCQ {riskUserName ? `· ${riskUserName}` : ''}
              </div>
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
              <div><div className="at">Load error</div><div className="as">{loadError}</div></div>
            </div>
          )}
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && !loading && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Quick-add is RMCQ-only</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Only hospital-wide roles (Admin, Risk Coordinator, Director) can enter paper submissions on behalf of departments.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
              {/* Triage */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Triage — what does this paper look like?</div>
                  <div className="psub">Picks the save path. All three are entered in the portal so the audit trail is complete.</div>
                </div></div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <TriageOption v="valid" cur={form.triage} onSet={(t) => set('triage', t)}
                    title="✓ Valid & complete"
                    desc="Goes onto the next RTC agenda as Tabled for RTC."
                    accent="#1D4ED8" />
                  <TriageOption v="out_of_scope" cur={form.triage} onSet={(t) => set('triage', t)}
                    title="✗ Out of scope"
                    desc="Recorded with a reason and archived. RC can reopen later."
                    accent="#B91C1C" />
                  <TriageOption v="incomplete" cur={form.triage} onSet={(t) => set('triage', t)}
                    title="… Incomplete — needs clarification"
                    desc="Held as Draft with a clarification note. Waits for the dept to send the missing info."
                    accent="#92400E" />
                </div>
              </div>

              {/* Identification */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">1. Risk Identification</div>
                  <div className="psub">Department, category, and scope as on the paper Borang.</div>
                </div></div>
                <div className="risk-form-grid">
                  <Field label="Department" required>
                    <select value={form.dept_code} onChange={(e) => set('dept_code', e.target.value)}>
                      <option value="">— pick a department —</option>
                      {depts.map((d) => <option key={d.code} value={d.code}>{d.name_en}</option>)}
                    </select>
                  </Field>
                  <Field label="Category" required={form.triage === 'valid'}>
                    <select value={form.category} onChange={(e) => set('category', e.target.value as RiskCategory)}>
                      <option value="">— pick a category —</option>
                      {(Object.keys(RISK_CATEGORY_LABEL) as RiskCategory[]).map((c) => (
                        <option key={c} value={c}>{c} — {RISK_CATEGORY_LABEL[c]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Scope" required={form.triage === 'valid'}>
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

              {/* Description */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">2. Risk Description</div>
                  <div className="psub">
                    {form.triage === 'incomplete'
                      ? 'Capture what the dept submitted so far — gaps are fine, you can fill them in when the dept replies.'
                      : 'Transcribe what the dept wrote on the Borang.'}
                  </div>
                </div></div>
                <div className="risk-form-grid">
                  <Field label="Risk description" required full>
                    <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
                  </Field>
                  <Field label="Cause" required={form.triage === 'valid'} full>
                    <textarea rows={3} value={form.cause_description} onChange={(e) => set('cause_description', e.target.value)} />
                  </Field>
                  <Field label="Impact" required={form.triage === 'valid'} full>
                    <textarea rows={3} value={form.impact_description} onChange={(e) => set('impact_description', e.target.value)} />
                  </Field>
                </div>
              </div>

              {/* Controls — only for Valid path */}
              {form.triage === 'valid' && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">3. Controls &amp; Treatment</div>
                    <div className="psub">As proposed on the Borang. The action owner is the responsible department(s).</div>
                  </div></div>
                  <div className="risk-form-grid">
                    <Field label="Existing controls" full>
                      <textarea rows={2} value={form.existing_controls} onChange={(e) => set('existing_controls', e.target.value)} />
                    </Field>
                    <Field label="Additional controls proposed" full>
                      <textarea rows={2} value={form.additional_controls} onChange={(e) => set('additional_controls', e.target.value)} />
                    </Field>
                    <Field label="Action owner (department)" hint="One or more departments responsible for the action.">
                      <DeptOwnerPicker depts={allDepts} value={form.action_owner_depts}
                        onChange={(codes) => set('action_owner_depts', codes)} />
                    </Field>
                    <Field label="Implementation period" hint="Optional — e.g. Q3 2026, by 31 Dec 2026, Ongoing, Pending external party.">
                      <input type="text" value={form.implementation_period} onChange={(e) => set('implementation_period', e.target.value)} />
                    </Field>
                    <Field label="Notes" full>
                      <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}

              {/* Initial scoring — only for Valid path */}
              {form.triage === 'valid' && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">4. Initial Assessment (Cycle 1)</div>
                    <div className="psub">From the dept&apos;s scoring on the Borang. Risk score updates live below.</div>
                  </div></div>
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
              )}

              {/* Triage-specific inputs */}
              {form.triage === 'out_of_scope' && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">Reason for declining</div>
                    <div className="psub">Shown on the audit log and the archive entry. Required.</div>
                  </div></div>
                  <Field label="Why is this out of scope for the register?" required full>
                    <textarea rows={3} value={form.out_of_scope_reason}
                      onChange={(e) => set('out_of_scope_reason', e.target.value)} />
                  </Field>
                </div>
              )}
              {form.triage === 'incomplete' && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">Clarification needed</div>
                    <div className="psub">What needs to come back from the dept on paper. Saved on the Draft so you remember why it&apos;s waiting.</div>
                  </div></div>
                  <Field label="Clarification note" required full>
                    <textarea rows={3} value={form.clarification_note}
                      onChange={(e) => set('clarification_note', e.target.value)}
                      placeholder="e.g. Missing HOD endorsement signature; needs cycle-1 scoring." />
                  </Field>
                </div>
              )}

              {/* Paper source */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Paper Source · audit trail</div>
                  <div className="psub">Who sent the form, who signed it, when. Stored on every record so the paper trail is reconstructable later.</div>
                </div></div>
                <div className="risk-form-grid">
                  <Field label="Submitted by (RLO name)" required>
                    <input type="text" value={form.paper_submitted_by}
                      onChange={(e) => set('paper_submitted_by', e.target.value)}
                      placeholder="e.g. Dr Suk Hui" />
                  </Field>
                  <Field label="Submission date" required>
                    <input type="date" value={form.paper_submission_date}
                      onChange={(e) => set('paper_submission_date', e.target.value)} />
                  </Field>
                  <Field label="HOD endorser" required={form.triage === 'valid'}>
                    <input type="text" value={form.paper_endorsed_by}
                      onChange={(e) => set('paper_endorsed_by', e.target.value)}
                      placeholder="e.g. Dr Rosnida" />
                  </Field>
                  <Field label="HOD endorsement date" required={form.triage === 'valid'}>
                    <input type="date" value={form.paper_endorsement_date}
                      onChange={(e) => set('paper_endorsement_date', e.target.value)} />
                  </Field>
                  <Field label="Paper reference" full
                    hint="Optional — form number, scanned file location, or any note about where the physical paper lives.">
                    <input type="text" value={form.paper_reference}
                      onChange={(e) => set('paper_reference', e.target.value)}
                      placeholder="e.g. Borang RMK-2026-018; filed in RMCQ cabinet" />
                  </Field>
                </div>
              </div>

              {/* Submit */}
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
                    style={{
                      background: canSubmit ? 'var(--blue)' : '#9CA3AF',
                      color: '#fff',
                      borderColor: canSubmit ? 'var(--blue)' : '#9CA3AF',
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                    }}
                    disabled={!canSubmit}>
                    {submitting ? 'Saving…' : form.triage === 'valid' ? '✓ Save & table for RTC'
                      : form.triage === 'out_of_scope' ? '✗ Save & archive (out of scope)'
                      : '… Save as Draft (awaiting clarification)'}
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

/* -------- Small form helpers (same shape as /risk/new) -------- */

function Field({ label, required, hint, full, children }: {
  label: string
  required?: boolean
  hint?: string
  full?: boolean
  children: React.ReactNode
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
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`}
            onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}

function TriageOption({ v, cur, onSet, title, desc, accent }: {
  v: Triage; cur: Triage; onSet: (t: Triage) => void
  title: string; desc: string; accent: string
}) {
  const active = cur === v
  return (
    <label style={{
      flex: '1 1 240px', minWidth: 220, cursor: 'pointer',
      border: `2px solid ${active ? accent : 'var(--border)'}`,
      background: active ? `${accent}10` : '#fff',
      borderRadius: 10, padding: '12px 14px',
      transition: 'border-color .12s ease, background .12s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input type="radio" name="triage" checked={active} onChange={() => onSet(v)} style={{ marginTop: 3 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: active ? accent : 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{desc}</div>
        </div>
      </div>
    </label>
  )
}
