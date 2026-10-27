'use client'

/* Printable TNA reports (A4). Rendered by /tna/laporan; each .tna-page starts on a new sheet. */
import { Fragment, type ReactNode } from 'react'
import { LEVEL_NAME, MONTHS, PROG_SECTION, RMCQ_ROLE, STATUS_LABEL, progPriority, progScore, rm } from '@/lib/tna/types'
import { calendar, clusterLabel, gapLines, lv, templateGH, type StaffReport } from '@/lib/tna/report'
import { fmtDate, type TnaData } from './shared'

const today = () => new Date().toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' })

function Head({ title, sub, d }: { title: string; sub?: string; d: TnaData }) {
  return (
    <header className="tp-head">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hospital-logo.png" alt="HASA" className="tp-logo" />
      <div>
        <div className="tp-org">Jabatan Pengurusan Risiko, Pematuhan &amp; Kualiti (RMCQ) · Hospital Al-Sultan Abdullah UiTM</div>
        <h1 className="tp-title">{title}</h1>
        <div className="tp-sub">{sub ? `${sub} · ` : ''}{d.cycle.name_ms} · Dicetak {today()}</div>
      </div>
    </header>
  )
}
function Sec({ n, title, children }: { n?: string; title: string; children: ReactNode }) {
  return <section className="tp-sec"><h2>{n && <span>{n}</span>}{title}</h2>{children}</section>
}
const gapCell = (g: number | null) => (g == null ? '—' : g === 0 ? '✓' : String(g))

/* ---------------- A. Laporan Individu ---------------- */
export function IndividualReport({ d, r }: { d: TnaData; r: StaffReport }) {
  let last = ''
  return (
    <article className="tna-page">
      <Head d={d} title="Laporan Analisis Keperluan Latihan Individu" sub={r.s.name} />
      <Sec n="1" title="Profil">
        <table className="tp-kv"><tbody>
          <tr><th>Nama</th><td>{r.s.name}</td><th>No. Staf</th><td>{r.s.staff_no}</td></tr>
          <tr><th>Jawatan</th><td>{r.p.title_ms}</td><th>Gred</th><td>{r.p.grade_sspa}{r.p.grade_ssm_equiv ? ` (≈ ${r.p.grade_ssm_equiv})` : ''}</td></tr>
          <tr><th>Unit</th><td>{r.unitName}</td><th>Tahap gred (Kamus UiTM)</th><td>{LEVEL_NAME[r.p.grade_level]}</td></tr>
          <tr><th>Status penilaian</th><td>{STATUS_LABEL[r.a.status]}</td><th>Dihantar / disahkan</th><td>{fmtDate(r.a.submitted_at)} / {fmtDate(r.a.validated_at)}</td></tr>
        </tbody></table>
        <p className="tp-note">{r.items.length} kompetensi dinilai · {r.validated ? `${r.gaps.length} berjurang` : 'jurang dikira selepas pengesahan'} · {r.neverCount} belum pernah terdedah · {r.requests.length} permohonan kursus.</p>
      </Sec>
      <Sec n="2" title="Penilaian kompetensi">
        <table className="tp-tbl">
          <thead><tr><th>Kod</th><th>Kompetensi</th><th className="c">Diperlukan</th><th className="c">Kendiri</th><th className="c">Dipersetujui</th><th className="c">Jurang</th><th>Catatan</th></tr></thead>
          <tbody>{r.items.map((it) => {
            const head = it.c.cluster !== last ? (last = it.c.cluster, true) : false
            return (
              <Fragment key={it.c.code}>
                {head && <tr className="tp-grp"><td colSpan={7}>{clusterLabel(it.c.cluster)}</td></tr>}
                <tr className={(it.gap ?? 0) > 0 ? 'tp-gap' : ''}>
                  <td>{it.c.code}</td><td>{it.c.name_ms}</td>
                  <td className="c">{lv(it.required)}</td><td className="c">{lv(it.self)}{it.never ? ' *' : ''}</td>
                  <td className="c">{lv(it.agreed)}</td><td className="c"><b>{gapCell(it.gap)}</b></td>
                  <td className="tp-small">{[it.selfNote && `Staf: ${it.selfNote}`, it.supNote && `KJ: ${it.supNote}`].filter(Boolean).join(' · ')}</td>
                </tr>
              </Fragment>
            )
          })}</tbody>
        </table>
        <p className="tp-note">* belum pernah terdedah. Skala: 1 Asas · 2 Kompeten · 3 Cekap · 4 Pakar · 5 Pakar Strategi.</p>
      </Sec>
      <Sec n="3" title="Pelan Pembangunan Individu (IDP)">
        {!r.validated ? <p>Belum disahkan oleh Ketua Jabatan — IDP dijana selepas pengesahan.</p>
          : !r.gaps.length ? <p>Tiada jurang. Semua tahap diperlukan telah dicapai (latihan pengekalan sahaja).</p> : (
            <table className="tp-tbl">
              <thead><tr><th>Bil.</th><th>Kompetensi</th><th className="c">Dari → ke</th><th>Latihan dicadangkan</th></tr></thead>
              <tbody>{r.gaps.map((g, i) => (
                <tr key={g.c.code}><td>{i + 1}</td><td>{g.c.code} {g.c.name_ms}</td>
                  <td className="c">{LEVEL_NAME[g.agreed!]} → {LEVEL_NAME[g.required]}</td>
                  <td>{g.never && <b>Sesi pengenalan dahulu. </b>}{g.c.default_training_ms ?? '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
      </Sec>
      <Sec n="4" title="Kursus dimohon oleh staf">
        {!r.requests.length ? <p>Tiada permohonan.</p> : (
          <table className="tp-tbl">
            <thead><tr><th>Bil.</th><th>Kursus / latihan</th><th>Penganjur</th><th>Kompetensi</th><th>Sebab</th><th className="c">Bulan</th><th className="c">Kos</th><th className="c">Keutamaan</th></tr></thead>
            <tbody>{r.requests.map((q, i) => (
              <tr key={q.id}><td>{i + 1}</td><td>{q.title_ms}</td><td>{q.provider_ms ?? '—'}</td><td>{q.competency_code ?? 'Lain-lain'}</td>
                <td className="tp-small">{q.reason_ms ?? '—'}</td><td className="c">{q.preferred_month ? MONTHS[q.preferred_month - 1] : '—'}</td>
                <td className="c">{rm(q.est_cost_rm)}</td><td className="c">{q.priority ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Sec>
      <div className="tp-sign">
        <div><div className="tp-line" />Tandatangan staf<br /><b>{r.s.name}</b><br />Tarikh:</div>
        <div><div className="tp-line" />Disahkan oleh Ketua Jabatan<br /><b>&nbsp;</b><br />Tarikh:</div>
      </div>
    </article>
  )
}

/* ---------------- B/C. Laporan Jabatan / Unit ---------------- */
export function DeptReport({ d, reps, unit }: { d: TnaData; reps: StaffReport[]; unit?: string }) {
  const scope = unit ? reps.filter((r) => r.p.unit_code === unit) : reps
  const unitName = unit ? d.units.find((u) => u.code === unit)?.name_ms ?? unit : null
  const vacant = d.positions.filter((p) => p.active && (!unit || p.unit_code === unit) && !d.asg.some((a) => a.position_id === p.id && a.status !== 'archived'))
  const lines = gapLines(d, scope)
  const withGap = lines.filter((g) => g.withGap.length > 0)
  const cols = lines.filter((g) => g.c.layer === 'B').sort((a, b) => a.c.code.localeCompare(b.c.code, undefined, { numeric: true }))
  const colsA = lines.filter((g) => g.c.layer === 'A').sort((a, b) => a.c.code.localeCompare(b.c.code, undefined, { numeric: true }))
  const tpl = d.template.filter((t) => !unit || t.unit_code === unit)
  const reqs = scope.flatMap((r) => r.requests.map((q) => ({ q, r })))
  const cnt = (s: string) => scope.filter((r) => r.a.status === s).length
  const units = unit ? [] : d.units.map((u) => {
    const m = reps.filter((r) => r.p.unit_code === u.code)
    return { u, n: m.length, v: m.filter((r) => r.validated).length, g: m.reduce((s, r) => s + r.gaps.reduce((t, x) => t + (x.gap ?? 0), 0), 0), staffGap: m.filter((r) => r.gaps.length).length }
  }).filter((x) => x.n)

  const heat = (title: string, cs: typeof lines) => cs.length > 0 && (
    <>
      <h3 className="tp-h3">{title}</h3>
      <table className="tp-heat">
        <thead><tr><th>Staf</th>{cs.map((g) => <th key={g.c.code} title={g.c.name_ms}><span>{g.c.code}</span></th>)}</tr></thead>
        <tbody>{scope.map((r) => (
          <tr key={r.a.id}><td>{r.s.name}</td>{cs.map((g) => {
            const it = r.items.find((x) => x.c.code === g.c.code)
            if (!it) return <td key={g.c.code} />
            const v = it.gap
            return <td key={g.c.code} className={v == null ? 'hn' : `h${Math.min(v, 3)}`}>{v == null ? '·' : v === 0 ? '✓' : v}{it.never ? '*' : ''}</td>
          })}</tr>
        ))}</tbody>
      </table>
    </>
  )

  return (
    <>
      <article className="tna-page">
        <Head d={d} title={unit ? 'Laporan Analisis Keperluan Latihan — Unit' : 'Laporan Analisis Keperluan Latihan — Jabatan'} sub={unitName ?? 'Jabatan RMCQ'} />
        <Sec n="1" title="Ringkasan">
          <div className="tp-tiles">
            <div><b>{scope.length}</b>staf dinilai</div><div><b>{vacant.length}</b>jawatan kosong</div>
            <div><b>{cnt('validated')}</b>disahkan</div><div><b>{cnt('submitted')}</b>menunggu pengesahan</div>
            <div><b>{cnt('not_started') + cnt('draft')}</b>belum hantar</div><div><b>{withGap.length}</b>kompetensi berjurang</div>
          </div>
          {!unit && units.length > 0 && (
            <table className="tp-tbl">
              <thead><tr><th>Unit</th><th className="c">Staf</th><th className="c">Disahkan</th><th className="c">Staf berjurang</th><th className="c">Mata jurang</th></tr></thead>
              <tbody>{units.map((x) => <tr key={x.u.code}><td>{x.u.name_ms}</td><td className="c">{x.n}</td><td className="c">{x.v}</td><td className="c">{x.staffGap}</td><td className="c">{x.g}</td></tr>)}</tbody>
            </table>
          )}
        </Sec>
        <Sec n="2" title="Status penilaian staf">
          <table className="tp-tbl">
            <thead><tr><th>Bil.</th><th>Nama</th><th>Jawatan</th><th>Unit</th><th className="c">Status</th><th className="c">Kompetensi</th><th className="c">Berjurang</th><th className="c">Permohonan kursus</th></tr></thead>
            <tbody>
              {scope.map((r, i) => <tr key={r.a.id}><td>{i + 1}</td><td>{r.s.name}</td><td>{r.p.title_ms} ({r.p.grade_sspa})</td><td>{r.p.unit_code}</td><td className="c">{STATUS_LABEL[r.a.status]}</td><td className="c">{r.items.length}</td><td className="c">{r.validated ? r.gaps.length : '—'}</td><td className="c">{r.requests.length}</td></tr>)}
              {vacant.map((p) => <tr key={`v${p.id}`} className="tp-muted"><td>—</td><td>KOSONG</td><td>{p.title_ms} ({p.grade_sspa})</td><td>{p.unit_code}</td><td colSpan={4} className="c">Jawatan belum diisi</td></tr>)}
            </tbody>
          </table>
        </Sec>
      </article>

      <article className="tna-page tna-land">
        <Head d={d} title="Peta Jurang Kompetensi" sub={unitName ?? 'Jabatan RMCQ'} />
        <p className="tp-note">Jurang = tahap diperlukan − tahap dipersetujui (penilaian disahkan sahaja). ✓ tiada jurang · 1–3 bilangan tahap kurang · · belum disahkan · kosong = tidak diperlukan · * belum pernah terdedah.</p>
        {heat('Kompetensi Kefungsian RMCQ (Lapisan B)', cols)}
        {heat('Kamus Kompetensi UiTM — staf pentadbiran (Lapisan A)', colsA)}
      </article>

      <article className="tna-page">
        <Head d={d} title="Keutamaan Latihan" sub={unitName ?? 'Jabatan RMCQ'} />
        <p className="tp-note">Skor = Skor jurang (0–3, +1 jika ada staf belum pernah terdedah) × Impak × Strategik. Tinggi ≥ 18 · Sederhana 9–17 · Rendah 1–8.</p>
        {!withGap.length ? <p>Belum ada jurang yang disahkan.</p> : (
          <table className="tp-tbl">
            <thead><tr><th>Kod</th><th>Kompetensi</th><th className="c">Staf berjurang</th><th className="c">Mata</th><th className="c">Skor</th><th className="c">Keutamaan</th><th className="c">Suku</th><th>Staf terlibat</th><th>Latihan dicadangkan</th></tr></thead>
            <tbody>{withGap.map((g) => (
              <tr key={g.c.code}><td>{g.c.code}</td><td>{g.c.name_ms}</td><td className="c">{g.withGap.length} / {g.validated}</td><td className="c">{g.points}</td>
                <td className="c"><b>{g.score}</b></td><td className={`c tp-p-${g.label}`}>{g.label}</td><td className="c">{g.quarter}</td>
                <td className="tp-small">{g.withGap.map((r) => r.s.name).join('; ')}</td><td className="tp-small">{g.c.default_training_ms ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
        <Sec title={`Permohonan kursus staf (${reqs.length})`}>
          {!reqs.length ? <p>Tiada permohonan.</p> : (
            <>
              <table className="tp-tbl">
                <thead><tr><th>Staf</th><th>Kursus</th><th>Penganjur</th><th>Kompetensi</th><th className="c">Bulan</th><th className="c">Kos</th><th className="c">Keutamaan</th></tr></thead>
                <tbody>{reqs.map(({ q, r }) => <tr key={q.id}><td>{r.s.name}</td><td>{q.title_ms}</td><td>{q.provider_ms ?? '—'}</td><td>{q.competency_code ?? 'Lain-lain'}</td><td className="c">{q.preferred_month ? MONTHS[q.preferred_month - 1] : '—'}</td><td className="c">{rm(q.est_cost_rm)}</td><td className="c">{q.priority ?? '—'}</td></tr>)}</tbody>
              </table>
              <p className="tp-note">Jumlah anggaran kos: <b>{rm(reqs.reduce((s, x) => s + Number(x.q.est_cost_rm ?? 0), 0))}</b></p>
            </>
          )}
        </Sec>
      </article>

      {tpl.length > 0 && (
        <article className="tna-page tna-land">
          <Head d={d} title={`Analisis Keperluan Latihan (TNA) ${d.cycle.year} — Templat Pengurusan Hospital`} sub={unitName ?? 'Jabatan RMCQ'} />
          <table className="tp-tbl tp-tpl">
            <thead><tr><th>Bil.</th><th>Unit / Item</th><th>Penunjuk Prestasi</th><th>KPI &amp; Sasaran Kerja</th><th>Cadangan Pemberat / Kaedah Ukuran KPI</th><th>Aktiviti / Program Sokongan</th><th>Kompetensi Diperlukan</th><th>Cadangan Latihan Pembangunan Kompetensi</th></tr></thead>
            <tbody>{tpl.map((t, i) => {
              const { G, H } = templateGH(d, t.unit_code, reps, t.initial_training_ms)
              return <tr key={t.id}><td className="c">{i + 1}</td><td><b>{t.item_ms}</b></td><td>{t.indicator_ms}</td><td>{t.kpi_ms}</td><td>{t.weight_ms}</td><td>{t.activities_ms}</td><td>{G}</td><td>{H}</td></tr>
            })}</tbody>
          </table>
          <p className="tp-note">Lajur Kompetensi Diperlukan dan Cadangan Latihan dijana daripada analisis jurang (Kamus Kompetensi UiTM 2021 + Kamus Kefungsian RMCQ).</p>
        </article>
      )}
    </>
  )
}

/* ---------------- D. Senarai Permohonan Kursus ---------------- */
export function RequestsReport({ d, reps }: { d: TnaData; reps: StaffReport[] }) {
  const all = reps.flatMap((r) => r.requests.map((q) => ({ q, r })))
  const by = (p: string) => all.filter((x) => (x.q.priority ?? '—') === p)
  const comp = new Map(d.comps.map((c) => [c.code, c.name_ms]))
  return (
    <article className="tna-page tna-land">
      <Head d={d} title="Senarai Permohonan Kursus Staf" sub="Jabatan RMCQ" />
      <div className="tp-tiles">
        <div><b>{all.length}</b>permohonan</div><div><b>{new Set(all.map((x) => x.r.a.id)).size}</b>staf memohon</div>
        <div><b>{by('Tinggi').length}</b>keutamaan tinggi</div><div><b>{rm(all.reduce((s, x) => s + Number(x.q.est_cost_rm ?? 0), 0))}</b>anggaran kos</div>
      </div>
      {!all.length ? <p>Tiada permohonan kursus.</p> : (
        <table className="tp-tbl">
          <thead><tr><th>Bil.</th><th>Staf</th><th>Unit</th><th>Kursus / latihan</th><th>Penganjur</th><th>Kompetensi berkaitan</th><th>Sebab / justifikasi</th><th className="c">Bulan</th><th className="c">Kos</th><th className="c">Keutamaan</th></tr></thead>
          <tbody>{all.map(({ q, r }, i) => (
            <tr key={q.id}><td>{i + 1}</td><td>{r.s.name}</td><td>{r.p.unit_code}</td><td><b>{q.title_ms}</b></td><td>{q.provider_ms ?? '—'}</td>
              <td>{q.competency_code ? `${q.competency_code} ${comp.get(q.competency_code) ?? ''}` : 'Lain-lain'}</td><td className="tp-small">{q.reason_ms ?? '—'}</td>
              <td className="c">{q.preferred_month ? MONTHS[q.preferred_month - 1] : '—'}</td><td className="c">{rm(q.est_cost_rm)}</td><td className="c">{q.priority ?? '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
    </article>
  )
}

/* ---------------- E. Kalendar Latihan ---------------- */
export function CalendarReport({ d, reps }: { d: TnaData; reps: StaffReport[] }) {
  const lines = calendar(d, reps)
  const kinds = ['Jabatan', 'Hospital', 'Permohonan staf'] as const
  const qMonths = (q: string) => (q.startsWith('S1') ? [1, 2, 3] : q.startsWith('S2') ? [4, 5, 6] : q.startsWith('S3') ? [7, 8, 9, 10, 11, 12] : [])
  const hospSec = new Map(d.programmes.map((p) => [p.title_ms, p]))
  return (
    <article className="tna-page tna-land">
      <Head d={d} title={`Kalendar Latihan ${d.cycle.year}`} sub="Jabatan RMCQ & peringkat hospital" />
      <p className="tp-note">● bulan dirancang · ░ cadangan suku tahun (latihan jabatan, ikut keutamaan jurang). Latihan hospital dijadualkan di tab Latihan Hospital; permohonan staf ikut bulan yang dipilih.</p>
      <table className="tp-tbl tp-cal">
        <thead><tr><th>Bil.</th><th>Program / latihan</th><th>Butiran</th><th className="c">Keutamaan</th>{MONTHS.map((m) => <th key={m} className="c">{m}</th>)}</tr></thead>
        <tbody>{kinds.map((k) => {
          const ls = lines.filter((l) => l.kind === k)
          if (!ls.length) return null
          return (
            <Fragment key={k}>
              <tr className="tp-grp"><td colSpan={16}>{k === 'Jabatan' ? 'Latihan jabatan (daripada jurang kompetensi)' : k === 'Hospital' ? 'Latihan peringkat hospital' : 'Permohonan kursus staf'} ({ls.length})</td></tr>
              {ls.map((l, i) => {
                const sug = qMonths(l.quarter)
                const p = hospSec.get(l.title)
                return (
                  <tr key={`${k}${i}`}>
                    <td>{i + 1}</td><td>{l.title}{p?.source_section && <span className="tp-small"> ({p.source_section})</span>}</td><td className="tp-small">{l.detail}</td>
                    <td className="c">{l.priority}</td>
                    {MONTHS.map((_, m) => <td key={m} className={`c ${l.months.includes(m + 1) ? 'tp-on' : sug.includes(m + 1) ? 'tp-sug' : ''}`}>{l.months.includes(m + 1) ? '●' : ''}</td>)}
                  </tr>
                )
              })}
            </Fragment>
          )
        })}</tbody>
      </table>
    </article>
  )
}

/* ---------------- Latihan Hospital (optional print) ---------------- */
export function HospitalReport({ d }: { d: TnaData }) {
  const ps = d.programmes.filter((p) => p.scope === 'hospital' && p.status === 'active')
  return (
    <article className="tna-page tna-land">
      <Head d={d} title={`Analisis Keperluan Latihan Peringkat Hospital ${d.cycle.year}`} sub="Berdasarkan dapatan insiden & audit" />
      <table className="tp-tbl">
        <thead><tr><th>Bil.</th><th>Isu / dapatan</th><th>Program</th><th>Sasaran</th><th>Pemilik / penganjur</th><th>Peranan RMCQ</th><th>Kaedah · kekerapan</th><th>Ukuran keberkesanan</th><th className="c">Skor</th><th className="c">Keutamaan</th><th>Bulan</th></tr></thead>
        <tbody>{Object.keys(PROG_SECTION).map((sec) => {
          const rows = ps.filter((p) => (p.source_section ?? 'D') === sec)
          if (!rows.length) return null
          return (
            <Fragment key={sec}>
              <tr className="tp-grp"><td colSpan={11}>{PROG_SECTION[sec]}</td></tr>
              {rows.map((p, i) => (
                <tr key={p.id}><td>{i + 1}</td><td className="tp-small">{p.issue_ms ?? '—'}</td><td><b>{p.title_ms}</b></td><td className="tp-small">{p.target_group_ms}</td>
                  <td className="tp-small">{p.owner_ms}</td><td>{p.rmcq_role ? RMCQ_ROLE[p.rmcq_role] ?? p.rmcq_role : '—'}</td>
                  <td className="tp-small">{[p.method_ms, p.frequency_ms].filter(Boolean).join(' · ')}</td><td className="tp-small">{p.kpi_ms ?? '—'}</td>
                  <td className="c">{progScore(p) ?? '—'}</td><td className={`c tp-p-${progPriority(p)}`}>{progPriority(p)}</td>
                  <td className="tp-small">{p.planned_months.map((m) => MONTHS[m - 1]).join(', ') || '—'}</td></tr>
              ))}
            </Fragment>
          )
        })}</tbody>
      </table>
    </article>
  )
}
