/* Pure report builders for the TNA module — shared by the print pages and the Excel exports.
 * Everything is derived from TnaData so a printout and its Excel always agree. */
import type { TnaData } from '@/components/tna/shared'
import {
  CLUSTERS, LEVEL_NAME, MONTHS, STATUS_LABEL, clusterOrder, gapScore, priorityLabel, progPriority, progScore, quarterFor,
  type TnaAssignment, type TnaCompetency, type TnaPosition, type TnaRequest, type TnaStaff,
} from './types'

export interface StaffItem {
  c: TnaCompetency; required: number; self: number | null; agreed: number | null
  gap: number | null; never: boolean; selfNote: string | null; supNote: string | null
}
export interface StaffReport {
  a: TnaAssignment; s: TnaStaff; p: TnaPosition; unitName: string
  items: StaffItem[]; requests: TnaRequest[]; validated: boolean
  gaps: StaffItem[]; neverCount: number
}

export const lv = (v: number | null | undefined) => (v ? `${v} · ${LEVEL_NAME[v]}` : '—')
export const clusterLabel = (k: string) => CLUSTERS.find((x) => x.key === k)?.label ?? k

/** One report per live (non-archived) assignment, in position order. */
export function staffReports(d: TnaData): StaffReport[] {
  const unitName = new Map(d.units.map((u) => [u.code, u.name_ms]))
  const unitSort = new Map(d.units.map((u) => [u.code, u.sort_order]))
  const comp = new Map(d.comps.map((c) => [c.code, c]))
  const staff = new Map(d.staff.map((s) => [s.id, s]))
  const pos = new Map(d.positions.map((p) => [p.id, p]))
  const out: StaffReport[] = []
  for (const a of d.asg) {
    if (a.status === 'archived') continue
    const s = staff.get(a.staff_id); const p = pos.get(a.position_id)
    if (!s || !p) continue
    const validated = a.status === 'validated'
    const its = new Map(d.items.filter((i) => i.assignment_id === a.id).map((i) => [i.competency_code, i]))
    const items: StaffItem[] = d.reqs.filter((r) => r.position_id === p.id).map((r) => {
      const c = comp.get(r.competency_code)!
      const it = its.get(r.competency_code)
      const agreed = validated ? it?.agreed_level ?? null : null
      return {
        c, required: r.required_level, self: it?.self_level ?? null, agreed,
        gap: agreed == null ? null : Math.max(0, r.required_level - agreed),
        never: !!it?.never_exposed, selfNote: it?.self_note ?? null, supNote: it?.supervisor_note ?? null,
      }
    }).filter((x) => x.c)
      .sort((x, y) => clusterOrder(x.c.cluster) - clusterOrder(y.c.cluster) || x.c.sort_order - y.c.sort_order)
    const gaps = items.filter((x) => (x.gap ?? 0) > 0)
    out.push({
      a, s, p, unitName: unitName.get(p.unit_code) ?? p.unit_code, items, validated, gaps,
      neverCount: items.filter((x) => x.never).length,
      requests: d.requests.filter((q) => q.assignment_id === a.id).sort((x, y) => x.sort_order - y.sort_order),
    })
  }
  return out.sort((x, y) => (unitSort.get(x.p.unit_code) ?? 0) - (unitSort.get(y.p.unit_code) ?? 0) || x.p.sort_order - y.p.sort_order)
}

export interface GapLine {
  c: TnaCompetency; required: number; validated: number; withGap: StaffReport[]; points: number; never: number
  impact: number; strategic: number; gapScore: number; score: number | null; label: string; quarter: string
}
/** Gap & priority per competency across a set of staff (validated assessments only). */
export function gapLines(d: TnaData, reps: StaffReport[]): GapLine[] {
  const pin = new Map(d.priority.map((r) => [r.competency_code, r]))
  const byCode = new Map<string, GapLine>()
  for (const r of reps) for (const it of r.items) {
    let g = byCode.get(it.c.code)
    if (!g) {
      const pi = pin.get(it.c.code)
      g = { c: it.c, required: 0, validated: 0, withGap: [], points: 0, never: 0, impact: pi?.impact ?? 2, strategic: pi?.strategic ?? 2, gapScore: 0, score: null, label: '', quarter: '' }
      byCode.set(it.c.code, g)
    }
    g.required++
    if (it.gap != null) {
      g.validated++
      if (it.gap > 0) { g.withGap.push(r); g.points += it.gap; if (it.never) g.never++ }
    }
  }
  const out = Array.from(byCode.values())
  for (const g of out) {
    g.gapScore = gapScore(g.withGap.length, g.points, g.never)
    g.score = g.validated ? g.gapScore * g.impact * g.strategic : null
    g.label = priorityLabel(g.score)
    g.quarter = quarterFor(g.label)
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || clusterOrder(a.c.cluster) - clusterOrder(b.c.cluster) || a.c.sort_order - b.c.sort_order)
}

export interface TplCore { c: TnaCompetency; max: number }
export interface TplTraining { training: string; codes: string[]; staff: number }
export interface TplGroup { label: 'Tinggi' | 'Sederhana' | 'Rendah'; quarter: string; items: TplTraining[] }
export interface TplDetail { g: GapLine; staff: { name: string; from: number; to: number; never: boolean }[] }
export interface TplUnit {
  members: StaffReport[]; assessed: boolean; core: TplCore[]
  groups: TplGroup[]; details: TplDetail[]; G: string; H: string
}

/** One unit's row of the hospital 8-column template, structured.
 *  G = what the unit must be competent in (core functional competencies, highest level in unit).
 *  H = training to close the validated gaps, grouped by priority → quarter, one line per course.
 *  details = the evidence behind H (who has which gap) for the appendix table. */
export function templateUnit(d: TnaData, unitCode: string | null, reps: StaffReport[], initialTraining: string | null): TplUnit {
  const members = reps.filter((r) => r.p.unit_code === unitCode)
  const coreMap = new Map<string, TplCore>()
  for (const r of members) for (const it of r.items) {
    const isCore = unitCode === 'KJ'
      ? it.c.cluster === 'Kepimpinan' || it.c.code === 'GN1' || it.c.cluster === 'Merentas RMCQ'
      : it.c.cluster === 'Kefungsian Unit' && (it.c.unit_code === unitCode || it.c.unit_code == null)
    if (!isCore) continue
    const cur = coreMap.get(it.c.code)
    if (!cur || it.required > cur.max) coreMap.set(it.c.code, { c: it.c, max: it.required })
  }
  const core = Array.from(coreMap.values()).sort((a, b) => clusterOrder(a.c.cluster) - clusterOrder(b.c.cluster) || a.c.sort_order - b.c.sort_order)
  const assessed = members.some((r) => r.validated)
  const lines = gapLines(d, members).filter((g) => g.withGap.length > 0)
  const groups: TplGroup[] = (['Tinggi', 'Sederhana', 'Rendah'] as const).map((label) => {
    const byTraining = new Map<string, TplTraining>()
    for (const g of lines.filter((x) => x.label === label)) {
      const key = (g.c.default_training_ms ?? g.c.name_ms).trim()
      const t = byTraining.get(key) ?? { training: key, codes: [], staff: 0 }
      t.codes.push(g.c.code); t.staff = Math.max(t.staff, g.withGap.length)
      byTraining.set(key, t)
    }
    return { label, quarter: quarterFor(label), items: Array.from(byTraining.values()) }
  }).filter((x) => x.items.length)
  const details: TplDetail[] = lines.map((g) => ({
    g, staff: g.withGap.map((r) => {
      const it = r.items.find((x) => x.c.code === g.c.code)!
      return { name: r.s.name, from: it.agreed!, to: it.required, never: it.never }
    }),
  }))

  const G = [
    unitCode === 'KJ' ? 'Kepimpinan & pengurusan:' : 'Kefungsian unit:',
    ...(core.length ? core.map((x) => `• ${x.c.code} ${x.c.name_ms} — ${LEVEL_NAME[x.max]}`) : ['• (tiada kompetensi kefungsian khusus)']),
    '', 'Asas RMCQ, Nilai, Teras & Generik UiTM: ikut gred jawatan.',
  ].join('\n')
  const H = !members.length ? 'Tiada staf dalam unit.'
    : !assessed ? ['(Cadangan awal — dikemas kini selepas penilaian disahkan)', initialTraining ?? ''].join('\n').trim()
      : !groups.length ? 'Tiada jurang — latihan pengekalan sahaja.'
        : groups.map((gr) => [`KEUTAMAAN ${gr.label.toUpperCase()} — ${gr.quarter}`,
          ...gr.items.map((t) => `• ${t.training} (${t.codes.join(', ')}; ${t.staff} staf)`)].join('\n')).join('\n\n')
  return { members, assessed, core, groups, details, G, H }
}
/** Back-compat: plain-text G & H (Excel / portal preview). */
export function templateGH(d: TnaData, unitCode: string | null, reps: StaffReport[], initialTraining: string | null) {
  const u = templateUnit(d, unitCode, reps, initialTraining)
  return { G: u.G, H: u.H }
}

export interface CalLine { kind: 'Jabatan' | 'Hospital' | 'Permohonan staf'; title: string; detail: string; months: number[]; quarter: string; priority: string; cost: number | null }
/** Training calendar: department gap training (by quarter), hospital programmes and staff course requests. */
export function calendar(d: TnaData, reps: StaffReport[]): CalLine[] {
  const staffById = new Map(reps.map((r) => [r.a.id, r.s.name]))
  const dept: CalLine[] = gapLines(d, reps).filter((g) => g.withGap.length > 0).map((g) => ({
    kind: 'Jabatan', title: g.c.default_training_ms ?? g.c.name_ms,
    detail: `${g.c.code} ${g.c.name_ms} — ${g.withGap.map((r) => r.s.name).join('; ')}`,
    months: [], quarter: g.quarter, priority: g.label, cost: null,
  }))
  const hosp: CalLine[] = d.programmes.filter((p) => p.scope === 'hospital' && p.status === 'active').map((p) => ({
    kind: 'Hospital', title: p.title_ms, detail: [p.owner_ms, p.target_group_ms].filter(Boolean).join(' · '),
    months: p.planned_months, quarter: '', priority: progPriority(p), cost: p.est_cost_rm,
  }))
  const reqs: CalLine[] = d.requests.filter((q) => staffById.has(q.assignment_id)).map((q) => ({
    kind: 'Permohonan staf', title: q.title_ms, detail: [staffById.get(q.assignment_id), q.provider_ms].filter(Boolean).join(' · '),
    months: q.preferred_month ? [q.preferred_month] : [], quarter: '', priority: q.priority ?? '—', cost: q.est_cost_rm,
  }))
  return [...dept, ...hosp, ...reqs]
}

/* ---------------- Excel (SheetJS) ---------------- */
type Cell = string | number | null
type SheetSpec = { name: string; rows: Cell[][]; widths?: number[] }

export async function downloadXlsx(fileName: string, sheets: SheetSpec[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sh of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sh.rows)
    if (sh.widths) ws['!cols'] = sh.widths.map((w) => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}

export function sheetRequests(d: TnaData, reps: StaffReport[]): SheetSpec {
  const comp = new Map(d.comps.map((c) => [c.code, c.name_ms]))
  const rows: Cell[][] = [['Bil.', 'No. Staf', 'Nama', 'Jawatan', 'Unit', 'Kursus / latihan', 'Penganjur', 'Kod kompetensi', 'Kompetensi', 'Sebab / justifikasi', 'Bulan', 'Anggaran kos (RM)', 'Keutamaan']]
  let n = 0
  for (const r of reps) for (const q of r.requests) rows.push([
    ++n, r.s.staff_no, r.s.name, r.p.title_ms, r.p.unit_code, q.title_ms, q.provider_ms, q.competency_code,
    q.competency_code ? comp.get(q.competency_code) ?? '' : 'Lain-lain', q.reason_ms,
    q.preferred_month ? MONTHS[q.preferred_month - 1] : null, q.est_cost_rm != null ? Number(q.est_cost_rm) : null, q.priority,
  ])
  return { name: 'Permohonan Kursus', rows, widths: [5, 10, 28, 22, 8, 40, 20, 10, 30, 40, 8, 12, 11] }
}

export function sheetTemplate(d: TnaData, reps: StaffReport[]): SheetSpec {
  const rows: Cell[][] = [
    [`ANALISIS KEPERLUAN LATIHAN (TNA) ${d.cycle.year} — JABATAN PENGURUSAN RISIKO, PEMATUHAN & KUALITI (RMCQ), HASA`],
    ['Bil.', 'Unit / Item', 'Penunjuk Prestasi', 'KPI & Sasaran Kerja', 'Cadangan Pemberat / Kaedah Ukuran KPI', 'Aktiviti / Program Sokongan', 'Kompetensi Diperlukan', 'Cadangan Latihan Pembangunan Kompetensi'],
  ]
  d.template.forEach((t, i) => {
    const { G, H } = templateGH(d, t.unit_code, reps, t.initial_training_ms)
    rows.push([i + 1, t.item_ms, t.indicator_ms, t.kpi_ms, t.weight_ms, t.activities_ms, G, H])
  })
  return { name: 'TNA Jabatan (Templat)', rows, widths: [5, 24, 28, 45, 40, 45, 50, 50] }
}

/** Appendix to the template: every validated gap, one row per competency per unit. */
export function sheetTemplateDetail(d: TnaData, reps: StaffReport[]): SheetSpec {
  const rows: Cell[][] = [['Unit', 'Kod', 'Kompetensi', 'Staf berjurang (tahap semasa → diperlukan)', 'Bil. staf', 'Keutamaan', 'Suku tahun', 'Latihan dicadangkan']]
  for (const t of d.template) {
    const u = templateUnit(d, t.unit_code, reps, t.initial_training_ms)
    for (const x of u.details) rows.push([
      t.unit_code, x.g.c.code, x.g.c.name_ms,
      x.staff.map((s) => `${s.name} (${s.from}→${s.to}${s.never ? ', belum terdedah' : ''})`).join('; '),
      x.staff.length, x.g.label, x.g.quarter, x.g.c.default_training_ms,
    ])
  }
  return { name: 'Lampiran Jurang Unit', rows, widths: [8, 7, 34, 60, 8, 11, 14, 45] }
}

export function sheetCalendar(d: TnaData, reps: StaffReport[]): SheetSpec {
  const rows: Cell[][] = [['Bil.', 'Jenis', 'Program / latihan', 'Butiran', 'Keutamaan', 'Suku tahun', ...MONTHS, 'Anggaran kos (RM)']]
  calendar(d, reps).forEach((l, i) => rows.push([
    i + 1, l.kind, l.title, l.detail, l.priority, l.quarter || null,
    ...MONTHS.map((_, m) => (l.months.includes(m + 1) ? '●' : null)), l.cost != null ? Number(l.cost) : null,
  ]))
  return { name: 'Kalendar Latihan', rows, widths: [5, 14, 45, 50, 11, 14, ...MONTHS.map(() => 5), 12] }
}

/** Every table of the cycle, readable without the portal. */
export function handoverSheets(d: TnaData): SheetSpec[] {
  const reps = staffReports(d)
  const unitName = new Map(d.units.map((u) => [u.code, u.name_ms]))
  const staffPos = new Map(d.asg.filter((a) => a.status !== 'archived').map((a) => [a.staff_id, a.position_id]))
  const pos = new Map(d.positions.map((p) => [p.id, p]))
  const compName = new Map(d.comps.map((c) => [c.code, c.name_ms]))
  const lines = gapLines(d, reps)
  const info: Cell[][] = [
    ['PAKEJ SERAHAN DATA TNA — JABATAN RMCQ, HOSPITAL AL-SULTAN ABDULLAH UiTM'],
    ['Kitaran', d.cycle.name_ms], ['Status kitaran', d.cycle.status], ['Tarikh buka', d.cycle.open_date], ['Tarikh tutup', d.cycle.close_date],
    ['Dijana pada', new Date().toLocaleString('ms-MY')],
    [],
    ['Staf aktif', d.staff.filter((s) => s.status === 'active').length],
    ['Penilaian disahkan', reps.filter((r) => r.validated).length], ['Penilaian dihantar (menunggu)', reps.filter((r) => r.a.status === 'submitted').length],
    ['Permohonan kursus', d.requests.length],
    [],
    ['Skala tahap', '1 Asas · 2 Kompeten · 3 Cekap · 4 Pakar · 5 Pakar Strategi (Kamus Kompetensi UiTM 2021)'],
    ['Jurang', 'Tahap diperlukan − tahap dipersetujui (penilaian disahkan sahaja)'],
    ['Keutamaan', 'Skor jurang (0–3, +1 jika ada staf belum pernah terdedah) × Impak × Strategik. Tinggi ≥18 · Sederhana 9–17 · Rendah 1–8'],
    ['Helaian', 'Staf · Jawatan · Profil Jawatan · Kamus · Petunjuk Tahap · Penilaian · Jurang & Keutamaan · Permohonan Kursus · Latihan Hospital · TNA Jabatan (Templat) · Kalendar Latihan'],
  ]
  return [
    { name: 'Maklumat', rows: info, widths: [28, 100] },
    { name: 'Staf', widths: [10, 30, 26, 22, 14, 9, 28, 8, 12], rows: [['No. Staf', 'Nama', 'Emel', 'Telefon', 'Status', 'Unit', 'Jawatan', 'Gred', 'Tarikh arkib / sebab'],
      ...d.staff.map((s) => { const p = pos.get(staffPos.get(s.id) ?? -1); return [s.staff_no, s.name, s.email, s.phone, s.status === 'active' ? 'Aktif' : 'Diarkib', p?.unit_code ?? null, p?.title_ms ?? null, p?.grade_sspa ?? null, s.status === 'archived' ? `${s.archived_on ?? ''} ${s.archived_reason ?? ''}`.trim() : null] })] },
    { name: 'Jawatan', widths: [6, 9, 30, 28, 8, 10, 14, 12, 20], rows: [['ID', 'Unit', 'Nama unit', 'Jawatan', 'Gred', 'Setara SSM', 'Tahap gred', 'Peranan', 'Penyandang'],
      ...d.positions.map((p) => { const a = d.asg.find((x) => x.position_id === p.id && x.status !== 'archived'); return [p.id, p.unit_code, unitName.get(p.unit_code) ?? '', p.title_ms, p.grade_sspa, p.grade_ssm_equiv, LEVEL_NAME[p.grade_level], p.role_type, a ? d.staff.find((s) => s.id === a.staff_id)?.name ?? '' : 'KOSONG'] })] },
    { name: 'Profil Jawatan', widths: [8, 28, 8, 40, 16], rows: [['Unit', 'Jawatan', 'Kod', 'Kompetensi', 'Tahap diperlukan'],
      ...d.reqs.map((r) => { const p = pos.get(r.position_id); return [p?.unit_code ?? '', p?.title_ms ?? '', r.competency_code, compName.get(r.competency_code) ?? '', lv(r.required_level)] })] },
    { name: 'Kamus', widths: [7, 6, 16, 9, 36, 60, 45, 12, 8], rows: [['Kod', 'Lapisan', 'Kluster', 'Unit', 'Kompetensi', 'Definisi', 'Latihan cadangan', 'Sumber', 'Aktif'],
      ...d.comps.map((c) => [c.code, c.layer, clusterLabel(c.cluster), c.unit_code, c.name_ms, c.definition_ms, c.default_training_ms, c.source, c.active ? 'Ya' : 'Tidak'])] },
    { name: 'Petunjuk Tahap', widths: [7, 30, 16, 90], rows: [['Kod', 'Kompetensi', 'Tahap', 'Petunjuk perilaku'],
      ...d.levels.map((l) => [l.competency_code, compName.get(l.competency_code) ?? '', lv(l.level), l.indicator_ms])] },
    { name: 'Penilaian', widths: [10, 26, 8, 22, 12, 7, 32, 14, 14, 14, 7, 10, 30, 30], rows: [['No. Staf', 'Nama', 'Unit', 'Jawatan', 'Status', 'Kod', 'Kompetensi', 'Diperlukan', 'Kendiri', 'Dipersetujui', 'Jurang', 'Belum terdedah', 'Bukti staf', 'Catatan Ketua Jabatan'],
      ...reps.flatMap((r) => r.items.map((it) => [r.s.staff_no, r.s.name, r.p.unit_code, r.p.title_ms, STATUS_LABEL[r.a.status], it.c.code, it.c.name_ms, lv(it.required), lv(it.self), lv(it.agreed), it.gap, it.never ? 'Ya' : null, it.selfNote, it.supNote]))] },
    { name: 'Jurang & Keutamaan', widths: [7, 34, 16, 10, 10, 10, 10, 10, 8, 9, 8, 11, 14, 45, 45], rows: [['Kod', 'Kompetensi', 'Kluster', 'Staf diperlukan', 'Disahkan', 'Staf berjurang', 'Mata jurang', 'Belum terdedah', 'Skor jurang', 'Impak', 'Strategik', 'Skor', 'Keutamaan', 'Staf terlibat', 'Latihan cadangan'],
      ...lines.map((g) => [g.c.code, g.c.name_ms, clusterLabel(g.c.cluster), g.required, g.validated, g.withGap.length, g.points, g.never, g.gapScore, g.impact, g.strategic, g.score, g.label, g.withGap.map((r) => r.s.name).join('; '), g.c.default_training_ms])] },
    sheetRequests(d, reps),
    { name: 'Latihan Hospital', widths: [5, 6, 40, 45, 30, 30, 16, 20, 20, 40, 40, 6, 6, 6, 7, 11, 24, 12, 9], rows: [['ID', 'Bah.', 'Isu / dapatan', 'Program', 'Sasaran', 'Pemilik / penganjur', 'Peranan RMCQ', 'Kaedah', 'Kekerapan', 'Tindakan bukan latihan', 'Ukuran keberkesanan', 'Saiz', 'Keterukan', 'Capaian', 'Skor', 'Keutamaan', 'Bulan dirancang', 'Kos (RM)', 'Status'],
      ...d.programmes.map((p) => [p.id, p.source_section, p.issue_ms, p.title_ms, p.target_group_ms, p.owner_ms, p.rmcq_role, p.method_ms, p.frequency_ms, p.non_training_action_ms, p.kpi_ms, p.score_size, p.score_severity, p.score_reach, progScore(p), progPriority(p), p.planned_months.map((m) => MONTHS[m - 1]).join(', '), p.est_cost_rm != null ? Number(p.est_cost_rm) : null, p.status === 'active' ? 'Aktif' : 'Diarkib'])] },
    sheetTemplate(d, reps),
    sheetTemplateDetail(d, reps),
    sheetCalendar(d, reps),
  ]
}
