'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'

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
export function RiskSidebar({ onClose, active, children }: {
  onClose: () => void
  active: 'risk' | 'committees'
  children?: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [showGlobal, setShowGlobal] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const access = await getModuleAccess(supabase)
        setShowGlobal(access.allModules)
      } catch { /* leave hidden on error */ }
    })()
  }, [supabase])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">⚠️ RMCQ Portal</div>
          <div className="sb-sub">Risk Management, Compliance &amp; Quality</div>
        </div>
        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          {showGlobal && (
            <>
              <Link href="/ir" className="nav-item"><span className="nav-icon">🩺</span><span>IR Dashboard</span></Link>
              <Link href="/kpi" className="nav-item"><span className="nav-icon">📈</span><span>KPI Monitor</span></Link>
              <Link href="/pscs" className="nav-item"><span className="nav-icon">🛡️</span><span>Safety Culture</span></Link>
            </>
          )}
          <Link href="/risk" className={`nav-item ${active === 'risk' ? 'active' : ''}`}>
            <span className="nav-icon">⚠️</span><span>Risk Register</span>
          </Link>
          {showGlobal && (
            <Link href="/risk/meetings" className={`nav-item nav-sub ${active === 'committees' ? 'active' : ''}`}>
              <span className="nav-icon">📋</span><span>Committees</span>
            </Link>
          )}
        </div>
        {children}
      </aside>
    </>
  )
}
