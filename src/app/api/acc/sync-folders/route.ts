/* POST /api/acc/sync-folders
 *
 * Creates (or reuses) the Google Drive folders for one or more evidence items,
 * by calling the department Gmail account's Apps Script web app. Idempotent:
 * we always send the FULL desired set of years (requested ∪ already-synced),
 * and the web app only creates a folder if one with that name is missing.
 * Returned Drive folder IDs are stored in acc_folders so re-runs never dup.
 *
 * Body: { items: { evidenceItemId: string; years: number[] }[] }
 *
 * Env required (set by the admin after deploying the Apps Script):
 *   ACC_DRIVE_WEBAPP_URL, ACC_DRIVE_SECRET, ACC_DRIVE_ROOT_FOLDER_ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { evidenceKey, EVIDENCE_PARENT_YEAR } from '@/lib/acc/helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SyncItem {
  evidenceItemId: string
  years: number[]
}

interface WebAppYear {
  year: number
  folderId: string
  url: string
}
interface WebAppFolder {
  evidenceKey: string
  folderId: string
  url: string
  years: WebAppYear[]
}

export async function POST(req: NextRequest) {
  const url = process.env.ACC_DRIVE_WEBAPP_URL
  const secret = process.env.ACC_DRIVE_SECRET
  const rootFolderId = process.env.ACC_DRIVE_ROOT_FOLDER_ID
  if (!url || !secret || !rootFolderId) {
    return NextResponse.json(
      { ok: false, error: 'drive_not_configured',
        message: 'Google Drive is not connected yet. Ask the admin to finish the accreditation Drive setup.' },
      { status: 200 },
    )
  }

  let body: { items?: SyncItem[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }
  const items = (body.items ?? []).filter((i) => i?.evidenceItemId)
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_items' }, { status: 400 })
  }

  const supabase = createClient()

  // Auth gate — must be signed in.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 })
  }

  // Single service for now.
  const { data: service } = await supabase
    .from('acc_services')
    .select('id, name, service_name')
    .limit(1)
    .maybeSingle()
  if (!service) {
    return NextResponse.json({ ok: false, error: 'no_service' }, { status: 400 })
  }

  const ids = items.map((i) => i.evidenceItemId)

  // Evidence items → their criterion codes (for folder naming).
  const { data: evRows } = await supabase
    .from('acc_evidence_items')
    .select('id, item_number, acc_criteria(code)')
    .in('id', ids)
  const evMap = new Map<string, { itemNumber: number; code: string }>()
  for (const r of (evRows ?? []) as any[]) {
    const code = Array.isArray(r.acc_criteria) ? r.acc_criteria[0]?.code : r.acc_criteria?.code
    if (code) evMap.set(r.id, { itemNumber: r.item_number, code })
  }

  // Already-synced year folders for these items — so we never drop existing years.
  const { data: existing } = await supabase
    .from('acc_folders')
    .select('evidence_item_id, year, folder_type')
    .eq('service_id', service.id)
    .in('evidence_item_id', ids)
    .eq('folder_type', 'year')
  const existingYears = new Map<string, Set<number>>()
  for (const f of existing ?? []) {
    if (f.year == null) continue
    if (!existingYears.has(f.evidence_item_id)) existingYears.set(f.evidence_item_id, new Set())
    existingYears.get(f.evidence_item_id)!.add(f.year)
  }

  // Build the desired tree for the web app.
  const payloadItems = items
    .map((i) => {
      const meta = evMap.get(i.evidenceItemId)
      if (!meta) return null
      const years = new Set<number>(i.years ?? [])
      for (const y of Array.from(existingYears.get(i.evidenceItemId) ?? [])) years.add(y)
      return {
        _evidenceItemId: i.evidenceItemId,
        evidenceKey: evidenceKey(meta.code, meta.itemNumber),
        years: Array.from(years).sort((a, b) => a - b),
      }
    })
    .filter(Boolean) as { _evidenceItemId: string; evidenceKey: string; years: number[] }[]

  if (payloadItems.length === 0) {
    return NextResponse.json({ ok: false, error: 'items_not_found' }, { status: 400 })
  }

  // Call the Apps Script web app.
  let waResp: { ok: boolean; folders?: WebAppFolder[]; serviceFolderId?: string; error?: string }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        action: 'sync',
        rootFolderId,
        service: service.name,
        items: payloadItems.map((p) => ({ evidenceKey: p.evidenceKey, years: p.years })),
      }),
      // Apps Script can be slow on cold start.
      signal: AbortSignal.timeout(60_000),
    })
    waResp = await res.json()
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'drive_call_failed', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
  if (!waResp.ok) {
    return NextResponse.json({ ok: false, error: 'drive_error', message: waResp.error }, { status: 502 })
  }

  // Map returned folders back to evidence item ids by evidenceKey.
  const keyToItem = new Map(payloadItems.map((p) => [p.evidenceKey, p._evidenceItemId]))
  const now = new Date().toISOString()
  const rows: any[] = []
  for (const f of waResp.folders ?? []) {
    const evId = keyToItem.get(f.evidenceKey)
    if (!evId) continue
    rows.push({
      service_id: service.id,
      evidence_item_id: evId,
      folder_type: 'evidence',
      year: EVIDENCE_PARENT_YEAR,
      drive_folder_id: f.folderId,
      drive_folder_name: f.evidenceKey,
      drive_url: f.url,
      parent_drive_folder_id: waResp.serviceFolderId ?? rootFolderId,
      synced_at: now,
    })
    for (const y of f.years ?? []) {
      rows.push({
        service_id: service.id,
        evidence_item_id: evId,
        folder_type: 'year',
        year: y.year,
        drive_folder_id: y.folderId,
        drive_folder_name: String(y.year),
        drive_url: y.url,
        parent_drive_folder_id: f.folderId,
        synced_at: now,
      })
    }
  }

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from('acc_folders')
      .upsert(rows, { onConflict: 'service_id,evidence_item_id,folder_type,year' })
    if (upErr) {
      return NextResponse.json(
        { ok: false, error: 'db_write_failed', message: upErr.message },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true, folders: waResp.folders ?? [] })
}
