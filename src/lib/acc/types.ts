/* Accreditation module (MSQH 7th Edition) — shared types.
 * Mirrors the acc_* tables in Supabase. */

export interface AccService {
  id: string
  name: string
  service_name: string | null
  name_ms: string | null
}

export interface AccTopic {
  id: string
  standard_id: string
  code: string
  title: string | null
  sort_order: number
}

export interface AccSubStandard {
  id: string
  topic_id: string
  code: string
  statement: string | null
  is_new: boolean
  sort_order: number
}

export interface AccCriterion {
  id: string
  topic_id: string
  sub_standard_id: string | null
  code: string
  statement: string
  is_core: boolean
  is_new: boolean
  has_service_variable: boolean
  sort_order: number
}

export interface AccEvidenceItem {
  id: string
  criterion_id: string
  item_number: number
  text: string
  sort_order: number
}

export type AccFolderType = 'evidence' | 'year'

export interface AccFolder {
  id: string
  service_id: string
  evidence_item_id: string
  folder_type: AccFolderType
  /** 0 is the sentinel for the evidence parent folder; real years for year folders. */
  year: number | null
  drive_folder_id: string | null
  drive_folder_name: string | null
  drive_url: string | null
  parent_drive_folder_id: string | null
  created_at: string
  synced_at: string | null
}

/** A reference link to the source of an evidence item — e.g. the department's
 * full minutes-of-meeting folder, when only the latest few are uploaded. */
export interface AccEvidenceLink {
  id: string
  evidence_item_id: string
  label: string
  url: string
  created_at: string
}

/** A file returned by the Drive web app's `list` action. */
export interface AccDriveFile {
  id: string
  name: string
  mimeType: string
  url: string
}
