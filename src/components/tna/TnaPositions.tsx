'use client'

import { useMemo, useState } from 'react'
import { CLUSTERS, LEVELS, LEVEL_NAME, ROLE_LABEL, clusterOrder, errMsg, levelName } from '@/lib/tna/types'
import { indexData, type TabProps } from './shared'

/* Profil Jawatan — required level per competency for each position.
 * Changes apply immediately (audited by trigger). */
export function TnaPositions({ data, supabase, reload, flash }: TabProps) {
  const ix = useMemo(() => indexData(data), [data])
  const [posId, setPosId] = useState<number>(ix.positionsSorted[0]?.id ?? 0)
  const [addCode, setAddCode] = useState('')
  const [busy, setBusy] = useState(false)
  const p = ix.posById.get(posId)
  const holder = ix.asgByPos.get(posId)
  const started = holder && holder.status !== 'not_started'

  const reqs = (ix.reqsByPos.get(posId) ?? []).map((r) => ({ r, c: ix.compByCode.get(r.competency_code) }))
    .filter((x): x is { r: typeof x.r; c: NonNullable<typeof x.c> } => !!x.c)
    .sort((a, b) => clusterOrder(a.c.cluster) - clusterOrder(b.c.cluster) || a.c.sort_order - b.c.sort_order)
  const have = new Set(reqs.map((x) => x.r.competency_code))
  const addable = data.comps.filter((c) => c.active && !have.has(c.code))
    .sort((a, b) => clusterOrder(a.cluster) - clusterOrder(b.cluster) || a.sort_order - b.sort_order)

  async function setLevel(code: string, lvl: number) {
    setBusy(true)
    const { error } = await supabase.from('tna_position_requirements').update({ required_level: lvl }).eq('position_id', posId).eq('competency_code', code)
    setBusy(false)
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`${code}: tahap diperlukan → ${LEVEL_NAME[lvl]}`); await reload()
  }
  async function remove(code: string) {
    if (!window.confirm(`Keluarkan ${code} daripada profil ${p?.title_ms}?${started ? ' Penilaian staf untuk kompetensi ini tidak akan dipaparkan lagi.' : ''}`)) return
    setBusy(true)
    const { error } = await supabase.from('tna_position_requirements').delete().eq('position_id', posId).eq('competency_code', code)
    setBusy(false)
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`${code} dikeluarkan.`); await reload()
  }
  async function add() {
    if (!addCode || !p) return
    setBusy(true)
    const { error } = await supabase.from('tna_position_requirements').insert({ position_id: posId, competency_code: addCode, required_level: Math.min(5, Math.max(1, p.grade_level)) })
    setBusy(false)
    if (error) { flash(errMsg(error), 'err'); return }
    flash(`${addCode} ditambah pada tahap ${levelName(p.grade_level)} — laraskan jika perlu.`); setAddCode(''); await reload()
  }

  let last = ''
  return (
    <>
      <div className="tna-toolbar">
        <select value={posId} onChange={(e) => setPosId(Number(e.target.value))}>
          {ix.positionsSorted.map((x) => {
            const a = ix.asgByPos.get(x.id)
            return <option key={x.id} value={x.id}>{x.unit_code} · {x.title_ms} ({x.grade_sspa}) — {a ? ix.staffById.get(a.staff_id)?.name : 'Kosong'}</option>
          })}
        </select>
      </div>
      {p && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <h3 className="vd-h">{p.title_ms} · {p.grade_sspa}{p.grade_ssm_equiv ? ` (≈ ${p.grade_ssm_equiv})` : ''}</h3>
          <p className="vd-sub">{ROLE_LABEL[p.role_type]} · Unit {p.unit_code} · tahap gred Kamus UiTM: <b>{levelName(p.grade_level)}</b> · {reqs.length} kompetensi.</p>
          {started && <div className="banner" style={{ marginBottom: 10 }}><span>⚠️</span><div>Staf jawatan ini sudah mula menilai. Perubahan tahap diperlukan akan mengubah jurang serta-merta.</div></div>}
          <div className="vd-scroll"><table className="vd-table">
            <thead><tr><th>Kod</th><th>Kompetensi</th><th>Sumber</th><th>Tahap diperlukan</th><th></th></tr></thead>
            <tbody>
              {reqs.map(({ r, c }) => {
                const head = c.cluster !== last ? (last = c.cluster, true) : false
                return [
                  head && <tr key={`h-${c.cluster}`}><td colSpan={5} style={{ background: 'var(--bg)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--blue)' }}>{CLUSTERS.find((x) => x.key === c.cluster)?.label ?? c.cluster}</td></tr>,
                  <tr key={r.competency_code}>
                    <td><b>{c.code}</b></td><td>{c.name_ms}{!c.active && <span className="badge b-gray" style={{ marginLeft: 6 }}>Tidak aktif</span>}</td>
                    <td className="tna-muted">{c.source}</td>
                    <td><select className="tna-lvsel" disabled={busy} value={r.required_level} onChange={(e) => void setLevel(c.code, Number(e.target.value))}>
                      {LEVELS.map((v) => <option key={v} value={v}>{v} · {LEVEL_NAME[v]}</option>)}
                    </select></td>
                    <td><button type="button" className="mm-btn sm" disabled={busy} onClick={() => void remove(c.code)}>Keluarkan</button></td>
                  </tr>,
                ]
              })}
            </tbody>
          </table></div>
          <div className="tna-toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
            <select value={addCode} onChange={(e) => setAddCode(e.target.value)} style={{ maxWidth: 420 }}>
              <option value="">— tambah kompetensi ke profil ini —</option>
              {addable.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name_ms}</option>)}
            </select>
            <button type="button" className="mm-btn primary" disabled={busy || !addCode} onClick={() => void add()}>+ Tambah</button>
          </div>
        </div>
      )}
    </>
  )
}
