'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentRiskUser } from '@/lib/risk/auth'
import {
  resolveActiveRole,
  setStoredActiveRole,
  roleKey,
  isGlobalRole,
  type RoleAssignment,
  type ActiveRole,
} from '@/lib/risk/activeRole'
import { RISK_ROLE_LABEL } from '@/lib/risk/scoring'

/* "Who's logged in" chip + role switcher for the Risk module topbars.
 *
 * A person can hold several roles (e.g. hospital-wide RC + RLO of Medicine).
 * They act as exactly ONE active role at a time; this chip shows the active
 * role and — if they hold more than one — opens a dropdown to switch. Picking
 * a different role persists the choice (localStorage) and reloads the page so
 * the whole module re-scopes to the new role. No sign-out required. */
export function RiskAccountChip() {
  const supabase = useMemo(() => createClient(), [])
  const [name, setName] = useState<string>('')
  const [roles, setRoles] = useState<RoleAssignment[]>([])
  const [deptNames, setDeptNames] = useState<Map<string, string>>(new Map())
  const [active, setActive] = useState<ActiveRole | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await resolveCurrentRiskUser(supabase)
      if (!res.ok) return
      const u = res.user
      setName(u.name)
      setRoles(u.roles)
      setActive(resolveActiveRole(u.roles))

      const deptCodes = Array.from(new Set(
        u.roles.map((r) => r.dept_code).filter((d): d is string => !!d),
      ))
      if (deptCodes.length > 0) {
        const { data } = await supabase
          .from('pscs_departments').select('code,name_en').in('code', deptCodes)
        const m = new Map<string, string>()
        for (const d of (data ?? []) as { code: string; name_en: string }[]) {
          m.set(d.code, d.name_en)
        }
        setDeptNames(m)
      }
    })()
  }, [supabase])

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!name) return null

  const labelFor = (r: RoleAssignment): string => {
    const role = RISK_ROLE_LABEL[r.role] ?? r.role
    if (isGlobalRole(r.role) || !r.dept_code) return role
    return `${role} — ${deptNames.get(r.dept_code) ?? r.dept_code}`
  }

  const canSwitch = roles.length > 1

  const switchTo = (r: RoleAssignment) => {
    if (active && roleKey(active) === roleKey(r)) {
      setOpen(false)
      return
    }
    setStoredActiveRole({ role: r.role, dept_code: r.dept_code })
    // Re-scope the entire module to the newly chosen role.
    window.location.reload()
  }

  return (
    <div className="account-chip-wrap" ref={rootRef}>
      <button
        type="button"
        className={`account-chip${canSwitch ? ' account-chip-btn' : ''}`}
        onClick={() => canSwitch && setOpen((v) => !v)}
        title={active ? labelFor(active) : name}
        aria-haspopup={canSwitch ? 'menu' : undefined}
        aria-expanded={canSwitch ? open : undefined}
      >
        <span className="account-chip-avatar">👤</span>
        <span className="account-chip-body">
          <span className="account-chip-name">{name}</span>
          {active && <span className="account-chip-role">{labelFor(active)}</span>}
        </span>
        {canSwitch && <span className="account-chip-caret">▾</span>}
      </button>

      {open && canSwitch && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">Switch role</div>
          {roles.map((r) => {
            const isActive = active && roleKey(active) === roleKey(r)
            return (
              <button
                key={roleKey(r)}
                type="button"
                role="menuitemradio"
                aria-checked={!!isActive}
                className={`account-menu-item${isActive ? ' is-active' : ''}`}
                onClick={() => switchTo(r)}
              >
                <span className="account-menu-check">{isActive ? '✓' : ''}</span>
                <span className="account-menu-label">{labelFor(r)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
