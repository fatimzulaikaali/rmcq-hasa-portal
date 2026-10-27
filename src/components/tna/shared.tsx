'use client'

/* Shared data shape + small UI pieces for the /tna portal module. */
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  TnaAssignment, TnaCompetency, TnaCycle, TnaItem, TnaLevel, TnaPosition, TnaProgramme, TnaRequest, TnaRequirement,
  TnaStaff, TnaTemplateRow, TnaUnit,
} from '@/lib/tna/types'

export interface PriorityRow {
  cycle_id: number; competency_code: string; staff_required: number; staff_validated: number
  staff_with_gap: number; gap_points: number; staff_never_exposed: number
  impact: number; strategic: number; gap_score: number
}

export interface TnaData {
  cycle: TnaCycle
  cycles: TnaCycle[]
  units: TnaUnit[]
  positions: TnaPosition[]
  reqs: TnaRequirement[]
  comps: TnaCompetency[]
  levels: TnaLevel[]
  staff: TnaStaff[]
  asg: TnaAssignment[]
  items: TnaItem[]
  priority: PriorityRow[]
  requests: TnaRequest[]
  template: TnaTemplateRow[]
  programmes: TnaProgramme[]
}

export interface TabProps {
  data: TnaData
  supabase: SupabaseClient
  userId: string
  reload: () => Promise<void>
  flash: (msg: string, kind?: 'ok' | 'err') => void
}

/** Page through a table 1000 rows at a time (Supabase caps a single read). */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export function L({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mm-field">
      <label>{label}</label>
      {children}
      {hint && <span className="tna-muted">{hint}</span>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="mm-modal-bg" onClick={onClose}>
      <div className="mm-modal" style={wide ? { maxWidth: 1000 } : { maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="mm-modal-head"><h3>{title}</h3><button type="button" className="x" aria-label="Tutup" onClick={onClose}>×</button></div>
        <div className="mm-modal-body">{children}</div>
      </div>
    </div>
  )
}

/** Lookup helpers built once per render of a tab. */
export function indexData(d: TnaData) {
  const posById = new Map(d.positions.map((p) => [p.id, p]))
  const staffById = new Map(d.staff.map((s) => [s.id, s]))
  const compByCode = new Map(d.comps.map((c) => [c.code, c]))
  const unitByCode = new Map(d.units.map((u) => [u.code, u]))
  const liveAsg = d.asg.filter((a) => a.status !== 'archived')
  const asgByPos = new Map(liveAsg.map((a) => [a.position_id, a]))
  const reqsByPos = new Map<number, TnaRequirement[]>()
  for (const r of d.reqs) {
    const l = reqsByPos.get(r.position_id) ?? []
    l.push(r); reqsByPos.set(r.position_id, l)
  }
  const itemsByAsg = new Map<number, Map<string, TnaItem>>()
  for (const i of d.items) {
    const m = itemsByAsg.get(i.assignment_id) ?? new Map<string, TnaItem>()
    m.set(i.competency_code, i); itemsByAsg.set(i.assignment_id, m)
  }
  const kjAsg = liveAsg.find((a) => posById.get(a.position_id)?.role_type === 'KJ')
  const positionsSorted = d.positions.filter((p) => p.active).slice().sort((a, b) =>
    (unitByCode.get(a.unit_code)?.sort_order ?? 0) - (unitByCode.get(b.unit_code)?.sort_order ?? 0) || a.sort_order - b.sort_order)
  return { posById, staffById, compByCode, unitByCode, liveAsg, asgByPos, reqsByPos, itemsByAsg, kjAsg, positionsSorted }
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

/** Load everything the TNA module needs for the latest cycle. Throws on any query error. */
export async function loadTnaData(supabase: SupabaseClient): Promise<TnaData | null> {
  const cy = await supabase.from('tna_cycles').select('*').order('year', { ascending: false })
  if (cy.error) throw cy.error
  const cycles = (cy.data ?? []) as TnaCycle[]
  const cycle = cycles[0]
  if (!cycle) return null
  const [units, positions, comps, staff, asg, template, programmes] = await Promise.all([
    supabase.from('tna_units').select('*').eq('active', true).order('sort_order'),
    supabase.from('tna_positions').select('*').eq('cycle_id', cycle.id).order('sort_order'),
    supabase.from('tna_competencies').select('*').order('layer', { ascending: false }).order('sort_order'),
    supabase.from('tna_staff').select('*').order('name'),
    supabase.from('tna_assignments').select('*').eq('cycle_id', cycle.id),
    supabase.from('tna_dept_template').select('*').eq('cycle_id', cycle.id).order('sort_order'),
    supabase.from('tna_programmes').select('*').eq('cycle_id', cycle.id).order('source_section').order('id'),
  ])
  const e1 = [units.error, positions.error, comps.error, staff.error, asg.error, template.error, programmes.error].find(Boolean)
  if (e1) throw e1
  const posIds = ((positions.data ?? []) as TnaPosition[]).map((p) => p.id)
  const asgIds = ((asg.data ?? []) as TnaAssignment[]).map((a) => a.id)
  const [levels, reqs, items, priority, requests] = await Promise.all([
    fetchAll<TnaLevel>((f, t) => supabase.from('tna_competency_levels').select('*').order('competency_code').order('level').range(f, t)),
    posIds.length ? fetchAll<TnaRequirement>((f, t) => supabase.from('tna_position_requirements').select('*').in('position_id', posIds).order('position_id').order('competency_code').range(f, t)) : Promise.resolve([] as TnaRequirement[]),
    asgIds.length ? fetchAll<TnaItem>((f, t) => supabase.from('tna_assessment_items').select('*').in('assignment_id', asgIds).order('assignment_id').order('competency_code').range(f, t)) : Promise.resolve([] as TnaItem[]),
    fetchAll<PriorityRow>((f, t) => supabase.from('tna_v_competency_priority').select('*').eq('cycle_id', cycle.id).order('competency_code').range(f, t)),
    asgIds.length ? fetchAll<TnaRequest>((f, t) => supabase.from('tna_course_requests').select('*').in('assignment_id', asgIds).order('assignment_id').order('sort_order').range(f, t)) : Promise.resolve([] as TnaRequest[]),
  ])
  return {
    cycle, cycles,
    units: (units.data ?? []) as TnaUnit[],
    positions: (positions.data ?? []) as TnaPosition[],
    comps: (comps.data ?? []) as TnaCompetency[],
    staff: (staff.data ?? []) as TnaStaff[],
    asg: (asg.data ?? []) as TnaAssignment[],
    template: (template.data ?? []) as TnaTemplateRow[],
    programmes: ((programmes.data ?? []) as TnaProgramme[]).map((p) => ({ ...p, planned_months: p.planned_months ?? [] })),
    levels, reqs, items, priority, requests,
  }
}

/** Read-only table of a staff member's course requests (portal + reports). */
export function RequestsTable({ list, comps, showStaff }: {
  list: (TnaRequest & { staffName?: string })[]; comps: Map<string, { name_ms: string }>; showStaff?: boolean
}) {
  if (!list.length) return <p className="tna-muted">Tiada permohonan kursus.</p>
  const months = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis']
  return (
    <div className="vd-scroll"><table className="vd-table tna-ptable">
      <thead><tr><th>Bil.</th>{showStaff && <th>Staf</th>}<th>Kursus / latihan</th><th>Penganjur</th><th>Kompetensi</th><th>Sebab</th><th>Bulan</th><th>Kos (RM)</th><th>Keutamaan</th></tr></thead>
      <tbody>{list.map((q, i) => (
        <tr key={q.id}>
          <td>{i + 1}</td>{showStaff && <td>{q.staffName ?? '—'}</td>}
          <td><b>{q.title_ms}</b></td><td>{q.provider_ms ?? '—'}</td>
          <td>{q.competency_code ? `${q.competency_code} · ${comps.get(q.competency_code)?.name_ms ?? ''}` : 'Lain-lain'}</td>
          <td>{q.reason_ms ?? '—'}</td><td>{q.preferred_month ? months[q.preferred_month - 1] : '—'}</td>
          <td>{q.est_cost_rm != null ? Number(q.est_cost_rm).toLocaleString('ms-MY') : '—'}</td><td>{q.priority ?? '—'}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}
