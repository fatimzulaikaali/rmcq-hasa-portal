/* Tiny client-side cache for "can this user see all modules?".
 *
 * The sidebar / tab bars gate the hospital-wide modules (IR / KPI / Safety
 * Culture / Accreditation) behind an async Supabase access check. Without a
 * cache, every page mount starts as "unknown" (false) and only fills in the
 * rest of the modules once the check returns — producing a ~0.5s flash where
 * only Home + Risk Register are visible.
 *
 * We remember the resolved answer in a module-level variable (survives
 * client-side <Link> navigation) and mirror it into sessionStorage (survives a
 * full page reload within the same tab). Components read it synchronously in
 * their useState initializer so the full sidebar renders immediately, then
 * revalidate in the background and update if anything changed. */
const KEY = 'rmcq_all_modules'

let cached: boolean | undefined

export function getCachedAllModules(): boolean | undefined {
  if (cached !== undefined) return cached
  if (typeof window !== 'undefined') {
    try {
      const v = window.sessionStorage.getItem(KEY)
      if (v === '1') return (cached = true)
      if (v === '0') return (cached = false)
    } catch { /* sessionStorage unavailable — fall through */ }
  }
  return undefined
}

export function setCachedAllModules(v: boolean): void {
  cached = v
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.setItem(KEY, v ? '1' : '0') } catch { /* ignore */ }
  }
}
