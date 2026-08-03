/* Types + helpers for the Mortality & Morbidity (M&M) monitoring module.
 *
 * Minimal-identifier by design: no patient NAME and no NRIC are ever stored.
 * The case does retain the MRN as the linkage key back to the patient record,
 * plus its own case number. Because MRN is a patient identifier, the module is
 * restricted to department access with a full audit trail. It is a governance/
 * monitoring tool, not a clinical record. */

export type MmReportType = 'Mortality' | 'Morbidity'

/** The two facilities, analysed separately.
 *  HASA = Hospital Al-Sultan Abdullah · PPUiTM = Pusat Perubatan UiTM. */
export type MmFacility = 'HASA' | 'PPUiTM'
export const MM_FACILITIES: { code: MmFacility; label: string }[] = [
  { code: 'HASA', label: 'HASA' },
  { code: 'PPUiTM', label: 'PPUiTM' },
]
/** Normalise a free-text facility value (from Excel) to a facility code. */
export function normFacility(v: unknown, fallback: MmFacility = 'HASA'): MmFacility {
  const s = String(v ?? '').toLowerCase()
  if (/ppuitm|pusat perubatan|sungai buloh|selayang/.test(s)) return 'PPUiTM'
  if (/hasa|sultan abdullah/.test(s)) return 'HASA'
  return fallback
}

export type MmStatus =
  | 'Untriaged' | 'No review' | 'Dept review' | 'HOD verified'
  | 'Hospital-level' | 'Actions open' | 'Closed'

export type MmCategory = 'Preventable' | 'Non-preventable' | 'Undetermined'

export type MmActionLevel = 'System' | 'Individual'
export type MmActionStatus = 'Open' | 'In progress' | 'Completed' | 'Overdue'

export interface MmDepartment {
  code: string
  name: string
  hod: string | null
  deputy: string | null
  pic: string | null
  sort_order: number
  active: boolean
}

export interface MmCase {
  id: number
  case_no: string
  facility: MmFacility
  report_type: MmReportType
  report_date: string | null
  dept_code: string | null
  ward: string | null              // ward / location at time of death
  admission_ward: string | null    // ward at admission
  race: string | null
  age: number | null
  sex: string | null
  admission_date: string | null
  death_datetime: string | null
  time_of_death: string | null     // HH:MM (free text)
  los_days: number | null
  diagnosis: string | null
  cause_icd: string | null
  is_bid: boolean
  // Part 2
  dnr_established: boolean | null
  mdt_review: boolean | null
  palliative_referral: boolean | null
  cardiac_arrest_cpr: boolean | null
  autopsy_requested: boolean | null
  expected_death: boolean | null
  delay_in_diagnosis: boolean | null
  delay_in_treatment: boolean | null
  death_within_48h: boolean | null
  death_readmission_30d: boolean | null
  patient_safety_incident: boolean | null
  incident_report_made: boolean | null
  prepared_by: string | null
  prepared_date: string | null
  // Gate 1
  gate1_dept_meeting_required: boolean | null
  no_review_reason: string | null
  // Part 3
  category_of_death: MmCategory | null
  meeting_date: string | null
  minutes_attached: boolean
  attendance_attached: boolean
  // Part 4
  hod_comments: string | null
  hod_reviewed_by: string | null
  hod_verified_date: string | null
  // Gate 2 + Part 5
  gate2_hospital_meeting_recommended: boolean | null
  subcommittee: string | null
  subcommittee_comments: string | null
  subcommittee_reviewed_date: string | null
  committee_comments: string | null
  committee_verified_date: string | null
  presented_at_hospital_date: string | null
  // evidence
  hod_certification: boolean
  learning_points_disseminated: boolean
  dissemination_date: string | null
  dissemination_method: string | null
  // lifecycle
  status: MmStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MmCaseShortfall {
  case_id: number
  shortfall: string
  specify: string | null
}

export interface MmAction {
  id: number
  case_id: number
  description: string
  responsible: string | null
  action_level: MmActionLevel | null
  action_type: string | null
  due_date: string | null
  status: MmActionStatus
  closure_evidence: string | null
  verified_by: string | null
  linked_shortfall: string | null
  created_at: string
}

/* ---------------------------------------------------------------- reference */

export const MM_STATUSES: MmStatus[] = [
  'Untriaged', 'No review', 'Dept review', 'HOD verified', 'Hospital-level', 'Actions open', 'Closed',
]

export const MM_CATEGORIES: MmCategory[] = ['Preventable', 'Non-preventable', 'Undetermined']

/** Shortfall-in-quality categories (Part 3 of the form). */
export const MM_SHORTFALLS: string[] = [
  'Nosocomial infection',
  'Iatrogenic injury',
  'Systemic issue',
  'Delayed / missed referral',
  'Communication breakdown',
  'SOP non-adherence',
  'Inadequate training',
  'Insufficient supervision',
]

export const MM_ACTION_TYPES: string[] = [
  'Policy/SOP', 'Training', 'Equipment', 'Staffing', 'Guideline', 'Communication', 'Other',
]

export const MM_ACTION_STATUSES: MmActionStatus[] = ['Open', 'In progress', 'Completed', 'Overdue']

/** Part-2 clinical-assessment booleans, with labels and whether "Yes" is a red flag. */
export const MM_ASSESS_FIELDS: { key: keyof MmCase; label: string; flagOnYes: boolean }[] = [
  { key: 'expected_death', label: 'Expected death at admission', flagOnYes: false },
  { key: 'death_within_48h', label: 'Death within 48h of admission', flagOnYes: true },
  { key: 'death_readmission_30d', label: 'Death on readmission within 30d', flagOnYes: true },
  { key: 'delay_in_diagnosis', label: 'Delay in diagnosis', flagOnYes: true },
  { key: 'delay_in_treatment', label: 'Delay in treatment', flagOnYes: true },
  { key: 'patient_safety_incident', label: 'Patient safety incident', flagOnYes: true },
  { key: 'incident_report_made', label: 'Incident report made', flagOnYes: false },
  { key: 'mdt_review', label: 'MDT review', flagOnYes: false },
  { key: 'dnr_established', label: 'DNR established', flagOnYes: false },
  { key: 'palliative_referral', label: 'Palliative referral', flagOnYes: false },
  { key: 'cardiac_arrest_cpr', label: 'Cardiac arrest / CPR', flagOnYes: true },
  { key: 'autopsy_requested', label: 'Autopsy requested', flagOnYes: false },
]

/* ---------------------------------------------------------------- PI logic
 *
 * PI 01 (mandatory): % of M&M cases discussed AND documented ÷ total cases.
 *   Numerator  = cases with meeting date + minutes + attendance list on file.
 *   Denominator (mortality) = recorded mortality cases, EXCLUDING BID.
 *   Denominator (morbidity) = recorded morbidity cases.
 * Computed separately for mortality and morbidity, each vs the 30% target.
 * (Denominator definition is configurable policy — this is the v1 default.) */

export function isDocumented(c: MmCase): boolean {
  return !!c.meeting_date && c.minutes_attached && c.attendance_attached
}

export interface Pi01 { num: number; den: number; pct: number }

export function pi01(cases: MmCase[], type: MmReportType): Pi01 {
  const pool = cases.filter((c) => c.report_type === type && !(type === 'Mortality' && c.is_bid))
  const den = pool.length
  const num = pool.filter(isDocumented).length
  return { num, den, pct: den ? Math.round((num / den) * 100) : 0 }
}

export function coverageColor(pct: number): string {
  if (pct >= 30) return '#0ca30c'
  if (pct >= 18) return '#c98500'
  return '#d03b3b'
}

/** Auto-derive an action's status from its due date unless already completed. */
export function effectiveActionStatus(a: MmAction): MmActionStatus {
  if (a.status === 'Completed') return 'Completed'
  if (a.due_date && new Date(a.due_date) < new Date()) return 'Overdue'
  return a.status
}

/** Next case number for a year, given the existing highest sequence. */
export function nextCaseNo(existing: string[], year = new Date().getFullYear()): string {
  const prefix = `MM/${year}/`
  let max = 0
  for (const cn of existing) {
    if (cn.startsWith(prefix)) {
      const n = parseInt(cn.slice(prefix.length), 10)
      if (!Number.isNaN(n) && n > max) max = n
    }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}
