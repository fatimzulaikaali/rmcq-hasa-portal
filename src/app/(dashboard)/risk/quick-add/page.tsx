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
import { RiskPdfImport } from '@/components/RiskPdfImport'
import type { ParsedRegister } from '@/lib/risk/pdfImport'
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

  /* Apply a PDF-parsed register: fill the header + the first risk block with
   * whatever the parser detected. Only non-empty values overwrite, so a bad
   * parse never wipes something the Coordinator already typed. */
  function applyParsedRegister(p: ParsedRegister) {
    if (p.reviewDate) setReviewDate(p.reviewDate)
    if (p.registerRef) setRegisterRef(p.registerRef)
    if (p.preparedName) setPreparedName(p.preparedName)
    if (p.approvedName) setApprovedName(p.approvedName)
    const r = p.risk
    const patch: Partial<RiskBlock> = {}
    if (r.context) patch.context = r.context
    if (r.risk_nature) patch.risk_nature = r.risk_nature
    if (r.description) patch.description = r.description
    if (r.impact_description) patch.impact_description = r.impact_description
    if (r.existing_controls) patch.existing_controls = r.existing_controls
    if (r.treatment_option) patch.treatment_option = r.treatment_option
    if (r.additional_controls) patch.additional_controls = r.additional_controls
    if (r.likelihood) patch.likelihood = r.likelihood
    if (r.severity) patch.severity = r.severity
    if (r.residual_likelihood) patch.residual_likelihood = r.residual_likelihood
    if (r.residual_severity) patch.residual_severity = r.residual_severity
    if (Object.keys(patch).length) updateRisk(0, patch)
  }

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
              {/* Intro banner */}
              <div className="banner blue">
                📄 One register = one department, many risks. Add each risk below, then attach the source PDF on each risk after saving.
              </div>

              {/* Free PDF import — pre-fills the header + first risk block */}
              <RiskPdfImport mode="register" onParsed={applyParsedRegister} />

              {/* Register header */}
              <div className="card">
                <div className="card-hd">Register header</div>
                <div className="card-sub">Applies to every risk in this register.</div>
                <div className="frow three">
                  <Field label="Department" required>
                    <DeptSearchPicker depts={allDepts} value={deptCode}
                      onChange={setDeptCode} placeholder="Type to search a department…" allowEmpty />
                  </Field>
                  <Field label="Date of review" required>
                    <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
                  </Field>
                  <Field label="Register reference">
                    <input type="text" value={registerRef} onChange={(e) => setRegisterRef(e.target.value)}
                      placeholder="e.g. ED register Q2 2026" />
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

              <div className="btn-row" style={{ margin: '-6px 0 18px' }}>
                <button type="button" className="btn dashed" onClick={addRisk}>＋ Add another risk to this register</button>
              </div>

              {/* Sign-off */}
              <div className="card">
                <div className="card-hd">Sign-off (from the paper form)</div>
                <div className="card-sub">Recorded as it appears on the department&apos;s submitted register.</div>
                <div className="signoff">
                  <div className="box">
                    <div className="r">Prepared / Updated by — Risk Liaison Officer</div>
                    <div className="frow" style={{ marginBottom: 0 }}>
                      <Field label="Name">
                        <input type="text" value={preparedName} onChange={(e) => setPreparedName(e.target.value)} />
                      </Field>
                      <Field label="Date">
                        <input type="date" value={preparedDate} onChange={(e) => setPreparedDate(e.target.value)} />
                      </Field>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Field label="Designation">
                        <input type="text" value={preparedDesig} onChange={(e) => setPreparedDesig(e.target.value)} />
                      </Field>
                    </div>
                  </div>
                  <div className="box">
                    <div className="r">Reviewed / Approved by — Head of Department</div>
                    <div className="frow" style={{ marginBottom: 0 }}>
                      <Field label="Name">
                        <input type="text" value={approvedName} onChange={(e) => setApprovedName(e.target.value)} />
                      </Field>
                      <Field label="Date">
                        <input type="date" value={approvedDate} onChange={(e) => setApprovedDate(e.target.value)} />
                      </Field>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Field label="Designation">
                        <input type="text" value={approvedDesig} onChange={(e) => setApprovedDesig(e.target.value)} />
                      </Field>
                    </div>
                  </div>
                </div>
                <div className="hint" style={{ marginTop: 10 }}>
                  📎 Attach the source register PDF / RTP on each risk&apos;s page after saving.
                </div>
              </div>

              {/* Submit */}
              <div className="card">
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
                <div className="btn-row">
                  <button type="submit" className="btn primary"
                    style={{ opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
                    disabled={!canSubmit}>
                    {submitting ? 'Saving…' : `Save register (${risks.length} risk${risks.length === 1 ? '' : 's'})`}
                  </button>
                  <Link href="/risk" className="btn ghost">Cancel</Link>
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
    <div className="card" style={{ borderLeft: '4px solid var(--blue)' }}>
      <div className="card-hd">
        Risk {index + 1} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>of this register</span>
        {total > 1 && (
          <button type="button" className="btn ghost" onClick={onRemove}
            style={{ marginLeft: 'auto', color: 'var(--red)' }}>✕ Remove</button>
        )}
      </div>

      <div className="frow one">
        <Field label="Context" required
          hint="External / Internal / Needs of interested parties — the department's own framing.">
          <textarea rows={2} value={block.context} onChange={(e) => onChange({ context: e.target.value })} />
        </Field>
      </div>
      <div className="frow">
        <Field label="Actual or potential" required>
          <select value={block.risk_nature}
            onChange={(e) => onChange({ risk_nature: e.target.value as RiskNature })}>
            <option value="">— pick —</option>
            {(Object.keys(RISK_NATURE_LABEL) as RiskNature[]).map((n) => (
              <option key={n} value={n}>{RISK_NATURE_LABEL[n]}</option>
            ))}
          </select>
        </Field>
        <Field label="Risk ID" hint="Auto-assigned from the department on save (e.g. ED-2026-004).">
          <input type="text" value="Auto-assigned on save" disabled
            style={{ color: 'var(--muted)', background: '#F3F1EB' }} />
        </Field>
      </div>
      <div className="frow one">
        <Field label="Description of risk" required>
          <textarea rows={2} value={block.description} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
      </div>
      <div className="frow one">
        <Field label="Consequence of risk" required>
          <textarea rows={2} value={block.impact_description} onChange={(e) => onChange({ impact_description: e.target.value })} />
        </Field>
      </div>
      <div className="frow one">
        <Field label="Existing control (if any)">
          <textarea rows={2} value={block.existing_controls} onChange={(e) => onChange({ existing_controls: e.target.value })} />
        </Field>
      </div>

      {/* Current risk */}
      <SubHeading>Current Risk</SubHeading>
      <ScoreBox
        likelihood={block.likelihood} severity={block.severity}
        onLikelihood={(v) => onChange({ likelihood: v })}
        onSeverity={(v) => onChange({ severity: v })}
        computed={cur} required
        placeholder="Pick Likelihood and Severity to see the current level." />

      {/* Treatment (after current risk) */}
      <SubHeading>Treatment option</SubHeading>
      <div className="frow">
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
        <div className="btn-row" style={{ marginTop: 4 }}>
          {!block.rtpOpen ? (
            <button type="button" className="btn primary"
              onClick={() => onChange({ rtpOpen: true })}>🎯 Fill RTP now →</button>
          ) : (
            <div style={{ border: '1px dashed var(--blue)', borderRadius: 10, padding: 14, background: 'var(--blue-lt)', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <strong style={{ color: 'var(--blue)' }}>🎯 Risk Treatment Plan (Form 0045)</strong>
                <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }}
                  onClick={() => onChange({ rtpOpen: false })}>✕ collapse</button>
              </div>
              <div className="frow one">
                <Field label="New / additional control">
                  <textarea rows={2} value={block.rtp_new_control} onChange={(e) => onChange({ rtp_new_control: e.target.value })} />
                </Field>
              </div>
              <div className="frow">
                <Field label="Adequacy of existing control">
                  <select value={block.rtp_adequacy} onChange={(e) => onChange({ rtp_adequacy: e.target.value as RtpAdequacy })}>
                    <option value="">—</option>
                    <option value="H">H — High</option>
                    <option value="M">M — Medium</option>
                    <option value="L">L — Low</option>
                  </select>
                </Field>
              </div>
              <div className="hint" style={{ marginBottom: 4 }}>Task list</div>
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
              <button type="button" className="btn" style={{ marginTop: 2 }} onClick={onAddTask}>＋ Add task</button>
              <div className="hint" style={{ marginTop: 6 }}>
                Full approval chain (RLO → HOD → RTC → ROC) is captured on the RTP page.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Residual risk */}
      <SubHeading>Residual Risk <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— can be any value, independent of current</span></SubHeading>
      <ScoreBox
        likelihood={block.residual_likelihood} severity={block.residual_severity}
        onLikelihood={(v) => onChange({ residual_likelihood: v })}
        onSeverity={(v) => onChange({ residual_severity: v })}
        computed={res}
        placeholder="Optional — pick Likelihood and Severity for the residual level." />

      {/* Committee outcome — free-text record of what RTC / ROC decided */}
      <SubHeading>Committee decision <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— what RTC / ROC decided</span></SubHeading>
      <div className="frow one">
        <Field label="Committee decision" hint="Free text — record the committee's decision in your own words.">
          <textarea rows={3} value={block.committee_notes} onChange={(e) => onChange({ committee_notes: e.target.value })}
            placeholder="e.g. Tabled at Jun RTC; endorsed at Q2 ROC on 30 Jun 2026 — risk accepted and now active." />
        </Field>
      </div>
      <div className="frow">
        <Field label="RTC meeting & date">
          <input type="text" value={block.rtc_ref} onChange={(e) => onChange({ rtc_ref: e.target.value })}
            placeholder="e.g. Jun Technical Review · 18 Jun 2026" />
        </Field>
        <Field label="ROC meeting & date">
          <input type="text" value={block.roc_ref} onChange={(e) => onChange({ roc_ref: e.target.value })}
            placeholder="e.g. Q2 ROC · 30 Jun 2026" />
        </Field>
      </div>
      <div className="frow one">
        <Field label="Submit to ERMS UiTM" hint="Set at ROC only — ROC is terminal and decides what goes to ERMS.">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--text)' }}>
            <input type="checkbox" checked={block.submit_to_erms} style={{ width: 'auto' }}
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
  return <div className="card-sub" style={{ margin: '14px 0 6px', fontWeight: 600, color: 'var(--text)' }}>{children}</div>
}

/* Likelihood + Severity as two compact dropdowns with the computed score/level
 * chip sitting inline to the right — mirrors Form 0044's scorebox layout. */
function ScoreBox({ likelihood, severity, onLikelihood, onSeverity, computed, required, placeholder }: {
  likelihood: number; severity: number
  onLikelihood: (v: number) => void; onSeverity: (v: number) => void
  computed: { riskScore: number; riskLevel: keyof typeof RISK_LEVEL_LABEL } | null
  required?: boolean; placeholder: string
}) {
  return (
    <div className="scorebox">
      <div className="fld" style={{ minWidth: 120 }}>
        <label>Likelihood (1–5){required && <span className="req"> *</span>}</label>
        <select value={likelihood} onChange={(e) => onLikelihood(Number(e.target.value))}>
          <option value={0}>—</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="fld" style={{ minWidth: 120 }}>
        <label>Severity (1–5){required && <span className="req"> *</span>}</label>
        <select value={severity} onChange={(e) => onSeverity(Number(e.target.value))}>
          <option value={0}>—</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {computed ? (
        <div className="scoreout">
          Score {computed.riskScore} ·{' '}
          <span style={{
            display: 'inline-block', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700,
            color: RISK_LEVEL_COLOR[computed.riskLevel], background: RISK_LEVEL_BG[computed.riskLevel],
          }}>{RISK_LEVEL_LABEL[computed.riskLevel]}</span>
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', fontSize: 12, fontStyle: 'italic', paddingBottom: 8 }}>{placeholder}</div>
      )}
    </div>
  )
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="fld">
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}
