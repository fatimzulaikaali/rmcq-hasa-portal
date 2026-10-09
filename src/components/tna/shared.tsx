'use client'

/* Shared data shape + small UI pieces for the /tna portal module. */
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  TnaAssignment, TnaCompetency, TnaCycle, TnaItem, TnaLevel, TnaPosition, TnaRequirement, TnaStaff, TnaUnit,
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
