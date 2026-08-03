'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  VMO_ANCHORS, VMO_POINTS, VMO_DK_LABEL, VMO_SCALE_MAX,
  type VmoGroup, type VmoQuestion, type VmoGroupQuestion,
  type VmoDemographic, type VmoOption, type VmoQuestionOption, type VmoLang,
} from '@/lib/vmo/types'
import { HASA_VMO } from '@/lib/vmo/statement'

/* Public, anonymous VMO survey — Hala Tuju Strategik HASA (v2).
 * No identifier is collected; the form trusts one response per person. */

type Step = 'loading' | 'pick' | 'demo' | 'questions' | 'comments' | 'done' | 'error'

/* T2 open-text prompt is group-specific. */
const T2: Record<string, { ms: string; en: string }> = {
  pengurusan: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk mencapai VMO & hala tuju strategiknya.', en: 'One thing HASA should change or improve to achieve its VMO & strategic direction.' },
  klinikal: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk mencapai VMO & meningkatkan penjagaan klinikal.', en: 'One thing HASA should change or improve to achieve its VMO & improve clinical care.' },
  sokongan: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk membantu unit anda bekerja dengan lebih baik.', en: 'One thing HASA should change or improve to help your unit work better.' },
  konsesi: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk penyelarasan yang lebih baik antara konsesi & hospital.', en: 'One thing HASA should change or improve to coordinate better between concessionaire & hospital.' },
  fakulti: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk mengukuhkan sinergi HASA–fakulti & mencapai VMO.', en: 'One thing HASA should change or improve to strengthen HASA–faculty synergy & achieve its VMO.' },
  pelajar: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk memperbaiki pengalaman pembelajaran anda.', en: 'One thing HASA should change or improve to improve your learning experience.' },
  pesakit: { ms: 'Satu perkara yang HASA patut UBAH atau PERBAIKI untuk memperbaiki pengalaman rawatan anda.', en: 'One thing HASA should change or improve to improve your care experience.' },
}

const T = {
  ms: {
    title: 'Borang Soal Selidik Hala Tuju Strategik HASA', other: 'HASA Strategic Direction Questionnaire',
    hosp: 'Hospital Al-Sultan Abdullah UiTM',
    intro: 'Arahan: Sila pilih SATU kumpulan yang paling menggambarkan anda, kemudian jawab soalan untuk kumpulan tersebut. Borang ini tanpa nama dan tidak mengumpul sebarang pengenalan diri. Maklumat dikumpul secara agregat.',
    pick: 'Sila pilih kumpulan anda', pickSub: 'Pilih kumpulan yang paling menggambarkan anda. Setiap kumpulan mempunyai set soalan tersendiri.',
    secA: 'Maklumat Responden', secB: 'Soalan Utama', sugg: 'Soalan Terbuka',
    eyeA: 'Bahagian A', eyeB: 'Bahagian B', eyeC: 'Akhir sekali',
    optional: 'Pilihan — tidak wajib diisi', pickTwo: 'Pilih DUA', dk: VMO_DK_LABEL.ms,
    back: 'Kembali', next: 'Seterusnya', submit: 'Hantar', sending: 'Menghantar…',
    errA: 'Sila lengkapkan semua ruangan bertanda *.', errB: 'Sila jawab semua soalan.',
    errChoice: 'Sila pilih tepat DUA pilihan bagi soalan berkaitan.', errNet: 'Maaf, penghantaran gagal. Sila cuba lagi.',
    doneT: 'Terima kasih!', doneS: 'Maklum balas anda telah direkodkan. Pandangan anda amat kami hargai.',
    sel: '— Sila pilih —', step: (n: number) => `Langkah ${n} daripada 3`, stepPick: 'Pilih kumpulan',
    loading: 'Memuatkan…', closed: 'Borang tidak tersedia buat masa ini.', vmoRead: 'Sila baca VMO HASA sebelum meneruskan.',
  },
  en: {
    title: 'HASA Strategic Direction Questionnaire', other: 'Borang Soal Selidik Hala Tuju Strategik HASA',
    hosp: 'Hospital Al-Sultan Abdullah UiTM',
    intro: 'Instruction: Please choose ONE group that best describes you, then answer the questions for that group. This form is anonymous and collects no personal identifiers. Responses are aggregated.',
    pick: 'Please select your group', pickSub: 'Choose the group that best describes you. Each group has its own set of questions.',
    secA: 'Respondent Information', secB: 'Main Questions', sugg: 'Open Questions',
    eyeA: 'Section A', eyeB: 'Section B', eyeC: 'Finally',
    optional: 'Optional', pickTwo: 'Choose TWO', dk: VMO_DK_LABEL.en,
    back: 'Back', next: 'Next', submit: 'Submit', sending: 'Submitting…',
    errA: 'Please complete all fields marked *.', errB: 'Please answer every question.',
    errChoice: 'Please choose exactly TWO options for the relevant question.', errNet: 'Sorry, submission failed. Please try again.',
    doneT: 'Thank you!', doneS: 'Your response has been recorded. We appreciate your feedback.',
    sel: '— Please select —', step: (n: number) => `Step ${n} of 3`, stepPick: 'Choose your group',
    loading: 'Loading…', closed: 'The form is not available at the moment.', vmoRead: 'Please read HASA’s VMO before continuing.',
  },
}

export default function VmoSurveyPage() {
  const supabase = useMemo(() => createClient(), [])
  const [lang, setLang] = useState<VmoLang>('ms')
  const [step, setStep] = useState<Step>('loading')
  const [groups, setGroups] = useState<VmoGroup[]>([])
  const [questions, setQuestions] = useState<Record<string, VmoQuestion>>({})
  const [gq, setGq] = useState<VmoGroupQuestion[]>([])
  const [demos, setDemos] = useState<VmoDemographic[]>([])
  const [options, setOptions] = useState<VmoOption[]>([])
  const [qOptions, setQOptions] = useState<VmoQuestionOption[]>([])
  const [group, setGroup] = useState<VmoGroup | null>(null)
  const [demoVals, setDemoVals] = useState<Record<string, string>>({})
  const [scaleAns, setScaleAns] = useState<Record<string, number | null>>({})
  const [choiceAns, setChoiceAns] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState<Record<string, string>>({ t1: '', t2: '', t3: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const t = T[lang]

  useEffect(() => {
    void (async () => {
      try {
        const [g, q, m, d, o, qo] = await Promise.all([
          supabase.from('vmo_groups').select('*').eq('active', true).order('sort_order'),
          supabase.from('vmo_questions').select('*'),
          supabase.from('vmo_group_questions').select('*').order('position'),
          supabase.from('vmo_demographics').select('*').order('position'),
          supabase.from('vmo_demographic_options').select('*').order('sort_order'),
          supabase.from('vmo_question_options').select('*').order('sort_order'),
        ])
        if (g.error || q.error || m.error || d.error || o.error || qo.error) { setStep('error'); return }
        const qmap: Record<string, VmoQuestion> = {}
        for (const row of (q.data ?? []) as VmoQuestion[]) qmap[row.code] = row
        setGroups((g.data ?? []) as VmoGroup[]); setQuestions(qmap)
        setGq((m.data ?? []) as VmoGroupQuestion[]); setDemos((d.data ?? []) as VmoDemographic[])
        setOptions((o.data ?? []) as VmoOption[]); setQOptions((qo.data ?? []) as VmoQuestionOption[])
        setStep('pick')
      } catch { setStep('error') }
    })()
  }, [supabase])

  const myQs = useMemo(() => {
    if (!group) return []
    return gq.filter((x) => x.group_code === group.code)
      .sort((a, b) => a.position - b.position)
      .map((x) => ({ ...x, q: questions[x.question_code] as VmoQuestion | undefined }))
      .filter((x): x is VmoGroupQuestion & { q: VmoQuestion } => Boolean(x.q))
  }, [group, gq, questions])

  const myDemos = useMemo(
    () => (group ? demos.filter((d) => d.group_code === group.code).sort((a, b) => a.position - b.position) : []),
    [group, demos])

  const optsFor = (set: string) => options.filter((o) => o.option_set === set)
  const choiceOptsFor = (qcode: string) => qOptions.filter((o) => o.question_code === qcode)

  function choose(g: VmoGroup) {
    setGroup(g); setDemoVals({}); setScaleAns({}); setChoiceAns({}); setOpen({ t1: '', t2: '', t3: '' })
    setErr(''); setStep('demo'); window.scrollTo({ top: 0 })
  }
  function goto(s: Step) { setErr(''); setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  function nextFromDemo() {
    for (const d of myDemos) if (d.required && !demoVals[d.field_code]) { setErr(t.errA); return }
    goto('questions')
  }
  function nextFromQuestions() {
    for (const x of myQs) {
      if (x.q.scale_type === 'choice') {
        if ((choiceAns[x.question_code]?.length ?? 0) !== x.q.pick_count) { setErr(t.errChoice); return }
      } else if (!Object.prototype.hasOwnProperty.call(scaleAns, x.question_code)) {
        setErr(t.errB); return
      }
    }
    goto('comments')
  }

  function toggleChoice(qcode: string, val: string, pick: number) {
    setChoiceAns((prev) => {
      const cur = prev[qcode] ?? []
      if (cur.includes(val)) return { ...prev, [qcode]: cur.filter((v) => v !== val) }
      if (cur.length >= pick) return prev            // at cap — ignore extra picks
      return { ...prev, [qcode]: [...cur, val] }
    })
  }

  async function submit() {
    if (!group || busy) return
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('vmo_submit', {
        p_group: group.code, p_lang: lang,
        p_demo: demoVals, p_scale: scaleAns, p_choices: choiceAns, p_open: open,
      })
      if (error || data !== 'ok') { setErr(t.errNet); setBusy(false); return }
      setStep('done'); window.scrollTo({ top: 0 })
    } catch { setErr(t.errNet) }
    setBusy(false)
  }

  const accent = group?.accent ?? '#2563EB'
  const pct = step === 'pick' ? 0 : step === 'demo' ? 30 : step === 'questions' ? 75 : step === 'comments' ? 96 : 100
  const stepNo = step === 'demo' ? 1 : step === 'questions' ? 2 : 3

  return (
    <div className="vmo-root" style={{ '--vac': accent } as React.CSSProperties}>
      <header className="vmo-hero">
        <div className="vmo-hero-in">
          <div className="vmo-crest"><span className="vmo-dot">H</span> {t.hosp}</div>
          <h1>{t.title}</h1>
          <div className="vmo-hero-sub">{t.other}</div>
          {group && <div className="vmo-gname">{lang === 'ms' ? group.name_ms : group.name_en}</div>}
        </div>
        <svg className="vmo-wave" viewBox="0 0 1440 26" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,26 L0,13 C240,26 480,0 720,7 C960,14 1200,26 1440,15 L1440,26 Z" fill="#F6F7FB" />
        </svg>
      </header>

      <div className="vmo-pwrap">
        <div className="vmo-pwrap-in">
          <div className="vmo-pmeta">
            <span className="vmo-pstep">{step === 'pick' ? t.stepPick : t.step(stepNo)}</span>
            <span className="vmo-lang">
              <button type="button" className={lang === 'ms' ? 'on' : ''} onClick={() => setLang('ms')}>BM</button>
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            </span>
          </div>
          <div className="vmo-prog"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="vmo-wrap">
        <div className="vmo-card">
          {err && <div className="vmo-err">{err}</div>}
          {step === 'loading' && <div className="vmo-mute">{t.loading}</div>}
          {step === 'error' && <div className="vmo-err">{t.closed}</div>}

          {step === 'pick' && (
            <>
              <div className="vmo-intro">{t.intro}</div>
              <h2>{t.pick}</h2>
              <div className="vmo-sub">{t.pickSub}</div>
              <div className="vmo-groups">
                {groups.map((g) => {
                  const note = lang === 'ms' ? g.note_ms : g.note_en
                  const tag = g.kind === 'staff' ? (lang === 'ms' ? 'Staf' : 'Staff')
                    : g.kind === 'student' ? (lang === 'ms' ? 'Pelajar' : 'Student') : (lang === 'ms' ? 'Pesakit' : 'Patient')
                  return (
                    <button key={g.code} type="button" className="vmo-gcard"
                      style={{ '--gc': g.accent } as React.CSSProperties} onClick={() => choose(g)}>
                      <span className="gt">{lang === 'ms' ? g.name_ms : g.name_en}</span>
                      <span className="ge">{lang === 'ms' ? g.name_en : g.name_ms}</span>
                      {note && <span className="gnote">{note}</span>}
                      <span className="gtag">{tag}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {step === 'demo' && (
            <>
              <div className="vmo-eyebrow">{t.eyeA}</div>
              <h2>{t.secA}</h2>
              <div style={{ marginTop: 20 }}>
                {myDemos.map((d) => (
                  <div className="vmo-field" key={d.field_code}>
                    <label className="vmo-lbl">{lang === 'ms' ? d.label_ms : d.label_en}{d.required && <span className="req">*</span>}</label>
                    <select value={demoVals[d.field_code] ?? ''}
                      onChange={(e) => setDemoVals({ ...demoVals, [d.field_code]: e.target.value })}>
                      <option value="">{t.sel}</option>
                      {optsFor(d.option_set).map((o) => (
                        <option key={o.value} value={o.value}>{lang === 'ms' ? o.label_ms : o.label_en}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="vmo-nav">
                <button type="button" className="vmo-btn" onClick={() => { setGroup(null); goto('pick') }}>{t.back}</button>
                <button type="button" className="vmo-btn primary" onClick={nextFromDemo}>{t.next}</button>
              </div>
            </>
          )}

          {step === 'questions' && (
            <>
              <div className="vmo-eyebrow">{t.eyeB}</div>
              <h2>{t.secB}</h2>
              <div style={{ marginTop: 4 }}>
                {myQs.map((x) => {
                  const isChoice = x.q.scale_type === 'choice'
                  const showVmoAfter = x.q.code === 'FAMILIAR_VMO'
                  return (
                    <div key={x.question_code}>
                      <div className="vmo-q">
                        <div className="vmo-qt"><i className="vmo-qnum">{x.position}</i>{lang === 'ms' ? x.q.text_ms : x.q.text_en}</div>
                        <div className="vmo-qe">{lang === 'ms' ? x.q.text_en : x.q.text_ms}</div>

                        {isChoice ? (
                          <>
                            <div className="vmo-picktwo">{t.pickTwo}</div>
                            <div className="vmo-choices">
                              {choiceOptsFor(x.question_code).map((o) => {
                                const sel = (choiceAns[x.question_code] ?? []).includes(o.value)
                                return (
                                  <button key={o.value} type="button" aria-pressed={sel}
                                    className={`vmo-choice ${sel ? 'on' : ''}`}
                                    onClick={() => toggleChoice(x.question_code, o.value, x.q.pick_count)}>
                                    <span className="box">{sel ? '✓' : ''}</span>
                                    <span>{lang === 'ms' ? o.label_ms : o.label_en}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="vmo-scale six">
                              {Array.from({ length: VMO_SCALE_MAX }, (_, k) => k + 1).map((v) => {
                                const pts = VMO_POINTS[x.q.scale_type][lang]
                                return (
                                  <button key={v} type="button" aria-label={`${v} — ${pts[v - 1]}`}
                                    className={`${scaleAns[x.question_code] === v ? 'on' : ''}${v === 4 ? ' gap' : ''}`}
                                    onClick={() => setScaleAns({ ...scaleAns, [x.question_code]: v })}>{v}</button>
                                )
                              })}
                            </div>
                            <div className="vmo-anchors two">
                              <span>{VMO_ANCHORS[x.q.scale_type][lang][0]}</span>
                              <span>{VMO_ANCHORS[x.q.scale_type][lang][1]}</span>
                            </div>
                            <button type="button"
                              className={`vmo-dk ${Object.prototype.hasOwnProperty.call(scaleAns, x.question_code) && scaleAns[x.question_code] === null ? 'on' : ''}`}
                              onClick={() => setScaleAns({ ...scaleAns, [x.question_code]: null })}>{t.dk}</button>
                          </>
                        )}
                      </div>

                      {showVmoAfter && (
                        <section className="vmo-statement" aria-label={HASA_VMO.heading[lang]}>
                          <div className="vs-head">{HASA_VMO.heading[lang]}</div>
                          <div className="vs-block"><div className="vs-lbl">{HASA_VMO.visionLabel[lang]}</div><p className="vs-lead">{HASA_VMO.vision[lang]}</p></div>
                          <div className="vs-block"><div className="vs-lbl">{HASA_VMO.missionLabel[lang]}</div><p className="vs-lead">{HASA_VMO.mission[lang]}</p></div>
                          <div className="vs-block"><div className="vs-lbl">{HASA_VMO.objectivesLabel[lang]}</div>
                            <ul className="vs-list">{HASA_VMO.objectives.map((o) => <li key={o.en}>{o[lang]}</li>)}</ul></div>
                          <div className="vs-block"><div className="vs-lbl">{HASA_VMO.valuesLabel[lang]}</div>
                            <div className="vs-values">{HASA_VMO.values.map((v) => (
                              <div className="vs-val" key={v.name_en}><b>{lang === 'ms' ? v.name_ms : v.name_en}</b><span>{lang === 'ms' ? v.desc_ms : v.desc_en}</span></div>
                            ))}</div></div>
                        </section>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="vmo-nav">
                <button type="button" className="vmo-btn" onClick={() => goto('demo')}>{t.back}</button>
                <button type="button" className="vmo-btn primary" onClick={nextFromQuestions}>{t.next}</button>
              </div>
            </>
          )}

          {step === 'comments' && group && (
            <>
              <div className="vmo-eyebrow">{t.eyeC}</div>
              <h2>{t.sugg}</h2>
              <div className="vmo-sub" style={{ marginBottom: 8 }}>{t.optional}</div>
              {[
                { key: 't1', label: lang === 'ms' ? 'Satu perkara yang HASA patut KEKALKAN.' : 'One thing HASA should keep doing.' },
                { key: 't2', label: (T2[group.code] ?? T2.pengurusan)[lang] },
                { key: 't3', label: lang === 'ms' ? 'Sebarang isu atau cadangan lain untuk pengurusan tertinggi (ringkas).' : 'Any other issue or suggestion for top management (brief).' },
              ].map((f) => (
                <div className="vmo-field" key={f.key}>
                  <label className="vmo-lbl">{f.label}</label>
                  <textarea value={open[f.key] ?? ''} onChange={(e) => setOpen({ ...open, [f.key]: e.target.value })} />
                </div>
              ))}
              <div className="vmo-nav">
                <button type="button" className="vmo-btn" onClick={() => goto('questions')}>{t.back}</button>
                <button type="button" className="vmo-btn primary" disabled={busy} onClick={submit}>{busy ? t.sending : t.submit}</button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div className="vmo-done">
              <div className="vmo-tick"><svg viewBox="0 0 24 24"><path d="M4 12.5l5.5 5.5L20 7" /></svg></div>
              <h2>{t.doneT}</h2>
              <div className="vmo-sub" style={{ marginTop: 6 }}>{t.doneS}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
