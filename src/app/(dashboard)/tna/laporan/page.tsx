'use client'

export const dynamic = 'force-dynamic'

/* Print view for TNA reports — /tna/laporan?r=individu&a=<assignment id|all> | jabatan | unit&u=<code> | kursus | kalendar | hospital | semua
 * Opens in its own tab; "Cetak / Simpan PDF" uses the browser's print dialog (A4). */
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { errMsg } from '@/lib/tna/types'
import { staffReports } from '@/lib/tna/report'
import { loadTnaData, type TnaData } from '@/components/tna/shared'
import { CalendarReport, DeptReport, HospitalReport, IndividualReport, RequestsReport } from '@/components/tna/TnaPrint'

export default function TnaPrintPage() {
  return <Suspense fallback={<div className="tp-toolbar">Memuatkan…</div>}><PrintInner /></Suspense>
}

function PrintInner() {
  const router = useRouter()
  const q = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const [d, setD] = useState<TnaData | null>(null)
  const [err, setErr] = useState('')
  const r = q.get('r') ?? 'jabatan'
  const a = q.get('a') ?? 'all'
  const u = q.get('u') ?? ''

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      try {
        const x = await loadTnaData(supabase)
        if (!x) setErr('Tiada kitaran TNA.'); else setD(x)
      } catch (e) { setErr(errMsg(e)) }
    })()
  }, [supabase, router])

  const reps = useMemo(() => (d ? staffReports(d) : []), [d])
  const title = { individu: 'Laporan Individu', jabatan: 'Laporan Jabatan', unit: 'Laporan Unit', kursus: 'Permohonan Kursus', kalendar: 'Kalendar Latihan', hospital: 'Latihan Hospital', semua: 'Laporan Lengkap' }[r] ?? 'Laporan'

  useEffect(() => { if (d) document.title = `TNA ${d.cycle.year} — ${title}` }, [d, title])

  return (
    <div className="tp-root">
      <div className="tp-toolbar no-print">
        <b>{title}</b>
        <span className="tna-muted">Gunakan “Cetak / Simpan PDF” → pilih saiz A4. Setiap bahagian bermula di halaman baharu.</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="mm-btn" onClick={() => window.close()}>Tutup</button>
          <button type="button" className="mm-btn primary" disabled={!d} onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
        </span>
      </div>
      {err && <div className="ac red" style={{ margin: 16 }}><div className="ai">⚠️</div><div><div className="at">Gagal memuatkan laporan</div><div className="as">{err}</div></div></div>}
      {!d && !err && <div style={{ padding: 24 }}>Memuatkan…</div>}
      {d && (
        <div className="tp-doc">
          {(r === 'individu' || r === 'semua') && (a === 'all' ? reps : reps.filter((x) => String(x.a.id) === a)).map((x) => <IndividualReport key={x.a.id} d={d} r={x} />)}
          {(r === 'jabatan' || r === 'semua') && <DeptReport d={d} reps={reps} />}
          {r === 'unit' && <DeptReport d={d} reps={reps} unit={u} />}
          {(r === 'kursus' || r === 'semua') && <RequestsReport d={d} reps={reps} />}
          {(r === 'hospital' || r === 'semua') && <HospitalReport d={d} />}
          {(r === 'kalendar' || r === 'semua') && <CalendarReport d={d} reps={reps} />}
        </div>
      )}
    </div>
  )
}
