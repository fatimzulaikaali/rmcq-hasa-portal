'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { createClient } from '@/lib/supabase/client'
import {
  PscsAnswer, PscsCampaign, PscsComposite, PscsDepartment, PscsPosition, PscsQuestion, PscsResponse,
} from '@/lib/pscs/types'
import {
  BAND_COLOR, band, compositeStats, distribution, itemStats,
} from '@/lib/pscs/scoring'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Title)

/* ======================== TABS ======================== */
type TabId = 'overview' | 'composites' | 'item-level' | 'comments'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',   label: 'Overview',   icon: '📊' },
  { id: 'composites', label: 'Composites', icon: '📈' },
  { id: 'item-level', label: 'Item-Level', icon: '📋' },
  { id: 'comments',   label: 'Comments',   icon: '💬' },
]

/* ======================== PAGE ======================== */

export default function PscsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabId>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [campaigns, setCampaigns] = useState<PscsCampaign[] | null>(null)
  const [questions, setQuestions] = useState<PscsQuestion[] | null>(null)
  const [composites, setComposites] = useState<PscsComposite[] | null>(null)
  const [positions, setPositions] = useState<PscsPosition[] | null>(null)
  const [departments, setDepartments] = useState<PscsDepartment[] | null>(null)
  const [responses, setResponses] = useState<PscsResponse[] | null>(null)
  const [answers, setAnswers] = useState<PscsAnswer[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [campaignId, setCampaignId] = useState<number | null>(null)
  const [language, setLanguage] = useState<'en' | 'ms'>('en')

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    async function fetchAll<T>(table: string): Promise<T[]> {
      const PAGE = 1000
      const acc: T[] = []
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .range(offset, offset + PAGE - 1)
        if (error) throw new Error(`${table}: ${error.message}`)
        if (!data || data.length === 0) break
        acc.push(...(data as T[]))
        if (data.length < PAGE) break
      }
      return acc
    }
    ;(async () => {
      try {
        const [c, q, comps, p, d, r, a] = await Promise.all([
          fetchAll<PscsCampaign>('pscs_campaigns'),
          fetchAll<PscsQuestion>('pscs_questions'),
          fetchAll<PscsComposite>('pscs_composites'),
          fetchAll<PscsPosition>('pscs_positions'),
          fetchAll<PscsDepartment>('pscs_departments'),
          fetchAll<PscsResponse>('pscs_responses'),
          fetchAll<PscsAnswer>('pscs_answers'),
        ])
        if (cancelled) return
        setCampaigns(c)
        setQuestions(q.filter((x) => x.active))
        setComposites(comps.sort((x, y) => x.sort_order - y.sort_order))
        setPositions(p.filter((x) => x.active))
        setDepartments(d.filter((x) => x.active))
        setResponses(r)
        setAnswers(a)
        if (!campaignId && c.length > 0) {
          // Default to the most recent campaign that has responses, else most recent overall
          const respByCamp = new Map<number, number>()
          for (const row of r) respByCamp.set(row.campaign_id, (respByCamp.get(row.campaign_id) ?? 0) + 1)
          const withData = c.filter((x) => (respByCamp.get(x.id) ?? 0) > 0)
          setCampaignId((withData[0] ?? c[0]).id)
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load PSCS data')
      }
    })()
    return () => { cancelled = true }
  }, [campaignId])

  const loading = !campaigns || !questions || !composites || !positions || !departments || !responses || !answers
  const campaign = useMemo(() => campaigns?.find((c) => c.id === campaignId) ?? null, [campaigns, campaignId])

  const filteredResponses = useMemo(() => {
    if (!responses || !campaignId) return []
    return responses.filter((r) => r.campaign_id === campaignId)
  }, [responses, campaignId])
  const filteredAnswers = useMemo(() => {
    if (!answers) return []
    const ids = new Set(filteredResponses.map((r) => r.id))
    return answers.filter((a) => ids.has(a.response_id))
  }, [answers, filteredResponses])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="scrim" onClick={() => setSidebarOpen(false)} />

      <aside className="sidebar">
        <div className="sb-head">
          <div className="sb-logo">🛡️ Safety Culture</div>
          <div className="sb-sub">Patient Safety Culture Survey · {campaign?.code ?? '—'}</div>
        </div>

        <div className="nav-section">
          <div className="nav-lbl">Portal</div>
          <Link href="/ir" className="nav-item">
            <span className="nav-icon">🩺</span>
            <span>IR Dashboard</span>
          </Link>
          <Link href="/kpi" className="nav-item">
            <span className="nav-icon">📈</span>
            <span>KPI Monitor</span>
          </Link>
        </div>

        <div className="sb-filters">
          <div className="sf-lbl">🔎 Filters</div>
          <div className="filter-field">
            <label>Campaign</label>
            <select value={campaignId ?? ''} onChange={(e) => setCampaignId(parseInt(e.target.value, 10))}>
              {campaigns?.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name_en}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'ms')}>
              <option value="en">English</option>
              <option value="ms">Bahasa Malaysia</option>
            </select>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar" type="button">☰</button>
          <div className="tb-title">Patient Safety Culture Survey · {campaign?.code ?? '—'}</div>
          <div style={{ flex: 1 }} />
          <button onClick={handleLogout} className="signout-btn" type="button">Sign out</button>
        </div>

        <div className="tabbar" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
              type="button">
              <span className="tab-ico">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="content">
          {loadError && <div className="ac red"><div className="ai">⚠️</div><div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>}
          {loading && !loadError && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>}
          {!loading && !loadError && (
            <>
              {tab === 'overview'   && <OverviewTab responses={filteredResponses} positions={positions!} departments={departments!} language={language} />}
              {tab === 'composites' && <CompositesTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} language={language} />}
              {tab === 'item-level' && <ItemLevelTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} language={language} />}
              {tab === 'comments'   && <CommentsTab responses={filteredResponses} departments={departments!} positions={positions!} language={language} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/* ======================== TAB 1 — OVERVIEW ======================== */

function OverviewTab({ responses, positions, departments, language }: {
  responses: PscsResponse[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const total = responses.length

  // Demographic breakdowns
  const byPositionGroup = useMemo(() => {
    const m = new Map<string, number>()
    const groupByPos = new Map<number, { en: string; ms: string }>()
    for (const p of positions) groupByPos.set(p.id, { en: p.group_en, ms: p.group_ms })
    for (const r of responses) {
      const g = r.position_id ? groupByPos.get(r.position_id) : null
      const lbl = g ? (language === 'en' ? g.en : g.ms) : (language === 'en' ? 'Not specified' : 'Tidak dinyatakan')
      m.set(lbl, (m.get(lbl) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [responses, positions, language])

  const byDirectorate = useMemo(() => {
    const m = new Map<string, number>()
    const dirByDept = new Map<string, string>()
    const dirName = new Map<string, { en: string; ms: string }>()
    for (const d of departments) {
      if (d.kind === 'directorate') dirName.set(d.code, { en: d.name_en, ms: d.name_ms })
    }
    for (const d of departments) {
      if (d.kind === 'department' && d.parent_code) dirByDept.set(d.code, d.parent_code)
    }
    for (const r of responses) {
      const dc = r.department_code ? dirByDept.get(r.department_code) : null
      const nm = dc ? dirName.get(dc) : null
      const lbl = nm ? (language === 'en' ? nm.en : nm.ms) : (language === 'en' ? 'Not specified' : 'Tidak dinyatakan')
      m.set(lbl, (m.get(lbl) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [responses, departments, language])

  const byTenureHosp = useMemo(() => {
    const order = ['<1y', '1-5y', '6-10y', '11+y']
    const labels: Record<string, { en: string; ms: string }> = {
      '<1y':   { en: 'Less than 1 year',  ms: 'Kurang dari 1 tahun' },
      '1-5y':  { en: '1–5 years',         ms: '1–5 tahun' },
      '6-10y': { en: '6–10 years',        ms: '6–10 tahun' },
      '11+y':  { en: '11+ years',         ms: '11+ tahun' },
    }
    const m = new Map<string, number>()
    for (const o of order) m.set(o, 0)
    for (const r of responses) {
      if (r.tenure_hospital) m.set(r.tenure_hospital, (m.get(r.tenure_hospital) ?? 0) + 1)
    }
    return order.map((k) => ({ key: k, label: language === 'en' ? labels[k].en : labels[k].ms, count: m.get(k) ?? 0 }))
  }, [responses, language])

  const byContact = useMemo(() => {
    let yes = 0, no = 0, unk = 0
    for (const r of responses) {
      if (r.direct_patient_contact === true) yes++
      else if (r.direct_patient_contact === false) no++
      else unk++
    }
    return { yes, no, unk }
  }, [responses])

  return (
    <div className="pscs-page">
      <Panel title="Survey Overview">
        <div className="pscs-tiles">
          <Tile label={language === 'en' ? 'Total responses' : 'Jumlah maklum balas'} value={String(total)} color="#0EA5E9" />
          <Tile label={language === 'en' ? 'Position groups' : 'Kumpulan kakitangan'} value={String(byPositionGroup.length)} color="#14B8A6" />
          <Tile label={language === 'en' ? 'Directorates covered' : 'Direktorat dilibatkan'} value={String(byDirectorate.length)} color="#F59E0B" />
          <Tile label={language === 'en' ? 'With patient contact' : 'Interaksi pesakit'} value={`${byContact.yes}`} color="#16A34A" />
        </div>
      </Panel>

      <Panel title={language === 'en' ? 'Responses by Staff Group' : 'Maklum balas mengikut Kumpulan Kakitangan'}>
        <DistList items={byPositionGroup.map(([label, n]) => ({ label, count: n, total }))} />
      </Panel>

      <Panel title={language === 'en' ? 'Responses by Directorate' : 'Maklum balas mengikut Direktorat'}>
        <DistList items={byDirectorate.map(([label, n]) => ({ label, count: n, total }))} />
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Panel title={language === 'en' ? 'Tenure in Hospital' : 'Tempoh di Hospital'}>
          <DistList items={byTenureHosp.map((t) => ({ label: t.label, count: t.count, total }))} />
        </Panel>
        <Panel title={language === 'en' ? 'Direct Patient Contact' : 'Interaksi Langsung dengan Pesakit'}>
          <DistList items={[
            { label: language === 'en' ? 'Yes' : 'Ya', count: byContact.yes, total },
            { label: language === 'en' ? 'No' : 'Tidak', count: byContact.no, total },
            ...(byContact.unk > 0 ? [{ label: language === 'en' ? 'Not specified' : 'Tidak dinyatakan', count: byContact.unk, total }] : []),
          ]} />
        </Panel>
      </div>
    </div>
  )
}

/* ======================== TAB 2 — COMPOSITES ======================== */

function CompositesTab({ responses, answers, questions, composites, language }: {
  responses: PscsResponse[]
  answers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  language: 'en' | 'ms'
}) {
  void responses
  // 10 SOPS + REP_FREQ — exclude RATING (it's not a composite, shown separately)
  const compsForChart = composites.filter((c) => !c.is_rating)
  const stats = useMemo(
    () => compsForChart.map((c) => ({ composite: c, stats: compositeStats(c.code, questions, answers) })),
    [compsForChart, questions, answers],
  )

  // Hospital average — mean of available composite scores
  const avg = useMemo(() => {
    const valid = stats.filter((s) => s.stats.score !== null)
    if (valid.length === 0) return null
    return valid.reduce((s, x) => s + (x.stats.score ?? 0), 0) / valid.length
  }, [stats])

  return (
    <div className="pscs-page">
      <Panel title={language === 'en' ? 'Composite Measure Results' : 'Keputusan Skor Komposit'}>
        <table className="pscs-comp-table">
          <thead>
            <tr>
              <th>{language === 'en' ? 'Composite' : 'Komposit'}</th>
              <th style={{ width: 380 }}>{language === 'en' ? '% Positive' : '% Positif'}</th>
              <th style={{ width: 100, textAlign: 'right' }}>{language === 'en' ? 'Score' : 'Skor'}</th>
              <th style={{ width: 80, textAlign: 'center' }}>n</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(({ composite: c, stats: s }) => {
              const name = language === 'en' ? c.name_en : c.name_ms
              const bnd = band(s.score)
              return (
                <tr key={c.code}>
                  <td>{name}{c.is_custom && <span className="custom-tag">HASA</span>}</td>
                  <td>
                    {s.score !== null ? (
                      <div className="cbar">
                        <div className="cbar-fill" style={{ width: `${s.score}%`, background: BAND_COLOR[bnd] }}>
                          <span className="cbar-num">{Math.round(s.score)}%</span>
                        </div>
                      </div>
                    ) : (
                      <span className="cbar-empty">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: BAND_COLOR[bnd] }}>
                    {s.score !== null ? `${Math.round(s.score)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
                    {s.itemsWithScore}/{s.itemsTotal}
                  </td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
              <td>{language === 'en' ? 'Composite Measure Average' : 'Purata Komposit'}</td>
              <td>
                {avg !== null ? (
                  <div className="cbar">
                    <div className="cbar-fill" style={{ width: `${avg}%`, background: BAND_COLOR[band(avg)] }}>
                      <span className="cbar-num">{Math.round(avg)}%</span>
                    </div>
                  </div>
                ) : '—'}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: avg !== null ? BAND_COLOR[band(avg)] : 'var(--muted)' }}>
                {avg !== null ? `${Math.round(avg)}%` : '—'}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
        <div className="pscs-legend">
          <span><span className="lg-dot" style={{ background: BAND_COLOR.strength }} /> Strength ≥ 75%</span>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.watch }} /> Watch 50–74%</span>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.gap }} /> Gap &lt; 50%</span>
        </div>
      </Panel>

      <Panel title={language === 'en' ? 'Number of Events Reported (D3) & Patient Safety Rating (E1)' : 'Bilangan Insiden Dilaporkan (D3) & Tahap Keselamatan (E1)'}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DistChartCard
            title={language === 'en' ? 'D3 — Events reported (past 12 months)' : 'D3 — Insiden dilaporkan (12 bulan)'}
            buckets={distribution('D3', answers).items}
            labels={language === 'en'
              ? ['None', '1–2', '3–5', '6–10', '11 or more']
              : ['Tiada', '1–2', '3–5', '6–10', '11 atau lebih']}
            positiveFromValue={2}
          />
          <DistChartCard
            title={language === 'en' ? 'E1 — Patient Safety Rating' : 'E1 — Tahap Keselamatan Pesakit'}
            buckets={distribution('E1', answers).items}
            labels={language === 'en'
              ? ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent']
              : ['Lemah', 'Boleh Tahan', 'Bagus', 'Sangat Bagus', 'Cemerlang']}
            positiveFromValue={4}
          />
        </div>
      </Panel>
    </div>
  )
}

/* ======================== TAB 3 — ITEM-LEVEL ======================== */

function ItemLevelTab({ responses, answers, questions, composites, language }: {
  responses: PscsResponse[]
  answers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  language: 'en' | 'ms'
}) {
  void responses
  return (
    <div className="pscs-page">
      {composites.filter((c) => !c.is_rating).map((c) => {
        const qs = questions.filter((q) => q.composite_code === c.code).sort((a, b) => a.sort_order - b.sort_order)
        if (qs.length === 0) return null
        return (
          <Panel key={c.code} title={`${c.code} · ${language === 'en' ? c.name_en : c.name_ms}`}>
            {qs.map((q) => {
              const st = itemStats(q, answers)
              return (
                <div key={q.id} className="il-row">
                  <div className="il-meta">
                    <span className="il-num">{q.id}</span>
                    {q.wording === '-' && <span className="il-rev" title="Negatively worded (reverse-scored)">−</span>}
                    <span className="il-text">{language === 'en' ? q.text_en : q.text_ms}</span>
                  </div>
                  <div className="il-bar">
                    {st.total === 0 ? (
                      <div className="il-empty">—</div>
                    ) : (
                      <>
                        <div className="il-seg pos" style={{ width: `${st.pct_positive}%` }} title={`Positive ${st.positive}`}>
                          {st.pct_positive >= 8 && `${Math.round(st.pct_positive)}%`}
                        </div>
                        <div className="il-seg neu" style={{ width: `${st.pct_neutral}%` }} title={`Neutral ${st.neutral}`}>
                          {st.pct_neutral >= 8 && `${Math.round(st.pct_neutral)}%`}
                        </div>
                        <div className="il-seg neg" style={{ width: `${st.pct_negative}%` }} title={`Negative ${st.negative}`}>
                          {st.pct_negative >= 8 && `${Math.round(st.pct_negative)}%`}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="il-n">n = {st.total}</div>
                </div>
              )
            })}
          </Panel>
        )
      })}
    </div>
  )
}

/* ======================== TAB 4 — COMMENTS ======================== */

function CommentsTab({ responses, departments, positions, language }: {
  responses: PscsResponse[]
  departments: PscsDepartment[]
  positions: PscsPosition[]
  language: 'en' | 'ms'
}) {
  const [search, setSearch] = useState('')
  const deptByCode = useMemo(() => {
    const m = new Map<string, PscsDepartment>()
    for (const d of departments) m.set(d.code, d)
    return m
  }, [departments])
  const posById = useMemo(() => {
    const m = new Map<number, PscsPosition>()
    for (const p of positions) m.set(p.id, p)
    return m
  }, [positions])

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return responses
      .filter((r) => r.comment && r.comment.trim().length > 0)
      .filter((r) => !q || (r.comment ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
  }, [responses, search])

  return (
    <div className="pscs-page">
      <Panel title={`${language === 'en' ? 'Open-ended Comments' : 'Komen'} (${items.length})`}>
        <input
          type="search"
          className="pscs-search"
          placeholder={language === 'en' ? 'Search comments…' : 'Cari komen…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {items.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '12px 0' }}>
            {language === 'en' ? 'No comments to show.' : 'Tiada komen.'}
          </p>
        ) : (
          <div className="comments-list">
            {items.map((r) => {
              const pos = r.position_id ? posById.get(r.position_id) : null
              const dept = r.department_code ? deptByCode.get(r.department_code) : null
              const sub  = r.sub_department_code ? deptByCode.get(r.sub_department_code) : null
              const meta = [
                pos && (language === 'en' ? pos.name_en : pos.name_ms),
                sub  ? (language === 'en' ? sub.name_en  : sub.name_ms)
                     : (dept ? (language === 'en' ? dept.name_en : dept.name_ms) : null),
                new Date(r.submitted_at).toISOString().slice(0, 10),
              ].filter(Boolean).join(' · ')
              return (
                <div key={r.id} className="comment-card">
                  <div className="comment-meta">{meta}</div>
                  <div className="comment-body">{r.comment}</div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ======================== SUB-COMPONENTS ======================== */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="pt">{title}</h2>
      <div className="pb">{children}</div>
    </section>
  )
}

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="tile">
      <div className="tl">{label}</div>
      <div className="tv" style={{ color }}>{value}</div>
    </div>
  )
}

function DistList({ items }: { items: { label: string; count: number; total: number }[] }) {
  return (
    <div className="dl">
      {items.map((it) => {
        const pct = it.total === 0 ? 0 : (it.count / it.total) * 100
        return (
          <div key={it.label} className="dl-row">
            <div className="dl-label" title={it.label}>{it.label}</div>
            <div className="dl-bar"><div className="dl-fill" style={{ width: `${pct}%` }} /></div>
            <div className="dl-n">{it.count} · {Math.round(pct)}%</div>
          </div>
        )
      })}
    </div>
  )
}

function DistChartCard({ title, buckets, labels, positiveFromValue }: {
  title: string
  buckets: { value: number; count: number; pct: number }[]
  labels: string[]
  positiveFromValue: number  // bars with value ≥ this are colored green; below are red
}) {
  const positiveTotal = buckets.filter((b) => b.value >= positiveFromValue).reduce((s, b) => s + b.pct, 0)
  return (
    <div className="dc-card">
      <div className="dc-title">{title}</div>
      <div className="dc-pct" style={{ color: BAND_COLOR[band(positiveTotal)] }}>
        {Math.round(positiveTotal)}% positive
      </div>
      <Bar
        data={{
          labels,
          datasets: [{
            data: buckets.map((b) => Math.round(b.pct)),
            backgroundColor: buckets.map((b) => b.value >= positiveFromValue ? '#16A34A' : '#DC2626'),
            borderRadius: 4,
            borderWidth: 0,
          }],
        }}
        options={{
          responsive: true,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw}%` } } },
          scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%`, font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } },
        }}
      />
    </div>
  )
}
