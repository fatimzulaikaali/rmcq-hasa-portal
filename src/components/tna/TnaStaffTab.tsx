'use client'

import { useMemo, useState } from 'react'
import { ROLE_LABEL, STATUS_BADGE, STATUS_LABEL, errMsg, type TnaStaff } from '@/lib/tna/types'
import { L, Modal, fmtDate, indexData, todayISO, type TabProps } from './shared'

type Form = { id?: number; staff_no: string; name: string; email: string; phone: string; position_id: string }
const EMPTY: Form = { staff_no: '', name: '', email: '', phone: '', position_id: '' }

/* Staf — add new staff into a vacant position, edit contact details,
 * archive leavers (never deleted; their position becomes vacant) and restore. */
export function TnaStaffTab({ data, supabase, userId, reload, flash }: TabProps) {
  const ix = useMemo(() => indexData(data), [data])
  const [form, setForm] = useState<Form | null>(null)
  const [arch, setArch] = useState<{ s: TnaStaff; reason: string; date: string } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const vacant = ix.positionsSorted.filter((p) => !ix.asgByPos.has(p.id))
  const asgOfStaff = (id: number) => data.asg.find((a) => a.staff_id === id) ?? null
  const active = data.staff.filter((s) => s.status === 'active')
  const archived = data.staff.filter((s) => s.status === 'archived')

  async function saveForm() {
    if (!form) return
    const f = { ...form, staff_no: form.staff_no.trim(), name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() }
    if (!f.staff_no || !f.name) { setErr('No. Staf dan Nama wajib diisi.'); return }
    if (!/^[0-9]{4,10}$/.test(f.staff_no)) { setErr('No. Staf mesti 4–10 digit nombor sahaja.'); return }
    if (!f.id && !f.position_id) { setErr('Pilih jawatan (kekosongan) untuk staf baharu.'); return }
    setBusy(true); setErr('')
    const rec = { staff_no: f.staff_no, name: f.name, email: f.email || null, phone: f.phone || null }
    if (f.id) {
      const { error } = await supabase.from('tna_staff').update(rec).eq('id', f.id)
      setBusy(false)
      if (error) { setErr(error.code === '23505' ? `No. Staf ${f.staff_no} sudah wujud. [23505]` : errMsg(error)); return }
      flash('Maklumat staf dikemas kini.')
    } else {
      const { data: ins, error } = await supabase.from('tna_staff').insert(rec).select('id').single()
      if (error || !ins) {
        setBusy(false)
        setErr(error?.code === '23505' ? `No. Staf ${f.staff_no} sudah wujud (mungkin dalam senarai arkib — gunakan “Pulihkan”). [23505]` : errMsg(error)); return
      }
      const { error: e2 } = await supabase.from('tna_assignments').insert({
        cycle_id: data.cycle.id, staff_id: ins.id, position_id: Number(f.position_id),
        supervisor_staff_id: ix.kjAsg?.staff_id ?? null, start_date: todayISO(),
      })
      setBusy(false)
      if (e2) { setErr(`Staf disimpan tetapi gagal diletakkan ke jawatan: ${errMsg(e2)}`); await reload(); return }
      flash(`${f.name} ditambah. Jana link di tab Penilaian.`)
    }
    setForm(null); await reload()
  }

  async function doArchive() {
    if (!arch) return
    if (!arch.reason.trim()) { setErr('Nyatakan sebab (cth. berhenti, bertukar).'); return }
    setBusy(true); setErr('')
    const { error } = await supabase.from('tna_staff').update({
      status: 'archived', archived_reason: arch.reason.trim(), archived_on: arch.date || todayISO(), archived_by: userId || null,
    }).eq('id', arch.s.id)
    if (error) { setBusy(false); setErr(errMsg(error)); return }
    const a = data.asg.find((x) => x.staff_id === arch.s.id && x.status !== 'archived')
    if (a) {
      const { error: e2 } = await supabase.from('tna_assignments').update({ status: 'archived', token_revoked: true }).eq('id', a.id)
      if (e2) { setBusy(false); setErr(`Staf diarkib tetapi jawatan gagal dikosongkan: ${errMsg(e2)}`); await reload(); return }
    }
    setBusy(false); setArch(null)
    flash(`${arch.s.name} diarkib. Jawatan kini kosong.`); await reload()
  }

  async function restore(s: TnaStaff) {
    const a = asgOfStaff(s.id)
    const posFree = a && !ix.asgByPos.has(a.position_id)
    const pos = a ? ix.posById.get(a.position_id) : undefined
    const msg = posFree
      ? `Pulihkan ${s.name} ke jawatan asal (${pos?.title_ms})?`
      : `Pulihkan ${s.name}? Jawatan asal sudah diisi — staf akan aktif tanpa jawatan dan perlu diletakkan semula.`
    if (!window.confirm(msg)) return
    const { error } = await supabase.from('tna_staff').update({ status: 'active', archived_reason: null, archived_on: null, archived_by: null }).eq('id', s.id)
    if (error) { flash(errMsg(error), 'err'); return }
    if (a && posFree) {
      const back = a.submitted_at ? 'submitted' : (ix.itemsByAsg.get(a.id)?.size ? 'draft' : 'not_started')
      const { error: e2 } = await supabase.from('tna_assignments').update({ status: a.validated_at ? 'validated' : back }).eq('id', a.id)
      if (e2) { flash(`Staf dipulihkan tetapi jawatan gagal dipulihkan: ${errMsg(e2)}`, 'err'); await reload(); return }
    }
    flash(`${s.name} dipulihkan.`); await reload()
  }

  async function place(s: TnaStaff, positionId: number) {
    const a = asgOfStaff(s.id)
    const { error } = a
      ? await supabase.from('tna_assignments').update({ position_id: positionId, status: 'not_started', token_hash: null, token_revoked: false, submitted_at: null, validated_at: null, validated_by: null }).eq('id', a.id)
      : await supabase.from('tna_assignments').insert({ cycle_id: data.cycle.id, staff_id: s.id, position_id: positionId, supervisor_staff_id: ix.kjAsg?.staff_id ?? null, start_date: todayISO() })
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`${s.name} diletakkan ke jawatan.`); await reload()
  }

  return (
    <>
      <div className="tna-toolbar">
        <button type="button" className="mm-btn primary" disabled={!vacant.length} onClick={() => { setErr(''); setForm({ ...EMPTY, position_id: vacant[0] ? String(vacant[0].id) : '' }) }}>+ Tambah staf baharu</button>
        <span className="tna-muted">{active.length} aktif · {vacant.length} jawatan kosong · {archived.length} diarkib</span>
        <label className="mm-chk sp"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Papar arkib</label>
      </div>

      <div className="card" style={{ padding: '6px 16px 10px', marginBottom: 16 }}><div className="vd-scroll"><table className="vd-table">
        <thead><tr><th>No. Staf</th><th>Nama</th><th>Jawatan</th><th>Telefon</th><th>Emel</th><th>Status TNA</th><th></th></tr></thead>
        <tbody>
          {active.map((s) => {
            const a = data.asg.find((x) => x.staff_id === s.id && x.status !== 'archived')
            const p = a ? ix.posById.get(a.position_id) : undefined
            return (
              <tr key={s.id}>
                <td>{s.staff_no}</td><td><b>{s.name}</b></td>
                <td>{p ? <>{p.title_ms} <span className="tna-muted">· {p.unit_code} · {p.grade_sspa}</span></> : (
                  vacant.length ? (
                    <select className="tna-lvsel" defaultValue="" onChange={(e) => e.target.value && void place(s, Number(e.target.value))}>
                      <option value="">— letak ke jawatan —</option>
                      {vacant.map((v) => <option key={v.id} value={v.id}>{v.unit_code} · {v.title_ms}</option>)}
                    </select>
                  ) : <span className="badge b-amber">Tiada jawatan</span>)}</td>
                <td>{s.phone ?? <span className="tna-muted">—</span>}</td><td>{s.email ?? <span className="tna-muted">—</span>}</td>
                <td>{a ? <span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span> : '—'}</td>
                <td><div className="tna-actions">
                  <button type="button" className="mm-btn sm" onClick={() => { setErr(''); setForm({ id: s.id, staff_no: s.staff_no, name: s.name, email: s.email ?? '', phone: s.phone ?? '', position_id: '' }) }}>Edit</button>
                  <button type="button" className="mm-btn sm" onClick={() => { setErr(''); setArch({ s, reason: '', date: todayISO() }) }}>Arkib</button>
                </div></td>
              </tr>
            )
          })}
          {vacant.map((p) => (
            <tr key={`v-${p.id}`} style={{ background: 'var(--bg)' }}>
              <td>—</td><td><span className="badge b-gray">Kosong</span></td>
              <td>{p.title_ms} <span className="tna-muted">· {p.unit_code} · {p.grade_sspa} · {ROLE_LABEL[p.role_type]}</span></td>
              <td colSpan={3} /><td><button type="button" className="mm-btn sm" onClick={() => { setErr(''); setForm({ ...EMPTY, position_id: String(p.id) }) }}>Isi kekosongan</button></td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {showArchived && (
        <div className="card" style={{ padding: '6px 16px 10px' }}>
          <h3 className="vd-h" style={{ marginTop: 10 }}>Arkib staf</h3>
          {archived.length === 0 ? <p className="vd-sub">Tiada.</p> : (
            <div className="vd-scroll"><table className="vd-table">
              <thead><tr><th>No. Staf</th><th>Nama</th><th>Sebab</th><th>Tarikh</th><th></th></tr></thead>
              <tbody>{archived.map((s) => (
                <tr key={s.id}><td>{s.staff_no}</td><td>{s.name}</td><td>{s.archived_reason ?? '—'}</td><td>{fmtDate(s.archived_on)}</td>
                  <td><button type="button" className="mm-btn sm" onClick={() => void restore(s)}>Pulihkan</button></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {form && (
        <Modal title={form.id ? 'Edit staf' : 'Tambah staf baharu'} onClose={() => setForm(null)}>
          {err && <div className="mm-err">{err}</div>}
          <div className="mm-grid">
            <L label="No. Staf"><input value={form.staff_no} inputMode="numeric" onChange={(e) => setForm({ ...form, staff_no: e.target.value })} /></L>
            <L label="Nama penuh"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></L>
            <L label="No. telefon (WhatsApp)" hint="cth. 0123456789"><input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} /></L>
            <L label="Emel"><input value={form.email} type="email" onChange={(e) => setForm({ ...form, email: e.target.value })} /></L>
            {!form.id && (
              <L label="Jawatan (kekosongan)">
                <select value={form.position_id} onChange={(e) => setForm({ ...form, position_id: e.target.value })}>
                  {vacant.map((p) => <option key={p.id} value={p.id}>{p.unit_code} · {p.title_ms} ({p.grade_sspa})</option>)}
                </select>
              </L>
            )}
          </div>
          {!form.id && <p className="tna-muted" style={{ marginTop: 10 }}>Penyelia ditetapkan kepada Ketua Jabatan. Profil kompetensi mengikut jawatan yang dipilih.</p>}
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setForm(null)}>Batal</button>
            <button type="button" className="mm-btn primary" disabled={busy} onClick={() => void saveForm()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </Modal>
      )}

      {arch && (
        <Modal title={`Arkib ${arch.s.name}`} onClose={() => setArch(null)}>
          {err && <div className="mm-err">{err}</div>}
          <p className="vd-sub">Staf tidak dipadam — rekod dan penilaian disimpan dalam arkib. Link dibatalkan dan jawatan menjadi kosong.</p>
          <div className="mm-grid">
            <L label="Sebab"><input value={arch.reason} placeholder="cth. Berhenti / Bertukar jabatan" onChange={(e) => setArch({ ...arch, reason: e.target.value })} /></L>
            <L label="Tarikh berkuat kuasa"><input type="date" value={arch.date} onChange={(e) => setArch({ ...arch, date: e.target.value })} /></L>
          </div>
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setArch(null)}>Batal</button>
            <button type="button" className="mm-btn primary" disabled={busy} onClick={() => void doArchive()}>Arkibkan</button>
          </div>
        </Modal>
      )}
    </>
  )
}
