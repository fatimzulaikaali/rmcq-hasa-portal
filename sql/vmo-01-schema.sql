-- =====================================================================
-- VMO Survey module — schema + RLS
-- Hala Tuju Strategik HASA / HASA Strategic Direction Questionnaire
--
-- STATUS: DRAFT — awaiting Fatim's sign-off. Do not run until approved.
--
-- Additive only. Creates seven new vmo_* tables. Touches nothing existing:
-- no ALTER, no DROP, no changes to risk_*, pscs_*, ir_*, kpi_* or acc_*.
--
-- Seed data (7 groups, 46 questions, 84 group-question rows, demographics
-- and their option lists) is in a separate file: vmo-02-seed.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Respondent groups
-- ---------------------------------------------------------------------
create table if not exists vmo_groups (
  code        text primary key,
  name_ms     text not null,
  name_en     text not null,
  title_ms    text not null,
  title_en    text not null,
  -- 'nric' | 'nric_passport'  (standardised to nric_passport — see spec Fix 4)
  id_label    text not null default 'nric_passport',
  sort_order  int  not null default 0,
  active      bool not null default true
);

comment on table vmo_groups is
  'The seven respondent groups. Each has its own 12-question set via vmo_group_questions.';

-- ---------------------------------------------------------------------
-- 2. Shared question bank
--    46 distinct questions covering 84 group-question slots. Questions
--    with identical wording are stored ONCE and reused across groups —
--    this is what makes cross-group comparison possible.
-- ---------------------------------------------------------------------
create table if not exists vmo_questions (
  code            text primary key,
  text_ms         text not null,
  text_en         text not null,
  -- engagement | vmo | direction | role | welfare | growth
  theme           text not null,
  -- 'agreement' (Sangat Tidak Setuju..Sangat Setuju) for Q2-Q12
  -- 'happiness'  (Sangat Tidak Gembira..Sangat Gembira) for Q1
  scale_type      text not null default 'agreement',
  -- true for Q4_UPDATE: agreeing is a NEGATIVE signal, so the analytics
  -- layer must score it as (6 - value) before rolling into the VMO theme.
  reverse_scored  bool not null default false,
  active          bool not null default true,
  constraint vmo_questions_theme_ck
    check (theme in ('engagement','vmo','direction','role','welfare','growth')),
  constraint vmo_questions_scale_ck
    check (scale_type in ('agreement','happiness'))
);

comment on column vmo_questions.reverse_scored is
  'Q4_UPDATE only. Agreeing means the VMO is NOT working, so score 6-value.';

-- ---------------------------------------------------------------------
-- 3. Which question appears where, for which group (84 rows)
-- ---------------------------------------------------------------------
create table if not exists vmo_group_questions (
  group_code     text not null references vmo_groups(code) on delete cascade,
  question_code  text not null references vmo_questions(code),
  position       int  not null,
  required       bool not null default true,
  primary key (group_code, position),
  constraint vmo_gq_position_ck check (position between 1 and 12),
  -- a question may not appear twice within the same group
  unique (group_code, question_code)
);

-- ---------------------------------------------------------------------
-- 4. Section A demographic fields, per group
-- ---------------------------------------------------------------------
create table if not exists vmo_demographics (
  group_code  text not null references vmo_groups(code) on delete cascade,
  -- age | sex | service | treatment | position | posting_year | faculty | study_level
  field_code  text not null,
  label_ms    text not null,
  label_en    text not null,
  position    int  not null default 0,
  required    bool not null default true,
  primary key (group_code, field_code)
);

comment on table vmo_demographics is
  'Section A varies by group. Labels live here because the same field_code has '
  'different wording per group (e.g. service length for staff vs treatment period '
  'for patients).';

-- ---------------------------------------------------------------------
-- 5. Dropdown options for each demographic field
-- ---------------------------------------------------------------------
create table if not exists vmo_demographic_options (
  field_code  text not null,
  value       text not null,
  label_ms    text not null,
  label_en    text not null,
  sort_order  int  not null default 0,
  active      bool not null default true,
  primary key (field_code, value)
);

-- ---------------------------------------------------------------------
-- 6. Responses  (one row per completed submission)
--
--    PRIVACY: the last 6 NRIC/passport digits are NEVER stored. The app
--    hashes them together with the group code and a server-side secret,
--    and only the resulting digest is written to response_hash. The hash
--    exists purely to block duplicate submissions.
-- ---------------------------------------------------------------------
create table if not exists vmo_responses (
  id             bigserial primary key,
  group_code     text not null references vmo_groups(code),
  response_hash  text not null,
  -- { "age": "30-39", "sex": "F", "service": "4-6", ... }
  demographics   jsonb not null default '{}'::jsonb,
  free_text      text,
  language       text not null default 'ms',
  submitted_at   timestamptz not null default now(),
  constraint vmo_responses_lang_ck check (language in ('ms','en')),
  -- dedup is per group: the same person could legitimately be, say, both
  -- a patient and a staff member
  constraint vmo_responses_dedup_uq unique (group_code, response_hash)
);

create index if not exists vmo_responses_group_idx    on vmo_responses (group_code);
create index if not exists vmo_responses_submitted_idx on vmo_responses (submitted_at);

comment on column vmo_responses.response_hash is
  'Hash of (last 6 ID digits + group + secret). Raw digits are never stored.';
comment on column vmo_responses.submitted_at is
  'Every response is timestamped so survey rounds/campaigns can be added later '
  'by slicing on date, with no migration needed.';

-- ---------------------------------------------------------------------
-- 7. Answers  (12 rows per response)
-- ---------------------------------------------------------------------
create table if not exists vmo_answers (
  response_id    bigint not null references vmo_responses(id) on delete cascade,
  question_code  text   not null references vmo_questions(code),
  value          smallint not null,
  primary key (response_id, question_code),
  constraint vmo_answers_value_ck check (value between 1 and 5)
);

create index if not exists vmo_answers_question_idx on vmo_answers (question_code);

-- =====================================================================
-- Row Level Security
--
-- Reference tables : readable by anon (the public form must render).
-- Responses/answers: anon may INSERT (submit) but NOT select. Any
--                    authenticated portal user may SELECT (the module
--                    follows portal access, no role gate).
-- Writes to reference tables are service-role only.
-- =====================================================================

alter table vmo_groups              enable row level security;
alter table vmo_questions           enable row level security;
alter table vmo_group_questions     enable row level security;
alter table vmo_demographics        enable row level security;
alter table vmo_demographic_options enable row level security;
alter table vmo_responses           enable row level security;
alter table vmo_answers             enable row level security;

-- --- reference tables: public read ------------------------------------
create policy vmo_groups_read on vmo_groups
  for select to anon, authenticated using (true);

create policy vmo_questions_read on vmo_questions
  for select to anon, authenticated using (true);

create policy vmo_group_questions_read on vmo_group_questions
  for select to anon, authenticated using (true);

create policy vmo_demographics_read on vmo_demographics
  for select to anon, authenticated using (true);

create policy vmo_demographic_options_read on vmo_demographic_options
  for select to anon, authenticated using (true);

-- --- responses --------------------------------------------------------
-- Anyone may submit the public survey...
create policy vmo_responses_insert_anon on vmo_responses
  for insert to anon, authenticated with check (true);

-- ...but only signed-in portal users may read results back.
create policy vmo_responses_select_auth on vmo_responses
  for select to authenticated using (true);

-- --- answers ----------------------------------------------------------
create policy vmo_answers_insert_anon on vmo_answers
  for insert to anon, authenticated with check (true);

create policy vmo_answers_select_auth on vmo_answers
  for select to authenticated using (true);

-- No UPDATE or DELETE policies anywhere: responses are immutable once
-- submitted, and reference data is maintained via the service role.

commit;
