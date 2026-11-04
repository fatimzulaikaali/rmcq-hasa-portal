-- TNA 08: hospital management 18-column template (applied as migration tna_08_mgmt_template)
alter table public.tna_dept_template
  add column if not exists goal_ms text,
  add column if not exists objective_ms text,
  add column if not exists mgmt_kpi_ms text;
alter table public.tna_priority_inputs
  add column if not exists dept_current_level smallint check (dept_current_level between 1 and 5),
  add column if not exists mgmt_priority text check (mgmt_priority in ('High','Moderate','Low'));
alter table public.tna_course_requests
  add column if not exists training_type text check (training_type in ('dalaman','luaran'));
-- Data loaded 2026-11-04: RMCQ goal, objectives 1–5 and KPIs per unit row; initial mgmt_priority suggestions per competency.
