'use client'

import { useMemo, useState } from 'react'
import {
  CQE_STATUS, MONTHS, RECORD_BADGE, RECORD_STATUS, TRAINING_TYPE, errMsg, isCqe, rm,
  type CqeStatus, type RecordStatus, type TnaCqe, type TnaTrainingRecord, type TrainingType,
} from '@/lib/tna/types'
import { splitTraining, downloadXlsx, staffReports } from '@/lib/tna/report'
import { missingRecords, planStats, sheetCqe, sheetPlan, staleRecordIds } from '@/lib/tna/plan'
import { L, Modal, todayISO, type TabProps } from './shared'

/* Pelan Latihan — what happens after the TNA:
 *  A. CQE Jabatan (mandatory for all RMCQ staff) with a 12-month calendar.
 *  B. Pelan Latihan Individu: one row per staff × course, status + attendance date
 *     (staff log in to the portal and update their own rows here). */
type Manual = { assignment_id: string; title: string; provider: string; type: TrainingType; month: string; cost: string }

export function TnaPlan({ data, supabase, reload, flash }: TabProps) {
  const reps = useMemo(() => staffReports(data), [data])
  const repByAsg = useMemo(() => new Map(reps.map((r) => [r.a.id, r])), [reps])
  const compName = useMemo(() => new Map(data.comps.map((c) => [c.code, c.name_ms])), [data.comps])
  const missing = useMemo(() => missingRecords(data), [data])
  const stale = useMemo(() => staleRecordIds(data), [data])
  const stats = planStats(data)
  const [busy, setBusy] = useState(false)
  const [fStaff, setFStaff] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [manual, setManual] = useState<Manual | null>(null)
  const tag = `${data.cycle.year}_${todayISO()}`

  /* ---- CQE ---- */
  const kamusCqe = useMemo(() => {
    const have = new Set(data.cqe.map((c) => c.title_ms.trim().toLowerCase()))
    return data.comps.filter((c) => c.active).flatMap((c) => splitTraining(c.default_training_ms).filter(isCqe)
      .map((t) => ({ title: t, code: c.code, unit: c.template_unit ?? c.unit_code ?? 'KJ' })))
      .filter((x) => !have.has(x.title.toLowerCase()))
  }, [data.cqe, data.comps])

  async function updCqe(c: TnaCqe, patch: Partial<TnaCqe>) {
    const { error } = await supabase.from('tna_cqe_sessions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { flash(errMsg(error), 'err'); return }
    await reload()
  }
  async function addCqeFromKamus() {
    setBusy(true)
    const max = Math.max(0, ...data.cqe.map((c) => c.sort_order))
    const { error } = await supabase.from('tna_cqe_sessions').insert(kamusCqe.map((x, i) => ({
      cycle_id: data.cycle.id, competency_code: x.code, title_ms: x.title, organiser_unit: x.unit, sort_order: max + i + 1,
    })))
    setBusy(false)
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`${kamusCqe.length} CQE ditambah daripada Kamus.`); await reload()
  }
  async function addCqeBlank() {
    const title = window.prompt('Nama CQE baharu:')
    if (!title?.trim()) return
    const { error } = await supabase.from('tna_cqe_sessions').insert({ cycle_id: data.cycle.id, title_ms: title.trim(), organiser_unit: 'KJ', sort_order: data.cqe.length + 1 })
    if (error) { flash(errMsg(error), 'err'); return }
    await reload()
  }
  async function delCqe(c: TnaCqe) {
    if (!window.confirm(`Buang "${c.title_ms}" daripada kalendar CQE?`)) return
    const { error } = await supabase.from('tna_cqe_sessions').delete().eq('id', c.id)
    if (error) { flash(errMsg(error), 'err'); return }
    await reload()
  }

  /* ---- individual plan ---- */
  async function generate() {
    if (!missing.length) return
    setBusy(true)
    const { error } = await supabase.from('tna_training_records').insert(missing.map((m) => ({ ...m, status: 'planned', source: 'portal' })))
    setBusy(false)
    if (error) { flash(`Gagal jana pelan: ${errMsg(error)}`, 'err'); return }
    flash(`${missing.length} baris latihan ditambah ke pelan.`); await reload()
  }
  async function updRec(t: TnaTrainingRecord, patch: Partial<TnaTrainingRecord>) {
    const next = { ...patch }
    if (patch.status === 'attended' && !t.course_date && !patch.course_date) next.course_date = todayISO()
    if (patch.status && patch.status !== 'attended' && patch.status !== 'verified') next.course_date = null
    const { error } = await supabase.from('tna_training_records').update({ ...next, source: 'portal', updated_at: new Date().toISOString() }).eq('id', t.id)
    if (error) { flash(errMsg(error), 'err'); return }
    await reload()
  }
  async function delRec(t: TnaTrainingRecord) {
    if (!window.confirm(`Buang "${t.external_title_ms}" daripada pelan ${repByAsg.get(t.assignment_id)?.s.name ?? ''}? (Pilih "Dibatalkan" jika mahu simpan rekod.)`)) return
    const { error } = await supabase.from('tna_training_records').delete().eq('id', t.id)
    if (error) { flash(errMsg(error), 'err'); return }
    await reload()
  }
  async function saveManual() {
    if (!manual) return
    if (!manual.assignment_id || !manual.title.trim()) { flash('Pilih staf dan isi nama kursus.', 'err'); return }
    const { error } = await supabase.from('tna_training_records').insert({
      assignment_id: Number(manual.assignment_id), external_title_ms: manual.title.trim(), provider_ms: manual.provider.trim() || null,
      training_type: manual.type, planned_month: manual.month ? Number(manual.month) : null,
      est_cost_rm: manual.cost ? Number(manual.cost) : null, plan_source: 'manual', status: 'planned', source: 'portal',
    })
    if (error) { flash(errMsg(error), 'err'); return }
    setManual(null); flash('Kursus ditambah.'); await reload()
  }

  const rows = data.training
    .filter((t) => (!fStaff || String(t.assignment_id) === fStaff) && (!fStatus || t.status === fStatus))
    .sort((a, b) => (repByAsg.get(a.assignment_id)?.s.name ?? '').localeCompare(repByAsg.get(b.assignment_id)?.s.name ?? '') || (a.planned_month ?? 13) - (b.planned_month ?? 13))
  const unitName = (c: string | null) => data.units.find((u) => u.code === c)?.name_ms ?? c ?? '—'

  return (
    <>
      <div className="tiles">
        <div className="tile"><div className="lab">CQE jabatan</div><div className="val">{stats.cqeDone} <small>/ {stats.cqeTotal} selesai</small></div></div>
        <div className="tile"><div className="lab">Kursus individu</div><div className="val">{stats.total}</div><div className="delta flat">{missing.length ? `${missing.length} belum dijana` : 'semua dijana'}</div></div>
        <div className="tile"><div className="lab">Sudah hadir</div><div className="val">{stats.pct}<small>%</small></div><div className="delta flat">{stats.attended} / {stats.total}</div></div>
        <div className="tile"><div className="lab">Anggaran kos</div><div className="val" style={{ fontSize: 22 }}>{rm(stats.cost)}</div></div>
      </div>

      {/* ---------- A. CQE ---------- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tna-toolbar" style={{ marginBottom: 6 }}>
          <h3 className="vd-h" style={{ margin: 0 }}>A. CQE Jabatan — wajib semua staf RMCQ</h3>
          <span className="sp" />
          {kamusCqe.length > 0 && <button type="button" className="mm-btn sm" disabled={busy} onClick={() => void addCqeFromKamus()}>+ {kamusCqe.length} CQE baharu daripada Kamus</button>}
          <button type="button" className="mm-btn sm" onClick={() => void addCqeBlank()}>+ CQE manual</button>
          <button type="button" className="mm-btn sm" onClick={() => void downloadXlsx(`TNA_Kalendar_CQE_${tag}.xlsx`, [sheetCqe(data)])}>⬇ Excel</button>
        </div>
        <p className="vd-sub">Senarai diambil daripada cadangan latihan Kamus yang bermula dengan “CQE”. Pilih bulan untuk kalendar; isi tarikh & bilangan hadir selepas sesi dijalankan.</p>
        <div className="vd-scroll"><table className="vd-table">
          <thead><tr><th>CQE</th><th>Unit penganjur</th><th>Bulan</th><th>Tarikh sebenar</th><th>Status</th><th>Hadir</th><th>Catatan</th><th /></tr></thead>
          <tbody>{data.cqe.map((c) => (
            <tr key={c.id}>
              <td style={{ minWidth: 220 }}><b>{c.title_ms}</b></td>
              <td><select className="tna-lvsel" value={c.organiser_unit ?? ''} onChange={(e) => void updCqe(c, { organiser_unit: e.target.value || null })}>
                <option value="">—</option>{data.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}
              </select></td>
              <td><select className="tna-lvsel" value={c.planned_month ?? ''} onChange={(e) => void updCqe(c, { planned_month: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select></td>
              <td><input type="date" className="tna-lvsel" value={c.actual_date ?? ''} onChange={(e) => void updCqe(c, { actual_date: e.target.value || null, ...(e.target.value ? { status: 'selesai' as CqeStatus } : {}) })} /></td>
              <td><select className="tna-lvsel" value={c.status} onChange={(e) => void updCqe(c, { status: e.target.value as CqeStatus })}>
                {(Object.keys(CQE_STATUS) as CqeStatus[]).map((k) => <option key={k} value={k}>{CQE_STATUS[k]}</option>)}
              </select></td>
              <td><input className="tna-inline" style={{ width: 60 }} inputMode="numeric" defaultValue={c.attendees ?? ''}
                onBlur={(e) => { const v = e.target.value.replace(/\D/g, ''); if (v !== String(c.attendees ?? '')) void updCqe(c, { attendees: v ? Number(v) : null }) }} /></td>
              <td><input className="tna-inline" defaultValue={c.notes_ms ?? ''} onBlur={(e) => { if (e.target.value !== (c.notes_ms ?? '')) void updCqe(c, { notes_ms: e.target.value || null }) }} /></td>
              <td><button type="button" className="tna-linkbtn" onClick={() => void delCqe(c)}>Buang</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <h4 className="tna-sub">Kalendar CQE {data.cycle.year}</h4>
        <div className="vd-scroll"><table className="vd-table tna-cal">
          <thead><tr><th>CQE</th>{MONTHS.map((m) => <th key={m} className="c">{m}</th>)}</tr></thead>
          <tbody>{data.cqe.map((c) => (
            <tr key={c.id}><td>{c.title_ms}<div className="tna-muted">{unitName(c.organiser_unit)}</div></td>
              {MONTHS.map((_, i) => <td key={i} className={`c ${c.planned_month === i + 1 ? (c.status === 'selesai' ? 'tna-cal-done' : c.status === 'ditangguh' ? 'tna-cal-off' : 'tna-cal-on') : ''}`}>{c.planned_month === i + 1 ? (c.status === 'selesai' ? '✓' : '●') : ''}</td>)}
            </tr>
          ))}</tbody>
        </table></div>
        <p className="tna-muted">● dirancang · ✓ selesai · kelabu = ditangguh</p>
      </div>

      {/* ---------- B. Individual ---------- */}
      <div className="card">
        <div className="tna-toolbar" style={{ marginBottom: 6 }}>
          <h3 className="vd-h" style={{ margin: 0 }}>B. Pelan Latihan Individu (selain CQE)</h3>
          <span className="sp" />
          <button type="button" className="mm-btn primary sm" disabled={busy || !missing.length} onClick={() => void generate()}>
            {missing.length ? `⟳ Jana ${missing.length} baris baharu daripada TNA` : '✓ Pelan terkini dengan TNA'}
          </button>
          <button type="button" className="mm-btn sm" onClick={() => setManual({ assignment_id: '', title: '', provider: '', type: 'dalaman', month: '', cost: '' })}>+ Tambah manual</button>
          <button type="button" className="mm-btn sm" onClick={() => void downloadXlsx(`TNA_Pelan_Latihan_Individu_${tag}.xlsx`, [sheetPlan(data)])}>⬇ Excel</button>
        </div>
        <p className="vd-sub">Dijana daripada TNA yang disahkan: kursus yang dipohon staf dan masuk TNA, serta cadangan Kamus (bukan CQE) bagi jurang tanpa permohonan. Menjana semula hanya menambah baris baharu — status dan tarikh sedia ada tidak diubah. Staf log masuk portal → TNA & Kompetensi → Pelan Latihan → pilih nama sendiri, kemudian kemas kini status & tarikh hadir.</p>
        <div className="tna-toolbar">
          <select value={fStaff} onChange={(e) => setFStaff(e.target.value)}>
            <option value="">Semua staf</option>{reps.map((r) => <option key={r.a.id} value={r.a.id}>{r.s.name}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">Semua status</option>{(['planned', 'attended', 'cancelled'] as RecordStatus[]).map((k) => <option key={k} value={k}>{RECORD_STATUS[k]}</option>)}
          </select>
          <span className="tna-muted">{rows.length} baris</span>
        </div>
        {!data.training.length ? <p className="tna-muted">Belum ada pelan. Tekan “Jana … daripada TNA”.</p> : (
          <div className="vd-scroll"><table className="vd-table">
            <thead><tr><th>Staf</th><th>Kursus</th><th>Jenis</th><th>Bulan</th><th>Kos</th><th>Status</th><th>Tarikh hadir</th><th>Catatan</th><th /></tr></thead>
            <tbody>{rows.map((t) => {
              const r = repByAsg.get(t.assignment_id)
              return (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{r?.s.name ?? '—'}</b><div className="tna-muted">{r?.p.unit_code}</div></td>
                  <td style={{ minWidth: 220 }}>{t.external_title_ms}{t.provider_ms && <span className="tna-muted"> · {t.provider_ms}</span>}
                    <div className="tna-muted">{t.competency_code ? compName.get(t.competency_code) : 'Pembangunan umum'} · {t.plan_source === 'permohonan' ? 'permohonan staf' : t.plan_source === 'kamus' ? 'cadangan Kamus' : 'manual'}</div>
                    {stale.has(t.id) && <div className="tna-warn">⚠ Permohonan ini tidak lagi dalam TNA (cth. ditangguh) — pertimbang “Dibatalkan”.</div>}</td>
                  <td><select className="tna-lvsel" value={t.training_type ?? 'dalaman'} onChange={(e) => void updRec(t, { training_type: e.target.value as TrainingType })}>
                    {(Object.keys(TRAINING_TYPE) as TrainingType[]).map((k) => <option key={k} value={k}>{k === 'dalaman' ? 'Dalaman' : 'Luaran'}</option>)}
                  </select></td>
                  <td><select className="tna-lvsel" value={t.planned_month ?? ''} onChange={(e) => void updRec(t, { planned_month: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{rm(t.est_cost_rm)}</td>
                  <td><select className={`tna-lvsel ${RECORD_BADGE[t.status] === 'b-green' ? 'ok' : ''}`} value={t.status} onChange={(e) => void updRec(t, { status: e.target.value as RecordStatus })}>
                    {(['planned', 'attended', 'cancelled'] as RecordStatus[]).map((k) => <option key={k} value={k}>{RECORD_STATUS[k]}</option>)}
                  </select></td>
                  <td><input type="date" className="tna-lvsel" value={t.course_date ?? ''} onChange={(e) => void updRec(t, { course_date: e.target.value || null, ...(e.target.value ? { status: 'attended' as RecordStatus } : {}) })} /></td>
                  <td><input className="tna-inline" defaultValue={t.notes_ms ?? ''} onBlur={(e) => { if (e.target.value !== (t.notes_ms ?? '')) void updRec(t, { notes_ms: e.target.value || null }) }} /></td>
                  <td><button type="button" className="tna-linkbtn" onClick={() => void delRec(t)}>Buang</button></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </div>

      {manual && (
        <Modal title="Tambah kursus ke pelan individu" onClose={() => setManual(null)}>
          <div className="mm-grid">
            <L label="Staf"><select value={manual.assignment_id} onChange={(e) => setManual({ ...manual, assignment_id: e.target.value })}>
              <option value="">— pilih —</option>{reps.map((r) => <option key={r.a.id} value={r.a.id}>{r.s.name}</option>)}
            </select></L>
            <L label="Jenis"><select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value as TrainingType })}>
              <option value="dalaman">Dalaman</option><option value="luaran">Luaran</option>
            </select></L>
          </div>
          <div style={{ marginTop: 12 }}><L label="Nama kursus"><input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></L></div>
          <div className="mm-grid three" style={{ marginTop: 12 }}>
            <L label="Penganjur"><input value={manual.provider} onChange={(e) => setManual({ ...manual, provider: e.target.value })} /></L>
            <L label="Bulan"><select value={manual.month} onChange={(e) => setManual({ ...manual, month: e.target.value })}>
              <option value="">—</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></L>
            <L label="Kos (RM)"><input inputMode="decimal" value={manual.cost} onChange={(e) => setManual({ ...manual, cost: e.target.value.replace(/[^0-9.]/g, '') })} /></L>
          </div>
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setManual(null)}>Batal</button>
            <button type="button" className="mm-btn primary" onClick={() => void saveManual()}>Simpan</button>
          </div>
        </Modal>
      )}
    </>
  )
}
