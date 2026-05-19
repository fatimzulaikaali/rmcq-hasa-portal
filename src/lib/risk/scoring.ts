/* Risk Management module — scoring helper.
 *
 * Per the HASA Risk brief:
 *   Risk Score = Likelihood × Average(Manusia, Reputasi, Kewangan, Operasi, Objektif)
 *   Risk Level: > 12 = EKSTREM, > 7 = TINGGI, > 3 = SEDERHANA, else RENDAH
 *
 * Likelihood and each impact are integers 1-5. Score range: 1-25.
 */

import {
  RiskLevel, RiskCategory, RiskStatus, RiskScope, RiskRole, MeetingType,
} from './types'

export interface ComputedRiskScore {
  avgImpact: number
  riskScore: number
  riskLevel: RiskLevel
}

export function computeRiskScore(
  likelihood: number,
  impacts: number[],
): ComputedRiskScore {
  if (impacts.length === 0) {
    return { avgImpact: 0, riskScore: 0, riskLevel: 'RENDAH' }
  }
  const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length
  const riskScore = likelihood * avgImpact
  const riskLevel: RiskLevel =
    riskScore > 12 ? 'EKSTREM' :
    riskScore > 7  ? 'TINGGI'  :
    riskScore > 3  ? 'SEDERHANA' :
                     'RENDAH'
  return { avgImpact, riskScore, riskLevel }
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
  EKSTREM:   'Ekstrem',
  TINGGI:    'Tinggi',
  SEDERHANA: 'Sederhana',
  RENDAH:    'Rendah',
}

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  OPS: 'Operasi',
  KEW: 'Kewangan',
  REP: 'Reputasi',
  PER: 'Perundangan',
  STR: 'Strategik',
  PRJ: 'Projek',
}

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  DRAFT:            'Draft',
  PENDING_HOD:      'Pending HOD',
  PENDING_RC:       'Pending RC',
  ACTIVE:           'Active',
  MONITORING:       'Monitoring',
  REJECTED:         'Rejected',
  PENDING_CLOSURE:  'Pending Closure',
  CLOSED:           'Closed',
}

export const RISK_STATUS_BADGE: Record<RiskStatus, { bg: string; fg: string }> = {
  DRAFT:           { bg: '#F3F4F6', fg: '#374151' },
  PENDING_HOD:     { bg: '#DBEAFE', fg: '#1E40AF' },
  PENDING_RC:      { bg: '#E0E7FF', fg: '#3730A3' },
  ACTIVE:          { bg: '#DCFCE7', fg: '#166534' },
  MONITORING:      { bg: '#FEF3C7', fg: '#854D0E' },
  REJECTED:        { bg: '#FEE2E2', fg: '#991B1B' },
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
  ROC: 'Risk Oversight Committee',
}
