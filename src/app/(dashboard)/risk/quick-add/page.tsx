'use client'

/* Log Risk (paper) — the Coordinator records a department's paper/PDF risk
 * register (Form 0044). One register = one department, MANY risks. Rebuilt
 * 2026 to match Fatim's forms:
 *
 *   - Register header (dept + review date + reference) applies to every risk.
 *   - Each risk block: context / nature / description / consequence / existing
 *     control → Current Risk (L×S) → Treatment option → optional inline RTP
 *     (Form 0045) → Residual Risk (independent L×S).
 *   - Per-risk Committee outcome (stage, escalation, RTC/ROC refs, notes,
 *     Submit-to-ERMS) since the Coordinator logs risks that already went to
 *     committee on paper.
 *   - Register-level sign-off (RLO prepared / HOD approved).
 *
 * Departments do NOT log in — the whole portal is the Coordinator's monitoring
 * tool; departments communicate on paper / outside the portal. */

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { DeptSearchPicker } from '@/components/DeptSearchPicker'
import {
  RiskDept, RiskNature, TreatmentOption, RiskStatus,
  RtpAdequacy, RtpTaskStatus,
} from '@/lib/risk/types'
import {
  computeSeverityScore, formatRiskId,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_NATURE_LABEL, TREATMENT_OPTION_LABEL,
} from '@/lib/risk/scoring'

type CommitteeStage = 'NOT_TABLED' | 'TABLED_RTC' | 'ENDORSED_ROC' | 'SENT_BACK' | 'RECOMMEND_CLOSE'
type EscalationType = 'AUTO' | 'MANUAL' | 'NONE'

const STAGE_LABEL: Record<CommitteeStage, string> = {
  NOT_TABLED:      'Not yet tabled',
  TABLED_RTC:      'Tabled at RTC',
  ENDORSED_ROC:    'Endorsed at ROC → Active',
  SENT_BACK:       'Sent back to department',
  RECOMMEND_CLOSE: 'Recommend closure',
}

function stageToStatus(stage: CommitteeStage): RiskStatus {
  switch (stage) {
    case 'NOT_TABLED':      return 'TABLED_RTC'
    case 'TABLED_RTC':      return 'TABLED_RTC'
    case 'ENDORSED_ROC':    return 'ACTIVE'
    case 'SENT_BACK':       return 'RETURNED'
    case 'RECOMMEND_CLOSE': return 'PENDING_CLOSURE'
  }
}

interface TaskRow { task: string; pic: string; due: string; status: RtpTaskStatus }

interface RiskBlock {
  context: string
  risk_nature: RiskNature | ''
  description: string
  cause_description: string
  impact_description: string
  existing_controls: string
  treatment_option: TreatmentOption | ''
  additional_controls: string          // brief control / refer to RTP #
  likelihood: number
  severity: number
  residual_likelihood: number
  residual_severity: number
  // inline RTP (Form 0045)
  rtpOpen: boolean
  rtp_new_control: string
  rtp_adequacy: RtpAdequacy | ''
  rtp_tasks: TaskRow[]
  // committee outcome
  committee_stage: CommitteeStage
  escalation_type: EscalationType
  rtc_ref: string
  roc_ref: string
  committee_notes: string
  submit_to_erms: boolean
}

function emptyRisk(): RiskBlock {
  return {
    context: '', risk_nature: '', description: '',
    cause_description: '', impact_description: '', existing_controls: '',
    treatment_option: '', additional_controls: '',
    likelihood: 0, severity: 0, residual_likelihood: 0, residual_severity: 0,
    rtpOpen: false, rtp_new_control: '', rtp_adequacy: '',
    rtp_tasks: [{ task: '', pic: '', due: '', status: 'NOT_STARTED' }],
    committee_stage: 'NOT_TABLED', escalation_type: 'NONE',
    rtc_ref: '', roc_ref: '', committee_notes: '', submit_to_erms: false,
  }
}

export default function LogRiskPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [depts, setDepts] = useState<RiskDept[]>([])
  const [allDepts, setAllDepts] = useState<{ code: string; name_en: string }[]>([])
  const [riskUserId, setRiskUserId] = useState<number | null>(null)
  const [riskUserName, setRiskUserName] = useState<string>('')

  // register header + sign-off
  const [deptCode, setDeptCode] = useState('')
  const [reviewDate, setReviewDate] = useState('')
  const [registerRef, setRegisterRef] = useState('')
  const [preparedName, setPreparedName] = useState('')
  const [preparedDesig, setPreparedDesig] = useState('')
  const [preparedDate, setPreparedDate] = useState('')
  const [approvedName, setApprovedName] = useState('')
  const [approvedDesig, setApprovedDesig] = useState('')
  const [approvedDate, setApprovedDate] = useState('')

  const [risks, setRisks] = useState<RiskBlock[]>([emptyRisk()])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr) throw new Error(`Auth: ${userErr.message}`)
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.allModules || !access.riskUser) { setAccessDenied(true); return }
      setRiskUserId(access.riskUser.riskUserId)
      setRiskUserName(access.riskUser.name)

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

  function updateRisk(i: number, patch: Partial<RiskBlock>) {
    setRisks((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function updateTask(ri: number, ti: number, patch: Partial<TaskRow>) {
    setRisks((prev) => prev.map((r, idx) => {
      if (idx !== ri) return r
      return { ...r, rtp_tasks: r.rtp_tasks.map((t, tIdx) => (tIdx === ti ? { ...t, ...patch } : t)) }
    }))
  }
  function addTask(ri: number) {
    setRisks((prev) => prev.map((r, idx) => (idx === ri
      ? { ...r, rtp_tasks: [...r.rtp_tasks, { task: '', pic: '', due: '', status: 'NOT_STARTED' }] }
      : r)))
  }
  function addRisk() { setRisks((prev) => [...prev, emptyRisk()]) }
  function removeRisk(i: number) { setRisks((prev) => prev.filter((_, idx) => idx !== i)) }

  // Validation
  const errors: string[] = []
  if (!deptCode) errors.push('Department is required')
  if (!reviewDate) errors.push('Date of review is required')
  risks.forEach((r, i) => {
    const n = i + 1
    if (!r.context.trim()) errors.push(`Risk ${n}: context is required`)
    if (!r.description.trim()) errors.push(`Risk ${n}: description is required`)
    if (!r.impact_description.trim()) errors.push(`Risk ${n}: consequence is required`)
    if (!r.risk_nature) errors.push(`Risk ${n}: actual/potential is required`)
    if (!(r.likelihood > 0 && r.severity > 0)) errors.push(`Risk ${n}: current likelihood & severity (1–5)`)
    if (!r.treatment_option) errors.push(`Risk ${n}: treatment option is required`)
  })
  const canSubmit = !submitting && errors.length === 0 && riskUserId !== null

  async function handleSubmit() {
    if (!canSubmit || !riskUserId) return
    setSubmitting(true); setSubmitError(null)
    try {
      const dept = depts.find((d) => d.code === deptCode)
      if (!dept || !dept.risk_code) throw new Error('Selected department has no risk_code mapping.')
      const year = new Date().getFullYear()

      const preparedBy = preparedName.trim()
        ? `${preparedName.trim()}${preparedDesig.trim() ? ` (${preparedDesig.trim()})` : ''}`
        : null
      const approvedBy = approvedName.trim()
        ? `${approvedName.trim()}${approvedDesig.trim() ? ` (${approvedDesig.trim()})` : ''}`
        : null

      let firstNewId: number | null = null

      for (const r of risks) {
        const { data: seqData, error: seqErr } = await supabase
          .rpc('next_risk_seq', { p_dept_code: deptCode, p_year: year })
        if (seqErr) throw new Error(`Sequence allocation: ${seqErr.code ?? ''} ${seqErr.message}`)
        const risk_id = formatRiskId(dept.risk_code, year, seqData as number)

        const isAccept = r.treatment_option === 'ACCEPT'
        const status = stageToStatus(r.committee_stage)

        const { data: insertedRisk, error: riskErr } = await supabase
          .from('risks').insert({
            risk_id,
            dept_code: deptCode,
            created_by: riskUserId,
            context: r.context.trim(),
            risk_nature: r.risk_nature || null,
            treatment_option: r.treatment_option || null,
            scope: 'UNIT',
            description: r.description.trim(),
            cause_description: r.cause_description.trim() || '',
            impact_description: r.impact_description.trim() || '',
            existing_controls: r.existing_controls.trim() || null,
            additional_controls: r.additional_controls.trim() || null,
            status,
            entry_mode: 'rmcq_managed',
            register_review_date: reviewDate || null,
            paper_reference: registerRef.trim() || null,
            paper_submitted_by: preparedBy,
            paper_submission_date: preparedDate || null,
            paper_endorsed_by: approvedBy,
            paper_endorsement_date: approvedDate || null,
            committee_stage: r.committee_stage,
            escalation_type: r.escalation_type,
            rtc_ref: r.rtc_ref.trim() || null,
            roc_ref: r.roc_ref.trim() || null,
            committee_notes: r.committee_notes.trim() || null,
            submit_to_erms: r.submit_to_erms,
          }).select('id').single()
        if (riskErr) throw new Error(`Insert risk: ${riskErr.code ?? ''} ${riskErr.message}`)
        const newRiskRowId = insertedRisk.id as number
        if (firstNewId === null) firstNewId = newRiskRowId

        // cycle-1 review with current + residual scoring
        const cur = computeSeverityScore(r.likelihood, r.severity)
        const hasResidual = r.residual_likelihood > 0 && r.residual_severity > 0
        const res = hasResidual ? computeSeverityScore(r.residual_likelihood, r.residual_severity) : null
        const { error: reviewErr } = await supabase.from('risk_reviews').insert({
          risk_id: newRiskRowId,
          cycle_number: 1,
          reviewed_by: riskUserId,
          review_date: new Date().toISOString().slice(0, 10),
          likelihood: r.likelihood,
          severity: r.severity,
          risk_score: cur.riskScore,
          risk_level: cur.riskLevel,
          residual_likelihood: hasResidual ? r.residual_likelihood : null,
          residual_severity: hasResidual ? r.residual_severity : null,
          residual_score: res ? res.riskScore : null,
          residual_level: res ? res.riskLevel : null,
          paper_reviewed_by: preparedBy,
          paper_review_date: preparedDate || null,
        })
        if (reviewErr) throw new Error(`Insert review: ${reviewErr.code ?? ''} ${reviewErr.message}`)

        // inline RTP (skip for ACCEPT)
        if (!isAccept && r.rtpOpen && (r.rtp_new_control.trim() || r.rtp_tasks.some((t) => t.task.trim()))) {
          const { data: rtpRow, error: rtpErr } = await supabase.from('risk_rtp').insert({
            risk_id: newRiskRowId,
            new_control: r.rtp_new_control.trim() || null,
            adequacy: r.rtp_adequacy || null,
            overall_status: 'NOT_STARTED',
            last_reviewed: reviewDate || null,
            created_by: riskUserId,
          }).select('id').single()
          if (rtpErr) throw new Error(`Insert RTP: ${rtpErr.code ?? ''} ${rtpErr.message}`)
          const rtpId = rtpRow.id as string
          const taskRows = r.rtp_tasks.filter((t) => t.task.trim()).map((t, seq) => ({
            rtp_id: rtpId, seq, task: t.task.trim(), pic: t.pic.trim() || null,
            due_date: t.due || null, status: t.status, updated_by: riskUserId,
          }))
          if (taskRows.length) {
            const { error: tErr } = await supabase.from('risk_rtp_tasks').insert(taskRows)
            if (tErr) throw new Error(`Insert RTP tasks: ${tErr.code ?? ''} ${tErr.message}`)
          }
          await supabase.from('risk_rtp_updates').insert({
            rtp_id: rtpId, note: 'RTP created from register entry.',
            status: 'NOT_STARTED', created_by: riskUserId,
          })
        }
      }

      router.push(firstNewId ? `/risk/${firstNewId}` : '/risk')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="quickadd" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Log Risk (paper)</div>
              <div className="tb-meta">Coordinator entry · one register, many risks{riskUserName ? ` · ${riskUserName}` : ''}</div>
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
          {loading && !loadError && (
            <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>
          )}
          {accessDenied && !loading && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Coordinator only</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Only hospital-wide roles (Admin, Risk Coordinator, Director) can log risks.
              </div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
              {/* Register header */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Register header</div>
                  <div className="psub">Applies to every risk in this register. One register = one department.</div>
                </div></div>
                <div className="risk-form-grid">
                  <Field label="Department" required>
                    <DeptSearchPicker depts={allDepts} value={deptCode}
                      onChange={setDeptCode} placeholder="Type to search a department…" allowEmpty />
                  </Field>
                  <Field label="Date of review" required>
                    <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
                  </Field>
                  <Field label="Register reference" hint="Optional — e.g. 'ED register Q2 2026'.">
                    <input type="text" value={registerRef} onChange={(e) => setRegisterRef(e.target.value)} />
                  </Field>
                </div>
              </div>

              {/* Risk blocks */}
              {risks.map((r, i) => (
                <RiskBlockCard key={i} index={i} total={risks.length} block={r}
                  onChange={(patch) => updateRisk(i, patch)}
                  onRemove={() => removeRisk(i)}
                  onTaskChange={(ti, patch) => updateTask(i, ti, patch)}
                  onAddTask={() => addTask(i)} />
              ))}

              <div className="panel" style={{ textAlign: 'center' }}>
                <button type="button" className="signout-btn" onClick={addRisk}
                  style={{ borderStyle: 'dashed' }}>＋ Add another risk to this register</button>
              </div>

              {/* Sign-off */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">Sign-off (from the paper form)</div>
                  <div className="psub">Recorded as it appears on the department&apos;s submitted register.</div>
                </div></div>
                <div className="risk-form-grid">
                  <Field label="Prepared / Updated by — RLO name">
                    <input type="text" value={preparedName} onChange={(e) => setPreparedName(e.target.value)} />
                  </Field>
                  <Field label="RLO designation">
                    <input type="text" value={preparedDesig} onChange={(e) => setPreparedDesig(e.target.value)} />
                  </Field>
                  <Field label="RLO date">
                    <input type="date" value={preparedDate} onChange={(e) => setPreparedDate(e.target.value)} />
                  </Field>
                  <Field label="Reviewed / Approved by — HOD name">
                    <input type="text" value={approvedName} onChange={(e) => setApprovedName(e.target.value)} />
                  </Field>
                  <Field label="HOD designation">
                    <input type="text" value={approvedDesig} onChange={(e) => setApprovedDesig(e.target.value)} />
                  </Field>
                  <Field label="HOD date">
                    <input type="date" value={approvedDate} onChange={(e) => setApprovedDate(e.target.value)} />
                  </Field>
                </div>
                <div className="risk-field-hint" style={{ marginTop: 6 }}>
                  📎 Attach the source register PDF / RTP on each risk&apos;s page after saving.
                </div>
              </div>

              {/* Submit */}
              <div className="panel">
                {errors.length > 0 && (
                  <div className="ac amber" style={{ marginBottom: 10 }}>
                    <div className="ai">!</div>
                    <div><div className="at">Form needs more info before you can save</div>
                      <ul className="as" style={{ margin: '4px 0 0 16px' }}>
                        {errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
                        {errors.length > 8 && <li>…and {errors.length - 8} more</li>}
                      </ul></div>
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
                      background: canSubmit ? 'var(--blue)' : '#9CA3AF', color: '#fff',
                      borderColor: canSubmit ? 'var(--blue)' : '#9CA3AF',
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                    }}
                    disabled={!canSubmit}>
                    {submitting ? 'Saving…' : `Save register (${risks.length} risk${risks.length === 1 ? '' : 's'})`}
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

/* ---------------- Risk block ---------------- */

function RiskBlockCard({ index, total, block, onChange, onRemove, onTaskChange, onAddTask }: {
  index: number
  total: number
  block: RiskBlock
  onChange: (patch: Partial<RiskBlock>) => void
  onRemove: () => void
  onTaskChange: (ti: number, patch: Partial<TaskRow>) => void
  onAddTask: () => void
}) {
  const cur = block.likelihood > 0 && block.severity > 0
    ? computeSeverityScore(block.likelihood, block.severity) : null
  const res = block.residual_likelihood > 0 && block.residual_severity > 0
    ? computeSeverityScore(block.residual_likelihood, block.residual_severity) : null
  const isAccept = block.treatment_option === 'ACCEPT'

  return (
    <div className="panel" style={{ borderLeft: '4px solid var(--blue)' }}>
      <div className="pf"><div>
        <div className="pt">Risk {index + 1} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>of this register</span></div>
      </div>
      {total > 1 && (
        <button type="button" className="signout-btn" onClick={onRemove}
          style={{ color: 'var(--red)' }}>✕ Remove</button>
      )}</div>

      <div className="risk-form-grid">
        <Field label="Context" required full
          hint="External / Internal / Needs of interested parties — the department's own framing.">
          <textarea rows={2} value={block.context} onChange={(e) => onChange({ context: e.target.value })} />
        </Field>
        <Field label="Actual or potential" required>
          <div style={{ display: 'flex', gap: 12 }}>
            {(Object.keys(RISK_NATURE_LABEL) as RiskNature[]).map((n) => (
              <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="radio" name={`nature-${index}`} checked={block.risk_nature === n}
                  onChange={() => onChange({ risk_nature: n })} />
                {RISK_NATURE_LABEL[n]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Description of risk" required full>
          <textarea rows={2} value={block.description} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
        <Field label="Consequence of risk" required full>
          <textarea rows={2} value={block.impact_description} onChange={(e) => onChange({ impact_description: e.target.value })} />
        </Field>
        <Field label="Existing control (if any)" full>
          <textarea rows={2} value={block.existing_controls} onChange={(e) => onChange({ existing_controls: e.target.value })} />
        </Field>
      </div>

      {/* Current risk */}
      <SubHeading>Current Risk</SubHeading>
      <div className="risk-form-grid">
        <ScoreField label="Likelihood" value={block.likelihood} onChange={(v) => onChange({ likelihood: v })} />
        <ScoreField label="Severity" value={block.severity} onChange={(v) => onChange({ severity: v })} />
      </div>
      <ScorePreview computed={cur} placeholder="Pick Likelihood and Severity to see the current level." />

      {/* Treatment (after current risk) */}
      <SubHeading>Treatment option</SubHeading>
      <div className="risk-form-grid">
        <Field label="Option" required hint="Accept = no RTP required.">
          <select value={block.treatment_option}
            onChange={(e) => onChange({ treatment_option: e.target.value as TreatmentOption, rtpOpen: e.target.value === 'ACCEPT' ? false : block.rtpOpen })}>
            <option value="">— pick a treatment —</option>
            {(Object.keys(TREATMENT_OPTION_LABEL) as TreatmentOption[]).map((t) => (
              <option key={t} value={t}>{TREATMENT_OPTION_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Describe control briefly / refer to RTP #">
          <input type="text" value={block.additional_controls}
            onChange={(e) => onChange({ additional_controls: e.target.value })}
            placeholder="e.g. 'See RTP' or brief control description" />
        </Field>
      </div>

      {!isAccept && (
        <div style={{ marginTop: 4 }}>
          {!block.rtpOpen ? (
            <button type="button" className="signout-btn"
              style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}
              onClick={() => onChange({ rtpOpen: true })}>🎯 Fill RTP now →</button>
          ) : (
            <div style={{ border: '1px dashed var(--blue)', borderRadius: 10, padding: 12, background: 'var(--blue-lt)', marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <strong style={{ color: 'var(--blue)' }}>🎯 Risk Treatment Plan (Form 0045)</strong>
                <button type="button" className="signout-btn" style={{ marginLeft: 'auto' }}
                  onClick={() => onChange({ rtpOpen: false })}>✕ collapse</button>
              </div>
              <div className="risk-form-grid">
                <Field label="New / additional control" full>
                  <textarea rows={2} value={block.rtp_new_control} onChange={(e) => onChange({ rtp_new_control: e.target.value })} />
                </Field>
                <Field label="Adequacy of existing control">
                  <select value={block.rtp_adequacy} onChange={(e) => onChange({ rtp_adequacy: e.target.value as RtpAdequacy })}>
                    <option value="">—</option>
                    <option value="H">H — High</option>
                    <option value="M">M — Medium</option>
                    <option value="L">L — Low</option>
                  </select>
                </Field>
              </div>
              <div className="risk-field-hint" style={{ marginBottom: 4 }}>Task list</div>
              {block.rtp_tasks.map((t, ti) => (
                <div key={ti} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <input type="text" placeholder="Task" value={t.task}
                    onChange={(e) => onTaskChange(ti, { task: e.target.value })}
                    style={{ flex: '2 1 200px' }} />
                  <input type="text" placeholder="PIC" value={t.pic}
                    onChange={(e) => onTaskChange(ti, { pic: e.target.value })}
                    style={{ flex: '1 1 120px' }} />
                  <input type="date" value={t.due}
                    onChange={(e) => onTaskChange(ti, { due: e.target.value })} />
                  <select value={t.status} onChange={(e) => onTaskChange(ti, { status: e.target.value as RtpTaskStatus })}>
                    <option value="NOT_STARTED">Not started</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="COMPLETED">Completed</option>
                  </select>
                </div>
              ))}
              <button type="button" className="signout-btn" onClick={onAddTask}>＋ Add task</button>
              <div className="risk-field-hint" style={{ marginTop: 6 }}>
                Full approval chain (RLO → HOD → RTC → ROC) is captured on the RTP page.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Residual risk */}
      <SubHeading>Residual Risk <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— can be any value, independent of current</span></SubHeading>
      <div className="risk-form-grid">
        <ScoreFieldOptional label="Residual Likelihood" value={block.residual_likelihood} onChange={(v) => onChange({ residual_likelihood: v })} />
        <ScoreFieldOptional label="Residual Severity" value={block.residual_severity} onChange={(v) => onChange({ residual_severity: v })} />
      </div>
      {res && <ScorePreview computed={res} placeholder="" />}

      {/* Committee outcome */}
      <SubHeading>Committee outcome <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— what RTC / ROC decided</span></SubHeading>
      <div className="risk-form-grid">
        <Field label="Current stage">
          <select value={block.committee_stage} onChange={(e) => onChange({ committee_stage: e.target.value as CommitteeStage })}>
            {(Object.keys(STAGE_LABEL) as CommitteeStage[]).map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Escalation">
          <select value={block.escalation_type} onChange={(e) => onChange({ escalation_type: e.target.value as EscalationType })}>
            <option value="AUTO">Auto (High / Extreme) → ROC</option>
            <option value="MANUAL">Manual escalation (rare Moderate)</option>
            <option value="NONE">Not escalated</option>
          </select>
        </Field>
        <Field label="RTC meeting & date">
          <input type="text" value={block.rtc_ref} onChange={(e) => onChange({ rtc_ref: e.target.value })}
            placeholder="e.g. Jun Technical Review · 18 Jun 2026" />
        </Field>
        <Field label="ROC meeting & date">
          <input type="text" value={block.roc_ref} onChange={(e) => onChange({ roc_ref: e.target.value })}
            placeholder="e.g. Q2 ROC · 30 Jun 2026" />
        </Field>
        <Field label="Decision / outcome notes" full>
          <textarea rows={2} value={block.committee_notes} onChange={(e) => onChange({ committee_notes: e.target.value })} />
        </Field>
        <Field label="Submit to ERMS UiTM" hint="Set at ROC only — ROC is terminal and decides what goes to ERMS.">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={block.submit_to_erms}
              onChange={(e) => onChange({ submit_to_erms: e.target.checked })} />
            Include in ERMS UiTM submission
          </label>
        </Field>
      </div>
    </div>
  )
}

/* ---------------- small helpers ---------------- */

function SubHeading({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, margin: '14px 0 6px' }}>{children}</div>
}

function ScorePreview({ computed, placeholder }: {
  computed: { riskScore: number; riskLevel: keyof typeof RISK_LEVEL_LABEL } | null
  placeholder: string
}) {
  if (!computed) {
    return placeholder
      ? <div style={{ color: 'var(--muted)', fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>{placeholder}</div>
      : null
  }
  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Score {computed.riskScore}</span>
      <span style={{
        display: 'inline-block', padding: '4px 14px', borderRadius: 4, fontSize: 13, fontWeight: 700,
        color: RISK_LEVEL_COLOR[computed.riskLevel], background: RISK_LEVEL_BG[computed.riskLevel],
      }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
    </div>
  )
}

function Field({ label, required, hint, full, children }: {
  label: string; required?: boolean; hint?: string; full?: boolean; children: React.ReactNode
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
