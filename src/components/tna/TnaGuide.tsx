'use client'

import type { TabProps } from './shared'
import { planStats } from '@/lib/tna/plan'

/* Panduan HOD — the yearly TNA cycle in plain steps, with where each thing is edited.
 * Written for whoever runs the module next. */
const STEPS: { t: string; tab: string; body: string[] }[] = [
  { t: 'Semak Kamus & Profil Jawatan', tab: 'Kamus · Profil Jawatan', body: [
    'Kamus: kompetensi, petunjuk tahap 1–5, cadangan latihan (mulakan dengan “CQE:” jika latihan wajib jabatan) dan “Baris templat” (objektif mana kompetensi itu disimpulkan).',
    'Profil Jawatan: tahap diperlukan bagi setiap jawatan. Tambah kompetensi baharu ke jawatan berkaitan.',
  ] },
  { t: 'Kemas kini staf & buka kitaran', tab: 'Staf · Kitaran', body: [
    'Tambah staf baharu ke jawatan kosong; arkibkan staf yang berhenti (rekod tidak dipadam).',
    'Kitaran: tetapkan tarikh tutup dan status “Dibuka”. Link staf hanya berfungsi semasa kitaran dibuka.',
  ] },
  { t: 'Hantar link kepada staf', tab: 'Penilaian', body: [
    '“Jana link untuk semua” → salin mesej / WhatsApp / emel. Link hanya dipaparkan sekali; jika hilang, “Jana semula”.',
    'Staf sahkan No. Staf, menilai tahap 1–5 dan memohon kursus (satu kursus satu baris), kemudian “Hantar penilaian”. Status Draf = belum dihantar.',
  ] },
  { t: 'Sahkan penilaian & permohonan kursus', tab: 'Pengesahan', body: [
    'Laraskan “Dipersetujui” jika tidak setuju dengan penilaian kendiri (amaran kuning jika staf hanya ikut tahap diperlukan).',
    'Bagi setiap kursus dipohon: Masuk TNA / Tangguh / Tidak, dan Dalaman / Luaran. Kursus yang menyokong jurang masuk secara automatik.',
  ] },
  { t: 'Tetapkan tahap jabatan & keutamaan', tab: 'Laporan → Tetapan template pengurusan', body: [
    'C (tahap semasa jabatan) dikira automatik; laraskan jika perlu. Priority (High / Moderate / Low) ikut impak kepada operasi.',
    'Kandungan Goal, Objektif, KPI dan Aktiviti disunting di bahagian “Templat 8 lajur — kandungan unit”.',
  ] },
  { t: 'Hantar template ke hospital', tab: 'Laporan → kad G / B', body: [
    'Template TNA Pengurusan (18 lajur): cetak atau Excel, salin ke fail pengurusan hospital.',
    'Laporan Jabatan: ringkasan proses + pelan latihan + template + lampiran, untuk fail jabatan.',
  ] },
  { t: 'Jalankan & pantau pelan latihan', tab: 'Pelan Latihan', body: [
    'A. CQE Jabatan: pilih bulan, kemudian isi tarikh sebenar & bilangan hadir selepas sesi.',
    'B. Pelan Individu: “Jana … daripada TNA”. Staf log masuk portal, pilih nama sendiri dan kemas kini “Sudah hadir” + tarikh; Ketua Jabatan juga boleh kemas kini. Muat turun Excel bila perlu.',
  ] },
  { t: 'Tutup kitaran & simpan rekod', tab: 'Kitaran · Laporan → F', body: [
    'Tutup kitaran apabila penilaian selesai (link penilaian tidak berfungsi lagi; pelan latihan masih dikemas kini dalam portal).',
    'Muat turun “Pakej Serahan” (Excel semua data) dan cetak Laporan Jabatan untuk fail jabatan setiap tahun.',
  ] },
]

export function TnaGuide({ data }: TabProps) {
  const st = planStats(data)
  const live = data.asg.filter((a) => a.status !== 'archived')
  const done = [
    true, data.cycle.status !== 'draft', live.some((a) => a.token_hash), live.length > 0 && live.every((a) => a.status === 'validated'),
    data.pinputs.some((p) => p.mgmt_priority), false, st.total > 0, data.cycle.status === 'closed',
  ]
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <h3 className="vd-h">Panduan Ketua Jabatan — kitaran TNA tahunan</h3>
      <p className="vd-sub">Ikut langkah 1–8 setiap tahun. Semua data disimpan dalam portal; Excel “Pakej Serahan” (tab Laporan) mengandungi salinan penuh untuk rekod jabatan.</p>
      <ol className="tna-guide">
        {STEPS.map((s, i) => (
          <li key={s.t} className={done[i] ? 'done' : ''}>
            <div className="tna-guide-n">{done[i] ? '✓' : i + 1}</div>
            <div>
              <div className="tna-guide-t">{s.t} <span className="tna-muted">· {s.tab}</span></div>
              <ul>{s.body.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          </li>
        ))}
      </ol>
      <p className="tna-muted">Aliran ringkas: Kamus & Profil → Penilaian staf → Pengesahan KJ → Jurang & Keutamaan → Template hospital → Pelan Latihan (CQE + individu) → Pantau kehadiran.</p>
    </div>
  )
}
