'use client'

/* Public staff link — /tna/s/[token]
 * No login. The staff types their No. Staf; every RPC call re-verifies
 * token + staff number server-side (tna_link_get / _save / _submit,
 * SECURITY DEFINER). Nothing is read from tna_* tables directly.
 * Mobile-first; reuses the srv-* survey styles. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CLUSTERS, LEVELS, LEVEL_NAME, clusterOrder, levelName } from '@/lib/tna/types'

type Item = {
  code: string; layer: 'A' | 'B'; cluster: string; name: string; definition: string | null
  required: number; training: string | null
  levels: { level: number; indicator: string }[] | null
  self_level: number | null; self_note: string | null; never_exposed: boolean; agreed_level: number | null
}
type Payload = {
  ok: true
  assignment: { id: number; status: string; submitted_at: string | null }
  staff: { name: string }
  position: { title: string; grade: string; grade_level: number; unit: string }
  items: Item[] | null
}
type RpcErr = { ok: false; error: string; message: string }
type Step = 'verify' | 'profile' | 'assess' | 'review' | 'done'
type Answer = { level: number | null; note: string; never: boolean }

const SS_KEY = (t: string) => `tna-staffno-${t}`

export default function TnaStaffLinkPage() {
  const { token } = useParams<{ token: string }>()
  const supabase = useMemo(() => createClient(), [])
  const [step, setStep] = useState<Step>('verify')
  const [staffNo, setStaffNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [ans, setAns] = useState<Record<string, Answer>>({})
  const [sec, setSec] = useState<string>('')
  const [confirm, setConfirm] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveErr, setSaveErr] = useState('')
  const pending = useRef<Record<string, Answer>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tab, setTab] = useState<'assess' | 'plan'>('assess')

  // Resume within the same browser tab (refresh) without re-typing the staff no.
  useEffect(() => {
    try {
      const s = sessionStorage.getItem(SS_KEY(token))
      if (s) { setStaffNo(s); void verify(s) }
    } catch { /* storage blocked — fine */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function verify(no = staffNo) {
    const n = no.trim()
    if (!n) { setErr('Sila masukkan No. Staf.'); return }
    setBusy(true); setErr('')
    const { data: res, error } = await supabase.rpc('tna_link_get', { p_token: token, p_staff_no: n })
    setBusy(false)
    if (error) { setErr(`Ralat sistem: [${error.code ?? ''}] ${error.message}`); return }
    const r = res as Payload | RpcErr
    if (!r.ok) {
      setErr(`${r.message} (kod: ${r.error})`)
      try { sessionStorage.removeItem(SS_KEY(token)) } catch { /* ignore */ }
      return
    }
    try { sessionStorage.setItem(SS_KEY(token), n) } catch { /* ignore */ }
    const items = (r.items ?? []).slice().sort((a, b) =>
      clusterOrder(a.cluster) - clusterOrder(b.cluster) || a.code.localeCompare(b.code, undefined, { numeric: true }))
    setData({ ...r, items })
    const a: Record<string, Answer> = {}
    for (const it of items) a[it.code] = { level: it.self_level, note: it.self_note ?? '', never: it.never_exposed }
    setAns(a)
    setSec(items[0]?.cluster ?? '')
    const st = r.assignment.status
    if (st === 'submitted' || st === 'validated') { setStep('done'); setTab(st === 'validated' ? 'plan' : 'assess') }
    else if (st === 'draft') setStep('assess')
    else setStep('profile')
  }

  /* ---- autosave (debounced, only changed items) ---- */
  function queueSave(code: string, a: Answer) {
    pending.current[code] = a
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }
  async function flush() {
    const batch = pending.current
    pending.current = {}
    const items = Object.entries(batch).filter(([, a]) => a.level != null)
      .map(([code, a]) => ({ code, level: a.level, note: a.note || null, never: a.never && a.level === 1 }))
    if (!items.length) { setSaveState('saved'); return true }
    const { data: res, error } = await supabase.rpc('tna_link_save', { p_token: token, p_staff_no: staffNo.trim(), p_items: items })
    if (error) { setSaveState('error'); setSaveErr(`[${error.code ?? ''}] ${error.message}`); Object.assign(pending.current, batch); return false }
    const r = res as { ok: boolean; error?: string; message?: string }
    if (!r.ok) { setSaveState('error'); setSaveErr(`${r.message} (kod: ${r.error})`); return false }
    setSaveState('saved'); setSaveErr('')
    return true
  }
  function setLevel(code: string, level: number) {
    const cur = ans[code] ?? { level: null, note: '', never: false }
    const next = { ...cur, level, never: level === 1 ? cur.never : false }
    setAns({ ...ans, [code]: next }); queueSave(code, next)
  }
  function setNever(code: string, v: boolean) {
    const next = { ...ans[code], never: v }
    setAns({ ...ans, [code]: next }); queueSave(code, next)
  }
  function setNote(code: string, note: string) {
    const next = { ...ans[code], note }
    setAns({ ...ans, [code]: next }); queueSave(code, next)
  }

  async function submit() {
    setBusy(true); setErr('')
    if (timer.current) clearTimeout(timer.current)
    const ok = await flush()
    if (!ok) { setBusy(false); setErr('Jawapan terakhir belum disimpan. Semak sambungan internet dan cuba lagi.'); return }
    const { data: res, error } = await supabase.rpc('tna_link_submit', { p_token: token, p_staff_no: staffNo.trim() })
    setBusy(false)
    if (error) { setErr(`Ralat sistem: [${error.code ?? ''}] ${error.message}`); return }
    const r = res as { ok: boolean; error?: string; message?: string }
    if (!r.ok) { setErr(`${r.message} (kod: ${r.error})`); return }
    await verify() // reload status (KJ is auto-validated)
    window.scrollTo({ top: 0 })
  }

  const items = data?.items ?? []
  const answered = items.filter((i) => ans[i.code]?.level != null).length
  const secs = CLUSTERS.filter((c) => items.some((i) => i.cluster === c.key))
  const secItems = items.filter((i) => i.cluster === sec)
  const missing = items.filter((i) => ans[i.code]?.level == null)
  const pct = items.length ? Math.round((answered / items.length) * 100) : 0
  const validated = data?.assignment.status === 'validated'

  return (
    <div className="srv-root">
      <header className="srv-top">
        <div className="srv-top-inner">
          <div className="srv-brand-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hospital-logo.png" alt="HASA" className="srv-logo" />
            <div className="srv-brand-tagline">Penilaian Kompetensi · TNA 2027 · Jabatan RMCQ</div>
          </div>
        </div>
        {(step === 'assess' || step === 'review') && (
          <div className="srv-progress"><div className="srv-progress-fill" style={{ width: `${pct}%` }} /></div>
        )}
      </header>

      <main className="srv-main">
        {step === 'verify' && (
          <div className="srv-card">
            <h1 className="srv-h1">Penilaian Kompetensi Staf</h1>
            <p className="srv-p">Link ini khusus untuk anda. Sila sahkan identiti dengan No. Staf sebelum mula.</p>
            <div className="srv-field">
              <label className="srv-label" htmlFor="tna-staffno">No. Staf</label>
              <input id="tna-staffno" className="srv-input" inputMode="numeric" autoComplete="off" value={staffNo}
                onChange={(e) => setStaffNo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void verify() }}
                placeholder="cth. 123456" />
            </div>
            {err && <div className="srv-error" role="alert">{err}</div>}
            <div style={{ marginTop: 16 }}>
              <button type="button" className="srv-btn primary" disabled={busy} onClick={() => void verify()}>{busy ? 'Menyemak…' : 'Sahkan'}</button>
            </div>
            <p className="srv-note">Maklumat penilaian hanya digunakan untuk Analisis Keperluan Latihan jabatan. Link tamat apabila kitaran TNA ditutup.</p>
          </div>
        )}

        {step === 'profile' && data && (
          <div className="srv-card">
            <div className="tna-ok">Identiti disahkan.</div>
            <h2 className="srv-h2" style={{ marginTop: 12 }}>Profil jawatan anda</h2>
            <dl className="tna-kv">
              <dt>Nama</dt><dd>{data.staff.name}</dd>
              <dt>Jawatan</dt><dd>{data.position.title}</dd>
              <dt>Gred</dt><dd>{data.position.grade}</dd>
              <dt>Unit</dt><dd>{data.position.unit}</dd>
              <dt>Tahap gred (Kamus UiTM)</dt><dd>{levelName(data.position.grade_level)}</dd>
            </dl>
            <div className="srv-callout">
              Anda akan menilai <b>{items.length} kompetensi</b> yang diperlukan untuk jawatan ini. Bagi setiap kompetensi, pilih tahap
              yang paling menggambarkan amalan kerja anda sekarang berdasarkan petunjuk perilaku. Skala: 1 Asas · 2 Kompeten · 3 Cekap ·
              4 Pakar · 5 Pakar Strategi. Jawapan disimpan secara automatik.
            </div>
            <button type="button" className="srv-btn primary" onClick={() => { setStep('assess'); window.scrollTo({ top: 0 }) }}>Profil betul — mula penilaian</button>
            <p className="srv-note">Jika maklumat profil tidak betul, maklumkan kepada RMCQ sebelum menilai.</p>
          </div>
        )}

        {(step === 'assess' || step === 'review' || step === 'done') && data && (
          <>
            {step === 'done' && (
              <div className="tna-seg" role="tablist">
                <button type="button" aria-pressed={tab === 'assess'} onClick={() => setTab('assess')}>Penilaian saya</button>
                <button type="button" aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}>Pelan Saya (IDP)</button>
              </div>
            )}

            {step === 'done' && tab === 'assess' && (
              <div className="srv-card">
                <div className={validated ? 'tna-ok' : 'tna-info'} role="status">
                  {validated
                    ? 'Penilaian anda telah disahkan oleh Ketua Jabatan.'
                    : `Penilaian dihantar${data.assignment.submitted_at ? ' pada ' + new Date(data.assignment.submitted_at).toLocaleString('ms-MY') : ''}. Status: menunggu pengesahan Ketua Jabatan.`}
                </div>
                <p className="srv-p" style={{ marginTop: 10 }}>Borang dikunci selepas dihantar. Hubungi Ketua Jabatan jika perlu dibuka semula.</p>
                <ReviewTable items={items} ans={ans} showAgreed={validated} />
              </div>
            )}

            {step === 'done' && tab === 'plan' && (
              <div className="srv-card">
                <h2 className="srv-h2">Pelan Pembangunan Individu</h2>
                {!validated ? (
                  <p className="srv-p">Pelan latihan akan dipaparkan selepas Ketua Jabatan mengesahkan penilaian anda.</p>
                ) : (() => {
                  const gaps = items.filter((i) => i.agreed_level != null && i.agreed_level < i.required)
                  if (!gaps.length) return <div className="tna-ok">Tiada jurang — anda mencapai semua tahap yang diperlukan. Teruskan!</div>
                  return (
                    <>
                      <p className="srv-p">{gaps.length} kompetensi belum mencapai tahap diperlukan. Latihan yang dicadangkan:</p>
                      {gaps.map((g) => (
                        <div className="tna-plan" key={g.code}>
                          <div className="tna-plan-h"><span className="tna-code">{g.code}</span> {g.name}</div>
                          <div className="tna-plan-gap">Tahap dipersetujui {levelName(g.agreed_level)} → diperlukan {levelName(g.required)}</div>
                          {ans[g.code]?.never && <div className="tna-plan-intro">Belum pernah terdedah — mulakan dengan sesi pengenalan / taklimat asas.</div>}
                          {g.training && <div className="tna-plan-tr">📘 {g.training}</div>}
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}

            {step === 'assess' && (
              <>
                <div className="tna-sticky">
                  <div className="tna-sticky-row">
                    <b>{answered} / {items.length} dijawab</b>
                    <span className={`tna-save ${saveState}`}>
                      {saveState === 'saving' ? 'Menyimpan…' : saveState === 'saved' ? 'Disimpan ✓' : saveState === 'error' ? 'Gagal simpan' : ''}
                    </span>
                  </div>
                  {saveState === 'error' && <div className="srv-error" role="alert" style={{ marginTop: 6 }}>{saveErr}</div>}
                  <div className="tna-secnav">
                    {secs.map((s) => {
                      const n = items.filter((i) => i.cluster === s.key)
                      const d = n.filter((i) => ans[i.code]?.level != null).length
                      return (
                        <button key={s.key} type="button" aria-pressed={sec === s.key} className={d === n.length ? 'full' : ''}
                          onClick={() => { setSec(s.key); window.scrollTo({ top: 0 }) }}>{s.label} {d}/{n.length}</button>
                      )
                    })}
                  </div>
                </div>

                {secItems.map((it) => {
                  const a = ans[it.code] ?? { level: null, note: '', never: false }
                  return (
                    <section className={`srv-card tna-comp ${a.level != null ? 'done' : ''}`} key={it.code}>
                      <div className="tna-comp-h">
                        <div>
                          <div className="tna-code">{it.code} · {it.layer === 'B' ? 'Kefungsian RMCQ' : 'Kamus UiTM'}</div>
                          <div className="tna-comp-name">{it.name}</div>
                        </div>
                        <div className="tna-req">Diperlukan<br /><span className={`tna-lv lv${it.required}`}>{LEVEL_NAME[it.required]}</span></div>
                      </div>
                      {it.definition && <p className="tna-def">{it.definition}</p>}
                      <div className="tna-opts" role="radiogroup" aria-label={it.name}>
                        {LEVELS.map((v) => {
                          const ind = it.levels?.find((l) => l.level === v)?.indicator ?? ''
                          return (
                            <label key={v} className={`tna-opt ${a.level === v ? 'on' : ''} ${v === it.required ? 'req' : ''}`}>
                              <input type="radio" name={`lv-${it.code}`} checked={a.level === v} onChange={() => setLevel(it.code, v)} />
                              <span>
                                <span className="tna-opt-n">{v} · {LEVEL_NAME[v]}{v === it.required && <em> ● tahap diperlukan</em>}</span>
                                <span className="tna-opt-i">{ind}</span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                      {a.level === 1 && (
                        <label className="tna-never">
                          <input type="checkbox" checked={a.never} onChange={(e) => setNever(it.code, e.target.checked)} />
                          <span>Saya <b>belum pernah terdedah</b> kepada bidang ini (latihan pengenalan akan dicadangkan dahulu)</span>
                        </label>
                      )}
                      <details className="tna-note">
                        <summary>Tambah bukti / contoh (pilihan)</summary>
                        <textarea className="srv-textarea" style={{ minHeight: 64 }} value={a.note}
                          onChange={(e) => setNote(it.code, e.target.value)} placeholder="cth. memudahcara 3 RCA pada 2026" />
                      </details>
                    </section>
                  )
                })}

                <div className="tna-nav">
                  <button type="button" className="srv-btn ghost" onClick={() => {
                    const i = secs.findIndex((s) => s.key === sec)
                    setSec(secs[(i + 1) % secs.length].key); window.scrollTo({ top: 0 })
                  }}>Bahagian seterusnya</button>
                  <button type="button" className="srv-btn primary" onClick={() => { setStep('review'); window.scrollTo({ top: 0 }) }}>Semak &amp; hantar</button>
                </div>
              </>
            )}

            {step === 'review' && (
              <div className="srv-card">
                <h2 className="srv-h2">Semak sebelum hantar</h2>
                {missing.length
                  ? <div className="srv-error" role="alert">{missing.length} kompetensi belum dijawab: {missing.map((m) => m.code).join(', ')}.</div>
                  : <div className="tna-ok">Semua {items.length} kompetensi telah dijawab.</div>}
                <ReviewTable items={items} ans={ans} showAgreed={false} />
                <label className="tna-confirm">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  <span>Saya mengesahkan penilaian kendiri ini dibuat dengan jujur dan akan dibincangkan bersama Ketua Jabatan.</span>
                </label>
                {err && <div className="srv-error" role="alert">{err}</div>}
                <div className="tna-nav">
                  <button type="button" className="srv-btn ghost" onClick={() => setStep('assess')}>Kembali</button>
                  <button type="button" className="srv-btn primary" disabled={busy || missing.length > 0 || !confirm} onClick={() => void submit()}>
                    {busy ? 'Menghantar…' : 'Hantar penilaian'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function ReviewTable({ items, ans, showAgreed }: { items: Item[]; ans: Record<string, Answer>; showAgreed: boolean }) {
  return (
    <div className="tna-tblwrap">
      <table className="tna-tbl">
        <thead><tr><th>Kompetensi</th><th>Diperlukan</th><th>Kendiri</th>{showAgreed && <th>Dipersetujui</th>}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.code}>
              <td><span className="tna-code">{i.code}</span> {i.name}</td>
              <td className="c">{levelName(i.required)}</td>
              <td className="c">{ans[i.code]?.level != null ? levelName(ans[i.code].level) : <span className="tna-miss">Belum</span>}
                {ans[i.code]?.never && <div className="tna-tag">Belum pernah terdedah</div>}</td>
              {showAgreed && <td className="c"><b>{levelName(i.agreed_level)}</b></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
