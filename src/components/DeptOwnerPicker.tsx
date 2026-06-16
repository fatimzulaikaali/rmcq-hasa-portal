'use client'

import { useMemo } from 'react'
import { sortDeptsAlpha } from '@/lib/risk/sortDepts'

/* Multi-select picker for assigning one or more departments as the owner of a
 * risk's corrective action. Stores department CODES; renders names as chips.
 * Shared by the New Risk and Edit Risk forms. Options are alphabetised with
 * the "Department of " prefix stripped from the sort key. */
export function DeptOwnerPicker({ depts, value, onChange, busy }: {
  depts: { code: string; name_en: string }[]
  value: string[]
  onChange: (codes: string[]) => void
  busy?: boolean
}) {
  const add = (code: string) => { if (code && !value.includes(code)) onChange([...value, code]) }
  const remove = (code: string) => onChange(value.filter((c) => c !== code))
  const nameOf = (c: string) => depts.find((d) => d.code === c)?.name_en ?? c
  const sortedDepts = useMemo(() => sortDeptsAlpha(depts), [depts])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value="" disabled={busy}
        onChange={(e) => { add(e.target.value); e.currentTarget.selectedIndex = 0 }}>
        <option value="">+ add a department…</option>
        {sortedDepts.filter((d) => !value.includes(d.code)).map((d) => (
          <option key={d.code} value={d.code}>{d.name_en}</option>
        ))}
      </select>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {value.map((c) => (
            <button key={c} type="button" className="theme-pill active"
              onClick={() => remove(c)} title="Click to remove">{nameOf(c)} ×</button>
          ))}
        </div>
      )}
    </div>
  )
}
