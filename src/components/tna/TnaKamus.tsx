'use client'

import { useMemo, useState } from 'react'
import { CLUSTERS, LEVELS, LEVEL_NAME, clusterOrder, errMsg, nextCode, type TnaCompetency } from '@/lib/tna/types'
import { L, Modal, type TabProps } from './shared'

/* Kamus — Lapisan A (Kamus Kompetensi UiTM, staf pentadbiran) + Lapisan B
 * (kompetensi kefungsian RMCQ). Every field and level indicator is editable;
 * new competencies get the next code for their cluster (source "Tambahan").
 * Competencies are deactivated, never deleted (assessments reference them). */
const PREFIX: Record<string, string> = { Nilai: 'NL', Teras: 'TR', Generik: 'GN', Kepimpinan: 'KP' }
const LAYER_OF = (cluster: string): 'A' | 'B' => (PREFIX[cluster] ? 'A' : 'B')

type Form = {
  isNew: boolean; code: string; cluster: string; unit_code: string; name_ms: string; definition_ms: string
  default_training_ms: string; min_sspa_grade: string; max_sspa_grade: string; active: boolean
  levels: Record<number, string>
}

export function TnaKamus({ data, supabase, userId, reload, flash }: TabProps) {
  const [fLayer, setFLayer] = useState<'' | 'A' | 'B'>('')
  const [fCluster, setFCluster] = useState('')
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of data.reqs) m.set(r.competency_code, (m.get(r.competency_code) ?? 0) + 1)
    return m
  }, [data.reqs])

  const list = data.comps.filter((c) => (showInactive || c.active) && (!fLayer || c.layer === fLayer) && (!fCluster || c.cluster === fCluster)
    && (!q || `${c.code} ${c.name_ms} ${c.default_training_ms ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => clusterOrder(a.cluster) - clusterOrder(b.cluster) || a.sort_order - b.sort_order)

  function open(c: TnaCompetency) {
    const lv: Record<number, string> = {}
    for (const l of data.levels) if (l.competency_code === c.code) lv[l.level] = l.indicator_ms
    setErr('')
    setForm({
      isNew: false, code: c.code, cluster: c.cluster, unit_code: c.unit_code ?? '', name_ms: c.name_ms, definition_ms: c.definition_ms ?? '',
      default_training_ms: c.default_training_ms ?? '', min_sspa_grade: c.min_sspa_grade?.toString() ?? '', max_sspa_grade: c.max_sspa_grade?.toString() ?? '',
      active: c.active, levels: lv,
    })
  }
  function openNew() {
    const cluster = fCluster || 'Kefungsian Unit'
    setErr('')
    setForm({
      isNew: true, cluster, code: nextCode(PREFIX[cluster] ?? 'R', data.comps.map((c) => c.code)), unit_code: '', name_ms: '', definition_ms: '',
      default_training_ms: '', min_sspa_grade: '', max_sspa_grade: '', active: true, levels: {},
    })
  }

  async function save() {
    if (!form) return
    const f = form
    if (!f.name_ms.trim()) { setErr('Nama kompetensi wajib diisi.'); return }
    if (!/^[A-Z]{1,4}[0-9]{1,3}$/.test(f.code)) { setErr('Kod mesti huruf besar diikuti nombor, cth. R27.'); return }
    const missing = LEVELS.filter((v) => !f.levels[v]?.trim())
    if (missing.length) { setErr(`Petunjuk perilaku untuk tahap ${missing.join(', ')} wajib diisi — staf memilih tahap berdasarkan petunjuk ini.`); return }
    const toInt = (s: string) => (s.trim() ? parseInt(s, 10) : null)
    const layer = LAYER_OF(f.cluster)
    const rec = {
      cluster: f.cluster, layer, unit_code: f.cluster === 'Kefungsian Unit' ? (f.unit_code || null) : null,
      name_ms: f.name_ms.trim(), definition_ms: f.definition_ms.trim() || null, default_training_ms: f.default_training_ms.trim() || null,
      min_sspa_grade: toInt(f.min_sspa_grade), max_sspa_grade: toInt(f.max_sspa_grade), active: f.active,
    }
    setBusy(true); setErr('')
    if (f.isNew) {
      const maxSort = Math.max(0, ...data.comps.filter((c) => c.cluster === f.cluster).map((c) => c.sort_order))
      const { error } = await supabase.from('tna_competencies').insert({
        ...rec, code: f.code, source: 'Tambahan', staff_category: 'pentadbiran', dept_code: layer === 'B' ? 'RMCQ' : null,
        sort_order: maxSort + 1, created_by: userId || null,
      })
      if (error) { setBusy(false); setErr(error.code === '23505' ? `Kod ${f.code} sudah wujud. [23505]` : errMsg(error)); return }
    } else {
      const { error } = await supabase.from('tna_competencies').update(rec).eq('code', f.code)
      if (error) { setBusy(false); setErr(errMsg(error)); return }
    }
    const { error: e2 } = await supabase.from('tna_competency_levels').upsert(
      LEVELS.map((v) => ({ competency_code: f.code, level: v, indicator_ms: f.levels[v].trim() })), { onConflict: 'competency_code,level' })
    setBusy(false)
    if (e2) { setErr(`Kompetensi disimpan tetapi petunjuk tahap gagal: ${errMsg(e2)}`); await reload(); return }
    flash(f.isNew ? `${f.code} ditambah ke kamus. Tambah ke Profil Jawatan untuk mula dinilai.` : `${f.code} dikemas kini.`)
    setForm(null); await reload()
  }

  const clusterOpts = CLUSTERS.filter((c) => !fLayer || LAYER_OF(c.key) === fLayer)

  return (
    <>
      <div className="banner"><span>ℹ️</span><div>
        <b>Lapisan A</b> — Kamus Kompetensi UiTM 2021, <b>staf pentadbiran sahaja</b> (Bab 3–6: Nilai, Teras, Generik, Kepimpinan).
        <b> Lapisan B</b> — kompetensi kefungsian Jabatan RMCQ. Klik baris untuk sunting nama, definisi, latihan cadangan atau petunjuk tahap.
      </div></div>
      <div className="tna-toolbar">
        <select value={fLayer} onChange={(e) => { setFLayer(e.target.value as '' | 'A' | 'B'); setFCluster('') }}>
          <option value="">Semua lapisan</option><option value="A">A · Kamus UiTM</option><option value="B">B · Kefungsian RMCQ</option>
        </select>
        <select value={fCluster} onChange={(e) => setFCluster(e.target.value)}>
          <option value="">Semua kluster</option>
          {clusterOpts.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input placeholder="Cari kod / nama / latihan" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="mm-chk"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Papar tidak aktif</label>
        <button type="button" className="mm-btn primary sp" onClick={openNew}>+ Kompetensi baharu</button>
      </div>

      <div className="card" style={{ padding: '6px 16px 10px' }}><div className="vd-scroll"><table className="vd-table">
        <thead><tr><th>Kod</th><th>Kompetensi</th><th>Kluster</th><th>Latihan cadangan</th><th>Sumber</th><th>Jawatan</th></tr></thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.code} className="mm-rowlink" onClick={() => open(c)} style={c.active ? undefined : { opacity: 0.55 }}>
              <td><b>{c.code}</b></td>
              <td>{c.name_ms}{c.unit_code && <span className="tna-muted"> · {c.unit_code}</span>}{!c.active && <span className="badge b-gray" style={{ marginLeft: 6 }}>Tidak aktif</span>}</td>
              <td>{CLUSTERS.find((x) => x.key === c.cluster)?.label ?? c.cluster}</td>
              <td className="tna-muted" style={{ maxWidth: 320 }}>{c.default_training_ms ?? '—'}</td>
              <td>{c.source === 'Tambahan' ? <span className="badge b-purple">Tambahan</span> : <span className="tna-muted">{c.source}</span>}</td>
              <td>{usage.get(c.code) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      {form && (
        <Modal title={form.isNew ? 'Kompetensi baharu' : `Sunting ${form.code}`} onClose={() => setForm(null)} wide>
          {err && <div className="mm-err">{err}</div>}
          <div className="mm-grid three">
            <L label="Kluster">
              <select value={form.cluster} disabled={!form.isNew} onChange={(e) => {
                const cl = e.target.value
                setForm({ ...form, cluster: cl, code: nextCode(PREFIX[cl] ?? 'R', data.comps.map((c) => c.code)) })
              }}>
                {CLUSTERS.map((c) => <option key={c.key} value={c.key}>{LAYER_OF(c.key)} · {c.label}</option>)}
              </select>
            </L>
            <L label="Kod" hint={form.isNew ? 'Dijana automatik; boleh diubah' : 'Kod tidak boleh diubah'}>
              <input value={form.code} disabled={!form.isNew} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </L>
            {form.cluster === 'Kefungsian Unit' ? (
              <L label="Unit">
                <select value={form.unit_code} onChange={(e) => setForm({ ...form, unit_code: e.target.value })}>
                  <option value="">—</option>
                  {data.units.map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name_ms}</option>)}
                </select>
              </L>
            ) : <L label="Status"><label className="mm-chk"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif</label></L>}
          </div>
          <div style={{ marginTop: 12 }}>
            <L label="Nama kompetensi"><input value={form.name_ms} onChange={(e) => setForm({ ...form, name_ms: e.target.value })} /></L>
          </div>
          <div style={{ marginTop: 12 }}>
            <L label="Definisi"><textarea value={form.definition_ms} onChange={(e) => setForm({ ...form, definition_ms: e.target.value })} /></L>
          </div>
          <div style={{ marginTop: 12 }}>
            <L label="Latihan cadangan (dipaparkan dalam IDP staf)"><textarea value={form.default_training_ms} onChange={(e) => setForm({ ...form, default_training_ms: e.target.value })} /></L>
          </div>
          <div className="mm-grid three" style={{ marginTop: 12 }}>
            <L label="Gred SSPA min" hint="kosong = semua"><input inputMode="numeric" value={form.min_sspa_grade} onChange={(e) => setForm({ ...form, min_sspa_grade: e.target.value.replace(/\D/g, '') })} /></L>
            <L label="Gred SSPA maks" hint="kosong = semua"><input inputMode="numeric" value={form.max_sspa_grade} onChange={(e) => setForm({ ...form, max_sspa_grade: e.target.value.replace(/\D/g, '') })} /></L>
            {form.cluster === 'Kefungsian Unit' && <L label="Status"><label className="mm-chk"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktif</label></L>}
          </div>
          <div className="mm-sec">Petunjuk perilaku mengikut tahap</div>
          {LEVELS.map((v) => (
            <div key={v} style={{ marginBottom: 10 }}>
              <L label={`${v} · ${LEVEL_NAME[v]}`}><textarea value={form.levels[v] ?? ''} onChange={(e) => setForm({ ...form, levels: { ...form.levels, [v]: e.target.value } })} /></L>
            </div>
          ))}
          {!form.isNew && (usage.get(form.code) ?? 0) > 0 && <p className="tna-muted">Digunakan dalam {usage.get(form.code)} profil jawatan. Perubahan teks terus dipaparkan pada link staf.</p>}
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setForm(null)}>Batal</button>
            <button type="button" className="mm-btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
