/* Risk Management module types — mirror the Supabase schema */

export type RiskRole       = 'RLO' | 'HOD' | 'RC' | 'ROC_MEMBER' | 'RTC_MEMBER' | 'DIRECTOR' | 'ADMIN'
/* ERMS: the 12 UiTM risk domains — assigned by the Risk Coordinator for
 * presentation / UiTM submission. Departments enter open `context` instead. */
export type RiskDomain     =
  | 'STRATEGIC' | 'OPERATIONAL' | 'FINANCIAL' | 'LEGAL_COMPLIANCE' | 'REPUTATIONAL'
  | 'CLINICAL' | 'HEALTH_SAFETY' | 'ENVIRONMENTAL' | 'SECURITY_IT' | 'HR'
  | 'PROJECT' | 'SUPPLY_CHAIN'
export type RiskNature     = 'ACTUAL' | 'POTENTIAL'
export type TreatmentOption = 'AVOID' | 'TRANSFER' | 'CONTROL' | 'ACCEPT'
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
  /* ERMS register (Form 0044) fields */
  context: string                        // open text — department's own framing (required)
  uitm_domain: RiskDomain | null         // Coordinator-assigned, for UiTM submission
  risk_nature: RiskNature | null         // Actual vs Potential
  treatment_option: TreatmentOption | null
  scope: RiskScope
  description: string
  cause_description: string
  impact_description: string             // "Consequence of Risk" on Form 0044
  existing_controls: string | null
  additional_controls: string | null
  control_classification: string | null
  action_owner: string | null
  action_owner_depts: string[] | null
  implementation_period: string | null
  notes: string | null
  status: RiskStatus
  /* RMCQ-mode: distinguishes portal-driven (workflow) from paper-driven
   * (rmcq_managed) submissions. Defaults to 'workflow' on existing rows. */
  entry_mode: 'workflow' | 'rmcq_managed'
  /* Paper-source metadata for the ORIGINAL submission. Populated when an RC
   * enters a paper risk via /risk/quick-add; null for workflow-mode risks. */
  paper_submitted_by: string | null
  paper_submission_date: string | null
  paper_endorsed_by: string | null
  paper_endorsement_date: string | null
  paper_reference: string | null
  /* Rebuild (2026): committee-outcome summary recorded inline by the Coordinator
   * from paper/PDF submissions, plus the ERMS submission flag set at ROC. */
  submit_to_erms: boolean
  escalation_type: 'AUTO' | 'MANUAL' | 'NONE' | null
  committee_stage: 'NOT_TABLED' | 'TABLED_RTC' | 'ENDORSED_ROC' | 'SENT_BACK' | 'RECOMMEND_CLOSE' | null
  rtc_ref: string | null
  roc_ref: string | null
  committee_notes: string | null
  register_review_date: string | null
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
  /* ERMS single severity (1-5) — the current model. */
  severity: number | null
  /* Legacy 5-impact-average fields — nullable; kept for pre-revamp rows. */
  impact_manusia: number | null
  impact_reputasi: number | null
  impact_kewangan: number | null
  impact_operasi: number | null
  impact_objektif: number | null
  avg_impact: number | null
  risk_score: number
  risk_level: RiskLevel
  /* Residual risk (re-scored after treatment) */
  residual_likelihood: number | null
  residual_severity: number | null
  residual_score: number | null
  residual_level: RiskLevel | null
  treatment_status: TreatmentStatus | null
  treatment_update: string | null
  endorsed_by: number | null
  endorsed_at: string | null
  endorsement_comment: string | null
  validated_by: number | null
  validated_at: string | null
  validation_comment: string | null
  /* Paper-source metadata for THIS review cycle (cycle 2+ under RMCQ-mode).
   * Cycle 1 inherits its paper source from the risks row. */
  paper_reviewed_by: string | null
  paper_review_date: string | null
  paper_endorsed_by: string | null
  paper_endorsement_date: string | null
  paper_reference: string | null
  created_at: string
}

/* Per-risk attachments — the source risk-register PDF a department submits and
 * the Risk Treatment Plan (RTP), if any. Either an uploaded file (storage_path,
 * held in the `risk-attachments` Storage bucket) or an external Drive link
 * (external_url) — never both. */
export type RiskAttachmentKind = 'register' | 'rtp' | 'other'

export interface RiskAttachment {
  id: string
  risk_id: number
  kind: RiskAttachmentKind
  label: string | null
  storage_path: string | null
  external_url: string | null
  file_name: string | null
  byte_size: number | null
  uploaded_by: number | null
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
  /* Legacy FK — kept for historical rows; new code uses chair_name. */
  chaired_by: number | null
  /* Free-text chair name (current). Chair may be anyone — internal or external. */
  chair_name: string | null
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

export interface PreMeetingScoring {
  likelihood: number
  severity?: number | null
  impact_manusia?: number | null
  impact_reputasi?: number | null
  impact_kewangan?: number | null
  impact_operasi?: number | null
  impact_objektif?: number | null
  avg_impact?: number | null
  risk_score: number
  risk_level: RiskLevel
  cycle_number: number
}

export interface RiskMeetingAgenda {
  id: number
  meeting_id: number
  risk_id: number
  seq: number
  outcome: CommitteeOutcome | null
  /* What the committee discussed — free-form notes captured during debate. */
  discussion_notes: string | null
  /* The formal decision text — separate from discussion so minutes can show
   * both ("here's what was discussed" then "here's what was decided"). */
  decision_text: string | null
  /* Snapshot of the scoring as it ENTERED the meeting — captured the first
   * time the committee re-scores. Used to display pre vs. post in the minutes.
   * Null when no re-score was applied at this meeting. */
  pre_meeting_scoring: PreMeetingScoring | null
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

/* ---------- Rebuild (2026): first-class RTP (Form 0045) ---------- */

export type RtpAdequacy = 'H' | 'M' | 'L'
export type RtpOverallStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED'
export type RtpTaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'

/* One Risk Treatment Plan per risk. `existing_control` is NOT stored here — it
 * is read live from the linked risk so it always matches the register. */
export interface RiskRtp {
  id: string
  risk_id: number
  new_control: string | null
  adequacy: RtpAdequacy | null
  participating_depts: string | null
  risk_owner: string | null
  monitored_by: string | null
  prepared_by_name: string | null;  prepared_by_date: string | null
  approved_hod_name: string | null; approved_hod_date: string | null
  reviewed_rtc_name: string | null; reviewed_rtc_date: string | null
  approved_roc_name: string | null; approved_roc_date: string | null
  overall_status: RtpOverallStatus
  last_reviewed: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export interface RiskRtpTask {
  id: string
  rtp_id: string
  seq: number
  task: string
  pic: string | null
  due_date: string | null
  status: RtpTaskStatus
  updated_by: number | null
  updated_at: string
  created_at: string
}

/* Timestamped log of Coordinator status changes to an RTP. */
export interface RiskRtpUpdate {
  id: string
  rtp_id: string
  note: string | null
  status: string | null
  created_by: number | null
  created_at: string
}

/* A department's response to a committee directive, recorded by the Coordinator
 * (departments don't log in — they communicate outside the portal). */
export interface RiskDeptResponse {
  id: string
  risk_id: number
  directive: string | null
  response: string | null
  received_on: string | null
  received_via: string | null
  recorded_by: number | null
  created_at: string
}
