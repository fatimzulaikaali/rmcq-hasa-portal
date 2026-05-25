/* Risk Management module types — mirror the Supabase schema */

export type RiskRole       = 'RLO' | 'HOD' | 'RC' | 'ROC_MEMBER' | 'RTC_MEMBER' | 'DIRECTOR' | 'ADMIN'
export type RiskCategory   = 'OPS' | 'KEW' | 'REP' | 'PER' | 'STR' | 'PRJ'
export type RiskScope      = 'INSTITUSI' | 'UNIT'
export type RiskStatus     = 'DRAFT' | 'PENDING_HOD' | 'PENDING_RC' | 'TABLED_RTC' | 'TABLED_ROC' | 'ACTIVE' | 'MONITORING' | 'REJECTED' | 'RETURNED' | 'OUT_OF_SCOPE' | 'PENDING_CLOSURE' | 'CLOSED'
export type RiskLevel      = 'RENDAH' | 'SEDERHANA' | 'TINGGI' | 'EKSTREM'
export type TreatmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED'
export type MeetingType    = 'RTC' | 'ROC'
export type MeetingStatus  = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type AgendaDecision = 'CONTINUE' | 'MONITOR' | 'CARRY_FORWARD' | 'ESCALATE_ROC' | 'RECOMMEND_CLOSE'
export type ActionType     = 'CLARIFICATION' | 'DIRECTIVE'
export type ActionStatus   = 'PENDING' | 'RESPONDED' | 'ACCEPTED' | 'OVERDUE' | 'ESCALATED'
export type ReportPeriod   = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1' | 'H2' | 'NINE_MONTHS' | 'ANNUAL'

/* What a committee (RTC/ROC) records per agenda item — drives the risk's next status. */
export type CommitteeOutcome =
  | 'ENDORSE_ACTIVE'   // accept -> ACTIVE
  | 'ESCALATE_ROC'     // RTC -> TABLED_ROC
  | 'SEND_BACK_RTC'    // ROC -> TABLED_RTC
  | 'SEND_BACK_DEPT'   // bounce to dept (RLO/HOD) -> RETURNED (for amendment), revise in place
  | 'RECOMMEND_CLOSE'  // -> PENDING_CLOSURE

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
  action_owner_depts: string[] | null
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
  pending_ack: boolean
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

/* ---------- Phase 3.9: committee meetings (RTC / ROC) ---------- */

export interface RiskMeeting {
  id: number
  meeting_type: MeetingType
  title: string
  meeting_date: string
  status: MeetingStatus
  chaired_by: number | null
  location: string | null
  minutes: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface RiskMeetingAttendee {
  id: number
  meeting_id: number
  user_id: number | null
  name: string | null
  role_label: string | null
  present: boolean
  created_at: string
}

export interface RiskMeetingAgenda {
  id: number
  meeting_id: number
  risk_id: number
  seq: number
  outcome: CommitteeOutcome | null
  discussion_notes: string | null
  review_id: number | null
  decided_by: number | null
  decided_at: string | null
  created_at: string
}

export interface RiskRocRtcLink {
  id: number
  roc_meeting_id: number
  rtc_meeting_id: number
  created_by: number | null
  created_at: string
}

export interface RiskActionItem {
  id: number
  meeting_id: number | null
  agenda_id: number | null
  risk_id: number | null
  action_type: ActionType
  description: string
  assigned_to: number | null
  assigned_dept: string | null
  assigned_depts: string[]
  due_date: string | null
  status: ActionStatus
  response: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}
