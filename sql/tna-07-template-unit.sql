-- TNA 07: which template row (unit) concludes each competency's gaps (applied as migration tna_07_template_unit)
alter table public.tna_competencies add column if not exists template_unit text references public.tna_units(code);
update public.tna_competencies set template_unit = case
  when unit_code is not null then unit_code
  when code = 'R01' then 'RK-IKP'
  when code = 'R02' then 'RO'
  when code in ('R03','R04','R28','R30') then 'JKKD'
  when code in ('R31','R32') then 'RK-AK'
  when code in ('R26','R29') then 'PK'
  else 'KJ' end
where template_unit is null;
