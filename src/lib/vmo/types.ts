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
  value: number
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

/** Scale anchor labels, shown under positions 1 / 3 / 5. */
export const VMO_ANCHORS: Record<VmoScale, Record<VmoLang, [string, string, string]>> = {
  agreement: {
    ms: ['Sangat Tidak Setuju', 'Neutral', 'Sangat Setuju'],
    en: ['Strongly Disagree', 'Neutral', 'Strongly Agree'],
  },
  happiness: {
    ms: ['Sangat Tidak Gembira', 'Neutral', 'Sangat Gembira'],
    en: ['Very Unhappy', 'Neutral', 'Very Happy'],
  },
}

/** Apply reverse scoring. Q4 asks whether the VMO *needs updating*, so agreeing
 *  is negative — it must be flipped before entering any theme average. */
export function vmoScore(value: number, reverse: boolean): number {
  return reverse ? 6 - value : value
}

/** % positive = share scoring 4 or 5 (after reverse scoring where applicable). */
export function pctPositive(values: number[]): number {
  if (!values.length) return 0
  return Math.round((values.filter((v) => v >= 4).length / values.length) * 100)
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
