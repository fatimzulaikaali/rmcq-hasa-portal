'use client'

import { useEffect, useMemo, useState } from 'react'
import { CLUSTERS, KJ_DECISION, LEVELS, LEVEL_NAME, MONTHS, STATUS_BADGE, STATUS_LABEL, clusterOrder, errMsg, gapOf, levelName, requestInTna, rm, TRAINING_TYPE, trainingTypeOf, type KjDecision, type TnaRequest, type TrainingType } from '@/lib/tna/types'
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
  const [dec, setDec] = useState<Record<number, Partial<Pick<TnaRequest, 'kj_decision' | 'kj_note' | 'training_type'>>>>({})
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

  /* Course-request decisions save immediately (also allowed after validation). */
  async function decide(q: TnaRequest, d: KjDecision | null, note?: string | null) {
    const { error } = await supabase.from('tna_course_requests')
      .update({ kj_decision: d, kj_note: note === undefined ? q.kj_note : note, decided_at: d ? new Date().toISOString() : null }).eq('id', q.id)
    if (error) { flash(`Gagal simpan keputusan: ${errMsg(error)}`, 'err'); return }
    // keep it local so unsaved agreed-level edits above are not reset by a reload
    setDec((m) => ({ ...m, [q.id]: { ...m[q.id], kj_decision: d, kj_note: note === undefined ? q.kj_note : note } }))
    flash('Keputusan kursus disimpan.')
  }

  async function setType(q: TnaRequest, t: TrainingType | null) {
    const { error } = await supabase.from('tna_course_requests').update({ training_type: t }).eq('id', q.id)
    if (error) { flash(`Gagal simpan jenis latihan: ${errMsg(error)}`, 'err'); return }
    setDec((m) => ({ ...m, [q.id]: { ...m[q.id], training_type: t } }))
    flash('Jenis latihan disimpan.')
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
          {(() => {
            const items = ix.itemsByAsg.get(a.id)
            const same = reqs.filter(({ r }) => items?.get(r.competency_code)?.self_level === r.required_level).length
            return reqs.length >= 5 && same / reqs.length >= 0.9 ? (
              <div className="banner" style={{ marginBottom: 10 }}><span>⚠️</span><div>
                <b>{same} daripada {reqs.length}</b> penilaian kendiri sama tepat dengan tahap diperlukan. Staf mungkin memilih mengikut tanda “tahap diperlukan” — semak bersama staf sebelum mengesahkan.
              </div></div>
            ) : null
          })()}
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
          <div className="mm-sec">Kursus dimohon oleh staf</div>
          {(() => {
            const myReqs = data.requests.filter((q) => q.assignment_id === a.id).sort((x, y) => x.sort_order - y.sort_order).map((q) => ({ ...q, ...dec[q.id] }))
            if (!myReqs.length) return <p className="tna-muted">Tiada permohonan kursus.</p>
            const reqLevel = new Map(reqs.map(({ r }) => [r.competency_code, r.required_level]))
            return (
              <>
                <p className="vd-sub">Kursus yang <b>menyokong jurang</b> (tahap dipersetujui &lt; diperlukan) masuk ke templat TNA secara automatik. Kursus lain hanya masuk jika Dr. pilih <b>Masuk TNA</b> (pembangunan lanjutan). Status jurang di sini ikut tahap dipersetujui yang sedang dipilih di atas.</p>
                <div className="vd-scroll"><table className="vd-table tna-ptable">
                  <thead><tr><th>Kursus</th><th>Kompetensi</th><th>Bulan · kos · keutamaan</th><th>Status</th><th>Keputusan Ketua Jabatan · jenis latihan</th></tr></thead>
                  <tbody>{myReqs.map((q) => {
                    const req = q.competency_code ? reqLevel.get(q.competency_code) : undefined
                    const ag = q.competency_code ? rows[q.competency_code]?.agreed ?? null : null
                    const self = q.competency_code ? ix.itemsByAsg.get(a.id)?.get(q.competency_code)?.self_level ?? null : null
                    const gap = req != null && ag != null && ag < req
                    const inTna = requestInTna(q, gap)
                    return (
                      <tr key={q.id}>
                        <td><b>{q.title_ms}</b>{q.provider_ms && <div className="tna-muted">{q.provider_ms}</div>}{q.reason_ms && <div className="tna-muted" style={{ maxWidth: 360 }}>{q.reason_ms}</div>}</td>
                        <td>{q.competency_code ? <>{q.competency_code} · {ix.compByCode.get(q.competency_code)?.name_ms}<div className="tna-muted">diperlukan {levelName(req)} · dipersetujui {levelName(ag)}</div></> : 'Lain-lain'}</td>
                        <td className="tna-muted" style={{ whiteSpace: 'nowrap' }}>{q.preferred_month ? MONTHS[q.preferred_month - 1] : '—'} · {rm(q.est_cost_rm)} · {q.priority ?? '—'}</td>
                        <td>
                          {gap ? <span className="badge b-amber">Menyokong jurang</span> : <span className="badge b-gray">Tiada jurang</span>}
                          {!gap && self != null && req != null && self >= req && <div className="tna-warn">⚠ Staf nilai diri sudah mencapai tahap, tetapi memohon kursus — semak tahap dipersetujui.</div>}
                          <div style={{ marginTop: 4 }}>{inTna ? <span className="tna-ok-sm">✓ Dalam templat TNA</span> : <span className="tna-muted">Tidak dalam templat</span>}</div>
                        </td>
                        <td style={{ minWidth: 190 }}>
                          <select className="tna-lvsel" value={q.kj_decision ?? ''} onChange={(e) => void decide(q, (e.target.value || null) as KjDecision | null)}>
                            <option value="">{gap ? 'Auto (menyokong jurang)' : '— belum diputuskan —'}</option>
                            {(Object.keys(KJ_DECISION) as KjDecision[]).map((k) => <option key={k} value={k}>{KJ_DECISION[k]}</option>)}
                          </select>
                          <select className="tna-lvsel" style={{ marginTop: 4 }} value={q.training_type ?? ''} onChange={(e) => void setType(q, (e.target.value || null) as TrainingType | null)}>
                            <option value="">Auto: {TRAINING_TYPE[trainingTypeOf({ provider_ms: q.provider_ms })]}</option>
                            {(Object.keys(TRAINING_TYPE) as TrainingType[]).map((k) => <option key={k} value={k}>{TRAINING_TYPE[k]}</option>)}
                          </select>
                          <input className="tna-inline" style={{ marginTop: 4 }} placeholder="Catatan (pilihan)" defaultValue={q.kj_note ?? ''}
                            onBlur={(e) => { if (e.target.value !== (q.kj_note ?? '')) void decide(q, q.kj_decision, e.target.value || null) }} />
                        </td>
                      </tr>
                    )
                  })}</tbody>
                </table></div>
              </>
            )
          })()}
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
