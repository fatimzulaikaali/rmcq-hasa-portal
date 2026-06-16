/* Department sort helpers.
 *
 * Departments are presented in alphabetical order across every dept picker in
 * the Risk module. For names that follow the convention "Department of X" we
 * sort by X (so "Department of Anaesthesiology" comes before "Department of
 * Cardiology"), not by the literal "D" prefix that would dump every clinical
 * department under one letter. Names that don't follow that convention
 * (e.g. "Emergency Department", "Pharmacy") sort by their full name. */

/** The string used for ordering — the "Department of " prefix is stripped. */
export function deptAlphaKey(name: string): string {
  return name.replace(/^Department of\s+/i, '').toLowerCase().trim()
}

/** Returns a NEW array sorted alphabetically by the dept name (prefix-stripped). */
export function sortDeptsAlpha<T extends { name_en: string }>(depts: T[]): T[] {
  return [...depts].sort((a, b) => deptAlphaKey(a.name_en).localeCompare(deptAlphaKey(b.name_en)))
}
