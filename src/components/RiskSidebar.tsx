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
  active: 'risk' | 'committees' | 'actions' | 'quickadd' | 'bulkupload'
  children?: React.ReactNode
}) {
  const supabase = useMemo(() => createClient(), [])
  const [showGlobal, setShowGlobal] = useState(false)
  const [actionCount, setActionCount] = useState(0)
  /* RMCQ-mode intake queue: paper submissions held as DRAFT awaiting the dept
   * to send back the missing information. Surfaced as a badge on Quick Add
   * so it doesn't slip off Fatim's desk. */
  const [draftCount, setDraftCount] = useState(0)

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

        // RMCQ-mode draft count — only shown for global-role users.
        if (access.allModules) {
          const { data: drafts } = await supabase.from('risks').select('id')
            .eq('status', 'DRAFT').eq('entry_mode', 'rmcq_managed')
          setDraftCount((drafts ?? []).length)
        }
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
              <Link href="/acc" className="nav-item"><span className="nav-icon">📋</span><span>Accreditation</span></Link>
            </>
          )}
          <Link href="/risk" className={`nav-item ${active === 'risk' ? 'active' : ''}`}>
            <span className="nav-icon">⚠️</span><span>Risk Register</span>
          </Link>
          {showGlobal && (
            <Link href="/risk/quick-add" className={`nav-item nav-sub ${active === 'quickadd' ? 'active' : ''}`}
              title="Enter a paper-submitted risk on behalf of a department">
              <span className="nav-icon">📝</span><span>Quick Add (paper)</span>
              {draftCount > 0 && (
                <span className="nav-badge" title={`${draftCount} draft${draftCount === 1 ? '' : 's'} awaiting clarification from dept`}>
                  {draftCount}
                </span>
              )}
            </Link>
          )}
          {showGlobal && (
            <Link href="/risk/bulk-upload" className={`nav-item nav-sub ${active === 'bulkupload' ? 'active' : ''}`}
              title="Upload a paper register (PDF or Excel) and bulk-enter every risk in it">
              <span className="nav-icon">📤</span><span>Bulk Upload (paper)</span>
            </Link>
          )}
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
