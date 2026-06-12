'use client'

/* /risk/bulk-upload — RMCQ-only batch intake.
 *
 * Workflow:
 *   1. RC fills in the paper-source metadata for the WHOLE batch (submitter,
 *      HOD endorser, dates, paper reference) and picks a file.
 *   2. File goes to /api/risk/parse-upload; the model returns an array of
 *      risk drafts.
 *   3. RC reviews each row in an editable list — fixing the dept, category,
 *      scoring, etc. — and picks a triage outcome per row (Valid / Out of
 *      scope / Incomplete). Default is Valid.
 *   4. "Confirm & save all" bulk-inserts the risks (one risks row + cycle-1
 *      review for Valid rows; rejection or DRAFT for the others) with
 *      entry_mode='rmcq_managed' and the paper-source metadata. */

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { RiskAccountChip } from '@/components/RiskAccountChip'
import { RiskSidebar } from '@/components/RiskSidebar'
import { RiskDept, RiskCategory, RiskScope } from '@/lib/risk/types'
import {
  computeRiskScore, formatRiskId,
  RISK_LEVEL_COLOR, RISK_LEVEL_BG, RISK_LEVEL_LABEL,
  RISK_CATEGORY_LABEL, RISK_SCOPE_LABEL,
} from '@/lib/risk/scoring'

type Triage = 'valid' | 'out_of_scope' | 'incomplete'

interface DraftRow {
  triage: Triage
  dept_code: string
  category: RiskCategory | ''
  scope: RiskScope | ''
  description: string
  cause: string
  impact: string
  existing_controls: string
  additional_controls: string
  action_owner_depts: string[]
  implementation_period: string
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
  out_of_scope_reason: string
  clarification_note: string
  source_note: string
  expanded: boolean
}

interface ParsedFromApi {
  description?: string
  cause?: string
  impact?: string
  category?: string
  scope?: string
  existing_controls?: string
  additional_controls?: string
  action_owner_dept_names?: string[]
  implementation_period?: string
  likelihood?: number | null
  impact_manusia?: number | null
  impact_reputasi?: number | null
  impact_kewangan?: number | null
  impact_operasi?: number | null
  impact_objektif?: number | null
  _source_note?: string
}

interface PaperSource {
  submitted_by: string
  submission_date: string
  endorsed_by: string
  endorsement_date: string
  reference: string
}

const VALID_CATEGORIES: RiskCategory[] = ['OPS', 'KEW', 'REP', 'PER', 'STR', 'PRJ']
const VALID_SCOPES: RiskScope[] = ['INSTITUSI', 'UNIT']

function blankSource(): PaperSource {
  return { submitted_by: '', submission_date: '', endorsed_by: '', endorsement_date: '', reference: '' }
}

function draftFromApi(p: ParsedFromApi): DraftRow {
  const cat = VALID_CATEGORIES.includes((p.category ?? '') as RiskCategory) ? (p.category as RiskCategory) : ''
  const sc = VALID_SCOPES.includes((p.scope ?? '') as RiskScope) ? (p.scope as RiskScope) : ''
  const clamp = (n: number | null | undefined): number => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0
    return Math.max(0, Math.min(5, Math.round(n)))
  }
  return {
    triage: 'valid',
    dept_code: '',
    category: cat,
    scope: sc,
    description: p.description ?? '',
    cause: p.cause ?? '',
    impact: p.impact ?? '',
    existing_controls: p.existing_controls ?? '',
    additional_controls: p.additional_controls ?? '',
    action_owner_depts: [],
    implementation_period: p.implementation_period ?? '',
    likelihood: clamp(p.likelihood),
    impact_manusia: clamp(p.impact_manusia),
    impact_reputasi: clamp(p.impact_reputasi),
    impact_kewangan: clamp(p.impact_kewangan),
    impact_operasi: clamp(p.impact_operasi),
    impact_objektif: clamp(p.impact_objektif),
    out_of_scope_reason: '',
    clarification_note: '',
    source_note: p._source_note ?? '',
    expanded: false,
  }
}

export default function BulkUploadPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading]   = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [depts, setDepts] = useState<RiskDept[]>([])
  const [riskUserId, setRiskUserId] = useState<number | null>(null)

  const [paper, setPaper] = useState<PaperSource>(blankSource())
  const [defaultDept, setDefaultDept] = useState<string>('')

  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [generalNotes, setGeneralNotes] = useState<string>('')
  const [drafts, setDrafts] = useState<DraftRow[]>([])

  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: number; failed: number; errors: string[] } | null>(null)

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setLoadError(null); setAccessDenied(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const access = await getModuleAccess(supabase)
      if (!access.allModules || !access.riskUser) { setAccessDenied(true); return }
      setRiskUserId(access.riskUser.riskUserId)

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

  async function signOut() { await supabase.auth.signOut(); router.push('/login') }

  async function handleParse() {
    if (!file) return
    setParsing(true); setParseError(null); setDrafts([]); setGeneralNotes('')
    try {
      const body = new FormData()
      body.append('file', file)
      const resp = await fetch('/api/risk/parse-upload', { method: 'POST', body })
      const data = await resp.json()
      if (!resp.ok) {
        throw new Error(data?.error ?? `Parse failed (${resp.status})`)
      }
      const apiRows = (data.risks ?? []) as ParsedFromApi[]
      const newDrafts = apiRows.map(draftFromApi)
      // Pre-fill default dept if RC picked one
      if (defaultDept) {
        for (const d of newDrafts) d.dept_code = defaultDept
      }
      setDrafts(newDrafts)
      setGeneralNotes(data.general_notes ?? '')
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e))
    } finally {
      setParsing(false)
    }
  }

  function updateDraft(idx: number, patch: Partial<DraftRow>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }
  function removeDraft(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx))
  }
  function applyDefaultDeptToAll() {
    if (!defaultDept) return
    setDrafts((prev) => prev.map((d) => ({ ...d, dept_code: defaultDept })))
  }

  function rowErrors(d: DraftRow): string[] {
    const errs: string[] = []
    if (!d.dept_code) errs.push('dept')
    if (!d.category) errs.push('category')
    if (!d.scope) errs.push('scope')
    if (!d.description.trim()) errs.push('description')
    if (d.triage === 'valid') {
      if (!d.cause.trim()) errs.push('cause')
      if (!d.impact.trim()) errs.push('impact')
      const ss = [d.likelihood, d.impact_manusia, d.impact_reputasi, d.impact_kewangan, d.impact_operasi, d.impact_objektif]
      if (ss.some((v) => v < 1 || v > 5)) errs.push('scoring')
    }
    if (d.triage === 'out_of_scope' && !d.out_of_scope_reason.trim()) errs.push('reason')
    if (d.triage === 'incomplete' && !d.clarification_note.trim()) errs.push('clarification')
    return errs
  }

  const paperErrors = useMemo(() => {
    const e: string[] = []
    if (!paper.submitted_by.trim()) e.push('Paper: submitter name')
    if (!paper.submission_date) e.push('Paper: submission date')
    return e
  }, [paper])
  const allRowErrors = useMemo(() => drafts.map(rowErrors), [drafts])
  const totalRowErrors = allRowErrors.reduce((acc, e) => acc + (e.length ? 1 : 0), 0)
  const canSave = drafts.length > 0 && paperErrors.length === 0 && totalRowErrors === 0 && riskUserId !== null && !saving

  async function handleSaveAll() {
    if (!canSave || !riskUserId) return
    setSaving(true); setSaveResult(null)
    const result = { ok: 0, failed: 0, errors: [] as string[] }
    const year = new Date().getFullYear()

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]
      try {
        const dept = depts.find((dx) => dx.code === d.dept_code)
        if (!dept?.risk_code) throw new Error(`Row ${i + 1}: department has no risk_code mapping`)

        const { data: seqData, error: seqErr } = await supabase
          .rpc('next_risk_seq', { p_dept_code: d.dept_code, p_year: year })
        if (seqErr) throw new Error(`Row ${i + 1}: ${seqErr.code ?? ''} ${seqErr.message}`)
        const seq = seqData as number
        const risk_id = formatRiskId(dept.risk_code, year, seq)

        let status: 'TABLED_RTC' | 'OUT_OF_SCOPE' | 'DRAFT'
        let triageExtras: Record<string, unknown> = {}
        let actionType: string
        const paperSummary = paperSummaryText(paper)
        let auditComment: string

        if (d.triage === 'valid') {
          status = 'TABLED_RTC'
          actionType = 'PAPER_SUBMISSION_ENTERED_BULK'
          auditComment = `Paper submission (bulk row ${i + 1}/${drafts.length}) entered by RC — ${paperSummary}; tabled for RTC`
        } else if (d.triage === 'out_of_scope') {
          status = 'OUT_OF_SCOPE'
          triageExtras = {
            rejection_reason: d.out_of_scope_reason.slice(0, 50),
            rejection_comment: d.out_of_scope_reason,
            rejected_by: riskUserId,
            rejected_at: new Date().toISOString(),
            pending_ack: false,
          }
          actionType = 'PAPER_SUBMISSION_OUT_OF_SCOPE_BULK'
          auditComment = `Paper submission (bulk row ${i + 1}/${drafts.length}) entered by RC — ${paperSummary}; declined as out of scope: ${d.out_of_scope_reason.trim()}`
        } else {
          status = 'DRAFT'
          actionType = 'PAPER_SUBMISSION_INCOMPLETE_BULK'
          auditComment = `Paper submission (bulk row ${i + 1}/${drafts.length}) entered by RC — ${paperSummary}; held as DRAFT awaiting clarification: ${d.clarification_note.trim()}`
        }

        const insertPayload: Record<string, unknown> = {
          risk_id,
          dept_code: d.dept_code,
          created_by: riskUserId,
          category: d.category,
          scope: d.scope,
          description: d.description.trim(),
          cause_description: d.cause.trim() || '(awaiting clarification)',
          impact_description: d.impact.trim() || '(awaiting clarification)',
          existing_controls: d.existing_controls.trim() || null,
          additional_controls: d.additional_controls.trim() || null,
          action_owner: null,
          action_owner_depts: d.action_owner_depts.length ? d.action_owner_depts : null,
          implementation_period: d.implementation_period.trim() || null,
          notes: d.triage === 'incomplete' ? `[Awaiting clarification — ${d.clarification_note.trim()}]` : null,
          status,
          entry_mode: 'rmcq_managed',
          paper_submitted_by: paper.submitted_by.trim() || null,
          paper_submission_date: paper.submission_date || null,
          paper_endorsed_by: paper.endorsed_by.trim() || null,
          paper_endorsement_date: paper.endorsement_date || null,
          paper_reference: paper.reference.trim() || null,
          ...triageExtras,
        }

        const { data: insertedRisk, error: riskErr } = await supabase
          .from('risks').insert(insertPayload).select('id').single()
        if (riskErr) throw new Error(`Row ${i + 1}: ${riskErr.code ?? ''} ${riskErr.message}`)
        const newRiskRowId = insertedRisk.id as number

        if (d.triage === 'valid') {
          const computed = computeRiskScore(d.likelihood, [
            d.impact_manusia, d.impact_reputasi, d.impact_kewangan,
            d.impact_operasi, d.impact_objektif,
          ])
          const { error: reviewErr } = await supabase.from('risk_reviews').insert({
            risk_id: newRiskRowId,
            cycle_number: 1,
            reviewed_by: riskUserId,
            review_date: new Date().toISOString().slice(0, 10),
            likelihood: d.likelihood,
            impact_manusia: d.impact_manusia,
            impact_reputasi: d.impact_reputasi,
            impact_kewangan: d.impact_kewangan,
            impact_operasi: d.impact_operasi,
            impact_objektif: d.impact_objektif,
            avg_impact: computed.avgImpact,
            risk_score: computed.riskScore,
            risk_level: computed.riskLevel,
            paper_reviewed_by: paper.submitted_by.trim() || null,
            paper_review_date: paper.submission_date || null,
            paper_endorsed_by: paper.endorsed_by.trim() || null,
            paper_endorsement_date: paper.endorsement_date || null,
            paper_reference: paper.reference.trim() || null,
          })
          if (reviewErr) throw new Error(`Row ${i + 1} cycle: ${reviewErr.code ?? ''} ${reviewErr.message}`)
        }

        await supabase.from('risk_audit_logs').insert({
          risk_id: newRiskRowId,
          entity_type: 'risk',
          entity_id: newRiskRowId,
          action_type: actionType,
          performed_by: riskUserId,
          user_role: 'RC',
          new_value: { risk_id, status, entry_mode: 'rmcq_managed', triage: d.triage, bulk: true },
          comment: auditComment,
        })

        result.ok++
      } catch (e) {
        result.failed++
        result.errors.push(e instanceof Error ? e.message : String(e))
      }
    }

    setSaveResult(result)
    setSaving(false)
    if (result.failed === 0) {
      // Brief pause so the user can see the success summary, then go to register
      setTimeout(() => router.push('/risk'), 1200)
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <RiskSidebar onClose={() => setSidebarOpen(false)} active="bulkupload" />

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div>
              <div className="tb-title">Bulk Upload (Paper Register)</div>
              <div className="tb-meta">Upload a scanned PDF or Excel; the parser extracts each risk for review</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RiskAccountChip />
            <Link href="/risk/quick-add" className="signout-btn">Single entry →</Link>
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
          {accessDenied && (
            <div className="panel" style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Bulk upload is RMCQ-only</div>
              <div style={{ marginTop: 14 }}>
                <Link href="/risk" className="signout-btn"
                  style={{ background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }}>← Back to register</Link>
              </div>
            </div>
          )}

          {!loading && !loadError && !accessDenied && (
            <>
              {/* Paper source for the batch */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">1. Paper Source (whole batch)</div>
                  <div className="psub">Captured once and applied to every risk in the upload. The audit trail uses these values.</div>
                </div></div>
                <div className="risk-form-grid">
                  <div className="risk-field">
                    <label>Submitted by (RLO)<span style={{ color: 'var(--red)' }}> *</span></label>
                    <input type="text" value={paper.submitted_by}
                      onChange={(e) => setPaper({ ...paper, submitted_by: e.target.value })}
                      placeholder="e.g. Dr Suk Hui" />
                  </div>
                  <div className="risk-field">
                    <label>Submission date<span style={{ color: 'var(--red)' }}> *</span></label>
                    <input type="date" value={paper.submission_date}
                      onChange={(e) => setPaper({ ...paper, submission_date: e.target.value })} />
                  </div>
                  <div className="risk-field">
                    <label>HOD endorser</label>
                    <input type="text" value={paper.endorsed_by}
                      onChange={(e) => setPaper({ ...paper, endorsed_by: e.target.value })}
                      placeholder="e.g. Dr Rosnida" />
                  </div>
                  <div className="risk-field">
                    <label>HOD endorsement date</label>
                    <input type="date" value={paper.endorsement_date}
                      onChange={(e) => setPaper({ ...paper, endorsement_date: e.target.value })} />
                  </div>
                  <div className="risk-field full">
                    <label>Paper reference</label>
                    <input type="text" value={paper.reference}
                      onChange={(e) => setPaper({ ...paper, reference: e.target.value })}
                      placeholder="e.g. Borang RMK-2026-018; filed in RMCQ cabinet" />
                  </div>
                </div>
              </div>

              {/* Upload + parse */}
              <div className="panel">
                <div className="pf"><div>
                  <div className="pt">2. Upload &amp; parse</div>
                  <div className="psub">PDF (incl. scanned) or Excel (.xlsx). The parser returns a draft list you can review and edit before saving.</div>
                </div></div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input type="file" accept=".pdf,.xlsx,.xls,application/pdf"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseError(null) }}
                    style={{ fontSize: 12 }} />
                  {file && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>}
                  <div style={{ flex: 1 }} />
                  <div className="risk-field" style={{ margin: 0, minWidth: 240 }}>
                    <label style={{ fontSize: 10 }}>Default department (applies to extracted rows)</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={defaultDept} onChange={(e) => setDefaultDept(e.target.value)} style={{ flex: 1 }}>
                        <option value="">— none —</option>
                        {depts.map((d) => <option key={d.code} value={d.code}>{d.name_en}</option>)}
                      </select>
                      {drafts.length > 0 && defaultDept && (
                        <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={applyDefaultDeptToAll}>Apply to all</button>
                      )}
                    </div>
                  </div>
                  <button type="button" className="signout-btn"
                    style={{
                      background: file && !parsing ? 'var(--blue)' : '#9CA3AF',
                      color: '#fff',
                      borderColor: file && !parsing ? 'var(--blue)' : '#9CA3AF',
                      fontSize: 12, padding: '6px 14px',
                    }}
                    disabled={!file || parsing} onClick={handleParse}>
                    {parsing ? 'Parsing…' : '⚙️ Parse file'}
                  </button>
                </div>
                {parseError && (
                  <div className="ac red" style={{ marginTop: 10 }}>
                    <div className="ai">⚠️</div>
                    <div><div className="at">Parse error</div><div className="as">{parseError}</div></div>
                  </div>
                )}
                {generalNotes && (
                  <div className="ac amber" style={{ marginTop: 10 }}>
                    <div className="ai">!</div>
                    <div><div className="at">Parser notes</div><div className="as">{generalNotes}</div></div>
                  </div>
                )}
              </div>

              {/* Review */}
              {drafts.length > 0 && (
                <div className="panel">
                  <div className="pf"><div>
                    <div className="pt">3. Review &amp; triage ({drafts.length} risk{drafts.length === 1 ? '' : 's'})</div>
                    <div className="psub">
                      Each row is editable. Default triage is <b>Valid</b>; switch to <i>Out of scope</i> or <i>Incomplete</i> per row as needed.
                      {totalRowErrors > 0 && (
                        <span style={{ color: 'var(--red)' }}> · {totalRowErrors} row{totalRowErrors === 1 ? '' : 's'} need more info before saving.</span>
                      )}
                    </div>
                  </div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {drafts.map((d, idx) => (
                      <DraftCard
                        key={idx}
                        idx={idx}
                        d={d}
                        depts={depts}
                        errors={allRowErrors[idx]}
                        onChange={(patch) => updateDraft(idx, patch)}
                        onRemove={() => removeDraft(idx)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Save all */}
              {drafts.length > 0 && (
                <div className="panel">
                  {paperErrors.length > 0 && (
                    <div className="ac amber" style={{ marginBottom: 10 }}>
                      <div className="ai">!</div>
                      <div>
                        <div className="at">Paper source needs more info</div>
                        <ul className="as" style={{ margin: '4px 0 0 16px' }}>
                          {paperErrors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    </div>
                  )}
                  {saveResult && (
                    <div className={`ac ${saveResult.failed === 0 ? 'green' : 'amber'}`} style={{ marginBottom: 10 }}>
                      <div className="ai">{saveResult.failed === 0 ? '✓' : '!'}</div>
                      <div>
                        <div className="at">
                          Saved {saveResult.ok} of {saveResult.ok + saveResult.failed} risk{saveResult.ok + saveResult.failed === 1 ? '' : 's'}
                          {saveResult.failed > 0 ? ` · ${saveResult.failed} failed` : ' · taking you to the register…'}
                        </div>
                        {saveResult.errors.length > 0 && (
                          <ul className="as" style={{ margin: '4px 0 0 16px' }}>
                            {saveResult.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Link href="/risk" className="signout-btn">Cancel</Link>
                    <button type="button" className="signout-btn"
                      style={{
                        background: canSave ? 'var(--blue)' : '#9CA3AF', color: '#fff',
                        borderColor: canSave ? 'var(--blue)' : '#9CA3AF',
                        cursor: canSave ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!canSave} onClick={handleSaveAll}>
                      {saving ? `Saving (${(saveResult?.ok ?? 0) + (saveResult?.failed ?? 0) + 1}/${drafts.length})…` : `✓ Confirm & save all (${drafts.length})`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function paperSummaryText(p: PaperSource): string {
  const parts: string[] = []
  if (p.submitted_by.trim()) parts.push(`submitted by ${p.submitted_by.trim()}`)
  if (p.submission_date) parts.push(`on ${p.submission_date}`)
  if (p.endorsed_by.trim()) parts.push(`HOD-endorsed by ${p.endorsed_by.trim()}`)
  if (p.endorsement_date) parts.push(`on ${p.endorsement_date}`)
  if (p.reference.trim()) parts.push(`ref: ${p.reference.trim()}`)
  return parts.length ? parts.join(' · ') : 'no paper-source metadata'
}

function DraftCard({ idx, d, depts, errors, onChange, onRemove }: {
  idx: number
  d: DraftRow
  depts: RiskDept[]
  errors: string[]
  onChange: (patch: Partial<DraftRow>) => void
  onRemove: () => void
}) {
  const triageAccent = d.triage === 'valid' ? '#1D4ED8' : d.triage === 'out_of_scope' ? '#B91C1C' : '#92400E'
  const computed = (d.likelihood > 0 && d.impact_manusia > 0 && d.impact_reputasi > 0 &&
    d.impact_kewangan > 0 && d.impact_operasi > 0 && d.impact_objektif > 0)
    ? computeRiskScore(d.likelihood,
        [d.impact_manusia, d.impact_reputasi, d.impact_kewangan, d.impact_operasi, d.impact_objektif])
    : null

  return (
    <div style={{
      border: `1px solid ${errors.length ? 'var(--red)' : 'var(--border)'}`,
      borderLeft: `4px solid ${triageAccent}`,
      borderRadius: 8, padding: '10px 12px',
    }}>
      {/* Top row: index, triage, dept, expand/remove */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>#{idx + 1}</span>
        <select value={d.triage} onChange={(e) => onChange({ triage: e.target.value as Triage })}
          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
          <option value="valid">✓ Valid</option>
          <option value="out_of_scope">✗ Out of scope</option>
          <option value="incomplete">… Incomplete</option>
        </select>
        <select value={d.dept_code} onChange={(e) => onChange({ dept_code: e.target.value })}
          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, minWidth: 200 }}>
          <option value="">— department —</option>
          {depts.map((dx) => <option key={dx.code} value={dx.code}>{dx.name_en}</option>)}
        </select>
        <select value={d.category} onChange={(e) => onChange({ category: e.target.value as RiskCategory | '' })}
          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
          <option value="">— category —</option>
          {VALID_CATEGORIES.map((c) => <option key={c} value={c}>{c} · {RISK_CATEGORY_LABEL[c]}</option>)}
        </select>
        <select value={d.scope} onChange={(e) => onChange({ scope: e.target.value as RiskScope | '' })}
          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
          <option value="">— scope —</option>
          {VALID_SCOPES.map((s) => <option key={s} value={s}>{RISK_SCOPE_LABEL[s]}</option>)}
        </select>
        {computed && (
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 4,
            fontSize: 10, fontWeight: 700,
            color: RISK_LEVEL_COLOR[computed.riskLevel], background: RISK_LEVEL_BG[computed.riskLevel],
          }}>{RISK_LEVEL_LABEL[computed.riskLevel]} · {(Math.round(computed.riskScore * 10) / 10).toFixed(1)}</span>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => onChange({ expanded: !d.expanded })}>
          {d.expanded ? 'Collapse' : 'Expand'}
        </button>
        <button type="button" className="signout-btn" style={{ fontSize: 11, padding: '3px 8px', color: 'var(--red)', borderColor: 'var(--red)' }}
          onClick={onRemove}>Remove</button>
      </div>

      {/* Description (always visible) */}
      <div style={{ marginTop: 8 }}>
        <textarea rows={d.expanded ? 3 : 2} value={d.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Risk description"
          style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
      </div>

      {/* Source note from the parser (if any) */}
      {d.source_note && (
        <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>
          Parser note: {d.source_note}
        </div>
      )}

      {/* Expanded edit: cause/impact, controls, scoring */}
      {d.expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Two label="Cause" valLabel="Impact"
            v1={d.cause} v2={d.impact}
            on1={(v) => onChange({ cause: v })} on2={(v) => onChange({ impact: v })} />
          <Two label="Existing controls" valLabel="Additional controls"
            v1={d.existing_controls} v2={d.additional_controls}
            on1={(v) => onChange({ existing_controls: v })} on2={(v) => onChange({ additional_controls: v })} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ScoreInline label="L" value={d.likelihood} onChange={(v) => onChange({ likelihood: v })} />
            <ScoreInline label="Manusia" value={d.impact_manusia} onChange={(v) => onChange({ impact_manusia: v })} />
            <ScoreInline label="Reputasi" value={d.impact_reputasi} onChange={(v) => onChange({ impact_reputasi: v })} />
            <ScoreInline label="Kewangan" value={d.impact_kewangan} onChange={(v) => onChange({ impact_kewangan: v })} />
            <ScoreInline label="Operasi" value={d.impact_operasi} onChange={(v) => onChange({ impact_operasi: v })} />
            <ScoreInline label="Objektif" value={d.impact_objektif} onChange={(v) => onChange({ impact_objektif: v })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Implementation period</label>
              <input type="text" value={d.implementation_period}
                onChange={(e) => onChange({ implementation_period: e.target.value })}
                placeholder="Optional"
                style={{ width: '100%', padding: 6, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }} />
            </div>
          </div>
        </div>
      )}

      {/* Triage-specific fields */}
      {d.triage === 'out_of_scope' && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 10, color: 'var(--red)', display: 'block', marginBottom: 3 }}>
            Reason for declining<span style={{ color: 'var(--red)' }}> *</span>
          </label>
          <textarea rows={2} value={d.out_of_scope_reason}
            onChange={(e) => onChange({ out_of_scope_reason: e.target.value })}
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
        </div>
      )}
      {d.triage === 'incomplete' && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 10, color: 'var(--red)', display: 'block', marginBottom: 3 }}>
            Clarification note<span style={{ color: 'var(--red)' }}> *</span>
          </label>
          <textarea rows={2} value={d.clarification_note}
            onChange={(e) => onChange({ clarification_note: e.target.value })}
            placeholder="What needs to come back from the dept on paper"
            style={{ width: '100%', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'inherit', fontSize: 12 }} />
        </div>
      )}

      {/* Row errors */}
      {errors.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--red)' }}>
          Needs: {errors.join(', ')}
        </div>
      )}
    </div>
  )
}

function Two({ label, valLabel, v1, v2, on1, on2 }: {
  label: string; valLabel: string
  v1: string; v2: string
  on1: (v: string) => void; on2: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{label}</label>
        <textarea rows={2} value={v1} onChange={(e) => on1(e.target.value)}
          style={{ width: '100%', padding: 6, border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', fontSize: 12 }} />
      </div>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>{valLabel}</label>
        <textarea rows={2} value={v2} onChange={(e) => on2(e.target.value)}
          style={{ width: '100%', padding: 6, border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'inherit', fontSize: 12 }} />
      </div>
    </div>
  )
}

function ScoreInline({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</span>
      <div className="score-pills">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`score-pill ${value === n ? 'active' : ''}`}
            style={{ minWidth: 22, padding: '2px 0', fontSize: 10 }}
            onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
    </div>
  )
}
