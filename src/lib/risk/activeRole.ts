/* Active-role switching for the Risk module.
 *
 * A person can hold multiple roles (e.g. RLO of Medicine + hospital-wide RC).
 * Rather than acting as the union of all roles at once (confusing), the user
 * picks ONE active role and the whole module renders as that role. The choice
 * is stored per-browser in localStorage and survives navigation until they
 * switch again or log out.
 */

import type { RiskRole } from './types'

export interface RoleAssignment {
  role: RiskRole
  dept_code: string | null   // null = hospital-wide
}

export type ActiveRole = RoleAssignment

const STORAGE_KEY = 'risk_active_role'

/* Priority order — index 0 is highest privilege. Used to pick a sensible
 * default active role on first login. */
const PRIORITY: RiskRole[] = ['ADMIN', 'RC', 'DIRECTOR', 'HOD', 'RLO', 'RTC_MEMBER', 'ROC_MEMBER']

export function roleRank(role: RiskRole): number {
  const i = PRIORITY.indexOf(role)
  return i === -1 ? 99 : i
}

/* A stable key for a role assignment (role + dept). */
export function roleKey(r: RoleAssignment): string {
  return `${r.role}|${r.dept_code ?? '*'}`
}

/* Highest-privilege role the user holds (used as the default). */
export function pickDefaultRole(roles: RoleAssignment[]): ActiveRole | null {
  if (roles.length === 0) return null
  const sorted = [...roles].sort((a, b) =>
    roleRank(a.role) - roleRank(b.role) ||
    (a.dept_code === null ? -1 : b.dept_code === null ? 1 : a.dept_code.localeCompare(b.dept_code)))
  return { role: sorted[0].role, dept_code: sorted[0].dept_code }
}

export function getStoredActiveRole(): ActiveRole | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ActiveRole) : null
  } catch {
    return null
  }
}

export function setStoredActiveRole(r: ActiveRole): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r))
}

/* Resolve the role to act as: the stored choice if it's still one of the
 * user's current roles, otherwise the highest-privilege default. */
export function resolveActiveRole(roles: RoleAssignment[]): ActiveRole | null {
  const stored = getStoredActiveRole()
  if (stored && roles.some((r) => r.role === stored.role && r.dept_code === stored.dept_code)) {
    return stored
  }
  return pickDefaultRole(roles)
}

/* Does the active role count as hospital-wide (sees all modules + all depts)? */
export function isGlobalRole(role: RiskRole): boolean {
  return role === 'ADMIN' || role === 'RC' || role === 'DIRECTOR'
}
