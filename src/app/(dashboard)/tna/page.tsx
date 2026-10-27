'use client'

export const dynamic = 'force-dynamic'

/* TNA & Kompetensi — Jabatan RMCQ (Fasa 1).
 * Tabs: Ringkasan · Penilaian · Pengesahan · Staf · Profil Jawatan · Kamus · Kitaran.
 * All signed-in portal users have access (RLS policy tna_*_portal_all). */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PortalNav } from '@/components/PortalNav'
import { errMsg } from '@/lib/tna/types'
import { loadTnaData, type TnaData } from '@/components/tna/shared'
import { TnaSummary } from '@/components/tna/TnaSummary'
import { TnaAssess } from '@/components/tna/TnaAssess'
import { TnaValidate } from '@/components/tna/TnaValidate'
import { TnaStaffTab } from '@/components/tna/TnaStaffTab'
import { TnaPositions } from '@/components/tna/TnaPositions'
import { TnaKamus } from '@/components/tna/TnaKamus'
import { TnaCycleTab } from '@/components/tna/TnaCycleTab'
import { TnaProgrammes } from '@/components/tna/TnaProgrammes'
import { TnaReports } from '@/components/tna/TnaReports'

type Tab = 'sum' | 'assess' | 'valid' | 'staff' | 'pos' | 'kamus' | 'prog' | 'rep' | 'cycle'
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'sum', icon: '📊', label: 'Ringkasan' },
  { id: 'assess', icon: '🔗', label: 'Penilaian' },
  { id: 'valid', icon: '✔', label: 'Pengesahan' },
  { id: 'staff', icon: '👥', label: 'Staf' },
  { id: 'pos', icon: '◆', label: 'Profil Jawatan' },
  { id: 'kamus', icon: '📖', label: 'Kamus' },
  { id: 'prog', icon: '🏥', label: 'Latihan Hospital' },
  { id: 'rep', icon: '🖨', label: 'Laporan' },
  { id: 'cycle', icon: '🗓', label: 'Kitaran' },
]

export default function TnaPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<Tab>('sum')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [userId, setUserId] = useState('')
  const [data, setData] = useState<TnaData | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const [focusAsg, setFocusAsg] = useState<number | null>(null)

  const flash = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind })
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), kind === 'err' ? 9000 : 3500)
  }, [])

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    setUserId(user.id)
    try {
      const d = await loadTnaData(supabase)
      if (!d) { setLoadError('Tiada kitaran TNA dalam pangkalan data.'); setLoading(false); return }
      setData(d)
      setLoadError('')
    } catch (e) {
      setLoadError(errMsg(e))
    }
    setLoading(false)
  }, [supabase, router])

  useEffect(() => { void load() }, [load])

  const props = data ? { data, supabase, userId, reload: load, flash } : null
  const counts = useMemo(() => {
    if (!data) return null
    const live = data.asg.filter((a) => a.status !== 'archived')
    return { sub: live.filter((a) => a.status === 'submitted').length }
  }, [data])

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar"><PortalNav active="tna" /></aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div style={{ minWidth: 0 }}>
              <div className="tb-title">TNA &amp; Kompetensi</div>
              <div className="tb-meta">Analisis Keperluan Latihan · Jabatan RMCQ{data ? ` · ${data.cycle.name_ms}` : ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {data && (
              <span className={`badge ${data.cycle.status === 'open' ? 'b-green' : data.cycle.status === 'closed' ? 'b-gray' : 'b-amber'}`}>
                Kitaran {data.cycle.status === 'open' ? 'dibuka' : data.cycle.status === 'closed' ? 'ditutup' : 'draf'}
              </span>
            )}
          </div>
        </header>

        <nav className="tab-nav" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
              className={`tab-btn ${tab === x.id ? 'active' : ''}`} onClick={() => { setTab(x.id); setSidebarOpen(false) }}>
              {x.icon} {x.label}
              {x.id === 'valid' && counts && counts.sub > 0 && <span className="badge b-blue" style={{ marginLeft: 2 }}>{counts.sub}</span>}
            </button>
          ))}
        </nav>

        <main className="tab-pane">
          {toast && (
            <div className={`ac ${toast.kind === 'ok' ? 'green' : 'red'}`} role="status" style={{ marginBottom: 12 }}>
              <div className="ai">{toast.kind === 'ok' ? '✅' : '⚠️'}</div><div><div className="at">{toast.msg}</div></div>
            </div>
          )}
          {loading && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Memuatkan…</div></div></div>}
          {!loading && loadError && <div className="ac red"><div className="ai">⚠️</div><div><div className="at">Gagal memuatkan data TNA</div><div className="as">{loadError}</div></div></div>}
          {!loading && props && (
            <>
              {tab === 'sum' && <TnaSummary {...props} />}
              {tab === 'assess' && <TnaAssess {...props} onValidate={(id) => { setFocusAsg(id); setTab('valid') }} onGoStaff={() => setTab('staff')} />}
              {tab === 'valid' && <TnaValidate {...props} focus={focusAsg} />}
              {tab === 'staff' && <TnaStaffTab {...props} />}
              {tab === 'pos' && <TnaPositions {...props} />}
              {tab === 'kamus' && <TnaKamus {...props} />}
              {tab === 'prog' && <TnaProgrammes {...props} />}
              {tab === 'rep' && <TnaReports {...props} />}
              {tab === 'cycle' && <TnaCycleTab {...props} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
