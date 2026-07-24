'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MM_ASSESS_FIELDS, MM_SHORTFALLS, MM_ACTION_TYPES, MM_ACTION_STATUSES,
  isDocumented, effectiveActionStatus,
  type MmCase, type MmAction, type MmCaseShortfall, type MmDepartment,
} from '@/lib/mm/types'

/* Read-only workflow view of one case: the five-part path with the two gates,
 * clinical-assessment chips, the quality action plan (add / edit inline), and
 * the PI 01 documentation panel. */

export function MmCaseView({
  supabase, c, dept, shortfalls, actions, onEdit, onChanged,
}: {
  supabase: SupabaseClient
  c: MmCase
  dept: MmDepartment | undefined
  shortfalls: MmCaseShortfall[]
  actions: MmAction[]
  onEdit: () => void
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [na, setNa] = useState<Partial<MmAction>>({ action_level: 'System', action_type: 'Policy/SOP', status: 'Open' })
  const [busy, setBusy] = useState(false)

  type Step = { cls: string; num: string; t: string; d: string; gate?: string }
  const steps: Step[] = []
  const done = 'n-done', active = 'n-active', skip = 'n-skip'
  steps.push({ cls: done, num: '1', t: 'Part 1–2 · Clinical assessment', d: 'Recorded by physician in charge' })
  if (c.status === 'Untriaged') {
    steps.push({ cls: active, num: '?', t: 'Gate 1 · Awaiting triage decision', d: 'Dept-level M&M meeting required?', gate: '⏳ Not yet triaged — counts as compliance gap' })
  } else if (c.gate1_dept_meeting_required === false) {
    steps.push({ cls: skip, num: '—', t: 'Gate 1 · No formal review', d: 'Documented reason: ' + (c.no_review_reason || 'expected/BID'), gate: 'Logged with reason — kept in denominator' })
    steps.push({ cls: done, num: '✓', t: 'Closed at secretariat', d: 'No further review required' })
  } else {
    steps.push({ cls: done, num: '3', t: 'Part 3 · Departmental M&M review', d: `Category: ${c.category_of_death || '—'}${c.meeting_date ? ' · meeting ' + c.meeting_date : ''}` })
    steps.push({ cls: c.hod_verified_date ? done : active, num: '4', t: 'Part 4 · HOD review', d: c.hod_verified_date ? 'Verified by HOD' : 'Awaiting HOD verification' })
    if (c.gate2_hospital_meeting_recommended === true) {
      steps.push({ cls: c.status === 'Hospital-level' ? active : done, num: '5', t: 'Part 5 · Hospital-level committee', d: 'Selected case — subcommittee → committee', gate: 'Gate 2: recommended for hospital-level presentation' })
    } else if (c.gate2_hospital_meeting_recommended === false) {
      steps.push({ cls: done, num: '5', t: 'Part 5A · Subcommittee review', d: 'Not recommended for hospital level → closed at secretariat' })
    }
    if (c.status === 'Actions open') steps.push({ cls: active, num: '6', t: 'Action plan · in progress', d: 'Recommendations tracked to closure' })
  }

  const chips = MM_ASSESS_FIELDS
    .filter((f) => c[f.key] === true || c[f.key] === false)
    .map((f) => {
      const yes = c[f.key] === true
      const bad = yes && f.flagOnYes
      return { label: f.label, val: yes ? 'Yes' : 'No', bad }
    })

  const numerator = isDocumented(c) && c.gate1_dept_meeting_required === true

  async function addAction() {
    if (!na.description?.trim()) return
    setBusy(true)
    await supabase.from('mm_actions').insert({
      case_id: c.id, description: na.description, responsible: na.responsible ?? null,
      action_level: na.action_level ?? null, action_type: na.action_type ?? null,
      due_date: na.due_date ?? null, status: na.status ?? 'Open',
      linked_shortfall: na.linked_shortfall ?? null, closure_evidence: na.closure_evidence ?? null,
    })
    setNa({ action_level: 'System', action_type: 'Policy/SOP', status: 'Open' }); setAdding(false); setBusy(false)
    onChanged()
  }
  async function setActionStatus(a: MmAction, status: string) {
    await supabase.from('mm_actions').update({ status }).eq('id', a.id)
    onChanged()
  }

  const badgeClass: Record<string, string> = { Overdue: 'b-crit', 'In progress': 'b-warn', Open: 'b-neut', Completed: 'b-good' }

  return (
    <div>
      <div className="mm-viewhead">
        <div>
          <div className="mm-viewtitle">{c.case_no} · {c.report_type}</div>
          <div className="mm-viewsub">{dept?.name ?? c.dept_code ?? '—'} · {c.age ?? '<1'} / {c.sex ?? '?'} · Ward {c.ward ?? '—'} · LOS {c.los_days ?? '—'} day(s)</div>
        </div>
        <button type="button" className="mm-btn primary" onClick={onEdit}>Edit case</button>
      </div>

      <div className="mm-sec">Workflow status</div>
      <div className="flow">
        {steps.map((s, i) => (
          <div key={i} className={`step ${s.cls === 'n-done' ? 'done' : ''}`}>
            <div className={`node ${s.cls}`}>{s.num}</div>
            <div><div className="st-t">{s.t}</div><div className="st-d">{s.d}</div>{s.gate && <div className="gate">{s.gate}</div>}</div>
          </div>
        ))}
      </div>

      {chips.length > 0 && (
        <>
          <div className="mm-sec">Clinical assessment (Part 2)</div>
          <div>{chips.map((ch, i) => <span key={i} className={`chip ${ch.bad ? 'bad' : ''}`}>{ch.label}: {ch.val}</span>)}</div>
        </>
      )}

      {shortfalls.length > 0 && (
        <>
          <div className="mm-sec">Shortfalls in quality</div>
          <div>{shortfalls.map((s) => <span key={s.shortfall} className="chip bad">{s.shortfall}{s.specify ? ` — ${s.specify}` : ''}</span>)}</div>
        </>
      )}

      {c.gate1_dept_meeting_required !== false && (
        <>
          <div className="mm-sec" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Quality Improvement Action Plan (Part 3)</span>
            {!adding && <button type="button" className="mm-btn sm" onClick={() => setAdding(true)}>+ Add action</button>}
          </div>
          {actions.length === 0 && !adding && <div className="note">No action plan recorded yet.</div>}
          {actions.map((a) => {
            const st = effectiveActionStatus(a)
            return (
              <div className="note" key={a.id} style={{ marginTop: 8 }}>
                <b>{a.description}</b><br />
                <span style={{ color: 'var(--muted)' }}>Owner:</span> {a.responsible ?? '—'} ·{' '}
                <span className={`badge ${a.action_level === 'System' ? 'b-blue' : 'b-neut'}`}>{a.action_level ?? '—'}</span> ·{' '}
                {a.action_type ?? '—'} · Due {a.due_date ?? '—'} ·{' '}
                <select className="mm-inline-status" value={a.status} onChange={(e) => setActionStatus(a, e.target.value)}>
                  {MM_ACTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>{' '}
                <span className={`badge ${badgeClass[st]}`}>{st}</span>
                {a.linked_shortfall && <><br /><span className="chip">↳ {a.linked_shortfall}</span></>}
              </div>
            )
          })}
          {adding && (
            <div className="note" style={{ marginTop: 8 }}>
              <div className="mm-grid">
                <L label="Action description"><input value={na.description ?? ''} onChange={(e) => setNa({ ...na, description: e.target.value })} /></L>
                <L label="Responsible"><input value={na.responsible ?? ''} onChange={(e) => setNa({ ...na, responsible: e.target.value })} /></L>
                <L label="Level"><select value={na.action_level ?? 'System'} onChange={(e) => setNa({ ...na, action_level: e.target.value as MmAction['action_level'] })}><option>System</option><option>Individual</option></select></L>
                <L label="Type"><select value={na.action_type ?? ''} onChange={(e) => setNa({ ...na, action_type: e.target.value })}>{MM_ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
                <L label="Due date"><input type="date" value={na.due_date ?? ''} onChange={(e) => setNa({ ...na, due_date: e.target.value })} /></L>
                <L label="Linked shortfall"><select value={na.linked_shortfall ?? ''} onChange={(e) => setNa({ ...na, linked_shortfall: e.target.value || null })}><option value="">—</option>{MM_SHORTFALLS.map((s) => <option key={s}>{s}</option>)}</select></L>
              </div>
              <div className="mm-formnav" style={{ marginTop: 10 }}>
                <button type="button" className="mm-btn" onClick={() => setAdding(false)}>Cancel</button>
                <button type="button" className="mm-btn primary" disabled={busy} onClick={addAction}>{busy ? 'Adding…' : 'Add action'}</button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mm-sec">MSQH PI 01 documentation</div>
      <div className="kv">
        <div><div className="k">Counts toward numerator?</div>
          {numerator ? <span className="badge b-good">Yes — discussed &amp; documented</span>
            : <span className="badge b-neut">No — {c.status === 'Untriaged' ? 'not yet reviewed' : c.gate1_dept_meeting_required === false ? 'no review needed' : 'documentation incomplete'}</span>}
        </div>
        <div><div className="k">Learning points disseminated</div>
          {c.learning_points_disseminated ? `✓ ${c.dissemination_date ?? ''} ${c.dissemination_method ? '· ' + c.dissemination_method : ''}` : '—'}</div>
      </div>
      <div className="note" style={{ marginTop: 14 }}>
        <b>Privacy:</b> this case is keyed by number only. No patient name or NRIC is stored — the case number is the bridge to the secured mortality list.
      </div>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mm-field"><label>{label}</label>{children}</div>
}
