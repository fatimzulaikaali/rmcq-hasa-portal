/* Pure report builders for the TNA module — shared by the print pages and the Excel exports.
 * Everything is derived from TnaData so a printout and its Excel always agree. */
import type { TnaData } from '@/components/tna/shared'
import {
  CLUSTERS, LEVEL_NAME, MONTHS, STATUS_LABEL, clusterOrder, gapScore, priorityLabel, progPriority, progScore, quarterFor,
  KJ_DECISION, requestInTna, trainingTypeOf, type MgmtPriority, type TnaAssignment, type TnaCompetency, type TnaPosition, type TnaRequest, type TnaStaff,
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
export interface TplReq { title: string; provider: string | null; staff: string[] }
export interface TplTraining { c: TnaCompetency; staff: number; kamus: string | null; requested: TplReq[] }
export interface TplGroup { label: 'Tinggi' | 'Sederhana' | 'Rendah'; quarter: string; items: TplTraining[] }
export interface TplDetail { g: GapLine; staff: { name: string; from: number; to: number; never: boolean }[]; requested: TplReq[] }
export interface TplExtra { title: string; provider: string | null; staff: string; code: string | null; note: string | null }
export interface TplUnit {
  members: StaffReport[]; assessed: boolean; core: TplCore[]
  groups: TplGroup[]; extra: TplExtra[]; details: TplDetail[]; G: string; H: string
}

/** One unit's row of the hospital 8-column template, structured.
 *  G = what the unit must be competent in (core functional competencies, highest level in unit).
 *  H = training to close the validated gaps, grouped by priority → quarter, one line per course.
 *  details = the evidence behind H (who has which gap) for the appendix table. */
/** Which template row (unit) concludes gaps in competency c. */
export const ownerOf = (c: Pick<TnaCompetency, 'template_unit' | 'unit_code' | 'layer'>): string =>
  c.template_unit ?? c.unit_code ?? 'KJ'

export function templateUnit(d: TnaData, unitCode: string | null, reps: StaffReport[], initialTraining: string | null): TplUnit {
  // Gaps are grouped by the unit that OWNS the competency (Kamus → "Baris templat"), whichever unit the staff is in.
  const members = reps
  const coreMap = new Map<string, TplCore>()
  for (const r of reps) for (const it of r.items) {
    if (ownerOf(it.c) !== unitCode || it.c.layer !== 'B') continue
    const cur = coreMap.get(it.c.code)
    if (!cur || it.required > cur.max) coreMap.set(it.c.code, { c: it.c, max: it.required })
  }
  const core = Array.from(coreMap.values()).sort((a, b) => clusterOrder(a.c.cluster) - clusterOrder(b.c.cluster) || a.c.sort_order - b.c.sort_order)
  const assessed = reps.some((r) => r.validated)
  const lines = gapLines(d, reps).filter((g) => g.withGap.length > 0 && ownerOf(g.c) === unitCode)
  // staff course requests, split into: closes a validated gap of that staff → under that competency; otherwise only if KJ chose "masuk"
  const supports = (rep: StaffReport, code: string | null) => !!code && rep.gaps.some((x) => x.c.code === code)
  const reqFor = (g: GapLine): TplReq[] => {
    const m = new Map<string, TplReq>()
    for (const rep of g.withGap) for (const q of rep.requests) {
      if (q.competency_code !== g.c.code || !requestInTna(q, true)) continue
      const key = q.title_ms.trim().toLowerCase()
      const t = m.get(key) ?? { title: q.title_ms.trim(), provider: q.provider_ms, staff: [] }
      if (!t.staff.includes(rep.s.name)) t.staff.push(rep.s.name)
      m.set(key, t)
    }
    return Array.from(m.values())
  }
  const groups: TplGroup[] = (['Tinggi', 'Sederhana', 'Rendah'] as const).map((label) => ({
    label, quarter: quarterFor(label),
    items: lines.filter((x) => x.label === label).map((g) => ({ c: g.c, staff: g.withGap.length, kamus: g.c.default_training_ms, requested: reqFor(g) })),
  })).filter((x) => x.items.length)
  const compBy = new Map(d.comps.map((c) => [c.code, c]))
  const reqOwner = (rep: StaffReport, code: string | null) => { const c = code ? compBy.get(code) : undefined; return c ? ownerOf(c) : rep.p.unit_code }
  const extra: TplExtra[] = reps.flatMap((rep) => rep.validated ? rep.requests
    .filter((q) => reqOwner(rep, q.competency_code) === unitCode && !supports(rep, q.competency_code) && requestInTna(q, false))
    .map((q) => ({ title: q.title_ms.trim(), provider: q.provider_ms, staff: rep.s.name, code: q.competency_code, note: q.kj_note })) : [])
  const details: TplDetail[] = lines.map((g) => ({
    g, requested: reqFor(g), staff: g.withGap.map((r) => {
      const it = r.items.find((x) => x.c.code === g.c.code)!
      return { name: r.s.name, from: it.agreed!, to: it.required, never: it.never }
    }),
  }))

  const G = [
    'Kompetensi di bawah tanggungjawab unit (tahap tertinggi diperlukan):',
    ...(core.length ? core.map((x) => `• ${x.c.code} ${x.c.name_ms} — ${LEVEL_NAME[x.max]}`) : ['• —']),
    ...(unitCode === 'KJ' ? ['', '+ Nilai, Teras, Generik & Kepimpinan UiTM (semua staf, ikut gred).'] : []),
  ].join('\n')
  const H = !members.length ? 'Tiada staf dalam unit.'
    : !assessed ? ['(Cadangan awal — dikemas kini selepas penilaian disahkan)', initialTraining ?? ''].join('\n').trim()
      : [
        ...(!groups.length ? ['Tiada jurang kompetensi — latihan pengekalan sahaja.'] : groups.map((gr) => [
          `KEUTAMAAN ${gr.label.toUpperCase()} — ${gr.quarter}`,
          ...gr.items.map((t) => `• ${t.c.code} ${t.c.name_ms} (${t.staff} staf): ${t.requested.length
            ? t.requested.map((q) => `${q.title}${q.provider ? ` (${q.provider})` : ''}`).join('; ') + ' †' : t.kamus ?? '—'}`),
        ].join('\n'))),
        ...(extra.length ? [['PEMBANGUNAN LANJUTAN (diluluskan Ketua Jabatan)',
          ...extra.map((x) => `• ${x.title}${x.provider ? ` (${x.provider})` : ''} — ${x.staff}${x.code ? ` [${x.code}]` : ''}`)].join('\n')] : []),
      ].join('\n\n')
  return { members, assessed, core, groups, extra, details, G, H }
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
type SheetSpec = { name: string; rows: Cell[][]; widths?: number[]; merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[] }

export async function downloadXlsx(fileName: string, sheets: SheetSpec[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sh of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sh.rows)
    if (sh.widths) ws['!cols'] = sh.widths.map((w) => ({ wch: w }))
    if (sh.merges) ws['!merges'] = sh.merges
    XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}

/** [status jurang, keputusan KJ, dalam templat?, catatan] for one request. */
export function reqStatus(r: StaffReport, q: TnaRequest): [string, string, string, string | null] {
  const gap = !!q.competency_code && r.gaps.some((x) => x.c.code === q.competency_code)
  const status = !r.validated ? 'Belum disahkan' : gap ? 'Menyokong jurang' : 'Tiada jurang'
  const dec = q.kj_decision ? KJ_DECISION[q.kj_decision] : gap ? 'Auto (jurang)' : 'Belum diputuskan'
  return [status, dec, r.validated && requestInTna(q, gap) ? 'Ya' : 'Tidak', q.kj_note]
}

export function sheetRequests(d: TnaData, reps: StaffReport[]): SheetSpec {
  const comp = new Map(d.comps.map((c) => [c.code, c.name_ms]))
  const rows: Cell[][] = [['Bil.', 'No. Staf', 'Nama', 'Jawatan', 'Unit', 'Kursus / latihan', 'Penganjur', 'Kod kompetensi', 'Kompetensi', 'Sebab / justifikasi', 'Bulan', 'Anggaran kos (RM)', 'Keutamaan', 'Status jurang', 'Keputusan KJ', 'Dalam templat TNA', 'Catatan KJ']]
  let n = 0
  for (const r of reps) for (const q of r.requests) rows.push([
    ++n, r.s.staff_no, r.s.name, r.p.title_ms, r.p.unit_code, q.title_ms, q.provider_ms, q.competency_code,
    q.competency_code ? comp.get(q.competency_code) ?? '' : 'Lain-lain', q.reason_ms,
    q.preferred_month ? MONTHS[q.preferred_month - 1] : null, q.est_cost_rm != null ? Number(q.est_cost_rm) : null, q.priority,
    ...reqStatus(r, q),
  ])
  return { name: 'Permohonan Kursus', rows, widths: [5, 10, 28, 22, 8, 40, 20, 10, 30, 40, 8, 12, 11, 16, 16, 10, 30] }
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
  const rows: Cell[][] = [['Unit', 'Kod', 'Kompetensi', 'Staf berjurang (tahap semasa → diperlukan)', 'Bil. staf', 'Keutamaan', 'Suku tahun', 'Kursus dipohon staf', 'Cadangan kamus']]
  for (const t of d.template) {
    const u = templateUnit(d, t.unit_code, reps, t.initial_training_ms)
    for (const x of u.details) rows.push([
      t.unit_code, x.g.c.code, x.g.c.name_ms,
      x.staff.map((s) => `${s.name} (${s.from}→${s.to}${s.never ? ', belum terdedah' : ''})`).join('; '),
      x.staff.length, x.g.label, x.g.quarter,
      x.requested.map((q) => `${q.title}${q.provider ? ` (${q.provider})` : ''} — ${q.staff.join(', ')}`).join('; ') || null,
      x.g.c.default_training_ms,
    ])
    for (const x of u.extra) rows.push([t.unit_code, x.code, 'Pembangunan lanjutan (diluluskan KJ)', x.staff, 1, null, null, `${x.title}${x.provider ? ` (${x.provider})` : ''}`, x.note])
  }
  return { name: 'Lampiran Jurang Unit', rows, widths: [8, 7, 34, 60, 8, 11, 14, 50, 45] }
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
    sheetMgmt(d, reps),
  ]
}

/* ---------------- Template TNA Pengurusan Hospital (18 lajur) ---------------- */
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)] // lower median → whole level
}
export const mgmtCategory = (c: TnaCompetency) =>
  c.layer === 'B' ? 'Fungsional' : c.cluster === 'Kepimpinan' ? 'Kepimpinan' : 'Generik'

export interface MgmtPlanItem { title: string; provider: string | null; staff: string[]; cost: number | null; months: number[]; source: 'staf' | 'kamus' }
export interface MgmtCompRow {
  c: TnaCompetency; category: string
  R: number; Cauto: number; C: number; override: boolean; gap: number
  staffWithGap: StaffReport[]; staffRequired: number
  priority: MgmtPriority | null
  inhouse: MgmtPlanItem[]; external: MgmtPlanItem[]
}
export interface MgmtUnitBlock { t: TnaData['template'][number]; rows: MgmtCompRow[]; noGap: number }

/** Department-level R and C per competency: R = median required level, C = median agreed level
 *  (validated staff who need it), C may be overridden by the KJ. Rows = competencies where ≥1 staff has a gap. */
export function mgmtBlocks(d: TnaData, reps: StaffReport[]): MgmtUnitBlock[] {
  const pin = new Map(d.pinputs.map((p) => [p.competency_code, p]))
  const validated = reps.filter((r) => r.validated)
  const byComp = new Map<string, { c: TnaCompetency; req: number[]; agreed: number[]; gapStaff: StaffReport[] }>()
  for (const r of validated) for (const it of r.items) {
    const e = byComp.get(it.c.code) ?? { c: it.c, req: [], agreed: [], gapStaff: [] }
    e.req.push(it.required)
    if (it.agreed != null) e.agreed.push(it.agreed)
    if ((it.gap ?? 0) > 0) e.gapStaff.push(r)
    byComp.set(it.c.code, e)
  }
  const plan = (code: string, gapStaff: StaffReport[], kamus: string | null) => {
    const inh = new Map<string, MgmtPlanItem>(); const ext = new Map<string, MgmtPlanItem>()
    for (const r of validated) for (const q of r.requests) {
      if (q.competency_code !== code) continue
      const supports = gapStaff.includes(r)
      if (!requestInTna(q, supports)) continue
      const m = trainingTypeOf(q) === 'luaran' ? ext : inh
      const key = q.title_ms.trim().toLowerCase()
      const x = m.get(key) ?? { title: q.title_ms.trim(), provider: q.provider_ms, staff: [], cost: null, months: [], source: 'staf' as const }
      if (!x.staff.includes(r.s.name)) x.staff.push(r.s.name)
      if (q.est_cost_rm != null) x.cost = (x.cost ?? 0) + Number(q.est_cost_rm)
      if (q.preferred_month && !x.months.includes(q.preferred_month)) x.months.push(q.preferred_month)
      m.set(key, x)
    }
    if (!inh.size && !ext.size && kamus) inh.set('_k', { title: kamus, provider: null, staff: gapStaff.map((r) => r.s.name), cost: null, months: [], source: 'kamus' })
    return { inhouse: Array.from(inh.values()), external: Array.from(ext.values()) }
  }
  return d.template.map((t) => {
    const all = Array.from(byComp.values()).filter((e) => ownerOf(e.c) === t.unit_code)
    const rows: MgmtCompRow[] = all.filter((e) => e.gapStaff.length > 0).map((e) => {
      const R = median(e.req) ?? 1
      const Cauto = median(e.agreed) ?? 1
      const p = pin.get(e.c.code)
      const C = p?.dept_current_level ?? Cauto
      return {
        c: e.c, category: mgmtCategory(e.c), R, Cauto, C, override: p?.dept_current_level != null, gap: Math.max(0, R - C),
        staffWithGap: e.gapStaff, staffRequired: e.req.length, priority: p?.mgmt_priority ?? null,
        ...plan(e.c.code, e.gapStaff, e.c.default_training_ms),
      }
    }).sort((a, b) => ['High', 'Moderate', 'Low', null].indexOf(a.priority) - ['High', 'Moderate', 'Low', null].indexOf(b.priority)
      || b.gap - a.gap || a.c.code.localeCompare(b.c.code, undefined, { numeric: true }))
    return { t, rows, noGap: all.length - rows.length }
  })
}

const planTxt = (xs: MgmtPlanItem[]) => xs.map((x) => `• ${x.title}${x.provider ? ` (${x.provider})` : ''}${x.source === 'staf' ? ` — ${x.staff.join(', ')}` : ' — cadangan Kamus'}`).join('\n')
const costOf = (xs: MgmtPlanItem[]) => { const v = xs.reduce((s, x) => s + (x.cost ?? 0), 0); return v ? v : null }
const monthsOf = (xs: MgmtPlanItem[], fallback: string) => {
  const m = Array.from(new Set(xs.flatMap((x) => x.months))).sort((a, b) => a - b)
  return m.length ? m.map((x) => MONTHS[x - 1]).join(', ') : fallback
}
export const mgmtQuarter = (p: MgmtPriority | null) => (p === 'High' ? 'S1 (Jan–Mac)' : p === 'Moderate' ? 'S2 (Apr–Jun)' : p === 'Low' ? 'S3–S4 (Jul–Dis)' : '—')
export const mgmtDate = (r: MgmtCompRow) => monthsOf([...r.inhouse, ...r.external], mgmtQuarter(r.priority))
export const mgmtPlanTxt = planTxt
export const mgmtCost = costOf

/* ---- Summarised rows for the final management report: one row per objective (template row) × category ---- */
export interface MgmtGroupRow {
  category: string; competencies: string[]
  R: number | null; C: number | null; gap: number | null; priority: MgmtPriority | null
  inhouse: string[]; inhouseCost: number | null; external: string[]; externalCost: number | null; date: string
}
export interface MgmtGroupBlock { t: TnaData['template'][number]; rows: MgmtGroupRow[] }
const PRI_ORDER: (MgmtPriority | null)[] = ['High', 'Moderate', 'Low', null]
/** Split a Kamus training text into separate courses (by line or ";"; numbered lists are cleaned). */
export const splitTraining = (t: string | null) => (t ?? '').split(/\n|;/).map((x) => x.replace(/^\s*(\d+[.)]|[-•])\s*/, '').replace(/[,.;\s]+$/, '').trim()).filter(Boolean)
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }) }

/** R/C/Gap of a group follow its most critical competency (largest gap, then highest priority),
 *  so a group with a real gap never shows Gap 0. In-house = Kamus suggestions + in-house staff requests;
 *  External = external staff requests. No codes or staff names (final report). */
export function mgmtGrouped(d: TnaData, reps: StaffReport[]): MgmtGroupBlock[] {
  const compBy = new Map(d.comps.map((c) => [c.code, c]))
  const label = (q: TnaRequest) => q.title_ms.trim() + (q.provider_ms ? ` (${q.provider_ms.trim()})` : '')
  // KJ-approved requests ("masuk") for competencies that have no gap row → still part of the plan (development)
  type Extra = { unit: string; cat: string; q: TnaRequest; comp: string | null }
  const blocks = mgmtBlocks(d, reps)
  const inRows = new Set(blocks.flatMap((b) => b.rows.map((r) => r.c.code)))
  const extras: Extra[] = []
  for (const r of reps) {
    if (!r.validated) continue
    for (const q of r.requests) {
      if (q.competency_code && inRows.has(q.competency_code)) continue // already listed under its gap row
      if (q.kj_decision !== 'masuk') continue
      const c = q.competency_code ? compBy.get(q.competency_code) : undefined
      extras.push({ unit: c ? ownerOf(c) : r.p.unit_code, cat: c ? mgmtCategory(c) : 'Generik', q, comp: c?.name_ms ?? null })
    }
  }
  return blocks.map((b) => {
    const myExtra = extras.filter((x) => x.unit === b.t.unit_code)
    const cats = ['Fungsional', 'Generik', 'Kepimpinan'].filter((c) => b.rows.some((r) => r.category === c) || myExtra.some((x) => x.cat === c))
    const rows = cats.map((cat): MgmtGroupRow => {
      const rs = b.rows.filter((r) => r.category === cat)
        .sort((x, y) => y.gap - x.gap || PRI_ORDER.indexOf(x.priority) - PRI_ORDER.indexOf(y.priority))
      const ex = myExtra.filter((x) => x.cat === cat)
      const crit = rs[0]
      const priority = rs.map((r) => r.priority).sort((x, y) => PRI_ORDER.indexOf(x) - PRI_ORDER.indexOf(y))[0] ?? null
      const req = (xs: MgmtPlanItem[]) => xs.filter((x) => x.source === 'staf')
      const exIn = ex.filter((x) => trainingTypeOf(x.q) === 'dalaman'); const exOut = ex.filter((x) => trainingTypeOf(x.q) === 'luaran')
      const inh = uniq([...rs.flatMap((r) => splitTraining(r.c.default_training_ms)), ...rs.flatMap((r) => req(r.inhouse).map((x) => x.title + (x.provider ? ` (${x.provider})` : ''))), ...exIn.map((x) => label(x.q))])
      const ext = uniq([...rs.flatMap((r) => req(r.external).map((x) => x.title + (x.provider ? ` (${x.provider})` : ''))), ...exOut.map((x) => label(x.q))])
      const sum = (xs: MgmtPlanItem[]) => xs.reduce((s, x) => s + (x.cost ?? 0), 0)
      const exCost = (xs: Extra[]) => xs.reduce((s, x) => s + Number(x.q.est_cost_rm ?? 0), 0)
      const ic = rs.reduce((s, r) => s + sum(req(r.inhouse)), 0) + exCost(exIn)
      const ec = rs.reduce((s, r) => s + sum(req(r.external)), 0) + exCost(exOut)
      const months = Array.from(new Set([...rs.flatMap((r) => [...r.inhouse, ...r.external].flatMap((x) => x.months)), ...ex.flatMap((x) => (x.q.preferred_month ? [x.q.preferred_month] : []))])).sort((a, b) => a - b)
      const comps = [
        ...rs.sort((x, y) => PRI_ORDER.indexOf(x.priority) - PRI_ORDER.indexOf(y.priority) || y.gap - x.gap).map((r) => r.c.name_ms),
        ...uniq(ex.map((x) => x.comp).filter((x): x is string => !!x)).map((n) => `${n} (pembangunan)`),
        ...(ex.some((x) => !x.comp) ? ['Pembangunan kemahiran umum (diluluskan Ketua Jabatan)'] : []),
      ]
      return {
        category: cat, competencies: uniq(comps),
        R: crit ? crit.R : null, C: crit ? crit.C : null, gap: crit ? crit.gap : null, priority,
        inhouse: inh, inhouseCost: ic || null, external: ext, externalCost: ec || null,
        date: months.length ? months.map((m) => MONTHS[m - 1]).join(', ') : mgmtQuarter(priority),
      }
    })
    return { t: b.t, rows }
  })
}
const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `• ${x}`).join('\n') : null)

/** Rows in the exact 18-column layout of the hospital management template (sheet "Jabatan di bawah Pejabat …"). */
export function sheetMgmt(d: TnaData, reps: StaffReport[]): SheetSpec & { merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] } {
  const rows: Cell[][] = [
    ['No.', 'Department / Unit ', 'Goals', 'Objectives', 'KPIs', 'Performance Indicator', 'Training Competency Category', 'Competency', 'Required Competencies', null, null, null, 'Activities / Program ', 'Training Plan', null, null, null, null],
    [null, null, null, null, null, null, null, null, 'Required Level\n (R)', 'Current Level\n(C)', 'Departmental Training Gap Analysis\nR - C', 'Training Priority', null, 'In-house/Internal Training Plan', 'Cost Implication', 'Date', 'External Training Plan', 'Cost Implication'],
  ]
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [
    { s: { r: 0, c: 8 }, e: { r: 0, c: 11 } }, { s: { r: 0, c: 13 }, e: { r: 0, c: 17 } },
    ...[0, 1, 2, 3, 4, 5, 6, 7, 12].map((c) => ({ s: { r: 0, c }, e: { r: 1, c } })),
  ]
  const blocks = mgmtGrouped(d, reps)
  const start = rows.length
  for (const b of blocks) {
    const first = rows.length
    const list = b.rows.length ? b.rows : [null]
    for (const r of list) {
      rows.push([
        null, null, null, b.t.objective_ms, b.t.mgmt_kpi_ms ?? b.t.kpi_ms, b.t.weight_ms,
        r ? r.category : null, r ? bullets(r.competencies) : 'Tiada jurang kompetensi',
        r ? r.R : null, r ? r.C : null, r ? r.gap : null, r ? r.priority : null,
        b.t.activities_ms,
        r ? bullets(r.inhouse) : null, r ? r.inhouseCost : null, r ? r.date : null,
        r ? bullets(r.external) : null, r ? r.externalCost : null,
      ])
    }
    const last = rows.length - 1
    if (last > first) for (const c of [3, 4, 5, 12]) merges.push({ s: { r: first, c }, e: { r: last, c } })
  }
  const end = rows.length - 1
  if (end >= start) {
    rows[start][0] = 1
    rows[start][1] = 'Jabatan Pengurusan Risiko, Pematuhan & Kualiti'
    rows[start][2] = d.template.find((t) => t.goal_ms)?.goal_ms ?? null
    if (end > start) for (const c of [0, 1, 2]) merges.push({ s: { r: start, c }, e: { r: end, c } })
  }
  return { name: 'TNA Pengurusan (RMCQ)', rows, merges, widths: [5, 22, 30, 32, 45, 40, 14, 34, 9, 9, 12, 10, 40, 45, 11, 14, 45, 11] }
}
