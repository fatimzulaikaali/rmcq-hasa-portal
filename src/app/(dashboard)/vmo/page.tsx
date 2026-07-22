'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PortalNav } from '@/components/PortalNav'
import {
  VMO_THEMES, VMO_SCALE_MAX, VMO_OPEN, vmoScore, pctPositive, pctNegative, pctSoft,
  pctDontKnow, opinions, meanOf,
  type VmoGroup, type VmoQuestion, type VmoGroupQuestion, type VmoDemographic,
  type VmoOption, type VmoQuestionOption, type VmoResponse, type VmoAnswer,
  type VmoAnswerChoice, type VmoTheme,
} from '@/lib/vmo/types'

type Tab = 'ov' | 'grp' | 'item' | 'choice' | 'brk' | 'cmt' | 'rc' | 'exp'
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'ov', icon: '📊', label: 'Overview' },
  { id: 'grp', icon: '🧭', label: 'By Group' },
  { id: 'item', icon: '📋', label: 'Item-Level' },
  { id: 'choice', icon: '🎯', label: 'Priorities' },
  { id: 'brk', icon: '🔍', label: 'Breakdowns' },
  { id: 'cmt', icon: '💬', label: 'Comments' },
  { id: 'rc', icon: '📄', label: 'Report Card' },
  { id: 'exp', icon: '⬇', label: 'Export' },
]

function heat(p: number): [string, string] {
  if (p >= 55) return ['#D1F0E3', '#0F6E56']
  if (p >= 40) return ['#E4F3D8', '#3B6D11']
  if (p >= 28) return ['#FDF0D5', '#854F0B']
  if (p >= 15) return ['#FBE2D3', '#993C1D']
  return ['#FBDADA', '#A32D2D']
}
const DISTC = ['#C9453F', '#DD7B52', '#E3B06B', '#BFCE86', '#6FAF6B', '#2E8B57']

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
  const [qOptions, setQOptions] = useState<VmoQuestionOption[]>([])
  const [responses, setResponses] = useState<VmoResponse[]>([])
  const [answers, setAnswers] = useState<VmoAnswer[]>([])
  const [choices, setChoices] = useState<VmoAnswerChoice[]>([])

  const [selG, setSelG] = useState<string>('')
  const [selD, setSelD] = useState<string>('age')
  const [cmtG, setCmtG] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      try {
        const [g, q, m, d, o, qo, r, a, c] = await Promise.all([
          supabase.from('vmo_groups').select('*').order('sort_order'),
          supabase.from('vmo_questions').select('*'),
          supabase.from('vmo_group_questions').select('*').order('position'),
          supabase.from('vmo_demographics').select('*').order('position'),
          supabase.from('vmo_demographic_options').select('*').order('sort_order'),
          supabase.from('vmo_question_options').select('*').order('sort_order'),
          supabase.from('vmo_responses').select('*').order('submitted_at', { ascending: false }),
          supabase.from('vmo_answers').select('*'),
          supabase.from('vmo_answer_choices').select('*'),
        ])
        if (cancelled) return
        const firstError = [g.error, q.error, m.error, d.error, o.error, qo.error, r.error, a.error, c.error].find((e) => e)
        if (firstError) { setLoadError(firstError.message); setLoading(false); return }
        const qmap: Record<string, VmoQuestion> = {}
        for (const row of (q.data ?? []) as VmoQuestion[]) qmap[row.code] = row
        setGroups((g.data ?? []) as VmoGroup[]); setQuestions(qmap)
        setGq((m.data ?? []) as VmoGroupQuestion[]); setDemos((d.data ?? []) as VmoDemographic[])
        setOptions((o.data ?? []) as VmoOption[]); setQOptions((qo.data ?? []) as VmoQuestionOption[])
        setResponses((r.data ?? []) as VmoResponse[]); setAnswers((a.data ?? []) as VmoAnswer[])
        setChoices((c.data ?? []) as VmoAnswerChoice[])
        setSelG(((g.data ?? [])[0] as VmoGroup | undefined)?.code ?? '')
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setLoadError(e instanceof Error ? e.message : 'Load failed'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [supabase, router])

  const respById = useMemo(() => {
    const m: Record<number, VmoResponse> = {}
    for (const r of responses) m[r.id] = r
    return m
  }, [responses])

  const rawFor = useMemo(() => (qcode: string, groupCode?: string): (number | null)[] => {
    const out: (number | null)[] = []
    for (const a of answers) {
      if (a.question_code !== qcode) continue
      const r = respById[a.response_id]
      if (!r) continue
      if (groupCode && r.group_code !== groupCode) continue
      out.push(a.value)
    }
    return out
  }, [answers, respById])

  const valuesFor = useMemo(() => (qcode: string, groupCode?: string, raw = false): number[] => {
    const q = questions[qcode]
    const rev = !raw && !!q?.reverse_scored
    return opinions(rawFor(qcode, groupCode)).map((v) => vmoScore(v, rev))
  }, [questions, rawFor])

  const countByGroup = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of responses) m[r.group_code] = (m[r.group_code] ?? 0) + 1
    return m
  }, [responses])
  const total = responses.length

  const themePct = useMemo(() => (theme: VmoTheme, groupCode?: string): { pct: number; n: number } => {
    const vals: number[] = []
    for (const a of answers) {
      const q = questions[a.question_code]
      if (!q || q.theme !== theme || q.scale_type === 'choice') continue
      if (a.value === null) continue
      const r = respById[a.response_id]
      if (!r) continue
      if (groupCode && r.group_code !== groupCode) continue
      vals.push(vmoScore(a.value, q.reverse_scored))
    }
    return { pct: pctPositive(vals), n: vals.length }
  }, [answers, questions, respById])

  /* the group's Q1 happiness question code, and its VMO-related shared codes */
  const codeInGroup = (gcode: string, pred: (q: VmoQuestion) => boolean) => {
    const row = gq.filter((x) => x.group_code === gcode)
      .map((x) => ({ x, q: questions[x.question_code] }))
      .find((z) => z.q && pred(z.q))
    return row?.x.question_code
  }
  const happyCode = (gcode: string) => codeInGroup(gcode, (q) => q.scale_type === 'happiness')

  const headline = useMemo(() => {
    const happy: number[] = []
    for (const a of answers) {
      const q = questions[a.question_code]
      if (q?.scale_type === 'happiness' && a.value !== null) happy.push(a.value)
    }
    const aware = valuesFor('FAMILIAR_VMO')
    const upd = valuesFor('VMO_UPDATE', undefined, true)
    return { happy: pctPositive(happy), happyN: happy.length, aware: pctPositive(aware), awareN: aware.length, upd: pctPositive(upd), updN: upd.length }
  }, [answers, questions, valuesFor])

  const groupQs = (gcode: string) =>
    gq.filter((x) => x.group_code === gcode).sort((a, b) => a.position - b.position)
      .map((x) => ({ ...x, q: questions[x.question_code] as VmoQuestion | undefined }))
      .filter((x): x is VmoGroupQuestion & { q: VmoQuestion } => Boolean(x.q))

  /* choice tally: for a choice question (optionally within a group), count how
   * many respondents picked each option, over those who answered it. */
  const choiceTally = (qcode: string, groupCode?: string) => {
    const opts = qOptions.filter((o) => o.question_code === qcode).sort((a, b) => a.sort_order - b.sort_order)
    const respSet = new Set<number>()
    const counts: Record<string, number> = {}
    for (const ch of choices) {
      if (ch.question_code !== qcode) continue
      const r = respById[ch.response_id]
      if (!r) continue
      if (groupCode && r.group_code !== groupCode) continue
      respSet.add(ch.response_id)
      counts[ch.option_value] = (counts[ch.option_value] ?? 0) + 1
    }
    const n = respSet.size
    return {
      n,
      rows: opts.map((o) => ({ value: o.value, label_ms: o.label_ms, label_en: o.label_en, count: counts[o.value] ?? 0, pct: n ? Math.round(((counts[o.value] ?? 0) / n) * 100) : 0 }))
        .sort((a, b) => b.count - a.count),
    }
  }

  const choiceQuestions = useMemo(() => {
    const seen = new Set<string>()
    const list: { qcode: string; q: VmoQuestion; groups: string[] }[] = []
    for (const x of gq) {
      const q = questions[x.question_code]
      if (!q || q.scale_type !== 'choice') continue
      if (!seen.has(x.question_code)) { seen.add(x.question_code); list.push({ qcode: x.question_code, q, groups: [x.group_code] }) }
      else list.find((z) => z.qcode === x.question_code)?.groups.push(x.group_code)
    }
    return list
  }, [gq, questions])

  const comments = useMemo(() => {
    const rows: { id: number; group_code: string; date: string; key: string; text: string }[] = []
    for (const r of responses) {
      if (cmtG && r.group_code !== cmtG) continue
      for (const o of VMO_OPEN) {
        const txt = r.open_answers?.[o.key]
        if (txt && txt.trim()) rows.push({ id: r.id, group_code: r.group_code, date: r.submitted_at, key: o.key, text: txt })
      }
    }
    return rows
  }, [responses, cmtG])

  const gName = (code: string) => groups.find((g) => g.code === code)?.name_ms ?? code
  const gAccent = (code: string) => groups.find((g) => g.code === code)?.accent ?? '#6B7280'

  function exportCsv() {
    const qcodes = Array.from(new Set(gq.map((x) => x.question_code)))
    const scaleCodes = qcodes.filter((c) => questions[c]?.scale_type !== 'choice')
    const choiceCodes = qcodes.filter((c) => questions[c]?.scale_type === 'choice')
    const head = ['response_id', 'group', 'submitted_at', 'language',
      'age', 'sex', 'service', 'position', 'posting_year', 'faculty', 'faculty_dept', 'study_level', 'treatment',
      ...scaleCodes, ...choiceCodes, 't1_keep', 't2_change', 't3_other']
    const ans: Record<number, Record<string, number | null>> = {}
    for (const a of answers) { ans[a.response_id] = ans[a.response_id] ?? {}; ans[a.response_id][a.question_code] = a.value }
    const chosen: Record<number, Record<string, string[]>> = {}
    for (const c of choices) { chosen[c.response_id] = chosen[c.response_id] ?? {}; (chosen[c.response_id][c.question_code] = chosen[c.response_id][c.question_code] ?? []).push(c.option_value) }
    const rows = responses.map((r) => {
      const d = r.demographics ?? {}, av = ans[r.id] ?? {}, cv = chosen[r.id] ?? {}, op = r.open_answers ?? {}
      return [r.id, r.group_code, r.submitted_at, r.language,
        d.age ?? '', d.sex ?? '', d.service ?? '', d.position ?? '', d.posting_year ?? '', d.faculty ?? '', d.faculty_dept ?? '', d.study_level ?? '', d.treatment ?? '',
        ...scaleCodes.map((c) => (!Object.prototype.hasOwnProperty.call(av, c) ? '' : av[c] === null ? 'DK' : av[c])),
        ...choiceCodes.map((c) => (cv[c] ?? []).join('|')),
        (op.t1 ?? ''), (op.t2 ?? ''), (op.t3 ?? '')]
    })
    const csv = [head, ...rows].map((row) => row.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `VMO_Survey_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      <aside className="sidebar"><PortalNav active="vmo" /></aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button type="button" className="hamburger" aria-label="Toggle navigation" onClick={() => setSidebarOpen((v) => !v)}>☰</button>
            <div style={{ minWidth: 0 }}>
              <div className="tb-title">VMO Survey</div>
              <div className="tb-meta">Hala Tuju Strategik HASA · Hospital Al-Sultan Abdullah UiTM</div>
            </div>
          </div>
          <div className="rec-badge">{loading ? 'Loading…' : `${total.toLocaleString()} response${total === 1 ? '' : 's'}`}</div>
        </header>

        <nav className="tab-nav" role="tablist">
          {TABS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
              className={`tab-btn ${tab === x.id ? 'active' : ''}`}
              onClick={() => { setTab(x.id); setSidebarOpen(false) }}>{x.icon} {x.label}</button>
          ))}
        </nav>

        <main className="tab-pane">
          {loading && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>}
          {!loading && loadError && (
            <div className="ac red"><div className="ai">⚠️</div><div><div className="at">Could not load results</div><div className="as">{loadError}</div></div></div>
          )}

          {!loading && !loadError && total === 0 && (
            <div className="card">
              <h3 className="vd-h">No responses yet</h3>
              <p className="vd-sub">Share the public link to start collecting:</p>
              <div className="vd-link"><code>https://rmcq.my/vmo-survey</code></div>
              <p className="vd-sub" style={{ marginTop: 12 }}>Respondents choose their group first — no login needed. This dashboard fills in as responses arrive.</p>
            </div>
          )}

          {!loading && !loadError && total > 0 && (
            <>
              {tab === 'ov' && (
                <>
                  <div className="vd-cards">
                    <div className="vd-mc"><div className="l">Total responses</div><div className="v">{total.toLocaleString()}</div><div className="s">across {Object.keys(countByGroup).length} of {groups.length} groups</div></div>
                    <div className="vd-mc"><div className="l">Overall happiness</div><div className="v">{headline.happy}%</div><div className="s">positive (5–6) · n={headline.happyN}</div></div>
                    <div className="vd-mc"><div className="l">VMO familiarity</div><div className="v">{headline.aware}%</div><div className="s">knew it well · n={headline.awareN}</div></div>
                    <div className="vd-mc hl"><div className="l">VMO needs updating</div><div className="v">{headline.upd}%</div><div className="s">agree · n={headline.updN}</div></div>
                  </div>
                  <div className="card">
                    <h3 className="vd-h">Responses by group</h3>
                    <div className="vd-sub">Raw counts.</div>
                    {groups.map((g) => {
                      const n = countByGroup[g.code] ?? 0
                      const max = Math.max(1, ...Object.values(countByGroup))
                      return (
                        <div className="vd-bar" key={g.code}>
                          <div className="lab" title={g.name_ms}><span className="dot" style={{ background: g.accent }} /><span className="txt">{g.name_ms}</span></div>
                          <div className="track"><i style={{ width: `${(n / max) * 100}%`, background: g.accent }} /></div>
                          <div className="val">{n}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="card">
                    <h3 className="vd-h">Theme scores — all groups</h3>
                    <div className="vd-sub">% positive (5–6). Q4 is reverse-scored inside the VMO theme.</div>
                    {VMO_THEMES.map((th) => {
                      const { pct, n } = themePct(th.key)
                      return (
                        <div className="vd-bar" key={th.key}>
                          <div className="lab"><span className="txt">{th.en}</span></div>
                          <div className="track"><i style={{ width: `${pct}%`, background: heat(pct)[1] }} /></div>
                          <div className="val">{pct}%<span className="nb">n={n}</span></div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {tab === 'grp' && (
                <div className="card">
                  <h3 className="vd-h">Scores by group</h3>
                  <div className="vd-sub">% positive per group on the shared measures. A dash means the group was not asked that question.</div>
                  <div className="vd-scroll">
                    <table className="vd-table">
                      <thead><tr><th style={{ minWidth: 190 }}>Group</th><th>n</th>
                        <th style={{ textAlign: 'center' }}>Happiness</th><th style={{ textAlign: 'center' }}>VMO familiar</th>
                        <th style={{ textAlign: 'center' }}>Needs update</th><th style={{ textAlign: 'center' }}>Welfare</th></tr></thead>
                      <tbody>
                        {groups.map((g) => {
                          const hc = happyCode(g.code)
                          const cells: { code?: string; invert?: boolean }[] = [
                            { code: hc }, { code: 'FAMILIAR_VMO' }, { code: 'VMO_UPDATE', invert: true }, { code: 'WELFARE' },
                          ]
                          return (
                            <tr key={g.code}>
                              <td><span className="vd-gn"><span className="dot" style={{ background: g.accent }} />{g.name_ms}</span></td>
                              <td style={{ color: 'var(--muted)' }}>{countByGroup[g.code] ?? 0}</td>
                              {cells.map((c, i) => {
                                const has = c.code && gq.some((x) => x.group_code === g.code && x.question_code === c.code)
                                if (!has) return <td key={i} style={{ padding: 4 }}><div className="vd-hm" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>—</div></td>
                                const vals = valuesFor(c.code!, g.code, c.invert)
                                const p = pctPositive(vals)
                                const h = heat(c.invert ? 100 - p : p)
                                return <td key={i} style={{ padding: 4 }}><div className="vd-hm" style={{ background: h[0], color: h[1] }}>{vals.length ? `${p}%` : '—'}<small>n={vals.length}</small></div></td>
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="vd-sub" style={{ marginTop: 10 }}>&quot;Needs update&quot; is colour-scaled inverted — red means more people want the VMO changed.</div>
                </div>
              )}

              {tab === 'item' && (
                <>
                  <div className="vd-pills">
                    {groups.map((g) => (
                      <button key={g.code} type="button" className={`vd-pill ${selG === g.code ? 'on' : ''}`}
                        style={selG === g.code ? { background: g.accent, borderColor: g.accent } : undefined}
                        onClick={() => setSelG(g.code)}>{g.name_ms}</button>
                    ))}
                  </div>
                  <div className="card">
                    {groupQs(selG).map((x) => {
                      if (x.q.scale_type === 'choice') {
                        const tally = choiceTally(x.question_code, selG)
                        return (
                          <div className="vd-q" key={x.question_code}>
                            <div className="vd-qt"><span className="vd-qn">{x.position}</span>{x.q.text_ms}<span className="vd-rev" style={{ background: '#EEF2FF', color: '#3730A3' }}>pilih 2</span></div>
                            <div className="vd-qe">{x.q.text_en} · n={tally.n}</div>
                            {tally.rows.map((o) => (
                              <div className="vd-bar" key={o.value} style={{ gridTemplateColumns: '220px 1fr 60px' }}>
                                <div className="lab" title={o.label_ms}><span className="txt">{o.label_ms}</span></div>
                                <div className="track"><i style={{ width: `${o.pct}%`, background: gAccent(selG) }} /></div>
                                <div className="val">{o.pct}%</div>
                              </div>
                            ))}
                          </div>
                        )
                      }
                      const submitted = rawFor(x.question_code, selG)
                      const vals = valuesFor(x.question_code, selG)
                      const rawVals = valuesFor(x.question_code, selG, true)
                      const pct = pctPositive(vals), neg = pctNegative(vals), soft = pctSoft(vals), dk = pctDontKnow(submitted)
                      const counts = Array.from({ length: VMO_SCALE_MAX }, (_, k) => k + 1).map((v) => rawVals.filter((z) => z === v).length)
                      const dkCount = submitted.length - rawVals.length
                      const tot = submitted.length || 1
                      return (
                        <div className="vd-q" key={x.question_code}>
                          <div className="vd-qt"><span className="vd-qn">{x.position}</span>{x.q.text_ms}
                            {x.q.reverse_scored && <span className="vd-rev">reverse scored</span>}
                            {x.q.scale_type === 'familiarity' && <span className="vd-rev" style={{ background: '#F0EBFC', color: '#4a3aa7' }}>familiarity</span>}
                          </div>
                          <div className="vd-qe">{x.q.text_en}</div>
                          <div className="vd-qstat">
                            <div className="pct" style={{ color: heat(pct)[1] }}>{rawVals.length ? `${pct}%` : '—'}</div>
                            <div style={{ flex: 1, minWidth: 130 }}>
                              <div className="vd-dist">
                                {counts.map((c, i) => <i key={i} style={{ width: `${(c / tot) * 100}%`, background: DISTC[i] }} />)}
                                {dkCount > 0 && <i style={{ width: `${(dkCount / tot) * 100}%`, background: '#D4D4D8' }} />}
                              </div>
                              <div className="vd-bands">
                                <span className="neg">{neg}% negatif</span><span className="soft">{soft}% sederhana</span>
                                <span className="pos">{pct}% positif</span>{dk > 0 && <span className="dk">{dk}% tidak tahu</span>}
                              </div>
                            </div>
                            <div className="vd-meta">mean {rawVals.length ? meanOf(vals).toFixed(2) : '—'}<span className="nb">n={rawVals.length}</span></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {tab === 'choice' && (
                <>
                  <div className="vd-sub" style={{ marginBottom: 14 }}>Pick-two questions. Each bar shows the share of respondents (in the relevant groups) who selected that option.</div>
                  {choiceQuestions.map(({ qcode, q, groups: gs }) => {
                    const tally = choiceTally(qcode)
                    return (
                      <div className="card" key={qcode}>
                        <h3 className="vd-h">{q.text_ms}</h3>
                        <div className="vd-sub">{q.text_en} · {gs.map((c) => gName(c)).join(', ')} · n={tally.n}</div>
                        {tally.rows.map((o, i) => (
                          <div className="vd-bar" key={o.value} style={{ gridTemplateColumns: '240px 1fr 60px' }}>
                            <div className="lab" title={o.label_ms}><span className="txt">{i === 0 ? '🏆 ' : ''}{o.label_ms}</span></div>
                            <div className="track"><i style={{ width: `${o.pct}%`, background: i === 0 ? '#1D9E75' : 'var(--blue)' }} /></div>
                            <div className="val">{o.pct}%<span className="nb">{o.count}</span></div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}

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
                          onClick={() => setSelD(f)}>{demos.find((d) => d.field_code === f)?.label_en ?? f}</button>
                      ))}
                    </div>
                    <div className="card">
                      <h3 className="vd-h">Theme scores by {demos.find((d) => d.field_code === selD)?.label_en ?? selD}</h3>
                      <div className="vd-sub">n shown on every row.</div>
                      <div className="vd-scroll">
                        <table className="vd-table">
                          <thead><tr><th style={{ minWidth: 150 }}>Value</th><th>n</th>{VMO_THEMES.map((t) => <th key={t.key} style={{ textAlign: 'center' }}>{t.en}</th>)}</tr></thead>
                          <tbody>
                            {opts.map((o) => {
                              const ids = new Set(responses.filter((r) => r.demographics?.[selD] === o.value).map((r) => r.id))
                              const n = ids.size
                              return (
                                <tr key={o.value}>
                                  <td style={{ fontWeight: 500 }}>{o.label_ms}</td>
                                  <td style={{ color: 'var(--muted)' }}>{n}{n > 0 && n < 5 && <span className="vd-small">low n</span>}</td>
                                  {VMO_THEMES.map((t) => {
                                    const vals: number[] = []
                                    for (const a of answers) {
                                      if (!ids.has(a.response_id) || a.value === null) continue
                                      const q = questions[a.question_code]
                                      if (!q || q.theme !== t.key || q.scale_type === 'choice') continue
                                      vals.push(vmoScore(a.value, q.reverse_scored))
                                    }
                                    const p = pctPositive(vals), h = heat(p)
                                    return <td key={t.key} style={{ padding: 4 }}><div className="vd-hm" style={{ background: vals.length ? h[0] : 'var(--bg)', color: vals.length ? h[1] : 'var(--muted)' }}>{vals.length ? `${p}%` : '—'}</div></td>
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

              {tab === 'cmt' && (
                <>
                  <div className="vd-warn"><b>Confidential.</b> Verbatim staff, student and patient comments. May identify individuals. Handle as confidential feedback; do not redistribute outside RMCQ without consent.</div>
                  <div className="vd-filters">
                    <select value={cmtG} onChange={(e) => setCmtG(e.target.value)}>
                      <option value="">All groups</option>
                      {groups.map((g) => <option key={g.code} value={g.code}>{g.name_ms}</option>)}
                    </select>
                  </div>
                  <div className="vd-sub" style={{ marginBottom: 12 }}><b style={{ color: 'var(--text)' }}>{comments.length}</b> comment{comments.length === 1 ? '' : 's'}</div>
                  {comments.length === 0 && <div className="vd-sub">No comments yet.</div>}
                  {comments.map((r, i) => {
                    const tag = r.key === 't1' ? 'Kekalkan / Keep' : r.key === 't2' ? 'Ubah / Change' : 'Lain / Other'
                    return (
                      <div className="vd-cmt" key={`${r.id}-${r.key}-${i}`}>
                        <div className="meta">
                          <span className="tag" style={{ background: `${gAccent(r.group_code)}1F`, color: gAccent(r.group_code) }}>{gName(r.group_code)}</span>
                          <span className="tag" style={{ background: '#EEF2FF', color: '#3730A3' }}>{tag}</span>
                          <span className="dt">{new Date(r.date).toLocaleDateString()}</span>
                        </div>
                        <p>{r.text}</p>
                      </div>
                    )
                  })}
                </>
              )}

              {tab === 'rc' && (
                <>
                  <div className="noprint" style={{ marginBottom: 14 }}>
                    <h3 className="vd-h">Report Card</h3>
                    <div className="vd-sub">Print-ready summary for ROC / top management.</div>
                    <button type="button" className="vd-btn" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
                  </div>
                  <div className="vd-a4">
                    <h1>Hala Tuju Strategik HASA — Survey Report</h1>
                    <div className="rcsub">Hospital Al-Sultan Abdullah UiTM · Department of Risk Management, Compliance &amp; Quality · Generated {new Date().toLocaleDateString()}</div>
                    <div className="rcgrid">
                      <div className="rcm"><div className="l">Responses</div><div className="v">{total}</div></div>
                      <div className="rcm"><div className="l">Groups</div><div className="v">{Object.keys(countByGroup).length}/{groups.length}</div></div>
                      <div className="rcm"><div className="l">Happiness</div><div className="v">{headline.happy}%</div></div>
                      <div className="rcm"><div className="l">VMO familiar</div><div className="v">{headline.aware}%</div></div>
                      <div className="rcm"><div className="l">Wants update</div><div className="v">{headline.upd}%</div></div>
                    </div>
                    <h2 className="rch">Theme scores</h2>
                    <table className="vd-table"><tbody>
                      {VMO_THEMES.map((t) => { const { pct, n } = themePct(t.key); const h = heat(pct)
                        return <tr key={t.key}><td>{t.en}</td><td style={{ width: 90, padding: 3 }}><div className="vd-hm" style={{ background: h[0], color: h[1] }}>{pct}%</div></td><td style={{ color: 'var(--muted)', width: 60 }}>n={n}</td></tr> })}
                    </tbody></table>
                    <h2 className="rch">Responses by group</h2>
                    <table className="vd-table"><tbody>
                      {groups.map((g) => <tr key={g.code}><td>{g.name_ms}</td><td style={{ color: 'var(--muted)', width: 60 }}>{countByGroup[g.code] ?? 0}</td></tr>)}
                    </tbody></table>
                  </div>
                </>
              )}

              {tab === 'exp' && (
                <div className="card">
                  <h3 className="vd-h">Export raw data</h3>
                  <div className="vd-sub">One row per respondent: group, date, language, demographics, every scale answer (DK = tidak tahu), choice picks (pipe-separated), and the three open-text answers.</div>
                  <button type="button" className="vd-btn" onClick={exportCsv}>⬇ Download CSV</button>
                  <div className="vd-sub" style={{ marginTop: 14 }}>No identifiers are collected or exported — the survey is fully anonymous.</div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
