'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import type { RiskAttachment, RiskAttachmentKind } from '@/lib/risk/types'

/* Per-risk attachments: the source risk-register PDF a department submits and
 * the Risk Treatment Plan (RTP), if any.
 *
 * Two ways to attach, matching what Fatim asked for:
 *   - Upload a file — sent straight from the browser into the Supabase
 *     `risk-attachments` bucket, so it bypasses the ~4.5MB Vercel serverless
 *     body cap (limit here is 50MB).
 *   - Paste a Google Drive link — for very large files kept in Drive.
 *
 * Uploaded files are private; we mint a short-lived signed URL on click. */

const BUCKET = 'risk-attachments'
const MAX_UPLOAD = 50 * 1024 * 1024 // 50MB — matches the bucket limit

const KIND_LABEL: Record<RiskAttachmentKind, string> = {
  register: 'Risk register',
  rtp: 'RTP',
  other: 'Other',
}
const KIND_BADGE: Record<RiskAttachmentKind, { fg: string; bg: string }> = {
  register: { fg: '#185FA5', bg: '#E6F1FB' },
  rtp: { fg: '#0F6E56', bg: '#E3F5EF' },
  other: { fg: '#6B6A65', bg: '#EFEEE9' },
}

function fmtBytes(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function RiskAttachments({ riskId, canEdit = true }: { riskId: number; canEdit?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [items, setItems] = useState<RiskAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [mode, setMode] = useState<'none' | 'file' | 'link'>('none')
  const [kind, setKind] = useState<RiskAttachmentKind>('register')
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [riskUserId, setRiskUserId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('risk_attachments')
      .select('*')
      .eq('risk_id', riskId)
      .order('created_at', { ascending: true })
    if (error) setErr(error.message)
    else setItems((data ?? []) as RiskAttachment[])
    setLoading(false)
  }, [supabase, riskId])

  useEffect(() => {
    void load()
    void (async () => {
      try {
        const access = await getModuleAccess(supabase)
        setRiskUserId(access.riskUser?.riskUserId ?? null)
      } catch { /* leave null */ }
    })()
  }, [load, supabase])

  function resetForm() {
    setMode('none'); setKind('register'); setLabel(''); setUrl(''); setErr(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onUpload(file: File) {
    setErr(null)
    if (file.size > MAX_UPLOAD) {
      setErr(`File is larger than 50 MB. Keep it in Drive and paste the link instead.`)
      return
    }
    setBusy(true)
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${riskId}/${crypto.randomUUID()}-${safe}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
      if (up.error) throw new Error(up.error.message)
      const ins = await supabase.from('risk_attachments').insert({
        risk_id: riskId,
        kind,
        label: label.trim() || null,
        storage_path: path,
        file_name: file.name,
        byte_size: file.size,
        uploaded_by: riskUserId,
      })
      if (ins.error) {
        // Roll the orphaned object back so we don't leak storage.
        await supabase.storage.from(BUCKET).remove([path])
        throw new Error(ins.error.message)
      }
      resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function onAddLink() {
    setErr(null)
    const u = url.trim()
    if (!/^https?:\/\//i.test(u)) {
      setErr('Enter a full link starting with http:// or https://')
      return
    }
    setBusy(true)
    try {
      const ins = await supabase.from('risk_attachments').insert({
        risk_id: riskId,
        kind,
        label: label.trim() || null,
        external_url: u,
        uploaded_by: riskUserId,
      })
      if (ins.error) throw new Error(ins.error.message)
      resetForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save link')
    } finally {
      setBusy(false)
    }
  }

  async function onOpen(a: RiskAttachment) {
    if (a.external_url) { window.open(a.external_url, '_blank', 'noopener'); return }
    if (a.storage_path) {
      const { data, error } = await supabase.storage.from(BUCKET)
        .createSignedUrl(a.storage_path, 60)
      if (error || !data) { setErr(error?.message ?? 'Could not open file'); return }
      window.open(data.signedUrl, '_blank', 'noopener')
    }
  }

  async function onRemove(a: RiskAttachment) {
    if (!confirm('Remove this attachment?')) return
    setBusy(true)
    try {
      if (a.storage_path) await supabase.storage.from(BUCKET).remove([a.storage_path])
      const del = await supabase.from('risk_attachments').delete().eq('id', a.id)
      if (del.error) throw new Error(del.error.message)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.4 }}>
          📎 ATTACHMENTS
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          Risk register &amp; RTP — upload a file or paste a Drive link
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          No attachments yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {items.map((a) => {
            const b = KIND_BADGE[a.kind]
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  color: b.fg, background: b.bg,
                }}>{KIND_LABEL[a.kind]}</span>
                <button type="button" onClick={() => onOpen(a)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: 'var(--blue)', fontWeight: 600, fontSize: 13, textAlign: 'left',
                  }}
                  title={a.external_url ? 'Open link' : 'Open file'}>
                  {a.label || a.file_name || a.external_url || 'Attachment'} ↗
                </button>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {a.external_url ? 'Drive link' : fmtBytes(a.byte_size)}
                </span>
                {canEdit && (
                  <button type="button" onClick={() => onRemove(a)} disabled={busy}
                    style={{
                      marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--red)', fontSize: 13,
                    }} title="Remove">✕</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}

      {canEdit && mode === 'none' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="signout-btn" style={{ fontSize: 12 }}
            onClick={() => { setMode('file'); setErr(null) }}>⬆ Upload file</button>
          <button type="button" className="signout-btn" style={{ fontSize: 12 }}
            onClick={() => { setMode('link'); setErr(null) }}>🔗 Add Drive link</button>
        </div>
      )}

      {canEdit && mode !== 'none' && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, padding: 12,
          background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Type</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as RiskAttachmentKind)}
              style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              <option value="register">Risk register</option>
              <option value="rtp">RTP (Risk Treatment Plan)</option>
              <option value="other">Other</option>
            </select>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional, e.g. 'Q2 2026 register')"
              style={{ flex: 1, minWidth: 180, fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
          </div>

          {mode === 'file' ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input ref={fileRef} type="file" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f) }}
                style={{ fontSize: 12 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Max 50 MB. PDF, Excel, Word, images.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://drive.google.com/…"
                style={{ flex: 1, minWidth: 220, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }} />
              <button type="button" className="signout-btn" style={{ fontSize: 12 }}
                disabled={busy} onClick={() => void onAddLink()}>
                {busy ? 'Saving…' : 'Save link'}
              </button>
            </div>
          )}

          <div>
            <button type="button" onClick={resetForm} disabled={busy}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
              Cancel
            </button>
            {busy && mode === 'file' && <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>Uploading…</span>}
          </div>
        </div>
      )}
    </div>
  )
}
