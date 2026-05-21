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
  active: 'risk' | 'committees' | 'actions'
  children?: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [showGlobal, setShowGlobal] = useState(false)
  const [actionCount, setActionCount] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const access = await getModuleAccess(supabase)
        setShowGlobal(access.allModules)

        // Count committee action items awaiting a response that the user can see
        // (assigned to their dept for dept-scoped roles, all for hospital-wide).
        let q = supabase.from('risk_action_items')
          .select('id').in('status', ['PENDING', 'OVERDUE'])
        if (access.deptScopes !== null) {
          q = access.deptScopes.length
            ? q.overlaps('assigned_depts', access.deptScopes)
            : q.eq('id', -1) // no dept scope -> nothing
        }
        const { data } = await q
        setActionCount((data ?? []).length)
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
          <Link href="/risk/actions" className={`nav-item nav-sub ${active === 'actions' ? 'active' : ''}`}>
            <span className="nav-icon">📌</span><span>Action Items</span>
            {actionCount > 0 && <span className="nav-badge">{actionCount}</span>}
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
