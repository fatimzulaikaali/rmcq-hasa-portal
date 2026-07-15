/* POST /api/acc/upload
 *
 * Uploads a single evidence file straight from the portal into a Drive folder
 * (via the Apps Script web app), so users never have to open Drive to add
 * evidence. The file is relayed base64-encoded through the web app.
 *
 * Body: multipart/form-data with fields:
 *   folderId : string  (the Drive folder to upload into)
 *   file     : File
 *
 * Note: Vercel serverless functions cap the request body at ~4.5 MB, so we
 * guard at 4 MB and tell the user to use "Open in Drive" for bigger files.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 4 * 1024 * 1024

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

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }

  const folderId = form.get('folderId')
  const file = form.get('file')
  if (typeof folderId !== 'string' || !folderId) {
    return NextResponse.json({ ok: false, error: 'no_folder' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'no_file' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'too_large',
        message: 'File is larger than 4 MB. Use “Open in Drive” to upload large files.' },
      { status: 200 },
    )
  }

  const dataBase64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        action: 'upload',
        folderId,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataBase64,
      }),
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
