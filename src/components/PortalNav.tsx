'use client'

import Link from 'next/link'

/* Single source of truth for the portal's left-sidebar brand line + the
 * top-level module links. The hospital-wide module pages (IR / KPI / Safety
 * Culture / Accreditation) all render this so the brand and the module list
 * stay identical and can never drift apart again.
 *
 * Module-specific content — IR's filter panel, etc. — is added by each page
 * *after* this block, inside the same <aside className="sidebar">.
 *
 * Note: the Home and Risk sidebars are intentionally NOT built on this, because
 * they gate which modules show based on the signed-in user's access. */
export type PortalModule = 'home' | 'ir' | 'kpi' | 'pscs' | 'risk' | 'vmo' | 'acc'

const MODULES: { key: PortalModule; href: string; icon: string; label: string }[] = [
  { key: 'home', href: '/home', icon: '🏠', label: 'Home' },
  { key: 'ir',   href: '/ir',   icon: '🩺', label: 'IR Dashboard' },
  { key: 'kpi',  href: '/kpi',  icon: '📈', label: 'KPI Monitor' },
  { key: 'pscs', href: '/pscs', icon: '🛡️', label: 'Safety Culture' },
  { key: 'risk', href: '/risk', icon: '⚠️', label: 'Risk Register' },
  { key: 'vmo',  href: '/vmo',  icon: '🎯', label: 'VMO Survey' },
  { key: 'acc',  href: '/acc',  icon: '📋', label: 'Accreditation' },
]

export function PortalNav({ active }: { active: PortalModule }) {
  return (
    <>
      <div className="sb-head">
        <div className="sb-logo">🛡️ RMCQ HASA Portal</div>
        <div className="sb-sub">Hospital Al-Sultan Abdullah UiTM</div>
      </div>
      <div className="nav-section">
        <div className="nav-lbl">Portal</div>
        {MODULES.map((m) => (
          <Link key={m.key} href={m.href} className={`nav-item ${active === m.key ? 'active' : ''}`}>
            <span className="nav-icon">{m.icon}</span><span>{m.label}</span>
          </Link>
        ))}
      </div>
    </>
  )
}
