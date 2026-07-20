/* HASA's Vision, Mission, Objectives and Core Values.
 *
 * Shown to respondents between Q1 and Q2 of the survey — exactly where the
 * Tally forms embedded the VMO poster image. Respondents need to have read it
 * before they can meaningfully answer Q2 ("I am aware of and understand HASA's
 * VMO") and Q4 ("the VMO needs updating"), so it is rendered as real bilingual
 * text rather than an image: it stays readable on a phone, is searchable, and
 * works for screen readers.
 *
 * English wording supplied by RMCQ (Quality Manual 1.1–1.2). Malay wording
 * transcribed from the VMO poster embedded in the seven Tally questionnaires. */

export interface VmoStatementBlock {
  heading: { ms: string; en: string }
  visionLabel: { ms: string; en: string }
  vision: { ms: string; en: string }
  missionLabel: { ms: string; en: string }
  mission: { ms: string; en: string }
  objectivesLabel: { ms: string; en: string }
  objectives: { ms: string; en: string }[]
  valuesLabel: { ms: string; en: string }
  values: { name_ms: string; name_en: string; desc_ms: string; desc_en: string }[]
}

export const HASA_VMO: VmoStatementBlock = {
  heading: {
    ms: 'Visi, Misi, Objektif & Nilai Teras HASA',
    en: "HASA's Vision, Mission, Objectives & Core Values",
  },
  visionLabel: { ms: 'Visi', en: 'Vision' },
  vision: {
    ms: 'Menjadi sebuah pusat penjagaan kesihatan akademik terkemuka dunia.',
    en: 'To be a globally renowned academic healthcare centre.',
  },
  missionLabel: { ms: 'Misi', en: 'Mission' },
  mission: {
    ms: 'Mempertingkatkan kemanusiaan melalui pembangunan profesional, penyelidikan berkesan dan penyampaian penjagaan kesihatan terkini.',
    en: 'Enhancing humanities through professional development, impactful research and state of the art healthcare delivery.',
  },
  objectivesLabel: { ms: 'Objektif', en: 'Objectives' },
  objectives: [
    {
      ms: 'Menjadi pusat penjagaan kesihatan akademik yang terulung.',
      en: 'To be a premier academic healthcare centre.',
    },
    {
      ms: 'Memupuk penjagaan kesihatan ehsan yang berkualiti.',
      en: 'To nurture quality compassionate healthcare.',
    },
    {
      ms: 'Menjuarai penyelidikan terkehadapan.',
      en: 'To champion cutting edge avant-garde research.',
    },
    {
      ms: 'Menginovasikan sistem kewangan kesihatan yang efektif dan mampan.',
      en: 'To innovate effective sustainable healthcare finance.',
    },
  ],
  valuesLabel: { ms: 'Nilai Teras', en: 'Core Values' },
  values: [
    {
      name_ms: 'Kecemerlangan', name_en: 'Excellence',
      desc_ms: 'Mengamalkan kualiti piawai dalaman yang standard bagi memenuhi keperluan dan jangkaan pemegang taruh.',
      desc_en: "Practicing internal quality standards to fulfil the stakeholder's requirements and expectations.",
    },
    {
      name_ms: 'Sinergi', name_en: 'Synergy',
      desc_ms: 'Bekerjasama rapat untuk memaksimumkan produktiviti yang memberi manfaat kepada industri dan masyarakat.',
      desc_en: 'Collaborating seamlessly to maximise productivity that benefits industry and society.',
    },
    {
      name_ms: 'Integriti', name_en: 'Integrity',
      desc_ms: 'Memupuk nilai kejujuran, hormat dan ketelusan untuk mencapai standard profesionalisme yang tinggi.',
      desc_en: 'Embracing honesty, respect and transparency to achieve the highest ethical standard professionalism.',
    },
  ],
}
