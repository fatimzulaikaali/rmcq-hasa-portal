/* TNA & Kompetensi module — shared types + helpers.
 * Mirrors the tna_* tables in Supabase (sql/tna-01-schema.sql).
 * Scale: 1 Asas · 2 Kompeten · 3 Cekap · 4 Pakar · 5 Pakar Strategi (Kamus UiTM 2021). */

export const LEVELS = [1, 2, 3, 4, 5] as const
export const LEVEL_NAME: Record<number, string> = {
  1: 'Asas', 2: 'Kompeten', 3: 'Cekap', 4: 'Pakar', 5: 'Pakar Strategi',
}
export const levelName = (v: number | null | undefined) => (v ? LEVEL_NAME[v] ?? String(v) : '—')

/* Display order of clusters (department functional first, then UiTM generic). */
export const CLUSTERS: { key: string; label: string }[] = [
  { key: 'Asas RMCQ', label: 'Asas RMCQ' },
  { key: 'Kefungsian Unit', label: 'Kefungsian Unit' },
  { key: 'Merentas RMCQ', label: 'Merentas RMCQ' },
  { key: 'Nilai', label: 'Nilai UiTM' },
  { key: 'Teras', label: 'Teras UiTM' },
  { key: 'Generik', label: 'Generik UiTM' },
  { key: 'Kepimpinan', label: 'Kepimpinan UiTM' },
]
export const clusterOrder = (c: string) => {
  const i = CLUSTERS.findIndex((x) => x.key === c)
  return i < 0 ? 99 : i
}

export type CycleStatus = 'draft' | 'open' | 'closed'
export type AssignmentStatus = 'not_started' | 'draft' | 'submitted' | 'validated' | 'archived'
export type RoleType = 'KJ' | 'KU' | 'PP' | 'SOK' | 'KER'

export const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_started: 'Belum mula', draft: 'Draf', submitted: 'Dihantar', validated: 'Disahkan', archived: 'Diarkib',
}
export const STATUS_BADGE: Record<AssignmentStatus, string> = {
  not_started: 'b-red', draft: 'b-amber', submitted: 'b-blue', validated: 'b-green', archived: 'b-gray',
}
export const ROLE_LABEL: Record<RoleType, string> = {
  KJ: 'Ketua Jabatan', KU: 'Ketua Unit', PP: 'Pegawai Perubatan', SOK: 'Pegawai Sokongan', KER: 'Kerani',
}

export interface TnaCycle {
  id: number; year: number; name_ms: string; status: CycleStatus
  open_date: string | null; close_date: string | null; copied_from: number | null
}
export interface TnaCompetency {
  code: string; layer: 'A' | 'B'; cluster: string; source: string; staff_category: string
  dept_code: string | null; unit_code: string | null; name_ms: string; definition_ms: string | null
  default_training_ms: string | null; min_sspa_grade: number | null; max_sspa_grade: number | null
  sort_order: number; active: boolean
}
export interface TnaLevel { competency_code: string; level: number; indicator_ms: string }
export interface TnaUnit { code: string; name_ms: string; bahagian_ms: string | null; sort_order: number }
export interface TnaPosition {
  id: number; cycle_id: number; unit_code: string; title_ms: string; grade_sspa: string
  grade_sspa_num: number; grade_ssm_equiv: string | null; grade_level: number; role_type: RoleType
  sort_order: number; active: boolean
}
export interface TnaRequirement { position_id: number; competency_code: string; required_level: number }
export interface TnaStaff {
  id: number; staff_no: string; name: string; email: string | null; phone: string | null
  status: 'active' | 'archived'; archived_reason: string | null; archived_on: string | null
}
export interface TnaAssignment {
  id: number; cycle_id: number; staff_id: number; position_id: number; supervisor_staff_id: number | null
  token_hash: string | null; token_issued_at: string | null; token_revoked: boolean
  status: AssignmentStatus; start_date: string | null; submitted_at: string | null
  validated_at: string | null; reopened_count: number
}
export interface TnaItem {
  assignment_id: number; competency_code: string; self_level: number | null; self_note: string | null
  never_exposed: boolean; agreed_level: number | null; supervisor_note: string | null
}

/* ---- Gap & priority (same rules as the Excel workbook) ---- */
export function gapOf(required: number, agreed: number | null | undefined): number | null {
  if (agreed == null) return null
  return Math.max(0, required - agreed)
}
/** Gap score 0–3 from the number of staff with a gap and total gap points. */
export function gapScore(staffWithGap: number, gapPoints: number, staffNeverExposed = 0): number {
  let s = gapPoints >= 4 || staffWithGap >= 3 ? 3 : gapPoints >= 2 || staffWithGap >= 2 ? 2 : staffWithGap >= 1 ? 1 : 0
  if (s > 0 && staffNeverExposed > 0) s = Math.min(3, s + 1) // "Belum pernah terdedah" uplift
  return s
}
export function priorityLabel(score: number | null): 'Tinggi' | 'Sederhana' | 'Rendah' | 'Tiada jurang' | 'Belum dinilai' {
  if (score == null) return 'Belum dinilai'
  if (score === 0) return 'Tiada jurang'
  return score >= 18 ? 'Tinggi' : score >= 9 ? 'Sederhana' : 'Rendah'
}
export const PRIORITY_BADGE: Record<string, string> = {
  Tinggi: 'b-red', Sederhana: 'b-amber', Rendah: 'b-green', 'Tiada jurang': 'b-gray', 'Belum dinilai': 'b-gray',
}

/* ---- Staff link tokens ----
 * The raw token goes only into the link; the DB stores sha256(token) as hex,
 * matching encode(extensions.digest(token,'sha256'),'hex') in tna_link_resolve. */
export function newToken(): string {
  const b = new Uint8Array(18)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('')
}
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('')
}
export function staffLink(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/tna/s/${token}`
}
export function linkMessage(name: string, link: string, closeDate: string | null): string {
  const close = closeDate ? new Date(closeDate + 'T00:00:00').toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return [
    `Assalamualaikum / Salam sejahtera ${name},`,
    '',
    'Mohon lengkapkan Penilaian Kompetensi TNA 2027 Jabatan RMCQ melalui link berikut:',
    link,
    '',
    'Sahkan dengan No. Staf anda. Anggaran masa 15–20 minit; jawapan disimpan secara automatik.',
    close ? `Tarikh tutup: ${close}.` : '',
    '',
    'Terima kasih.',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}
/** Malaysian mobile → wa.me international format (60…). Returns null if unusable. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('0')) d = '6' + d
  if (!d.startsWith('60') || d.length < 10) return null
  return d
}

/** Next free code for a new competency with a given prefix (R → R27, KP → KP6). */
export function nextCode(prefix: string, existing: string[]): string {
  const nums = existing.filter((c) => c.startsWith(prefix) && /^\d+$/.test(c.slice(prefix.length)))
    .map((c) => parseInt(c.slice(prefix.length), 10))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return prefix + (prefix === 'R' ? String(n).padStart(2, '0') : String(n))
}

export function errMsg(e: unknown): string {
  if (!e) return 'Ralat tidak diketahui'
  if (typeof e === 'string') return e
  const o = e as { message?: string; code?: string; details?: string; hint?: string }
  return [o.code && `[${o.code}]`, o.message, o.details, o.hint].filter(Boolean).join(' ')
}
