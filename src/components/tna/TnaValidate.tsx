'use client'

import { useEffect, useMemo, useState } from 'react'
import { CLUSTERS, LEVELS, LEVEL_NAME, STATUS_BADGE, STATUS_LABEL, clusterOrder, errMsg, gapOf, levelName } from '@/lib/tna/types'
import { fmtDate, indexData, type TabProps } from './shared'

type Row = { agreed: number | null; note: string }

/* Pengesahan — Ketua Jabatan sets the agreed level for every competency of a
 * submitted assessment, then validates. Agreed starts as the self level
 * (seeded on submit). Validated assessments can be reopened back to draft. */
export function TnaValidate({ data, supabase, userId, reload, flash, focus }: TabProps & { focus: number | null }) {
  const ix = useMemo(() => indexData(data), [data])
  const list = ix.liveAsg.filter((a) => a.status === 'submitted' || a.status === 'validated')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'submitted' ? -1 : 1))
  const [sel, setSel] = useState<number | null>(focus && list.some((a) => a.id === focus) ? focus : list[0]?.id ?? null)
  const a = list.find((x) => x.id === sel) ?? null
  const s = a ? ix.staffById.get(a.staff_id) : undefined
  const p = a ? ix.posById.get(a.position_id) : undefined

  const reqs = useMemo(() => (a ? (ix.reqsByPos.get(a.position_id) ?? []) : [])
    .map((r) => ({ r, c: ix.compByCode.get(r.competency_code)! })).filter((x) => x.c)
    .sort((x, y) => clusterOrder(x.c.cluster) - clusterOrder(y.c.cluster) || x.c.sort_order - y.c.sort_order),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [a?.id, data])

  const [rows, setRows] = useState<Record<string, Row>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!a) return
    const m: Record<string, Row> = {}
    const items = ix.itemsByAsg.get(a.id)
    for (const { r } of reqs) {
      const it = items?.get(r.competency_code)
      m[r.competency_code] = { agreed: it?.agreed_level ?? it?.self_level ?? null, note: it?.supervisor_note ?? '' }
    }
    setRows(m); setDirty(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id, data])

  const locked = a?.status === 'validated'
  const missing = reqs.filter(({ r }) => rows[r.competency_code]?.agreed == null).length

  async function save(validate: boolean) {
    if (!a) return
    if (validate && missing) { flash(`${missing} kompetensi belum ada tahap dipersetujui.`, 'err'); return }
    setBusy(true)
    const payload = reqs.map(({ r }) => ({
      assignment_id: a.id, competency_code: r.competency_code,
      agreed_level: rows[r.competency_code]?.agreed ?? null, supervisor_note: rows[r.competency_code]?.note || null,
    }))
    const { error } = await supabase.from('tna_assessment_items').upsert(payload, { onConflict: 'assignment_id,competency_code' })
    if (error) { setBusy(false); flash(`Gagal simpan: ${errMsg(error)}`, 'err'); return }
    if (validate) {
      const { error: e2 } = await supabase.from('tna_assignments')
        .update({ status: 'validated', validated_at: new Date().toISOString(), validated_by: userId }).eq('id', a.id)
      if (e2) { setBusy(false); flash(`Gagal sahkan: ${errMsg(e2)}`, 'err'); return }
    }
    setBusy(false); setDirty(false)
    flash(validate ? `Penilaian ${s?.name ?? ''} disahkan.` : 'Draf pengesahan disimpan.')
    await reload()
  }

  async function reopen() {
    if (!a || !window.confirm(`Buka semula penilaian ${s?.name}? Staf boleh mengemas kini jawapan melalui link yang sama dan perlu menghantar semula.`)) return
    setBusy(true)
    const { error } = await supabase.from('tna_assignments')
      .update({ status: 'draft', validated_at: null, validated_by: null, submitted_at: null, reopened_count: a.reopened_count + 1 }).eq('id', a.id)
    setBusy(false)
    if (error) { flash(errMsg(error), 'err'); return }
    flash('Penilaian dibuka semula (status Draf).'); await reload()
  }

  if (!list.length) return <div className="card"><h3 className="vd-h">Tiada penilaian untuk disahkan</h3><p className="vd-sub">Penilaian akan muncul di sini selepas staf menekan “Hantar penilaian”.</p></div>

  let lastCluster = ''
  return (
    <>
      <div className="tna-toolbar">
        <select value={sel ?? ''} onChange={(e) => {
          if (dirty && !window.confirm('Perubahan belum disimpan akan hilang. Teruskan?')) return
          setSel(Number(e.target.value))
        }}>
          {list.map((x) => {
            const st = ix.staffById.get(x.staff_id)
            return <option key={x.id} value={x.id}>{st?.name} — {STATUS_LABEL[x.status]}</option>
          })}
        </select>
        {a && <span className={`badge ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>}
        {a && <span className="tna-muted">Dihantar {fmtDate(a.submitted_at)}{a.validated_at ? ` · disahkan ${fmtDate(a.validated_at)}` : ''}{a.reopened_count ? ` · dibuka semula ${a.reopened_count}×` : ''}</span>}
      </div>

      {a && p && (
        <div className="card" style={{ padding: '14px 16px' }}>
          <h3 className="vd-h">{s?.name} · {p.title_ms} ({p.grade_sspa})</h3>
          <p className="vd-sub">Tetapkan tahap <b>dipersetujui</b> selepas perbincangan dengan staf. Medan berwarna = berbeza daripada penilaian kendiri. Jurang = diperlukan − dipersetujui.</p>
          <div className="vd-scroll"><table className="vd-table">
            <thead><tr><th>Kompetensi</th><th>Diperlukan</th><th>Kendiri</th><th>Dipersetujui</th><th>Jurang</th><th>Catatan Ketua Jabatan</th></tr></thead>
            <tbody>
              {reqs.map(({ r, c }) => {
                const it = ix.itemsByAsg.get(a.id)?.get(r.competency_code)
                const row = rows[r.competency_code] ?? { agreed: null, note: '' }
                const g = gapOf(r.required_level, row.agreed)
                const head = c.cluster !== lastCluster ? (lastCluster = c.cluster, true) : false
                return [
                  head && <tr key={`h-${c.cluster}`}><td colSpan={6} style={{ background: 'var(--bg)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--blue)' }}>{CLUSTERS.find((x) => x.key === c.cluster)?.label ?? c.cluster}</td></tr>,
                  <tr key={r.competency_code}>
                    <td><b>{c.code}</b> {c.name_ms}
                      {it?.self_note && <div className="tna-muted">Bukti staf: {it.self_note}</div>}</td>
                    <td>{levelName(r.required_level)}</td>
                    <td>{levelName(it?.self_level)}{it?.never_exposed && <div><span className="tna-tag">Belum pernah terdedah</span></div>}</td>
                    <td>
                      <select className={`tna-lvsel ${row.agreed != null && row.agreed !== it?.self_level ? 'diff' : ''}`} disabled={locked}
                        value={row.agreed ?? ''} onChange={(e) => { setRows({ ...rows, [r.competency_code]: { ...row, agreed: e.target.value ? Number(e.target.value) : null } }); setDirty(true) }}>
                        <option value="">—</option>
                        {LEVELS.map((v) => <option key={v} value={v}>{v} · {LEVEL_NAME[v]}</option>)}
                      </select>
                    </td>
                    <td>{g == null ? '—' : g === 0 ? <span className="tna-ok-sm">✓</span> : <span className={`badge ${g >= 2 ? 'b-red' : 'b-amber'}`}>{g}</span>}</td>
                    <td style={{ minWidth: 180 }}><input className="tna-inline" disabled={locked} value={row.note}
                      onChange={(e) => { setRows({ ...rows, [r.competency_code]: { ...row, note: e.target.value } }); setDirty(true) }} /></td>
                  </tr>,
                ]
              })}
            </tbody>
          </table></div>
          <div className="mm-formnav">
            {locked ? (
              <button type="button" className="mm-btn" disabled={busy} onClick={() => void reopen()}>↺ Buka semula</button>
            ) : (
              <>
                <button type="button" className="mm-btn" disabled={busy || !dirty} onClick={() => void save(false)}>Simpan draf</button>
                <button type="button" className="mm-btn primary" disabled={busy || missing > 0} onClick={() => {
                  if (window.confirm(`Sahkan penilaian ${s?.name}? Staf akan dapat melihat Pelan Pembangunan Individu (IDP).`)) void save(true)
                }}>✔ Sahkan penilaian</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
