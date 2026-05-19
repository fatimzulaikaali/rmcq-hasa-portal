'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import React, { useEffect, useMemo, useState } from 'react'
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
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import {
  PscsAnswer, PscsCampaign, PscsComposite, PscsDepartment, PscsPosition, PscsQuestion, PscsResponse,
} from '@/lib/pscs/types'
import {
  BAND_COLOR, BAND_LABEL, band, BreakdownGroup, BreakdownRow, breakdownMatrix,
  answersForResponses, compositeStats, distribution, isStandaloneComposite, itemStats,
} from '@/lib/pscs/scoring'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend, Title)

/* ======================== TABS ======================== */
type TabId = 'overview' | 'composites' | 'item-level' | 'breakdowns' | 'comments' | 'reportcard'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview',   label: 'Overview',   icon: '📊' },
  { id: 'composites', label: 'Composites', icon: '📈' },
  { id: 'item-level', label: 'Item-Level', icon: '📋' },
  { id: 'breakdowns', label: 'Breakdowns', icon: '🧭' },
  { id: 'comments',   label: 'Comments',   icon: '💬' },
  { id: 'reportcard', label: 'Report Card', icon: '📄' },
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

  /* ----- Raw-data Excel export for the selected campaign ----- */
  function downloadExcel() {
    if (!campaign || !questions || !composites || !positions || !departments || !responses || !answers) return

    // Lookup maps
    const posById = new Map(positions.map((p) => [p.id, p]))
    const deptByCode = new Map(departments.map((d) => [d.code, d]))
    function directorateFor(deptCode: string | null): PscsDepartment | null {
      if (!deptCode) return null
      const d = deptByCode.get(deptCode)
      if (!d || !d.parent_code) return null
      return deptByCode.get(d.parent_code) ?? null
    }

    // Filter answers to selected campaign's responses
    const respIds = new Set(filteredResponses.map((r) => r.id))
    const ansByResp = new Map<string, Map<string, number>>()
    for (const r of filteredResponses) ansByResp.set(r.id, new Map())
    for (const a of answers) {
      if (!respIds.has(a.response_id)) continue
      ansByResp.get(a.response_id)!.set(a.question_id, a.value)
    }

    /* AHRQ HS2.0 spec column order (A-AP). HASA-specific extras go after. */
    // Section A-F items in spec order (E..AL)
    const SPEC_QUESTION_ORDER: string[] = [
      'A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13','A14',  // E..R
      'B1','B2','B3',                                                                // S..U
      'C1','C2','C3','C4','C5','C6','C7',                                            // V..AB
      'D1','D2','D3',                                                                // AC..AE
      'E1',                                                                           // AF
      'F1','F2','F3','F4','F5','F6',                                                  // AG..AL
    ]
    const questionById = new Map(questions.map((q) => [q.id, q]))

    /* AHRQ value encoders for each question's scale. */
    // Likert (Agreement / Frequency): 1-5 stays 1-5; 0 (Don't Know) -> 9; null -> blank
    function encLikert(v: number | undefined): number | '' {
      if (v === undefined || v === null) return ''
      if (v === 0) return 9
      if (v >= 1 && v <= 5) return v
      return ''
    }
    // D3 EventCount: 1->a, 2->b, 3->c, 4->d, 5->e; 0 or missing -> blank (no Don't Know in spec)
    function encEventCount(v: number | undefined): string {
      const map: Record<number, string> = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', 5: 'e' }
      return v != null && v in map ? map[v] : ''
    }
    // E1 Rating: AHRQ uses 1-5 the same as Likert but with no "9 = Don't Know" option
    function encRating(v: number | undefined): number | '' {
      if (v == null || v === 0) return ''
      if (v >= 1 && v <= 5) return v
      return ''
    }
    // BQ1, BQ2 tenure: <1y->a, 1-5y->b, 6-10y->c, 11+y->d
    function encTenure(v: string | null): string {
      const map: Record<string, string> = { '<1y': 'a', '1-5y': 'b', '6-10y': 'c', '11+y': 'd' }
      return v && v in map ? map[v] : ''
    }
    // BQ3 hours: <30->a, 30-40->b, >40->c
    function encHours(v: string | null): string {
      const map: Record<string, string> = { '<30': 'a', '30-40': 'b', '>40': 'c' }
      return v && v in map ? map[v] : ''
    }
    // BQ4 direct_patient_contact: true->a, false->b
    function encContact(v: boolean | null): string {
      if (v === true) return 'a'
      if (v === false) return 'b'
      return ''
    }
    // Per-question encoder by scale_type
    function encAnswer(qid: string, v: number | undefined): number | string | '' {
      const q = questionById.get(qid)
      if (!q) return ''
      if (q.scale_type === 'EventCount') return encEventCount(v)
      if (q.scale_type === 'Rating')     return encRating(v)
      return encLikert(v)
    }

    // SHEET 1 — Responses in AHRQ spec column order, with HASA extras after AP
    const responsesRows = filteredResponses.map((r, idx) => {
      const pos  = r.position_id ? posById.get(r.position_id) ?? null : null
      const dept = r.department_code ? deptByCode.get(r.department_code) ?? null : null
      const sub  = r.sub_department_code ? deptByCode.get(r.sub_department_code) ?? null : null
      const dir  = directorateFor(r.department_code)
      const ans  = ansByResp.get(r.id)!
      // UNIQUEID: sequential 001, 002, ... with 'N' suffix for Bahasa Malaysia respondents
      // (AHRQ spec says append 'S' for Spanish, 'N' for any other non-English language)
      const seq = String(idx + 1).padStart(3, '0')
      const uniqueId = r.language === 'ms' ? `${seq}N` : seq

      // A-AP: AHRQ spec columns
      // Per HASA convention: SP and WA hold the raw text the respondent picked
      // (e.g. "Medical Officer", "Department of Medicine"), not the AHRQ 1-24 /
      // 1-34 numeric codes. Analysts can re-map later if needed for benchmarking.
      const row: Record<string, string | number> = {
        SITEID:   '1',                                   // Column A — single hospital
        UNIQUEID: uniqueId,                              // Column B
        SP:       pos?.name_en ?? '',                    // Column C — staff position text
        WA:       dept?.name_en ?? '',                   // Column D — main department text
      }
      // Columns E..AL — survey items in spec order
      for (const qid of SPEC_QUESTION_ORDER) {
        const v = ans.get(qid)
        row[qid] = encAnswer(qid, v)
      }
      // Columns AM, AN, AO, AP — background questions
      row.BQ1 = encTenure(r.tenure_hospital)
      row.BQ2 = encTenure(r.tenure_unit)
      row.BQ3 = encHours(r.hours_per_week)
      row.BQ4 = encContact(r.direct_patient_contact)

      // AQ onwards — HASA-specific extras (sub-unit, comment, raw codes, etc.)
      // SP and WA already carry position_name and department_name above, so
      // we don't duplicate those here.
      row.hasa_response_id          = r.id
      row.hasa_campaign_id          = r.campaign_id
      row.hasa_campaign_code        = campaign.code
      row.hasa_submitted_at         = r.submitted_at
      row.hasa_language             = r.language
      row.hasa_position_id          = r.position_id ?? ''
      row.hasa_position_group       = pos?.group_en ?? ''
      row.hasa_position_other       = r.position_other ?? ''
      row.hasa_directorate_code     = dir?.code ?? ''
      row.hasa_directorate_name     = dir?.name_en ?? ''
      row.hasa_department_code      = r.department_code ?? ''
      row.hasa_sub_department_code  = r.sub_department_code ?? ''
      row.hasa_sub_department_name  = sub?.name_en ?? ''
      row.hasa_comment              = r.comment ?? ''
      row.hasa_response_hash        = r.response_hash
      return row
    })
    const wsResponses = XLSX.utils.json_to_sheet(responsesRows)

    // SHEET 2 — Codebook (with AHRQ encoding)
    const codebook: { Section: string; Code: string | number; 'Label (EN)': string; 'Label (MS)': string }[] = []
    function add(section: string, code: string | number, en: string, ms: string) {
      codebook.push({ Section: section, Code: code, 'Label (EN)': en, 'Label (MS)': ms })
    }
    add('SITEID', '1', 'Hospital Al-Sultan Abdullah UiTM (single hospital constant per AHRQ spec)', 'Hospital Al-Sultan Abdullah UiTM (pemalar hospital tunggal)')
    add('UNIQUEID', 'NNN',  'Sequential respondent ID (e.g. 001, 002, 003)', 'ID respondent berurutan')
    add('UNIQUEID', 'NNNS', 'Suffix S = Spanish-language respondent (not used at HASA)', 'Akhiran S = bahasa Sepanyol (tidak digunakan)')
    add('UNIQUEID', 'NNNN', 'Suffix N = non-English/non-Spanish respondent (used here for Bahasa Malaysia)', 'Akhiran N = bukan bahasa Inggeris/Sepanyol (digunakan untuk Bahasa Malaysia)')
    add('SP (staff position)', 'text', 'Raw position text the respondent picked (e.g. "Medical Officer"). HASA convention — not the AHRQ 1-24 numeric code.', 'Teks jawatan asal (cth. "Medical Officer"). Konvensyen HASA — bukan kod AHRQ 1-24.')
    add('WA (work area)',      'text', 'Raw main department text (e.g. "Department of Medicine"). HASA convention — not the AHRQ 1-34 numeric code. Sub-unit (when picked) is in hasa_sub_department_name after column AP.', 'Teks jabatan utama asal. Konvensyen HASA — bukan kod AHRQ 1-34. Sub-unit (jika dipilih) di hasa_sub_department_name selepas lajur AP.')
    add('Likert items (A1-A14, B1-B3, C1-C7, D1-D2, E1, F1-F6)', 1, 'Strongly Disagree / Never', 'Sangat Tidak Setuju / Tidak Pernah')
    add('Likert items (A1-A14, B1-B3, C1-C7, D1-D2, E1, F1-F6)', 2, 'Disagree / Rarely',         'Tidak Setuju / Jarang')
    add('Likert items (A1-A14, B1-B3, C1-C7, D1-D2, E1, F1-F6)', 3, 'Neither / Sometimes',       'Neutral / Kadang-kadang')
    add('Likert items (A1-A14, B1-B3, C1-C7, D1-D2, E1, F1-F6)', 4, 'Agree / Most of the time',  'Setuju / Selalu')
    add('Likert items (A1-A14, B1-B3, C1-C7, D1-D2, E1, F1-F6)', 5, 'Strongly Agree / Always',   'Sangat Setuju / Sentiasa')
    add('Likert items', 9, 'Does Not Apply or Don\'t Know (AHRQ-coded; stored as 0 in HASA DB)', 'Tidak Berkenaan / Tidak Tahu (kod AHRQ; disimpan sebagai 0 dalam pangkalan data HASA)')
    add('D3 EventCount', 'a', 'None',          'Tiada')
    add('D3 EventCount', 'b', '1 to 2 events', '1-2 insiden')
    add('D3 EventCount', 'c', '3 to 5 events', '3-5 insiden')
    add('D3 EventCount', 'd', '6 to 10 events','6-10 insiden')
    add('D3 EventCount', 'e', '11 or more',    '11 atau lebih')
    add('BQ1, BQ2 tenure', 'a', 'Less than 1 year', 'Kurang dari 1 tahun')
    add('BQ1, BQ2 tenure', 'b', '1 to 5 years',     '1-5 tahun')
    add('BQ1, BQ2 tenure', 'c', '6 to 10 years',    '6-10 tahun')
    add('BQ1, BQ2 tenure', 'd', '11 or more years', '11+ tahun')
    add('BQ3 hours_per_week', 'a', 'Less than 30 hours per week', 'Kurang dari 30 jam seminggu')
    add('BQ3 hours_per_week', 'b', '30 to 40 hours per week',     '30 hingga 40 jam seminggu')
    add('BQ3 hours_per_week', 'c', 'More than 40 hours per week', 'Lebih dari 40 jam seminggu')
    add('BQ4 direct_patient_contact', 'a', 'YES — direct interaction or contact with patients', 'YA — interaksi langsung dengan pesakit')
    add('BQ4 direct_patient_contact', 'b', 'NO — no direct interaction',                        'TIDAK — tiada interaksi langsung')
    add('blank (any column)', '(empty cell)', 'MISSING / not answered', 'TIADA / tidak dijawab')
    const wsCodebook = XLSX.utils.json_to_sheet(codebook)

    // SHEET 3 — Questions reference (in AHRQ spec column order)
    // Map question_id to spec column letter for analyst convenience
    const COL_LETTER: Record<string, string> = {
      'A1':'E','A2':'F','A3':'G','A4':'H','A5':'I','A6':'J','A7':'K','A8':'L','A9':'M','A10':'N','A11':'O','A12':'P','A13':'Q','A14':'R',
      'B1':'S','B2':'T','B3':'U',
      'C1':'V','C2':'W','C3':'X','C4':'Y','C5':'Z','C6':'AA','C7':'AB',
      'D1':'AC','D2':'AD','D3':'AE',
      'E1':'AF',
      'F1':'AG','F2':'AH','F3':'AI','F4':'AJ','F5':'AK','F6':'AL',
    }
    const questionsRows = SPEC_QUESTION_ORDER.map((qid) => {
      const q = questionById.get(qid)
      return {
        spec_column:    COL_LETTER[qid] ?? '',
        question_id:    qid,
        section:        q?.section ?? '',
        item_num:       q?.item_num ?? '',
        composite_code: q?.composite_code ?? '',
        wording:        q?.wording ?? '',
        scale_type:     q?.scale_type ?? '',
        text_en:        q?.text_en ?? '',
        text_ms:        q?.text_ms ?? '',
      }
    })
    const wsQuestions = XLSX.utils.json_to_sheet(questionsRows)

    // Workbook + download
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, wsResponses, 'Responses')
    XLSX.utils.book_append_sheet(wb, wsCodebook,  'Codebook')
    XLSX.utils.book_append_sheet(wb, wsQuestions, 'Questions')
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `PSCS_RawData_${campaign.code}_${today}.xlsx`)
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
          <Link href="/risk" className="nav-item">
            <span className="nav-icon">⚠️</span>
            <span>Risk Register</span>
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
          <button
            type="button"
            className="tab-export"
            onClick={downloadExcel}
            disabled={loading || !campaign || filteredResponses.length === 0}
            title={language === 'en'
              ? `Download raw responses + codebook for campaign ${campaign?.code ?? ''}`
              : `Muat turun maklum balas mentah + buku kod untuk kempen ${campaign?.code ?? ''}`}>
            ⬇ {language === 'en' ? 'Export to Excel' : 'Eksport ke Excel'}
          </button>
        </div>

        <div className="content">
          {loadError && <div className="ac red"><div className="ai">⚠️</div><div><div className="at">Load error</div><div className="as">{loadError}</div></div></div>}
          {loading && !loadError && <div className="ac blue"><div className="ai">⏳</div><div><div className="at">Loading…</div></div></div>}
          {!loading && !loadError && (
            <>
              {tab === 'overview'   && <OverviewTab responses={filteredResponses} positions={positions!} departments={departments!} language={language} />}
              {tab === 'composites' && <CompositesTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} language={language} />}
              {tab === 'item-level' && <ItemLevelTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} positions={positions!} departments={departments!} language={language} />}
              {tab === 'breakdowns' && <BreakdownsTab responses={filteredResponses} answers={filteredAnswers} questions={questions!} composites={composites!} positions={positions!} departments={departments!} language={language} />}
              {tab === 'comments'   && <CommentsTab responses={filteredResponses} departments={departments!} positions={positions!} language={language} />}
              {tab === 'reportcard' && <ReportCardTab campaign={campaign} campaigns={campaigns!} allResponses={responses!} allAnswers={answers!} questions={questions!} composites={composites!} positions={positions!} departments={departments!} language={language} />}
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
  const compsForChart = composites.filter((c) => !isStandaloneComposite(c))
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

type ItemCompareAxis = 'none' | 'department' | 'subunit' | 'posgroup' | 'position' | 'tenure' | 'hours' | 'contact'

const ITEM_COMPARE_OPTIONS: { id: ItemCompareAxis; en: string; ms: string }[] = [
  { id: 'none',       en: 'None (overall)',  ms: 'Tiada (keseluruhan)' },
  { id: 'department', en: 'Department',      ms: 'Jabatan' },
  { id: 'subunit',    en: 'Sub-unit',        ms: 'Sub-unit' },
  { id: 'posgroup',   en: 'Position Group',  ms: 'Kumpulan Kakitangan' },
  { id: 'position',   en: 'Staff Position',  ms: 'Jawatan' },
  { id: 'tenure',     en: 'Tenure',          ms: 'Tempoh di Hospital' },
  { id: 'hours',      en: 'Working Hours',   ms: 'Waktu Bekerja' },
  { id: 'contact',    en: 'Patient Contact', ms: 'Interaksi Pesakit' },
]

function ItemLevelTab({ responses, answers, questions, composites, positions, departments, language }: {
  responses: PscsResponse[]
  answers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const [compareBy, setCompareBy] = useState<ItemCompareAxis>('none')

  // Lookup maps for cohort labels
  const posById = useMemo(() => {
    const m = new Map<number, PscsPosition>()
    for (const p of positions) m.set(p.id, p)
    return m
  }, [positions])
  const deptByCode = useMemo(() => {
    const m = new Map<string, PscsDepartment>()
    for (const d of departments) m.set(d.code, d)
    return m
  }, [departments])

  // Group responses by the chosen axis (when compareBy !== 'none')
  const groups = useMemo<{ key: string; label_en: string; label_ms: string; responses: PscsResponse[] }[]>(() => {
    if (compareBy === 'none') return []
    type G = { key: string; label_en: string; label_ms: string; responses: PscsResponse[]; sort: number }
    const byKey = new Map<string, G>()
    function add(key: string, label_en: string, label_ms: string, r: PscsResponse, sort = 0) {
      const cur = byKey.get(key) ?? { key, label_en, label_ms, responses: [], sort }
      cur.responses.push(r)
      byKey.set(key, cur)
    }
    for (const r of responses) {
      if (compareBy === 'department') {
        if (!r.department_code) continue
        const d = deptByCode.get(r.department_code)
        add(r.department_code, d?.name_en ?? r.department_code, d?.name_ms ?? r.department_code, r, d?.sort_order)
      } else if (compareBy === 'subunit') {
        if (!r.sub_department_code) continue
        const d = deptByCode.get(r.sub_department_code)
        add(r.sub_department_code, d?.name_en ?? r.sub_department_code, d?.name_ms ?? r.sub_department_code, r, d?.sort_order)
      } else if (compareBy === 'posgroup') {
        const p = r.position_id ? posById.get(r.position_id) : null
        if (!p) continue
        add(p.group_en, p.group_en, p.group_ms, r, p.sort_order)
      } else if (compareBy === 'position') {
        const p = r.position_id ? posById.get(r.position_id) : null
        if (!p) continue
        add(String(p.id), p.name_en, p.name_ms, r, p.sort_order)
      } else if (compareBy === 'tenure') {
        const map: Record<string, { en: string; ms: string; sort: number }> = {
          '<1y':   { en: 'Less than 1 year', ms: 'Kurang dari 1 tahun', sort: 1 },
          '1-5y':  { en: '1–5 years',        ms: '1–5 tahun',           sort: 2 },
          '6-10y': { en: '6–10 years',       ms: '6–10 tahun',          sort: 3 },
          '11+y':  { en: '11+ years',        ms: '11+ tahun',           sort: 4 },
        }
        if (!r.tenure_hospital) continue
        const lbl = map[r.tenure_hospital]
        if (!lbl) continue
        add(r.tenure_hospital, lbl.en, lbl.ms, r, lbl.sort)
      } else if (compareBy === 'hours') {
        const map: Record<string, { en: string; ms: string; sort: number }> = {
          '<30':   { en: 'Less than 30 hrs/wk', ms: 'Kurang dari 30 jam/mgu', sort: 1 },
          '30-40': { en: '30 to 40 hrs/wk',     ms: '30 hingga 40 jam/mgu',  sort: 2 },
          '>40':   { en: 'More than 40 hrs/wk', ms: 'Lebih dari 40 jam/mgu', sort: 3 },
        }
        if (!r.hours_per_week) continue
        const lbl = map[r.hours_per_week]
        if (!lbl) continue
        add(r.hours_per_week, lbl.en, lbl.ms, r, lbl.sort)
      } else if (compareBy === 'contact') {
        if (r.direct_patient_contact === true)       add('yes', 'Yes — direct patient contact', 'Ya — interaksi langsung', r, 1)
        else if (r.direct_patient_contact === false) add('no',  'No — no direct contact',       'Tidak — tiada interaksi langsung', r, 2)
      }
    }
    const out = Array.from(byKey.values())
    out.sort((a, b) => a.sort - b.sort !== 0 ? a.sort - b.sort : b.responses.length - a.responses.length)
    return out
  }, [compareBy, responses, posById, deptByCode])

  return (
    <div className="pscs-page">
      <Panel title={language === 'en' ? 'Item-Level Results' : 'Keputusan Per Item'}>
        <div className="bd-filters" style={{ marginBottom: 0 }}>
          <FilterSelect
            label={language === 'en' ? 'Compare by' : 'Bandingkan mengikut'}
            value={compareBy}
            onChange={(v) => setCompareBy(v as ItemCompareAxis)}
            options={ITEM_COMPARE_OPTIONS.map((o) => ({ value: o.id, label: language === 'en' ? o.en : o.ms }))}
            emphasis />
          {compareBy !== 'none' && (
            <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'flex-end', marginBottom: 5 }}>
              {language === 'en'
                ? `${groups.length} cohort${groups.length === 1 ? '' : 's'} · cells show % positive; "—" when fewer than 3 valid responses for that item in the cohort`
                : `${groups.length} kumpulan · sel menunjukkan % positif; "—" jika kurang dari 3 maklum balas sah`}
            </span>
          )}
        </div>
      </Panel>

      {/* Overall view (no comparison) — original stacked bars */}
      {compareBy === 'none' && composites.filter((c) => !isStandaloneComposite(c)).map((c) => {
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

      {/* Per-cohort matrix view */}
      {compareBy !== 'none' && (groups.length === 0 ? (
        <Panel title={language === 'en' ? 'Item × Cohort Matrix' : 'Matriks Item × Kumpulan'}>
          <p className="bd-empty">{language === 'en' ? 'No responses with this axis populated yet.' : 'Tiada maklum balas dengan paksi ini.'}</p>
        </Panel>
      ) : composites.filter((c) => !isStandaloneComposite(c)).map((c) => {
        const qs = questions.filter((q) => q.composite_code === c.code).sort((a, b) => a.sort_order - b.sort_order)
        if (qs.length === 0) return null
        return (
          <Panel key={c.code} title={`${c.code} · ${language === 'en' ? c.name_en : c.name_ms}`}>
            <div className="bd-table-wrap">
              <table className="bd-matrix il-matrix">
                <thead>
                  <tr>
                    <th className="bd-row-head" style={{ minWidth: 60 }}>ID</th>
                    <th className="bd-row-head">{language === 'en' ? 'Item' : 'Item'}</th>
                    {groups.map((g) => (
                      <th key={g.key} className="bd-comp" title={`${language === 'en' ? g.label_en : g.label_ms} (n=${g.responses.length})`}>
                        {language === 'en' ? g.label_en : g.label_ms}
                        <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted)' }}>n={g.responses.length}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {qs.map((q) => (
                    <tr key={q.id}>
                      <td className="bd-row-head" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {q.id}{q.wording === '-' && <span style={{ color: 'var(--red)', marginLeft: 3 }}>−</span>}
                      </td>
                      <td className="bd-row-head" style={{ fontSize: 11, maxWidth: 320, whiteSpace: 'normal', lineHeight: 1.35 }}>
                        {language === 'en' ? q.text_en : q.text_ms}
                      </td>
                      {groups.map((g) => {
                        const ans = answersForResponses(g.responses, answers)
                        const st = itemStats(q, ans)
                        if (st.total < 3) return <td key={g.key} className="bd-cell"><span className="bd-na">—</span></td>
                        return (
                          <td key={g.key} className="bd-cell">
                            <span style={{ color: BAND_COLOR[band(st.pct_positive)], fontWeight: 700 }}>{Math.round(st.pct_positive)}%</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      }))}
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
  const compsForMatrix = composites.filter((c) => !isStandaloneComposite(c))
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

/* ======================== TAB 6 — REPORT CARD ======================== */
/*
 * Hospital-level and department-level PSCS Report Card.
 *
 * Layout follows the AHRQ SOPS 2.0 Individual Hospital Feedback Report
 * structure but adapted for HASA: no comparison to an external database,
 * instead each scoped report includes a faded "Hospital overall" benchmark
 * column. Renders as one or more A4 .rc-page divs inside a preview area;
 * the Download PDF button opens a print window populated with cloned pages
 * (canvas → img swap so Chart.js charts survive serialization) and triggers
 * window.print() — exactly how the IR and KPI report cards work.
 */

type ReportScope =
  | { kind: 'all' }
  | { kind: 'directorate'; code: string }
  | { kind: 'department';  code: string }
  | { kind: 'subunit';     code: string }

function ReportCardTab({
  campaign, campaigns, allResponses, allAnswers, questions, composites, positions, departments, language,
}: {
  campaign: PscsCampaign | null
  campaigns: PscsCampaign[]
  allResponses: PscsResponse[]
  allAnswers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  // Scope selector inputs
  const [directorate, setDirectorate] = useState<string>('all')
  const [department,  setDepartment]  = useState<string>('all')
  const [subunit,     setSubunit]     = useState<string>('all')
  const [generated,   setGenerated]   = useState<ReportScope | null>(null)

  const directorateOpts = useMemo(
    () => departments.filter((d) => d.kind === 'directorate').sort((a, b) => a.sort_order - b.sort_order),
    [departments],
  )
  const departmentOpts = useMemo(
    () => departments.filter((d) => d.kind === 'department')
      .filter((d) => directorate === 'all' || d.parent_code === directorate)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, directorate],
  )
  const subunitOpts = useMemo(
    () => department === 'all' ? [] : departments
      .filter((d) => d.kind === 'subunit' && d.parent_code === department)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, department],
  )

  function generate() {
    if (subunit !== 'all') setGenerated({ kind: 'subunit', code: subunit })
    else if (department !== 'all') setGenerated({ kind: 'department', code: department })
    else if (directorate !== 'all') setGenerated({ kind: 'directorate', code: directorate })
    else setGenerated({ kind: 'all' })
  }
  function generateAll() {
    setDirectorate('all'); setDepartment('all'); setSubunit('all')
    setGenerated({ kind: 'all' })
  }

  function downloadPdf() {
    if (typeof window === 'undefined') return
    const preview = document.getElementById('pscs-rc-preview')
    if (!preview) return
    const pages = Array.from(preview.querySelectorAll<HTMLElement>('.rc-page'))
    if (pages.length === 0) return

    // Clone each page then replace its canvases with PNG <img>s rendered from
    // the live canvas — outerHTML doesn't preserve canvas bitmaps.
    const clonedPages = pages.map((page) => {
      const clone = page.cloneNode(true) as HTMLElement
      const originals = Array.from(page.querySelectorAll('canvas'))
      const clonedCanvases = Array.from(clone.querySelectorAll('canvas'))
      originals.forEach((orig, i) => {
        const target = clonedCanvases[i]
        if (!target) return
        try {
          const dataUrl = orig.toDataURL('image/png')
          const img = clone.ownerDocument!.createElement('img')
          img.src = dataUrl
          const rect = orig.getBoundingClientRect()
          img.style.width = `${rect.width}px`
          img.style.height = `${rect.height}px`
          img.style.display = 'block'
          target.replaceWith(img)
        } catch { /* tainted canvas — leave as-is */ }
      })
      return clone
    })

    const pageHtml = clonedPages.map((p) => p.outerHTML).join('\n')
    const css = Array.from(document.styleSheets).map((s) => {
      try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n') }
      catch { return '' }
    }).join('\n')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>PSCS Report Card</title><style>${css}\n@page{size:A4 portrait;margin:0}@page landscape{size:A4 landscape;margin:0}.rc-page{page:auto}.rc-page.rc-landscape{page:landscape}body{margin:0;padding:0;background:#fff;}</style></head><body>${pageHtml}<script>window.onload=()=>window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.open(); w.document.write(html); w.document.close()
  }

  return (
    <>
      <div className="rc-controls">
        <div className="pf">
          <div>
            <div className="pt">{language === 'en' ? 'PSCS Report Card' : 'Kad Laporan PSCS'}</div>
            <div className="psub">
              {language === 'en'
                ? 'Generate a printable PSCS report at hospital, directorate, department, or sub-unit scope. Department-level reports include a faded "Hospital overall" benchmark column.'
                : 'Hasilkan laporan PSCS yang boleh dicetak pada skop hospital, direktorat, jabatan, atau sub-unit. Laporan peringkat jabatan termasuk lajur penanda aras "Hospital keseluruhan".'}
            </div>
          </div>
        </div>
        <div className="row">
          <div>
            <label>{language === 'en' ? 'Directorate' : 'Direktorat'}</label>
            <select value={directorate} onChange={(e) => { setDirectorate(e.target.value); setDepartment('all'); setSubunit('all') }}>
              <option value="all">{language === 'en' ? 'All directorates' : 'Semua direktorat'}</option>
              {directorateOpts.map((d) => (
                <option key={d.code} value={d.code}>{language === 'en' ? d.name_en : d.name_ms}</option>
              ))}
            </select>
          </div>
          <div>
            <label>{language === 'en' ? 'Department' : 'Jabatan'}</label>
            <select value={department} onChange={(e) => { setDepartment(e.target.value); setSubunit('all') }}>
              <option value="all">{language === 'en' ? 'All departments' : 'Semua jabatan'}</option>
              {departmentOpts.map((d) => (
                <option key={d.code} value={d.code}>{language === 'en' ? d.name_en : d.name_ms}</option>
              ))}
            </select>
          </div>
          {subunitOpts.length > 0 && (
            <div>
              <label>{language === 'en' ? 'Sub-unit' : 'Sub-unit'}</label>
              <select value={subunit} onChange={(e) => setSubunit(e.target.value)}>
                <option value="all">{language === 'en' ? 'All sub-units' : 'Semua sub-unit'}</option>
                {subunitOpts.map((d) => (
                  <option key={d.code} value={d.code}>{language === 'en' ? d.name_en : d.name_ms}</option>
                ))}
              </select>
            </div>
          )}
          <button className="btn" type="button" onClick={generate}>
            {language === 'en' ? 'Generate Report' : 'Hasilkan Laporan'}
          </button>
          <button className="btn ghost" type="button" onClick={generateAll}>
            🏥 {language === 'en' ? 'Whole Hospital' : 'Seluruh Hospital'}
          </button>
          <button className="btn ghost" type="button" onClick={downloadPdf} disabled={!generated}>
            ⬇ {language === 'en' ? 'Download PDF' : 'Muat Turun PDF'}
          </button>
        </div>
      </div>

      <div className="rc-preview" id="pscs-rc-preview">
        {!generated && (
          <div style={{ background: '#fff', padding: 30, borderRadius: 6, color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
            {language === 'en'
              ? 'Choose a scope and press Generate Report — or click Whole Hospital for a hospital-wide report.'
              : 'Pilih skop dan tekan Hasilkan Laporan — atau klik Seluruh Hospital untuk laporan seluruh hospital.'}
          </div>
        )}
        {generated && (
          <PscsReport
            scope={generated}
            campaign={campaign}
            campaigns={campaigns}
            allResponses={allResponses}
            allAnswers={allAnswers}
            questions={questions}
            composites={composites}
            positions={positions}
            departments={departments}
            language={language}
          />
        )}
      </div>
    </>
  )
}

/* ----- Scope helpers ----- */

function scopeName(scope: ReportScope, departments: PscsDepartment[], lang: 'en' | 'ms'): { name: string; kindLabel: string } {
  if (scope.kind === 'all') {
    return {
      name: lang === 'en' ? 'Whole Hospital' : 'Seluruh Hospital',
      kindLabel: lang === 'en' ? 'Hospital-wide report' : 'Laporan seluruh hospital',
    }
  }
  const d = departments.find((x) => x.code === scope.code)
  const nm = d ? (lang === 'en' ? d.name_en : d.name_ms) : scope.code
  const kindLabel =
    scope.kind === 'directorate' ? (lang === 'en' ? 'Directorate-level report' : 'Laporan peringkat direktorat') :
    scope.kind === 'department'  ? (lang === 'en' ? 'Department-level report'  : 'Laporan peringkat jabatan') :
                                   (lang === 'en' ? 'Sub-unit-level report'    : 'Laporan peringkat sub-unit')
  return { name: nm, kindLabel }
}

/* Returns responses that fall within `scope`. */
function scopeResponses(scope: ReportScope, all: PscsResponse[], departments: PscsDepartment[]): PscsResponse[] {
  if (scope.kind === 'all') return all
  if (scope.kind === 'directorate') {
    const deptsInDir = new Set(departments.filter((d) => d.kind === 'department' && d.parent_code === scope.code).map((d) => d.code))
    return all.filter((r) => r.department_code != null && deptsInDir.has(r.department_code))
  }
  if (scope.kind === 'department') return all.filter((r) => r.department_code === scope.code)
  return all.filter((r) => r.sub_department_code === scope.code)
}

/* ======================== REPORT (multi-page) ======================== */

function PscsReport({
  scope, campaign, campaigns, allResponses, allAnswers, questions, composites, positions, departments, language,
}: {
  scope: ReportScope
  campaign: PscsCampaign | null
  campaigns: PscsCampaign[]
  allResponses: PscsResponse[]
  allAnswers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const showBenchmark = scope.kind !== 'all'
  const { name: scopeNameStr, kindLabel } = scopeName(scope, departments, language)

  // Filter to selected campaign first, then to scope
  const campResponses = useMemo(
    () => allResponses.filter((r) => campaign ? r.campaign_id === campaign.id : true),
    [allResponses, campaign],
  )
  const scoped = useMemo(() => scopeResponses(scope, campResponses, departments), [scope, campResponses, departments])
  const scopedAnswers = useMemo(() => answersForResponses(scoped, allAnswers), [scoped, allAnswers])
  const hospitalAnswers = useMemo(() => answersForResponses(campResponses, allAnswers), [campResponses, allAnswers])

  // Trend stub: find previous campaign with responses, compute composite scores per code for trend arrows.
  const prevCampaign = useMemo(() => {
    if (!campaign) return null
    const earlier = campaigns
      .filter((c) => c.id !== campaign.id && new Date(c.open_date) < new Date(campaign.open_date))
      .sort((a, b) => new Date(b.open_date).getTime() - new Date(a.open_date).getTime())
    for (const c of earlier) {
      const had = allResponses.some((r) => r.campaign_id === c.id)
      if (had) return c
    }
    return null
  }, [campaign, campaigns, allResponses])

  const prevScopedAnswers = useMemo(() => {
    if (!prevCampaign) return null
    const prevAll = allResponses.filter((r) => r.campaign_id === prevCampaign.id)
    const prevScoped = scopeResponses(scope, prevAll, departments)
    return answersForResponses(prevScoped, allAnswers)
  }, [prevCampaign, allResponses, scope, departments, allAnswers])

  const reportDate = new Date().toISOString().slice(0, 10)

  return (
    <>
      <ReportCover
        scopeName={scopeNameStr}
        kindLabel={kindLabel}
        campaign={campaign}
        reportDate={reportDate}
        scoped={scoped}
        scopedAnswers={scopedAnswers}
        questions={questions}
        composites={composites}
        language={language}
      />
      <ReportAdminStats
        scope={scope}
        scopeName={scopeNameStr}
        scoped={scoped}
        positions={positions}
        departments={departments}
        language={language}
      />
      <ReportComposites
        scopeName={scopeNameStr}
        scopedAnswers={scopedAnswers}
        hospitalAnswers={hospitalAnswers}
        prevScopedAnswers={prevScopedAnswers}
        showBenchmark={showBenchmark}
        questions={questions}
        composites={composites}
        language={language}
      />
      <ReportItemLevel
        scopeName={scopeNameStr}
        scopedAnswers={scopedAnswers}
        hospitalAnswers={hospitalAnswers}
        showBenchmark={showBenchmark}
        questions={questions}
        composites={composites}
        language={language}
      />
      <ReportEventsRating
        scopeName={scopeNameStr}
        scopedAnswers={scopedAnswers}
        language={language}
      />
      <ReportCrossTabs
        scope={scope}
        scopeName={scopeNameStr}
        scoped={scoped}
        hospitalResponses={campResponses}
        allAnswers={allAnswers}
        showBenchmark={showBenchmark}
        questions={questions}
        composites={composites}
        positions={positions}
        departments={departments}
        language={language}
      />
      <ReportItemCrossTabs
        scope={scope}
        scopeName={scopeNameStr}
        scoped={scoped}
        hospitalResponses={campResponses}
        allAnswers={allAnswers}
        showBenchmark={showBenchmark}
        questions={questions}
        composites={composites}
        positions={positions}
        departments={departments}
        language={language}
      />
      <ReportMethodology language={language} />
    </>
  )
}

/* ----- Page: Cover ----- */

function ReportCover({
  scopeName, kindLabel, campaign, reportDate, scoped, scopedAnswers, questions, composites, language,
}: {
  scopeName: string
  kindLabel: string
  campaign: PscsCampaign | null
  reportDate: string
  scoped: PscsResponse[]
  scopedAnswers: PscsAnswer[]
  questions: PscsQuestion[]
  composites: PscsComposite[]
  language: 'en' | 'ms'
}) {
  // Top 5 strengths / gaps from items with ≥3 valid responses
  const allItems = useMemo(() => {
    return questions
      .filter((q) => q.active && !isStandaloneComposite(composites.find((c) => c.code === q.composite_code) ?? { code: '', is_rating: false } as PscsComposite))
      .map((q) => ({ q, st: itemStats(q, scopedAnswers) }))
      .filter((x) => x.st.total >= 3)
      .sort((a, b) => b.st.pct_positive - a.st.pct_positive)
  }, [questions, composites, scopedAnswers])
  const topStrengths = allItems.slice(0, 5)
  const topGaps = [...allItems].reverse().slice(0, 5)

  // Overall composite average
  const compsForAvg = composites.filter((c) => !isStandaloneComposite(c))
  const compositeScores = compsForAvg
    .map((c) => compositeStats(c.code, questions, scopedAnswers).score)
    .filter((s): s is number => s !== null)
  const overallAvg = compositeScores.length === 0
    ? null
    : compositeScores.reduce((a, b) => a + b, 0) / compositeScores.length

  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">{language === 'en' ? 'Patient Safety Culture Survey' : 'Tinjauan Budaya Keselamatan Pesakit'}</div>
        <div className="t2">{language === 'en' ? 'Hospital Al-Sultan Abdullah UiTM · RMCQ' : 'Hospital Al-Sultan Abdullah UiTM · RMCQ'}</div>
      </div>

      <div className="rc-cover-block">
        <div className="rc-cover-kind">{kindLabel}</div>
        <div className="rc-cover-scope">{scopeName}</div>
        <div className="rc-cover-meta">
          {campaign && (
            <>
              {language === 'en' ? 'Campaign' : 'Kempen'}: <b>{campaign.code} · {language === 'en' ? campaign.name_en : campaign.name_ms}</b><br />
              {language === 'en' ? 'Open' : 'Buka'}: {campaign.open_date} → {campaign.close_date}<br />
            </>
          )}
          {language === 'en' ? 'Generated' : 'Dihasilkan'}: {reportDate}
        </div>
      </div>

      <div className="rc-cover-tiles">
        <div className="rc-cover-tile">
          <div className="l">{language === 'en' ? 'Completed Responses' : 'Maklum balas Lengkap'}</div>
          <div className="v" style={{ color: 'var(--blue)' }}>{scoped.length}</div>
        </div>
        <div className="rc-cover-tile">
          <div className="l">{language === 'en' ? 'Composite Avg' : 'Purata Komposit'}</div>
          <div className="v" style={{ color: overallAvg !== null ? BAND_COLOR[band(overallAvg)] : 'var(--muted)' }}>
            {overallAvg === null ? '—' : `${Math.round(overallAvg)}%`}
          </div>
          <div className="s">{language === 'en' ? '% positive (AHRQ avg)' : '% positif (purata AHRQ)'}</div>
        </div>
        <div className="rc-cover-tile">
          <div className="l">{language === 'en' ? 'Items Scored' : 'Item Diskor'}</div>
          <div className="v" style={{ color: 'var(--blue)' }}>{allItems.length}<span style={{ fontSize: 11, color: 'var(--muted)' }}> / {questions.filter((q) => q.active && !isStandaloneComposite(composites.find((c) => c.code === q.composite_code) ?? { code: '', is_rating: false } as PscsComposite)).length}</span></div>
          <div className="s">{language === 'en' ? 'items with ≥3 valid responses' : 'item dengan ≥3 maklum balas sah'}</div>
        </div>
      </div>

      <div className="rc-cover-callouts">
        <div className="rc-callout rc-strengths">
          <div className="rc-callout-head">
            🟢 {language === 'en' ? 'Top 5 Strengths' : '5 Kekuatan Teratas'}
          </div>
          {topStrengths.length === 0 ? (
            <div className="rc-callout-empty">{language === 'en' ? 'Not enough data yet.' : 'Data belum mencukupi.'}</div>
          ) : (
            <ol className="rc-callout-list">
              {topStrengths.map(({ q, st }) => (
                <li key={q.id}>
                  <span className="rc-item-id">{q.id}</span>
                  <span className="rc-item-text">{language === 'en' ? q.text_en : q.text_ms}</span>
                  <span className="rc-item-pct" style={{ color: BAND_COLOR[band(st.pct_positive)] }}>{Math.round(st.pct_positive)}%</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="rc-callout rc-gaps">
          <div className="rc-callout-head">
            🔴 {language === 'en' ? 'Top 5 Gaps' : '5 Jurang Teratas'}
          </div>
          {topGaps.length === 0 ? (
            <div className="rc-callout-empty">{language === 'en' ? 'Not enough data yet.' : 'Data belum mencukupi.'}</div>
          ) : (
            <ol className="rc-callout-list">
              {topGaps.map(({ q, st }) => (
                <li key={q.id}>
                  <span className="rc-item-id">{q.id}</span>
                  <span className="rc-item-text">{language === 'en' ? q.text_en : q.text_ms}</span>
                  <span className="rc-item-pct" style={{ color: BAND_COLOR[band(st.pct_positive)] }}>{Math.round(st.pct_positive)}%</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <ReportFooter language={language} />
    </div>
  )
}

/* ----- Page: Survey Administration Statistics ----- */

function ReportAdminStats({
  scope, scopeName, scoped, positions, departments, language,
}: {
  scope: ReportScope
  scopeName: string
  scoped: PscsResponse[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const total = scoped.length

  // By position — hierarchical (group → position) like the AHRQ report
  const posBy = useMemo(() => {
    const posById = new Map<number, PscsPosition>()
    for (const p of positions) posById.set(p.id, p)
    // Group → Map<positionId, count>
    const byGroup = new Map<string, { en: string; ms: string; sort: number; positions: Map<number, number>; unknown: number }>()
    let groupless = 0
    for (const r of scoped) {
      const p = r.position_id ? posById.get(r.position_id) : null
      if (!p) {
        groupless++
        continue
      }
      const g = byGroup.get(p.group_en) ?? { en: p.group_en, ms: p.group_ms, sort: p.sort_order, positions: new Map(), unknown: 0 }
      g.positions.set(p.id, (g.positions.get(p.id) ?? 0) + 1)
      byGroup.set(p.group_en, g)
    }
    // Build hierarchical rows
    type Row = { groupLabel?: { en: string; ms: string }; positionLabel?: { en: string; ms: string }; n: number; isSubtotal?: boolean }
    const rows: Row[] = []
    const sortedGroups = Array.from(byGroup.entries()).sort((a, b) => a[1].sort - b[1].sort)
    for (const [, g] of sortedGroups) {
      const groupTotal = Array.from(g.positions.values()).reduce((a, b) => a + b, 0)
      // Group header row showing the group label + total
      rows.push({ groupLabel: { en: g.en, ms: g.ms }, n: groupTotal, isSubtotal: true })
      // Position detail rows under it
      const sortedPositions = Array.from(g.positions.entries())
        .map(([pid, n]) => ({ pos: posById.get(pid)!, n }))
        .filter((x) => x.pos)
        .sort((a, b) => a.pos.sort_order - b.pos.sort_order)
      for (const { pos, n } of sortedPositions) {
        rows.push({ positionLabel: { en: pos.name_en, ms: pos.name_ms }, n })
      }
    }
    if (groupless > 0) {
      rows.push({ groupLabel: { en: 'Not specified', ms: 'Tidak dinyatakan' }, n: groupless, isSubtotal: true })
    }
    return rows
  }, [scoped, positions])

  // By directorate
  const dirBy = useMemo(() => {
    const dirOf = new Map<string, string | null>()
    for (const d of departments) if (d.kind === 'department') dirOf.set(d.code, d.parent_code)
    const dirName = new Map<string, { en: string; ms: string }>()
    for (const d of departments) if (d.kind === 'directorate') dirName.set(d.code, { en: d.name_en, ms: d.name_ms })
    const m = new Map<string, { en: string; ms: string; n: number }>()
    for (const r of scoped) {
      const dirCode = r.department_code ? (dirOf.get(r.department_code) ?? null) : null
      const nm = dirCode ? dirName.get(dirCode) : null
      const k = dirCode ?? '__none__'
      const cur = m.get(k) ?? { en: nm?.en ?? 'Not specified', ms: nm?.ms ?? 'Tidak dinyatakan', n: 0 }
      cur.n++
      m.set(k, cur)
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n)
  }, [scoped, departments])

  const tenureBy = useMemo(() => {
    const order = ['<1y','1-5y','6-10y','11+y']
    const labels: Record<string, { en: string; ms: string }> = {
      '<1y':   { en: 'Less than 1 year', ms: 'Kurang dari 1 tahun' },
      '1-5y':  { en: '1–5 years',        ms: '1–5 tahun' },
      '6-10y': { en: '6–10 years',       ms: '6–10 tahun' },
      '11+y':  { en: '11+ years',        ms: '11+ tahun' },
    }
    const counts = new Map<string, number>()
    for (const o of order) counts.set(o, 0)
    let unk = 0
    for (const r of scoped) {
      if (r.tenure_hospital && counts.has(r.tenure_hospital)) counts.set(r.tenure_hospital, (counts.get(r.tenure_hospital) ?? 0) + 1)
      else unk++
    }
    const rows = order.map((k) => ({ key: k, label_en: labels[k].en, label_ms: labels[k].ms, n: counts.get(k) ?? 0 }))
    if (unk > 0) rows.push({ key: '__none__', label_en: 'Not specified', label_ms: 'Tidak dinyatakan', n: unk })
    return rows
  }, [scoped])

  const contactBy = useMemo(() => {
    let yes = 0, no = 0, unk = 0
    for (const r of scoped) {
      if (r.direct_patient_contact === true) yes++
      else if (r.direct_patient_contact === false) no++
      else unk++
    }
    return { yes, no, unk }
  }, [scoped])

  const hoursBy = useMemo(() => {
    const order = ['<30','30-40','>40']
    const labels: Record<string, { en: string; ms: string }> = {
      '<30':   { en: '< 30 hrs/wk', ms: '< 30 jam/mgu' },
      '30-40': { en: '30–40 hrs/wk', ms: '30–40 jam/mgu' },
      '>40':   { en: '> 40 hrs/wk', ms: '> 40 jam/mgu' },
    }
    const counts = new Map<string, number>()
    for (const o of order) counts.set(o, 0)
    let unk = 0
    for (const r of scoped) {
      if (r.hours_per_week && counts.has(r.hours_per_week)) counts.set(r.hours_per_week, (counts.get(r.hours_per_week) ?? 0) + 1)
      else unk++
    }
    const rows = order.map((k) => ({ key: k, label_en: labels[k].en, label_ms: labels[k].ms, n: counts.get(k) ?? 0 }))
    if (unk > 0) rows.push({ key: '__none__', label_en: 'Not specified', label_ms: 'Tidak dinyatakan', n: unk })
    return rows
  }, [scoped])

  // By sub-unit — only meaningful when the scope is a department with sub-units
  const subBy = useMemo(() => {
    if (scope.kind !== 'department') return null
    const subs = departments.filter((d) => d.kind === 'subunit' && d.parent_code === scope.code)
    if (subs.length === 0) return null
    const counts = new Map<string, number>()
    let deptOnly = 0
    for (const r of scoped) {
      if (r.sub_department_code) counts.set(r.sub_department_code, (counts.get(r.sub_department_code) ?? 0) + 1)
      else deptOnly++
    }
    const rows = subs
      .map((s) => ({ label_en: s.name_en, label_ms: s.name_ms, n: counts.get(s.code) ?? 0 }))
      .sort((a, b) => b.n - a.n)
    if (deptOnly > 0) {
      rows.push({ label_en: 'Department-level only (no sub-unit)', label_ms: 'Peringkat jabatan sahaja (tiada sub-unit)', n: deptOnly })
    }
    return rows
  }, [scope, departments, scoped])

  // Count of unique position groups represented (for the KPI tile, since posBy is now hierarchical)
  const groupCount = useMemo(() => {
    const groups = new Set<string>()
    const posById = new Map<number, PscsPosition>()
    for (const p of positions) posById.set(p.id, p)
    for (const r of scoped) {
      const p = r.position_id ? posById.get(r.position_id) : null
      if (p) groups.add(p.group_en)
    }
    return groups.size
  }, [scoped, positions])

  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">{language === 'en' ? 'Survey Administration Statistics' : 'Statistik Pentadbiran Tinjauan'}</div>
        <div className="t2">{scopeName}</div>
      </div>

      <div className="rc-section">
        <div className="rc-st">{language === 'en' ? 'Response Summary' : 'Ringkasan Maklum Balas'}</div>
        <div className="rc-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="rc-kpi"><div className="l">{language === 'en' ? 'Completed' : 'Lengkap'}</div><div className="v" style={{ color: 'var(--blue)' }}>{total}</div></div>
          <div className="rc-kpi"><div className="l">{language === 'en' ? 'Position Groups' : 'Kumpulan'}</div><div className="v" style={{ color: 'var(--teal)' }}>{groupCount}</div></div>
          <div className="rc-kpi"><div className="l">{language === 'en' ? 'Directorates' : 'Direktorat'}</div><div className="v" style={{ color: 'var(--amber)' }}>{dirBy.length}</div></div>
          <div className="rc-kpi"><div className="l">{language === 'en' ? 'With Patient Contact' : 'Interaksi Pesakit'}</div><div className="v" style={{ color: 'var(--green)' }}>{contactBy.yes}</div></div>
        </div>
      </div>

      {/* Staff Position breakdown spans full width because it's hierarchical and tends to be tall */}
      <div className="rc-section">
        <div className="rc-st">{language === 'en' ? 'By Staff Position' : 'Mengikut Jawatan'}</div>
        <RcPositionTable rows={posBy} total={total} language={language} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="rc-section">
          <div className="rc-st">{language === 'en' ? 'By Directorate' : 'Mengikut Direktorat'}</div>
          <RcDistTable rows={dirBy.map((r) => ({ label: language === 'en' ? r.en : r.ms, n: r.n }))} total={total} />
        </div>
        {subBy && (
          <div className="rc-section">
            <div className="rc-st">{language === 'en' ? 'By Sub-unit' : 'Mengikut Sub-unit'}</div>
            <RcDistTable rows={subBy.map((r) => ({ label: language === 'en' ? r.label_en : r.label_ms, n: r.n }))} total={total} />
          </div>
        )}
        <div className="rc-section">
          <div className="rc-st">{language === 'en' ? 'By Tenure in Hospital' : 'Mengikut Tempoh di Hospital'}</div>
          <RcDistTable rows={tenureBy.map((r) => ({ label: language === 'en' ? r.label_en : r.label_ms, n: r.n }))} total={total} />
        </div>
        <div className="rc-section">
          <div className="rc-st">{language === 'en' ? 'By Working Hours' : 'Mengikut Waktu Bekerja'}</div>
          <RcDistTable rows={hoursBy.map((r) => ({ label: language === 'en' ? r.label_en : r.label_ms, n: r.n }))} total={total} />
        </div>
        <div className="rc-section">
          <div className="rc-st">{language === 'en' ? 'By Patient Contact' : 'Mengikut Interaksi Pesakit'}</div>
          <RcDistTable rows={[
            { label: language === 'en' ? 'Yes — direct patient contact' : 'Ya — interaksi langsung', n: contactBy.yes },
            { label: language === 'en' ? 'No — no direct contact' : 'Tidak — tiada interaksi langsung', n: contactBy.no },
            ...(contactBy.unk > 0 ? [{ label: language === 'en' ? 'Not specified' : 'Tidak dinyatakan', n: contactBy.unk }] : []),
          ]} total={total} />
        </div>
      </div>

      <ReportFooter language={language} />
    </div>
  )
}

function RcPositionTable({ rows, total, language }: {
  rows: { groupLabel?: { en: string; ms: string }; positionLabel?: { en: string; ms: string }; n: number; isSubtotal?: boolean }[]
  total: number
  language: 'en' | 'ms'
}) {
  return (
    <table className="rc-dist rc-pos-table">
      <thead>
        <tr>
          <th style={{ width: 160 }}>{language === 'en' ? 'Staff Group' : 'Kumpulan'}</th>
          <th>{language === 'en' ? 'Position' : 'Jawatan'}</th>
          <th style={{ width: 50 }}>n</th>
          <th style={{ width: 50 }}>%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const isGroup = !!r.isSubtotal
          return (
            <tr key={i} className={isGroup ? 'rc-pos-grouprow' : ''}>
              <td style={{ fontWeight: isGroup ? 700 : 400 }}>
                {isGroup && r.groupLabel ? (language === 'en' ? r.groupLabel.en : r.groupLabel.ms) : ''}
              </td>
              <td style={{ paddingLeft: isGroup ? 8 : 18 }}>
                {!isGroup && r.positionLabel ? (language === 'en' ? r.positionLabel.en : r.positionLabel.ms) : (isGroup ? <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: 9 }}>{language === 'en' ? '— group total —' : '— jumlah kumpulan —'}</span> : '')}
              </td>
              <td style={{ fontWeight: isGroup ? 700 : 400 }}>{r.n}</td>
              <td style={{ fontWeight: isGroup ? 700 : 400 }}>{total === 0 ? '—' : `${Math.round((r.n / total) * 100)}%`}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RcDistTable({ rows, total }: { rows: { label: string; n: number }[]; total: number }) {
  return (
    <table className="rc-dist">
      <thead>
        <tr><th>Group</th><th>n</th><th>%</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td>{r.n}</td>
            <td>{total === 0 ? '—' : `${Math.round((r.n / total) * 100)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ----- Page: Composite Measure Results ----- */

function ReportComposites({
  scopeName, scopedAnswers, hospitalAnswers, prevScopedAnswers, showBenchmark, questions, composites, language,
}: {
  scopeName: string
  scopedAnswers: PscsAnswer[]
  hospitalAnswers: PscsAnswer[]
  prevScopedAnswers: PscsAnswer[] | null
  showBenchmark: boolean
  questions: PscsQuestion[]
  composites: PscsComposite[]
  language: 'en' | 'ms'
}) {
  const comps = composites.filter((c) => !isStandaloneComposite(c))
  const rows = comps.map((c) => {
    const cur = compositeStats(c.code, questions, scopedAnswers)
    const hosp = compositeStats(c.code, questions, hospitalAnswers).score
    const prev = prevScopedAnswers ? compositeStats(c.code, questions, prevScopedAnswers).score : null
    return { comp: c, score: cur.score, items: `${cur.itemsWithScore}/${cur.itemsTotal}`, hosp, prev }
  })
  const valid = rows.map((r) => r.score).filter((s): s is number => s !== null)
  const avg = valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0) / valid.length

  const hospValid = rows.map((r) => r.hosp).filter((s): s is number => s !== null)
  const hospAvg = hospValid.length === 0 ? null : hospValid.reduce((a, b) => a + b, 0) / hospValid.length

  function trend(curr: number | null, prev: number | null) {
    if (curr === null || prev === null) return null
    const delta = curr - prev
    if (Math.abs(delta) < 1) return { arrow: '→', color: 'var(--muted)' }
    if (delta > 0) return { arrow: '↑', color: 'var(--green)' }
    return { arrow: '↓', color: 'var(--red)' }
  }

  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">{language === 'en' ? 'Composite Measure Results' : 'Keputusan Skor Komposit'}</div>
        <div className="t2">{scopeName}</div>
      </div>

      <div className="rc-section">
        <table className="rc-comp">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{language === 'en' ? 'Patient Safety Culture Composite Measures' : 'Skor Komposit Budaya Keselamatan'}</th>
              <th>{language === 'en' ? '% Positive Response' : '% Positif'}</th>
              <th style={{ width: 70 }}>{language === 'en' ? 'Score' : 'Skor'}</th>
              <th style={{ width: 50 }}>Items</th>
              {showBenchmark && <th style={{ width: 60 }}>{language === 'en' ? 'Hospital' : 'Hospital'}</th>}
              {prevScopedAnswers && <th style={{ width: 50 }}>{language === 'en' ? 'Trend' : 'Trend'}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ comp: c, score, items, hosp, prev }) => {
              const bnd = band(score)
              const tr = trend(score, prev)
              return (
                <tr key={c.code}>
                  <td>
                    <div className="rc-comp-name">{language === 'en' ? c.name_en : c.name_ms} {c.is_custom && <span className="rc-tag">HASA</span>}</div>
                    <div className="rc-comp-code">{c.code}</div>
                  </td>
                  <td>
                    {score === null ? (
                      <span className="rc-na">{language === 'en' ? 'insufficient data' : 'data tidak cukup'}</span>
                    ) : (
                      <div className="rc-cbar"><div className="rc-cbar-fill" style={{ width: `${score}%`, background: BAND_COLOR[bnd] }} /></div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: score === null ? 'var(--muted)' : BAND_COLOR[bnd] }}>
                    {score === null ? '—' : `${Math.round(score)}%`}
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 9, color: 'var(--muted)' }}>{items}</td>
                  {showBenchmark && (
                    <td style={{ textAlign: 'right', fontSize: 10, color: hosp === null ? 'var(--muted)' : BAND_COLOR[band(hosp)], fontWeight: 600 }}>
                      {hosp === null ? '—' : `${Math.round(hosp)}%`}
                    </td>
                  )}
                  {prevScopedAnswers && (
                    <td style={{ textAlign: 'center', color: tr?.color ?? 'var(--muted)', fontWeight: 700 }}>
                      {tr ? tr.arrow : '—'}
                    </td>
                  )}
                </tr>
              )
            })}
            <tr className="rc-avg-row">
              <td><b>{language === 'en' ? 'Composite Measure Average' : 'Purata Skor Komposit'}</b></td>
              <td>
                {avg === null ? <span className="rc-na">—</span>
                  : <div className="rc-cbar"><div className="rc-cbar-fill" style={{ width: `${avg}%`, background: BAND_COLOR[band(avg)] }} /></div>}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: avg === null ? 'var(--muted)' : BAND_COLOR[band(avg)] }}>
                {avg === null ? '—' : `${Math.round(avg)}%`}
              </td>
              <td />
              {showBenchmark && (
                <td style={{ textAlign: 'right', fontSize: 10, color: hospAvg === null ? 'var(--muted)' : BAND_COLOR[band(hospAvg)], fontWeight: 700 }}>
                  {hospAvg === null ? '—' : `${Math.round(hospAvg)}%`}
                </td>
              )}
              {prevScopedAnswers && <td />}
            </tr>
          </tbody>
        </table>

        <div className="rc-legend">
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.strength }} /> {language === 'en' ? 'Strength ≥75%' : 'Kekuatan ≥75%'}</span>
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.watch }} /> {language === 'en' ? 'Watch 50–74%' : 'Pemantauan 50–74%'}</span>
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.gap }} /> {language === 'en' ? 'Gap <50%' : 'Jurang <50%'}</span>
          {showBenchmark && <span style={{ color: 'var(--muted)' }}>{language === 'en' ? '"Hospital" column = whole-hospital benchmark' : 'Lajur "Hospital" = penanda aras seluruh hospital'}</span>}
          {prevScopedAnswers && <span style={{ color: 'var(--muted)' }}>{language === 'en' ? '"Trend" = vs previous campaign' : '"Trend" = berbanding kempen lepas'}</span>}
        </div>
      </div>

      <ReportFooter language={language} />
    </div>
  )
}

/* ----- Page(s): Item-Level ----- */

function ReportItemLevel({
  scopeName, scopedAnswers, hospitalAnswers, showBenchmark, questions, composites, language,
}: {
  scopeName: string
  scopedAnswers: PscsAnswer[]
  hospitalAnswers: PscsAnswer[]
  showBenchmark: boolean
  questions: PscsQuestion[]
  composites: PscsComposite[]
  language: 'en' | 'ms'
}) {
  // Group composites into pages so each page fits ~roughly the same amount.
  // We'll do 3 composites per page conservatively.
  const comps = composites.filter((c) => !isStandaloneComposite(c))
  const COMPS_PER_PAGE = 3
  const pages: PscsComposite[][] = []
  for (let i = 0; i < comps.length; i += COMPS_PER_PAGE) pages.push(comps.slice(i, i + COMPS_PER_PAGE))

  return (
    <>
      {pages.map((chunk, idx) => (
        <div className="rc-page" key={`itemlevel-${idx}`}>
          <div className="rc-h">
            <div className="t1">{language === 'en' ? 'Item-Level Results' : 'Keputusan Per Item'} {pages.length > 1 ? `(${idx + 1}/${pages.length})` : ''}</div>
            <div className="t2">{scopeName}</div>
          </div>
          {chunk.map((c) => {
            const qs = questions.filter((q) => q.composite_code === c.code && q.active).sort((a, b) => a.sort_order - b.sort_order)
            return (
              <div className="rc-section" key={c.code}>
                <div className="rc-st">{c.code} · {language === 'en' ? c.name_en : c.name_ms}</div>
                <table className="rc-items">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>ID</th>
                      <th>{language === 'en' ? 'Item' : 'Item'}</th>
                      <th style={{ width: 200 }}>+ / – / Neutral</th>
                      <th style={{ width: 50 }}>n</th>
                      <th style={{ width: 50 }}>{language === 'en' ? '%+' : '%+'}</th>
                      {showBenchmark && <th style={{ width: 50 }}>{language === 'en' ? 'Hosp.' : 'Hosp.'}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {qs.map((q) => {
                      const st = itemStats(q, scopedAnswers)
                      const hospSt = itemStats(q, hospitalAnswers)
                      const hospPct = hospSt.total >= 3 ? hospSt.pct_positive : null
                      return (
                        <tr key={q.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: 9 }}>{q.id}{q.wording === '-' && <span style={{ color: 'var(--red)', marginLeft: 2 }}>−</span>}</td>
                          <td style={{ fontSize: 9.5, lineHeight: 1.35 }}>{language === 'en' ? q.text_en : q.text_ms}</td>
                          <td>
                            {st.total < 3 ? <span className="rc-na">{language === 'en' ? 'insufficient' : 'tidak cukup'}</span> : (
                              <div className="rc-itembar">
                                <div className="rc-itembar-seg pos" style={{ width: `${st.pct_positive}%` }} />
                                <div className="rc-itembar-seg neu" style={{ width: `${st.pct_neutral}%` }} />
                                <div className="rc-itembar-seg neg" style={{ width: `${st.pct_negative}%` }} />
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'center', fontSize: 9, color: 'var(--muted)' }}>{st.total}</td>
                          <td style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, color: st.total < 3 ? 'var(--muted)' : BAND_COLOR[band(st.pct_positive)] }}>
                            {st.total < 3 ? '—' : `${Math.round(st.pct_positive)}%`}
                          </td>
                          {showBenchmark && (
                            <td style={{ textAlign: 'right', fontSize: 9, color: hospPct === null ? 'var(--muted)' : BAND_COLOR[band(hospPct)] }}>
                              {hospPct === null ? '—' : `${Math.round(hospPct)}%`}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
          <div className="rc-itembar-key">
            <span><span className="rc-itembar-seg pos inline" /> {language === 'en' ? 'Positive' : 'Positif'}</span>
            <span><span className="rc-itembar-seg neu inline" /> {language === 'en' ? 'Neutral' : 'Neutral'}</span>
            <span><span className="rc-itembar-seg neg inline" /> {language === 'en' ? 'Negative' : 'Negatif'}</span>
            <span style={{ color: 'var(--red)', marginLeft: 12 }}>−</span> = {language === 'en' ? 'negatively worded (reverse-scored)' : 'pernyataan negatif (skor terbalik)'}
          </div>
          <ReportFooter language={language} />
        </div>
      ))}
    </>
  )
}

/* ----- Page: Events Reported & Patient Safety Rating ----- */

function ReportEventsRating({
  scopeName, scopedAnswers, language,
}: {
  scopeName: string
  scopedAnswers: PscsAnswer[]
  language: 'en' | 'ms'
}) {
  const d3 = distribution('D3', scopedAnswers)
  const e1 = distribution('E1', scopedAnswers)
  const d3Positive = d3.items.filter((b) => b.value >= 2).reduce((s, b) => s + b.pct, 0)
  const e1Positive = e1.items.filter((b) => b.value >= 4).reduce((s, b) => s + b.pct, 0)

  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">{language === 'en' ? 'Events Reported & Patient Safety Rating' : 'Insiden Dilaporkan & Tahap Keselamatan Pesakit'}</div>
        <div className="t2">{scopeName}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="rc-section">
          <div className="rc-st">D3 · {language === 'en' ? 'Events Reported (past 12 months)' : 'Insiden Dilaporkan (12 bulan)'}</div>
          <div className="rc-bigpct" style={{ color: BAND_COLOR[band(d3Positive)] }}>{d3.total === 0 ? '—' : `${Math.round(d3Positive)}%`}</div>
          <div className="rc-bigpct-cap">{language === 'en' ? 'reported ≥1 event' : 'laporkan ≥1 insiden'}</div>
          <RcBucketTable
            buckets={d3.items}
            labels={language === 'en' ? ['None', '1–2', '3–5', '6–10', '11 or more'] : ['Tiada', '1–2', '3–5', '6–10', '11 atau lebih']}
            positiveFrom={2} />
        </div>
        <div className="rc-section">
          <div className="rc-st">E1 · {language === 'en' ? 'Patient Safety Rating' : 'Tahap Keselamatan Pesakit'}</div>
          <div className="rc-bigpct" style={{ color: BAND_COLOR[band(e1Positive)] }}>{e1.total === 0 ? '—' : `${Math.round(e1Positive)}%`}</div>
          <div className="rc-bigpct-cap">{language === 'en' ? 'Very Good / Excellent' : 'Sangat Bagus / Cemerlang'}</div>
          <RcBucketTable
            buckets={e1.items}
            labels={language === 'en' ? ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'] : ['Lemah', 'Boleh Tahan', 'Bagus', 'Sangat Bagus', 'Cemerlang']}
            positiveFrom={4} />
        </div>
      </div>

      <ReportFooter language={language} />
    </div>
  )
}

function RcBucketTable({ buckets, labels, positiveFrom }: {
  buckets: { value: number; count: number; pct: number }[]
  labels: string[]
  positiveFrom: number
}) {
  return (
    <table className="rc-dist">
      <thead><tr><th>Response</th><th>n</th><th>%</th></tr></thead>
      <tbody>
        {buckets.map((b, i) => (
          <tr key={b.value}>
            <td style={{ color: b.value >= positiveFrom ? 'var(--green)' : 'var(--red)' }}>{labels[i]}</td>
            <td>{b.count}</td>
            <td>{Math.round(b.pct)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ----- Page(s): Cross-tabs — AHRQ transposed layout ----- */
/*
 * Each axis becomes one page (or several, when the cohort count exceeds
 * COLS_PER_PAGE). Layout mirrors the AHRQ SOPS comparative tables:
 *   - composites as rows down the left
 *   - cohort groups as columns across the top
 *   - per composite, TWO sub-rows when showBenchmark is true:
 *       "This [Scope]"  — scoped responses in that group
 *       "Hospital"      — hospital-wide responses in that same group
 *     (single row when scope is the whole hospital, since the two are equal)
 *   - a Respondent Counts header row at the top of the table
 *   - a Composite Measure Average row at the bottom
 */

interface CtGroup {
  key: string
  label_en: string
  label_ms: string
  scopedResponses: PscsResponse[]
  hospitalResponses: PscsResponse[]
}
interface CtAxis {
  key: string
  title_en: string
  title_ms: string
  groups: CtGroup[]
}

function ReportCrossTabs({
  scope, scopeName, scoped, hospitalResponses, allAnswers, showBenchmark, questions, composites, positions, departments, language,
}: {
  scope: ReportScope
  scopeName: string
  scoped: PscsResponse[]
  hospitalResponses: PscsResponse[]
  allAnswers: PscsAnswer[]
  showBenchmark: boolean
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  // Build axes. For each axis, key-function determines column membership.
  // Columns are driven by groups that exist in `scoped` (so the page shows
  // your scope's cohorts); hospital benchmark cells are computed by
  // filtering `hospitalResponses` against the same key.
  const posById = useMemo(() => {
    const m = new Map<number, PscsPosition>()
    for (const p of positions) m.set(p.id, p)
    return m
  }, [positions])
  const deptByCode = useMemo(() => {
    const m = new Map<string, PscsDepartment>()
    for (const d of departments) m.set(d.code, d)
    return m
  }, [departments])

  type KeyDef = {
    key: string
    title_en: string
    title_ms: string
    keyOf: (r: PscsResponse) => string | null
    labelOf: (k: string) => { en: string; ms: string }
    order?: (a: string, b: string) => number
    // Whether this axis is meaningful at the given report scope.
    // 'Department' only makes sense at hospital/directorate scope (a dept
    // report is by definition one department). 'Sub-unit' only at dept scope.
    appliesAtScope?: (scope: ReportScope) => boolean
  }

  const deptHasSubunits = scope.kind === 'department' && departments.some(
    (d) => d.kind === 'subunit' && d.parent_code === scope.code,
  )

  const keyDefs: KeyDef[] = [
    {
      key: 'department',
      title_en: 'By Department',
      title_ms: 'Mengikut Jabatan',
      keyOf: (r) => r.department_code ?? null,
      labelOf: (k) => {
        const d = deptByCode.get(k)
        return { en: d?.name_en ?? k, ms: d?.name_ms ?? k }
      },
      appliesAtScope: (s) => s.kind === 'all' || s.kind === 'directorate',
    },
    {
      key: 'subunit',
      title_en: 'By Sub-unit',
      title_ms: 'Mengikut Sub-unit',
      keyOf: (r) => r.sub_department_code ?? null,
      labelOf: (k) => {
        const d = deptByCode.get(k)
        return { en: d?.name_en ?? k, ms: d?.name_ms ?? k }
      },
      appliesAtScope: () => deptHasSubunits,
    },
    {
      key: 'posgroup',
      title_en: 'By Position Group',
      title_ms: 'Mengikut Kumpulan Kakitangan',
      keyOf: (r) => {
        const p = r.position_id ? posById.get(r.position_id) : null
        return p?.group_en ?? null
      },
      labelOf: (k) => {
        const p = positions.find((x) => x.group_en === k)
        return { en: p?.group_en ?? k, ms: p?.group_ms ?? k }
      },
    },
    {
      key: 'position',
      title_en: 'By Staff Position',
      title_ms: 'Mengikut Jawatan',
      keyOf: (r) => (r.position_id != null ? String(r.position_id) : null),
      labelOf: (k) => {
        const p = posById.get(parseInt(k, 10))
        return { en: p?.name_en ?? k, ms: p?.name_ms ?? k }
      },
    },
    {
      key: 'tenure',
      title_en: 'By Tenure in Hospital',
      title_ms: 'Mengikut Tempoh di Hospital',
      keyOf: (r) => r.tenure_hospital ?? null,
      labelOf: (k) => {
        const map: Record<string, { en: string; ms: string }> = {
          '<1y':   { en: 'Less than 1 year', ms: 'Kurang dari 1 tahun' },
          '1-5y':  { en: '1–5 years',        ms: '1–5 tahun' },
          '6-10y': { en: '6–10 years',       ms: '6–10 tahun' },
          '11+y':  { en: '11+ years',        ms: '11+ tahun' },
        }
        return map[k] ?? { en: k, ms: k }
      },
      order: (a, b) => ['<1y','1-5y','6-10y','11+y'].indexOf(a) - ['<1y','1-5y','6-10y','11+y'].indexOf(b),
    },
    {
      key: 'hours',
      title_en: 'By Working Hours',
      title_ms: 'Mengikut Waktu Bekerja',
      keyOf: (r) => r.hours_per_week ?? null,
      labelOf: (k) => {
        const map: Record<string, { en: string; ms: string }> = {
          '<30':   { en: 'Less than 30 hours per week', ms: 'Kurang dari 30 jam seminggu' },
          '30-40': { en: '30 to 40 hours per week',     ms: '30 hingga 40 jam seminggu' },
          '>40':   { en: 'More than 40 hours per week', ms: 'Lebih dari 40 jam seminggu' },
        }
        return map[k] ?? { en: k, ms: k }
      },
      order: (a, b) => ['<30','30-40','>40'].indexOf(a) - ['<30','30-40','>40'].indexOf(b),
    },
    {
      key: 'contact',
      title_en: 'By Patient Contact',
      title_ms: 'Mengikut Interaksi Pesakit',
      keyOf: (r) => r.direct_patient_contact === true ? 'yes' : r.direct_patient_contact === false ? 'no' : null,
      labelOf: (k) => k === 'yes'
        ? { en: 'Yes — direct patient contact', ms: 'Ya — interaksi langsung' }
        : { en: 'No — no direct contact', ms: 'Tidak — tiada interaksi langsung' },
      order: (a) => a === 'yes' ? -1 : 1,
    },
  ]

  const axes: CtAxis[] = keyDefs.map((def) => {
    // Skip axes that aren't meaningful at this scope
    if (def.appliesAtScope && !def.appliesAtScope(scope)) return null
    // Scope groups
    const scopeByKey = new Map<string, PscsResponse[]>()
    for (const r of scoped) {
      const k = def.keyOf(r); if (k === null) continue
      if (!scopeByKey.has(k)) scopeByKey.set(k, [])
      scopeByKey.get(k)!.push(r)
    }
    // Hospital groups — always indexed across the WHOLE hospital so that
    // dept/sub-unit reports can show hospital-only cohorts as columns
    // (e.g. Medicine has 0 Specialists, but the hospital has 2 — that's a
    // useful comparison to surface).
    const hospByKey = new Map<string, PscsResponse[]>()
    for (const r of hospitalResponses) {
      const k = def.keyOf(r); if (k === null) continue
      if (!hospByKey.has(k)) hospByKey.set(k, [])
      hospByKey.get(k)!.push(r)
    }

    // Columns are driven strictly by cohorts present in `scoped` — we never
    // invent columns for cohorts that have zero scope respondents. The
    // benchmark comparison is delivered by the Hospital sub-row for the
    // SAME cohort (e.g. "Medical Officer in Medicine" vs "Medical Officer
    // across the hospital"), not by adding a Specialist column to a report
    // that has no Specialists.
    const keySet = new Set<string>(Array.from(scopeByKey.keys()))

    // Render rules:
    //   - whole hospital report (showBenchmark=false): need ≥2 cohorts for
    //     a comparison to be meaningful
    //   - dept/sub-unit report (showBenchmark=true): render any axis with at
    //     least one cohort, because the Scope vs Hospital sub-rows alone
    //     produce a useful comparison even for a single-cohort axis
    if (!showBenchmark && keySet.size < 2) return null
    if (keySet.size === 0) return null

    const keys = Array.from(keySet)
    if (def.order) keys.sort(def.order)
    else keys.sort((a, b) => {
      // Sort by scope cohort size, then by hospital cohort size as tiebreaker
      const aS = scopeByKey.get(a)?.length ?? 0
      const bS = scopeByKey.get(b)?.length ?? 0
      if (bS !== aS) return bS - aS
      return (hospByKey.get(b)?.length ?? 0) - (hospByKey.get(a)?.length ?? 0)
    })
    const groups: CtGroup[] = keys.map((k) => {
      const lab = def.labelOf(k)
      return {
        key: k,
        label_en: lab.en,
        label_ms: lab.ms,
        scopedResponses: scopeByKey.get(k) ?? [],
        hospitalResponses: hospByKey.get(k) ?? [],
      }
    })
    return { key: def.key, title_en: def.title_en, title_ms: def.title_ms, groups }
  }).filter((a): a is CtAxis => a !== null)

  if (axes.length === 0) return null

  // Paginate wide axes — these pages render in A4 landscape (297mm wide),
  // so we can comfortably fit ~10 cohort columns beside the label + dataset
  // column. Axes with more cohorts split into additional pages.
  const COLS_PER_PAGE = 10
  const pages: { axis: CtAxis; cols: CtGroup[]; pageNum: number; totalPages: number }[] = []
  for (const axis of axes) {
    const totalPages = Math.max(1, Math.ceil(axis.groups.length / COLS_PER_PAGE))
    for (let i = 0; i < totalPages; i++) {
      pages.push({
        axis,
        cols: axis.groups.slice(i * COLS_PER_PAGE, (i + 1) * COLS_PER_PAGE),
        pageNum: i + 1,
        totalPages,
      })
    }
  }

  return (
    <>
      {pages.map((p, idx) => (
        <ReportCrossTabPage
          key={`${p.axis.key}-${p.pageNum}-${idx}`}
          title={language === 'en' ? p.axis.title_en : p.axis.title_ms}
          scopeName={scopeName}
          cols={p.cols}
          pageNum={p.pageNum}
          totalPages={p.totalPages}
          composites={composites}
          questions={questions}
          allAnswers={allAnswers}
          showBenchmark={showBenchmark}
          language={language}
        />
      ))}
    </>
  )
}

function ReportCrossTabPage({
  title, scopeName, cols, pageNum, totalPages, composites, questions, allAnswers, showBenchmark, language,
}: {
  title: string
  scopeName: string
  cols: CtGroup[]
  pageNum: number
  totalPages: number
  composites: PscsComposite[]
  questions: PscsQuestion[]
  allAnswers: PscsAnswer[]
  showBenchmark: boolean
  language: 'en' | 'ms'
}) {
  const compsForRows = composites.filter((c) => !isStandaloneComposite(c))

  // Pre-compute scope and hospital composite scores per (composite × column)
  // plus overall composite averages per column.
  const data = useMemo(() => {
    const perCol = cols.map((col) => {
      const scopedAns = answersForResponses(col.scopedResponses, allAnswers)
      const hospAns   = answersForResponses(col.hospitalResponses, allAnswers)
      const scopeScores = new Map<string, number | null>()
      const hospScores  = new Map<string, number | null>()
      for (const c of compsForRows) {
        scopeScores.set(c.code, compositeStats(c.code, questions, scopedAns).score)
        hospScores.set(c.code,  compositeStats(c.code, questions, hospAns).score)
      }
      const scopeValid = Array.from(scopeScores.values()).filter((s): s is number => s !== null)
      const hospValid  = Array.from(hospScores.values()).filter((s): s is number => s !== null)
      return {
        col,
        scopeN: col.scopedResponses.length,
        hospN:  col.hospitalResponses.length,
        scopeScores,
        hospScores,
        scopeAvg: scopeValid.length === 0 ? null : scopeValid.reduce((a, b) => a + b, 0) / scopeValid.length,
        hospAvg:  hospValid.length  === 0 ? null : hospValid.reduce((a, b) => a + b, 0)  / hospValid.length,
      }
    })
    return perCol
  }, [cols, allAnswers, compsForRows, questions])

  function pctCell(v: number | null, n: number): React.ReactNode {
    if (n < 3) return <span style={{ color: 'var(--muted)', fontSize: 8.5, fontStyle: 'italic' }}>small n</span>
    if (v === null) return <span style={{ color: 'var(--muted)' }}>—</span>
    return <span style={{ color: BAND_COLOR[band(v)], fontWeight: 700 }}>{Math.round(v)}%</span>
  }

  const scopeLabel    = language === 'en' ? 'This Scope' : 'Skop Ini'
  const hospLabel     = language === 'en' ? 'Hospital'   : 'Hospital'
  const datasetHeader = language === 'en' ? 'Dataset'    : 'Set Data'

  return (
    <div className="rc-page rc-landscape">
      <div className="rc-h">
        <div className="t1">
          {language === 'en' ? 'Composite Measure Average % Positive — ' : 'Purata % Positif Komposit — '}
          {title}
          {totalPages > 1 && ` (${language === 'en' ? 'page' : 'm/s'} ${pageNum} ${language === 'en' ? 'of' : 'dari'} ${totalPages})`}
        </div>
        <div className="t2">{scopeName}</div>
      </div>
      <div className="rc-section">
        <table className="rc-xmatrix">
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '12%' }} />
            {cols.map((c) => <col key={c.key} />)}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="rc-xleft">{language === 'en' ? 'SOPS Composite Measures' : 'Komposit SOPS'}</th>
              <th rowSpan={2} className="rc-xds">{datasetHeader}</th>
              <th colSpan={cols.length} className="rc-xgrouphdr">{title}</th>
            </tr>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className="rc-xcol" title={language === 'en' ? c.label_en : c.label_ms}>
                  {language === 'en' ? c.label_en : c.label_ms}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Respondent counts header — 1 or 2 rows */}
            <tr className="rc-xcount-row">
              <td className="rc-xleft"><b>{language === 'en' ? '# Respondents' : 'Bil. Respondent'}</b></td>
              <td className="rc-xds">{showBenchmark ? scopeLabel : (language === 'en' ? 'Your Hospital' : 'Hospital Anda')}</td>
              {data.map((d) => (
                <td key={d.col.key} className="rc-xcount">{d.scopeN}</td>
              ))}
            </tr>
            {showBenchmark && (
              <tr className="rc-xcount-row">
                <td className="rc-xleft" />
                <td className="rc-xds">{hospLabel}</td>
                {data.map((d) => (
                  <td key={d.col.key} className="rc-xcount" style={{ color: 'var(--muted)' }}>{d.hospN}</td>
                ))}
              </tr>
            )}

            {/* Composite rows */}
            {compsForRows.map((c, ci) => (
              <React.Fragment key={c.code}>
                <tr className="rc-xcomp-row">
                  <td className="rc-xleft" rowSpan={showBenchmark ? 2 : 1}>
                    <div className="rc-xcomp-num">{ci + 1}.</div>
                    <div className="rc-xcomp-name">{language === 'en' ? c.name_en : c.name_ms}</div>
                    <div className="rc-xcomp-code">{c.code}{c.is_custom && <span className="rc-tag" style={{ marginLeft: 4 }}>HASA</span>}</div>
                  </td>
                  <td className="rc-xds">{showBenchmark ? scopeLabel : (language === 'en' ? 'Your Hospital' : 'Hospital Anda')}</td>
                  {data.map((d) => (
                    <td key={d.col.key} className="rc-xcell">
                      {pctCell(d.scopeScores.get(c.code) ?? null, d.scopeN)}
                    </td>
                  ))}
                </tr>
                {showBenchmark && (
                  <tr className="rc-xcomp-row rc-xhosp-row">
                    <td className="rc-xds">{hospLabel}</td>
                    {data.map((d) => (
                      <td key={d.col.key} className="rc-xcell">
                        {pctCell(d.hospScores.get(c.code) ?? null, d.hospN)}
                      </td>
                    ))}
                  </tr>
                )}
              </React.Fragment>
            ))}

            {/* Composite Measure Average rows */}
            <tr className="rc-xavg-row">
              <td className="rc-xleft" rowSpan={showBenchmark ? 2 : 1}>
                <b>{language === 'en' ? 'Composite Measure Average' : 'Purata Komposit'}</b>
              </td>
              <td className="rc-xds">{showBenchmark ? scopeLabel : (language === 'en' ? 'Your Hospital' : 'Hospital Anda')}</td>
              {data.map((d) => (
                <td key={d.col.key} className="rc-xcell"><b>{pctCell(d.scopeAvg, d.scopeN)}</b></td>
              ))}
            </tr>
            {showBenchmark && (
              <tr className="rc-xavg-row rc-xhosp-row">
                <td className="rc-xds">{hospLabel}</td>
                {data.map((d) => (
                  <td key={d.col.key} className="rc-xcell"><b>{pctCell(d.hospAvg, d.hospN)}</b></td>
                ))}
              </tr>
            )}
          </tbody>
        </table>

        <div className="rc-legend" style={{ marginTop: 6 }}>
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.strength }} /> ≥ 75%</span>
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.watch }} /> 50–74%</span>
          <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.gap }} /> &lt; 50%</span>
          <span style={{ color: 'var(--muted)' }}>
            {language === 'en'
              ? 'small n = cohort has fewer than 3 responses (cells suppressed). — = AHRQ per-item ≥3 valid responses rule not met.'
              : 'n kecil = kumpulan ada kurang dari 3 maklum balas (sel disembunyikan). — = syarat AHRQ ≥3 maklum balas sah tidak dipenuhi.'}
          </span>
        </div>
      </div>
      <ReportFooter language={language} />
    </div>
  )
}

/* ----- Page(s): Item-level cross-tabs ----- */
/*
 * Per-item % positive broken down by cohort.
 *
 * Hospital-wide report includes 4 axes:
 *   Department, Sub-unit, Position Group, Staff Position
 *
 * Department/sub-unit report includes 2 axes (only the ones meaningful at
 * that scope):
 *   Sub-unit (only if the department has sub-units), Staff Position
 *
 * Per item × cohort cell shows % positive. For dept reports each item gets
 * two sub-rows (This Scope vs Hospital benchmark for the same cohort).
 * Columns are scope-only — we never invent columns for cohorts with no
 * scope respondents. Wide axes are paginated by columns (COLS_PER_PAGE).
 */

function ReportItemCrossTabs({
  scope, scopeName, scoped, hospitalResponses, allAnswers, showBenchmark, questions, composites, positions, departments, language,
}: {
  scope: ReportScope
  scopeName: string
  scoped: PscsResponse[]
  hospitalResponses: PscsResponse[]
  allAnswers: PscsAnswer[]
  showBenchmark: boolean
  questions: PscsQuestion[]
  composites: PscsComposite[]
  positions: PscsPosition[]
  departments: PscsDepartment[]
  language: 'en' | 'ms'
}) {
  const posById = useMemo(() => {
    const m = new Map<number, PscsPosition>()
    for (const p of positions) m.set(p.id, p)
    return m
  }, [positions])
  const deptByCode = useMemo(() => {
    const m = new Map<string, PscsDepartment>()
    for (const d of departments) m.set(d.code, d)
    return m
  }, [departments])

  type KeyDef = {
    key: string
    title_en: string
    title_ms: string
    keyOf: (r: PscsResponse) => string | null
    labelOf: (k: string) => { en: string; ms: string }
    order?: (a: string, b: string) => number
    wantedAtScope: (s: ReportScope) => boolean
  }

  const deptHasSubunits = scope.kind === 'department' && departments.some(
    (d) => d.kind === 'subunit' && d.parent_code === scope.code,
  )

  // Hospital scope wants: Department, Sub-unit, Position Group, Position
  // Dept    scope wants: Sub-unit (if dept has sub-units), Position
  const keyDefs: KeyDef[] = [
    {
      key: 'department',
      title_en: 'By Department',
      title_ms: 'Mengikut Jabatan',
      keyOf: (r) => r.department_code ?? null,
      labelOf: (k) => {
        const d = deptByCode.get(k)
        return { en: d?.name_en ?? k, ms: d?.name_ms ?? k }
      },
      wantedAtScope: (s) => s.kind === 'all',
    },
    {
      key: 'subunit',
      title_en: 'By Sub-unit',
      title_ms: 'Mengikut Sub-unit',
      keyOf: (r) => r.sub_department_code ?? null,
      labelOf: (k) => {
        const d = deptByCode.get(k)
        return { en: d?.name_en ?? k, ms: d?.name_ms ?? k }
      },
      wantedAtScope: (s) => s.kind === 'all' || (s.kind === 'department' && deptHasSubunits),
    },
    {
      key: 'posgroup',
      title_en: 'By Position Group',
      title_ms: 'Mengikut Kumpulan Kakitangan',
      keyOf: (r) => {
        const p = r.position_id ? posById.get(r.position_id) : null
        return p?.group_en ?? null
      },
      labelOf: (k) => {
        const p = positions.find((x) => x.group_en === k)
        return { en: p?.group_en ?? k, ms: p?.group_ms ?? k }
      },
      wantedAtScope: (s) => s.kind === 'all',
    },
    {
      key: 'position',
      title_en: 'By Staff Position',
      title_ms: 'Mengikut Jawatan',
      keyOf: (r) => (r.position_id != null ? String(r.position_id) : null),
      labelOf: (k) => {
        const p = posById.get(parseInt(k, 10))
        return { en: p?.name_en ?? k, ms: p?.name_ms ?? k }
      },
      wantedAtScope: () => true,
    },
  ]

  type ItemAxis = {
    key: string; title_en: string; title_ms: string
    groups: CtGroup[]
  }

  const axes: ItemAxis[] = keyDefs.map((def) => {
    if (!def.wantedAtScope(scope)) return null
    const scopeByKey = new Map<string, PscsResponse[]>()
    for (const r of scoped) {
      const k = def.keyOf(r); if (k === null) continue
      if (!scopeByKey.has(k)) scopeByKey.set(k, [])
      scopeByKey.get(k)!.push(r)
    }
    if (scopeByKey.size === 0) return null
    const hospByKey = new Map<string, PscsResponse[]>()
    for (const r of hospitalResponses) {
      const k = def.keyOf(r); if (k === null) continue
      if (!hospByKey.has(k)) hospByKey.set(k, [])
      hospByKey.get(k)!.push(r)
    }
    const keys = Array.from(scopeByKey.keys())
    if (def.order) keys.sort(def.order)
    else keys.sort((a, b) => (scopeByKey.get(b)?.length ?? 0) - (scopeByKey.get(a)?.length ?? 0))
    const groups: CtGroup[] = keys.map((k) => {
      const lab = def.labelOf(k)
      return {
        key: k,
        label_en: lab.en,
        label_ms: lab.ms,
        scopedResponses: scopeByKey.get(k) ?? [],
        hospitalResponses: hospByKey.get(k) ?? [],
      }
    })
    return { key: def.key, title_en: def.title_en, title_ms: def.title_ms, groups }
  }).filter((a): a is ItemAxis => a !== null)

  if (axes.length === 0) return null

  // Landscape pages — fit ~10 cohort columns per page; items further paginated below
  const COLS_PER_PAGE = 10
  const pages: { axis: ItemAxis; cols: CtGroup[]; pageNum: number; totalPages: number }[] = []
  for (const axis of axes) {
    const totalPages = Math.max(1, Math.ceil(axis.groups.length / COLS_PER_PAGE))
    for (let i = 0; i < totalPages; i++) {
      pages.push({
        axis,
        cols: axis.groups.slice(i * COLS_PER_PAGE, (i + 1) * COLS_PER_PAGE),
        pageNum: i + 1,
        totalPages,
      })
    }
  }

  return (
    <>
      {pages.map((p, idx) => (
        <ReportItemCrossTabPage
          key={`item-${p.axis.key}-${p.pageNum}-${idx}`}
          title={language === 'en' ? p.axis.title_en : p.axis.title_ms}
          scopeName={scopeName}
          cols={p.cols}
          pageNum={p.pageNum}
          totalPages={p.totalPages}
          composites={composites}
          questions={questions}
          allAnswers={allAnswers}
          showBenchmark={showBenchmark}
          language={language}
        />
      ))}
    </>
  )
}

function ReportItemCrossTabPage({
  title, scopeName, cols, pageNum, totalPages, composites, questions, allAnswers, showBenchmark, language,
}: {
  title: string
  scopeName: string
  cols: CtGroup[]
  pageNum: number
  totalPages: number
  composites: PscsComposite[]
  questions: PscsQuestion[]
  allAnswers: PscsAnswer[]
  showBenchmark: boolean
  language: 'en' | 'ms'
}) {
  const compsForGroups = composites.filter((c) => !isStandaloneComposite(c))

  // Pre-compute per-(item × cohort) % positive for scope and hospital cohorts
  const colData = useMemo(() => cols.map((col) => {
    const scopedAns = answersForResponses(col.scopedResponses, allAnswers)
    const hospAns   = answersForResponses(col.hospitalResponses, allAnswers)
    return {
      col,
      scopeN: col.scopedResponses.length,
      hospN:  col.hospitalResponses.length,
      scopedAns,
      hospAns,
    }
  }), [cols, allAnswers])

  function pctCell(q: PscsQuestion, answers: PscsAnswer[], cohortN: number): React.ReactNode {
    if (cohortN < 3) return <span style={{ color: 'var(--muted)', fontSize: 8, fontStyle: 'italic' }}>small n</span>
    const s = itemStats(q, answers)
    if (s.total < 3) return <span style={{ color: 'var(--muted)' }}>—</span>
    return <span style={{ color: BAND_COLOR[band(s.pct_positive)], fontWeight: 700 }}>{Math.round(s.pct_positive)}%</span>
  }

  const scopeLabel = language === 'en' ? 'This Scope' : 'Skop Ini'
  const hospLabel  = language === 'en' ? 'Hospital'   : 'Hospital'
  const datasetHeader = language === 'en' ? 'Dataset'  : 'Set Data'

  // Items per page on a LANDSCAPE A4 page (~182mm usable height after margins).
  // Conservative: 14 items per page in dual-row (Scope/Hospital) mode, 26 in
  // single-row (Whole Hospital) mode.
  const ITEMS_PER_PAGE = showBenchmark ? 14 : 26
  const allItems: { composite: PscsComposite; q: PscsQuestion }[] = []
  for (const c of compsForGroups) {
    const qs = questions.filter((q) => q.composite_code === c.code && q.active)
      .sort((a, b) => a.sort_order - b.sort_order)
    for (const q of qs) allItems.push({ composite: c, q })
  }
  const itemChunks: typeof allItems[] = []
  for (let i = 0; i < allItems.length; i += ITEMS_PER_PAGE) {
    itemChunks.push(allItems.slice(i, i + ITEMS_PER_PAGE))
  }

  return (
    <>
      {itemChunks.map((chunk, chunkIdx) => {
        const pageTitle = `${title}${totalPages > 1 ? ` (${language === 'en' ? 'page' : 'm/s'} ${pageNum} ${language === 'en' ? 'of' : 'dari'} ${totalPages})` : ''}${itemChunks.length > 1 ? ` · ${language === 'en' ? 'items' : 'item'} ${chunkIdx + 1}/${itemChunks.length}` : ''}`
        // Track current composite to insert composite header rows when it changes
        let lastCompCode: string | null = null
        return (
          <div className="rc-page rc-landscape" key={`itemxt-page-${chunkIdx}`}>
            <div className="rc-h">
              <div className="t1">
                {language === 'en' ? 'Survey Item % Positive — ' : '% Positif Item — '}{pageTitle}
              </div>
              <div className="t2">{scopeName}</div>
            </div>
            <div className="rc-section">
              <table className="rc-xmatrix rc-itemxt">
                <colgroup>
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '10%' }} />
                  {cols.map((c) => <col key={c.key} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className="rc-xleft">{language === 'en' ? 'Survey Item' : 'Item Tinjauan'}</th>
                    <th rowSpan={2} className="rc-xds">{datasetHeader}</th>
                    <th colSpan={cols.length} className="rc-xgrouphdr">{title}</th>
                  </tr>
                  <tr>
                    {cols.map((c) => (
                      <th key={c.key} className="rc-xcol" title={language === 'en' ? c.label_en : c.label_ms}>
                        {language === 'en' ? c.label_en : c.label_ms}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Respondent counts — same dual/single-row pattern */}
                  <tr className="rc-xcount-row">
                    <td className="rc-xleft"><b>{language === 'en' ? '# Respondents' : 'Bil. Respondent'}</b></td>
                    <td className="rc-xds">{showBenchmark ? scopeLabel : (language === 'en' ? 'Your Hospital' : 'Hospital Anda')}</td>
                    {colData.map((d) => (
                      <td key={d.col.key} className="rc-xcount">{d.scopeN}</td>
                    ))}
                  </tr>
                  {showBenchmark && (
                    <tr className="rc-xcount-row">
                      <td className="rc-xleft" />
                      <td className="rc-xds">{hospLabel}</td>
                      {colData.map((d) => (
                        <td key={d.col.key} className="rc-xcount" style={{ color: 'var(--muted)' }}>{d.hospN}</td>
                      ))}
                    </tr>
                  )}

                  {chunk.map(({ composite, q }) => {
                    const compHeader = composite.code !== lastCompCode
                      ? (
                        <tr key={`comphdr-${composite.code}`} className="rc-itemxt-comp">
                          <td colSpan={2 + cols.length}>
                            <b>{composite.code}</b> · {language === 'en' ? composite.name_en : composite.name_ms}
                          </td>
                        </tr>
                      ) : null
                    if (composite.code !== lastCompCode) lastCompCode = composite.code
                    return (
                      <React.Fragment key={q.id}>
                        {compHeader}
                        <tr className="rc-xcomp-row">
                          <td className="rc-xleft" rowSpan={showBenchmark ? 2 : 1}>
                            <span className="rc-itemxt-id">{q.id}{q.wording === '-' && <span style={{ color: 'var(--red)', marginLeft: 2 }}>−</span>}</span>
                            <span className="rc-itemxt-text">{language === 'en' ? q.text_en : q.text_ms}</span>
                          </td>
                          <td className="rc-xds">{showBenchmark ? scopeLabel : (language === 'en' ? 'Your Hospital' : 'Hospital Anda')}</td>
                          {colData.map((d) => (
                            <td key={d.col.key} className="rc-xcell">
                              {pctCell(q, d.scopedAns, d.scopeN)}
                            </td>
                          ))}
                        </tr>
                        {showBenchmark && (
                          <tr className="rc-xcomp-row rc-xhosp-row">
                            <td className="rc-xds">{hospLabel}</td>
                            {colData.map((d) => (
                              <td key={d.col.key} className="rc-xcell">
                                {pctCell(q, d.hospAns, d.hospN)}
                              </td>
                            ))}
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>

              <div className="rc-legend" style={{ marginTop: 6 }}>
                <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.strength }} /> ≥ 75%</span>
                <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.watch }} /> 50–74%</span>
                <span><span className="rc-legend-dot" style={{ background: BAND_COLOR.gap }} /> &lt; 50%</span>
                <span style={{ color: 'var(--muted)' }}>
                  {language === 'en'
                    ? 'small n = cohort has fewer than 3 responses (cells suppressed). — = item has fewer than 3 valid (non-zero) responses in that cohort.'
                    : 'n kecil = kumpulan ada kurang dari 3 maklum balas (sel disembunyikan). — = item kurang dari 3 maklum balas sah dalam kumpulan tersebut.'}
                </span>
                <span style={{ color: 'var(--red)' }}>−</span> = {language === 'en' ? 'negatively worded (reverse-scored)' : 'pernyataan negatif (skor terbalik)'}
              </div>
            </div>
            <ReportFooter language={language} />
          </div>
        )
      })}
    </>
  )
}

/* ----- Page: Methodology ----- */

function ReportMethodology({ language }: { language: 'en' | 'ms' }) {
  return (
    <div className="rc-page">
      <div className="rc-h">
        <div className="t1">{language === 'en' ? 'Methodology & Definitions' : 'Kaedah & Definisi'}</div>
      </div>

      <div className="rc-section">
        <div className="rc-st">{language === 'en' ? 'Scoring Rule (AHRQ SOPS 2.0)' : 'Kaedah Pemarkahan (AHRQ SOPS 2.0)'}</div>
        <div className="rc-prose">
          {language === 'en' ? (
            <>
              <p>Each item uses a 5-point scale (1 = strongest disagree/never · 5 = strongest agree/always). A 6th &ldquo;Don&apos;t Know / Not Applicable&rdquo; option is coded 0 and is <b>excluded</b> from both the numerator and denominator.</p>
              <p><b>Positive response:</b> values 4–5 for positively-worded items, values 1–2 for negatively-worded items (reverse-scored). <b>Neutral:</b> value 3, regardless of wording. <b>Negative:</b> the inverse of positive.</p>
              <p><b>Item % positive</b> is calculated only when at least 3 valid (non-zero) responses are recorded for that item.</p>
              <p><b>Composite score</b> is the mean of its item % positives. A composite reports a score only when ≥ half of its items have a score (for 3-item composites, ≥ 2 of 3).</p>
            </>
          ) : (
            <>
              <p>Setiap item menggunakan skala 5-mata (1 = paling tidak bersetuju/tidak pernah · 5 = paling bersetuju/sentiasa). Pilihan ke-6 &quot;Tidak Tahu / Tidak Berkenaan&quot; dikodkan sebagai 0 dan <b>dikecualikan</b> dari pengangka dan penyebut.</p>
              <p><b>Maklum balas positif:</b> nilai 4–5 untuk item positif, nilai 1–2 untuk item negatif (skor terbalik). <b>Neutral:</b> nilai 3. <b>Negatif:</b> sebaliknya.</p>
              <p><b>Item % positif</b> dikira hanya apabila sekurang-kurangnya 3 maklum balas sah (bukan-sifar) direkodkan.</p>
              <p><b>Skor komposit</b> adalah purata % positif item-itemnya. Komposit memberi skor hanya apabila ≥ separuh itemnya mempunyai skor.</p>
            </>
          )}
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">{language === 'en' ? 'Color Bands' : 'Jalur Warna'}</div>
        <div className="rc-bands">
          <div><span className="rc-legend-dot" style={{ background: BAND_COLOR.strength }} /> <b>{language === 'en' ? 'Strength' : 'Kekuatan'}</b> — ≥ 75% {language === 'en' ? 'positive' : 'positif'}</div>
          <div><span className="rc-legend-dot" style={{ background: BAND_COLOR.watch }} /> <b>{language === 'en' ? 'Watch' : 'Pemantauan'}</b> — 50–74% {language === 'en' ? 'positive' : 'positif'}</div>
          <div><span className="rc-legend-dot" style={{ background: BAND_COLOR.gap }} /> <b>{language === 'en' ? 'Gap' : 'Jurang'}</b> — &lt; 50% {language === 'en' ? 'positive' : 'positif'}</div>
          <div><span className="rc-legend-dot" style={{ background: BAND_COLOR.na }} /> <b>{language === 'en' ? 'Insufficient data' : 'Data tidak cukup'}</b></div>
        </div>
      </div>

      <div className="rc-section">
        <div className="rc-st">{language === 'en' ? 'Privacy Guard' : 'Perlindungan Privasi'}</div>
        <div className="rc-prose">
          {language === 'en'
            ? <p>Cohorts with fewer than 3 responses are marked &ldquo;small n&rdquo; and their composite cells are hidden to protect respondent anonymity, on top of the AHRQ per-item &ge; 3 valid responses rule.</p>
            : <p>Kumpulan dengan kurang daripada 3 maklum balas ditandakan &ldquo;n kecil&rdquo; dan sel komposit disembunyikan untuk menjaga anonimiti, di samping syarat AHRQ &ge; 3 maklum balas sah setiap item.</p>}
        </div>
      </div>

      <ReportFooter language={language} />
    </div>
  )
}

/* ----- Shared report footer ----- */

function ReportFooter({ language }: { language: 'en' | 'ms' }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="rc-foot rc-foot-paged">
      <span className="rc-foot-spacer" />
      <span className="rc-foot-text">
        {language === 'en'
          ? `RMCQ · Quality Assurance and Document Management Unit · Patient Safety Culture Survey · Confidential · Generated ${today}`
          : `RMCQ · Unit Jaminan Kualiti dan Pengurusan Dokumen · Tinjauan Budaya Keselamatan Pesakit · Sulit · Dihasilkan ${today}`}
      </span>
      <span className="rc-foot-pageno" aria-hidden="true" />
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
