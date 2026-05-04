'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const NAV = [
  { href: '/ir', label: 'IR Dashboard', icon: '📊' },
  { href: '/kpi', label: 'KPI Monitor', icon: '📈' },
  { href: '/upload', label: 'Upload IR Database', icon: '⬆' },
] as const

export function AppShell({
  children,
  sidebarExtra,
}: {
  children: ReactNode
  sidebarExtra?: ReactNode
}) {
  const pathname = usePathname()
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <aside className="fixed left-0 top-0 z-30 flex h-screen w-[260px] flex-col overflow-y-auto bg-[var(--sidebar)] text-[var(--sidebar-text)]">
        <div className="border-b border-white/5 px-4 py-4">
          <div className="text-sm font-bold text-white">RMCQ HASA</div>
          <div className="mt-1 text-[10px] tracking-wide text-[var(--sidebar-mute)]">
            Hospital Al-Sultan Abdullah UiTM
          </div>
        </div>

        <nav className="flex-1 px-2 py-3">
          <div className="mb-1 px-2 text-[9px] font-bold uppercase tracking-widest text-[#5A6070]">
            Navigation
          </div>
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mb-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                  active
                    ? 'bg-[rgba(55,138,221,0.18)] text-[#79B8F0]'
                    : 'text-[var(--sidebar-text)] hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <span className="w-4 text-center text-sm">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {sidebarExtra && (
          <div className="border-t border-white/5">{sidebarExtra}</div>
        )}
      </aside>

      <div className="ml-[260px] flex w-[calc(100%-260px)] flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}

export function Topbar({
  title,
  meta,
  right,
}: {
  title: string
  meta?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3 shadow-sm">
      <div>
        <div className="text-base font-semibold text-[var(--text)]">{title}</div>
        {meta && <div className="text-xs text-[var(--muted)]">{meta}</div>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  )
}
