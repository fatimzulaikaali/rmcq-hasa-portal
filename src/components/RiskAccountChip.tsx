'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentRiskUser } from '@/lib/risk/auth'

/* Small "who's logged in" chip for the Risk module topbars.
 * Shows the user's name + their role(s). Dept-scoped roles include the
 * department name; hospital-wide roles (dept_code null) show just the role. */
export function RiskAccountChip() {
  const supabase = useMemo(() => createClient(), [])
  const [name, setName] = useState<string>('')
  const [roleText, setRoleText] = useState<string>('')

  useEffect(() => {
    void (async () => {
      const res = await resolveCurrentRiskUser(supabase)
      if (!res.ok) return
      const u = res.user
      setName(u.name)

      const deptCodes = Array.from(new Set(
        u.roles.map((r) => r.dept_code).filter((d): d is string => !!d),
      ))
      const deptNames = new Map<string, string>()
      if (deptCodes.length > 0) {
        const { data } = await supabase
          .from('pscs_departments').select('code,name_en').in('code', deptCodes)
        for (const d of (data ?? []) as { code: string; name_en: string }[]) {
          deptNames.set(d.code, d.name_en)
        }
      }
      const parts = u.roles.map((r) =>
        r.dept_code ? `${r.role} (${deptNames.get(r.dept_code) ?? r.dept_code})` : r.role)
      setRoleText(parts.join(' · '))
    })()
  }, [supabase])

  if (!name) return null
  return (
    <div className="account-chip" title={`${name}${roleText ? ` — ${roleText}` : ''}`}>
      <span className="account-chip-avatar">👤</span>
      <span className="account-chip-body">
        <span className="account-chip-name">{name}</span>
        {roleText && <span className="account-chip-role">{roleText}</span>}
      </span>
    </div>
  )
}
