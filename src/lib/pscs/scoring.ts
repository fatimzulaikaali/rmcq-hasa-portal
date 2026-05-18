/* PSCS scoring helpers — mirrors AHRQ SOPS methodology with 0–5 scale.
 *
 * Scale (for Agreement / Frequency items): 0 = "Don't Know / Not Applicable"
 * (EXCLUDED), 1 = strongest disagree/never, 5 = strongest agree/always.
 *
 * Positive response (Agreement / Frequency):
 *   - For + items: value 4 or 5
 *   - For - items: value 1 or 2 (reverse scored)
 *   - Neutral = value 3 (regardless of wording).
 *
 * Special-case scales:
 *   - EventCount (D3 "How many events have you reported in past 12 months"):
 *       1 = None, 2 = 1–2, 3 = 3–5, 4 = 6–10, 5 = 11 or more.
 *       Per AHRQ: "% positive" for D3 = % who reported ≥ 1 event.
 *       So value 1 = negative, values 2–5 = positive, no neutral category.
 *       Reporting culture is the positive trait — actively reporting events
 *       signals psychological safety, not the absence of events.
 *
 *   - Rating (E1 "Patient Safety Rating"):
 *       1 = Poor, 2 = Fair, 3 = Good, 4 = Very Good, 5 = Excellent.
 *       "% positive" = Very Good or Excellent (values 4–5). Currently E1 is
 *       excluded from regular composite scoring (RATING composite has
 *       is_rating=true) and rendered separately by the dashboard.
 *
 * 0 (and any null / missing) is always excluded from numerator and denominator.
 */

import { PscsAnswer, PscsComposite, PscsQuestion, ScaleType, Wording } from './types'

/* ---------- per-answer classification ---------- */

export type Bucket = 'positive' | 'neutral' | 'negative' | 'excluded'

export function classify(
  value: number | null | undefined,
  wording: Wording,
  scaleType: ScaleType = 'Agreement',
): Bucket {
  if (value === null || value === undefined) return 'excluded'
  if (value === 0) return 'excluded'

  // EventCount (D3) — wording is '+' but the scale is "how many events
  // reported". AHRQ defines "% positive" as reported ≥ 1 event, so:
  if (scaleType === 'EventCount') {
    if (value === 1) return 'negative'     // None
    if (value >= 2 && value <= 5) return 'positive'  // 1+ events reported
    return 'excluded'
  }

  // Rating (E1) — Very Good / Excellent = positive, Good = neutral, Poor/Fair = negative.
  // E1's composite is is_rating=true so this branch rarely runs through itemStats,
  // but kept here for completeness so classify() works correctly if called directly.
  if (scaleType === 'Rating') {
    if (value === 4 || value === 5) return 'positive'
    if (value === 3) return 'neutral'
    if (value === 1 || value === 2) return 'negative'
    return 'excluded'
  }

  // Default Agreement / Frequency scale: 1–2 / 3 / 4–5 with wording-aware inversion
  if (value === 3) return 'neutral'
  if (wording === '+') {
    if (value === 4 || value === 5) return 'positive'
    if (value === 1 || value === 2) return 'negative'
  } else {
    if (value === 1 || value === 2) return 'positive'
    if (value === 4 || value === 5) return 'negative'
  }
  return 'excluded'
}

/* ---------- per-item stats ---------- */

export interface ItemStats {
  question_id: string
  positive: number
  neutral: number
  negative: number
  total: number   // valid (non-excluded)
  pct_positive: number   // 0..100, unrounded
  pct_neutral: number
  pct_negative: number
}

export function itemStats(
  q: PscsQuestion,
  answers: PscsAnswer[],
): ItemStats {
  let positive = 0, neutral = 0, negative = 0
  for (const a of answers) {
    if (a.question_id !== q.id) continue
    const b = classify(a.value, q.wording, q.scale_type)
    if (b === 'positive') positive++
    else if (b === 'neutral') neutral++
    else if (b === 'negative') negative++
  }
  const total = positive + neutral + negative
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100)
  return {
    question_id: q.id,
    positive, neutral, negative, total,
    pct_positive: pct(positive),
    pct_neutral: pct(neutral),
    pct_negative: pct(negative),
  }
}

/* ---------- composite stats ---------- */

export interface CompositeStats {
  composite_code: string
  items: ItemStats[]
  score: number | null      // mean of unrounded item % positives, or null if insufficient data
  itemsWithScore: number    // number of items with ≥3 valid responses
  itemsTotal: number
}

const MIN_RESPONSES_PER_ITEM = 3

export function compositeStats(
  compositeCode: string,
  questions: PscsQuestion[],
  answers: PscsAnswer[],
): CompositeStats {
  const compQuestions = questions.filter((q) => q.composite_code === compositeCode && q.active)
  const items = compQuestions.map((q) => itemStats(q, answers))
  const valid = items.filter((it) => it.total >= MIN_RESPONSES_PER_ITEM)
  const itemsTotal = items.length

  // AHRQ rule:
  // - Need at least half of items with scores
  // - For 3-item composites, need at least 2 of 3
  // - For all others, half-rounded-up minimum
  const minNeeded = itemsTotal === 3 ? 2 : Math.ceil(itemsTotal / 2)
  if (valid.length < minNeeded) {
    return { composite_code: compositeCode, items, score: null, itemsWithScore: valid.length, itemsTotal }
  }

  const sum = valid.reduce((s, it) => s + it.pct_positive, 0)
  return {
    composite_code: compositeCode,
    items,
    score: sum / valid.length,
    itemsWithScore: valid.length,
    itemsTotal,
  }
}

/* ---------- distribution helpers (D3 events, E1 rating) ---------- */

export interface BucketCount {
  value: number   // 1..5
  count: number
  pct: number     // 0..100
}

export function distribution(
  questionId: string,
  answers: PscsAnswer[],
  buckets: number[] = [1, 2, 3, 4, 5],
): { items: BucketCount[]; total: number } {
  const counts = new Map<number, number>()
  for (const b of buckets) counts.set(b, 0)
  let total = 0
  for (const a of answers) {
    if (a.question_id !== questionId) continue
    if (a.value === 0 || a.value === null || a.value === undefined) continue
    counts.set(a.value, (counts.get(a.value) ?? 0) + 1)
    total++
  }
  const items: BucketCount[] = buckets.map((v) => ({
    value: v,
    count: counts.get(v) ?? 0,
    pct: total === 0 ? 0 : ((counts.get(v) ?? 0) / total) * 100,
  }))
  return { items, total }
}

/* ---------- color band (AHRQ standard) ---------- */

export type Band = 'strength' | 'watch' | 'gap' | 'na'

export function band(pct: number | null): Band {
  if (pct === null || !Number.isFinite(pct)) return 'na'
  if (pct >= 75) return 'strength'
  if (pct >= 50) return 'watch'
  return 'gap'
}

export const BAND_COLOR: Record<Band, string> = {
  strength: '#16A34A',   // green
  watch:    '#F59E0B',   // amber
  gap:      '#DC2626',   // red
  na:       '#9CA3AF',   // grey
}

export const BAND_LABEL: Record<Band, string> = {
  strength: 'Strength (≥75%)',
  watch:    'Watch (50–74%)',
  gap:      'Gap (<50%)',
  na:       'Insufficient data',
}

/* ---------- response filtering ---------- */

export interface ResponseFilter {
  campaignId?: number
  positionId?: number
  positionGroup?: string             // group_en value
  directorateCode?: string
  departmentCode?: string
  subDepartmentCode?: string
  tenureHospital?: string
  tenureUnit?: string
  hoursPerWeek?: string
  directPatientContact?: boolean
}

export function answersForResponses<T extends { id: string }>(
  responses: T[],
  answers: PscsAnswer[],
): PscsAnswer[] {
  const idSet = new Set(responses.map((r) => r.id))
  return answers.filter((a) => idSet.has(a.response_id))
}

/* ---------- group-by-cohort breakdown matrix ---------- */
/*
 * Given a list of "groups" (each a labelled bucket of responses), produce one
 * row per group with:
 *   - n         : number of responses in the group
 *   - perComposite: Map<composite_code, score|null>  (null = insufficient data)
 *   - overall   : mean of available composite scores, or null
 *   - suppressed: true when n < minResponses (UI should hide the numbers but
 *                 keep the row visible so the user knows the group exists)
 *
 * Per-item / per-composite suppression continues to use the existing AHRQ
 * MIN_RESPONSES_PER_ITEM rule inside compositeStats(); the group-level
 * minResponses is an additional privacy guard against tiny cohorts.
 */

export interface BreakdownGroup<T extends { id: string }> {
  key: string
  label_en: string
  label_ms: string
  responses: T[]
  meta?: Record<string, string | number | boolean | null>
}

export interface BreakdownRow {
  key: string
  label_en: string
  label_ms: string
  n: number
  suppressed: boolean
  perComposite: Map<string, number | null>
  overall: number | null
  meta?: Record<string, string | number | boolean | null>
}

const DEFAULT_GROUP_MIN_RESPONSES = 3

export function breakdownMatrix<T extends { id: string }>(
  groups: BreakdownGroup<T>[],
  composites: PscsComposite[],
  questions: PscsQuestion[],
  answers: PscsAnswer[],
  minResponses: number = DEFAULT_GROUP_MIN_RESPONSES,
): BreakdownRow[] {
  return groups.map((g) => {
    const n = g.responses.length
    const suppressed = n < minResponses
    const perComposite = new Map<string, number | null>()
    let overall: number | null = null

    if (!suppressed) {
      const groupAnswers = answersForResponses(g.responses, answers)
      const scoresForAvg: number[] = []
      for (const c of composites) {
        if (c.is_rating) continue
        const s = compositeStats(c.code, questions, groupAnswers).score
        perComposite.set(c.code, s)
        if (s !== null) scoresForAvg.push(s)
      }
      overall = scoresForAvg.length === 0 ? null : scoresForAvg.reduce((a, b) => a + b, 0) / scoresForAvg.length
    }

    return {
      key: g.key,
      label_en: g.label_en,
      label_ms: g.label_ms,
      n,
      suppressed,
      perComposite,
      overall,
      meta: g.meta,
    }
  })
}
