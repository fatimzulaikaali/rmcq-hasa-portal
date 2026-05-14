/* PSCS types — mirror the Supabase schema */

export type Section = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type Wording = '+' | '-'
export type ScaleType = 'Agreement' | 'Frequency' | 'EventCount' | 'Rating'
export type DeptKind = 'directorate' | 'department' | 'subunit'

export interface PscsComposite {
  code: string
  name_en: string
  name_ms: string
  is_custom: boolean
  is_rating: boolean
  sort_order: number
}

export interface PscsQuestion {
  id: string                 // e.g. 'A1', 'D3'
  section: Section
  item_num: number
  composite_code: string
  wording: Wording
  text_en: string
  text_ms: string
  scale_type: ScaleType
  sort_order: number
  active: boolean
}

export interface PscsPosition {
  id: number
  group_en: string
  group_ms: string
  name_en: string
  name_ms: string
  sort_order: number
  active: boolean
}

export interface PscsDepartment {
  code: string
  name_en: string
  name_ms: string
  parent_code: string | null
  is_high_risk: boolean
  allow_across: boolean
  analysis_group_en: string
  analysis_group_ms: string
  kind: DeptKind
  sort_order: number
  active: boolean
}

export interface PscsCampaign {
  id: number
  code: string
  name_en: string
  name_ms: string
  open_date: string
  close_date: string
  active: boolean
}

export interface PscsResponse {
  id: string
  campaign_id: number
  position_id: number | null
  position_other: string | null
  department_code: string | null
  sub_department_code: string | null
  tenure_hospital: '<1y' | '1-5y' | '6-10y' | '11+y' | null
  tenure_unit: '<1y' | '1-5y' | '6-10y' | '11+y' | null
  hours_per_week: '<30' | '30-40' | '>40' | null
  direct_patient_contact: boolean | null
  comment: string | null
  response_hash: string
  language: 'en' | 'ms'
  submitted_at: string
}

export interface PscsAnswer {
  response_id: string
  question_id: string
  value: number   // 0..5
}
