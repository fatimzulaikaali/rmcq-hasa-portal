/* POST /api/acc/list-files
 *
 * Lists the files inside a Drive folder (via the Apps Script web app) so the
 * portal can preview them inline during an audit — no redirect to Drive.
 *
 * Body: { folderId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const url = process.env.ACC_DRIVE_WEBAPP_URL
  const secret = process.env.ACC_DRIVE_SECRET
  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: 'drive_not_configured',
        message: 'Google Drive is not connected yet.' },
      { status: 200 },
    )
  }

  let body: { folderId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }
  if (!body.folderId) {
    return NextResponse.json({ ok: false, error: 'no_folder' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 })
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, action: 'list', folderId: body.folderId }),
      signal: AbortSignal.timeout(60_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'drive_call_failed', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
