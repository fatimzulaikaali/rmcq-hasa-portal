-- =====================================================================
-- TNA & Kompetensi module — schema + RLS + staff-link RPCs
-- Analisis Keperluan Latihan (Jabatan RMCQ dahulu; struktur generik untuk
-- jabatan lain kemudian)
--
-- STATUS: APPROVED 8 Okt 2026 — applied to Supabase as migration tna_01_schema.
--
-- Additive only. Creates new tna_* tables, views and functions. Touches
-- nothing existing: no ALTER, no DROP on risk_*, pscs_*, ir_*, kpi_*,
-- acc_*, mm_*, vmo_*.
--
-- Seed data (kamus UiTM + RMCQ, petunjuk perilaku, profil jawatan RMCQ,
-- staf, 23 program hospital) goes in a separate file: tna-02-seed.sql
--
-- Scale: 1 Asas · 2 Kompeten · 3 Cekap · 4 Pakar · 5 Pakar Strategi
-- (Kamus Kompetensi UiTM 2021). No zero level.
-- =====================================================================

begin;

create extension if not exists pgcrypto with schema extensions;  -- Supabase keeps pgcrypto in 'extensions'

-- ---------------------------------------------------------------------
-- 1. Kitaran tahunan (TNA 2027, TNA 2028 …)
-- ---------------------------------------------------------------------
create table if not exists tna_cycles (
  id            bigserial primary key,
  year          int  not null unique,
  name_ms       text not null,                 -- 'TNA 2027'
  status        text not null default 'draft', -- draft | open | closed
  open_date     date,
  close_date    date,
  copied_from   bigint references tna_cycles(id),
  created_at    timestamptz not null default now(),
  constraint tna_cycles_status_ck check (status in ('draft','open','closed'))
);
comment on table tna_cycles is
  'One row per annual TNA. A new cycle clones positions, requirements and active staff assignments from the previous one.';

-- ---------------------------------------------------------------------
-- 2. Kamus kompetensi (Lapisan A: Generik UiTM · Lapisan B: Kefungsian jabatan)
--    Competencies are NOT per cycle: the dictionary is maintained in place,
--    every change is written to tna_audit_log.
-- ---------------------------------------------------------------------
create table if not exists tna_competencies (
  code            text primary key,               -- NL1..NL5, TR1..TR5, GN1..GN4, KP1..KP5, R01..R26
  layer           text not null,                  -- 'A' (UiTM generic) | 'B' (departmental functional)
  cluster         text not null,                  -- Nilai | Teras | Generik | Kepimpinan | Asas RMCQ | Kefungsian Unit | Merentas RMCQ
  source          text not null default 'Tambahan', -- 'Kamus UiTM 2021' | 'Kamus RMCQ' | 'Tambahan' (new items added in the portal)
  staff_category  text not null default 'pentadbiran', -- Kamus UiTM: only Bab 3–6 (pentadbiran) are used; akademik not loaded
  dept_code       text,                           -- null for layer A; 'RMCQ' for R01..R26 (future: other depts)
  unit_code       text,                           -- owning unit for 'Kefungsian Unit' rows
  name_ms         text not null,
  name_en         text,
  definition_ms   text,
  definition_en   text,
  default_training_ms text,                       -- suggested training; editable (see programmes for per-cycle wording)
  -- applicability by SSPA grade for layer A (from Kamus ms. 11); null = all grades
  min_sspa_grade  int,
  max_sspa_grade  int,
  sort_order      int  not null default 0,
  active          bool not null default true,     -- deactivate instead of delete (history keeps referring to it)
  created_at      timestamptz not null default now(),
  created_by      uuid,
  constraint tna_comp_layer_ck check (layer in ('A','B')),
  constraint tna_comp_cat_ck   check (staff_category in ('pentadbiran','akademik','semua')),
  constraint tna_comp_code_ck  check (code ~ '^[A-Z]{1,4}[0-9]{1,3}$')
);
comment on table tna_competencies is
  'Kamus. Layer A = Kamus UiTM 2021 Bab 3–6 (staf pentadbiran sahaja). Layer B = kefungsian jabatan. '
  'New competencies (any layer/cluster) are added by TNA admins in the portal with source = Tambahan.';

create table if not exists tna_competency_levels (
  competency_code text not null references tna_competencies(code) on update cascade on delete cascade,
  level           smallint not null,
  indicator_ms    text not null,                  -- petunjuk perilaku
  indicator_en    text,
  primary key (competency_code, level),
  constraint tna_lv_ck check (level between 1 and 5)
);

-- ---------------------------------------------------------------------
-- 3. Unit dalam jabatan (Carta Fungsi)
-- ---------------------------------------------------------------------
create table if not exists tna_units (
  code        text primary key,                   -- RO, RK-IKP, RK-AK, JKKD, PK, KJ
  dept_code   text not null default 'RMCQ',
  name_ms     text not null,
  bahagian_ms text,                               -- Bahagian Pengurusan Risiko | Bahagian Pematuhan & Kualiti
  sort_order  int not null default 0,
  active      bool not null default true
);

-- ---------------------------------------------------------------------
-- 4. Profil jawatan (per kitaran) + tahap diperlukan
--    A position exists even when vacant. Vacant = no active assignment.
-- ---------------------------------------------------------------------
create table if not exists tna_positions (
  id              bigserial primary key,
  cycle_id        bigint not null references tna_cycles(id) on delete cascade,
  unit_code       text   not null references tna_units(code),
  title_ms        text   not null,                -- 'Pegawai Sains'
  grade_sspa      text   not null,                -- 'C9', 'UD14', 'U5/U6'
  grade_sspa_num  int    not null,                -- 9, 14, 6 — drives layer A applicability
  grade_ssm_equiv text,                           -- '41/42'
  grade_level     smallint not null,              -- Kamus tahap gred 1..5 (derived, stored for reporting)
  role_type       text   not null,                -- KJ | KU (Ketua Unit) | PP (Pegawai Perubatan) | SOK | KER
  supervisor_position_id bigint references tna_positions(id),
  sort_order      int not null default 0,
  active          bool not null default true,     -- false = post abolished (not merely vacant)
  constraint tna_pos_role_ck check (role_type in ('KJ','KU','PP','SOK','KER')),
  constraint tna_pos_lv_ck   check (grade_level between 1 and 5)
);
create index if not exists tna_positions_cycle_idx on tna_positions (cycle_id);

create table if not exists tna_position_requirements (
  position_id     bigint not null references tna_positions(id) on delete cascade,
  competency_code text   not null references tna_competencies(code) on update cascade,
  required_level  smallint not null,
  primary key (position_id, competency_code),
  constraint tna_req_lv_ck check (required_level between 1 and 5)
);

-- ---------------------------------------------------------------------
-- 5. Staf (rekod induk, merentas kitaran) — archive, never delete
-- ---------------------------------------------------------------------
create table if not exists tna_staff (
  id              bigserial primary key,
  staff_no        text not null unique,           -- used for link verification
  name            text not null,
  email           text,                           -- also the supervisor's login email, if any
  phone           text,
  status          text not null default 'active', -- active | archived
  archived_reason text,                           -- Berhenti | Bertukar | Bersara | Cuti belajar | Lain-lain
  archived_on     date,
  archived_by     uuid,
  created_at      timestamptz not null default now(),
  constraint tna_staff_status_ck check (status in ('active','archived')),
  constraint tna_staff_no_ck     check (staff_no ~ '^[0-9]{4,10}$')
);

-- ---------------------------------------------------------------------
-- 6. Penempatan staf dalam kitaran (assignment) + link unik
--    One active assignment per position per cycle.
--    token_hash = sha256(raw token). The raw token is shown once to RMCQ
--    (copy / WhatsApp) and never stored.
-- ---------------------------------------------------------------------
create table if not exists tna_assignments (
  id              bigserial primary key,
  cycle_id        bigint not null references tna_cycles(id) on delete cascade,
  staff_id        bigint not null references tna_staff(id),
  position_id     bigint not null references tna_positions(id),
  supervisor_staff_id bigint references tna_staff(id),   -- Ketua Jabatan for all staff (Q3); null for the KJ
  token_hash      text unique,
  token_issued_at timestamptz,
  token_revoked   bool not null default false,
  status          text not null default 'not_started', -- not_started | draft | submitted | validated | archived
  start_date      date,                           -- tarikh lapor diri
  submitted_at    timestamptz,
  validated_at    timestamptz,
  validated_by    uuid,
  reopened_count  int not null default 0,
  created_at      timestamptz not null default now(),
  constraint tna_asg_status_ck check (status in ('not_started','draft','submitted','validated','archived')),
  unique (cycle_id, staff_id)
);
create unique index if not exists tna_asg_one_per_post
  on tna_assignments (cycle_id, position_id) where status <> 'archived';

-- ---------------------------------------------------------------------
-- 7. Penilaian (kendiri + dipersetujui) — one row per assignment × competency
-- ---------------------------------------------------------------------
create table if not exists tna_assessment_items (
  assignment_id   bigint not null references tna_assignments(id) on delete cascade,
  competency_code text   not null references tna_competencies(code) on update cascade,
  self_level      smallint,
  self_note       text,                           -- bukti / contoh (pilihan)
  never_exposed   bool not null default false,    -- "Belum pernah terdedah": only with self_level = 1;
                                                  -- flags intro training first + priority uplift
  agreed_level    smallint,
  supervisor_note text,
  updated_at      timestamptz not null default now(),
  primary key (assignment_id, competency_code),
  constraint tna_ai_self_ck   check (self_level   between 1 and 5),
  constraint tna_ai_agreed_ck check (agreed_level between 1 and 5),
  constraint tna_ai_never_ck  check (not never_exposed or self_level = 1)
);

-- ---------------------------------------------------------------------
-- 8. Langkah 1–2: isu semasa & adakah perlu latihan (per kitaran)
-- ---------------------------------------------------------------------
create table if not exists tna_issues (
  id              bigserial primary key,
  cycle_id        bigint not null references tna_cycles(id) on delete cascade,
  unit_code       text references tna_units(code),
  target_ms       text not null,                  -- sasaran objektif jabatan
  baseline_ms     text,                           -- pencapaian / data asas
  issue_ms        text,
  root_cause_ms   text,
  cause_type      text,                           -- knowledge_skill | attitude_culture | system_process | resource | na
  needs_training  text,                           -- yes | partial | no
  competency_codes text[] not null default '{}',
  non_training_action_ms text,
  sort_order      int not null default 0,
  constraint tna_iss_cause_ck check (cause_type is null or cause_type in ('knowledge_skill','attitude_culture','system_process','resource','na')),
  constraint tna_iss_need_ck  check (needs_training is null or needs_training in ('yes','partial','no'))
);

-- ---------------------------------------------------------------------
-- 9. Program latihan — jabatan (dikaitkan kompetensi) & hospital (insiden/audit)
--    Every field editable by TNA admin; archive instead of delete.
-- ---------------------------------------------------------------------
create table if not exists tna_programmes (
  id              bigserial primary key,
  cycle_id        bigint not null references tna_cycles(id) on delete cascade,
  scope           text not null,                  -- 'dept' | 'hospital'
  source_section  text,                           -- hospital: A insiden | B audit | C sedia ada | D cadangan
  issue_ms        text,
  title_ms        text not null,                  -- latihan dicadangkan
  target_group_ms text,
  owner_ms        text,                           -- pemilik / penganjur
  rmcq_role       text,                           -- organiser | co_organiser | monitor
  method_ms       text,
  frequency_ms    text,
  non_training_action_ms text,
  kpi_ms          text,                           -- ukuran keberkesanan
  score_size      smallint,                       -- 1..3
  score_severity  smallint,                       -- 1..3
  score_reach     smallint,                       -- 1..3
  priority_override text,                         -- Tinggi | Sederhana | Rendah (null = computed)
  planned_months  smallint[] not null default '{}', -- 1..12
  est_cost_rm     numeric(12,2),
  drive_folder_id text,
  drive_url       text,
  status          text not null default 'active', -- active | archived
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  constraint tna_prog_scope_ck  check (scope in ('dept','hospital')),
  constraint tna_prog_sec_ck    check (source_section is null or source_section in ('A','B','C','D')),
  constraint tna_prog_role_ck   check (rmcq_role is null or rmcq_role in ('organiser','co_organiser','monitor')),
  constraint tna_prog_status_ck check (status in ('active','archived')),
  constraint tna_prog_scores_ck check (
    coalesce(score_size,1)     between 1 and 3 and
    coalesce(score_severity,1) between 1 and 3 and
    coalesce(score_reach,1)    between 1 and 3)
);
create index if not exists tna_programmes_cycle_idx on tna_programmes (cycle_id, scope);

create table if not exists tna_programme_competencies (
  programme_id    bigint not null references tna_programmes(id) on delete cascade,
  competency_code text   not null references tna_competencies(code) on update cascade,
  primary key (programme_id, competency_code)
);

-- Department priority inputs (impact × strategic) per competency per cycle
create table if not exists tna_priority_inputs (
  cycle_id        bigint not null references tna_cycles(id) on delete cascade,
  competency_code text   not null references tna_competencies(code) on update cascade,
  impact          smallint not null default 2,
  strategic       smallint not null default 2,
  primary key (cycle_id, competency_code),
  constraint tna_pi_ck check (impact between 1 and 3 and strategic between 1 and 3)
);

-- ---------------------------------------------------------------------
-- 10. Sesi latihan & rekod kehadiran / bukti
-- ---------------------------------------------------------------------
create table if not exists tna_sessions (
  id              bigserial primary key,
  programme_id    bigint not null references tna_programmes(id) on delete cascade,
  session_date    date not null,
  venue_ms        text,
  participants_count int,
  notes_ms        text,
  drive_folder_id text,
  drive_url       text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

-- A staff member's training (planned from a gap, or recorded by the staff /
-- RMCQ after the fact — hospital programme or external course)
create table if not exists tna_training_records (
  id              bigserial primary key,
  assignment_id   bigint not null references tna_assignments(id) on delete cascade,
  programme_id    bigint references tna_programmes(id),
  session_id      bigint references tna_sessions(id),
  external_title_ms text,                         -- kursus luar
  competency_code text references tna_competencies(code) on update cascade,
  course_date     date,
  hours           numeric(5,1),
  status          text not null default 'planned', -- planned | attended | verified | rejected
  source          text not null default 'portal',  -- portal | staff_link
  created_at      timestamptz not null default now(),
  constraint tna_tr_status_ck check (status in ('planned','attended','verified','rejected')),
  constraint tna_tr_source_ck check (source in ('portal','staff_link')),
  constraint tna_tr_what_ck   check (programme_id is not null or external_title_ms is not null)
);

create table if not exists tna_evidence (
  id              bigserial primary key,
  training_record_id bigint references tna_training_records(id) on delete cascade,
  session_id      bigint references tna_sessions(id) on delete cascade,
  kind            text not null default 'certificate', -- certificate | attendance | slides | photo | other
  file_name       text not null,
  drive_file_id   text not null,
  drive_url       text not null,
  status          text not null default 'received', -- received | verified | rejected
  verified_by     uuid,
  verified_at     timestamptz,
  reject_reason   text,
  uploaded_via    text not null default 'portal',   -- portal | staff_link
  uploaded_at     timestamptz not null default now(),
  constraint tna_ev_owner_ck  check (training_record_id is not null or session_id is not null),
  constraint tna_ev_kind_ck   check (kind in ('certificate','attendance','slides','photo','other')),
  constraint tna_ev_status_ck check (status in ('received','verified','rejected'))
);

-- ---------------------------------------------------------------------
-- 11. Log audit
-- ---------------------------------------------------------------------
create table if not exists tna_audit_log (
  id          bigserial primary key,
  table_name  text not null,
  row_key     text not null,
  action      text not null,                      -- insert | update | delete
  old_row     jsonb,
  new_row     jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists tna_audit_table_idx on tna_audit_log (table_name, row_key);

-- Failed link verifications (lock a token after 5 failures in 15 minutes)
create table if not exists tna_link_attempts (
  token_hash  text not null,
  attempted_at timestamptz not null default now(),
  success     bool not null
);
create index if not exists tna_link_attempts_idx on tna_link_attempts (token_hash, attempted_at);

-- =====================================================================
-- Views — gap and priority (computed, never stored)
-- =====================================================================
create or replace view tna_v_gap with (security_invoker = true) as
select a.cycle_id, a.id as assignment_id, a.staff_id, a.position_id, p.unit_code,
       r.competency_code, r.required_level,
       i.self_level, i.agreed_level, coalesce(i.never_exposed,false) as never_exposed,
       case when a.status = 'validated' and i.agreed_level is not null
            then greatest(0, r.required_level - i.agreed_level) end as gap
from tna_assignments a
join tna_positions p              on p.id = a.position_id
join tna_position_requirements r  on r.position_id = p.id
left join tna_assessment_items i  on i.assignment_id = a.id and i.competency_code = r.competency_code
where a.status <> 'archived';

create or replace view tna_v_competency_priority with (security_invoker = true) as
with g as (
  select cycle_id, competency_code,
         count(*)                                   as staff_required,
         count(gap)                                 as staff_validated,
         count(*) filter (where gap > 0)            as staff_with_gap,
         coalesce(sum(gap),0)                       as gap_points,
         count(*) filter (where gap > 0 and never_exposed) as staff_never_exposed
  from tna_v_gap group by cycle_id, competency_code
)
select g.*, coalesce(pi.impact,2) as impact, coalesce(pi.strategic,2) as strategic,
       case when g.staff_validated = 0 then null
            when g.gap_points >= 4 or g.staff_with_gap >= 3 then 3
            when g.gap_points >= 2 or g.staff_with_gap >= 2 then 2
            when g.staff_with_gap >= 1 then 1 else 0 end as gap_score
       -- app rule: if staff_never_exposed > 0, gap_score is raised by 1 (max 3)
       -- and the plan lists an introductory session before the regular course
from g left join tna_priority_inputs pi
  on pi.cycle_id = g.cycle_id and pi.competency_code = g.competency_code;
-- Keutamaan label (Tinggi ≥18 · Sederhana 9–17 · Rendah 1–8 · Tiada jurang 0)
-- is derived in the app from gap_score × impact × strategic, same rule as the Excel.

-- =====================================================================
-- Staff-link RPCs (anon). The link carries the raw token; the staff types
-- their staff number. Every call re-verifies both — no anon table access.
-- All return jsonb {ok, error, message} so the UI can show the real error code.
-- =====================================================================
-- NOTE: failures are RETURNED (not raised) so the attempt row is committed
-- and the 5-failures lockout actually works (a raise would roll it back).
create or replace function tna_link_resolve(p_token text, p_staff_no text)
returns jsonb  -- {"ok":true,"id":…} | {"ok":false,"error":"…","message":"…"}
language plpgsql security definer set search_path = public as $$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  v_fail int;
  v_id   bigint;
begin
  select count(*) into v_fail from tna_link_attempts
   where token_hash = v_hash and not success and attempted_at > now() - interval '15 minutes';
  if v_fail >= 5 then
    return jsonb_build_object('ok',false,'error','LINK_LOCKED',
      'message','Terlalu banyak cubaan. Cuba semula selepas 15 minit atau hubungi RMCQ.');
  end if;

  select a.id into v_id
  from tna_assignments a
  join tna_staff  s on s.id = a.staff_id
  join tna_cycles c on c.id = a.cycle_id
  where a.token_hash = v_hash and not a.token_revoked
    and a.status <> 'archived' and s.status = 'active'
    and c.status = 'open'
    and s.staff_no = trim(p_staff_no);

  insert into tna_link_attempts (token_hash, success) values (v_hash, v_id is not null);

  if v_id is null then
    return jsonb_build_object('ok',false,'error','STAFF_NO_MISMATCH',
      'message','No. staf tidak sepadan dengan link ini, atau link telah tamat / dibatalkan.');
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

-- Profile + required competencies + level indicators + saved answers
create or replace function tna_link_get(p_token text, p_staff_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r jsonb := tna_link_resolve(p_token, p_staff_no); v_id bigint;
begin
  if not (v_r ->> 'ok')::bool then return v_r; end if;
  v_id := (v_r ->> 'id')::bigint;
  return (
    select jsonb_build_object('ok', true,
      'assignment', jsonb_build_object('id', a.id, 'status', a.status, 'submitted_at', a.submitted_at),
      'staff',      jsonb_build_object('name', s.name),
      'position',   jsonb_build_object('title', p.title_ms, 'grade', p.grade_sspa, 'grade_level', p.grade_level, 'unit', u.name_ms),
      'items', (
        select jsonb_agg(jsonb_build_object(
          'code', c.code, 'layer', c.layer, 'cluster', c.cluster, 'name', c.name_ms, 'definition', c.definition_ms,
          'required', r.required_level, 'training', c.default_training_ms,
          'levels', (select jsonb_agg(jsonb_build_object('level', l.level, 'indicator', l.indicator_ms) order by l.level)
                     from tna_competency_levels l where l.competency_code = c.code),
          'self_level', i.self_level, 'self_note', i.self_note, 'never_exposed', coalesce(i.never_exposed,false),
          'agreed_level', case when a.status = 'validated' then i.agreed_level end)
          order by c.layer desc, c.sort_order)
        from tna_position_requirements r
        join tna_competencies c on c.code = r.competency_code
        left join tna_assessment_items i on i.assignment_id = a.id and i.competency_code = c.code
        where r.position_id = a.position_id))
    from tna_assignments a
    join tna_staff s     on s.id = a.staff_id
    join tna_positions p on p.id = a.position_id
    join tna_units u     on u.code = p.unit_code
    where a.id = v_id);
end $$;

-- Save draft answers: p_items = [{"code":"R07","level":1,"note":"...","never":true}]
create or replace function tna_link_save(p_token text, p_staff_no text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r jsonb := tna_link_resolve(p_token, p_staff_no); v_id bigint; v_status text;
begin
  if not (v_r ->> 'ok')::bool then return v_r; end if;
  v_id := (v_r ->> 'id')::bigint;
  select status into v_status from tna_assignments where id = v_id;
  if v_status in ('submitted','validated') then
    return jsonb_build_object('ok',false,'error','ALREADY_SUBMITTED',
      'message','Penilaian telah dihantar dan dikunci. Hubungi Ketua Jabatan untuk dibuka semula.');
  end if;
  insert into tna_assessment_items (assignment_id, competency_code, self_level, self_note, never_exposed, updated_at)
  select v_id, x.code, x.level, x.note, coalesce(x.never,false) and x.level = 1, now()
  from jsonb_to_recordset(p_items) as x(code text, level smallint, note text, never bool)
  join tna_assignments a on a.id = v_id
  join tna_position_requirements r on r.position_id = a.position_id and r.competency_code = x.code -- required only
  where x.level between 1 and 5
  on conflict (assignment_id, competency_code)
  do update set self_level = excluded.self_level, self_note = excluded.self_note,
                never_exposed = excluded.never_exposed, updated_at = now();
  update tna_assignments set status = 'draft' where id = v_id and status = 'not_started';
  return jsonb_build_object('ok',true);
end $$;

create or replace function tna_link_submit(p_token text, p_staff_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r jsonb := tna_link_resolve(p_token, p_staff_no); v_id bigint; v_missing int; v_ts timestamptz := now();
begin
  if not (v_r ->> 'ok')::bool then return v_r; end if;
  v_id := (v_r ->> 'id')::bigint;
  select count(*) into v_missing
  from tna_assignments a
  join tna_position_requirements r on r.position_id = a.position_id
  left join tna_assessment_items i on i.assignment_id = a.id and i.competency_code = r.competency_code
  where a.id = v_id and i.self_level is null;
  if v_missing > 0 then
    return jsonb_build_object('ok',false,'error','INCOMPLETE','message', v_missing || ' kompetensi belum dijawab.');
  end if;
  update tna_assignments set status = 'submitted', submitted_at = v_ts
   where id = v_id and status in ('not_started','draft');
  -- seed agreed_level = self_level so the Ketua Jabatan starts from the staff's view
  update tna_assessment_items set agreed_level = self_level
   where assignment_id = v_id and agreed_level is null;
  -- Decision Q7: the Ketua Jabatan's own self-assessment counts as validated
  update tna_assignments a set status = 'validated', validated_at = v_ts
    from tna_positions p
   where a.id = v_id and p.id = a.position_id and p.role_type = 'KJ';
  return jsonb_build_object('ok',true,'submitted_at',v_ts);
end $$;

grant execute on function tna_link_get(text,text), tna_link_save(text,text,jsonb), tna_link_submit(text,text)
  to anon, authenticated;
revoke execute on function tna_link_resolve(text,text) from public, anon, authenticated;

-- =====================================================================
-- Row Level Security  (decision Q6, 8 Okt: module follows portal access)
--   anon          : nothing directly — only via the tna_link_* RPCs above.
--   authenticated : any signed-in portal user may read/write tna_* (same
--                   model as the VMO module). Validation is done by the
--                   Ketua Jabatan through the portal UI.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tna_cycles','tna_competencies','tna_competency_levels','tna_units','tna_positions',
    'tna_position_requirements','tna_staff','tna_assignments','tna_assessment_items','tna_issues','tna_programmes',
    'tna_programme_competencies','tna_priority_inputs','tna_sessions','tna_training_records','tna_evidence',
    'tna_audit_log','tna_link_attempts']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (true) with check (true)', t || '_portal_all', t);
  end loop;
end $$;
-- The audit log is append-only in practice: written by trigger; no UI edits it.

-- =====================================================================
-- Audit trigger — programmes, requirements, competencies, levels, staff
-- =====================================================================
create or replace function tna_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into tna_audit_log (table_name, row_key, action, old_row, new_row, changed_by)
  values (tg_table_name,
          coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'),
                   (to_jsonb(new) ->> 'code'), (to_jsonb(old) ->> 'code'),
                   concat_ws('|', to_jsonb(coalesce(new,old)) ->> 'position_id', to_jsonb(coalesce(new,old)) ->> 'competency_code', to_jsonb(coalesce(new,old)) ->> 'level')),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

revoke execute on function tna_audit() from public, anon, authenticated;

create trigger tna_audit_programmes   after insert or update or delete on tna_programmes            for each row execute function tna_audit();
create trigger tna_audit_requirements after insert or update or delete on tna_position_requirements for each row execute function tna_audit();
create trigger tna_audit_competencies after insert or update or delete on tna_competencies          for each row execute function tna_audit();
create trigger tna_audit_levels       after insert or update or delete on tna_competency_levels     for each row execute function tna_audit();
create trigger tna_audit_staff        after insert or update or delete on tna_staff                 for each row execute function tna_audit();

commit;
