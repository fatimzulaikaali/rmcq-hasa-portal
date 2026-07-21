/* Shared types for the VMO Survey module (Hala Tuju Strategik HASA).
 *
 * The survey is public and anonymous; the results dashboard lives inside the
 * portal. Both read the same reference tables, so the types live here. */

export type VmoLang = 'ms' | 'en'

export type VmoTheme = 'engagement' | 'vmo' | 'direction' | 'role' | 'welfare' | 'growth'

export type VmoScale = 'agreement' | 'happiness'

export interface VmoGroup {
  code: string
  name_ms: string
  name_en: string
  note_ms: string | null
  note_en: string | null
  accent: string
  kind: 'staff' | 'student' | 'patient'
  /** Per-group salt for the dedup hash. Never leaves the browser in raw form. */
  salt: string
  sort_order: number
  active: boolean
}

export interface VmoQuestion {
  code: string
  text_ms: string
  text_en: string
  theme: VmoTheme
  scale_type: VmoScale
  /** Q4_UPDATE only — agreeing is a NEGATIVE signal, so score 6 - value. */
  reverse_scored: boolean
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

export interface VmoResponse {
  id: number
  group_code: string
  demographics: Record<string, string>
  free_text: string | null
  language: VmoLang
  submitted_at: string
}

export interface VmoAnswer {
  response_id: number
  question_code: string
  /** 1–6, or null when the respondent chose "Tidak tahu / Tidak berkaitan". */
  value: number | null
}

/* ---------------------------------------------------------------- scoring */

/** The six themes, in display order, with bilingual labels. */
export const VMO_THEMES: { key: VmoTheme; ms: string; en: string }[] = [
  { key: 'engagement', ms: 'Penglibatan', en: 'Engagement' },
  { key: 'vmo', ms: 'Kesedaran & relevan VMO', en: 'VMO awareness & relevance' },
  { key: 'direction', ms: 'Hala tuju strategik', en: 'Strategic direction' },
  { key: 'role', ms: 'Peranan & pengalaman', en: 'Role & experience' },
  { key: 'welfare', ms: 'Kebajikan', en: 'Welfare & wellbeing' },
  { key: 'growth', ms: 'Pembangunan diri', en: 'Growth & development' },
]

/* ---------------------------------------------------------------- the scale
 *
 * A 1–6 FORCED-CHOICE scale: there is deliberately no midpoint, so every
 * respondent has to lean one way or the other. People with genuinely no view
 * choose "Tidak tahu / Tidak berkaitan" instead, which is stored as NULL and
 * excluded from score denominators — that keeps "no opinion" from being
 * confused with "disagree".
 *
 *   1–2  negative      3–4  soft      5–6  positive      null  don't know
 */
export const VMO_SCALE_MAX = 6

/** Full label for every point, used for aria-labels and the report codebook. */
export const VMO_POINTS: Record<VmoScale, Record<VmoLang, string[]>> = {
  agreement: {
    ms: ['Sangat Tidak Setuju', 'Tidak Setuju', 'Agak Tidak Setuju', 'Agak Setuju', 'Setuju', 'Sangat Setuju'],
    en: ['Strongly Disagree', 'Disagree', 'Slightly Disagree', 'Slightly Agree', 'Agree', 'Strongly Agree'],
  },
  happiness: {
    ms: ['Sangat Tidak Gembira', 'Tidak Gembira', 'Agak Tidak Gembira', 'Agak Gembira', 'Gembira', 'Sangat Gembira'],
    en: ['Very Unhappy', 'Unhappy', 'Slightly Unhappy', 'Slightly Happy', 'Happy', 'Very Happy'],
  },
}

/** Just the two end labels — what we print under the scale on screen. */
export const VMO_ANCHORS: Record<VmoScale, Record<VmoLang, [string, string]>> = {
  agreement: {
    ms: ['Sangat Tidak Setuju', 'Sangat Setuju'],
    en: ['Strongly Disagree', 'Strongly Agree'],
  },
  happiness: {
    ms: ['Sangat Tidak Gembira', 'Sangat Gembira'],
    en: ['Very Unhappy', 'Very Happy'],
  },
}

export const VMO_DK_LABEL: Record<VmoLang, string> = {
  ms: 'Tidak tahu / Tidak berkaitan',
  en: "Don't know / Not applicable",
}

/** Apply reverse scoring. Q4 asks whether the VMO *needs updating*, so agreeing
 *  is negative — it must be flipped before entering any theme average.
 *  On a 1–6 scale the mirror of v is 7 − v. */
export function vmoScore(value: number, reverse: boolean): number {
  return reverse ? (VMO_SCALE_MAX + 1) - value : value
}

/** Strip don't-knows. Everything below scores only over real opinions. */
export function opinions(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && v !== undefined)
}

/** % positive = share scoring 5 or 6 (after reverse scoring where applicable). */
export function pctPositive(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v >= 5).length / values.length) * 100)
}

/** % negative = share scoring 1 or 2. */
export function pctNegative(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v <= 2).length / values.length) * 100)
}

/** % soft = the 3–4 band: leaning, but without conviction. Often the real story. */
export function pctSoft(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v === 3 || v === 4).length / values.length) * 100)
}

/** Share of respondents who answered "don't know" for this item. */
export function pctDontKnow(values: (number | null)[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v === null || v === undefined).length / values.length) * 100)
}

export function meanOf(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/* ---------------------------------------------------------------- hashing */

/* response_hash is a salted one-way hash of the last 6 digits of the
 * respondent's NRIC/passport. The raw digits are NEVER stored or transmitted —
 * only this hash is sent. It exists purely to enforce one response per person
 * per group. The per-group salt means the same ID produces a different hash in
 * each group, so responses cannot be linked across groups. */
export async function hashIdentifier(value: string, salt: string): Promise<string> {
  const input = value.trim().toLowerCase() + '|' + salt
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const bytes = new TextEncoder().encode(input)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      /* fall through */
    }
  }
  // cyrb53 fallback for non-crypto environments — still deterministic
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 'fb_' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}
