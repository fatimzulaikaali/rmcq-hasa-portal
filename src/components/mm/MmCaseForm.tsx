'use client'

import { useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MM_CATEGORIES, MM_SHORTFALLS, MM_ASSESS_FIELDS, MM_STATUSES,
  type MmCase, type MmDepartment, type MmCaseShortfall,
} from '@/lib/mm/types'

/* Create / edit an M&M case — the five-part form with the two gates, as one
 * scrollable modal grouped by the form's parts. Saves to mm_cases and replaces
 * the case's rows in mm_case_shortfalls. De-identified: no name/NRIC fields. */

type Draft = Partial<MmCase> & { case_no: string; report_type: 'Mortality' | 'Morbidity' }

export function MmCaseForm({
  supabase, initial, departments, existingShortfalls, onSaved, onCancel, suggestCaseNo,
}: {
  supabase: SupabaseClient
  initial: MmCase | null
  departments: MmDepartment[]
  existingShortfalls: MmCaseShortfall[]
  onSaved: () => void
  onCancel: () => void
  suggestCaseNo: string
}) {
  const [d, setD] = useState<Draft>(() => initial
    ? { ...initial }
    : { case_no: suggestCaseNo, report_type: 'Mortality', is_bid: false, minutes_attached: false,
        attendance_attached: false, hod_certification: false, learning_points_disseminated: false, status: 'Untriaged' })
  const [shortfalls, setShortfalls] = useState<Record<string, string | true>>(() => {
    const m: Record<string, string | true> = {}
    for (const s of existingShortfalls) m[s.shortfall] = s.specify ?? true
    return m
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }))
  const losDays = useMemo(() => {
    if (d.admission_date && d.death_datetime) {
      const a = new Date(d.admission_date).getTime(), x = new Date(d.death_datetime).getTime()
      if (x >= a) return Math.round((x - a) / 86400000)
    }
    return d.los_days ?? null
  }, [d.admission_date, d.death_datetime, d.los_days])

  function toggleShort(s: string) {
    setShortfalls((prev) => {
      const next = { ...prev }
      if (s in next) delete next[s]; else next[s] = true
      return next
    })
  }

  async function save() {
    if (!d.case_no.trim()) { setErr('Case number is required.'); return }
    setBusy(true); setErr('')
    const row = { ...d, los_days: losDays, updated_at: new Date().toISOString() }
    delete (row as { id?: number }).id
    try {
      let caseId = initial?.id
      if (initial) {
        const { error } = await supabase.from('mm_cases').update(row).eq('id', initial.id)
        if (error) { setErr(error.message); setBusy(false); return }
      } else {
        const { data, error } = await supabase.from('mm_cases').insert(row).select('id').single()
        if (error) { setErr(error.message); setBusy(false); return }
        caseId = (data as { id: number }).id
      }
      if (caseId) {
        await supabase.from('mm_case_shortfalls').delete().eq('case_id', caseId)
        const rows = Object.entries(shortfalls).map(([shortfall, v]) => ({
          case_id: caseId, shortfall, specify: v === true ? null : v,
        }))
        if (rows.length) await supabase.from('mm_case_shortfalls').insert(rows)
      }
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); setBusy(false) }
  }

  const yn = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '')
  const setYn = (k: keyof Draft, val: string) => set({ [k]: val === 'yes' ? true : val === 'no' ? false : null } as Partial<Draft>)

  return (
    <div className="mm-form">
      {err && <div className="mm-err">{err}</div>}

      <div className="mm-sec">Intake · Part 1</div>
      <div className="mm-grid">
        <L label="Case number"><input value={d.case_no} onChange={(e) => set({ case_no: e.target.value })} /></L>
        <L label="Report type">
          <select value={d.report_type} onChange={(e) => set({ report_type: e.target.value as 'Mortality' | 'Morbidity' })}>
            <option>Mortality</option><option>Morbidity</option>
          </select>
        </L>
        <L label="Department">
          <select value={d.dept_code ?? ''} onChange={(e) => set({ dept_code: e.target.value || null })}>
            <option value="">—</option>
            {departments.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </select>
        </L>
        <L label="Ward / location"><input value={d.ward ?? ''} onChange={(e) => set({ ward: e.target.value })} /></L>
        <L label="Age"><input type="number" value={d.age ?? ''} onChange={(e) => set({ age: e.target.value === '' ? null : Number(e.target.value) })} /></L>
        <L label="Sex">
          <select value={d.sex ?? ''} onChange={(e) => set({ sex: e.target.value || null })}><option value="">—</option><option>M</option><option>F</option></select>
        </L>
        <L label="Admission date"><input type="date" value={d.admission_date ?? ''} onChange={(e) => set({ admission_date: e.target.value || null })} /></L>
        <L label="Death date/time"><input type="datetime-local" value={(d.death_datetime ?? '').slice(0, 16)} onChange={(e) => set({ death_datetime: e.target.value || null })} /></L>
        <L label="Length of stay (days)"><input value={losDays ?? ''} readOnly title="Derived from admission → death" /></L>
        <L label="Diagnosis"><input value={d.diagnosis ?? ''} onChange={(e) => set({ diagnosis: e.target.value })} /></L>
        <L label="Cause of death (ICD-10)"><input value={d.cause_icd ?? ''} onChange={(e) => set({ cause_icd: e.target.value })} /></L>
        <L label="Brought-in-dead?"><label className="mm-chk"><input type="checkbox" checked={!!d.is_bid} onChange={(e) => set({ is_bid: e.target.checked })} /> BID / forensic</label></L>
      </div>

      <div className="mm-sec">Clinical assessment · Part 2</div>
      <div className="mm-grid three">
        {MM_ASSESS_FIELDS.map((f) => (
          <L key={f.key as string} label={f.label}>
            <select value={yn(d[f.key] as boolean | null)} onChange={(e) => setYn(f.key as keyof Draft, e.target.value)}>
              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </L>
        ))}
      </div>

      <div className="mm-sec">Gate 1 · Dept-level M&M meeting required?</div>
      <div className="mm-grid">
        <L label="Gate 1 decision">
          <select value={yn(d.gate1_dept_meeting_required)} onChange={(e) => setYn('gate1_dept_meeting_required', e.target.value)}>
            <option value="">Not yet triaged</option><option value="yes">Yes — review required</option><option value="no">No — no formal review</option>
          </select>
        </L>
        {d.gate1_dept_meeting_required === false && (
          <L label="Reason for no review"><input value={d.no_review_reason ?? ''} placeholder="e.g. expected/palliative, BID/forensic" onChange={(e) => set({ no_review_reason: e.target.value })} /></L>
        )}
      </div>

      {d.gate1_dept_meeting_required !== false && (
        <>
          <div className="mm-sec">Departmental review · Part 3</div>
          <div className="mm-grid">
            <L label="Category of death">
              <select value={d.category_of_death ?? ''} onChange={(e) => set({ category_of_death: (e.target.value || null) as MmCase['category_of_death'] })}>
                <option value="">—</option>{MM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </L>
            <L label="M&M meeting date"><input type="date" value={d.meeting_date ?? ''} onChange={(e) => set({ meeting_date: e.target.value || null })} /></L>
            <L label="Documentation">
              <label className="mm-chk"><input type="checkbox" checked={!!d.minutes_attached} onChange={(e) => set({ minutes_attached: e.target.checked })} /> Minutes on file</label>
              <label className="mm-chk"><input type="checkbox" checked={!!d.attendance_attached} onChange={(e) => set({ attendance_attached: e.target.checked })} /> Attendance list on file</label>
            </L>
          </div>
          <div className="mm-sublbl">Shortfalls in quality (tick all that apply)</div>
          <div className="mm-shorts">
            {MM_SHORTFALLS.map((s) => (
              <label key={s} className={`mm-shortchip ${s in shortfalls ? 'on' : ''}`}>
                <input type="checkbox" checked={s in shortfalls} onChange={() => toggleShort(s)} />{s}
              </label>
            ))}
          </div>

          <div className="mm-sec">HOD review · Part 4</div>
          <div className="mm-grid">
            <L label="HOD comments"><input value={d.hod_comments ?? ''} onChange={(e) => set({ hod_comments: e.target.value })} /></L>
            <L label="Reviewed by"><input value={d.hod_reviewed_by ?? ''} onChange={(e) => set({ hod_reviewed_by: e.target.value })} /></L>
            <L label="HOD verified date"><input type="date" value={d.hod_verified_date ?? ''} onChange={(e) => set({ hod_verified_date: e.target.value || null })} /></L>
            <L label="HOD certification"><label className="mm-chk"><input type="checkbox" checked={!!d.hod_certification} onChange={(e) => set({ hod_certification: e.target.checked })} /> Certified</label></L>
          </div>

          <div className="mm-sec">Gate 2 · Hospital-level meeting recommended?</div>
          <div className="mm-grid">
            <L label="Gate 2 decision">
              <select value={yn(d.gate2_hospital_meeting_recommended)} onChange={(e) => setYn('gate2_hospital_meeting_recommended', e.target.value)}>
                <option value="">—</option><option value="yes">Yes — hospital level</option><option value="no">No — close at secretariat</option>
              </select>
            </L>
            {d.gate2_hospital_meeting_recommended === true && (
              <>
                <L label="Subcommittee"><input value={d.subcommittee ?? ''} onChange={(e) => set({ subcommittee: e.target.value })} /></L>
                <L label="Presented at hospital (date)"><input type="date" value={d.presented_at_hospital_date ?? ''} onChange={(e) => set({ presented_at_hospital_date: e.target.value || null })} /></L>
              </>
            )}
          </div>

          <div className="mm-sec">Dissemination · MSQH evidence</div>
          <div className="mm-grid">
            <L label="Learning points disseminated"><label className="mm-chk"><input type="checkbox" checked={!!d.learning_points_disseminated} onChange={(e) => set({ learning_points_disseminated: e.target.checked })} /> Yes</label></L>
            <L label="Dissemination date"><input type="date" value={d.dissemination_date ?? ''} onChange={(e) => set({ dissemination_date: e.target.value || null })} /></L>
            <L label="Method"><input value={d.dissemination_method ?? ''} placeholder="e.g. dept teaching, circular" onChange={(e) => set({ dissemination_method: e.target.value })} /></L>
          </div>
        </>
      )}

      <div className="mm-sec">Case status</div>
      <div className="mm-grid">
        <L label="Status">
          <select value={d.status ?? 'Untriaged'} onChange={(e) => set({ status: e.target.value as MmCase['status'] })}>
            {MM_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </L>
        <L label="Notes"><input value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></L>
      </div>

      <div className="mm-formnav">
        <button type="button" className="mm-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="mm-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save case'}</button>
      </div>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mm-field"><label>{label}</label>{children}</div>
}
