/* Risk module — auth + auto-link helpers.
 *
 * Each /risk page needs to:
 *   1) confirm the user is signed in via Supabase Auth
 *   2) find their risk_users row (by auth_user_id, falling back to email)
 *   3) on email-only match, UPDATE the row's auth_user_id so future requests
 *      hit the fast (indexed) auth_user_id path
 *   4) load their active roles + dept scopes
 *
 * The result of `resolveCurrentRiskUser()` is the shape every /risk page
 * needs at the top of `load()`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskRole } from './types'

export interface CurrentRiskUser {
  authUserId: string
  email: string
  riskUserId: number
  name: string
  roles: { role: RiskRole; dept_code: string | null }[]
}

export type ResolveResult =
  | { ok: true;  user: CurrentRiskUser }
  | { ok: false; reason: 'not_logged_in' | 'no_risk_user'; message: string }

export async function resolveCurrentRiskUser(
  supabase: SupabaseClient,
): Promise<ResolveResult> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { ok: false, reason: 'not_logged_in', message: 'Please sign in first.' }
  }

  // 1) Try the fast path — direct auth_user_id lookup
  let { data: ru } = await supabase
    .from('risk_users')
    .select('id, name, email, is_active, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // 2) Fallback — email match, then UPDATE auth_user_id for future visits
  if (!ru && user.email) {
    const { data: byEmail } = await supabase
      .from('risk_users')
      .select('id, name, email, is_active, auth_user_id')
      .eq('email', user.email)
      .maybeSingle()
    if (byEmail) {
      if (!byEmail.auth_user_id) {
        await supabase.from('risk_users')
          .update({ auth_user_id: user.id, last_login: new Date().toISOString() })
          .eq('id', byEmail.id)
      }
      ru = byEmail
    }
  } else if (ru) {
    // Cheap last_login bump — fire-and-forget
    void supabase.from('risk_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', ru.id)
  }

  if (!ru || !ru.is_active) {
    return {
      ok: false,
      reason: 'no_risk_user',
      message: 'You\'re signed in but don\'t have an active Risk module account. Ask the RMCQ administrator to add you.',
    }
  }

  // 3) Active role assignments
  const { data: rolesData } = await supabase
    .from('risk_user_roles')
    .select('role, dept_code, is_active')
    .eq('user_id', ru.id)
    .eq('is_active', true)
  const roles = (rolesData ?? []).map((r) => ({
    role: r.role as RiskRole,
    dept_code: (r.dept_code as string | null) ?? null,
  }))

  return {
    ok: true,
    user: {
      authUserId: user.id,
      email: ru.email,
      riskUserId: ru.id,
      name: ru.name,
      roles,
    },
  }
}

/* Convenience: is the user an admin (hospital-wide)? */
export function isAdmin(u: CurrentRiskUser): boolean {
  return u.roles.some((r) => r.role === 'ADMIN' || r.role === 'RC' || r.role === 'DIRECTOR')
}

/* Convenience: does this user have any role for the given dept? */
export function hasDeptAccess(u: CurrentRiskUser, deptCode: string): boolean {
  if (isAdmin(u)) return true
  return u.roles.some((r) => r.dept_code === null || r.dept_code === deptCode)
}

/* ---------- Module-level access ----------
 *
 * Rule for the portal:
 *   - Users with NO risk_users record at all: see every module (PSCS / IR / KPI
 *     legacy users — they predate the Risk module and are unrestricted).
 *   - Users WITH ADMIN / RC / DIRECTOR role: see every module + all dept data
 *     (RMCQ officers).
 *   - Users with only dept-scoped roles (RLO / HOD / ROC_MEMBER / RTC_MEMBER):
 *     restricted to the Risk module, scoped to their dept(s).
 */

export interface ModuleAccess {
  /** True if the user can see IR / KPI / PSCS / Upload. */
  allModules: boolean
  /**
   * Departments this user can see in the Risk module.
   *  - null  : hospital-wide (no restriction)
   *  - array : restricted to these dept codes
   */
  deptScopes: string[] | null
  /** The resolved risk user (null if no risk_users record exists). */
  riskUser: CurrentRiskUser | null
}

export async function getModuleAccess(supabase: SupabaseClient): Promise<ModuleAccess> {
  const res = await resolveCurrentRiskUser(supabase)
  if (!res.ok) {
    // User isn't tracked in risk_users — treat as legacy (no Risk module access,
    // but unrestricted on the other modules they were already using).
    return { allModules: true, deptScopes: null, riskUser: null }
  }
  const u = res.user
  if (isAdmin(u)) {
    return { allModules: true, deptScopes: null, riskUser: u }
  }
  // Dept-restricted user
  const scopes = u.roles
    .map((r) => r.dept_code)
    .filter((d): d is string => d !== null)
  return {
    allModules: false,
    deptScopes: Array.from(new Set(scopes)),
    riskUser: u,
  }
}
