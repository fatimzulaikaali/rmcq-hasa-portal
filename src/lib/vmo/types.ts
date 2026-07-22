/* Shared types for the VMO Survey module (Hala Tuju Strategik HASA), v2.
 *
 * The revised instrument is fully anonymous (no identifier / dedup) and adds
 * two new question kinds beyond the 1–6 agreement/happiness scale:
 *   - 'familiarity' : a 1–6 knowledge scale for the VMO-awareness question
 *   - 'choice'      : a pick-two multiple-choice question (no 1–6 value)
 * It also collects three open-text answers per response (keep / change / other).
 */

export type VmoLang = 'ms' | 'en'

export type VmoTheme = 'engagement' | 'vmo' | 'direction' | 'role' | 'welfare' | 'growth' | 'choice'

export type VmoScale = 'agreement' | 'happiness' | 'familiarity' | 'choice'

export interface VmoGroup {
  code: string
  name_ms: string
  name_en: string
  note_ms: string | null
  note_en: string | null
  accent: string
  kind: 'staff' | 'student' | 'patient'
  sort_order: number
  active: boolean
}

export interface VmoQuestion {
  code: string
  text_ms: string
  text_en: string
  theme: VmoTheme
  scale_type: VmoScale
  reverse_scored: boolean
  /** For 'choice' questions: how many options the respondent must pick (2). */
  pick_count: number
}

export interface VmoGroupQuestion {
  group_code: string
  question_code: string
  position: number
  required: boolean
}

export interface VmoDemographic {
  group_code: string
  field_code: string
  option_set: string
  label_ms: string
  label_en: string
  position: number
  required: boolean
}

export interface VmoOption {
  option_set: string
  value: string
  label_ms: string
  label_en: string
  sort_order: number
}

/** Options for a 'choice' question (the pick-two list). */
export interface VmoQuestionOption {
  question_code: string
  value: string
  label_ms: string
  label_en: string
  sort_order: number
}

export interface VmoResponse {
  id: number
  group_code: string
  demographics: Record<string, string>
  open_answers: Record<string, string>   // { t1, t2, t3 }
  language: VmoLang
  submitted_at: string
}

export interface VmoAnswer {
  response_id: number
  question_code: string
  /** 1–6, or null for "Tidak tahu / Tidak berkaitan". */
  value: number | null
}

export interface VmoAnswerChoice {
  response_id: number
  question_code: string
  option_value: string
}

/* ---------------------------------------------------------------- themes */

export const VMO_THEMES: { key: VmoTheme; ms: string; en: string }[] = [
  { key: 'engagement', ms: 'Penglibatan', en: 'Engagement' },
  { key: 'vmo', ms: 'Kesedaran & relevan VMO', en: 'VMO awareness & relevance' },
  { key: 'direction', ms: 'Hala tuju & pengalaman', en: 'Direction & experience' },
  { key: 'welfare', ms: 'Kebajikan', en: 'Welfare & wellbeing' },
  { key: 'growth', ms: 'Pembangunan diri', en: 'Growth & development' },
]

/* ---------------------------------------------------------------- scale
 *
 * 1–6 forced choice, no midpoint.  1–2 negative · 3–4 soft · 5–6 positive.
 * "Tidak tahu" is a separate button stored as NULL, excluded from scores.
 */
export const VMO_SCALE_MAX = 6

export const VMO_POINTS: Record<VmoScale, Record<VmoLang, string[]>> = {
  agreement: {
    ms: ['Sangat Tidak Setuju', 'Tidak Setuju', 'Agak Tidak Setuju', 'Agak Setuju', 'Setuju', 'Sangat Setuju'],
    en: ['Strongly Disagree', 'Disagree', 'Slightly Disagree', 'Slightly Agree', 'Agree', 'Strongly Agree'],
  },
  happiness: {
    ms: ['Sangat Tidak Gembira', 'Tidak Gembira', 'Agak Tidak Gembira', 'Agak Gembira', 'Gembira', 'Sangat Gembira'],
    en: ['Very Unhappy', 'Unhappy', 'Slightly Unhappy', 'Slightly Happy', 'Happy', 'Very Happy'],
  },
  familiarity: {
    ms: ['Langsung tidak tahu', 'Pernah dengar', 'Tahu sedikit', 'Tahu secara umum', 'Tahu dengan baik', 'Sangat memahami'],
    en: ['Not at all', 'Heard of it', 'Know a little', 'Know generally', 'Know well', 'Understand fully'],
  },
  choice: { ms: [], en: [] },
}

export const VMO_ANCHORS: Record<VmoScale, Record<VmoLang, [string, string]>> = {
  agreement: { ms: ['Sangat Tidak Setuju', 'Sangat Setuju'], en: ['Strongly Disagree', 'Strongly Agree'] },
  happiness: { ms: ['Sangat Tidak Gembira', 'Sangat Gembira'], en: ['Very Unhappy', 'Very Happy'] },
  familiarity: { ms: ['Langsung tidak tahu', 'Sangat memahami'], en: ['Not at all', 'Understand fully'] },
  choice: { ms: ['', ''], en: ['', ''] },
}

export const VMO_DK_LABEL: Record<VmoLang, string> = {
  ms: 'Tidak tahu / Tidak berkaitan',
  en: "Don't know / Not applicable",
}

/** Labels for the three open-text answers. T2 wording varies per group. */
export const VMO_OPEN: { key: string; ms: string; en: string }[] = [
  { key: 't1', ms: 'Satu perkara yang HASA patut KEKALKAN.', en: 'One thing HASA should keep doing.' },
  { key: 't2', ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI.', en: 'One thing HASA should change or improve.' },
  { key: 't3', ms: 'Sebarang isu atau cadangan lain untuk pengurusan tertinggi (ringkas).', en: 'Any other issue or suggestion for top management (brief).' },
]

/* ---------------------------------------------------------------- scoring */

/** Reverse a score. On a 1–6 scale the mirror of v is 7 − v. */
export function vmoScore(value: number, reverse: boolean): number {
  return reverse ? (VMO_SCALE_MAX + 1) - value : value
}

/** Strip don't-knows before scoring. */
export function opinions(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && v !== undefined)
}

/** % positive = share scoring 5 or 6. */
export function pctPositive(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v >= 5).length / values.length) * 100)
}
export function pctNegative(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v <= 2).length / values.length) * 100)
}
export function pctSoft(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v === 3 || v === 4).length / values.length) * 100)
}
export function pctDontKnow(values: (number | null)[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v === null || v === undefined).length / values.length) * 100)
}
export function meanOf(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}
