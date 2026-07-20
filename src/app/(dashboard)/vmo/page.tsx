'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PortalNav } from '@/components/PortalNav'
import {
  VMO_THEMES, vmoScore, pctPositive, meanOf,
  type VmoGroup, type VmoQuestion, type VmoGroupQuestion,
  type VmoDemographic, type VmoOption, type VmoResponse, type VmoAnswer, type VmoTheme,
} from '@/lib/vmo/types'

/* VMO Survey results dashboard.
 *
 * Visible to any signed-in portal user (no role gate) — same as Risk Register.
 * Volumes are small, so the page loads the full answer set once and computes
 * everything in the browser rather than round-tripping per tab. */

type Tab = 'ov' | 'grp' | 'item' | 'brk' | 'cmt' | 'rc' | 'exp'

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'ov', icon: '📊', label: 'Overview' },
  { id: 'grp', icon: '🧭', label: 'By Group' },
  { id: 'item', icon: '📋', label: 'Item-Level' },
  { id: 'brk', icon: '🔍', label: 'Breakdowns' },
  { id: 'cmt', icon: '💬', label: 'Comments' },
  { id: 'rc', icon: '📄', label: 'Report Card' },
  { id: 'exp', icon: '⬇', label: 'Export' },
]

/* Shared questions — the only four worded identically in every group, so the
 * only place all seven can be compared directly. */
const SHARED = ['Q1_HAPPY', 'Q2_AWARE', 'Q3_VALID', 'Q4_UPDATE']
const SHARED_LABEL = ['Happiness', 'VMO aware', 'VMO valid', 'Needs update']

function heat(p: number): [string, string] {
  if (p >= 75) return ['#D1F0E3', '#0F6E56']
  if (p >= 65) return ['#E4F3D8', '#3B6D11']
  if (p >= 55) return ['#FDF0D5', '#854F0B']
  if (p >= 45) return ['#FBE2D3', '#993C1D']
  return ['#FBDADA', '#A32D2D']
}
const DISTC = ['#D9534F', '#E8956A', '#D8CFA8', '#7FB77E', '#3E8E5A']

export default function VmoDashboardPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<Tab>('ov')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [groups, setGroups] = useState<VmoGroup[]>([])
  const [questions, setQuestions] = useState<Record<string, VmoQuestion>>({})
  const [gq, setGq] = useState<VmoGroupQuestion[]>([])
  const [demos, setDemos] = useState<VmoDemographic[]>([])
  const [options, setOptions] = useState<VmoOption[]>([])
  const [responses, setResponses] = useState<VmoResponse[]>([])
  const [answers, setAnswers] = useState<VmoAnswer[]>([])

  const [selG, setSelG] = useState<string>('')
  const [selD, setSelD] = useState<string>('age')
  const [cmtG, setCmtG] = useState<string>('')
  const [cmtQ, setCmtQ] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      try {
        const [g, q, m, d, o, r, a] = await Promise.all([
          supabase.from('vmo_groups').select('*').order('sort_order'),
          supabase.from('vmo_questions').select('*'),
          supabase.from('vmo_group_questions').select('*').order('position'),
          supabase.from('vmo_demographics').select('*').order('position'),
          supabase.from('vmo_demographic_options').select('*').order('sort_order'),
          supabase.from('vmo_responses').select('*').order('submitted_at', { ascending: false }),
          supabase.from('vmo_answers').select('*'),
        ])
        if (cancelled) return
        const firstError = [g.error, q.error, m.error, d.error, o.error, r.error, a.error].find((e) => e)
        if (firstError) { setLoadError(firstError.message); setLoading(false); return }
        const qmap: Record<string, VmoQuestion> = {}
        for (const row of (q.data ?? []) as VmoQuestion[]) qmap[row.code] = row
        setGroups((g.data ?? []) as VmoGroup[])
        setQuestions(qmap)
        setGq((m.data ?? []) as VmoGroupQuestion[])
        setDemos((d.data ?? []) as VmoDemographic[])
        setOptions((o.data ?? []) as VmoOption[])
        setResponses((r.data ?? []) as VmoResponse[])
        setAnswers((a.data ?? []) as VmoAnswer[])
        setSelG(((g.data ?? [])[0] as VmoGroup | undefined)?.code ?? '')
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setLoadError(e instanceof Error ? e.message : 'Load failed'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [supabase, router])

  /* ---------------- derived ---------------- */
  const respById = useMemo(() => {
    const m: Record<number, VmoResponse> = {}
    for (const r of responses) m[r.id] = r
    return m
  }, [responses])

  /** values for a question, optionally within one group, reverse-scored applied */
  const valuesFor = useMemo(() => (qcode: string, groupCode?: string, raw = false): number[] => {
    const q = questions[qcode]
    const rev = !raw && !!q?.reverse_scored
    const out: number[] = []
    for (const a of answers) {
      if (a.question_code !== qcode) continue
      const r = respById[a.response_id]
      if (!r) continue
      if (groupCode && r.group_code !== groupCode) continue
      out.push(vmoScore(a.value, rev))
    }
    return out
  }, [answers, questions, respById])

  const countByGroup = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of responses) m[r.group_code] = (m[r.group_code] ?? 0) + 1
    return m
  }, [responses])

  const total = responses.length

  /** theme score across a group (or all), reverse scoring applied */
  const themePct = useMemo(() => (theme: VmoTheme, groupCode?: string): { pct: number; n: number } => {
    const vals: number[] = []
    for (const a of answers) {
      const q = questions[a.question_code]
      if (!q || q.theme !== theme) continue
      const r = respById[a.response_id]
      if (!r) continue
      if (groupCode && r.group_code !== groupCode) continue
      vals.push(vmoScore(a.value, q.reverse_scored))
    }
    return { pct: pctPositive(vals), n: vals.length }
  }, [answers, questions, respById])

  const headline = useMemo(() => {
    const happy = [...valuesFor('Q1_HAPPY'), ...valuesFor('Q1_HAPPY_STU'), ...valuesFor('Q1_HAPPY_PT')]
    const aware = valuesFor('Q2_AWARE')
    const upd = valuesFor('Q4_UPDATE', undefined, true) // raw: % who AGREE it needs updating
    return {
      happy: pctPositive(happy), happyN: happy.length,
      aware: pctPositive(aware), awareN: aware.length,
      upd: pctPositive(upd), updN: upd.length,
    }
  }, [valuesFor])

  /** Q1 code differs per group (staff / student / patient) */
  const q1Code = (gcode: string) =>
    gq.find((x) => x.group_code === gcode && x.position === 1)?.question_code ?? 'Q1_HAPPY'
  const sharedCode = (gcode: string, idx: number) =>
    gq.find((x) => x.group_code === gcode && x.position === idx + 1)?.question_code ?? SHARED[idx]

  /* The type predicate is what lets `q` be treated as present downstream —
   * a plain .filter() does not narrow the type. */
  const groupQs = (gcode: string) =>
    gq.filter((x) => x.group_code === gcode).sort((a, b) => a.position - b.position)
      .map((x) => ({ ...x, q: questions[x.question_code] as VmoQuestion | undefined }))
      .filter((x): x is VmoGroupQuestion & { q: VmoQuestion } => Boolean(x.q))

  const comments = useMemo(() => responses
    .filter((r) => r.free_text && r.free_text.trim())
    .filter((r) => !cmtG || r.group_code === cmtG)
    .filter((r) => !cmtQ || (r.free_text ?? '').toLowerCase().includes(cmtQ.toLowerCase())),
    [responses, cmtG, cmtQ])

  const gName = (code: string) => groups.find((g) => g.code === code)?.name_ms ?? code
  const gAccent = (code: string) => groups.find((g) => g.code === code)?.accent ?? '#6B7280'

  function exportCsv() {
    const qcodes = Array.from(new Set(gq.map((x) => x.question_code)))
    const head = ['response_id', 'group', 'submitted_at', 'language',
      'age', 'sex', 'service', 'position', 'posting_year', 'faculty', 'study_level',
      ...qcodes, 'free_text']
    const ansByResp: Record<number, Record<string, number>> = {}
    for (const a of answers) {
      ansByResp[a.response_id] = ansByResp[a.response_id] ?? {}
      ansByResp[a.response_id][a.question_code] = a.value
    }
    const rows = responses.map((r) => {
      const d = r.demographics ?? {}
      const av = ansByResp[r.id] ?? {}
      return [r.id, r.group_code, r.submitted_at, r.language,
        d.age ?? '', d.sex ?? '', d.service ?? '', d.position ?? '',
        d.posting_year ?? '', d.faculty ?? '', d.study_level ?? '',
        ...qcodes.map((c) => av[c] ?? ''),
        (r.free_text ?? '').replace(/"/g, '""')]
    })
    const csv = [head, ...rows].map((row) =>
      row.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c}"` : c)).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `VMO_Survey_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---------------- render ---------------- */
  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar"><PortalNav active="vmo" /></aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation"
              onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div style={{ minWidth: 0 }}>
              <div className="tb-title">VMO Survey</div>
              <div className="tb-meta">Hala Tuju Strategik HASA · Hospital Al-Sultan Abdullah UiTM</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="rec-badge">
              {loading ? 'Loading…' : `${total.toLocaleString()} response${total === 1 ? '' : 's'}`}
            </div>
          </div>
        </header>

        <nav className="tab-nav" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
              className={`tab-btn ${tab === x.id ? 'active' : ''}`}
              onClick={() => { setTab(x.id); setSidebarOpen(false) }}>
              {x.icon} {x.label}
            </button>
          ))}
        </nav>

        <main className="tab-pane">
          {loading && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>}
          {!loading && loadError && (
            <div className="ac red"><div className="ai">⚠️</div><div>
              <div className="at">Could not load results</div><div className="as">{loadError}</div></div></div>
          )}

          {!loading && !loadError && total === 0 && (
            <div className="card">
              <h3 className="vd-h">No responses yet</h3>
              <p className="vd-sub">
                The survey has not received any responses. Share the public link to start collecting:
              </p>
              <div className="vd-link">
                <code>https://rmcq.my/vmo-survey</code>
              </div>
              <p className="vd-sub" style={{ marginTop: 12 }}>
                Respondents choose their group on the first screen — no login needed. This dashboard
                fills in automatically as responses arrive.
              </p>
            </div>
          )}

          {!loading && !loadError && total > 0 && (
            <>
              {/* ---------------- OVERVIEW ---------------- */}
              {tab === 'ov' && (
                <>
                  <div className="vd-cards">
                    <div className="vd-mc"><div className="l">Total responses</div>
                      <div className="v">{total.toLocaleString()}</div>
                      <div className="s">across {Object.keys(countByGroup).length} of {groups.length} groups</div></div>
                    <div className="vd-mc"><div className="l">Overall happiness</div>
                      <div className="v">{headline.happy}%</div>
                      <div className="s">positive (4–5) · n={headline.happyN}</div></div>
                    <div className="vd-mc"><div className="l">VMO awareness</div>
                      <div className="v">{headline.aware}%</div>
                      <div className="s">aware &amp; understand · n={headline.awareN}</div></div>
                    <div className="vd-mc hl"><div className="l">VMO needs updating</div>
                      <div className="v">{headline.upd}%</div>
                      <div className="s">agree it should be refreshed</div></div>
                  </div>

                  <div className="card">
                    <h3 className="vd-h">Responses by group</h3>
                    <div className="vd-sub">Raw counts. Response-rate percentages can be added once headcounts are known.</div>
                    {groups.map((g) => {
                      const n = countByGroup[g.code] ?? 0
                      const max = Math.max(1, ...Object.values(countByGroup))
                      return (
                        <div className="vd-bar" key={g.code}>
                          <div className="lab" title={g.name_ms}>
                            <span className="dot" style={{ background: g.accent }} /><span className="txt">{g.name_ms}</span>
                          </div>
                          <div className="track"><i style={{ width: `${(n / max) * 100}%`, background: g.accent }} /></div>
                          <div className="val">{n}</div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="card">
                    <h3 className="vd-h">Theme scores — all groups</h3>
                    <div className="vd-sub">% positive. Q4 is reverse-scored inside the VMO theme, so a high score means the vision is landing well.</div>
                    {VMO_THEMES.map((th) => {
                      const { pct, n } = themePct(th.key)
                      const h = heat(pct)
                      return (
                        <div className="vd-bar" key={th.key}>
                          <div className="lab"><span className="txt">{th.en}</span></div>
                          <div className="track"><i style={{ width: `${pct}%`, background: h[1] }} /></div>
                          <div className="val">{pct}%<span className="nb">n={n}</span></div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* ---------------- BY GROUP ---------------- */}
              {tab === 'grp' && (
                <>
                  <div className="card">
                    <h3 className="vd-h">Shared questions — all seven groups</h3>
                    <div className="vd-sub">
                      Q1–Q4 are worded identically in every group, so this is the one valid like-for-like comparison.
                      Cells show % positive and n. The <b>Needs update</b> column is colour-scaled inverted — red means
                      more people want the VMO changed.
                    </div>
                    <div className="vd-scroll">
                      <table className="vd-table">
                        <thead><tr><th style={{ minWidth: 190 }}>Group</th><th>n</th>
                          {SHARED_LABEL.map((l) => <th key={l} style={{ textAlign: 'center' }}>{l}</th>)}</tr></thead>
                        <tbody>
                          {groups.map((g) => (
                            <tr key={g.code}>
                              <td><span className="vd-gn"><span className="dot" style={{ background: g.accent }} />{g.name_ms}</span></td>
                              <td style={{ color: 'var(--muted)' }}>{countByGroup[g.code] ?? 0}</td>
                              {[0, 1, 2, 3].map((i) => {
                                const code = sharedCode(g.code, i)
                                const vals = valuesFor(code, g.code, i === 3)
                                const pct = pctPositive(vals)
                                const h = heat(i === 3 ? 100 - pct : pct)
                                return (
                                  <td key={i} style={{ padding: 4 }}>
                                    <div className="vd-hm" style={{ background: h[0], color: h[1] }}>
                                      {vals.length ? `${pct}%` : '—'}<small>n={vals.length}</small>
                                    </div>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="vd-sub" style={{ marginTop: 10 }}>
                      Staf Fakulti&apos;s Q3 is worded slightly differently (it references faculty alignment), so read that cell with care.
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="vd-h">Ranked — VMO awareness</h3>
                    <div className="vd-sub">% positive on Q2, identical wording in all groups.</div>
                    {[...groups]
                      .map((g) => ({ g, v: valuesFor('Q2_AWARE', g.code) }))
                      .sort((a, b) => pctPositive(b.v) - pctPositive(a.v))
                      .map(({ g, v }) => (
                        <div className="vd-bar" key={g.code}>
                          <div className="lab" title={g.name_ms}><span className="dot" style={{ background: g.accent }} /><span className="txt">{g.name_ms}</span></div>
                          <div className="track"><i style={{ width: `${pctPositive(v)}%`, background: g.accent }} /></div>
                          <div className="val">{v.length ? `${pctPositive(v)}%` : '—'}<span className="nb">n={v.length}</span></div>
                        </div>
                      ))}
                  </div>

                  <div className="card">
                    <h3 className="vd-h">Ranked — happiness</h3>
                    <div className="vd-sub">% positive on Q1 (wording adapted per group, same scale).</div>
                    {[...groups]
                      .map((g) => ({ g, v: valuesFor(q1Code(g.code), g.code) }))
                      .sort((a, b) => pctPositive(b.v) - pctPositive(a.v))
                      .map(({ g, v }) => (
                        <div className="vd-bar" key={g.code}>
                          <div className="lab" title={g.name_ms}><span className="dot" style={{ background: g.accent }} /><span className="txt">{g.name_ms}</span></div>
                          <div className="track"><i style={{ width: `${pctPositive(v)}%`, background: g.accent }} /></div>
                          <div className="val">{v.length ? `${pctPositive(v)}%` : '—'}<span className="nb">n={v.length}</span></div>
                        </div>
                      ))}
                  </div>
                </>
              )}

              {/* ---------------- ITEM LEVEL ---------------- */}
              {tab === 'item' && (
                <>
                  <div className="vd-pills">
                    {groups.map((g) => (
                      <button key={g.code} type="button"
                        className={`vd-pill ${selG === g.code ? 'on' : ''}`}
                        style={selG === g.code ? { background: g.accent, borderColor: g.accent } : undefined}
                        onClick={() => setSelG(g.code)}>{g.name_ms}</button>
                    ))}
                  </div>
                  <div className="vd-legend">
                    {['1 Sangat tidak setuju', '2', '3 Neutral', '4', '5 Sangat setuju'].map((l, i) => (
                      <span key={l}><i className="sw" style={{ background: DISTC[i] }} />{l}</span>
                    ))}
                  </div>
                  <div className="card">
                    {(() => {
                      let lastTheme = ''
                      return groupQs(selG).map((x) => {
                        const vals = valuesFor(x.question_code, selG)
                        const rawVals = valuesFor(x.question_code, selG, true)
                        const pct = pctPositive(vals)
                        const counts = [1, 2, 3, 4, 5].map((v) => rawVals.filter((z) => z === v).length)
                        const tot = rawVals.length || 1
                        const themeChanged = x.q.theme !== lastTheme
                        lastTheme = x.q.theme
                        return (
                          <div key={x.question_code}>
                            {themeChanged && (
                              <div className="vd-theme">{VMO_THEMES.find((t) => t.key === x.q.theme)?.en ?? x.q.theme}</div>
                            )}
                            <div className="vd-q">
                              <div className="vd-qt">
                                <span className="vd-qn">{x.position}</span>{x.q.text_ms}
                                {x.q.reverse_scored && <span className="vd-rev">reverse scored</span>}
                              </div>
                              <div className="vd-qe">{x.q.text_en}</div>
                              <div className="vd-qstat">
                                <div className="pct" style={{ color: heat(pct)[1] }}>{rawVals.length ? `${pct}%` : '—'}</div>
                                <div style={{ flex: 1, minWidth: 130 }}>
                                  <div className="vd-dist">
                                    {counts.map((c, i) => (
                                      <i key={i} style={{ width: `${(c / tot) * 100}%`, background: DISTC[i] }} />
                                    ))}
                                  </div>
                                </div>
                                <div className="vd-meta">
                                  mean {rawVals.length ? meanOf(vals).toFixed(2) : '—'}<span className="nb">n={rawVals.length}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                  <div className="vd-sub">
                    Q4 asks whether the VMO <i>needs updating</i>, so a high % there is a call for change, not satisfaction.
                    It is reversed before entering the VMO theme score.
                  </div>
                </>
              )}

              {/* ---------------- BREAKDOWNS ---------------- */}
              {tab === 'brk' && (() => {
                const fields = Array.from(new Set(demos.map((d) => d.field_code)))
                const setFor = demos.find((d) => d.field_code === selD)?.option_set ?? selD
                const opts = options.filter((o) => o.option_set === setFor)
                return (
                  <>
                    <div className="vd-pills">
                      {fields.map((f) => (
                        <button key={f} type="button" className={`vd-pill ${selD === f ? 'on' : ''}`}
                          style={selD === f ? { background: 'var(--blue)', borderColor: 'var(--blue)' } : undefined}
                          onClick={() => setSelD(f)}>
                          {demos.find((d) => d.field_code === f)?.label_en ?? f}
                        </button>
                      ))}
                    </div>
                    <div className="card">
                      <h3 className="vd-h">Theme scores by {demos.find((d) => d.field_code === selD)?.label_en ?? selD}</h3>
                      <div className="vd-sub">n is shown on every row. Rows built on very few responses are marked.</div>
                      <div className="vd-scroll">
                        <table className="vd-table">
                          <thead><tr><th style={{ minWidth: 150 }}>Value</th><th>n</th>
                            {VMO_THEMES.map((t) => <th key={t.key} style={{ textAlign: 'center' }}>{t.en}</th>)}</tr></thead>
                          <tbody>
                            {opts.map((o) => {
                              const ids = new Set(responses.filter((r) => r.demographics?.[selD] === o.value).map((r) => r.id))
                              const n = ids.size
                              return (
                                <tr key={o.value}>
                                  <td style={{ fontWeight: 500 }}>{o.label_ms}</td>
                                  <td style={{ color: 'var(--muted)' }}>
                                    {n}{n > 0 && n < 5 && <span className="vd-small">low n</span>}
                                  </td>
                                  {VMO_THEMES.map((t) => {
                                    const vals: number[] = []
                                    for (const a of answers) {
                                      if (!ids.has(a.response_id)) continue
                                      const q = questions[a.question_code]
                                      if (!q || q.theme !== t.key) continue
                                      vals.push(vmoScore(a.value, q.reverse_scored))
                                    }
                                    const p = pctPositive(vals)
                                    const h = heat(p)
                                    return (
                                      <td key={t.key} style={{ padding: 4 }}>
                                        <div className="vd-hm" style={{ background: vals.length ? h[0] : 'var(--bg)', color: vals.length ? h[1] : 'var(--muted)' }}>
                                          {vals.length ? `${p}%` : '—'}
                                        </div>
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )
              })()}

              {/* ---------------- COMMENTS ---------------- */}
              {tab === 'cmt' && (
                <>
                  <div className="vd-warn">
                    <b>Confidential.</b> These are verbatim staff, student and patient comments. They may identify
                    individuals or describe specific incidents. Handle as confidential feedback and do not
                    redistribute outside RMCQ without consent.
                  </div>
                  <div className="vd-filters">
                    <select value={cmtG} onChange={(e) => setCmtG(e.target.value)}>
                      <option value="">All groups</option>
                      {groups.map((g) => <option key={g.code} value={g.code}>{g.name_ms}</option>)}
                    </select>
                    <input type="text" placeholder="Search comments…" value={cmtQ}
                      onChange={(e) => setCmtQ(e.target.value)} />
                  </div>
                  <div className="vd-sub" style={{ marginBottom: 12 }}>
                    <b style={{ color: 'var(--text)' }}>{comments.length}</b> comment{comments.length === 1 ? '' : 's'}
                    {total > 0 && ` · ${Math.round((responses.filter((r) => r.free_text?.trim()).length / total) * 100)}% of respondents left one`}
                  </div>
                  {comments.length === 0 && <div className="vd-sub">No comments match.</div>}
                  {comments.map((r) => (
                    <div className="vd-cmt" key={r.id}>
                      <div className="meta">
                        <span className="tag" style={{ background: `${gAccent(r.group_code)}1F`, color: gAccent(r.group_code) }}>
                          {gName(r.group_code)}
                        </span>
                        <span className="dt">{new Date(r.submitted_at).toLocaleDateString()}</span>
                      </div>
                      <p>{r.free_text}</p>
                    </div>
                  ))}
                </>
              )}

              {/* ---------------- REPORT CARD ---------------- */}
              {tab === 'rc' && (
                <>
                  <div className="noprint" style={{ marginBottom: 14 }}>
                    <h3 className="vd-h">Report Card</h3>
                    <div className="vd-sub">Print-ready summary for ROC / top management.</div>
                    <button type="button" className="vd-btn" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
                  </div>
                  <div className="vd-a4">
                    <h1>Hala Tuju Strategik HASA — Survey Report</h1>
                    <div className="rcsub">
                      Hospital Al-Sultan Abdullah UiTM · Department of Risk Management, Compliance &amp; Quality
                      · Generated {new Date().toLocaleDateString()}
                    </div>
                    <div className="rcgrid">
                      <div className="rcm"><div className="l">Responses</div><div className="v">{total}</div></div>
                      <div className="rcm"><div className="l">Groups</div><div className="v">{Object.keys(countByGroup).length}/{groups.length}</div></div>
                      <div className="rcm"><div className="l">Happiness</div><div className="v">{headline.happy}%</div></div>
                      <div className="rcm"><div className="l">VMO aware</div><div className="v">{headline.aware}%</div></div>
                      <div className="rcm"><div className="l">Wants refresh</div><div className="v">{headline.upd}%</div></div>
                    </div>
                    <h2 className="rch">Shared questions across all groups</h2>
                    <table className="vd-table">
                      <thead><tr><th>Group</th><th>n</th>{SHARED_LABEL.map((l) => <th key={l} style={{ textAlign: 'center' }}>{l}</th>)}</tr></thead>
                      <tbody>
                        {groups.map((g) => (
                          <tr key={g.code}>
                            <td>{g.name_ms}</td><td style={{ color: 'var(--muted)' }}>{countByGroup[g.code] ?? 0}</td>
                            {[0, 1, 2, 3].map((i) => {
                              const vals = valuesFor(sharedCode(g.code, i), g.code, i === 3)
                              const p = pctPositive(vals)
                              const h = heat(i === 3 ? 100 - p : p)
                              return <td key={i} style={{ padding: 3 }}>
                                <div className="vd-hm" style={{ background: h[0], color: h[1] }}>{vals.length ? `${p}%` : '—'}</div></td>
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <h2 className="rch">Theme scores</h2>
                    <table className="vd-table">
                      <tbody>
                        {VMO_THEMES.map((t) => {
                          const { pct, n } = themePct(t.key)
                          const h = heat(pct)
                          return (
                            <tr key={t.key}><td>{t.en}</td>
                              <td style={{ width: 90, padding: 3 }}>
                                <div className="vd-hm" style={{ background: h[0], color: h[1] }}>{pct}%</div></td>
                              <td style={{ color: 'var(--muted)', width: 60 }}>n={n}</td></tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ---------------- EXPORT ---------------- */}
              {tab === 'exp' && (
                <>
                  <div className="card">
                    <h3 className="vd-h">Export raw data</h3>
                    <div className="vd-sub">
                      One row per respondent: group, submission date, language, all demographics,
                      every question code as a column, and the open-text comment.
                    </div>
                    <button type="button" className="vd-btn" onClick={exportCsv}>⬇ Download CSV</button>
                    <div className="vd-sub" style={{ marginTop: 14 }}>
                      Raw NRIC digits are never exported — they are never stored. The dedup hash is
                      excluded as it has no analytical value.
                    </div>
                  </div>
                  <div className="card">
                    <h3 className="vd-h">Codebook</h3>
                    <div className="vd-sub">What each question code means. Keep this with the exported file.</div>
                    <div className="vd-scroll">
                      <table className="vd-table">
                        <thead><tr><th>Code</th><th>Theme</th><th>Scale</th><th>Rev</th><th>Question (MS)</th></tr></thead>
                        <tbody>
                          {Object.values(questions).sort((a, b) => a.code.localeCompare(b.code)).map((q) => (
                            <tr key={q.code}>
                              <td><code style={{ fontSize: 11 }}>{q.code}</code></td>
                              <td>{q.theme}</td><td>{q.scale_type}</td>
                              <td>{q.reverse_scored ? 'yes' : ''}</td>
                              <td style={{ fontSize: 11.5 }}>{q.text_ms}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
