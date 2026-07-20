# Hala Tuju Strategik HASA — Survey Module Spec

**Status:** Draft for Fatim's sign-off. Nothing built yet, no DB changes applied.
**Source:** Seven Tally questionnaires (PDF scans).

**Verification:** all seven forms have been read page by page and the question
text below is transcribed from the scans, not inferred. Verified individually:
pengurusan, klinikal, sokongan, konsesi, fakulti, pelajar, pesakit.
The only content that could NOT be recovered from the scans is the Section A
dropdown option lists (collapsed selects) — those were supplied separately by
Fatim and are recorded in §4.

---

## 1. What this module is

A public, anonymous survey capturing staff, student and patient views on HASA's
Vision, Mission, Objectives (VMO) and strategic direction — plus a portal-side
dashboard for RMCQ to analyse the results.

**Decisions already made:**

| Decision | Choice |
|---|---|
| How respondents access it | Public anonymous link, no login |
| Routing | One link; first screen asks which group you belong to |
| Question storage | Shared question bank — identical questions stored once, reused across groups |
| Output | Both collection and dashboard/report card |
| Campaigns | No rounds for now (but every response is timestamped, so rounds can be added later without a migration) |
| Department breakdown | Not needed — evaluate generally, not per department |
| Portal visibility | Everyone with a portal account (no role gate) — same as Risk Register |
| Sidebar label | **VMO Survey** |
| Existing data | None. Survey not launched yet, so the portal starts fresh and wording issues are fixed rather than mirrored |
| Tally quirks | Fix all four (§8) so questions read correctly for each respondent group |

---

## 2. The seven respondent groups

| Code | Malay | English |
|---|---|---|
| `pengurusan` | Kumpulan Profesional & Pengurusan (Gred 9 dan ke atas) | Professional & Management Group (Grade 9 and above) |
| `klinikal` | Kumpulan Pegawai Perubatan & Pegawai Pergigian HASA (termasuk Pakar) | HASA Medical & Dental Officers (including Specialists) |
| `sokongan` | Kumpulan Sokongan / Kesihatan Bersekutu | Support / Allied Health Staff |
| `konsesi` | Kakitangan Konsesi | Concessionaire Staff |
| `fakulti` | Staf Fakulti | Faculty Members |
| `pelajar` | Pelajar | Students |
| `pesakit` | Pesakit | Patients |

Every group has the identical shape: identifier → Section A demographics →
12 Likert questions (1–5) → 1 optional open-text → submit.

**Note on the internal codes.** `pengurusan` and `klinikal` are kept as the
database codes for continuity with the question codes (`Q5_DIR_MGMT`,
`Q6_CLINICAL`, etc.). Only the *display labels* changed — no schema impact.

### Avoiding overlap between the first two groups

Grade 9 and above would ordinarily include most HASA specialists and many
medical officers, so without guidance a HASA specialist could reasonably pick
either group. The rule is:

> **Doctors and dentists always answer as Medical & Dental Officers, whatever
> their grade. Professional & Management (Grade 9+) is for every other
> profession at that grade — pharmacists, scientists, engineers, admin and so on.**

Because the survey uses a single shared link, this rule has to be visible *on
the group picker itself*, not just in a briefing. Both cards therefore carry a
helper line:

| Group | Helper line (MS) | Helper line (EN) |
|---|---|---|
| Profesional & Pengurusan | Selain Pegawai Perubatan & Pegawai Pergigian — mereka sila pilih kumpulan di bawah. | Excluding Medical & Dental Officers — they should choose the group below. |
| Pegawai Perubatan & Pergigian | Pegawai HASA sahaja. Jika anda mempunyai lantikan fakulti, sila pilih Staf Fakulti. | HASA-appointed officers only. If you hold a faculty appointment, please choose Faculty Members. |

The second line matters because clinicians holding a faculty appointment belong
in **Staf Fakulti** — that group's questions are specifically about serving two
institutions, which is exactly their situation.

---

## 3. Identifier (deduplication)

Label varies slightly by group:

- **NRIC only:** pengurusan, sokongan, konsesi
  `6 Digit Terakhir Nombor Kad Pengenalan / [Last 6 Digits of NRIC]`
- **NRIC or passport:** klinikal, fakulti, pelajar, pesakit
  `6 Digit Terakhir Nombor Kad Pengenalan atau Pasport / [Last 6 Digits of NRIC or Passport Number]`

Required in all groups. Helper text (all groups):

> Maklumat ini dikumpul semata-mata untuk tujuan pengesahan data bagi mengelakkan
> kemasukan berulang dan akan dirahsiakan sepenuhnya. / [This information is collected
> solely for data verification purposes to prevent duplicate entries and will be kept
> strictly confidential.]

**Implementation:** hash the 6 digits together with the group code into
`response_hash` and store only the hash — never the raw digits. Same approach
already used in PSCS. Dedup is per group.

> **Recommendation:** standardise on "NRIC atau Pasport" for all seven groups.
> Concessionaire staff in particular may be non-citizens.

---

## 4. Section A — demographics per group

| Field | pengurusan | klinikal | sokongan | konsesi | fakulti | pelajar | pesakit |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Umur / Age | ● | ● | ● | ● | ● | ● | ● |
| Jantina / Sex | ● | ● | ● | ● | ● | ● | ● |
| Tempoh perkhidmatan / service | ● | ● | ● | ● | ● | — | — |
| Tempoh rawatan / treatment | — | — | — | — | — | — | ● |
| Penjawatan / Position | — | — | ● | — | — | — | — |
| Tahun penempatan / Year of posting | — | — | — | — | — | ● | — |
| Fakulti / Faculty | — | — | — | — | — | ● | — |
| Tahap Pengajian / Level of study | — | — | — | — | — | ● | — |

Note: the Tally forms have a **Jabatan / Department** dropdown for klinikal and
fakulti. Per your decision this is **dropped** — results are evaluated generally,
not per department.

Exact service-period labels differ by group:
- pengurusan, klinikal, sokongan: `Tempoh perkhidmatan di UiTM termasuk di HASA`
- konsesi: `Tempoh bekerja dengan UiTM termasuk di HASA`
- fakulti: `Tempoh perkhidmatan di UiTM`
- pesakit: `Tempoh rawatan di HASA termasuk di Pusat Perubatan UiTM Sungai Buloh dan Selayang`

### Option lists

**Umur / Age** — `<20`, `20–29`, `30–39`, `40–49`, `50–59`, `>60`

**Jantina / Sex** — `Lelaki / Male`, `Perempuan / Female`

**Tempoh perkhidmatan & Tempoh rawatan** — `<1 tahun`, `1–3 tahun`, `4–6 tahun`,
`7–10 tahun`, `>10 tahun`

**Tahun penempatan di HASA** — `Tahun 1`, `Tahun 2`, `Tahun 3`, `Tahun 4`,
`Tahun 5`, `>Tahun 5`

**Fakulti** — Fakulti Perubatan · Fakulti Pergigian · Fakulti Farmasi ·
Fakulti Sains Kesihatan · Fakulti-fakulti lain di UiTM · Pelajar bukan UiTM

**Tahap Pengajian** — Sijil · Diploma · Sarjana Muda · Sarjana · PhD

**Penjawatan / Position** (sokongan only) — wording aligned to the existing
`pscs_positions` table so VMO and Safety Culture results stay comparable:

| # | Bahasa Melayu | English |
|---|---|---|
| 1 | Jururawat | Staff Nurse |
| 2 | Pembantu Perawatan Kesihatan | Health Assistant |
| 3 | Penolong Pegawai Perubatan | Assistant Medical Officer |
| 4 | Juruteknologi Makmal Perubatan | Medical Laboratory Technologist |
| 5 | Juru X-ray | Radiographer |
| 6 | Pegawai Optometri | Optometrist |
| 7 | Pegawai Audiologi | Audiologist |
| 8 | Jurupulih Perubatan (Fisioterapi) | Physiotherapist |
| 9 | Jurupulih Perubatan (Carakerja) | Occupational Therapist |
| 10 | Jurupulih Pertuturan & Bahasa | Speech & Language Therapist |
| 11 | Pembantu Pembedahan Pergigian | Dental Surgery Assistant |
| 12 | Pemandu Ambulans | Ambulance Driver |
| 13 | Polis Bantuan | Auxiliary Police |
| 14 | Kerani | Clerk |
| 15 | Pegawai Eksekutif | Executive Officer |
| 16 | Pembantu Operasi | Operation Assistant |
| 17 | Pembantu Sajian | Catering Assistant |
| 18 | Pembantu Linen / Pembersihan / Sisa Kesihatan | Linen / Cleansing / Healthcare Waste Assistant |
| 19 | Juruteknik Komputer | Computer Technician |
| 20 | Penolong Jurutera | Assistant Engineer |
| 21 | Lain-lain (sila nyatakan) | Other (please specify) |

---

## 5. Answer scale

All 12 questions in every group use a **1–5 single-select scale** with anchors
printed under positions 1, 3 and 5:

`1 = Sangat Tidak Setuju` · `3 = Neutral` · `5 = Sangat Setuju`

Anchors are Malay-only on the Tally forms. The portal version will show both
languages, following the BM/EN toggle.

---

## 6. Question bank

The seven forms contain **84 question slots** (7 groups × 12) but only
**44 distinct questions**. Identical text is stored once and reused — this is
what makes cross-group comparison possible.

### Universal — identical in all seven groups

| Code | Malay | English |
|---|---|---|
| `Q1_HAPPY` | Sejauh manakah tahap kebahagiaan anda bekerja/berurusan dengan HASA? | How happy are you working/engaging with HASA? |
| `Q2_AWARE` | Saya sedar dan memahami Visi, Misi, dan Objektif (VMO) HASA. | I am aware of and understand HASA's Vision, Mission, and Objectives (VMO). |
| `Q4_UPDATE` ⚠ | VMO HASA perlu dikemas kini atau distruktur semula agar lebih sepadan dengan keperluan semasa. | HASA's VMO needs to be updated or restructured to better fit current needs. |

⚠ **`Q4_UPDATE` is reverse-coded** — see §7.

### Q3 — two variants

| Code | Groups | Malay |
|---|---|---|
| `Q3_VALID` | all except fakulti | VMO HASA adalah relevan dan masih sah untuk menjadi panduan hospital. |
| `Q3_ALIGN_FAC` | fakulti | VMO HASA adalah relevan dan sejajar dengan VMO fakulti saya serta hala tuju UiTM secara keseluruhan. |

### Q5 — strategic understanding (6 variants)

| Code | Groups | Malay |
|---|---|---|
| `Q5_DIR_MGMT` | pengurusan | Saya memahami arah strategik semasa HASA dengan jelas. |
| `Q5_DIR` | klinikal, sokongan | Saya memahami hala tuju strategik HASA dengan jelas. |
| `Q5_CONCESSION` | konsesi | Saya memahami bagaimana perkhidmatan konsesi saya menyokong operasi HASA. |
| `Q5_SYNERGY` | fakulti | Saya memahami arah sinergi antara HASA dan fakulti dengan jelas. |
| `Q5_RESEARCH_STU` | pelajar | HASA menyediakan sokongan, kemudahan, dan akses kepada pesakit yang mencukupi untuk aktiviti penyelidikan atau projek akademik saya. |
| `Q5_INFO_PT` | pesakit | Saya memahami maklumat yang diberikan oleh hospital tentang rawatan, prosedur, atau proses perkhidmatan dengan jelas. |

### Q6 — service fit (7 variants, all group-specific)

| Code | Group | Malay |
|---|---|---|
| `Q6_FIT_MGMT` | pengurusan | Hala tuju strategik HASA adalah munasabah dan selaras dengan keperluan hospital. |
| `Q6_CLINICAL` | klinikal | Hala tuju strategik HASA menyokong penyampaian penjagaan klinikal yang berkualiti. |
| `Q6_SUPPORT` | sokongan | Hala tuju strategik HASA menyokong peranan dan fungsi unit sokongan dengan baik. |
| `Q6_COORD` | konsesi | Saya berpuas hati dengan penyelarasan dan komunikasi antara pihak konsesi dan hospital. |
| `Q6_RESEARCH_FAC` | fakulti | HASA menyediakan sokongan, kemudahan, dan akses kepada pesakit yang mencukupi untuk aktiviti penyelidikan saya. |
| `Q6_ACCESS_STU` | pelajar | Saya berpuas hati dengan akses kepada pesakit, kes klinikal, dan penyeliaan untuk pembelajaran saya. |
| `Q6_FACILITIES_PT` | pesakit | Saya berpuas hati dengan kemudahan hospital seperti tempat letak kereta, akses masuk, dan pergerakan dalam hospital. |

### Q7 — role / experience satisfaction (6 variants)

| Code | Groups | Malay |
|---|---|---|
| `Q7_ROLE_MGMT` | pengurusan | Saya berpuas hati dengan kandungan kerja dan tanggungjawab yang saya lakukan di HASA. |
| `Q7_ROLE_CLIN` | klinikal | Saya berpuas hati dengan kandungan kerja dan tanggungjawab klinikal yang saya lakukan di HASA. |
| `Q7_ROLE` | sokongan, konsesi | Saya berpuas hati dengan kandungan kerja dan tanggungjawab saya di HASA. |
| `Q7_DUAL_FAC` | fakulti | Saya berpuas hati dengan kejelasan peranan dan tanggungjawab saya dalam dua institusi ini. |
| `Q7_LEARN_STU` | pelajar | Saya berpuas hati dengan pengalaman pembelajaran dan pendedahan klinikal yang disediakan di HASA. |
| `Q7_CARE_PT` | pesakit | Saya berpuas hati dengan pengalaman mendapatkan rawatan atau perkhidmatan di HASA. |

### Q8 — support (7 variants)

| Code | Group | Malay |
|---|---|---|
| `Q8_ACHIEVE_MGMT` | pengurusan | Saya berpuas hati dengan tahap pencapaian dan sokongan dalam tugas harian saya. |
| `Q8_SUPPORT_CLIN` | klinikal | Saya berpuas hati dengan tahap sokongan yang membantu kelancaran kerja klinikal saya. |
| `Q8_SUPPORT_DAILY` | sokongan | Saya berpuas hati dengan tahap sokongan yang membantu kelancaran tugasan harian saya. |
| `Q8_SUPPORT_KON` | konsesi | Saya berpuas hati dengan sokongan yang membantu kelancaran tugasan harian saya. |
| `Q8_COMMIT_FAC` | fakulti | Saya berpuas hati dengan cara saya mengurus komitmen antara HASA dan fakulti. |
| `Q8_COMMS_STU` | pelajar | Saya berpuas hati dengan komunikasi dan pengurusan berkaitan penempatan saya di HASA. |
| `Q8_OKU_PT` | pesakit | Saya berasa hospital ini mesra orang kurang upaya (OKU) dan menyediakan kemudahan yang sesuai untuk mereka. |

### Q9–Q12 — welfare and growth

| Code | Groups | Malay |
|---|---|---|
| `Q9_WELFARE` | pengurusan, klinikal, sokongan, konsesi, fakulti | Saya berasa kebajikan dan kesejahteraan saya diberi perhatian dengan sewajarnya. |
| `Q9_WELFARE_STU` | pelajar | Saya berasa kebajikan dan kesejahteraan pelajar diambil perhatian dengan baik. |
| `Q9_WELFARE_PT` | pesakit | Saya berasa kebajikan dan keselesaan pesakit diberi perhatian dengan baik oleh hospital. |
| `Q10_WORKLOAD` | pengurusan, klinikal, sokongan, konsesi | Saya berasa beban kerja dan keseimbangan kerja-kehidupan saya diurus dengan baik. |
| `Q10_WORKLOAD_FAC` | fakulti | Saya berasa beban kerja dan keseimbangan kerja-kehidupan saya diurus dengan baik walaupun berkhidmat di dua institusi. |
| `Q10_LOAD_STU` | pelajar | Saya berasa beban akademik dan keperluan penempatan saya diurus dengan baik. |
| `Q10_CONCERN_PT` | pesakit | Saya berasa keperluan dan kebimbangan saya diambil serius dan diurus dengan baik. |
| `Q11_CAREER` | pengurusan, klinikal, sokongan, konsesi, fakulti | Saya mempunyai peluang yang jelas untuk pembangunan kerjaya dan pertumbuhan peribadi. |
| `Q11_SKILLS_STU` | pelajar | Saya mempunyai peluang yang jelas untuk pembangunan kemahiran dan pertumbuhan peribadi. |
| `Q11_FEEDBACK_PT` | pesakit | Saya mempunyai peluang yang jelas untuk memberikan maklum balas bagi penambahbaikan perkhidmatan. |
| `Q12_SUPPORT_DEV` | pengurusan, klinikal, sokongan, konsesi, fakulti | Saya menerima sokongan yang mencukupi untuk meningkatkan kemahiran dan potensi diri saya. |
| `Q12_CONFIDENCE_STU` | pelajar | Saya menerima sokongan yang mencukupi untuk meningkatkan keyakinan dan potensi diri sebagai bakal pengamal perubatan. *(EN: "…as a future healthcare worker.")* |
| `Q12_SUPPORT_PT` | pesakit | Saya menerima sokongan yang mencukupi daripada staf untuk memahami dan mengurus rawatan saya. |

### Closing open-text (all groups, optional, unnumbered)

> Adakah terdapat sebarang isu atau cadangan khusus yang ingin anda bawa ke
> perhatian pengurusan tertinggi? (Sila nyatakan secara ringkas).
> [Are there any specific issues or suggestions you would like to bring to the
> attention of top management? (Please be brief).]

---

## 7. Themes and scoring

Each question is tagged with a theme so results roll up consistently even where
the wording differs by group:

| Theme | Questions | Comparable across |
|---|---|---|
| Engagement | Q1 | **All 7 groups** (identical wording) |
| VMO awareness & relevance | Q2, Q3, Q4 | **All 7** (Q2, Q4 identical; Q3 in 6) |
| Strategic direction & service fit | Q5, Q6 | Within group; thematically across |
| Role & experience satisfaction | Q7, Q8 | Within group; thematically across |
| Welfare & wellbeing | Q9, Q10 | 5 staff groups directly; others thematically |
| Growth & development | Q11, Q12 | 5 staff groups directly; others thematically |

**Reverse scoring.** `Q4_UPDATE` asks whether the VMO *needs updating*. Agreeing
is a negative signal about the current VMO, so it must be reversed
(`score = 6 − raw`) before rolling into the VMO theme. The question carries a
`reverse_scored` flag in the schema. The dashboard will also show Q4 raw and on
its own, since "should we refresh the VMO?" is a finding leadership will want
to read directly rather than buried in an average.

**Percent positive.** Following PSCS convention, report % positive = responses
scoring 4 or 5 (using the reversed value for Q4), alongside the mean.

---

## 8. Data-quality issues — ALL FOUR TO BE FIXED

Confirmed: the survey has not launched and there are no responses yet, so the
portal will use the corrected wording. **These four fixes are applied in the
portal version.** The Tally forms should be corrected to match (or retired).

**Fix 1 — Q1 gets happiness anchors in every group.** Q1 asks *how happy* you
are, but six of the seven Tally forms print agree/disagree anchors. Q1 will use
its own scale in all seven groups:

`1 = Sangat Tidak Gembira` · `3 = Neutral` · `5 = Sangat Gembira`
`[1 = Very Unhappy · 3 = Neutral · 5 = Very Happy]`

All other questions (Q2–Q12) keep the agreement anchors from §5. This means the
question bank needs a `scale_type` column — `happiness` for Q1, `agreement` for
the rest.

**Fix 2 — patient and student Q1 reworded.** The Tally patient form asks about
"kebahagiaan anda **bekerja**/berurusan dengan HASA"; "bekerja" (working) does
not apply to a patient. Corrected wording:

| Group | Malay | English |
|---|---|---|
| 5 staff groups | Sejauh manakah tahap kebahagiaan anda **bekerja/berurusan** dengan HASA? | How happy are you **working/engaging** with HASA? |
| pelajar | Sejauh manakah tahap kebahagiaan anda **menjalani penempatan** di HASA? | How happy are you **with your placement** at HASA? |
| pesakit | Sejauh manakah tahap kebahagiaan anda **berurusan** dengan HASA? | How happy are you **engaging** with HASA? |

This splits `Q1_HAPPY` into three codes: `Q1_HAPPY` (staff), `Q1_HAPPY_STU`,
`Q1_HAPPY_PT`. They stay in the same theme and remain directly comparable —
same scale, same intent — but each reads correctly for its audience.

**Fix 3 — Klinikal Q9 becomes required**, matching every other group.

**Fix 4 — identifier standardised to "NRIC atau Pasport"** for all seven groups.
`vmo_groups.id_label` is therefore `nric_passport` throughout.

> Net effect on the bank: **46 distinct questions** (44 + 2 extra Q1 variants),
> still covering the same 84 group-question slots.

---

## 9. Proposed database schema

All tables prefixed `vmo_`. Additive only — nothing existing is touched.

```
vmo_groups
  code            text primary key      -- pengurusan, klinikal, ...
  name_ms         text
  name_en         text
  title_ms        text                  -- full form title
  title_en        text
  id_label        text                  -- 'nric' | 'nric_passport'
  sort_order      int
  active          bool default true

vmo_questions                            -- the shared bank (44 rows)
  code            text primary key      -- Q1_HAPPY, Q4_UPDATE, ...
  text_ms         text
  text_en         text
  theme           text                  -- engagement | vmo | direction | role | welfare | growth
  scale_type      text default 'agreement'  -- 'agreement' | 'happiness'  (Fix 1)
  reverse_scored  bool default false
  active          bool default true

vmo_group_questions                      -- 84 rows: which question, which group, what position
  group_code      text references vmo_groups(code)
  question_code   text references vmo_questions(code)
  position        int                   -- 1..12
  required        bool default true
  primary key (group_code, position)

vmo_demographics                         -- which Section A fields apply per group
  group_code      text references vmo_groups(code)
  field_code      text                  -- age | sex | service | treatment | position | posting_year | faculty | study_level
  label_ms        text
  label_en        text
  position        int
  required        bool default true
  primary key (group_code, field_code)

vmo_demographic_options
  field_code      text
  value           text
  label_ms        text
  label_en        text
  sort_order      int
  primary key (field_code, value)

vmo_responses
  id              bigserial primary key
  group_code      text references vmo_groups(code)
  response_hash   text                  -- hash(last6 + group), dedup; raw digits never stored
  demographics    jsonb                 -- { age: '30-39', sex: 'F', ... }
  free_text       text
  language        text                  -- 'ms' | 'en' (which language they answered in)
  submitted_at    timestamptz default now()
  unique (group_code, response_hash)

vmo_answers
  response_id     bigint references vmo_responses(id) on delete cascade
  question_code   text references vmo_questions(code)
  value           smallint check (value between 1 and 5)
  primary key (response_id, question_code)
```

**RLS:**

- `vmo_responses` / `vmo_answers` — anonymous **INSERT** allowed (the public form
  must be able to submit without a login). **SELECT for any authenticated user**,
  since the module follows portal access rather than a role gate. No anonymous
  SELECT: a respondent can submit but can never read anyone's answers.
- Reference tables (`vmo_groups`, `vmo_questions`, `vmo_group_questions`,
  `vmo_demographics`, `vmo_demographic_options`) — SELECT for anon so the public
  form can render; writes restricted to service role.
- Raw NRIC digits are never stored, only the hash.

---

## 10. Screens

### Public survey — `/vmo` (no login, bilingual BM/EN toggle)

1. **Group picker** — seven large, clearly-labelled cards. This screen matters:
   a patient must not accidentally pick "Kumpulan Klinikal". Plain language,
   both languages visible, patient and student options visually distinct from
   staff.
2. **Identifier** — last 6 digits, with the confidentiality reassurance.
3. **Section A** — only the fields that apply to the chosen group.
4. **Section B** — 12 questions, VMO poster shown after Q1 as in the Tally form.
5. **Open text** — optional.
6. **Submit** → thank-you screen. Duplicate hash shows a friendly
   "you've already responded" message.

### Portal — `/vmo` module (Coordinator-only), tab bar matching IR/KPI/PSCS

| Tab | Content |
|---|---|
| Overview | Response counts by group, overall engagement + VMO scores, completion trend |
| By Group | All 7 groups side by side on the shared questions (Q1–Q4) |
| Item-Level | Every question, % positive and mean, filtered by group |
| Breakdowns | By age, sex, service length, position, faculty, level of study |
| Comments | Open-text responses, filterable by group |
| Report Card | Printable summary for management/ROC |
| Export to Excel | Raw responses + codebook, same as PSCS |

---

## 11. Answered — decisions locked

1. **Tally data-quality issues** — fix all four so each question reads correctly
   for its respondent group. See §8.
2. **Existing responses** — none. Survey not launched; portal starts fresh.
3. **Visibility** — everyone with a portal account. No role gate; the module
   appears for any signed-in user, exactly like Risk Register. Today that is
   Fatim and her department officer, and it widens automatically as accounts
   are added.
4. **Sidebar label** — "VMO Survey".

## 13. Results dashboard — detailed plan

Portal module at `/vmo`, visible to any signed-in user, tab bar matching IR/KPI/PSCS.

### 13.1 Metric definitions

Consistency matters more than cleverness — these are the only three numbers used
throughout, so a figure means the same thing on every tab.

| Metric | Definition |
|---|---|
| **% positive** | share of responses scoring **4 or 5**. The headline metric, same convention as PSCS. |
| **Mean** | arithmetic mean of 1–5, shown to 2 decimals. Secondary. |
| **n** | number of responses behind the figure. **Displayed next to every score**, everywhere. |

**Reverse scoring.** `Q4_UPDATE` ("the VMO needs updating") is scored
`6 − raw` before it enters any theme average, because agreeing is a negative
signal about the current VMO. Two consequences:

- In theme rollups, Q4 uses the reversed value.
- On Item-Level and Overview, Q4 is **also shown raw and labelled**, because
  "% who think the VMO needs refreshing" is a direct finding leadership wants,
  not something to bury inside an average.

Anywhere Q4 appears reversed, the UI marks it so nobody misreads the direction.

**No suppression.** Every cell shows its number regardless of how few responses
sit behind it (Fatim's decision). The `n` badge is the safeguard — a score built
on 2 responses is visibly a score built on 2 responses.

**No response-rate denominators yet.** Counts only. If headcounts per group are
supplied later, response rate % can be added without any schema change.

### 13.2 Tabs

**Tab 1 · Overview** — the "what happened" screen.

- Metric cards: total responses · groups responding (x/7) · overall happiness
  (% positive) · VMO awareness (% positive) · **% agreeing the VMO needs
  updating** (raw Q4 — the single most decision-relevant number in the survey).
- Responses by group — horizontal bar, each in that group's accent colour,
  count labelled.
- Six theme scores — engagement, VMO, direction, role, welfare, growth.
- Response trend over time — line by day/week, from `submitted_at`.

**Tab 2 · By Group** — the centrepiece, and the reason for the shared question bank.

- Heatmap: **7 groups (rows) × Q1–Q4 (columns)**, cells coloured by % positive,
  each showing `%` and `n`. These four are the only items with identical wording
  across all seven groups, so this is the one genuinely valid apples-to-apples
  comparison in the survey. Faculty's Q3 differs slightly — flagged with a footnote.
- Ranked bars: groups ordered by happiness, and by VMO awareness.
- Biggest gaps callout: largest spread between groups on any shared question.

**Tab 3 · Item-Level** — group selector, then all 12 questions.

- Per question: full bilingual text, % positive, mean, `n`, and a stacked
  1–5 distribution bar (red→green) so you can see polarisation, not just averages.
- Grouped under the six theme headings.
- Sort: by question order, or worst-scoring first.

**Tab 4 · Breakdowns** — demographic cuts.

- Age · Sex · Service length (or treatment period) across all groups.
- Group-specific: Penjawatan (Sokongan); Faculty, Year of posting, Level of
  study (Pelajar).
- Presented as a matrix of demographic value × theme score, with `n` per row.

**Tab 5 · Comments** — the open-text.

- Full verbatim text, filterable by group and searchable.
- Each comment tagged with its group (in that group's colour) and date.
- **Warning banner:** these are confidential staff/patient comments that may
  identify individuals — handle accordingly, do not redistribute.
- Export comments to Excel.

**Tab 6 · Report Card** — printable A4 for ROC / top management.

- Cover: title, period covered, total responses.
- Summary: the five headline numbers from Overview.
- The By-Group heatmap.
- Theme table across groups.
- Selected comments (chosen by Fatim, not auto-picked — an auto-selection would
  effectively editorialise).
- Print-optimised CSS, same approach as the PSCS and IR report cards.

**Tab 7 · Export to Excel** — raw responses + codebook, matching the PSCS export
so both surveys can be analysed the same way. Sheets: Responses (one row per
respondent, demographics as columns, Q1–Q12 as columns), Codebook (question
codes → full bilingual text, theme, scale, reverse flag), Groups, Options.

### 13.3 Filters (persist across tabs)

Group · date range · language answered in. Deliberately no free-text search on
Overview — that belongs on Comments.

### 13.4 Queries

All read-only against `vmo_responses` joined to `vmo_answers`. Volumes are small
(hundreds to low thousands of rows), so the page can load the full answer set
once and compute in the browser — the same approach PSCS uses — rather than
round-tripping per tab. No database views needed initially.

---

## 12. Build order

1. Migration: create the 7 `vmo_` tables + RLS (**awaiting sign-off**).
2. Seed: 7 groups, 46 questions, 84 group-question rows, demographics + options.
3. Public survey at `/vmo` — group picker → identifier → Section A → 12
   questions → open text → submit.
4. Portal module at `/vmo` with the 7 tabs, wired into the sidebar as
   "VMO Survey" (`global: false`, like Risk Register).
5. Export to Excel + Report Card.
