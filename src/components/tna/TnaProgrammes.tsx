'use client'

import { useState } from 'react'
import { MONTHS, PROG_SECTION, PRIORITY_BADGE, RMCQ_ROLE, errMsg, progPriority, progScore, type TnaProgramme } from '@/lib/tna/types'
import { L, Modal, type TabProps } from './shared'

/* Latihan Hospital — hospital-level programmes from incident & audit findings.
 * The organiser is often another department; RMCQ's role is recorded.
 * Every field is editable; programmes are archived, never deleted. */
type Form = Omit<TnaProgramme, 'id' | 'cycle_id' | 'scope'> & { id?: number }
const BLANK: Form = {
  source_section: 'A', issue_ms: '', title_ms: '', target_group_ms: '', owner_ms: '', rmcq_role: 'co_organiser', method_ms: '',
  frequency_ms: '', non_training_action_ms: '', kpi_ms: '', score_size: 2, score_severity: 2, score_reach: 2,
  priority_override: null, planned_months: [], est_cost_rm: null, status: 'active',
}

export function TnaProgrammes({ data, supabase, userId, reload, flash }: TabProps) {
  const [form, setForm] = useState<Form | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const list = data.programmes.filter((p) => p.scope === 'hospital' && (showArchived || p.status === 'active'))
  const sections = Object.keys(PROG_SECTION)

  async function save() {
    if (!form) return
    if (!form.title_ms.trim()) { setErr('Nama program wajib diisi.'); return }
    const t = (v: string | null) => (v && v.trim() ? v.trim() : null)
    const rec = {
      source_section: form.source_section, issue_ms: t(form.issue_ms), title_ms: form.title_ms.trim(), target_group_ms: t(form.target_group_ms),
      owner_ms: t(form.owner_ms), rmcq_role: form.rmcq_role || null, method_ms: t(form.method_ms), frequency_ms: t(form.frequency_ms),
      non_training_action_ms: t(form.non_training_action_ms), kpi_ms: t(form.kpi_ms),
      score_size: form.score_size, score_severity: form.score_severity, score_reach: form.score_reach,
      priority_override: form.priority_override || null, planned_months: [...form.planned_months].sort((a, b) => a - b),
      est_cost_rm: form.est_cost_rm, status: form.status, updated_at: new Date().toISOString(), updated_by: userId || null,
    }
    setBusy(true); setErr('')
    const { error } = form.id
      ? await supabase.from('tna_programmes').update(rec).eq('id', form.id)
      : await supabase.from('tna_programmes').insert({ ...rec, cycle_id: data.cycle.id, scope: 'hospital', created_by: userId || null })
    setBusy(false)
    if (error) { setErr(errMsg(error)); return }
    flash(form.id ? 'Program dikemas kini.' : 'Program ditambah.'); setForm(null); await reload()
  }

  const toggleMonth = (m: number) => form && setForm({
    ...form, planned_months: form.planned_months.includes(m) ? form.planned_months.filter((x) => x !== m) : [...form.planned_months, m],
  })

  return (
    <>
      <div className="banner"><span>ℹ️</span><div>
        Latihan peringkat hospital berdasarkan dapatan insiden dan audit. Penganjur tidak semestinya RMCQ — peranan RMCQ direkodkan.
        Skor = Saiz/Kekerapan × Keterukan × Capaian (maks 27): Tinggi ≥ 18 · Sederhana 9–17 · Rendah &lt; 9. Klik baris untuk sunting; tandakan bulan untuk kalendar.
      </div></div>
      <div className="tna-toolbar">
        <button type="button" className="mm-btn primary" onClick={() => { setErr(''); setForm({ ...BLANK }) }}>+ Program baharu</button>
        <label className="mm-chk sp"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Papar arkib</label>
      </div>
      {sections.map((sec) => {
        const rows = list.filter((p) => (p.source_section ?? 'D') === sec)
        if (!rows.length) return null
        return (
          <div className="card" key={sec} style={{ padding: '10px 16px', marginBottom: 14 }}>
            <h3 className="vd-h">{PROG_SECTION[sec]}</h3>
            <div className="vd-scroll"><table className="vd-table">
              <thead><tr><th>Program</th><th>Sasaran</th><th>Pemilik / penganjur</th><th>Peranan RMCQ</th><th>Skor</th><th>Keutamaan</th><th>Bulan</th></tr></thead>
              <tbody>{rows.map((p) => {
                const pr = progPriority(p)
                return (
                  <tr key={p.id} className="mm-rowlink" style={p.status === 'archived' ? { opacity: 0.5 } : undefined}
                    onClick={() => { setErr(''); setForm({ ...p }) }}>
                    <td><b>{p.title_ms}</b>{p.issue_ms && <div className="tna-muted">{p.issue_ms}</div>}</td>
                    <td>{p.target_group_ms ?? '—'}</td><td>{p.owner_ms ?? '—'}</td>
                    <td>{p.rmcq_role ? RMCQ_ROLE[p.rmcq_role] ?? p.rmcq_role : '—'}</td>
                    <td>{progScore(p) ?? '—'}</td>
                    <td>{pr === '—' ? '—' : <span className={`badge ${PRIORITY_BADGE[pr]}`}>{pr}</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.planned_months.length ? p.planned_months.map((m) => MONTHS[m - 1]).join(', ') : <span className="tna-muted">Belum</span>}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          </div>
        )
      })}

      {form && (
        <Modal title={form.id ? 'Sunting program hospital' : 'Program hospital baharu'} onClose={() => setForm(null)} wide>
          {err && <div className="mm-err">{err}</div>}
          <div className="mm-grid">
            <L label="Bahagian">
              <select value={form.source_section ?? 'D'} onChange={(e) => setForm({ ...form, source_section: e.target.value })}>
                {sections.map((s) => <option key={s} value={s}>{PROG_SECTION[s]}</option>)}
              </select>
            </L>
            <L label="Peranan RMCQ">
              <select value={form.rmcq_role ?? ''} onChange={(e) => setForm({ ...form, rmcq_role: e.target.value || null })}>
                <option value="">—</option>
                {Object.entries(RMCQ_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </L>
          </div>
          <div style={{ marginTop: 12 }}><L label="Nama program / latihan"><input value={form.title_ms} onChange={(e) => setForm({ ...form, title_ms: e.target.value })} /></L></div>
          <div style={{ marginTop: 12 }}><L label="Isu / dapatan (punca keperluan)"><textarea value={form.issue_ms ?? ''} onChange={(e) => setForm({ ...form, issue_ms: e.target.value })} /></L></div>
          <div className="mm-grid" style={{ marginTop: 12 }}>
            <L label="Kumpulan sasaran"><input value={form.target_group_ms ?? ''} onChange={(e) => setForm({ ...form, target_group_ms: e.target.value })} /></L>
            <L label="Pemilik / penganjur"><input value={form.owner_ms ?? ''} onChange={(e) => setForm({ ...form, owner_ms: e.target.value })} /></L>
            <L label="Kaedah"><input value={form.method_ms ?? ''} onChange={(e) => setForm({ ...form, method_ms: e.target.value })} /></L>
            <L label="Kekerapan"><input value={form.frequency_ms ?? ''} onChange={(e) => setForm({ ...form, frequency_ms: e.target.value })} /></L>
          </div>
          <div style={{ marginTop: 12 }}><L label="Tindakan bukan latihan"><textarea value={form.non_training_action_ms ?? ''} onChange={(e) => setForm({ ...form, non_training_action_ms: e.target.value })} /></L></div>
          <div style={{ marginTop: 12 }}><L label="Ukuran keberkesanan / KPI"><textarea value={form.kpi_ms ?? ''} onChange={(e) => setForm({ ...form, kpi_ms: e.target.value })} /></L></div>
          <div className="mm-grid three" style={{ marginTop: 12 }}>
            {([['score_size', 'Saiz / kekerapan (1–3)'], ['score_severity', 'Keterukan (1–3)'], ['score_reach', 'Capaian (1–3)']] as const).map(([k, lab]) => (
              <L key={k} label={lab}>
                <select value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                </select>
              </L>
            ))}
          </div>
          <div className="mm-grid three" style={{ marginTop: 12 }}>
            <L label="Keutamaan" hint={`Dikira: ${progPriority({ ...form, priority_override: null } as TnaProgramme)}`}>
              <select value={form.priority_override ?? ''} onChange={(e) => setForm({ ...form, priority_override: e.target.value || null })}>
                <option value="">Ikut skor</option><option>Tinggi</option><option>Sederhana</option><option>Rendah</option>
              </select>
            </L>
            <L label="Anggaran kos (RM)"><input inputMode="decimal" value={form.est_cost_rm ?? ''} onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, ''); setForm({ ...form, est_cost_rm: v ? Number(v) : null })
            }} /></L>
            <L label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Aktif</option><option value="archived">Diarkib</option>
              </select>
            </L>
          </div>
          <div className="mm-sublbl">Bulan dirancang (kalendar latihan)</div>
          <div className="mm-shorts">
            {MONTHS.map((m, i) => (
              <label key={m} className={`mm-shortchip ${form.planned_months.includes(i + 1) ? 'on' : ''}`}>
                <input type="checkbox" checked={form.planned_months.includes(i + 1)} onChange={() => toggleMonth(i + 1)} />{m}
              </label>
            ))}
          </div>
          <div className="mm-formnav">
            <button type="button" className="mm-btn" onClick={() => setForm(null)}>Batal</button>
            <button type="button" className="mm-btn primary" disabled={busy} onClick={() => void save()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
