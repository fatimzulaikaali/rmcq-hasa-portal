'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'
import { getCachedAllModules, setCachedAllModules } from '@/lib/risk/accessCache'

/* Shared left sidebar for every /risk page.
 *
 * Layout the user asked for:
 *   - The other modules (IR / KPI / Safety Culture) sit in the Portal group.
 *   - Risk Register is a stable top-level item (it no longer "jumps to the
 *     header" when you open it) with Committees nested *under* it as a sub-item,
 *     rather than looking like a peer module.
 *
 * Module + Committees links are only shown to hospital-wide active roles
 * (RC / Director / Admin); dept-scoped users (RLO / HOD) just see Risk Register.
 * The component resolves access itself so pages don't have to pass it in. */
export function RiskSidebar({ onClose, children }: {
  onClose: () => void
  /** Kept for call-site compatibility; the sidebar always highlights Risk
   * Register now (sub-sections live on the in-page RiskTabs bar). */
  active?: 'risk' | 'committees' | 'actions' | 'quickadd' | 'bulkupload' | 'rtp'
  children?: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  // Seed from the session cache so the full module list renders immediately on
  // navigation instead of flashing "Home + Risk Register" for ~0.5s.
  const [showGlobal, setShowGlobal] = useState<boolean>(() => getCachedAllModules() ?? false)

  useEffect(() => {
    void (async () => {
      try {
        // Only the hospital-wide roles (RC / Director / Admin) see the other
        // modules in the Portal group. Everything else lives on the in-page
        // Risk tab bar (see RiskTabs), so no counts are needed here anymore.
        const access = await getModuleAccess(supabase)
        setShowGlobal(access.allModules)
        setCachedAllModules(access.allModules)
      } catch { /* leave hidden on error */ }
    })()
  }, [supabase])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">🛡️ RMCQ HASA Portal</div>
          <div className="sb-sub">Hospital Al-Sultan Abdullah UiTM</div>
        </div>
        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/home" className="nav-item"><span className="nav-icon">🏠</span><span>Home</span></Link>
          {showGlobal && (
            <>
              <Link href="/ir" className="nav-item"><span className="nav-icon">🩺</span><span>IR Dashboard</span></Link>
              <Link href="/kpi" className="nav-item"><span className="nav-icon">📈</span><span>KPI Monitor</span></Link>
              <Link href="/pscs" className="nav-item"><span className="nav-icon">🛡️</span><span>Safety Culture</span></Link>
            </>
          )}
          <Link href="/risk" className="nav-item active">
            <span className="nav-icon">⚠️</span><span>Risk Register</span>
          </Link>
          <Link href="/vmo" className="nav-item"><span className="nav-icon">🎯</span><span>VMO Survey</span></Link>
          <Link href="/mm" className="nav-item"><span className="nav-icon">📕</span><span>M&M Monitoring</span></Link>
          {showGlobal && (
            <Link href="/acc" className="nav-item"><span className="nav-icon">📋</span><span>Accreditation</span></Link>
          )}
        </div>
        {children}
      </aside>
    </>
  )
}
