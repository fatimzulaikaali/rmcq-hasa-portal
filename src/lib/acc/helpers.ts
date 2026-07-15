/* Accreditation module — pure helpers (no I/O). */

import type { AccCriterion, AccEvidenceItem } from './types'

/** Sentinel year stored for the evidence PARENT folder row (year folders use the real year). */
export const EVIDENCE_PARENT_YEAR = 0

/** Replace the {{service}} placeholder in a criterion statement with the service name. */
export function fillService(statement: string, serviceName?: string | null): string {
  if (!statement.includes('{{service}}')) return statement
  return statement.replaceAll('{{service}}', serviceName?.trim() || 'the Service')
}

/** Folder name for an evidence item, e.g. "24.1.1.1 (1)". */
export function evidenceKey(criterionCode: string, itemNumber: number): string {
  return `${criterionCode} (${itemNumber})`
}

export function evidenceKeyFor(criterion: AccCriterion, item: AccEvidenceItem): string {
  return evidenceKey(criterion.code, item.item_number)
}

/** Google Drive in-portal preview URL for a single file. */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`
}

/** Google Drive embedded grid view for a folder (files render inside an iframe). */
export function driveFolderEmbedUrl(folderId: string): string {
  return `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`
}

/** Sensible default set of years offered when a criterion has no folders yet. */
export function defaultYears(currentYear = new Date().getFullYear()): number[] {
  return [currentYear - 2, currentYear - 1, currentYear]
}

/** Badge label for a criterion. */
export function criterionBadges(c: Pick<AccCriterion, 'is_core' | 'is_new'>): string[] {
  const out: string[] = []
  if (c.is_core) out.push('CORE')
  if (c.is_new) out.push('NEW')
  return out
}
