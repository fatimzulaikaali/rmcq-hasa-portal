export interface KpiDepartment {
  id: string
  dept_code: string
  kpi_pdf_dept: string | null
  official_dept_unit: string | null
  mapping_status: string | null
  remarks: string | null
}

export type Frequency = 'Monthly' | 'Quarterly' | 'Biannual' | 'Yearly'
export type TargetOperator = '>=' | '<=' | '=' | '>' | '<' | '!='
export type Period = 'JAN' | 'FEB' | 'MAR' | 'APR' | 'MAY' | 'JUN' | 'JUL' | 'AUG' | 'SEP' | 'OCT' | 'NOV' | 'DEC'
export type AchievementStatus = 'Achieved' | 'Not Achieved' | 'No Data' | 'Not Applicable'
export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Extreme'
export type SiqStatus = 'Open' | 'In Progress' | 'Pending Department Feedback' | 'Closed'

export interface KpiDefinition {
  id: string
  kpi_id: string                  // e.g. 'JPSM-ADM-01'
  website_kpi_id: string | null
  dept_code: string
  department: string | null
  kpi_name: string
  target: string | null           // raw '≥70%'
  frequency: Frequency
  siq_trigger_consecutive: number
  target_operator: TargetOperator | null
  target_value: number | null
  scheduled_periods: string | null
  active: boolean
}

export interface KpiDataRow {
  id: string
  kpi_id: string
  year: number
  period: Period
  period_order: number | null
  result: string | null
  achievement_status: AchievementStatus | null
  consecutive_not_achieved: number
  siq_flag: string | null
  submitted_at: string | null
}

export interface KpiSiqRecord {
  id: string
  siq_id: string | null
  kpi_id: string | null
  website_kpi_id: string | null
  dept_code: string | null
  department: string | null
  kpi_name: string | null
  frequency: string | null
  trigger_year: number | null
  trigger_period: string | null
  trigger_basis: string | null
  date_issued: string | null
  due_date: string | null
  owner: string | null
  risk_level: RiskLevel | null
  status: SiqStatus | null
  action_plan: string | null
  progress_update: string | null
  closure_date: string | null
  evidence_link: string | null
  remarks: string | null
}

export const PERIODS: Period[] = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
export const FREQUENCIES: Frequency[] = ['Monthly', 'Quarterly', 'Biannual', 'Yearly']
