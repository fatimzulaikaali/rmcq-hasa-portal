'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { getCachedAllModules, setCachedAllModules } from '@/lib/risk/accessCache'

/* Modules shown as tiles on the welcome page.
 * `global: true` means the tile is only shown to hospital-wide roles
 * (ADMIN / RC / DIRECTOR). Risk Register is visible to everyone with an
 * account, so it stays global: false. */
type Module = {
  href: string
  icon: string
  title: string
  desc: string
  accent: string
  global: boolean
}

const MODULES: Module[] = [
  { href: '/ir', icon: '🩺', title: 'IR Dashboard', accent: 'var(--red)',
    desc: 'Incident reporting and patient-safety analytics across the hospital.', global: true },
  { href: '/kpi', icon: '📈', title: 'KPI Monitor', accent: 'var(--blue)',
    desc: 'Track quality and safety key performance indicators over time.', global: true },
  { href: '/pscs', icon: '🛡️', title: 'Safety Culture', accent: 'var(--teal)',
    desc: 'Patient Safety Culture survey results and workforce insights.', global: true },
  { href: '/risk', icon: '⚠️', title: 'Risk Register', accent: 'var(--amber)',
    desc: 'Log, score and review department risks; track committee action items.', global: false },
  { href: '/acc', icon: '📋', title: 'Accreditation', accent: 'var(--purple)',
    desc: 'MSQH 7th Edition — Standard 24 criteria and evidence of compliance.', global: true },
]

export default function HomePage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [allModules, setAllModules] = useState<boolean>(() => getCachedAllModules() ?? false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      const access = await getModuleAccess(supabase)
      if (cancelled) return
      setAllModules(access.allModules)
      setCachedAllModules(access.allModules)
      setName(access.riskUser?.name ?? user.email ?? '')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [supabase, router])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const visible = MODULES.filter((m) => allModules || !m.global)
  const firstName = name.split(/[\s@]/)[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">🛡️ RMCQ HASA Portal</div>
          <div className="sb-sub">Hospital Al-Sultan Abdullah UiTM</div>
        </div>
        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/home" className="nav-item active"><span className="nav-icon">🏠</span><span>Home</span></Link>
          {visible.map((m) => (
            <Link key={m.href} href={m.href} className="nav-item">
              <span className="nav-icon">{m.icon}</span><span>{m.title}</span>
            </Link>
          ))}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="hamburger"
              aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}
            >☰</button>
            <div>
              <div className="tb-title">Home</div>
              <div className="tb-meta">RMCQ HASA Portal</div>
            </div>
          </div>
          <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
        </header>

        <main className="p-6">
          {loading ? (
            <div className="loader"><div className="loader-inner"><div className="spin" /><div>Loading…</div></div></div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: 'var(--font-display)' }}>
                  {greeting}, {firstName} 👋
                </h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Welcome to the RMCQ HASA Portal. Choose a module to get started.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    className="group rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
                  >
                    <div
                      className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] text-xl"
                      style={{ background: 'var(--bg)', border: `1px solid var(--border)` }}
                    >
                      <span>{m.icon}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-[var(--text)]" style={{ fontFamily: 'var(--font-display)' }}>
                        {m.title}
                      </h2>
                      <span
                        className="text-[var(--muted)] transition-transform group-hover:translate-x-0.5"
                        style={{ color: m.accent }}
                      >→</span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{m.desc}</p>
                  </Link>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
