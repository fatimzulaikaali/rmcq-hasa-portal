'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  VMO_ANCHORS, hashIdentifier,
  type VmoGroup, type VmoQuestion, type VmoGroupQuestion,
  type VmoDemographic, type VmoOption, type VmoLang,
} from '@/lib/vmo/types'
import { HASA_VMO } from '@/lib/vmo/statement'

/* Public, anonymous VMO survey — Hala Tuju Strategik HASA.
 *
 * Lives OUTSIDE the (dashboard) route group so it needs no login. Respondents
 * pick their group, enter the last 6 digits of their NRIC/passport (hashed
 * client-side, never stored raw), answer 12 questions and optionally leave a
 * comment. Submission goes through the vmo_submit RPC so the response and its
 * answers are written atomically. */

type Step = 'loading' | 'pick' | 'id' | 'demo' | 'questions' | 'comments' | 'done' | 'duplicate' | 'error'

const T = {
  ms: {
    title: 'Borang Soal Selidik Hala Tuju Strategik HASA',
    other: 'HASA Strategic Direction Questionnaire',
    hosp: 'Hospital Al-Sultan Abdullah UiTM',
    intro: 'Arahan: Sila tandakan atau isi maklumat yang berkaitan. Maklumat yang diberikan akan dikumpulkan secara agregat dan tidak akan digunakan untuk mengenal pasti mana-mana individu.',
    pick: 'Sila pilih kumpulan anda',
    pickSub: 'Pilih kumpulan yang paling menggambarkan anda. Setiap kumpulan mempunyai set soalan tersendiri.',
    idL: '6 Digit Terakhir Nombor Kad Pengenalan atau Pasport',
    idH: 'Maklumat ini dikumpul semata-mata untuk tujuan pengesahan data bagi mengelakkan kemasukan berulang dan akan dirahsiakan sepenuhnya.',
    verify: 'Pengesahan', secA: 'Maklumat Responden', secB: 'Soalan Utama', sugg: 'Cadangan',
    eyeV: 'Pengesahan', eyeA: 'Bahagian A', eyeB: 'Bahagian B', eyeC: 'Akhir sekali',
    openQ: 'Adakah terdapat sebarang isu atau cadangan khusus yang ingin anda bawa ke perhatian pengurusan tertinggi? (Sila nyatakan secara ringkas).',
    optional: 'Pilihan — tidak wajib diisi',
    back: 'Kembali', next: 'Seterusnya', submit: 'Hantar', sending: 'Menghantar…',
    errId: 'Sila masukkan 6 digit terakhir.',
    errA: 'Sila lengkapkan semua ruangan bertanda *.',
    errB: 'Sila jawab semua soalan.',
    errNet: 'Maaf, penghantaran gagal. Sila cuba lagi.',
    poster: 'Visi · Misi · Objektif · Nilai Teras HASA',
    doneT: 'Terima kasih!',
    doneS: 'Maklum balas anda telah direkodkan. Pandangan anda amat kami hargai.',
    dupT: 'Anda telah menjawab',
    dupS: 'Rekod menunjukkan maklum balas untuk kumpulan ini telah pun dihantar. Setiap orang hanya boleh menjawab sekali bagi setiap kumpulan.',
    sel: '— Sila pilih —', step: (n: number) => `Langkah ${n} daripada 4`, stepPick: 'Pilih kumpulan',
    loading: 'Memuatkan…', closed: 'Borang tidak tersedia buat masa ini.',
  },
  en: {
    title: 'HASA Strategic Direction Questionnaire',
    other: 'Borang Soal Selidik Hala Tuju Strategik HASA',
    hosp: 'Hospital Al-Sultan Abdullah UiTM',
    intro: 'Instruction: Please tick or fill in the relevant information. The information provided will be aggregated and will not be used to identify any individual.',
    pick: 'Please select your group',
    pickSub: 'Choose the group that best describes you. Each group has its own set of questions.',
    idL: 'Last 6 Digits of NRIC or Passport Number',
    idH: 'This information is collected solely for data verification purposes to prevent duplicate entries and will be kept strictly confidential.',
    verify: 'Verification', secA: 'Respondent Information', secB: 'Main Questions', sugg: 'Suggestions',
    eyeV: 'Verification', eyeA: 'Section A', eyeB: 'Section B', eyeC: 'Finally',
    openQ: 'Are there any specific issues or suggestions you would like to bring to the attention of top management? (Please be brief).',
    optional: 'Optional',
    back: 'Back', next: 'Next', submit: 'Submit', sending: 'Submitting…',
    errId: 'Please enter the last 6 digits.',
    errA: 'Please complete all fields marked *.',
    errB: 'Please answer every question.',
    errNet: 'Sorry, submission failed. Please try again.',
    poster: 'HASA Vision · Mission · Objectives · Core Values',
    doneT: 'Thank you!',
    doneS: 'Your response has been recorded. We appreciate your feedback.',
    dupT: 'You have already responded',
    dupS: 'Our records show a response for this group has already been submitted. Each person may answer once per group.',
    sel: '— Please select —', step: (n: number) => `Step ${n} of 4`, stepPick: 'Choose your group',
    loading: 'Loading…', closed: 'The form is not available at the moment.',
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
  const [group, setGroup] = useState<VmoGroup | null>(null)
  const [idDigits, setIdDigits] = useState('')
  const [demoVals, setDemoVals] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [freeText, setFreeText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const t = T[lang]

  useEffect(() => {
    void (async () => {
      try {
        const [g, q, m, d, o] = await Promise.all([
          supabase.from('vmo_groups').select('*').eq('active', true).order('sort_order'),
          supabase.from('vmo_questions').select('*'),
          supabase.from('vmo_group_questions').select('*').order('position'),
          supabase.from('vmo_demographics').select('*').order('position'),
          supabase.from('vmo_demographic_options').select('*').eq('active', true).order('sort_order'),
        ])
        if (g.error || q.error || m.error || d.error || o.error) { setStep('error'); return }
        const qmap: Record<string, VmoQuestion> = {}
        for (const row of (q.data ?? []) as VmoQuestion[]) qmap[row.code] = row
        setGroups((g.data ?? []) as VmoGroup[])
        setQuestions(qmap)
        setGq((m.data ?? []) as VmoGroupQuestion[])
        setDemos((d.data ?? []) as VmoDemographic[])
        setOptions((o.data ?? []) as VmoOption[])
        setStep('pick')
      } catch { setStep('error') }
    })()
  }, [supabase])

  /* .filter() does not narrow types on its own, so the predicate below is what
   * lets us treat `q` as definitely present downstream. */
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

  function choose(g: VmoGroup) {
    setGroup(g); setIdDigits(''); setDemoVals({}); setAnswers({}); setFreeText('')
    setErr(''); setStep('id'); window.scrollTo({ top: 0 })
  }
  function goto(s: Step) { setErr(''); setStep(s); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  function nextFromId() {
    if (!/^\d{6}$/.test(idDigits.trim())) { setErr(t.errId); return }
    goto('demo')
  }
  function nextFromDemo() {
    for (const d of myDemos) if (d.required && !demoVals[d.field_code]) { setErr(t.errA); return }
    goto('questions')
  }
  function nextFromQuestions() {
    for (const x of myQs) if (!answers[x.question_code]) { setErr(t.errB); return }
    goto('comments')
  }

  async function submit() {
    if (!group || busy) return
    setBusy(true); setErr('')
    try {
      const hash = await hashIdentifier(idDigits, group.salt)
      const { data, error } = await supabase.rpc('vmo_submit', {
        p_group: group.code,
        p_hash: hash,
        p_demo: demoVals,
        p_free: freeText,
        p_lang: lang,
        p_answers: answers,
      })
      if (error) { setErr(t.errNet); setBusy(false); return }
      if (data === 'duplicate') { setStep('duplicate'); window.scrollTo({ top: 0 }); setBusy(false); return }
      if (data !== 'ok') { setErr(t.errNet); setBusy(false); return }
      setStep('done'); window.scrollTo({ top: 0 })
    } catch { setErr(t.errNet) }
    setBusy(false)
  }

  const accent = group?.accent ?? '#2563EB'
  const pct = step === 'pick' ? 0 : step === 'id' ? 20 : step === 'demo' ? 42
    : step === 'questions' ? 80 : step === 'comments' ? 96 : 100
  const stepNo = step === 'id' ? 1 : step === 'demo' ? 2 : step === 'questions' ? 3 : 4

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
                    : g.kind === 'student' ? (lang === 'ms' ? 'Pelajar' : 'Student')
                      : (lang === 'ms' ? 'Pesakit' : 'Patient')
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

          {step === 'id' && (
            <>
              <div className="vmo-eyebrow">{t.eyeV}</div>
              <h2>{t.verify}</h2>
              <div className="vmo-field" style={{ marginTop: 20 }}>
                <label className="vmo-lbl" htmlFor="vmoid">{t.idL}<span className="req">*</span></label>
                <input id="vmoid" className="vmo-digits" type="text" inputMode="numeric" maxLength={6}
                  autoComplete="off" value={idDigits} placeholder="••••••"
                  onChange={(e) => setIdDigits(e.target.value.replace(/\D/g, ''))} />
                <div className="vmo-hint">🔒 {t.idH}</div>
              </div>
              <div className="vmo-nav">
                <button type="button" className="vmo-btn" onClick={() => { setGroup(null); goto('pick') }}>{t.back}</button>
                <button type="button" className="vmo-btn primary" onClick={nextFromId}>{t.next}</button>
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
                <button type="button" className="vmo-btn" onClick={() => goto('id')}>{t.back}</button>
                <button type="button" className="vmo-btn primary" onClick={nextFromDemo}>{t.next}</button>
              </div>
            </>
          )}

          {step === 'questions' && (
            <>
              <div className="vmo-eyebrow">{t.eyeB}</div>
              <h2>{t.secB}</h2>
              <div style={{ marginTop: 4 }}>
                {myQs.map((x, i) => {
                  const anchors = VMO_ANCHORS[x.q.scale_type][lang]
                  return (
                    <div key={x.question_code}>
                      <div className="vmo-q">
                        <div className="vmo-qt"><i className="vmo-qnum">{x.position}</i>{lang === 'ms' ? x.q.text_ms : x.q.text_en}</div>
                        <div className="vmo-qe">{lang === 'ms' ? x.q.text_en : x.q.text_ms}</div>
                        <div className="vmo-scale">
                          {[1, 2, 3, 4, 5].map((v) => (
                            <button key={v} type="button" aria-label={String(v)}
                              className={answers[x.question_code] === v ? 'on' : ''}
                              onClick={() => setAnswers({ ...answers, [x.question_code]: v })}>{v}</button>
                          ))}
                        </div>
                        <div className="vmo-anchors">
                          <span>{anchors[0]}</span><span>{anchors[1]}</span><span>{anchors[2]}</span>
                        </div>
                      </div>
                      {i === 0 && (
                        /* The VMO itself, shown right after Q1 — respondents must be able
                         * to read it before Q2 asks whether they understand it. */
                        <section className="vmo-statement" aria-label={HASA_VMO.heading[lang]}>
                          <div className="vs-head">{HASA_VMO.heading[lang]}</div>

                          <div className="vs-block">
                            <div className="vs-lbl">{HASA_VMO.visionLabel[lang]}</div>
                            <p className="vs-lead">{HASA_VMO.vision[lang]}</p>
                          </div>

                          <div className="vs-block">
                            <div className="vs-lbl">{HASA_VMO.missionLabel[lang]}</div>
                            <p className="vs-lead">{HASA_VMO.mission[lang]}</p>
                          </div>

                          <div className="vs-block">
                            <div className="vs-lbl">{HASA_VMO.objectivesLabel[lang]}</div>
                            <ul className="vs-list">
                              {HASA_VMO.objectives.map((o) => <li key={o.en}>{o[lang]}</li>)}
                            </ul>
                          </div>

                          <div className="vs-block">
                            <div className="vs-lbl">{HASA_VMO.valuesLabel[lang]}</div>
                            <div className="vs-values">
                              {HASA_VMO.values.map((v) => (
                                <div className="vs-val" key={v.name_en}>
                                  <b>{lang === 'ms' ? v.name_ms : v.name_en}</b>
                                  <span>{lang === 'ms' ? v.desc_ms : v.desc_en}</span>
                                </div>
                              ))}
                            </div>
                          </div>
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

          {step === 'comments' && (
            <>
              <div className="vmo-eyebrow">{t.eyeC}</div>
              <h2>{t.sugg}</h2>
              <div className="vmo-field" style={{ marginTop: 18 }}>
                <label className="vmo-lbl">{t.openQ}</label>
                <textarea value={freeText} placeholder={t.optional} onChange={(e) => setFreeText(e.target.value)} />
                <div className="vmo-hint">{t.optional}</div>
              </div>
              <div className="vmo-nav">
                <button type="button" className="vmo-btn" onClick={() => goto('questions')}>{t.back}</button>
                <button type="button" className="vmo-btn primary" disabled={busy} onClick={submit}>
                  {busy ? t.sending : t.submit}
                </button>
              </div>
            </>
          )}

          {(step === 'done' || step === 'duplicate') && (
            <div className="vmo-done">
              <div className="vmo-tick" style={step === 'duplicate' ? { background: '#6B7280' } : undefined}>
                <svg viewBox="0 0 24 24">
                  {step === 'done'
                    ? <path d="M4 12.5l5.5 5.5L20 7" />
                    : <path d="M12 8v5m0 3.5v.01M12 3a9 9 0 100 18 9 9 0 000-18z" />}
                </svg>
              </div>
              <h2>{step === 'done' ? t.doneT : t.dupT}</h2>
              <div className="vmo-sub" style={{ marginTop: 6 }}>{step === 'done' ? t.doneS : t.dupS}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
