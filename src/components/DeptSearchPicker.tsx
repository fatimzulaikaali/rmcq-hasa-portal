'use client'

/* Single-dept picker with type-to-search.
 *
 * Wraps a text input + native <datalist> so the user can type the start of
 * the dept name to filter. The displayed/typed value is the dept's full name,
 * but the value flowing to onChange is the dept CODE — so callers can store
 * the code while the user works in human-readable terms. Departments are
 * sorted alphabetically with "Department of " stripped from the sort key. */

import { useEffect, useId, useMemo, useState } from 'react'
import { sortDeptsAlpha } from '@/lib/risk/sortDepts'

export function DeptSearchPicker({
  depts, value, onChange, placeholder, disabled, allowEmpty,
}: {
  depts: { code: string; name_en: string }[]
  /** The currently-selected dept code (or '' for none). */
  value: string
  /** Called when the user picks a matching dept name. Receives the dept code. */
  onChange: (code: string) => void
  placeholder?: string
  disabled?: boolean
  /** If true, clearing the input fires onChange('') instead of reverting. */
  allowEmpty?: boolean
}) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const listId = `dept-pick-${reactId}`

  const sortedDepts = useMemo(() => sortDeptsAlpha(depts), [depts])
  const selectedName = useMemo(
    () => depts.find((d) => d.code === value)?.name_en ?? '',
    [depts, value],
  )

  // Mirror the external selection in local input state so the user can type
  // freely without each keystroke racing back through the parent.
  const [input, setInput] = useState(selectedName)
  useEffect(() => { setInput(selectedName) }, [selectedName])

  return (
    <>
      <input type="text"
        list={listId}
        value={input}
        disabled={disabled}
        placeholder={placeholder ?? 'Type to search a department…'}
        onChange={(e) => {
          const v = e.target.value
          setInput(v)
          const matched = depts.find((d) => d.name_en === v)
          if (matched) onChange(matched.code)
          else if (v === '' && allowEmpty) onChange('')
        }}
        onBlur={() => {
          // If the user wandered off without picking a real dept name, revert
          // the input to the last valid selection so we never end up with a
          // stale free-text value the parent can't act on.
          if (!depts.find((d) => d.name_en === input)) {
            setInput(selectedName)
          }
        }} />
      <datalist id={listId}>
        {sortedDepts.map((d) => <option key={d.code} value={d.name_en} />)}
      </datalist>
    </>
  )
}
