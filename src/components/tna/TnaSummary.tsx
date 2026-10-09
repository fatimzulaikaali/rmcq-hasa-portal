'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { CLUSTERS, PRIORITY_BADGE, STATUS_BADGE, STATUS_LABEL, clusterOrder, priorityLabel, type AssignmentStatus } from '@/lib/tna/types'
import { indexData, type TabProps } from './shared'

/* Ringkasan — progress tiles, gap heatmap (staff × competency) and the
 * competency priority list (gap score × impact × strategic, same rules as Excel). */
export function TnaSummary({ data }: TabProps) {
  const ix = useMemo(() => indexData(data), [data])
  const [basis, setBasis] = useState<'agreed' | 'self'>('agreed')
  const [layer, setLayer] = useState<'B' | 'A' | 'all'>('B')

  const live = ix.liveAsg
  const byStatus = (s: AssignmentStatus) => live.filter((a) => a.status === s).length
  const vacant = ix.positionsSorted.filter((p) => !ix.asgByPos.has(p.id)).length
  const activeStaff = data.staff.filter((s) => s.status === 'active').length

  /* heatmap rows = filled positions; columns = competencies required by any of them */
  const rows = ix.positionsSorted.filter((p) => ix.asgByPos.has(p.id)).map((p) => {
    const a = ix.asgByPos.get(p.id)!
    return { p, a, s: ix.staffById.get(a.staff_id) }
  })
  const colCodes = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) for (const q of ix.reqsByPos.get(r.p.id) ?? []) set.add(q.competency_code)
    return Array.from(set).map((c) => ix.compByCode.get(c)).filter((c): c is NonNullable<typeof c> => !!c)
      .filter((c) => layer === 'all' || c.layer === layer)
      .sort((a, b) => clusterOrder(a.cluster) - clusterOrder(b.cluster) || a.sort_order - b.sort_order)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layer])

  function cell(posId: number, asgId: number, status: string, code: string) {
    const req = ix.reqsByPos.get(posId)?.find((r) => r.competency_code === code)
    if (!req) return { cls: '', txt: '', never: false }
    const it = ix.itemsByAsg.get(asgId)?.get(code)
    const lvl = basis === 'agreed'
      ? (status === 'validated' ? it?.agreed_level ?? null : null)
      : it?.self_level ?? null
    if (lvl == null) return { cls: 'tna-gna', txt: '·', never: false }
    const g = Math.max(0, req.required_level - lvl)
    return { cls: `tna-g${Math.min(g, 3)}`, txt: g === 0 ? '✓' : String(g), never: !!it?.never_exposed }
  }

  const prio = data.priority.map((r) => {
    const c = ix.compByCode.get(r.competency_code)
    const score = r.staff_validated > 0 ? r.gap_score * r.impact * r.strategic : null
    return { r, c, score, label: priorityLabel(score) }
  }).filter((x) => x.c && x.r.staff_with_gap > 0)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.r.competency_code.localeCompare(b.r.competency_code, undefined, { numeric: true }))

  return (
    <>
      <div className="tiles">
        <div className="tile"><div className="lab">Staf aktif</div><div className="val">{activeStaff}</div><div className="delta flat">{vacant} jawatan kosong</div></div>
        <div className="tile"><div className="lab">Belum mula / draf</div><div className="val">{byStatus('not_started') + byStatus('draft')}</div><div className="delta flat">{byStatus('draft')} sedang mengisi</div></div>
        <div className="tile"><div className="lab">Menunggu pengesahan</div><div className="val">{byStatus('submitted')}</div></div>
        <div className="tile"><div className="lab">Disahkan</div><div className="val">{byStatus('validated')} <small>/ {live.length}</small></div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="vd-h">Peta jurang kompetensi</h3>
        <p className="vd-sub">Jurang = tahap diperlukan − tahap {basis === 'agreed' ? 'dipersetujui (hanya staf yang telah disahkan)' : 'kendiri (sementara, sebelum pengesahan)'}. ✓ tiada jurang · 1–3 bilangan tahap kurang · · belum dinilai · kosong = tidak diperlukan untuk jawatan.</p>
        <div className="tna-toolbar">
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'agreed' | 'self')}>
            <option value="agreed">Asas: tahap dipersetujui</option>
            <option value="self">Asas: tahap kendiri</option>
          </select>
          <select value={layer} onChange={(e) => setLayer(e.target.value as 'B' | 'A' | 'all')}>
            <option value="B">Kompetensi RMCQ (Lapisan B)</option>
            <option value="A">Kamus UiTM (Lapisan A)</option>
            <option value="all">Semua</option>
          </select>
        </div>
        {colCodes.length === 0 ? <div className="vd-sub">Tiada data.</div> : (
          <div className="vd-scroll">
            <div className="tna-hm" style={{ gridTemplateColumns: `minmax(170px,auto) repeat(${colCodes.length}, minmax(30px,1fr))` }}>
              <div />
              {colCodes.map((c) => <div key={c.code} className="tna-hm-h" title={c.name_ms}>{c.code}</div>)}
              {rows.map(({ p, a, s }) => (
                <FragmentRow key={p.id}>
                  <div className="tna-hm-name" title={p.title_ms}>
                    {s?.name.split(' ').slice(0, 2).join(' ') ?? '—'} <span className={`badge ${STATUS_BADGE[a.status]}`} style={{ marginLeft: 6, fontSize: 9.5 }}>{STATUS_LABEL[a.status]}</span>
                  </div>
                  {colCodes.map((c) => {
                    const v = cell(p.id, a.id, a.status, c.code)
                    return <div key={c.code} className={`tna-hm-cell ${v.cls}`} title={`${c.code} ${c.name_ms}${v.never ? ' · belum pernah terdedah' : ''}`}>{v.txt}{v.never ? '*' : ''}</div>
                  })}
                </FragmentRow>
              ))}
            </div>
          </div>
        )}
        <p className="tna-muted" style={{ marginTop: 8 }}>* belum pernah terdedah</p>
      </div>

      <div className="card">
        <h3 className="vd-h">Keutamaan latihan mengikut kompetensi</h3>
        <p className="vd-sub">Skor = Skor Jurang (0–3, +1 jika ada staf belum pernah terdedah) × Impak × Strategik. Tinggi ≥ 18 · Sederhana 9–17 · Rendah 1–8. Dikira daripada penilaian yang telah disahkan sahaja.</p>
        {prio.length === 0 ? <div className="vd-sub">Belum ada jurang yang disahkan.</div> : (
          <div className="vd-scroll"><table className="vd-table">
            <thead><tr><th>Kod</th><th>Kompetensi</th><th>Kluster</th><th>Staf jurang</th><th>Mata jurang</th><th>Belum terdedah</th><th>Skor jurang</th><th>Impak</th><th>Strategik</th><th>Skor</th><th>Keutamaan</th></tr></thead>
            <tbody>
              {prio.map(({ r, c, score, label }) => (
                <tr key={r.competency_code}>
                  <td><b>{r.competency_code}</b></td><td>{c!.name_ms}</td>
                  <td>{CLUSTERS.find((x) => x.key === c!.cluster)?.label ?? c!.cluster}</td>
                  <td>{r.staff_with_gap} / {r.staff_validated}</td><td>{r.gap_points}</td><td>{r.staff_never_exposed || '—'}</td>
                  <td>{r.gap_score}</td><td>{r.impact}</td><td>{r.strategic}</td><td><b>{score ?? '—'}</b></td>
                  <td><span className={`badge ${PRIORITY_BADGE[label]}`}>{label}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  )
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>
}
