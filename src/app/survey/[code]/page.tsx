'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/* ======================== TYPES ======================== */

type Lang = 'en' | 'ms'

type Step =
  | 'loading'
  | 'closed'
  | 'welcome'
  | 'staffid'
  | 'demographics'
  | 'section'
  | 'comments'
  | 'submitting'
  | 'done'
  | 'duplicate'

type Section = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

type Question = {
  id: string
  section: Section
  item_num: number
  composite_code: string
  wording: '+' | '-'
  text_en: string
  text_ms: string
  scale_type: 'Agreement' | 'Frequency' | 'EventCount' | 'Rating'
  sort_order: number
}

type Position = {
  id: number
  group_en: string
  group_ms: string
  name_en: string
  name_ms: string
  sort_order: number
}

type Department = {
  code: string
  name_en: string
  name_ms: string
  parent_code: string | null
  is_high_risk: boolean
  allow_across: boolean
  analysis_group_en: string
  analysis_group_ms: string
  kind: 'directorate' | 'department' | 'subunit'
  sort_order: number
}

type Campaign = {
  id: number
  code: string
  name_en: string
  name_ms: string
  open_date: string
  close_date: string
  salt: string
  active: boolean
}

type FormState = {
  language: Lang
  staffId: string
  positionGroup: string | null
  positionId: number | null
  positionOther: string
  directorateCode: string | null
  departmentCode: string | null
  subDepartmentCode: string | null
  tenureHospital: '<1y' | '1-5y' | '6-10y' | '11+y' | null
  tenureUnit: '<1y' | '1-5y' | '6-10y' | '11+y' | null
  hoursPerWeek: '<30' | '30-40' | '>40' | null
  directPatientContact: boolean | null
  answers: Record<string, number>
  comment: string
}

const INITIAL_STATE: FormState = {
  language: 'en',
  staffId: '',
  positionGroup: null,
  positionId: null,
  positionOther: '',
  directorateCode: null,
  departmentCode: null,
  subDepartmentCode: null,
  tenureHospital: null,
  tenureUnit: null,
  hoursPerWeek: null,
  directPatientContact: null,
  answers: {},
  comment: '',
}

/* ======================== I18N ======================== */

const TXT = {
  beginButton:        { en: 'Begin Survey',                                   ms: 'Mulakan Tinjauan' },
  nextButton:         { en: 'Next →',                                          ms: 'Seterusnya →' },
  backButton:         { en: '← Back',                                          ms: '← Kembali' },
  submitButton:       { en: 'Submit Survey',                                  ms: 'Hantar Tinjauan' },
  langLabel:          { en: 'Language',                                        ms: 'Bahasa' },
  welcomeTitle:       { en: 'Patient Safety Culture Survey',                  ms: 'Kajian Budaya Keselamatan Pesakit' },
  welcomeIntro:       {
    en: 'This survey asks for your opinions about patient safety, medical error, and event reporting in your hospital. It takes about 10–15 minutes. Your responses are anonymous and confidential — they will only be used to improve hospital services.',
    ms: 'Tinjauan ini bertujuan mengumpulkan pendapat anda berkenaan keselamatan pesakit, kesilapan perubatan dan pelaporan kejadian di hospital. Ia mengambil masa kira-kira 10–15 minit. Maklum balas anda adalah tanpa nama dan sulit — hanya digunakan untuk menambah baik perkhidmatan hospital.',
  },
  scaleNote:          {
    en: 'If a question does not apply to you or you don\'t know the answer, please choose 0 (Don\'t Know / Not Applicable).',
    ms: 'Jika soalan tidak berkenaan dengan anda atau anda tidak tahu jawapannya, sila pilih 0 (Tidak Tahu / Tidak Berkaitan).',
  },
  staffIdTitle:       { en: 'Staff ID',                                        ms: 'ID Kakitangan' },
  staffIdPrompt:      {
    en: 'Please enter your staff ID to begin. We do NOT store your ID — it is used only to ensure each person submits the survey once.',
    ms: 'Sila masukkan ID kakitangan anda untuk bermula. Kami TIDAK menyimpan ID anda — ia hanya digunakan untuk memastikan setiap orang menjawab satu kali sahaja.',
  },
  staffIdPlaceholder: { en: 'Enter your staff ID', ms: 'Masukkan ID kakitangan anda' },
  demogTitle:         { en: 'About You',                                       ms: 'Tentang Anda' },
  positionGroupLabel: { en: 'Which staff group do you belong to?',              ms: 'Anda dari kumpulan kakitangan yang mana?' },
  positionLabel:      { en: 'What is your specific position?',                  ms: 'Apakah jawatan khusus anda?' },
  positionOtherLabel: { en: 'Please specify',                                  ms: 'Sila nyatakan' },
  directorateLabel:   { en: 'Which directorate do you fall under?',           ms: 'Anda di bawah direktorat yang mana?' },
  deptLabel:          { en: 'Which department do you primarily work in?',     ms: 'Anda bekerja di jabatan/unit yang mana?' },
  subDeptLabel:       { en: 'Do you work in a specific sub-unit within this department?', ms: 'Adakah anda bekerja di sub-unit tertentu dalam jabatan ini?' },
  subDeptNone:        { en: 'I work across the whole department',             ms: 'Saya bekerja merentas seluruh jabatan' },
  tenureHospitalQ:    { en: 'How long have you worked in this hospital?',     ms: 'Berapa lamakah anda telah bekerja di hospital ini?' },
  tenureUnitQ:        { en: 'How long have you worked in your current unit?', ms: 'Berapa lamakah anda telah bekerja di unit anda sekarang?' },
  hoursQ:             { en: 'Typically, how many hours per week do you work in this hospital?', ms: 'Pada kebiasaannya, berapa jam setiap minggu anda bekerja di hospital ini?' },
  contactQ:           { en: 'In your position, do you typically have direct interaction or contact with patients?', ms: 'Dengan posisi jawatan anda, adakah anda mempunyai interaksi secara langsung dengan pesakit?' },
  contactYes:         { en: 'YES, I typically have direct contact with patients', ms: 'YA, saya biasanya mempunyai interaksi langsung dengan pesakit' },
  contactNo:          { en: 'NO, I typically do NOT have direct contact with patients', ms: 'TIDAK, saya biasanya TIDAK mempunyai interaksi langsung dengan pesakit' },
  tenureOpts: [
    { v: '<1y',   en: 'Less than 1 year',  ms: 'Kurang dari 1 tahun' },
    { v: '1-5y',  en: '1 to 5 years',       ms: '1 hingga 5 tahun' },
    { v: '6-10y', en: '6 to 10 years',      ms: '6 hingga 10 tahun' },
    { v: '11+y',  en: '11 or more years',   ms: '11 tahun atau lebih' },
  ] as const,
  hoursOpts: [
    { v: '<30',   en: 'Less than 30 hours per week', ms: 'Kurang dari 30 jam seminggu' },
    { v: '30-40', en: '30 to 40 hours per week',     ms: '30 hingga 40 jam seminggu' },
    { v: '>40',   en: 'More than 40 hours per week', ms: 'Lebih dari 40 jam seminggu' },
  ] as const,
  agreementLabels: [
    { v: 0, en: 'N/A',               ms: 'Tidak Berkaitan' },
    { v: 1, en: 'Strongly Disagree', ms: 'Sangat Tidak Setuju' },
    { v: 2, en: 'Disagree',          ms: 'Tidak Setuju' },
    { v: 3, en: 'Neither',           ms: 'Neutral' },
    { v: 4, en: 'Agree',             ms: 'Setuju' },
    { v: 5, en: 'Strongly Agree',    ms: 'Sangat Setuju' },
  ],
  frequencyLabels: [
    { v: 0, en: 'N/A',         ms: 'Tidak Berkaitan' },
    { v: 1, en: 'Never',       ms: 'Tidak Pernah' },
    { v: 2, en: 'Rarely',      ms: 'Jarang' },
    { v: 3, en: 'Sometimes',   ms: 'Kadang-Kadang' },
    { v: 4, en: 'Most of the time', ms: 'Kebanyakan Masa' },
    { v: 5, en: 'Always',      ms: 'Sentiasa' },
  ],
  eventCountLabels: [
    { v: 1, en: 'None',         ms: 'Tiada' },
    { v: 2, en: '1 to 2',       ms: '1 hingga 2' },
    { v: 3, en: '3 to 5',       ms: '3 hingga 5' },
    { v: 4, en: '6 to 10',      ms: '6 hingga 10' },
    { v: 5, en: '11 or more',   ms: '11 atau lebih' },
  ],
  ratingLabels: [
    { v: 1, en: 'Poor',         ms: 'Lemah' },
    { v: 2, en: 'Fair',         ms: 'Boleh Tahan' },
    { v: 3, en: 'Good',         ms: 'Bagus' },
    { v: 4, en: 'Very Good',    ms: 'Sangat Bagus' },
    { v: 5, en: 'Excellent',    ms: 'Cemerlang' },
  ],
  sectionTitles: {
    A: { en: 'Section A — Your Unit / Work Area',                ms: 'Bahagian A — Kawasan Kerja Anda' },
    B: { en: 'Section B — Your Supervisor, Manager, or Clinical Leader', ms: 'Bahagian B — Penyelia, Pengurus, atau Ketua Klinikal Anda' },
    C: { en: 'Section C — Communication',                         ms: 'Bahagian C — Komunikasi' },
    D: { en: 'Section D — Reporting Patient Safety Events',       ms: 'Bahagian D — Pelaporan Insiden Keselamatan Pesakit' },
    E: { en: 'Section E — Patient Safety Rating',                 ms: 'Bahagian E — Tahap Keselamatan Pesakit' },
    F: { en: 'Section F — Your Hospital',                          ms: 'Bahagian F — Hospital Anda' },
  },
  sectionPrompts: {
    A: { en: 'How much do you agree or disagree with the following statements about your unit/work area?', ms: 'Sejauh manakah anda bersetuju atau tidak bersetuju dengan kenyataan berikut mengenai unit/kawasan kerja anda?' },
    B: { en: 'How much do you agree or disagree with the following statements about your immediate supervisor, manager, or clinical leader?', ms: 'Sejauh manakah anda bersetuju atau tidak bersetuju dengan kenyataan berikut tentang penyelia, pengurus, atau ketua klinikal anda?' },
    C: { en: 'How often do the following things happen in your unit/work area?', ms: 'Berapa kerapkah perkara berikut terjadi di unit kerja anda?' },
    D: { en: 'How often are the following events reported?', ms: 'Berapa kerapkah peristiwa berikut dilaporkan?' },
    E: { en: 'Please rate your unit/work area on patient safety.', ms: 'Sila nilai unit/kawasan kerja anda dari segi keselamatan pesakit.' },
    F: { en: 'How much do you agree or disagree with the following statements about your hospital?', ms: 'Sejauh manakah anda bersetuju atau tidak bersetuju dengan kenyataan berikut tentang hospital anda?' },
  },
  commentsTitle:      { en: 'Your Comments',                                  ms: 'Komen Anda' },
  commentsPrompt:     { en: 'Please feel free to provide any comments about how things are done or could be done in your hospital that might affect patient safety. (Optional)', ms: 'Sila berikan sebarang komen tentang perkara sedia ada atau cadangan penambahbaikan di hospital anda yang berkaitan dengan keselamatan pesakit. (Pilihan)' },
  commentsPlaceholder:{ en: 'Type your comments here (optional)…', ms: 'Tulis komen anda di sini (pilihan)…' },
  loading:            { en: 'Loading survey…',                                ms: 'Memuatkan tinjauan…' },
  closedTitle:        { en: 'Survey Closed',                                  ms: 'Tinjauan Ditutup' },
  closedBody:         { en: 'This survey is not currently open. It runs from {open} to {close}.', ms: 'Tinjauan ini belum dibuka. Tempoh: {open} hingga {close}.' },
  doneTitle:          { en: 'Thank You!',                                     ms: 'Terima Kasih!' },
  doneBody:           { en: 'Your response has been submitted. Your feedback helps improve patient safety culture at our hospital.', ms: 'Maklum balas anda telah dihantar. Pendapat anda membantu menambah baik budaya keselamatan pesakit di hospital kami.' },
  duplicateTitle:     { en: 'Already Submitted',                              ms: 'Sudah Dijawab' },
  duplicateBody:      { en: 'A response from this staff ID has already been recorded for this campaign. Each staff member may only submit once.', ms: 'Maklum balas dari ID kakitangan ini telah direkodkan untuk kempen ini. Setiap kakitangan hanya boleh menjawab sekali sahaja.' },
  errSelectPositionGroup: { en: 'Please select your staff group.', ms: 'Sila pilih kumpulan kakitangan anda.' },
  errSelectPosition:  { en: 'Please select your position.', ms: 'Sila pilih jawatan anda.' },
  errSelectDirectorate: { en: 'Please select your directorate.', ms: 'Sila pilih direktorat anda.' },
  errSelectDept:      { en: 'Please select your department.', ms: 'Sila pilih jabatan anda.' },
  errFillAll:         { en: 'Please answer all questions in this section.', ms: 'Sila jawab semua soalan di bahagian ini.' },
  errStaffIdRequired: { en: 'Staff ID is required.', ms: 'ID kakitangan diperlukan.' },
  errOtherRequired:   { en: 'Please specify your position.', ms: 'Sila nyatakan jawatan anda.' },
  errSubmit:          { en: 'There was a problem submitting your response. Please try again.', ms: 'Terdapat masalah ketika menghantar maklum balas anda. Sila cuba lagi.' },
}

const t = (key: keyof typeof TXT, lang: Lang) => {
  const v = TXT[key]
  // type-safe access for non-array entries
  if (v && typeof v === 'object' && 'en' in v && 'ms' in v) {
    return lang === 'en' ? (v as { en: string }).en : (v as { ms: string }).ms
  }
  return ''
}

/* ======================== HELPERS ======================== */

async function hashStaffId(staffId: string, salt: string): Promise<string> {
  const input = staffId.trim().toLowerCase() + '|' + salt
  // Prefer SHA-256 via Web Crypto (HTTPS required)
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(input)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } catch (err) {
      console.warn('crypto.subtle failed, falling back to deterministic hash', err)
    }
  }
  // Fallback: deterministic 64-bit-ish hash (cyrb53). Same staff ID -> same hash, so dedup still works.
  // NOT cryptographic; only used when secure context unavailable (rare on Vercel HTTPS).
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
  return 'fb_' + hex
}

const STORAGE_KEY = (campaignCode: string) => `pscs_draft_${campaignCode}`

/* ======================== MAIN COMPONENT ======================== */

export default function SurveyPage() {
  const params = useParams()
  const campaignCode = (params?.code as string) ?? ''
  const supabase = useMemo(() => createClient(), [])

  const [step, setStep] = useState<Step>('loading')
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [currentSection, setCurrentSection] = useState<Section>('A')
  const [state, setState] = useState<FormState>(INITIAL_STATE)
  const [error, setError] = useState<string | null>(null)

  // Load campaign + reference data on mount
  useEffect(() => {
    if (!campaignCode) return
    ;(async () => {
      try {
        const [campRes, qRes, pRes, dRes] = await Promise.all([
          supabase.from('pscs_campaigns').select('*').eq('code', campaignCode).maybeSingle(),
          supabase.from('pscs_questions').select('*').eq('active', true).order('sort_order'),
          supabase.from('pscs_positions').select('*').eq('active', true).order('sort_order'),
          supabase.from('pscs_departments').select('*').eq('active', true).order('sort_order'),
        ])
        if (!campRes.data) {
          setStep('closed')
          return
        }
        const c = campRes.data as Campaign
        const today = new Date().toISOString().slice(0, 10)
        if (!c.active || today < c.open_date || today > c.close_date) {
          setCampaign(c)
          setStep('closed')
          return
        }
        setCampaign(c)
        setQuestions((qRes.data ?? []) as Question[])
        setPositions((pRes.data ?? []) as Position[])
        setDepartments((dRes.data ?? []) as Department[])

        // Restore draft if any
        const draftRaw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY(campaignCode)) : null
        if (draftRaw) {
          try {
            const draft = JSON.parse(draftRaw) as FormState
            setState({ ...INITIAL_STATE, ...draft })
          } catch {}
        }
        setStep('welcome')
      } catch (e) {
        console.error(e)
        setStep('closed')
      }
    })()
  }, [campaignCode, supabase])

  // Autosave draft
  useEffect(() => {
    if (typeof window === 'undefined' || !campaignCode || step === 'loading' || step === 'done') return
    window.localStorage.setItem(STORAGE_KEY(campaignCode), JSON.stringify(state))
  }, [state, campaignCode, step])

  const lang = state.language

  /* ---- Derived data ---- */
  const sectionQuestions = useMemo(
    () => questions.filter((q) => q.section === currentSection),
    [questions, currentSection],
  )
  // Position groups in insertion order (first occurrence per group_en)
  const positionGroups = useMemo(() => {
    const seen = new Set<string>()
    const out: { group_en: string; group_ms: string }[] = []
    for (const p of positions) {
      if (!seen.has(p.group_en)) { seen.add(p.group_en); out.push({ group_en: p.group_en, group_ms: p.group_ms }) }
    }
    return out
  }, [positions])
  const positionsOfGroup = useMemo(
    () => (state.positionGroup ? positions.filter((p) => p.group_en === state.positionGroup) : []),
    [positions, state.positionGroup],
  )

  const directorates = useMemo(() => departments.filter((d) => d.kind === 'directorate'), [departments])
  const departmentsOfDirectorate = useMemo(
    () => (state.directorateCode ? departments.filter((d) => d.kind === 'department' && d.parent_code === state.directorateCode) : []),
    [departments, state.directorateCode],
  )
  const subUnitsOfSelected = useMemo(
    () => (state.departmentCode ? departments.filter((d) => d.kind === 'subunit' && d.parent_code === state.departmentCode) : []),
    [departments, state.departmentCode],
  )

  // Progress: 11 stages welcome→staffid→demographics→A→B→C→D→E→F→comments→submit
  const totalSteps = 10
  const currentProgress = useMemo(() => {
    if (step === 'welcome') return 1
    if (step === 'staffid') return 2
    if (step === 'demographics') return 3
    if (step === 'section') return 3 + (['A', 'B', 'C', 'D', 'E', 'F'].indexOf(currentSection) + 1)
    if (step === 'comments') return 10
    return 0
  }, [step, currentSection])

  /* ---- Step transitions ---- */
  const goWelcomeNext = () => setStep('staffid')
  const goStaffIdNext = () => {
    if (!state.staffId.trim()) {
      setError(t('errStaffIdRequired', lang))
      return
    }
    setError(null)
    setStep('demographics')
  }
  const goDemographicsNext = () => {
    if (!state.positionGroup) { setError(t('errSelectPositionGroup', lang)); return }
    if (!state.positionId) { setError(t('errSelectPosition', lang)); return }
    if (state.positionId && positions.find((p) => p.id === state.positionId)?.name_en === 'Other (please specify)' && !state.positionOther.trim()) {
      setError(t('errOtherRequired', lang)); return
    }
    if (!state.directorateCode) { setError(t('errSelectDirectorate', lang)); return }
    if (!state.departmentCode) { setError(t('errSelectDept', lang)); return }
    // For departments that DON'T allow the "across whole department" option, a sub-unit must be picked
    {
      const dep = departments.find((d) => d.code === state.departmentCode)
      const subs = departments.filter((d) => d.kind === 'subunit' && d.parent_code === state.departmentCode)
      if (dep && !dep.allow_across && subs.length > 0 && !state.subDepartmentCode) {
        setError(t('errSelectDept', lang))
        return
      }
    }
    if (!state.tenureHospital || !state.tenureUnit || !state.hoursPerWeek || state.directPatientContact === null) {
      setError(t('errFillAll', lang)); return
    }
    setError(null)
    setCurrentSection('A')
    setStep('section')
  }
  const goSectionNext = () => {
    const unanswered = sectionQuestions.filter((q) => state.answers[q.id] === undefined)
    if (unanswered.length > 0) {
      setError(t('errFillAll', lang))
      return
    }
    setError(null)
    const order: Section[] = ['A', 'B', 'C', 'D', 'E', 'F']
    const idx = order.indexOf(currentSection)
    if (idx < order.length - 1) {
      setCurrentSection(order[idx + 1])
    } else {
      setStep('comments')
    }
  }
  const goSectionBack = () => {
    const order: Section[] = ['A', 'B', 'C', 'D', 'E', 'F']
    const idx = order.indexOf(currentSection)
    if (idx > 0) {
      setCurrentSection(order[idx - 1])
    } else {
      setStep('demographics')
    }
  }
  const goCommentsBack = () => {
    setCurrentSection('F')
    setStep('section')
  }

  /* ---- Submit ---- */
  const handleSubmit = async () => {
    if (!campaign) return
    setStep('submitting')
    setError(null)
    try {
      const responseHash = await hashStaffId(state.staffId, campaign.salt)
      const selectedPos = positions.find((p) => p.id === state.positionId)
      const isOther = selectedPos?.name_en === 'Other (please specify)'

      // Generate the response id on the client. This avoids needing a SELECT policy on
      // pscs_responses for the anon role (RETURNING would otherwise require it under RLS).
      const responseId = (typeof crypto !== 'undefined' && (crypto as { randomUUID?: () => string }).randomUUID)
        ? (crypto as { randomUUID: () => string }).randomUUID()
        : 'r' + Math.random().toString(36).slice(2) + Date.now().toString(36)

      const respInsert = await supabase
        .from('pscs_responses')
        .insert({
          id: responseId,
          campaign_id: campaign.id,
          position_id: state.positionId,
          position_other: isOther ? state.positionOther.trim() : null,
          department_code: state.departmentCode,
          sub_department_code: state.subDepartmentCode,
          tenure_hospital: state.tenureHospital,
          tenure_unit: state.tenureUnit,
          hours_per_week: state.hoursPerWeek,
          direct_patient_contact: state.directPatientContact,
          comment: state.comment.trim() || null,
          response_hash: responseHash,
          language: state.language,
        })

      if (respInsert.error) {
        // duplicate?
        if ((respInsert.error.code === '23505') || respInsert.error.message?.toLowerCase().includes('duplicate')) {
          setStep('duplicate')
          return
        }
        throw respInsert.error
      }
      const answerRows = Object.entries(state.answers).map(([qid, v]) => ({
        response_id: responseId,
        question_id: qid,
        value: v,
      }))
      if (answerRows.length > 0) {
        const ansInsert = await supabase.from('pscs_answers').insert(answerRows)
        if (ansInsert.error) throw ansInsert.error
      }

      // Clear draft
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY(campaignCode))
      setStep('done')
    } catch (e) {
      console.error('PSCS submit error:', e)
      const msg = e instanceof Error ? e.message : (typeof e === 'object' && e ? JSON.stringify(e) : String(e))
      setError(`${t('errSubmit', lang)} — ${msg}`)
      setStep('comments')
    }
  }

  /* ======================== RENDER ======================== */

  if (step === 'loading') {
    return <Centered><p style={{ color: '#6B7280' }}>{t('loading', lang)}</p></Centered>
  }

  if (step === 'closed') {
    return (
      <Centered>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: '#16202E', fontSize: 22, marginBottom: 12 }}>{t('closedTitle', lang)}</h1>
          <p style={{ color: '#4B5563' }}>
            {campaign
              ? t('closedBody', lang).replace('{open}', campaign.open_date).replace('{close}', campaign.close_date)
              : t('closedBody', lang).replace('{open}', '—').replace('{close}', '—')}
          </p>
        </div>
      </Centered>
    )
  }

  if (step === 'done') {
    return (
      <Centered>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>✓</div>
          <h1 style={{ color: '#16A34A', fontSize: 26, marginBottom: 12 }}>{t('doneTitle', lang)}</h1>
          <p style={{ color: '#4B5563', lineHeight: 1.6 }}>{t('doneBody', lang)}</p>
        </div>
      </Centered>
    )
  }

  if (step === 'duplicate') {
    return (
      <Centered>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ color: '#16202E', fontSize: 22, marginBottom: 12 }}>{t('duplicateTitle', lang)}</h1>
          <p style={{ color: '#4B5563' }}>{t('duplicateBody', lang)}</p>
        </div>
      </Centered>
    )
  }

  return (
    <div className="srv-root">
      {/* Top bar */}
      <div className="srv-top">
        <div className="srv-top-inner">
          <div className="srv-brand-block">
            <img
              src="/hospital-logo.png"
              alt="Hospital Al-Sultan Abdullah UiTM"
              className="srv-logo"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
            <div className="srv-brand-tagline">
              {lang === 'en' ? 'Patient Safety Culture Survey' : 'Kajian Budaya Keselamatan Pesakit'} · {campaign?.code}
            </div>
          </div>
          <div className="srv-lang">
            <button
              className={`srv-lang-pill ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setState({ ...state, language: 'en' })}
              type="button">EN</button>
            <button
              className={`srv-lang-pill ${lang === 'ms' ? 'active' : ''}`}
              onClick={() => setState({ ...state, language: 'ms' })}
              type="button">BM</button>
          </div>
        </div>
        <div className="srv-progress">
          <div className="srv-progress-fill" style={{ width: `${(currentProgress / totalSteps) * 100}%` }} />
        </div>
      </div>

      {/* Body */}
      <main className="srv-main">
        {step === 'welcome' && (
          <Card>
            <div className="srv-hero">
              <div className="srv-hero-emoji">🩺</div>
              <h1 className="srv-h1">{t('welcomeTitle', lang)}</h1>
              <p className="srv-hero-sub">{lang === 'en' ? 'Your voice matters' : 'Suara anda penting'}</p>
            </div>
            <p className="srv-p">{t('welcomeIntro', lang)}</p>
            <div className="srv-callout">
              <strong>{lang === 'en' ? 'Response scale' : 'Skala maklum balas'}:</strong>
              <div className="srv-scale-grid">
                {(TXT.agreementLabels as readonly { v: number; en: string; ms: string }[]).map((l) => (
                  <div key={l.v} className="srv-scale-item">
                    <div className="srv-scale-num">{l.v}</div>
                    <div className="srv-scale-lab">{lang === 'en' ? l.en : l.ms}</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="srv-note">{t('scaleNote', lang)}</p>
          </Card>
        )}

        {step === 'staffid' && (
          <Card>
            <h2 className="srv-h2">{t('staffIdTitle', lang)}</h2>
            <p className="srv-p">{t('staffIdPrompt', lang)}</p>
            <input
              type="text"
              className="srv-input"
              autoFocus
              value={state.staffId}
              onChange={(e) => setState({ ...state, staffId: e.target.value })}
              placeholder={t('staffIdPlaceholder', lang)}
              aria-label={t('staffIdTitle', lang)}
            />
          </Card>
        )}

        {step === 'demographics' && (
          <Card>
            <h2 className="srv-h2">{t('demogTitle', lang)}</h2>

            {/* Position Group */}
            <div className="srv-field">
              <label className="srv-label">{t('positionGroupLabel', lang)}</label>
              <select
                className="srv-select"
                value={state.positionGroup ?? ''}
                onChange={(e) => setState({ ...state, positionGroup: e.target.value || null, positionId: null, positionOther: '' })}>
                <option value="">—</option>
                {positionGroups.map((g) => (
                  <option key={g.group_en} value={g.group_en}>
                    {lang === 'en' ? g.group_en : g.group_ms}
                  </option>
                ))}
              </select>
            </div>

            {/* Position (depends on selected group) */}
            {state.positionGroup && (
              <div className="srv-field">
                <label className="srv-label">{t('positionLabel', lang)}</label>
                <select
                  className="srv-select"
                  value={state.positionId ?? ''}
                  onChange={(e) => setState({ ...state, positionId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {positionsOfGroup.map((p) => (
                    <option key={p.id} value={p.id}>
                      {lang === 'en' ? p.name_en : p.name_ms}
                    </option>
                  ))}
                </select>
                {state.positionId && positions.find((p) => p.id === state.positionId)?.name_en === 'Other (please specify)' && (
                  <input
                    type="text"
                    className="srv-input"
                    style={{ marginTop: 8 }}
                    value={state.positionOther}
                    onChange={(e) => setState({ ...state, positionOther: e.target.value })}
                    placeholder={t('positionOtherLabel', lang)}
                  />
                )}
              </div>
            )}

            {/* Directorate */}
            <div className="srv-field">
              <label className="srv-label">{t('directorateLabel', lang)}</label>
              <select
                className="srv-select"
                value={state.directorateCode ?? ''}
                onChange={(e) => setState({ ...state, directorateCode: e.target.value || null, departmentCode: null, subDepartmentCode: null })}>
                <option value="">—</option>
                {directorates.map((d) => (
                  <option key={d.code} value={d.code}>
                    {lang === 'en' ? d.name_en : d.name_ms}
                  </option>
                ))}
              </select>
            </div>

            {/* Department (depends on selected directorate) */}
            {state.directorateCode && (
              <div className="srv-field">
                <label className="srv-label">{t('deptLabel', lang)}</label>
                <select
                  className="srv-select"
                  value={state.departmentCode ?? ''}
                  onChange={(e) => setState({ ...state, departmentCode: e.target.value || null, subDepartmentCode: null })}>
                  <option value="">—</option>
                  {departmentsOfDirectorate.map((d) => (
                    <option key={d.code} value={d.code}>
                      {lang === 'en' ? d.name_en : d.name_ms}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Sub-unit, only if applicable. Show "I work across..." option ONLY for depts flagged allow_across */}
            {subUnitsOfSelected.length > 0 && (() => {
              const selectedDept = departments.find((d) => d.code === state.departmentCode)
              const showAcross = selectedDept?.allow_across === true
              return (
                <div className="srv-field">
                  <label className="srv-label">{t('subDeptLabel', lang)}</label>
                  <div className="srv-radio-group">
                    {showAcross && (
                      <label className="srv-radio">
                        <input
                          type="radio"
                          name="subdept"
                          checked={state.subDepartmentCode === null}
                          onChange={() => setState({ ...state, subDepartmentCode: null })}
                        />
                        <span>{t('subDeptNone', lang)}</span>
                      </label>
                    )}
                    {subUnitsOfSelected.map((su) => (
                      <label key={su.code} className="srv-radio">
                        <input
                          type="radio"
                          name="subdept"
                          checked={state.subDepartmentCode === su.code}
                          onChange={() => setState({ ...state, subDepartmentCode: su.code })}
                        />
                        <span>{lang === 'en' ? su.name_en : su.name_ms}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Tenure in hospital */}
            <div className="srv-field">
              <label className="srv-label">{t('tenureHospitalQ', lang)}</label>
              <div className="srv-pill-row">
                {TXT.tenureOpts.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`srv-pill ${state.tenureHospital === o.v ? 'active' : ''}`}
                    onClick={() => setState({ ...state, tenureHospital: o.v })}>
                    {lang === 'en' ? o.en : o.ms}
                  </button>
                ))}
              </div>
            </div>

            {/* Tenure in unit */}
            <div className="srv-field">
              <label className="srv-label">{t('tenureUnitQ', lang)}</label>
              <div className="srv-pill-row">
                {TXT.tenureOpts.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`srv-pill ${state.tenureUnit === o.v ? 'active' : ''}`}
                    onClick={() => setState({ ...state, tenureUnit: o.v })}>
                    {lang === 'en' ? o.en : o.ms}
                  </button>
                ))}
              </div>
            </div>

            {/* Hours per week */}
            <div className="srv-field">
              <label className="srv-label">{t('hoursQ', lang)}</label>
              <div className="srv-pill-row">
                {TXT.hoursOpts.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    className={`srv-pill ${state.hoursPerWeek === o.v ? 'active' : ''}`}
                    onClick={() => setState({ ...state, hoursPerWeek: o.v })}>
                    {lang === 'en' ? o.en : o.ms}
                  </button>
                ))}
              </div>
            </div>

            {/* Patient contact */}
            <div className="srv-field">
              <label className="srv-label">{t('contactQ', lang)}</label>
              <div className="srv-pill-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <button
                  type="button"
                  className={`srv-pill ${state.directPatientContact === true ? 'active' : ''}`}
                  onClick={() => setState({ ...state, directPatientContact: true })}>
                  {t('contactYes', lang)}
                </button>
                <button
                  type="button"
                  className={`srv-pill ${state.directPatientContact === false ? 'active' : ''}`}
                  onClick={() => setState({ ...state, directPatientContact: false })}>
                  {t('contactNo', lang)}
                </button>
              </div>
            </div>
          </Card>
        )}

        {step === 'section' && (
          <Card>
            <h2 className="srv-h2">{TXT.sectionTitles[currentSection][lang]}</h2>
            <p className="srv-p">{TXT.sectionPrompts[currentSection][lang]}</p>
            {sectionQuestions.map((q) => (
              <QuestionItem
                key={q.id}
                question={q}
                lang={lang}
                value={state.answers[q.id]}
                onChange={(v) => setState({ ...state, answers: { ...state.answers, [q.id]: v } })}
              />
            ))}
          </Card>
        )}

        {step === 'comments' && (
          <Card>
            <h2 className="srv-h2">{t('commentsTitle', lang)}</h2>
            <p className="srv-p">{t('commentsPrompt', lang)}</p>
            <textarea
              className="srv-textarea"
              rows={6}
              value={state.comment}
              onChange={(e) => setState({ ...state, comment: e.target.value })}
              placeholder={t('commentsPlaceholder', lang)}
            />
          </Card>
        )}

        {step === 'submitting' && (
          <Card>
            <p style={{ color: '#6B7280', textAlign: 'center' }}>
              {lang === 'en' ? 'Submitting…' : 'Menghantar…'}
            </p>
          </Card>
        )}

        {error && (
          <div className="srv-error">{error}</div>
        )}
      </main>

      {/* Bottom nav */}
      <nav className="srv-nav">
        {step === 'welcome' && (
          <>
            <span />
            <button className="srv-btn primary" onClick={goWelcomeNext} type="button">{t('beginButton', lang)}</button>
          </>
        )}
        {step === 'staffid' && (
          <>
            <button className="srv-btn ghost" onClick={() => setStep('welcome')} type="button">{t('backButton', lang)}</button>
            <button className="srv-btn primary" onClick={goStaffIdNext} type="button">{t('nextButton', lang)}</button>
          </>
        )}
        {step === 'demographics' && (
          <>
            <button className="srv-btn ghost" onClick={() => setStep('staffid')} type="button">{t('backButton', lang)}</button>
            <button className="srv-btn primary" onClick={goDemographicsNext} type="button">{t('nextButton', lang)}</button>
          </>
        )}
        {step === 'section' && (
          <>
            <button className="srv-btn ghost" onClick={goSectionBack} type="button">{t('backButton', lang)}</button>
            <button className="srv-btn primary" onClick={goSectionNext} type="button">{t('nextButton', lang)}</button>
          </>
        )}
        {step === 'comments' && (
          <>
            <button className="srv-btn ghost" onClick={goCommentsBack} type="button">{t('backButton', lang)}</button>
            <button className="srv-btn primary" onClick={handleSubmit} type="button">{t('submitButton', lang)}</button>
          </>
        )}
      </nav>
    </div>
  )
}

/* ======================== SUB-COMPONENTS ======================== */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="srv-card">{children}</div>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F9FAFB', padding: 16 }}>
      {children}
    </div>
  )
}

function QuestionItem({
  question,
  lang,
  value,
  onChange,
}: {
  question: Question
  lang: Lang
  value: number | undefined
  onChange: (v: number) => void
}) {
  const labels =
    question.scale_type === 'Agreement' ? TXT.agreementLabels :
    question.scale_type === 'Frequency' ? TXT.frequencyLabels :
    question.scale_type === 'EventCount' ? TXT.eventCountLabels :
    TXT.ratingLabels

  return (
    <div className="srv-q">
      <div className="srv-q-num">{question.id}</div>
      <div className="srv-q-text">{lang === 'en' ? question.text_en : question.text_ms}</div>
      <div className="srv-likert">
        {labels.map((l) => (
          <button
            key={l.v}
            type="button"
            className={`srv-likert-btn ${value === l.v ? 'active' : ''}`}
            onClick={() => onChange(l.v)}
            aria-label={lang === 'en' ? l.en : l.ms}>
            <div className="srv-likert-num">{l.v}</div>
            <div className="srv-likert-lab">{lang === 'en' ? l.en : l.ms}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
