'use client'

import { useState } from 'react'
import { errMsg, type CycleStatus } from '@/lib/tna/types'
import { L, fmtDate, type TabProps } from './shared'

/* Kitaran — status draft → open → closed and the open/close dates.
 * Staff links only work while the cycle is "open". */
export function TnaCycleTab({ data, supabase, reload, flash }: TabProps) {
  const c = data.cycle
  const [f, setF] = useState({ name_ms: c.name_ms, status: c.status as CycleStatus, open_date: c.open_date ?? '', close_date: c.close_date ?? '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = f.name_ms !== c.name_ms || f.status !== c.status || f.open_date !== (c.open_date ?? '') || f.close_date !== (c.close_date ?? '')

  async function save() {
    if (!f.name_ms.trim()) { setErr('Nama kitaran wajib diisi.'); return }
    if (f.open_date && f.close_date && f.close_date < f.open_date) { setErr('Tarikh tutup mesti selepas tarikh buka.'); return }
    if (f.status === 'open' && !f.close_date) { setErr('Tetapkan tarikh tutup sebelum membuka kitaran (dipaparkan dalam mesej kepada staf).'); return }
    if (f.status !== c.status && !window.confirm(
      f.status === 'open' ? 'Buka kitaran? Semua link staf yang telah dijana akan mula berfungsi.'
        : f.status === 'closed' ? 'Tutup kitaran? Link staf tidak lagi berfungsi; data dikekalkan.'
          : 'Kembalikan kitaran ke draf? Link staf tidak berfungsi semasa draf.')) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('tna_cycles').update({
      name_ms: f.name_ms.trim(), status: f.status, open_date: f.open_date || null, close_date: f.close_date || null,
    }).eq('id', c.id)
    setBusy(false)
    if (error) { setErr(errMsg(error)); return }
    flash('Kitaran dikemas kini.'); await reload()
  }

  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <h3 className="vd-h">Kitaran {c.year}</h3>
      <p className="vd-sub">Status semasa: <b>{c.status === 'open' ? 'Dibuka' : c.status === 'closed' ? 'Ditutup' : 'Draf'}</b> · buka {fmtDate(c.open_date)} · tutup {fmtDate(c.close_date)}.
        Link staf hanya berfungsi semasa kitaran <b>dibuka</b>. Penilaian dikekalkan selepas kitaran ditutup.</p>
      {err && <div className="mm-err">{err}</div>}
      <div className="mm-grid">
        <L label="Nama kitaran"><input value={f.name_ms} onChange={(e) => setF({ ...f, name_ms: e.target.value })} /></L>
        <L label="Status">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CycleStatus })}>
            <option value="draft">Draf — persediaan</option>
            <option value="open">Dibuka — staf boleh mengisi</option>
            <option value="closed">Ditutup</option>
          </select>
        </L>
        <L label="Tarikh buka"><input type="date" value={f.open_date} onChange={(e) => setF({ ...f, open_date: e.target.value })} /></L>
        <L label="Tarikh tutup"><input type="date" value={f.close_date} onChange={(e) => setF({ ...f, close_date: e.target.value })} /></L>
      </div>
      <div className="mm-formnav">
        <button type="button" className="mm-btn primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
      <p className="tna-muted" style={{ marginTop: 10 }}>Kitaran tahun berikutnya (salin profil jawatan &amp; staf, link baharu) akan ditambah dalam fasa seterusnya.</p>
    </div>
  )
}
