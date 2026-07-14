/* Risk Management module — scoring helper.
 *
 * Per the HASA ERMS (ISO 31000:2018) model:
 *   Risk Rating = Likelihood × Severity   (both integers 1-5, score range 1-25)
 *   Risk Level:  16-25 = Extreme, 10-15 = High, 6-9 = Moderate, 1-5 = Low
 *
 * The internal RiskLevel enum keeps its stable identifiers
 * (EKSTREM/TINGGI/SEDERHANA/RENDAH) which map 1:1 onto the English bands;
 * only the displayed labels are English (see RISK_LEVEL_LABEL).
 *
 * `computeSeverityScore` is the new single-severity model (used by the revamped
 * register form). `computeRiskScore` retains the legacy 5-impact-average
 * signature so existing callers keep compiling until the register form is
 * migrated; both route their level through the shared `riskLevelFromScore`.
 */

import {
  RiskLevel, RiskDomain, RiskNature, TreatmentOption, RiskStatus, RiskScope,
  RiskRole, MeetingType, MeetingStatus, CommitteeOutcome, ActionType, ActionStatus,
} from './types'

/* Shared banding — the single source of truth for the ISO 5×5 grid.
 *   Extreme 16-25 · High 10-15 · Moderate 6-9 · Low 1-5 */
export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 16) return 'EKSTREM'
  if (score >= 10) return 'TINGGI'
  if (score >= 6)  return 'SEDERHANA'
  return 'RENDAH'
}

export interface ComputedSeverityScore {
  riskScore: number
  riskLevel: RiskLevel
}

/* New ERMS model — Likelihood × Severity, both 1-5. */
export function computeSeverityScore(
  likelihood: number,
  severity: number,
): ComputedSeverityScore {
  const riskScore = likelihood * severity
  return { riskScore, riskLevel: riskLevelFromScore(riskScore) }
}

export interface ComputedRiskScore {
  avgImpact: number
  riskScore: number
  riskLevel: RiskLevel
}

/* Legacy 5-impact-average model — kept only so pre-migration callers compile.
 * Removed once the register form + reviews move to single severity (Phase 2). */
export function computeRiskScore(
  likelihood: number,
  impacts: number[],
): ComputedRiskScore {
  if (impacts.length === 0) {
    return { avgImpact: 0, riskScore: 0, riskLevel: 'RENDAH' }
  }
  const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length
  const riskScore = likelihood * avgImpact
  return { avgImpact, riskScore, riskLevel: riskLevelFromScore(riskScore) }
}

/* Risk ID format: [RISK_CODE]-[YY]-[SEQ]   e.g. MED-26-001
 * Sequence is per (dept, year). Caller passes the next free sequence number. */
export function formatRiskId(riskCode: string, year: number, seq: number): string {
  const yy = String(year).slice(-2).padStart(2, '0')
  const padded = String(seq).padStart(3, '0')
  return `${riskCode}-${yy}-${padded}`
}

/* Display colors / labels — matched to the existing portal palette */

export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  EKSTREM:   '#DC2626',  // red
  TINGGI:    '#F97316',  // orange
  SEDERHANA: '#F59E0B',  // amber
  RENDAH:    '#16A34A',  // green
}

export const RISK_LEVEL_BG: Record<RiskLevel, string> = {
  EKSTREM:   '#FEE2E2',
  TINGGI:    '#FED7AA',
  SEDERHANA: '#FEF3C7',
  RENDAH:    '#DCFCE7',
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  EKSTREM:   'Extreme',
  TINGGI:    'High',
  SEDERHANA: 'Moderate',
  RENDAH:    'Low',
}

/* The 12 UiTM domains — Coordinator-assigned, for presentation / submission. */
export const RISK_DOMAIN_LABEL: Record<RiskDomain, string> = {
  STRATEGIC:        'Strategic',
  OPERATIONAL:      'Operational',
  FINANCIAL:        'Financial',
  LEGAL_COMPLIANCE: 'Legal / Compliance',
  REPUTATIONAL:     'Reputational',
  CLINICAL:         'Clinical / Patient Care',
  HEALTH_SAFETY:    'Health & Safety',
  ENVIRONMENTAL:    'Environmental',
  SECURITY_IT:      'Security / IT',
  HR:               'Human Resource',
  PROJECT:          'Project',
  SUPPLY_CHAIN:     'Supply Chain',
}

export const RISK_NATURE_LABEL: Record<RiskNature, string> = {
  ACTUAL:    'Actual risk',
  POTENTIAL: 'Potential risk',
}

export const TREATMENT_OPTION_LABEL: Record<TreatmentOption, string> = {
  AVOID:    'Avoid',
  TRANSFER: 'Transfer',
  CONTROL:  'Control',
  ACCEPT:   'Accept',
}

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  DRAFT:            'Draft',
  PENDING_HOD:      'Pending HOD',
  PENDING_RC:       'Pending RC',
  TABLED_RTC:       'Tabled for RTC',
  TABLED_ROC:       'Tabled for ROC',
  ACTIVE:           'Active',
  MONITORING:       'Monitoring',
  REJECTED:         'Rejected',
  RETURNED:         'Returned for Amendment',
  OUT_OF_SCOPE:     'Out of Scope',
  PENDING_CLOSURE:  'Pending Closure',
  CLOSED:           'Closed',
}

export const RISK_STATUS_BADGE: Record<RiskStatus, { bg: string; fg: string }> = {
  DRAFT:           { bg: '#F3F4F6', fg: '#374151' },
  PENDING_HOD:     { bg: '#DBEAFE', fg: '#1E40AF' },
  PENDING_RC:      { bg: '#E0E7FF', fg: '#3730A3' },
  TABLED_RTC:      { bg: '#CFFAFE', fg: '#155E75' },
  TABLED_ROC:      { bg: '#EDE9FE', fg: '#5B21B6' },
  ACTIVE:          { bg: '#DCFCE7', fg: '#166534' },
  MONITORING:      { bg: '#FEF3C7', fg: '#854D0E' },
  REJECTED:        { bg: '#FEE2E2', fg: '#991B1B' },
  RETURNED:        { bg: '#FEF3C7', fg: '#92400E' },
  OUT_OF_SCOPE:    { bg: '#E5E7EB', fg: '#4B5563' },
  PENDING_CLOSURE: { bg: '#FED7AA', fg: '#9A3412' },
  CLOSED:          { bg: '#E5E7EB', fg: '#4B5563' },
}

export const RISK_SCOPE_LABEL: Record<RiskScope, string> = {
  INSTITUSI: 'Institusi',
  UNIT:      'Unit',
}

export const RISK_ROLE_LABEL: Record<RiskRole, string> = {
  RLO:        'Risk Liaison Officer',
  HOD:        'Head of Department',
  RC:         'Risk Coordinator',
  ROC_MEMBER: 'ROC Member',
  RTC_MEMBER: 'RTC Member',
  DIRECTOR:   'Director',
  ADMIN:      'Administrator',
}

export const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  RTC: 'Risk Technical Committee',
  ROC: 'Risk Owner Committee',
}

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  PLANNED:     'Planned',
  IN_PROGRESS: 'In progress',
  COMPLETED:   'Completed',
  CANCELLED:   'Cancelled',
}

/* Human label for each committee decision, and how it moves the risk. */
export const COMMITTEE_OUTCOME_LABEL: Record<CommitteeOutcome, string> = {
  ENDORSE_ACTIVE:  'Endorse → Active',
  ESCALATE_ROC:    'Escalate → ROC',
  SEND_BACK_RTC:   'Send back to RTC',
  SEND_BACK_DEPT:  'Send back to dept',
  RECOMMEND_CLOSE: 'Recommend closure',
}

export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  CLARIFICATION: 'Clarification',
  DIRECTIVE:     'Directive',
}

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  PENDING:   'Pending',
  RESPONDED: 'Responded',
  ACCEPTED:  'Accepted',
  OVERDUE:   'Overdue',
  ESCALATED: 'Escalated',
}

/* Maps a committee outcome to the risk status it produces.
 * `meetingType` matters only for ENDORSE/escalation context, but every outcome
 * here resolves to a single next status regardless of which committee recorded it. */
export function outcomeToStatus(outcome: CommitteeOutcome): RiskStatus {
  switch (outcome) {
    case 'ENDORSE_ACTIVE':  return 'ACTIVE'
    case 'ESCALATE_ROC':    return 'TABLED_ROC'
    case 'SEND_BACK_RTC':   return 'TABLED_RTC'
    case 'SEND_BACK_DEPT':  return 'RETURNED'
    case 'RECOMMEND_CLOSE': return 'PENDING_CLOSURE'
  }
}

/* Which outcomes a given committee may record (RTC can escalate to ROC;
 * ROC can send back to RTC; both can endorse / send to dept / recommend close). */
export function allowedOutcomes(meetingType: MeetingType): CommitteeOutcome[] {
  if (meetingType === 'RTC') {
    return ['ENDORSE_ACTIVE', 'ESCALATE_ROC', 'SEND_BACK_DEPT', 'RECOMMEND_CLOSE']
  }
  return ['ENDORSE_ACTIVE', 'SEND_BACK_RTC', 'SEND_BACK_DEPT', 'RECOMMEND_CLOSE']
}
