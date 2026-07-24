'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PortalNav } from '@/components/PortalNav'
import { MmCaseForm } from '@/components/mm/MmCaseForm'
import { MmCaseView } from '@/components/mm/MmCaseView'
import {
  MM_STATUSES, MM_SHORTFALLS, pi01, coverageColor, effectiveActionStatus, isDocumented, nextCaseNo,
  type MmCase, type MmDepartment, type MmCaseShortfall, type MmAction,
} from '@/lib/mm/types'

type Tab = 'dash' | 'reg' | 'act' | 'msqh'
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'dash', icon: '📊', label: 'Dashboard' },
  { id: 'reg', icon: '▤', label: 'Case Register' },
  { id: 'act', icon: '✔', label: 'Action Plan Audit' },
  { id: 'msqh', icon: '◆', label: 'MSQH Reporting' },
]

const S1 = '#2a78d6', S4 = '#eda100', S8 = '#e34948'
const GOOD = '#0ca30c', CRIT = '#d03b3b'

function statusBadge(s: string) {
  const m: Record<string, string> = { 'Untriaged': 'b-crit', 'No review': 'b-neut', 'Dept review': 'b-blue', 'HOD verified': 'b-info', 'Hospital-level': 'b-warn', 'Actions open': 'b-warn', 'Closed': 'b-good' }
  return <span className={`badge ${m[s] ?? 'b-neut'}`}>{s}</span>
}

export default function MmPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<Tab>('dash')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [departments, setDepartments] = useState<MmDepartment[]>([])
  const [cases, setCases] = useState<MmCase[]>([])
  const [shortfalls, setShortfalls] = useState<MmCaseShortfall[]>([])
  const [actions, setActions] = useState<MmAction[]>([])

  const [fDept, setFDept] = useState(''); const [fType, setFType] = useState(''); const [fStatus, setFStatus] = useState('')
  const [modal, setModal] = useState<{ mode: 'view' | 'edit' | 'new'; caseId?: number } | null>(null)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.replace('/login'); return }
    try {
      const [dp, cs, sf, ac] = await Promise.all([
        supabase.from('mm_departments').select('*').eq('active', true).order('sort_order'),
        supabase.from('mm_cases').select('*').order('report_date', { ascending: false, nullsFirst: false }).order('id', { ascending: false }),
        supabase.from('mm_case_shortfalls').select('*'),
        supabase.from('mm_actions').select('*'),
      ])
      const firstError = [dp.error, cs.error, sf.error, ac.error].find((e) => e)
      if (firstError) { setLoadError(firstError.message); setLoading(false); return }
      setDepartments((dp.data ?? []) as MmDepartment[])
      setCases((cs.data ?? []) as MmCase[])
      setShortfalls((sf.data ?? []) as MmCaseShortfall[])
      setActions((ac.data ?? []) as MmAction[])
      setLoading(false)
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Load failed'); setLoading(false) }
  }
  useEffect(() => {
    void load()
    // load() is stable for the page's lifetime; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deptName = (code: string | null) => departments.find((d) => d.code === code)?.name ?? code ?? '—'

  /* ---- aggregates ---- */
  const agg = useMemo(() => {
    const mort = cases.filter((c) => c.report_type === 'Mortality')
    const inpatientDeaths = mort.filter((c) => !c.is_bid)
    const bid = mort.filter((c) => c.is_bid)
    const reviewed = cases.filter((c) => c.gate1_dept_meeting_required === true && (c.category_of_death || c.meeting_date))
    const preventable = reviewed.filter((c) => c.category_of_death === 'Preventable').length
    const documented = cases.filter(isDocumented).length
    const reviewRate = cases.length ? Math.round((documented / cases.length) * 100) : 0
    const openActions = actions.filter((a) => effectiveActionStatus(a) !== 'Completed')
    const overdue = actions.filter((a) => effectiveActionStatus(a) === 'Overdue').length
    return {
      totalDeaths: inpatientDeaths.length, bid: bid.length, reviewedN: reviewed.length,
      preventable, reviewRate, openActions: openActions.length, overdue,
      catCounts: {
        np: reviewed.filter((c) => c.category_of_death === 'Non-preventable').length,
        un: reviewed.filter((c) => c.category_of_death === 'Undetermined').length,
        pv: preventable,
      },
    }
  }, [cases, actions])

  const shortfallCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of shortfalls) m[s.shortfall] = (m[s.shortfall] ?? 0) + 1
    return MM_SHORTFALLS.map((n) => ({ n, v: m[n] ?? 0 })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
  }, [shortfalls])

  const deathsByDept = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of cases) if (c.report_type === 'Mortality' && !c.is_bid && c.dept_code) m[c.dept_code] = (m[c.dept_code] ?? 0) + 1
    return Object.entries(m).map(([code, v]) => ({ n: deptName(code), v })).sort((a, b) => b.v - a.v).slice(0, 10)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cases, departments])

  const perDept = useMemo(() => departments.map((d) => {
    const cs = cases.filter((c) => c.dept_code === d.code)
    const m = pi01(cs, 'Mortality'), b = pi01(cs, 'Morbidity')
    const untriaged = cs.filter((c) => c.status === 'Untriaged').length
    return { d, m, b, untriaged, total: cs.length }
  }).filter((r) => r.total > 0), [departments, cases])

  const piMort = useMemo(() => pi01(cases, 'Mortality'), [cases])
  const piMorb = useMemo(() => pi01(cases, 'Morbidity'), [cases])

  const filteredCases = cases.filter((c) =>
    (!fDept || c.dept_code === fDept) && (!fType || c.report_type === fType) && (!fStatus || c.status === fStatus))

  const actionStats = useMemo(() => {
    const eff = actions.map((a) => ({ a, s: effectiveActionStatus(a) }))
    return {
      open: eff.filter((x) => x.s !== 'Completed').length,
      overdue: eff.filter((x) => x.s === 'Overdue').length,
      system: actions.filter((a) => a.action_level === 'System').length,
      completed: eff.filter((x) => x.s === 'Completed').length,
    }
  }, [actions])

  const recurrence = useMemo(() => {
    const byShort: Record<string, Set<string>> = {}
    for (const s of shortfalls) {
      const c = cases.find((x) => x.id === s.case_id)
      if (!c) continue
      byShort[s.shortfall] = byShort[s.shortfall] ?? new Set()
      byShort[s.shortfall].add(c.dept_code ?? '?')
    }
    const counts: Record<string, number> = {}
    for (const s of shortfalls) counts[s.shortfall] = (counts[s.shortfall] ?? 0) + 1
    const top = Object.entries(counts).map(([sf, n]) => ({ sf, n, depts: byShort[sf]?.size ?? 0 }))
      .filter((r) => r.n >= 3).sort((a, b) => b.n - a.n)[0]
    return top
  }, [shortfalls, cases])

  function openView(id: number) { setModal({ mode: 'view', caseId: id }); window.scrollTo({ top: 0 }) }
  const modalCase = modal?.caseId ? cases.find((c) => c.id === modal.caseId) ?? null : null
  const modalShorts = modal?.caseId ? shortfalls.filter((s) => s.case_id === modal.caseId) : []
  const modalActions = modal?.caseId ? actions.filter((a) => a.case_id === modal.caseId) : []

  const gauge = (p: number, label: string) => {
    const r = 46, c = 2 * Math.PI * r, off = c * (1 - p / 100)
    const pass = p >= 30, col = pass ? GOOD : (p >= 18 ? '#c98500' : CRIT)
    return (
      <div className="mm-gauge">
        <svg width="112" height="112" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r={r} fill="none" stroke="#e6e6e0" strokeWidth="11" />
          <circle cx="56" cy="56" r={r} fill="none" stroke={col} strokeWidth="11" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 56 56)" />
          <text x="56" y="53" textAnchor="middle" fontSize="23" fontWeight="700" fill="#1F2430" fontFamily="Fredoka">{p}%</text>
          <text x="56" y="71" textAnchor="middle" fontSize="10" fill="#6B7280">of cases</text>
        </svg>
        <div className="cap">{label}<b style={{ color: col }}>{pass ? '✔ Meets ≥30%' : '✗ Below target'}</b></div>
      </div>
    )
  }
  const bar = (rows: { n: string; v: number }[], color: string) => {
    const mx = Math.max(1, ...rows.map((r) => r.v))
    return rows.map((r) => (
      <div className="bar-row" key={r.n}><div className="name" title={r.n}>{r.n}</div>
        <div className="track"><div className="fill" style={{ width: `${(r.v / mx) * 100}%`, background: color }} /></div>
        <div className="num">{r.v}</div></div>
    ))
  }
  const covBar = (rows: { n: string; v: number }[]) => rows.map((r) => {
    const col = coverageColor(r.v)
    return (
      <div className="bar-row" key={r.n}><div className="name" title={r.n}>{r.n}</div>
        <div className="track"><div className="fill" style={{ width: `${Math.min(r.v, 100)}%`, background: col }} /><div className="target-line" style={{ left: '30%' }} /></div>
        <div className="num" style={{ color: col }}>{r.v}%</div></div>
    )
  })

  const empty = !loading && !loadError && cases.length === 0

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar"><PortalNav active="mm" /></aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div style={{ minWidth: 0 }}>
              <div className="tb-title">M&amp;M Monitoring</div>
              <div className="tb-meta">Mortality &amp; Morbidity · Hospital Al-Sultan Abdullah UiTM</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="rec-badge">{loading ? 'Loading…' : `${cases.length} case${cases.length === 1 ? '' : 's'}`}</div>
            <button type="button" className="mm-btn primary" onClick={() => setModal({ mode: 'new' })}>+ New case</button>
          </div>
        </header>

        <nav className="tab-nav" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
              className={`tab-btn ${tab === x.id ? 'active' : ''}`} onClick={() => { setTab(x.id); setSidebarOpen(false) }}>{x.icon} {x.label}</button>
          ))}
        </nav>

        <main className="tab-pane">
          {loading && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>}
          {!loading && loadError && <div className="ac red"><div className="ai">⚠️</div><div><div className="at">Could not load</div><div className="as">{loadError}</div></div></div>}

          {empty && (
            <div className="card">
              <h3 className="vd-h">No cases yet</h3>
              <p className="vd-sub">Add the first M&amp;M case with <b>+ New case</b>, or import the monthly mortality list. Cases are de-identified — no patient name or NRIC is stored.</p>
            </div>
          )}

          {!loading && !loadError && cases.length > 0 && (
            <>
              {/* ---------------- DASHBOARD ---------------- */}
              {tab === 'dash' && (
                <>
                  <div className="banner"><span>ℹ️</span><div><b>How to read this:</b> every death must reach a documented disposition. The MSQH PI 01 gauges track the mandatory ≥30% target for mortalities and morbidities, computed separately.</div></div>
                  <div className="tiles">
                    <div className="tile"><div className="lab">Inpatient deaths</div><div className="val">{agg.totalDeaths}</div><div className="delta flat">+ {agg.bid} BID reported separately</div></div>
                    <div className="tile"><div className="lab">Documented / reviewed</div><div className="val">{agg.reviewRate}<small>%</small></div><div className="delta flat">of all cases</div></div>
                    <div className="tile"><div className="lab">Preventable</div><div className="val">{agg.preventable} <small>/ {agg.reviewedN} reviewed</small></div></div>
                    <div className="tile"><div className="lab">Overdue actions</div><div className="val" style={agg.overdue ? { color: CRIT } : undefined}>{agg.overdue} <small>/ {agg.openActions} open</small></div></div>
                  </div>
                  <div className="grid3">
                    <div className="card"><h3 className="vd-h">MSQH PI 01 — Coverage vs Target (≥ 30%)</h3><p className="vd-sub">Mortality &amp; morbidity computed separately. Mortality denominator excludes BID.</p>
                      <div className="mm-gauges">{gauge(piMort.pct, 'Mortality')}{gauge(piMorb.pct, 'Morbidity')}</div></div>
                    <div className="card"><h3 className="vd-h">Category of death</h3><p className="vd-sub">Of {agg.reviewedN} reviewed cases</p>
                      <div className="mm-catlist">
                        <div><span className="dot" style={{ background: S1 }} /> Non-preventable — {agg.catCounts.np}</div>
                        <div><span className="dot" style={{ background: S4 }} /> Undetermined — {agg.catCounts.un}</div>
                        <div><span className="dot" style={{ background: S8 }} /> Preventable — {agg.catCounts.pv}</div>
                      </div></div>
                  </div>
                  <div className="grid2">
                    <div className="card"><h3 className="vd-h">Contributing factors (shortfalls)</h3><p className="vd-sub">Ranked across reviewed cases</p>
                      {shortfallCounts.length ? bar(shortfallCounts, S1) : <div className="vd-sub">None recorded yet.</div>}</div>
                    <div className="card"><h3 className="vd-h">Deaths by department</h3><p className="vd-sub">Inpatient deaths, excluding BID</p>
                      {deathsByDept.length ? bar(deathsByDept, S1) : <div className="vd-sub">None recorded yet.</div>}</div>
                  </div>
                  <div className="card"><h3 className="vd-h">Compliance by department</h3><p className="vd-sub">PI 01 mortality coverage vs 30%, untriaged cases.</p>
                    <div className="vd-scroll"><table className="vd-table">
                      <thead><tr><th>Department</th><th>Cases</th><th>Mort. num/den</th><th>PI 01 (mort.)</th><th>Untriaged</th></tr></thead>
                      <tbody>{perDept.map((r) => (
                        <tr key={r.d.code}><td><b>{r.d.name}</b></td><td>{r.total}</td><td>{r.m.num}/{r.m.den}</td>
                          <td><b style={{ color: coverageColor(r.m.pct) }}>{r.m.den ? `${r.m.pct}%` : '—'}</b></td>
                          <td>{r.untriaged > 0 ? <span className="badge b-crit">{r.untriaged}</span> : '0'}</td></tr>
                      ))}</tbody>
                    </table></div></div>
                </>
              )}

              {/* ---------------- REGISTER ---------------- */}
              {tab === 'reg' && (
                <>
                  <div className="banner"><span>ℹ️</span><div>Every death enters here as a de-identified case (keyed by case number). Cases with no disposition are your compliance gap. Click a case to open its workflow.</div></div>
                  <div className="mm-filters">
                    <select value={fDept} onChange={(e) => setFDept(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</select>
                    <select value={fType} onChange={(e) => setFType(e.target.value)}><option value="">All types</option><option>Mortality</option><option>Morbidity</option></select>
                    <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">All statuses</option>{MM_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                  </div>
                  <div className="card" style={{ padding: '6px 16px 10px' }}><div className="vd-scroll"><table className="vd-table">
                    <thead><tr><th>Case No</th><th>Dept</th><th>Type</th><th>Age/Sex</th><th>Ward</th><th>Category</th><th>Status</th></tr></thead>
                    <tbody>{filteredCases.map((c) => (
                      <tr key={c.id} className="mm-rowlink" onClick={() => openView(c.id)}>
                        <td><b>{c.case_no}</b></td><td>{deptName(c.dept_code)}</td><td>{c.report_type}</td>
                        <td>{c.age ?? '<1'} / {c.sex ?? '?'}</td><td>{c.ward ?? '—'}</td><td>{c.category_of_death ?? '—'}</td><td>{statusBadge(c.status)}</td></tr>
                    ))}</tbody>
                  </table></div></div>
                </>
              )}

              {/* ---------------- ACTIONS ---------------- */}
              {tab === 'act' && (
                <>
                  <div className="banner"><span>ℹ️</span><div><b>The audit engine.</b> Each action carries an owner, due date and status. Overdue items flag automatically; recurring shortfalls are surfaced so you can see when a fix did not hold.</div></div>
                  <div className="tiles">
                    <div className="tile"><div className="lab">Open actions</div><div className="val">{actionStats.open}</div></div>
                    <div className="tile"><div className="lab">Overdue</div><div className="val" style={actionStats.overdue ? { color: CRIT } : undefined}>{actionStats.overdue}</div></div>
                    <div className="tile"><div className="lab">System-level</div><div className="val">{actionStats.system} <small>/ {actions.length}</small></div></div>
                    <div className="tile"><div className="lab">Completed</div><div className="val">{actionStats.completed}</div></div>
                  </div>
                  {recurrence && (
                    <div className="card"><h3 className="vd-h">⚠ Recurring shortfall detected</h3>
                      <p className="vd-sub" style={{ margin: 0 }}>&quot;{recurrence.sf}&quot; has appeared in <b>{recurrence.n} cases</b> across {recurrence.depts} department{recurrence.depts === 1 ? '' : 's'} — the strongest signal a previous action plan has not held. Consider a hospital-level systemic review.</p></div>
                  )}
                  <div className="card" style={{ padding: '6px 16px 10px' }}><div className="vd-scroll"><table className="vd-table">
                    <thead><tr><th>Action</th><th>Owner</th><th>Case</th><th>Level</th><th>Type</th><th>Due</th><th>Status</th></tr></thead>
                    <tbody>{actions.map((a) => {
                      const st = effectiveActionStatus(a)
                      const sb: Record<string, string> = { Overdue: 'b-crit', 'In progress': 'b-warn', Open: 'b-neut', Completed: 'b-good' }
                      const cn = cases.find((c) => c.id === a.case_id)?.case_no ?? a.case_id
                      return (
                        <tr key={a.id}><td><b>{a.description}</b>{a.linked_shortfall && <><br /><span className={`chip ${a.linked_shortfall.includes('referral') ? 'bad' : ''}`}>↳ {a.linked_shortfall}</span></>}</td>
                          <td>{a.responsible ?? '—'}</td><td>{cn}</td><td><span className={`badge ${a.action_level === 'System' ? 'b-blue' : 'b-neut'}`}>{a.action_level ?? '—'}</span></td>
                          <td>{a.action_type ?? '—'}</td><td>{a.due_date ?? '—'}</td><td><span className={`badge ${sb[st]}`}>{st}</span></td></tr>
                      )
                    })}</tbody>
                  </table></div></div>
                </>
              )}

              {/* ---------------- MSQH ---------------- */}
              {tab === 'msqh' && (
                <>
                  <div className="banner"><span>◆</span><div><b>MSQH 7th Edition — PI 01 (Mandatory).</b> Cases discussed &amp; documented ÷ total × 100. Target ≥ 30%. Documented = minutes + attendance list + certification. This page is your accreditation return.</div></div>
                  <div className="tiles" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                    <div className="tile"><div className="lab">PI 01 — Mortality (hospital-wide)</div><div className="val" style={{ color: coverageColor(piMort.pct) }}>{piMort.pct}%</div><div className="delta flat">{piMort.num}/{piMort.den} · target ≥30%</div></div>
                    <div className="tile"><div className="lab">PI 01 — Morbidity (hospital-wide)</div><div className="val" style={{ color: coverageColor(piMorb.pct) }}>{piMorb.pct}%</div><div className="delta flat">{piMorb.num}/{piMorb.den} · target ≥30%</div></div>
                  </div>
                  <div className="grid2">
                    <div className="card"><h3 className="vd-h">PI 01 — Mortality coverage by department</h3><p className="vd-sub">target line at 30%</p>{covBar(perDept.map((r) => ({ n: r.d.name, v: r.m.pct })))}</div>
                    <div className="card"><h3 className="vd-h">PI 01 — Morbidity coverage by department</h3><p className="vd-sub">target line at 30%</p>{covBar(perDept.filter((r) => r.b.den > 0).map((r) => ({ n: r.d.name, v: r.b.pct })))}</div>
                  </div>
                  <div className="card"><h3 className="vd-h">PI 01 return — documentation evidence</h3><p className="vd-sub">A case counts toward the numerator only when minutes + attendance are on file.</p>
                    <div className="vd-scroll"><table className="vd-table">
                      <thead><tr><th>Department</th><th>Mort. %</th><th>Morb. %</th><th>Minutes</th><th>Attendance</th><th>Disseminated</th></tr></thead>
                      <tbody>{perDept.map((r) => {
                        const cs = cases.filter((c) => c.dept_code === r.d.code && isDocumented(c))
                        const anyMin = cs.length > 0, allAtt = cs.every((c) => c.attendance_attached) && cs.length > 0
                        const diss = cs.length > 0 && cs.every((c) => c.learning_points_disseminated)
                        const ok = <span className="badge b-good">✓</span>, part = <span className="badge b-warn">partial</span>, none = <span className="badge b-neut">—</span>
                        return (
                          <tr key={r.d.code}><td><b>{r.d.name}</b></td>
                            <td><b style={{ color: coverageColor(r.m.pct) }}>{r.m.den ? `${r.m.pct}%` : '—'}</b></td>
                            <td><b style={{ color: coverageColor(r.b.pct) }}>{r.b.den ? `${r.b.pct}%` : '—'}</b></td>
                            <td>{anyMin ? ok : none}</td><td>{cs.length === 0 ? none : allAtt ? ok : part}</td><td>{cs.length === 0 ? none : diss ? ok : part}</td></tr>
                        )
                      })}</tbody>
                    </table></div>
                    <p className="vd-sub" style={{ marginTop: 10 }}>Denominator policy: mortality excludes BID; morbidity = recorded morbidity cases. Adjustable later.</p></div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* ---------------- MODAL ---------------- */}
      {modal && (
        <div className="mm-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className="mm-modal">
            <div className="mm-modal-head">
              <h3>{modal.mode === 'new' ? 'New M&M case' : modal.mode === 'edit' ? 'Edit case' : 'Case'}</h3>
              <button type="button" className="x" onClick={() => setModal(null)}>×</button>
            </div>
            <div className="mm-modal-body">
              {(modal.mode === 'new' || modal.mode === 'edit') && (
                <MmCaseForm supabase={supabase}
                  initial={modal.mode === 'edit' ? modalCase : null}
                  departments={departments}
                  existingShortfalls={modal.mode === 'edit' ? modalShorts : []}
                  suggestCaseNo={nextCaseNo(cases.map((c) => c.case_no))}
                  onCancel={() => setModal(null)}
                  onSaved={async () => { await load(); setModal(null) }} />
              )}
              {modal.mode === 'view' && modalCase && (
                <MmCaseView supabase={supabase} c={modalCase} dept={departments.find((d) => d.code === modalCase.dept_code)}
                  shortfalls={modalShorts} actions={modalActions}
                  onEdit={() => setModal({ mode: 'edit', caseId: modalCase.id })}
                  onChanged={() => void load()} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
