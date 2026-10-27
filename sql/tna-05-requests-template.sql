-- TNA 05: staff course requests (line-by-line) + department template rows (8-column hospital template)
-- Applied as migration tna_05_requests_template.

create table if not exists public.tna_course_requests (
  id bigserial primary key,
  assignment_id bigint not null references public.tna_assignments(id) on delete cascade,
  sort_order int not null default 0,
  title_ms text not null check (length(trim(title_ms)) > 0),
  provider_ms text,
  competency_code text references public.tna_competencies(code) on update cascade,
  reason_ms text,
  preferred_month smallint check (preferred_month between 1 and 12),
  est_cost_rm numeric(10,2) check (est_cost_rm >= 0),
  priority text check (priority in ('Tinggi','Sederhana','Rendah')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tna_course_requests_asg on public.tna_course_requests(assignment_id);
alter table public.tna_course_requests enable row level security;
create policy tna_course_requests_portal_all on public.tna_course_requests for all to authenticated using (true) with check (true);

create table if not exists public.tna_dept_template (
  id bigserial primary key,
  cycle_id bigint not null references public.tna_cycles(id) on delete cascade,
  sort_order int not null default 0,
  unit_code text references public.tna_units(code),
  item_ms text not null,
  indicator_ms text,
  kpi_ms text,
  weight_ms text,
  activities_ms text,
  initial_training_ms text,
  updated_at timestamptz not null default now()
);
alter table public.tna_dept_template enable row level security;
create policy tna_dept_template_portal_all on public.tna_dept_template for all to authenticated using (true) with check (true);

insert into public.tna_dept_template (cycle_id, sort_order, unit_code, item_ms, indicator_ms, kpi_ms, weight_ms, activities_ms, initial_training_ms)
select * from (values
((select id from tna_cycles where year=2027),1,'RO',$q$Unit Risiko Operasi
(Bahagian Pengurusan Risiko)$q$,$q$Daya tahan organisasi melalui pengurusan risiko operasi dan Pengurusan Kesinambungan Perkhidmatan (BCM) yang berkesan.$q$,$q$• 100% jabatan kritikal melengkapkan dan menyemak semula Business Impact Analysis (BIA), Penilaian Risiko dan Pelan Kesinambungan Perkhidmatan setiap tahun.
• Sekurang-kurangnya 1 latihan tabletop dan simulasi BCM merentas fungsi setahun.
• ≥90% jabatan melengkapkan semakan daftar risiko tahunan, dengan ≥80% tindakan mitigasi dilaksanakan dalam tempoh dipersetujui.
• Sekurang-kurangnya 1 orang staf unit mengikuti latihan ISO 31000 / ISO 22301 pada tahun semasa.$q$,$q$Pemberat: 20%
Kuantiti (30%) – Bilangan jabatan melengkapkan BIA / daftar risiko; bilangan latihan simulasi; bilangan staf unit dilatih.
Kualiti (40%) – ≥80% tindakan mitigasi dilaksanakan; laporan penilaian latihan simulasi dan tindakan penambahbaikan.
Masa (30%) – Pekeliling & templat dikeluarkan pada S1; semakan pertengahan tahun; sesi semakan risiko tahunan mengikut jadual.$q$,$q$• Mengeluarkan pekeliling, templat dan tarikh akhir penghantaran pada S1.
• Melantik risk champion setiap jabatan.
• Mengesahkan setiap daftar risiko yang dihantar; semakan pertengahan tahun tindakan mitigasi.
• Sesi semakan risiko tahunan; eskalasi tindakan tertunggak ke MRM.
• Menganjurkan latihan tabletop & simulasi BCM; melaporkan status kesiapsiagaan BCM.
• Audit risiko & BCM; analisa laporan risiko.
• Urus setia JK Pemilik Risiko, JK Pengurusan BCM, JK Teknikal Pengurusan Risiko.$q$,$q$• Kursus ISO 31000 Certified Risk Manager.
• Kursus ISO 22301 Lead Implementer / Lead Auditor.
• Bengkel BIA & Exercise Design.
• Kursus Risk-Based Auditing.
• Latihan Excel / Power BI untuk pelaporan risiko.$q$),
((select id from tna_cycles where year=2027),2,'RK-IKP',$q$Unit Risiko Klinikal —
Pengurusan Insiden & Keselamatan Pesakit$q$,$q$Keberkesanan pengurusan insiden dan pembelajaran daripada kejadian tidak diingini untuk meningkatkan keselamatan pesakit.$q$,$q$• ≥70% pelan tindakan RCA dilaksanakan bagi semua insiden keselamatan pesakit yang mengakibatkan kemudaratan teruk atau kematian dalam tahun semasa.
• ≥80% peserta program latihan keselamatan pesakit menunjukkan peningkatan pengetahuan / kompetensi melalui ujian pra & pasca.
• Sekurang-kurangnya 2 orang staf unit mengikuti latihan RCA lanjutan / Human Factors pada tahun semasa.$q$,$q$Pemberat: 20%
Kuantiti (30%) – Bilangan RCA dilaksanakan; bilangan program latihan dan peserta; bilangan staf unit dilatih.
Kualiti (40%) – Peratus pelan tindakan RCA dilaksanakan; peratus peserta menunjukkan peningkatan skor pra-pasca.
Masa (30%) – RCA dan pelan tindakan disiapkan dalam tempoh ditetapkan.$q$,$q$• Melaksanakan RCA bagi semua insiden kemudaratan teruk & sentinel.
• Memantau pelaksanaan tindakan pembetulan; menyemak trend & kadar berulang.
• Berkongsi lessons learnt di peringkat hospital.
• Program latihan IR, RCA, MPSG & IPSG berstruktur dengan ujian pra & pasca.
• Tadbir urus klinikal & keselamatan pesakit.
• Urus setia JK Keselamatan Pesakit & JK Pemandu Insiden Keselamatan Pesakit.$q$,$q$• Kursus RCA Facilitator (lanjutan).
• Kursus Human Factors in Healthcare.
• Kursus Patient Safety Officer.
• Train-the-Trainer & Training Evaluation (Kirkpatrick).
• Bengkel Just Culture.$q$),
((select id from tna_cycles where year=2027),3,'RK-AK',$q$Unit Risiko Klinikal —
Pengurusan Amalan Klinikal$q$,$q$Kakitangan klinikal dikredensial dan diberi privilej sewajarnya, dan kes morbiditi & mortaliti disemak untuk penambahbaikan amalan klinikal.$q$,$q$• ≥60% kes kematian disemak melalui mesyuarat M&M dalam tempoh 30 hari bagi mengenal pasti faktor yang boleh dicegah.
• ≥80% staf klinikal baharu menghantar permohonan Credentialing & Privileging (C&P) sebelum melapor diri di HASA.
• Semua staf unit dilatih dalam proses C&P dan metodologi semakan kematian.$q$,$q$Pemberat: 20%
Kuantiti (30%) – Bilangan kes kematian disemak; bilangan permohonan C&P diterima sebelum lapor diri; bilangan staf unit dilatih.
Kualiti (40%) – Faktor boleh dicegah dikenal pasti dan tindakan penambahbaikan dilaksanakan; kelengkapan permohonan C&P.
Masa (30%) – Semakan M&M dalam 30 hari; permohonan C&P sebelum tarikh lapor diri.$q$,$q$• Memaklumkan keperluan C&P semasa proses pengambilan.
• Memantau status permohonan sebelum onboarding; susulan permohonan tidak lengkap.
• Melaporkan pematuhan kepada jawatankuasa berkaitan.
• Mesyuarat M&M berkala dengan garis masa semakan kes; memantau penyiapan semakan dan tindakan penambahbaikan.
• Penyelaras latihan berkaitan C&P.
• Urus setia JK C&P HASA, JK Teknikal C&P HASA & JK M&M.$q$,$q$• Kursus Credentialing & Privileging.
• Bengkel Structured Judgement Review (Mortality Review).
• Bengkel Fasilitasi M&M.
• Latihan Pengurusan Pangkalan Data.
• Kursus Kesetiausahaan & Penulisan Minit Mesyuarat.$q$),
((select id from tna_cycles where year=2027),4,'JKKD',$q$Unit Jaminan Kualiti & Kawalan Dokumen
(Bahagian Pematuhan & Kualiti)$q$,$q$Pematuhan berterusan terhadap akreditasi MSQH dan pencapaian KPI hospital, serta kawalan dokumen hospital yang berkesan.$q$,$q$• ≥85% pencapaian KPI jabatan dan hospital (termasuk HPIA & KHUAM).
• 100% mock survey MSQH, audit dalaman dan aktiviti tracer dilaksanakan mengikut pelan tahunan.
• 100% dokumen dan borang rasmi hospital dikawal melalui OpenKM.
• Semua staf unit mengikuti latihan standard MSQH 7th Edition dan OpenKM.$q$,$q$Pemberat: 20%
Kuantiti (30%) – Bilangan KPI dipantau; bilangan mock survey / audit / tracer dilaksanakan; bilangan staf unit dilatih.
Kualiti (40%) – Peratus pencapaian KPI; tindakan pembetulan dilaksanakan; dokumen mematuhi format & kawalan versi.
Masa (30%) – Pemantauan KPI bulanan; aktiviti audit mengikut jadual pelan tahunan.$q$,$q$• Memantau prestasi KPI bulanan; analisis varians; tindakan pembetulan bagi KPI tidak capai; laporan kepada pengurusan.
• Jadual audit & tracer tahunan; penilaian pematuhan; status kesediaan akreditasi.
• Pengurusan audit luaran dan akreditasi / pensijilan.
• Kawalan dokumen & borang rasmi hospital; sistem OpenKM.
• Latihan berkaitan akreditasi, KPI, HPIA, dokumen & OpenKM.
• Urus setia JK Pemandu MSQH, JK Teknikal MSQH & JK Teknikal Kualiti KHUAM.$q$,$q$• Kursus MSQH 7th Edition Standards.
• Kursus Internal Auditor (ISO 9001) & Tracer Methodology.
• Bengkel Indicator Management & Data Validation.
• Latihan Pentadbir OpenKM.
• Latihan Data Visualisation (Excel / Power BI).$q$),
((select id from tna_cycles where year=2027),5,'PK',$q$Unit Peningkatan Kualiti
(Bahagian Pematuhan & Kualiti)$q$,$q$Penambahbaikan kualiti berterusan di seluruh hospital.$q$,$q$• Sekurang-kurangnya 4 projek Quality Improvement (QI) dilaksanakan setahun, dengan ≥80% mencapai objektif.
• Penyertaan projek di peringkat AKNC / KIK / OE UiTM.
• Sekurang-kurangnya 1 orang staf unit mencapai Lean Six Sigma Green Belt atau fasilitator KIK bertauliah.$q$,$q$Pemberat: 15%
Kuantiti (30%) – Bilangan projek QI; bilangan penyertaan anugerah; bilangan staf unit bertauliah.
Kualiti (40%) – Peratus projek mencapai objektif; hasil penilaian projek.
Masa (30%) – Projek disiapkan mengikut garis masa.$q$,$q$• Mengenal pasti peluang penambahbaikan melalui analisis data.
• Mengaplikasi PDCA, Lean, Six Sigma atau metodologi QI lain; memantau kemajuan projek.
• Berkongsi amalan terbaik merentas jabatan.
• Audit klinikal; KIK; AKNC; MKSP; Operational Excellence; Lean Healthcare; QA/QI.
• Urus setia JK Penyelaras KIK UiTM, JK AKNC & JK OE peringkat UiTM.$q$,$q$• Lean Six Sigma Green Belt.
• Kursus Fasilitator KIK.
• Kursus Clinical Audit.
• Kursus Operational Excellence / Lean Healthcare.
• Bengkel Penulisan & Pembentangan Anugerah Kualiti.$q$),
((select id from tna_cycles where year=2027),6,'KJ',$q$Pengurusan Jabatan
(Ketua Jabatan)$q$,$q$Keberkesanan pengurusan jabatan dan pembangunan kapasiti staf RMCQ.$q$,$q$• 100% staf RMCQ mempunyai Pelan Pembangunan Individu (IDP) dan mencapai sasaran hari latihan tahunan.
• 100% staf baharu bagi jawatan kosong menjalani program orientasi berasaskan profil kompetensi jawatan.
• Sekurang-kurangnya 50% pegawai RMCQ menjadi fasilitator latihan di peringkat hospital.$q$,$q$Pemberat: 5%
Kuantiti (30%) – Bilangan staf dengan IDP; bilangan staf mencapai hari latihan; bilangan fasilitator.
Kualiti (40%) – IDP dinilai; skor penilaian sesi latihan oleh peserta.
Masa (30%) – IDP disiapkan pada S1; orientasi dalam bulan pertama lapor diri.$q$,$q$• Penyediaan IDP bagi setiap staf.
• Pemantauan rekod latihan staf.
• Program orientasi & mentor dalaman.
• Mesyuarat Kajian Semula Pengurusan (MKSP).$q$,$q$• Kursus Leadership & Change Management.
• Kursus Train-the-Trainer.
• Kursus Data Analytics.$q$)
) v(cycle_id, sort_order, unit_code, item_ms, indicator_ms, kpi_ms, weight_ms, activities_ms, initial_training_ms)
where not exists (select 1 from public.tna_dept_template);

-- Staff link: save the full list of course requests (replaces the previous list). Max 10 rows.
create or replace function public.tna_link_save_requests(p_token text, p_staff_no text, p_requests jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_r jsonb := tna_link_resolve(p_token, p_staff_no); v_id bigint; v_status text; v_pos bigint; v_n int;
begin
  if not (v_r ->> 'ok')::bool then return v_r; end if;
  v_id := (v_r ->> 'id')::bigint;
  select status, position_id into v_status, v_pos from tna_assignments where id = v_id;
  if v_status in ('submitted','validated') then
    return jsonb_build_object('ok',false,'error','ALREADY_SUBMITTED','message','Penilaian telah dihantar dan dikunci. Hubungi Ketua Jabatan untuk dibuka semula.');
  end if;
  v_n := coalesce(jsonb_array_length(p_requests), 0);
  if v_n > 10 then
    return jsonb_build_object('ok',false,'error','TOO_MANY','message','Maksimum 10 kursus bagi setiap staf.');
  end if;
  delete from tna_course_requests where assignment_id = v_id;
  insert into tna_course_requests (assignment_id, sort_order, title_ms, provider_ms, competency_code, reason_ms, preferred_month, est_cost_rm, priority)
  select v_id, x.ord::int,
         left(trim(x.r->>'title'), 300),
         nullif(left(trim(coalesce(x.r->>'provider','')), 200), ''),
         (select r.competency_code from tna_position_requirements r where r.position_id = v_pos and r.competency_code = x.r->>'competency'),
         nullif(left(trim(coalesce(x.r->>'reason','')), 1000), ''),
         case when (x.r->>'month') ~ '^([1-9]|1[0-2])$' then (x.r->>'month')::smallint end,
         case when (x.r->>'cost') ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then (x.r->>'cost')::numeric end,
         case when x.r->>'priority' in ('Tinggi','Sederhana','Rendah') then x.r->>'priority' end
  from jsonb_array_elements(coalesce(p_requests,'[]'::jsonb)) with ordinality as x(r, ord)
  where length(trim(coalesce(x.r->>'title',''))) > 0;
  update tna_assignments set status = 'draft' where id = v_id and status = 'not_started';
  return jsonb_build_object('ok',true);
end $function$;
revoke all on function public.tna_link_save_requests(text,text,jsonb) from public;
grant execute on function public.tna_link_save_requests(text,text,jsonb) to anon, authenticated;

-- Staff link payload now also returns the staff's course requests.
create or replace function public.tna_link_get(p_token text, p_staff_no text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_r jsonb := tna_link_resolve(p_token, p_staff_no); v_id bigint;
begin
  if not (v_r ->> 'ok')::bool then return v_r; end if;
  v_id := (v_r ->> 'id')::bigint;
  return (
    select jsonb_build_object('ok', true,
      'assignment', jsonb_build_object('id', a.id, 'status', a.status, 'submitted_at', a.submitted_at),
      'staff', jsonb_build_object('name', s.name),
      'position', jsonb_build_object('title', p.title_ms, 'grade', p.grade_sspa, 'grade_level', p.grade_level, 'unit', u.name_ms),
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
        where r.position_id = a.position_id),
      'requests', coalesce((
        select jsonb_agg(jsonb_build_object('title', q.title_ms, 'provider', q.provider_ms, 'competency', q.competency_code,
          'reason', q.reason_ms, 'month', q.preferred_month, 'cost', q.est_cost_rm, 'priority', q.priority) order by q.sort_order)
        from tna_course_requests q where q.assignment_id = a.id), '[]'::jsonb))
    from tna_assignments a
    join tna_staff s on s.id = a.staff_id
    join tna_positions p on p.id = a.position_id
    join tna_units u on u.code = p.unit_code
    where a.id = v_id);
end $function$;
