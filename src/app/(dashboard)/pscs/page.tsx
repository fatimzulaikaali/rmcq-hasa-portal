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
  BAND_COLOR, BAND_LABEL, band, BreakdownGroup, BreakdownRow, breakdownMatrix,
  compositeStats, distribution, itemStats,
} from '@/lib/pscs/scoring'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Title)

/* ======================== TABS ======================== */
type TabId = 'overview' | 'composites' | 'item-level' | 'breakdowns' | 'comments'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',   label: 'Overview',   icon: '📊' },
  { id: 'composites', label: 'Composites', icon: '📈' },
  { id: 'item-level', label: 'Item-Level', icon: '📋' },
  { id: 'breakdowns', label: 'Breakdowns', icon: '🧭' },
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
              {tab === 'breakdowns' && <BreakdownsTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} positions={positions!} departments={departments!} language={language} />}
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

/* ======================== TAB 4 — BREAKDOWNS ======================== */

type CompareAxis = 'department' | 'subunit' | 'posgroup' | 'position' | 'tenure' | 'hours' | 'contact'
type ViewMode   = 'composites' | 'events'
type ContactFilter = 'all' | 'yes' | 'no'

interface BreakdownFilters {
  directorate: string          // 'all' | directorate code
  department:  string          // 'all' | department code
  subunit:     string          // 'all' | sub-unit code
  posgroup:    string          // 'all' | group_en
  position:    string          // 'all' | position_id as string
  tenure:      string          // 'all' | tenure_hospital value
  hours:       string          // 'all' | hours_per_week value ('<30','30-40','>40')
  contact:     ContactFilter
}

const EMPTY_FILTERS: BreakdownFilters = {
  directorate: 'all', department: 'all', subunit: 'all',
  posgroup: 'all', position: 'all', tenure: 'all', hours: 'all', contact: 'all',
}

const TENURE_OPTIONS: { key: string; en: string; ms: string }[] = [
  { key: '<1y',   en: 'Less than 1 year', ms: 'Kurang dari 1 tahun' },
  { key: '1-5y',  en: '1–5 years',        ms: '1–5 tahun' },
  { key: '6-10y', en: '6–10 years',       ms: '6–10 tahun' },
  { key: '11+y',  en: '11+ years',        ms: '11+ tahun' },
]

// Working hours per week — labels match the survey form exactly.
const HOURS_OPTIONS: { key: string; en: string; ms: string }[] = [
  { key: '<30',   en: 'Less than 30 hours per week', ms: 'Kurang dari 30 jam seminggu' },
  { key: '30-40', en: '30 to 40 hours per week',     ms: '30 hingga 40 jam seminggu' },
  { key: '>40',   en: 'More than 40 hours per week', ms: 'Lebih dari 40 jam seminggu' },
]

const COMPARE_OPTIONS: { id: CompareAxis; en: string; ms: string }[] = [
  { id: 'department', en: 'Department',     ms: 'Jabatan' },
  { id: 'subunit',    en: 'Sub-unit',       ms: 'Sub-unit' },
  { id: 'posgroup',   en: 'Position Group', ms: 'Kumpulan Kakitangan' },
  { id: 'position',   en: 'Position',       ms: 'Jawatan' },
  { id: 'tenure',     en: 'Tenure',         ms: 'Tempoh di Hospital' },
  { id: 'hours',      en: 'Working Hours',  ms: 'Waktu Bekerja' },
  { id: 'contact',    en: 'Patient Contact', ms: 'Interaksi Pesakit' },
]

const GROUP_MIN_RESPONSES = 3

function BreakdownsTab({
  responses, answers, questions, composites, positions, departments, language,
}: {
  responses: PscsResponse[]
  answers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const [filters, setFilters] = useState<BreakdownFilters>(EMPTY_FILTERS)
  const [compareBy, setCompareBy] = useState<CompareAxis>('department')
  const [view, setView] = useState<ViewMode>('composites')

  /* ----- lookup maps ----- */
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

  /* ----- filter dropdown options (cascading) ----- */
  const directorateOpts = useMemo(
    () => departments.filter((d) => d.kind === 'directorate').sort((a, b) => a.sort_order - b.sort_order),
    [departments],
  )
  const departmentOpts = useMemo(
    () => departments
      .filter((d) => d.kind === 'department')
      .filter((d) => filters.directorate === 'all' || d.parent_code === filters.directorate)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, filters.directorate],
  )
  const subunitOpts = useMemo(
    () => filters.department === 'all' ? [] : departments
      .filter((d) => d.kind === 'subunit' && d.parent_code === filters.department)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, filters.department],
  )
  const posGroupOpts = useMemo(() => {
    const seen = new Map<string, { en: string; ms: string; sort: number }>()
    for (const p of positions) {
      if (!seen.has(p.group_en)) seen.set(p.group_en, { en: p.group_en, ms: p.group_ms, sort: p.sort_order })
    }
    return Array.from(seen.entries())
      .map(([key, v]) => ({ key, en: v.en, ms: v.ms, sort: v.sort }))
      .sort((a, b) => a.sort - b.sort)
  }, [positions])
  const positionOpts = useMemo(
    () => positions
      .filter((p) => filters.posgroup === 'all' || p.group_en === filters.posgroup)
      .sort((a, b) => a.sort_order - b.sort_order),
    [positions, filters.posgroup],
  )

  /* ----- update a filter (cascading reset of children) ----- */
  function setFilter<K extends keyof BreakdownFilters>(key: K, value: BreakdownFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'directorate') { next.department = 'all'; next.subunit = 'all' }
      if (key === 'department')  { next.subunit = 'all' }
      if (key === 'posgroup')    { next.position = 'all' }
      return next
    })
  }

  /* ----- filter responses ----- */
  const filteredResponses = useMemo(() => responses.filter((r) => {
    if (filters.directorate !== 'all') {
      const d = r.department_code ? deptByCode.get(r.department_code) : null
      if (!d || d.parent_code !== filters.directorate) return false
    }
    if (filters.department !== 'all' && r.department_code !== filters.department) return false
    if (filters.subunit !== 'all' && r.sub_department_code !== filters.subunit) return false
    if (filters.posgroup !== 'all') {
      const p = r.position_id ? posById.get(r.position_id) : null
      if (!p || p.group_en !== filters.posgroup) return false
    }
    if (filters.position !== 'all' && String(r.position_id ?? '') !== filters.position) return false
    if (filters.tenure !== 'all' && r.tenure_hospital !== filters.tenure) return false
    if (filters.hours  !== 'all' && r.hours_per_week  !== filters.hours)  return false
    if (filters.contact === 'yes' && r.direct_patient_contact !== true)  return false
    if (filters.contact === 'no'  && r.direct_patient_contact !== false) return false
    return true
  }), [responses, filters, deptByCode, posById])

  /* ----- group filtered responses by the Compare-by axis ----- */
  const groups = useMemo<BreakdownGroup<PscsResponse>[]>(() => {
    if (compareBy === 'department') {
      const byKey = new Map<string, PscsResponse[]>()
      for (const r of filteredResponses) {
        const k = r.department_code ?? '__none__'
        if (!byKey.has(k)) byKey.set(k, [])
        byKey.get(k)!.push(r)
      }
      return Array.from(byKey.entries()).map(([k, rs]) => {
        const d = deptByCode.get(k)
        return {
          key: k,
          label_en: d?.name_en ?? (k === '__none__' ? 'Not specified' : k),
          label_ms: d?.name_ms ?? (k === '__none__' ? 'Tidak dinyatakan' : k),
          responses: rs,
        }
      }).sort((a, b) => b.responses.length - a.responses.length)
    }
    if (compareBy === 'subunit') {
      const byKey = new Map<string, PscsResponse[]>()
      for (const r of filteredResponses) {
        const k = r.sub_department_code ?? '__none__'
        if (!byKey.has(k)) byKey.set(k, [])
        byKey.get(k)!.push(r)
      }
      return Array.from(byKey.entries()).map(([k, rs]) => {
        const d = deptByCode.get(k)
        return {
          key: k,
          label_en: d?.name_en ?? (k === '__none__' ? 'Department-level (no sub-unit)' : k),
          label_ms: d?.name_ms ?? (k === '__none__' ? 'Peringkat Jabatan (tiada sub-unit)' : k),
          responses: rs,
        }
      }).sort((a, b) => b.responses.length - a.responses.length)
    }
    if (compareBy === 'posgroup') {
      const byKey = new Map<string, { en: string; ms: string; rs: PscsResponse[] }>()
      for (const r of filteredResponses) {
        const p = r.position_id ? posById.get(r.position_id) : null
        const k = p?.group_en ?? '__none__'
        if (!byKey.has(k)) byKey.set(k, { en: p?.group_en ?? 'Not specified', ms: p?.group_ms ?? 'Tidak dinyatakan', rs: [] })
        byKey.get(k)!.rs.push(r)
      }
      return Array.from(byKey.entries())
        .map(([k, v]) => ({ key: k, label_en: v.en, label_ms: v.ms, responses: v.rs }))
        .sort((a, b) => b.responses.length - a.responses.length)
    }
    if (compareBy === 'position') {
      const byKey = new Map<string, { en: string; ms: string; rs: PscsResponse[] }>()
      for (const r of filteredResponses) {
        const p = r.position_id ? posById.get(r.position_id) : null
        const k = r.position_id != null ? String(r.position_id) : '__none__'
        if (!byKey.has(k)) byKey.set(k, { en: p?.name_en ?? 'Not specified', ms: p?.name_ms ?? 'Tidak dinyatakan', rs: [] })
        byKey.get(k)!.rs.push(r)
      }
      return Array.from(byKey.entries())
        .map(([k, v]) => ({ key: k, label_en: v.en, label_ms: v.ms, responses: v.rs }))
        .sort((a, b) => b.responses.length - a.responses.length)
    }
    if (compareBy === 'tenure') {
      const order = [...TENURE_OPTIONS, { key: '__none__', en: 'Not specified', ms: 'Tidak dinyatakan' }]
      const byKey = new Map<string, PscsResponse[]>()
      for (const r of filteredResponses) {
        const k = r.tenure_hospital ?? '__none__'
        if (!byKey.has(k)) byKey.set(k, [])
        byKey.get(k)!.push(r)
      }
      return order.filter((o) => byKey.has(o.key))
        .map((o) => ({ key: o.key, label_en: o.en, label_ms: o.ms, responses: byKey.get(o.key)! }))
    }
    if (compareBy === 'hours') {
      const order = [...HOURS_OPTIONS, { key: '__none__', en: 'Not specified', ms: 'Tidak dinyatakan' }]
      const byKey = new Map<string, PscsResponse[]>()
      for (const r of filteredResponses) {
        const k = r.hours_per_week ?? '__none__'
        if (!byKey.has(k)) byKey.set(k, [])
        byKey.get(k)!.push(r)
      }
      return order.filter((o) => byKey.has(o.key))
        .map((o) => ({ key: o.key, label_en: o.en, label_ms: o.ms, responses: byKey.get(o.key)! }))
    }
    if (compareBy === 'contact') {
      const yes: PscsResponse[] = [], no: PscsResponse[] = [], unk: PscsResponse[] = []
      for (const r of filteredResponses) {
        if (r.direct_patient_contact === true) yes.push(r)
        else if (r.direct_patient_contact === false) no.push(r)
        else unk.push(r)
      }
      const out: BreakdownGroup<PscsResponse>[] = []
      if (yes.length > 0) out.push({ key: 'yes', label_en: 'Yes — direct patient contact', label_ms: 'Ya — interaksi langsung', responses: yes })
      if (no.length > 0)  out.push({ key: 'no',  label_en: 'No — no direct contact',       label_ms: 'Tidak — tiada interaksi langsung', responses: no })
      if (unk.length > 0) out.push({ key: 'unk', label_en: 'Not specified', label_ms: 'Tidak dinyatakan', responses: unk })
      return out
    }
    return []
  }, [compareBy, filteredResponses, deptByCode, posById])

  /* ----- matrix (composites view) ----- */
  const matrix = useMemo<BreakdownRow[]>(
    () => breakdownMatrix(groups, composites, questions, answers, GROUP_MIN_RESPONSES),
    [groups, composites, questions, answers],
  )
  const compsForMatrix = composites.filter((c) => !c.is_rating)
  const suppressedCount = matrix.filter((row) => row.suppressed).length

  /* ----- summary line ----- */
  const totalFiltered = filteredResponses.length
  const totalAll = responses.length
  const activeFilterCount = (Object.keys(filters) as (keyof BreakdownFilters)[])
    .filter((k) => filters[k] !== 'all').length

  return (
    <div className="pscs-page">
      <Panel title={language === 'en' ? 'Cohort Breakdowns' : 'Pecahan Mengikut Kumpulan'}>
        {/* View toggle */}
        <div className="bd-view-toggle">
          <button type="button"
            className={`bd-toggle ${view === 'composites' ? 'active' : ''}`}
            onClick={() => setView('composites')}>
            {language === 'en' ? 'Composites' : 'Komposit'}
          </button>
          <button type="button"
            className={`bd-toggle ${view === 'events' ? 'active' : ''}`}
            onClick={() => setView('events')}>
            {language === 'en' ? 'Events & Rating' : 'Insiden & Tahap'}
          </button>
        </div>

        {/* Filter row */}
        <div className="bd-filters">
          <FilterSelect
            label={language === 'en' ? 'Directorate' : 'Direktorat'}
            value={filters.directorate}
            onChange={(v) => setFilter('directorate', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...directorateOpts.map((d) => ({ value: d.code, label: language === 'en' ? d.name_en : d.name_ms })),
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Department' : 'Jabatan'}
            value={filters.department}
            onChange={(v) => setFilter('department', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...departmentOpts.map((d) => ({ value: d.code, label: language === 'en' ? d.name_en : d.name_ms })),
            ]}
          />
          {subunitOpts.length > 0 && (
            <FilterSelect
              label={language === 'en' ? 'Sub-unit' : 'Sub-unit'}
              value={filters.subunit}
              onChange={(v) => setFilter('subunit', v)}
              options={[
                { value: 'all', label: language === 'en' ? 'All sub-units' : 'Semua sub-unit' },
                ...subunitOpts.map((d) => ({ value: d.code, label: language === 'en' ? d.name_en : d.name_ms })),
              ]}
            />
          )}
          <FilterSelect
            label={language === 'en' ? 'Position Group' : 'Kumpulan Kakitangan'}
            value={filters.posgroup}
            onChange={(v) => setFilter('posgroup', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...posGroupOpts.map((g) => ({ value: g.key, label: language === 'en' ? g.en : g.ms })),
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Position' : 'Jawatan'}
            value={filters.position}
            onChange={(v) => setFilter('position', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...positionOpts.map((p) => ({ value: String(p.id), label: language === 'en' ? p.name_en : p.name_ms })),
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Tenure' : 'Tempoh'}
            value={filters.tenure}
            onChange={(v) => setFilter('tenure', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...TENURE_OPTIONS.map((t) => ({ value: t.key, label: language === 'en' ? t.en : t.ms })),
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Working Hours' : 'Waktu Bekerja'}
            value={filters.hours}
            onChange={(v) => setFilter('hours', v)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              ...HOURS_OPTIONS.map((h) => ({ value: h.key, label: language === 'en' ? h.en : h.ms })),
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Patient Contact' : 'Interaksi Pesakit'}
            value={filters.contact}
            onChange={(v) => setFilter('contact', v as ContactFilter)}
            options={[
              { value: 'all', label: language === 'en' ? 'All' : 'Semua' },
              { value: 'yes', label: language === 'en' ? 'Yes' : 'Ya' },
              { value: 'no',  label: language === 'en' ? 'No' : 'Tidak' },
            ]}
          />
          <FilterSelect
            label={language === 'en' ? 'Compare by' : 'Bandingkan mengikut'}
            value={compareBy}
            onChange={(v) => setCompareBy(v as CompareAxis)}
            options={COMPARE_OPTIONS.map((o) => ({ value: o.id, label: language === 'en' ? o.en : o.ms }))}
            emphasis />
          {activeFilterCount > 0 && (
            <button type="button" className="bd-reset" onClick={() => setFilters(EMPTY_FILTERS)}>
              {language === 'en' ? `Reset filters (${activeFilterCount})` : `Set semula penapis (${activeFilterCount})`}
            </button>
          )}
        </div>

        <p className="bd-note">
          {language === 'en'
            ? `Showing ${totalFiltered} of ${totalAll} responses, grouped by ${COMPARE_OPTIONS.find((o) => o.id === compareBy)!.en}. Cohorts with fewer than ${GROUP_MIN_RESPONSES} responses are marked "small n" and cells are hidden for anonymity. "—" means AHRQ's per-item minimum (≥3 valid responses) wasn't met.`
            : `Menunjukkan ${totalFiltered} daripada ${totalAll} maklum balas, dikumpulkan mengikut ${COMPARE_OPTIONS.find((o) => o.id === compareBy)!.ms}. Kumpulan dengan kurang daripada ${GROUP_MIN_RESPONSES} maklum balas ditandakan "n kecil" dan sel disembunyikan untuk anonimiti. "—" bermaksud syarat minimum AHRQ (≥3 maklum balas sah setiap item) tidak dipenuhi.`}
        </p>
      </Panel>

      <Panel title={view === 'composites'
        ? (language === 'en' ? 'Composite % Positive' : 'Komposit % Positif')
        : (language === 'en' ? 'Events Reported (D3) & Patient Safety Rating (E1)' : 'Insiden Dilaporkan (D3) & Tahap Keselamatan (E1)')}>
        {groups.length === 0 ? (
          <p className="bd-empty">{language === 'en' ? 'No responses match these filters.' : 'Tiada maklum balas untuk penapis ini.'}</p>
        ) : view === 'composites' ? (
          <div className="bd-table-wrap">
            <table className="bd-matrix">
              <thead>
                <tr>
                  <th className="bd-row-head">{language === 'en' ? 'Group' : 'Kumpulan'}</th>
                  <th className="bd-n">n</th>
                  <th className="bd-overall">{language === 'en' ? 'Avg' : 'Purata'}</th>
                  {compsForMatrix.map((c) => (
                    <th key={c.code} className="bd-comp" title={language === 'en' ? c.name_en : c.name_ms}>
                      {c.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.key} className={row.suppressed ? 'bd-suppressed' : ''}>
                    <td className="bd-row-head">{language === 'en' ? row.label_en : row.label_ms}</td>
                    <td className="bd-n">
                      {row.n}
                      {row.suppressed && (
                        <span className="bd-smalln" title={language === 'en'
                          ? `Fewer than ${GROUP_MIN_RESPONSES} responses — cells hidden for anonymity`
                          : `Kurang daripada ${GROUP_MIN_RESPONSES} maklum balas — sel disembunyikan`}>
                          {language === 'en' ? 'small n' : 'n kecil'}
                        </span>
                      )}
                    </td>
                    <td className="bd-overall">
                      {row.suppressed ? '·' : row.overall === null
                        ? <span className="bd-na" title={BAND_LABEL.na}>—</span>
                        : <span style={{ color: BAND_COLOR[band(row.overall)], fontWeight: 700 }}>{Math.round(row.overall)}%</span>}
                    </td>
                    {compsForMatrix.map((c) => {
                      const s = row.perComposite.get(c.code) ?? null
                      return (
                        <td key={c.code} className="bd-cell">
                          {row.suppressed ? <span className="bd-na">·</span>
                            : s === null ? <span className="bd-na" title={BAND_LABEL.na}>—</span>
                            : <span style={{ color: BAND_COLOR[band(s)], fontWeight: 700 }}>{Math.round(s)}%</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EventsRatingTable groups={groups} answers={answers} language={language} />
        )}

        <div className="pscs-legend" style={{ marginTop: 10 }}>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.strength }} /> ≥ 75%</span>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.watch }} /> 50–74%</span>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.gap }} /> &lt; 50%</span>
          <span><span className="lg-dot" style={{ background: BAND_COLOR.na }} /> {language === 'en' ? 'insufficient' : 'tidak cukup'}</span>
          {suppressedCount > 0 && view === 'composites' && (
            <span style={{ color: 'var(--muted)' }}>
              {language === 'en'
                ? `${suppressedCount} cohort${suppressedCount === 1 ? '' : 's'} hidden (n < ${GROUP_MIN_RESPONSES})`
                : `${suppressedCount} kumpulan disembunyikan (n < ${GROUP_MIN_RESPONSES})`}
            </span>
          )}
        </div>
      </Panel>
    </div>
  )
}

/* Single-axis events & rating table, grouped by the same compare-by axis as composites. */
function EventsRatingTable({ groups, answers, language }: {
  groups: BreakdownGroup<PscsResponse>[]
  answers: PscsAnswer[]
  language: 'en' | 'ms'
}) {
  const rows = useMemo(() => groups.map((g) => {
    const ids = new Set(g.responses.map((r) => r.id))
    const groupAnswers = answers.filter((a) => ids.has(a.response_id))
    const d3 = distribution('D3', groupAnswers)
    const e1 = distribution('E1', groupAnswers)
    const d3Positive = d3.items.filter((b) => b.value >= 2).reduce((s, b) => s + b.pct, 0)
    const e1Positive = e1.items.filter((b) => b.value >= 4).reduce((s, b) => s + b.pct, 0)
    return {
      key: g.key,
      label_en: g.label_en,
      label_ms: g.label_ms,
      n: g.responses.length,
      suppressed: g.responses.length < GROUP_MIN_RESPONSES,
      d3Positive: d3.total === 0 ? null : d3Positive,
      e1Positive: e1.total === 0 ? null : e1Positive,
    }
  }), [groups, answers])

  return (
    <div className="bd-table-wrap">
      <table className="bd-matrix">
        <thead>
          <tr>
            <th className="bd-row-head">{language === 'en' ? 'Group' : 'Kumpulan'}</th>
            <th className="bd-n">n</th>
            <th className="bd-overall" title={language === 'en' ? 'D3 — reported ≥1 event in past 12 months' : 'D3 — laporkan ≥1 insiden dalam 12 bulan'}>D3 ≥1</th>
            <th className="bd-overall" title={language === 'en' ? 'E1 — Very Good or Excellent rating' : 'E1 — Sangat Bagus / Cemerlang'}>E1 ≥VG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.suppressed ? 'bd-suppressed' : ''}>
              <td className="bd-row-head">{language === 'en' ? row.label_en : row.label_ms}</td>
              <td className="bd-n">
                {row.n}
                {row.suppressed && <span className="bd-smalln">{language === 'en' ? 'small n' : 'n kecil'}</span>}
              </td>
              <td className="bd-overall">
                {row.suppressed ? '·'
                  : row.d3Positive === null ? <span className="bd-na">—</span>
                  : <span style={{ color: BAND_COLOR[band(row.d3Positive)], fontWeight: 700 }}>{Math.round(row.d3Positive)}%</span>}
              </td>
              <td className="bd-overall">
                {row.suppressed ? '·'
                  : row.e1Positive === null ? <span className="bd-na">—</span>
                  : <span style={{ color: BAND_COLOR[band(row.e1Positive)], fontWeight: 700 }}>{Math.round(row.e1Positive)}%</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, emphasis }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  emphasis?: boolean
}) {
  return (
    <label className={`bd-fld ${emphasis ? 'emph' : ''}`}>
      <span className="bd-fld-lbl">{label}</span>
      <select className="bd-fld-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

/* ======================== TAB 5 — COMMENTS ======================== */

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
