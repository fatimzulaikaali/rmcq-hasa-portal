'use client'

import { useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  KpiDefinition, KpiDataRow, KpiSiqRecord, Frequency, Period, TargetOperator, RiskLevel, SiqStatus,
  PERIODS, FREQUENCIES,
} from '@/lib/kpi/types'
import { scheduledPeriodsFor, computeAchievement, isOverdueDeadline, detectSiqTrigger } from '@/lib/kpi/dashboard-helpers'

/* Manual data-entry grid: pick a department, then a year-grid of its KPIs
 * (rows) x 12 months (columns). Only each KPI's scheduled periods are editable.
 * Officers type the result, Save upserts to kpi_data with recomputed achievement.
 * Officers can also add a new KPI or hide (soft-remove) an existing one. */

const OP_SYMBOL: Record<TargetOperator, string> = { '>=': '≥', '<=': '≤', '=': '=', '>': '>', '<': '<', '!=': '≠' }

function isPercentKpi(d: KpiDefinition): boolean {
  return /percentage|peratus|%/i.test(d.kpi_name) || (d.target ?? '').includes('%')
}
// A value that looks like a raw fraction (0.xx or a bare 1) on a percentage KPI is
// almost always a mis-entry for a percentage (e.g. 0.95 meant 95%).
function looksLikeRawFraction(v: string): boolean {
  const s = v.trim()
  if (!s || s.includes('%')) return false
  return /^0?\.\d+$/.test(s) || s === '1'
}

export function KpiDataEntry({
  supabase, defs, data, siq, year, onChanged, onGoToSiq,
}: {
  supabase: SupabaseClient
  defs: KpiDefinition[]
  data: KpiDataRow[]
  siq: KpiSiqRecord[]
  year: number
  onChanged: () => void
  onGoToSiq?: () => void
}) {
  // department options (from active defs)
  const deptOpts = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of defs) if (!m.has(d.dept_code)) m.set(d.dept_code, d.department ?? d.dept_code)
    return Array.from(m.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [defs])

  const [deptCode, setDeptCode] = useState<string>(deptOpts[0]?.code ?? '')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [siqFor, setSiqFor] = useState<KpiDefinition | null>(null)  // open the create-SIQ form for this KPI

  // latest SIQ record per KPI (to show a status chip and avoid confusion)
  const siqByKpi = useMemo(() => {
    const m = new Map<string, KpiSiqRecord>()
    for (const s of siq) if (s.kpi_id) m.set(s.kpi_id, s)
    return m
  }, [siq])

  const kpis = useMemo(
    () => defs.filter((d) => d.dept_code === deptCode).sort((a, b) => a.kpi_id.localeCompare(b.kpi_id)),
    [defs, deptCode],
  )

  // SIQ triggers (from saved data): a KPI whose consecutive Not-Achieved streak
  // has hit its threshold. Recomputed after each save/refresh.
  const triggered = useMemo(() => {
    const m = new Map<string, { period: string | null; streak: number }>()
    for (const d of kpis) {
      const t = detectSiqTrigger(d, data, year)
      if (t.triggered) m.set(d.kpi_id, { period: t.triggerPeriod, streak: t.consecutive })
    }
    return m
  }, [kpis, data, year])

  // saved results for this year: (kpi_id|period) -> result
  const saved = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of data) if (r.year === year) m.set(`${r.kpi_id}|${r.period}`, r.result ?? '')
    return m
  }, [data, year])

  const key = (kpiId: string, p: Period) => `${kpiId}|${p}`
  const cellVal = (kpiId: string, p: Period) => {
    const k = key(kpiId, p)
    return k in edits ? edits[k] : (saved.get(k) ?? '')
  }
  const setCell = (kpiId: string, p: Period, v: string) => setEdits((e) => ({ ...e, [key(kpiId, p)]: v }))

  const editCount = Object.keys(edits).filter((k) => (edits[k] ?? '') !== (saved.get(k) ?? '')).length
  const today = new Date()

  async function saveAll() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const { data: u } = await supabase.auth.getUser()
      const uid = u?.user?.id ?? null
      const rows = Object.entries(edits)
        .filter(([k, v]) => (v ?? '') !== (saved.get(k) ?? ''))
        .map(([k, v]) => {
          const [kpiId, period] = k.split('|')
          const def = defs.find((d) => d.kpi_id === kpiId)!
          const result = v.trim() === '' ? null : v.trim()
          return {
            kpi_id: kpiId,
            year,
            period,
            period_order: PERIODS.indexOf(period as Period) + 1,
            result,
            achievement_status: computeAchievement(result, def.target_operator, def.target_value),
            submitted_at: result ? new Date().toISOString() : null,
            submitted_by: result ? uid : null,
          }
        })
      if (rows.length === 0) { setBusy(false); return }
      const { error } = await supabase.from('kpi_data').upsert(rows, { onConflict: 'kpi_id,year,period' })
      if (error) { setErr(error.message); setBusy(false); return }
      setEdits({}); setMsg(`Saved ${rows.length} value${rows.length === 1 ? '' : 's'}.`)
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }

  async function hideKpi(d: KpiDefinition) {
    if (!confirm(`Hide "${d.kpi_name}"?\n\nIt will disappear from the lists but its history is kept and can be restored.`)) return
    const { error } = await supabase.from('kpi_definitions').update({ active: false }).eq('kpi_id', d.kpi_id)
    if (error) { setErr(error.message); return }
    onChanged()
  }

  return (
    <div className="kpi-entry">
      <div className="de-bar">
        <label className="de-lbl">Department</label>
        <select value={deptCode} onChange={(e) => { setDeptCode(e.target.value); setEdits({}); setMsg('') }}>
          {deptOpts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="de-btn" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ Add KPI'}</button>
        <button type="button" className="de-btn primary" disabled={busy || editCount === 0} onClick={saveAll}>
          {busy ? 'Saving…' : editCount > 0 ? `Save ${editCount} change${editCount === 1 ? '' : 's'}` : 'Saved'}
        </button>
      </div>

      {err && <div className="de-alert err">{err}</div>}
      {msg && <div className="de-alert ok">{msg}</div>}

      {triggered.size > 0 && (
        <div className="de-siq-banner">
          <span>⚠️ <b>{triggered.size}</b> KPI{triggered.size === 1 ? ' has' : 's have'} triggered an SIQ in this department (consecutive months below target).</span>
          {onGoToSiq && <button type="button" className="de-siq-link" onClick={onGoToSiq}>Open SIQ Tracker →</button>}
        </div>
      )}

      {adding && (
        <AddKpi
          supabase={supabase}
          deptCode={deptCode}
          deptName={deptOpts.find((o) => o.code === deptCode)?.name ?? deptCode}
          existingIds={defs.map((d) => d.kpi_id)}
          onDone={() => { setAdding(false); onChanged() }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="de-note">
        Enter results in the KPI&apos;s own reporting months only (other cells are greyed). Percentages should be typed
        <b> with the % sign</b> (e.g. <code>95%</code>). A red cell means the value looks like a raw fraction (e.g. 0.95) —
        it should probably be a percentage.
      </div>

      <div className="de-scroll">
        <table className="de-table">
          <thead>
            <tr>
              <th className="de-kpi-col">KPI</th>
              <th>Target</th>
              <th>Freq</th>
              {PERIODS.map((p) => <th key={p}>{p}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {kpis.length === 0 && (
              <tr><td colSpan={PERIODS.length + 4} className="de-empty">No KPIs for this department yet. Use “+ Add KPI”.</td></tr>
            )}
            {kpis.map((d) => {
              const sched = new Set(scheduledPeriodsFor(d.frequency))
              return (
                <tr key={d.kpi_id} className={triggered.has(d.kpi_id) ? 'de-row-siq' : ''}>
                  <td className="de-kpi-col" title={d.kpi_name}>
                    {d.kpi_name}
                    {triggered.has(d.kpi_id) && (
                      <button type="button" className="de-siq-pill" title="SIQ triggered — open SIQ Tracker" onClick={() => onGoToSiq?.()}>
                        ⚠ SIQ
                      </button>
                    )}
                  </td>
                  <td className="de-mono">{d.target ?? '—'}</td>
                  <td className="de-freq">{d.frequency[0]}</td>
                  {PERIODS.map((p) => {
                    if (!sched.has(p)) return <td key={p} className="de-cell off">·</td>
                    const v = cellVal(d.kpi_id, p)
                    const overdueEmpty = v.trim() === '' && isOverdueDeadline(year, p, today)
                    const badFraction = isPercentKpi(d) && looksLikeRawFraction(v)
                    return (
                      <td key={p} className="de-cell">
                        <input
                          value={v}
                          onChange={(e) => setCell(d.kpi_id, p, e.target.value)}
                          className={`de-in${badFraction ? ' bad' : ''}${overdueEmpty ? ' due' : ''}`}
                          placeholder={overdueEmpty ? 'due' : ''}
                        />
                      </td>
                    )
                  })}
                  <td className="de-actions">
                    {siqByKpi.has(d.kpi_id) && (
                      <button type="button" className={`de-siq-chip s-${(siqByKpi.get(d.kpi_id)!.status ?? 'Open').replace(/\s+/g, '-').toLowerCase()}`}
                        title="View in SIQ Tracker" onClick={() => onGoToSiq?.()}>
                        SIQ: {siqByKpi.get(d.kpi_id)!.status ?? 'Open'}
                      </button>
                    )}
                    <button type="button" className="de-siq-add" title="Open a new SIQ for this KPI" onClick={() => setSiqFor(d)}>+ SIQ</button>
                    <button type="button" className="de-x" title="Hide this KPI" onClick={() => hideKpi(d)}>✕</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {siqFor && (
        <SiqForm
          supabase={supabase}
          def={siqFor}
          year={year}
          trigger={triggered.get(siqFor.kpi_id) ?? null}
          existingCount={siq.filter((s) => s.trigger_year === year).length}
          onDone={() => { setSiqFor(null); setMsg('SIQ created — see the SIQ Tracker tab.'); onChanged() }}
          onCancel={() => setSiqFor(null)}
        />
      )}
    </div>
  )
}

/* ---- Create-a-new-SIQ modal (writes to kpi_siq_records → shows in SIQ Tracker) ---- */
const RISK_LEVELS: RiskLevel[] = ['Low', 'Moderate', 'High', 'Extreme']
const SIQ_STATUSES: SiqStatus[] = ['Open', 'In Progress', 'Pending Department Feedback', 'Closed']

function SiqForm({
  supabase, def, year, trigger, existingCount, onDone, onCancel,
}: {
  supabase: SupabaseClient
  def: KpiDefinition
  year: number
  trigger: { period: string | null; streak: number } | null
  existingCount: number
  onDone: () => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [owner, setOwner] = useState('')
  const [risk, setRisk] = useState<RiskLevel>('Moderate')
  const [status, setStatus] = useState<SiqStatus>('Open')
  const [dateIssued, setDateIssued] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [actionPlan, setActionPlan] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setBusy(true); setErr('')
    const siqId = `SIQ/${year}/${String(existingCount + 1).padStart(3, '0')}`
    const { error } = await supabase.from('kpi_siq_records').insert({
      siq_id: siqId,
      kpi_id: def.kpi_id,
      website_kpi_id: def.website_kpi_id,
      dept_code: def.dept_code,
      department: def.department,
      kpi_name: def.kpi_name,
      frequency: def.frequency,
      trigger_year: year,
      trigger_period: trigger?.period ?? null,
      trigger_basis: trigger ? `${trigger.streak} consecutive Not Achieved` : 'Manually opened',
      date_issued: dateIssued || null,
      due_date: dueDate || null,
      owner: owner.trim() || null,
      risk_level: risk,
      status,
      action_plan: actionPlan.trim() || null,
      remarks: remarks.trim() || null,
    })
    if (error) { setErr(error.message); setBusy(false); return }
    onDone()
  }

  return (
    <div className="de-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="de-modal">
        <div className="de-modal-head">
          <div>
            <div className="de-modal-title">Open SIQ</div>
            <div className="de-modal-sub">{def.kpi_name}</div>
          </div>
          <button type="button" className="de-x" onClick={onCancel}>✕</button>
        </div>
        {err && <div className="de-alert err">{err}</div>}
        {trigger && <div className="de-note">Triggered at <b>{trigger.period}</b> · {trigger.streak} consecutive Not Achieved.</div>}
        <div className="de-add-grid">
          <label className="de-field"><span>Owner (PIC)</span><input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Name / role" /></label>
          <label className="de-field"><span>Risk level</span><select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)}>{RISK_LEVELS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="de-field"><span>Date issued</span><input type="date" value={dateIssued} onChange={(e) => setDateIssued(e.target.value)} /></label>
          <label className="de-field"><span>Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <label className="de-field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value as SiqStatus)}>{SIQ_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="de-field" style={{ marginTop: 8 }}><span>Action plan</span>
          <textarea rows={3} value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} placeholder="Corrective / improvement actions" />
        </label>
        <label className="de-field" style={{ marginTop: 8 }}><span>Remarks</span>
          <textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
        <div className="de-add-nav">
          <button type="button" className="de-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="de-btn primary" disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create SIQ'}</button>
        </div>
      </div>
    </div>
  )
}

/* ---- Add-new-KPI inline form ---- */
function AddKpi({
  supabase, deptCode, deptName, existingIds, onDone, onCancel,
}: {
  supabase: SupabaseClient
  deptCode: string
  deptName: string
  existingIds: string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [freq, setFreq] = useState<Frequency>('Monthly')
  const [op, setOp] = useState<TargetOperator>('>=')
  const [val, setVal] = useState('')
  const [unit, setUnit] = useState<'%' | ''>('%')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!name.trim()) { setErr('KPI name is required.'); return }
    if (val.trim() === '' || Number.isNaN(Number(val))) { setErr('Target value must be a number.'); return }
    setBusy(true); setErr('')
    // unique kpi_id
    let kpiId = `${deptCode}-U${Date.now().toString(36).toUpperCase()}`
    while (existingIds.includes(kpiId)) kpiId += 'X'
    const target = `${OP_SYMBOL[op]}${val.trim()}${unit}`
    const { error } = await supabase.from('kpi_definitions').insert({
      kpi_id: kpiId,
      website_kpi_id: null,
      dept_code: deptCode,
      department: deptName,
      kpi_name: name.trim(),
      target,
      frequency: freq,
      siq_trigger_consecutive: freq === 'Monthly' ? 3 : freq === 'Quarterly' ? 2 : 1,
      target_operator: op,
      target_value: Number(val),
      scheduled_periods: scheduledPeriodsFor(freq).join(', '),
      active: true,
    })
    if (error) { setErr(error.message); setBusy(false); return }
    onDone()
  }

  return (
    <div className="de-add">
      {err && <div className="de-alert err">{err}</div>}
      <div className="de-add-grid">
        <label className="de-field" style={{ gridColumn: '1 / -1' }}>
          <span>KPI name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Percentage of reports issued within 24 hours" />
        </label>
        <label className="de-field"><span>Frequency</span>
          <select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>{FREQUENCIES.map((f) => <option key={f}>{f}</option>)}</select>
        </label>
        <label className="de-field"><span>Target</span>
          <select value={op} onChange={(e) => setOp(e.target.value as TargetOperator)}>
            {(Object.keys(OP_SYMBOL) as TargetOperator[]).map((o) => <option key={o} value={o}>{OP_SYMBOL[o]}</option>)}
          </select>
        </label>
        <label className="de-field"><span>Value</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="90" inputMode="decimal" />
        </label>
        <label className="de-field"><span>Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as '%' | '')}><option value="%">%</option><option value="">count / number</option></select>
        </label>
      </div>
      <div className="de-add-nav">
        <button type="button" className="de-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="de-btn primary" disabled={busy} onClick={save}>{busy ? 'Adding…' : 'Add KPI'}</button>
      </div>
    </div>
  )
}
