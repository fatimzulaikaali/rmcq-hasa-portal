'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { GAP_LABEL, errMsg, type MgmtPriority, type TnaTemplateRow } from '@/lib/tna/types'
import { downloadXlsx, handoverSheets, mgmtBlocks, sheetMgmt, sheetCalendar, sheetRequests, sheetTemplate, sheetTemplateDetail, staffReports, templateGH } from '@/lib/tna/report'
import { L, Modal, todayISO, type TabProps } from './shared'

/* Laporan — printable reports (open in a new tab → browser print / PDF) and Excel exports,
 * plus editing of the hospital 8-column template rows (columns B–F). */
export function TnaReports({ data, supabase, reload, flash }: TabProps) {
  const reps = useMemo(() => staffReports(data), [data])
  const [staffSel, setStaffSel] = useState('all')
  const [unitSel, setUnitSel] = useState(data.units[0]?.code ?? '')
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState<TnaTemplateRow | null>(null)
  const [err, setErr] = useState('')

  const open = (qs: string) => window.open(`/tna/laporan?${qs}`, '_blank', 'noopener')
  const tag = `${data.cycle.year}_${todayISO()}`
  async function xl(kind: string, fn: () => Promise<void>) {
    setBusy(kind)
    try { await fn(); flash('Fail Excel dimuat turun.') } catch (e) { flash(`Gagal jana Excel: ${errMsg(e)}`, 'err') }
    setBusy('')
  }

  async function saveTpl() {
    if (!edit) return
    if (!edit.item_ms.trim()) { setErr('Unit / Item wajib diisi.'); return }
    const { id, ...rest } = edit
    const t = (v: string | null) => (v && v.trim() ? v.trim() : null)
    const rec = { unit_code: rest.unit_code || null, item_ms: rest.item_ms.trim(), indicator_ms: t(rest.indicator_ms), kpi_ms: t(rest.kpi_ms), weight_ms: t(rest.weight_ms), activities_ms: t(rest.activities_ms), initial_training_ms: t(rest.initial_training_ms), goal_ms: t(rest.goal_ms), objective_ms: t(rest.objective_ms), mgmt_kpi_ms: t(rest.mgmt_kpi_ms), updated_at: new Date().toISOString() }
    const { error } = id ? await supabase.from('tna_dept_template').update(rec).eq('id', id)
      : await supabase.from('tna_dept_template').insert({ ...rec, cycle_id: data.cycle.id, sort_order: data.template.length + 1 })
    if (error) { setErr(errMsg(error)); return }
    flash('Templat dikemas kini.'); setEdit(null); await reload()
  }

  const Card = ({ code, title, desc, children }: { code: string; title: string; desc: string; children: ReactNode }) => (
    <div className="card tna-repcard">
      <div className="tna-repcode">{code}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 className="vd-h">{title}</h3><p className="vd-sub" style={{ marginBottom: 10 }}>{desc}</p>
        <div className="tna-actions">{children}</div>
      </div>
    </div>
  )

  return (
    <>
      <div className="banner"><span>ℹ️</span><div>
        Laporan dibuka dalam tab baharu — tekan <b>Cetak / Simpan PDF</b> dan pilih A4. Excel mengandungi data yang sama untuk disimpan atau diserahkan.
        Jurang dan keutamaan dikira daripada penilaian yang telah <b>disahkan</b> sahaja.
      </div></div>

      <Card code="A" title="Laporan Individu" desc="Profil, penilaian kompetensi (diperlukan / kendiri / dipersetujui / jurang), IDP, kursus dimohon dan ruang tandatangan. Satu staf satu laporan.">
        <select className="tna-lvsel" value={staffSel} onChange={(e) => setStaffSel(e.target.value)}>
          <option value="all">Semua staf ({reps.length}) — satu staf satu halaman</option>
          {reps.map((r) => <option key={r.a.id} value={r.a.id}>{r.s.name}</option>)}
        </select>
        <button type="button" className="mm-btn primary sm" onClick={() => open(`r=individu&a=${staffSel}`)}>🖨 Buka untuk cetak</button>
      </Card>

      <Card code="B" title="Laporan Jabatan" desc="Ringkasan liputan, status staf, peta jurang, keutamaan latihan, permohonan kursus, templat 8 lajur, template TNA pengurusan hospital (18 lajur) dan lampiran butiran jurang.">
        <button type="button" className="mm-btn primary sm" onClick={() => open('r=jabatan')}>🖨 Buka untuk cetak</button>
        <button type="button" className="mm-btn sm" disabled={!!busy} onClick={() => void xl('tpl', () => downloadXlsx(`TNA_Jabatan_RMCQ_${tag}.xlsx`, [sheetTemplate(data, reps), sheetTemplateDetail(data, reps)]))}>⬇ Templat 8 lajur (Excel)</button>
      </Card>

      <Card code="C" title="Laporan Unit" desc="Sama seperti laporan jabatan tetapi untuk satu unit sahaja, termasuk baris templat unit tersebut.">
        <select className="tna-lvsel" value={unitSel} onChange={(e) => setUnitSel(e.target.value)}>
          {data.units.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name_ms}</option>)}
        </select>
        <button type="button" className="mm-btn primary sm" onClick={() => open(`r=unit&u=${encodeURIComponent(unitSel)}`)}>🖨 Buka untuk cetak</button>
      </Card>

      <Card code="D" title="Senarai Permohonan Kursus" desc={`Semua kursus yang dimohon staf — satu kursus satu baris (${data.requests.length} permohonan).`}>
        <button type="button" className="mm-btn primary sm" onClick={() => open('r=kursus')}>🖨 Buka untuk cetak</button>
        <button type="button" className="mm-btn sm" disabled={!!busy} onClick={() => void xl('req', () => downloadXlsx(`TNA_Permohonan_Kursus_${tag}.xlsx`, [sheetRequests(data, reps)]))}>⬇ Excel</button>
      </Card>

      <Card code="E" title="Kalendar Latihan & Latihan Hospital" desc="Latihan jabatan (ikut suku tahun keutamaan), program hospital (bulan dirancang) dan permohonan staf dalam satu kalendar 12 bulan.">
        <button type="button" className="mm-btn primary sm" onClick={() => open('r=kalendar')}>🖨 Kalendar</button>
        <button type="button" className="mm-btn sm" onClick={() => open('r=hospital')}>🖨 TNA Hospital</button>
        <button type="button" className="mm-btn sm" disabled={!!busy} onClick={() => void xl('cal', () => downloadXlsx(`TNA_Kalendar_${tag}.xlsx`, [sheetCalendar(data, reps)]))}>⬇ Excel</button>
      </Card>

      <Card code="G" title="Template TNA Pengurusan Hospital (18 lajur)" desc="Format baharu pengurusan: Goals · Objectives · KPIs · Category · Competency · R · C · Gap · Priority · Activities · In-house / External training + kos + tarikh. Excel boleh terus disalin ke fail pengurusan (helaian TP Pro, baris RMCQ).">
        <button type="button" className="mm-btn primary sm" onClick={() => open('r=pengurusan')}>🖨 Buka untuk cetak</button>
        <button type="button" className="mm-btn sm" disabled={!!busy} onClick={() => void xl('mgmt', () => downloadXlsx(`TNA_Pengurusan_RMCQ_${tag}.xlsx`, [sheetMgmt(data, reps)]))}>⬇ Excel (18 lajur)</button>
      </Card>
      <MgmtInputs data={data} reps={reps} supabase={supabase} flash={flash} reload={reload} />

      <Card code="F" title="Pakej Serahan" desc="Semua data kitaran dalam satu fail Excel (staf, jawatan, profil, kamus, petunjuk tahap, penilaian, jurang, permohonan, latihan hospital, templat, kalendar) — boleh dibaca tanpa portal. Laporan lengkap mencetak A + B + D + E sekali gus.">
        <button type="button" className="mm-btn primary sm" disabled={!!busy} onClick={() => void xl('all', () => downloadXlsx(`TNA_Pakej_Serahan_RMCQ_${tag}.xlsx`, handoverSheets(data)))}>{busy === 'all' ? 'Menjana…' : '⬇ Pakej Serahan (Excel)'}</button>
        <button type="button" className="mm-btn sm" onClick={() => open('r=semua')}>🖨 Laporan lengkap</button>
      </Card>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="vd-h">Templat 8 lajur — kandungan unit</h3>
        <p className="vd-sub">Lajur B–F (Unit, Penunjuk Prestasi, KPI, Pemberat, Aktiviti) disunting di sini. Lajur G (Kompetensi Diperlukan) dan H (Cadangan Latihan) dijana automatik daripada jurang. Klik baris untuk sunting.</p>
        <div className="vd-scroll"><table className="vd-table">
          <thead><tr><th>Bil.</th><th>Unit / Item</th><th>Penunjuk Prestasi</th><th>Kompetensi Diperlukan (auto)</th><th>Cadangan Latihan (auto)</th></tr></thead>
          <tbody>{data.template.map((t, i) => {
            const { G, H } = templateGH(data, t.unit_code, reps, t.initial_training_ms)
            return (
              <tr key={t.id} className="mm-rowlink" onClick={() => { setErr(''); setEdit({ ...t }) }}>
                <td>{i + 1}</td><td><b style={{ whiteSpace: 'pre-line' }}>{t.item_ms}</b></td><td>{t.indicator_ms}</td>
                <td className="tna-muted" style={{ whiteSpace: 'pre-line', fontSize: 11.5 }}>{G}</td>
                <td className="tna-muted" style={{ whiteSpace: 'pre-line', fontSize: 11.5 }}>{H}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </div>

      {edit && (
        <Modal title="Sunting baris templat" onClose={() => setEdit(null)} wide>
          {err && <div className="mm-err">{err}</div>}
          <div className="mm-grid">
            <L label="Unit / Item"><textarea value={edit.item_ms} onChange={(e) => setEdit({ ...edit, item_ms: e.target.value })} /></L>
            <L label="Unit (untuk jana lajur G & H)">
              <select value={edit.unit_code ?? ''} onChange={(e) => setEdit({ ...edit, unit_code: e.target.value || null })}>
                <option value="">—</option>
                {data.units.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name_ms}</option>)}
              </select>
            </L>
          </div>
          {([['goal_ms', 'Goal jabatan (template pengurusan)'], ['objective_ms', 'Objective (template pengurusan)'], ['mgmt_kpi_ms', 'KPIs (template pengurusan)'], ['indicator_ms', 'Penunjuk Prestasi'], ['kpi_ms', 'KPI & Sasaran Kerja'], ['weight_ms', 'Cadangan Pemberat / Kaedah Ukuran KPI'], ['activities_ms', 'Aktiviti / Program Sokongan'], ['initial_training_ms', 'Cadangan latihan awal (dipaparkan sebelum penilaian disahkan)']] as const).map(([k, lab]) => (
            <div key={k} style={{ marginTop: 12 }}>
              <L label={lab}><textarea style={{ minHeight: 90 }} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></L>
            </div>
          ))}
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setEdit(null)}>Batal</button>
            <button type="button" className="mm-btn primary" onClick={() => void saveTpl()}>Simpan</button>
          </div>
        </Modal>
      )}
    </>
  )
}

/* Department-level current level (C) override and management priority, per competency with a gap. */
function MgmtInputs({ data, reps, supabase, flash, reload }: Pick<TabProps, 'data' | 'supabase' | 'flash' | 'reload'> & { reps: ReturnType<typeof staffReports> }) {
  const blocks = useMemo(() => mgmtBlocks(data, reps), [data, reps])
  const [open, setOpen] = useState(false)
  const rows = blocks.flatMap((b) => b.rows.map((r) => ({ b, r })))
  async function save(code: string, patch: { dept_current_level?: number | null; mgmt_priority?: MgmtPriority | null }) {
    const { error } = await supabase.from('tna_priority_inputs').upsert({ cycle_id: data.cycle.id, competency_code: code, ...patch }, { onConflict: 'cycle_id,competency_code' })
    if (error) { flash(`Gagal simpan: ${errMsg(error)}`, 'err'); return }
    flash(`${code} dikemas kini.`); await reload()
  }
  return (
    <div className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 className="vd-h" style={{ margin: 0 }}>Tetapan template pengurusan — Tahap semasa (C) &amp; Training Priority</h3>
        <button type="button" className="mm-btn sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(!open)}>{open ? 'Tutup' : `Buka (${rows.length} kompetensi berjurang)`}</button>
      </div>
      {open && (
        <>
          <p className="vd-sub" style={{ marginTop: 8 }}>C dikira automatik (median tahap dipersetujui staf yang disahkan). Pilih nilai lain jika Dr. menilai majoriti staf berbeza. Priority ikut impak kepada operasi: <b>High</b> = keselamatan pesakit, kesinambungan perkhidmatan, pematuhan; <b>Moderate</b> = produktiviti & kualiti kerja; <b>Low</b> = tiada impak ketara.</p>
          {!rows.length ? <p className="tna-muted">Belum ada jurang yang disahkan.</p> : (
            <div className="vd-scroll"><table className="vd-table">
              <thead><tr><th>Unit</th><th>Kompetensi</th><th>Staf berjurang</th><th>R</th><th>C (auto)</th><th>C digunakan</th><th>Gap</th><th>Priority</th></tr></thead>
              <tbody>{rows.map(({ b, r }) => (
                <tr key={r.c.code}>
                  <td>{b.t.unit_code}</td><td><b>{r.c.code}</b> {r.c.name_ms}<div className="tna-muted">{r.category}</div></td>
                  <td className="tna-muted" style={{ maxWidth: 220 }}>{r.staffWithGap.map((x) => x.s.name).join(', ')} ({r.staffWithGap.length}/{r.staffRequired})</td>
                  <td>{r.R}</td><td>{r.Cauto}</td>
                  <td><select className={`tna-lvsel ${r.override ? 'diff' : ''}`} value={r.override ? r.C : ''} onChange={(e) => void save(r.c.code, { dept_current_level: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Auto ({r.Cauto})</option>{[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select></td>
                  <td><b>{r.gap}</b> <span className="tna-muted">{GAP_LABEL[Math.min(r.gap, 4)]}</span></td>
                  <td><select className="tna-lvsel" value={r.priority ?? ''} onChange={(e) => void save(r.c.code, { mgmt_priority: (e.target.value || null) as MgmtPriority | null })}>
                    <option value="">—</option><option>High</option><option>Moderate</option><option>Low</option>
                  </select></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  )
}
