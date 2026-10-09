'use client'

import { useMemo, useState } from 'react'
import {
  ROLE_LABEL, STATUS_BADGE, STATUS_LABEL, errMsg, linkMessage, newToken, sha256Hex, staffLink, waNumber,
  type TnaAssignment, type TnaStaff,
} from '@/lib/tna/types'
import { Modal, fmtDate, indexData, type TabProps } from './shared'

type Issued = { asg: TnaAssignment; staff: TnaStaff; link: string }

/* Penilaian — one row per position: who holds it, status, progress, and the
 * personal link. Only sha256(token) is stored, so a link can be copied only at
 * the moment it is generated; "Jana semula" issues a new one and kills the old. */
export function TnaAssess({ data, supabase, reload, flash, onValidate, onGoStaff }: TabProps & {
  onValidate: (asgId: number) => void; onGoStaff: () => void
}) {
  const ix = useMemo(() => indexData(data), [data])
  const [fUnit, setFUnit] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [issued, setIssued] = useState<Issued[] | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = ix.positionsSorted.filter((p) => !fUnit || p.unit_code === fUnit).map((p) => {
    const a = ix.asgByPos.get(p.id) ?? null
    const s = a ? ix.staffById.get(a.staff_id) ?? null : null
    const req = ix.reqsByPos.get(p.id)?.length ?? 0
    const done = a ? Array.from(ix.itemsByAsg.get(a.id)?.values() ?? []).filter((i) => i.self_level != null).length : 0
    return { p, a, s, req, done }
  }).filter((r) => !fStatus || (fStatus === 'vacant' ? !r.a : r.a?.status === fStatus))

  async function issue(targets: { a: TnaAssignment; s: TnaStaff }[]) {
    if (!targets.length) return
    setBusy(true)
    const out: Issued[] = []
    for (const { a, s } of targets) {
      const token = newToken()
      const hash = await sha256Hex(token)
      const { error } = await supabase.from('tna_assignments')
        .update({ token_hash: hash, token_issued_at: new Date().toISOString(), token_revoked: false }).eq('id', a.id)
      if (error) { flash(`Gagal jana link untuk ${s.name}: ${errMsg(error)}`, 'err'); continue }
      out.push({ asg: a, staff: s, link: staffLink(token) })
    }
    setBusy(false)
    if (out.length) setIssued(out)
    await reload()
  }

  async function revoke(a: TnaAssignment, s: TnaStaff) {
    if (!window.confirm(`Batalkan link ${s.name}? Link sedia ada tidak akan berfungsi lagi.`)) return
    const { error } = await supabase.from('tna_assignments').update({ token_revoked: true }).eq('id', a.id)
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`Link ${s.name} dibatalkan.`); await reload()
  }

  const noLink = ix.liveAsg.filter((a) => !a.token_hash || a.token_revoked)
    .map((a) => ({ a, s: ix.staffById.get(a.staff_id)! })).filter((x) => x.s && x.s.status === 'active')

  return (
    <>
      {data.cycle.status !== 'open' && (
        <div className="banner"><span>ℹ️</span><div>
          Kitaran <b>{data.cycle.name_ms}</b> berstatus <b>{data.cycle.status === 'draft' ? 'draf' : 'ditutup'}</b>. Link boleh dijana sekarang,
          tetapi staf hanya boleh mengisi selepas kitaran <b>dibuka</b> (tab Kitaran).
        </div></div>
      )}
      <div className="tna-toolbar">
        <select value={fUnit} onChange={(e) => setFUnit(e.target.value)}>
          <option value="">Semua unit</option>
          {data.units.map((u) => <option key={u.code} value={u.code}>{u.name_ms}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Semua status</option>
          {(['not_started', 'draft', 'submitted', 'validated'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="vacant">Jawatan kosong</option>
        </select>
        <button type="button" className="mm-btn primary sp" disabled={busy || !noLink.length} onClick={() => void issue(noLink)}>
          🔗 Jana link untuk semua yang belum ada ({noLink.length})
        </button>
      </div>

      <div className="card" style={{ padding: '6px 16px 10px' }}><div className="vd-scroll"><table className="vd-table">
        <thead><tr><th>Unit</th><th>Jawatan</th><th>Gred</th><th>Staf</th><th>Status</th><th>Dijawab</th><th>Link</th><th>Tindakan</th></tr></thead>
        <tbody>
          {rows.map(({ p, a, s, req, done }) => (
            <tr key={p.id}>
              <td>{p.unit_code}</td>
              <td>{p.title_ms}<div className="tna-muted">{ROLE_LABEL[p.role_type]}</div></td>
              <td>{p.grade_sspa}</td>
              <td>{s ? <><b>{s.name}</b><div className="tna-muted">{s.staff_no}</div></> : <span className="badge b-gray">Kosong</span>}</td>
              <td>{a ? <span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span> : '—'}</td>
              <td>{a ? `${done} / ${req}` : '—'}</td>
              <td>{!a ? '—' : a.token_hash && !a.token_revoked
                ? <span className="tna-muted">Dijana {fmtDate(a.token_issued_at)}</span>
                : <span className="tna-muted">{a.token_revoked ? 'Dibatalkan' : 'Belum dijana'}</span>}</td>
              <td>
                {!a || !s ? (
                  <button type="button" className="mm-btn sm" onClick={onGoStaff}>Isi kekosongan</button>
                ) : (
                  <div className="tna-actions">
                    <button type="button" className="mm-btn sm" disabled={busy} onClick={() => {
                      if (a.token_hash && !a.token_revoked && !window.confirm(`Jana link baharu untuk ${s.name}? Link lama akan terbatal.`)) return
                      void issue([{ a, s }])
                    }}>{a.token_hash && !a.token_revoked ? 'Jana semula' : 'Jana link'}</button>
                    {a.token_hash && !a.token_revoked && <button type="button" className="mm-btn sm" onClick={() => void revoke(a, s)}>Batal</button>}
                    {(a.status === 'submitted' || a.status === 'validated') &&
                      <button type="button" className="mm-btn sm primary" onClick={() => onValidate(a.id)}>{a.status === 'submitted' ? 'Sahkan' : 'Lihat'}</button>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {issued && (
        <Modal title={`Link penilaian (${issued.length})`} onClose={() => setIssued(null)} wide={issued.length > 1}>
          <div className="banner" style={{ marginBottom: 12 }}><span>⚠️</span><div>
            Salin atau hantar link sekarang. Atas sebab keselamatan, link <b>tidak boleh dipaparkan semula</b> selepas tetingkap ini ditutup — jika hilang, jana semula.
          </div></div>
          {issued.length > 1 && (
            <button type="button" className="mm-btn" style={{ marginBottom: 10 }} onClick={() => {
              void navigator.clipboard.writeText(issued.map((x) => `${x.staff.name} (${x.staff.staff_no}): ${x.link}`).join('\n'))
              flash('Semua link disalin.')
            }}>📋 Salin semua (senarai)</button>
          )}
          {issued.map((x) => <IssuedRow key={x.asg.id} x={x} closeDate={data.cycle.close_date} flash={flash} />)}
        </Modal>
      )}
    </>
  )
}

function IssuedRow({ x, closeDate, flash }: { x: Issued; closeDate: string | null; flash: TabProps['flash'] }) {
  const msg = linkMessage(x.staff.name, x.link, closeDate)
  const wa = waNumber(x.staff.phone)
  const copy = (t: string, what: string) => { void navigator.clipboard.writeText(t).then(() => flash(`${what} disalin.`), () => flash('Gagal salin — salin secara manual.', 'err')) }
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
      <b>{x.staff.name}</b> <span className="tna-muted">· {x.staff.staff_no}</span>
      <div className="tna-linkbox">{x.link}</div>
      <div className="tna-actions">
        <button type="button" className="mm-btn sm" onClick={() => copy(x.link, 'Link')}>📋 Salin link</button>
        <button type="button" className="mm-btn sm" onClick={() => copy(msg, 'Mesej')}>📋 Salin mesej</button>
        {wa
          ? <a className="mm-btn sm primary" href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          : <span className="tna-muted">Tiada no. telefon — tambah di tab Staf untuk WhatsApp</span>}
        {x.staff.email && <a className="mm-btn sm" href={`mailto:${x.staff.email}?subject=${encodeURIComponent('Penilaian Kompetensi TNA — Jabatan RMCQ')}&body=${encodeURIComponent(msg)}`}>Emel</a>}
      </div>
    </div>
  )
}
