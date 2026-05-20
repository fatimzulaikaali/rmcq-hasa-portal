/* Risk Management module types — mirror the Supabase schema */

export type RiskRole       = 'RLO' | 'HOD' | 'RC' | 'ROC_MEMBER' | 'RTC_MEMBER' | 'DIRECTOR' | 'ADMIN'
export type RiskCategory   = 'OPS' | 'KEW' | 'REP' | 'PER' | 'STR' | 'PRJ'
export type RiskScope      = 'INSTITUSI' | 'UNIT'
export type RiskStatus     = 'DRAFT' | 'PENDING_HOD' | 'PENDING_RC' | 'ACTIVE' | 'MONITORING' | 'REJECTED' | 'PENDING_CLOSURE' | 'CLOSED'
export type RiskLevel      = 'RENDAH' | 'SEDERHANA' | 'TINGGI' | 'EKSTREM'
export type TreatmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED'
export type MeetingType    = 'RTC' | 'ROC'
export type MeetingStatus  = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type AgendaDecision = 'CONTINUE' | 'MONITOR' | 'CARRY_FORWARD' | 'ESCALATE_ROC' | 'RECOMMEND_CLOSE'
export type ActionType     = 'CLARIFICATION' | 'DIRECTIVE'
export type ActionStatus   = 'PENDING' | 'RESPONDED' | 'ACCEPTED' | 'OVERDUE' | 'ESCALATED'
export type ReportPeriod   = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'NINE_MONTHS' | 'ANNUAL'

export interface RiskUser {
  id: number
  auth_user_id: string | null
  name: string
  email: string
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface RiskUserRole {
  id: number
  user_id: number
  dept_code: string | null   // null = hospital-wide
  role: RiskRole
  assigned_at: string
  assigned_by: number | null
  is_active: boolean
}

export interface Risk {
  id: number
  risk_id: string
  dept_code: string
  created_by: number
  category: RiskCategory
  scope: RiskScope
  description: string
  cause_description: string
  impact_description: string
  existing_controls: string | null
  additional_controls: string | null
  control_classification: string | null
  action_owner: string | null
  implementation_period: string | null
  notes: string | null
  status: RiskStatus
  date_opened: string
  date_closed: string | null
  closed_by: number | null
  is_isu_melintang: boolean
  rejection_reason: string | null
  rejection_comment: string | null
  rejected_by: number | null
  rejected_at: string | null
  resubmission_of: number | null
  created_at: string
  updated_at: string
}

export interface RiskReview {
  id: number
  risk_id: number
  cycle_number: number
  reviewed_by: number
  review_date: string
  likelihood: number
  impact_manusia: number
  impact_reputasi: number
  impact_kewangan: number
  impact_operasi: number
  impact_objektif: number
  avg_impact: number
  risk_score: number
  risk_level: RiskLevel
  treatment_status: TreatmentStatus | null
  treatment_update: string | null
  endorsed_by: number | null
  endorsed_at: string | null
  endorsement_comment: string | null
  validated_by: number | null
  validated_at: string | null
  validation_comment: string | null
  created_at: string
}

export interface CrossCuttingTheme {
  id: number
  name: string
  name_ms: string | null
  description: string | null
  is_active: boolean
  created_at: string
}

/* Department row from pscs_departments — Risk module reads at dept level only.
 * `risk_code` is the short abbreviation (MED, ED, PHR…) used in risk_id prefix. */
export interface RiskDept {
  code: string
  risk_code: string
  name_en: string
  name_ms: string
  kind: 'directorate' | 'department' | 'subunit'
  parent_code: string | null
  sort_order: number
}

/* List-view shape for the /risk table — risks joined with dept + latest review */
export interface RiskListRow {
  risk: Risk
  dept: { code: string; risk_code: string; name_en: string; name_ms: string } | null
  latest: RiskReview | null
}
