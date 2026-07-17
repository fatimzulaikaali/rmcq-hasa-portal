'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getModuleAccess } from '@/lib/risk/auth'

/* Horizontal tab bar for the Risk module.
 *
 * Replaces the old sidebar sub-nav (Log Risk / RTP / Action Items / Committees).
 * Sits directly under the page <header>, styled exactly like the IR and KPI
 * tab rows so the whole portal navigates the same way.
 *
 * Gating matches the old sidebar: Log Risk, RTP Monitoring and Committees are
 * hospital-wide only (RC / Director / Admin); Register + Action Items show to
 * everyone with an account. The component resolves access itself so pages don't
 * have to pass it in. */
export type RiskTab = 'risk' | 'quickadd' | 'rtp' | 'actions' | 'committees' | 'bulkupload'

const badgeStyle: React.CSSProperties = {
  marginLeft: 2,
  fontSize: 10,
  fontWeight: 700,
  background: 'var(--amber)',
  color: '#fff',
  padding: '1px 6px',
  borderRadius: 99,
  lineHeight: 1.6,
}

export function RiskTabs({ active }: { active: RiskTab }) {
  const supabase = useMemo(() => createClient(), [])
  const [showGlobal, setShowGlobal] = useState(false)
  const [actionCount, setActionCount] = useState(0)
  const [draftCount, setDraftCount] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const access = await getModuleAccess(supabase)
        setShowGlobal(access.allModules)

        let q = supabase.from('risk_action_items')
          .select('id').in('status', ['PENDING', 'OVERDUE'])
        if (access.deptScopes !== null) {
          q = access.deptScopes.length
            ? q.overlaps('assigned_depts', access.deptScopes)
            : q.eq('id', -1)
        }
        const { data } = await q
        setActionCount((data ?? []).length)

        if (access.allModules) {
          const { data: drafts } = await supabase.from('risks').select('id')
            .eq('status', 'DRAFT').eq('entry_mode', 'rmcq_managed')
          setDraftCount((drafts ?? []).length)
        }
      } catch { /* leave hidden on error */ }
    })()
  }, [supabase])

  return (
    <nav className="tab-nav" role="tablist">
      <Link href="/risk" className={`tab-btn ${active === 'risk' ? 'active' : ''}`}>
        ⚠️ Register
      </Link>
      {showGlobal && (
        <Link href="/risk/quick-add"
          className={`tab-btn ${active === 'quickadd' ? 'active' : ''}`}
          title="Record a risk from a department's Form 0044 submission">
          📝 Log Risk
          {draftCount > 0 && (
            <span style={badgeStyle} title={`${draftCount} draft${draftCount === 1 ? '' : 's'} awaiting clarification from dept`}>
              {draftCount}
            </span>
          )}
        </Link>
      )}
      {showGlobal && (
        <Link href="/risk/rtp"
          className={`tab-btn ${active === 'rtp' ? 'active' : ''}`}
          title="Monitor whether departments have completed their Risk Treatment Plans">
          🎯 RTP Monitoring
        </Link>
      )}
      <Link href="/risk/actions" className={`tab-btn ${active === 'actions' ? 'active' : ''}`}>
        📌 Action Items
        {actionCount > 0 && <span style={badgeStyle}>{actionCount}</span>}
      </Link>
      {showGlobal && (
        <Link href="/risk/meetings" className={`tab-btn ${active === 'committees' ? 'active' : ''}`}>
          📋 Committees
        </Link>
      )}
    </nav>
  )
}
