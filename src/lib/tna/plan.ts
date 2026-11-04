/* Pelan Latihan — turns the validated TNA into a year plan:
 *  A. CQE Jabatan: every "CQE…" course in the Kamus, mandatory for all RMCQ staff (tna_cqe_sessions).
 *  B. Pelan Latihan Individu: one row per staff × course (tna_training_records) =
 *     staff requests that are in the TNA + non-CQE Kamus suggestions for a gap with no included request. */
import type { TnaData } from '@/components/tna/shared'
import { MONTHS, RECORD_STATUS, isCqe, requestInTna, trainingTypeOf, type TnaTrainingRecord, type TrainingType } from './types'
import { splitTraining, staffReports, type StaffReport } from './report'

export interface ProposedRecord {
  assignment_id: number; request_id: number | null; competency_code: string | null; external_title_ms: string
  provider_ms: string | null; training_type: TrainingType; est_cost_rm: number | null; planned_month: number | null
  plan_source: 'permohonan' | 'kamus'
}
const key = (r: { assignment_id: number; request_id: number | null; competency_code: string | null; external_title_ms: string | null }) =>
  r.request_id != null ? `q${r.request_id}` : `${r.assignment_id}|${r.competency_code ?? ''}|${(r.external_title_ms ?? '').trim().toLowerCase()}`

export function proposePlan(d: TnaData, reps: StaffReport[] = staffReports(d)): ProposedRecord[] {
  const out: ProposedRecord[] = []
  for (const r of reps) {
    if (!r.validated) continue
    const gapCodes = new Set(r.gaps.map((g) => g.c.code))
    const covered = new Set<string>()
    for (const q of r.requests) {
      const supports = !!q.competency_code && gapCodes.has(q.competency_code)
      if (!requestInTna(q, supports)) continue
      if (q.competency_code) covered.add(q.competency_code)
      out.push({
        assignment_id: r.a.id, request_id: q.id, competency_code: q.competency_code, external_title_ms: q.title_ms.trim(),
        provider_ms: q.provider_ms, training_type: trainingTypeOf(q), est_cost_rm: q.est_cost_rm, planned_month: q.preferred_month, plan_source: 'permohonan',
      })
    }
    for (const g of r.gaps) {
      if (covered.has(g.c.code)) continue
      for (const t of splitTraining(g.c.default_training_ms).filter((x) => !isCqe(x))) {
        out.push({
          assignment_id: r.a.id, request_id: null, competency_code: g.c.code, external_title_ms: t,
          provider_ms: null, training_type: 'dalaman', est_cost_rm: null, planned_month: null, plan_source: 'kamus',
        })
      }
    }
  }
  return out
}
/** Proposed rows not yet in the plan (existing rows — and their status — are never touched). */
export function missingRecords(d: TnaData): ProposedRecord[] {
  const have = new Set(d.training.map(key))
  return proposePlan(d).filter((p) => !have.has(key(p)))
}
/** Records that came from a request which is no longer in the TNA (e.g. KJ later chose "Tangguh"). */
export function staleRecordIds(d: TnaData): Set<number> {
  const proposed = new Set(proposePlan(d).filter((p) => p.request_id != null).map((p) => p.request_id))
  return new Set(d.training.filter((t) => t.request_id != null && !proposed.has(t.request_id)).map((t) => t.id))
}

export interface PlanStats { total: number; attended: number; pct: number; cost: number; cqeTotal: number; cqeDone: number }
export function planStats(d: TnaData): PlanStats {
  const live = d.training.filter((t) => t.status !== 'cancelled' && t.status !== 'rejected')
  const attended = live.filter((t) => t.status === 'attended' || t.status === 'verified').length
  return {
    total: live.length, attended, pct: live.length ? Math.round((attended / live.length) * 100) : 0,
    cost: live.reduce((s, t) => s + Number(t.est_cost_rm ?? 0), 0),
    cqeTotal: d.cqe.length, cqeDone: d.cqe.filter((c) => c.status === 'selesai').length,
  }
}

/* ---- Excel ---- */
type Cell = string | number | null
export function sheetCqe(d: TnaData) {
  const unit = new Map(d.units.map((u) => [u.code, u.name_ms]))
  const rows: Cell[][] = [['Bil.', 'CQE (wajib semua staf RMCQ)', 'Unit penganjur', ...MONTHS, 'Tarikh sebenar', 'Status', 'Bil. hadir', 'Catatan']]
  d.cqe.forEach((c, i) => rows.push([
    i + 1, c.title_ms, c.organiser_unit ? unit.get(c.organiser_unit) ?? c.organiser_unit : null,
    ...MONTHS.map((_, m) => (c.planned_month === m + 1 ? '●' : null)),
    c.actual_date, c.status === 'selesai' ? 'Selesai' : c.status === 'ditangguh' ? 'Ditangguh' : 'Dirancang', c.attendees, c.notes_ms,
  ]))
  return { name: 'Kalendar CQE', rows, widths: [5, 50, 30, ...MONTHS.map(() => 5), 13, 11, 9, 30] }
}
export function sheetPlan(d: TnaData) {
  const reps = new Map(staffReports(d).map((r) => [r.a.id, r]))
  const comp = new Map(d.comps.map((c) => [c.code, c.name_ms]))
  const rows: Cell[][] = [['Bil.', 'No. Staf', 'Nama', 'Jawatan', 'Unit', 'Kursus / latihan', 'Penganjur', 'Dalaman / Luaran', 'Kompetensi', 'Sumber', 'Bulan dirancang', 'Anggaran kos (RM)', 'Status', 'Tarikh hadir', 'Catatan']]
  const list = [...d.training].sort((a, b) => (reps.get(a.assignment_id)?.s.name ?? '').localeCompare(reps.get(b.assignment_id)?.s.name ?? '') || (a.planned_month ?? 13) - (b.planned_month ?? 13))
  list.forEach((t, i) => {
    const r = reps.get(t.assignment_id)
    rows.push([
      i + 1, r?.s.staff_no ?? null, r?.s.name ?? null, r?.p.title_ms ?? null, r?.p.unit_code ?? null,
      t.external_title_ms, t.provider_ms, t.training_type === 'luaran' ? 'Luaran' : 'Dalaman',
      t.competency_code ? comp.get(t.competency_code) ?? null : null,
      t.plan_source === 'permohonan' ? 'Permohonan staf' : t.plan_source === 'kamus' ? 'Cadangan Kamus' : 'Tambahan manual',
      t.planned_month ? MONTHS[t.planned_month - 1] : null, t.est_cost_rm != null ? Number(t.est_cost_rm) : null,
      RECORD_STATUS[t.status], t.course_date, t.notes_ms,
    ])
  })
  return { name: 'Pelan Latihan Individu', rows, widths: [5, 10, 28, 22, 8, 45, 22, 11, 30, 14, 10, 11, 13, 12, 30] }
}
export type { TnaTrainingRecord }
