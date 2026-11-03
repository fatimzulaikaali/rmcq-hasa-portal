-- TNA 06: Ketua Jabatan decision per staff course request (applied as migrations tna_06_request_decision + tna_06b_requests_keep_decision)
alter table public.tna_course_requests
  add column if not exists kj_decision text check (kj_decision in ('masuk','tangguh','tidak')),
  add column if not exists kj_note text,
  add column if not exists decided_at timestamptz;
-- tna_link_save_requests now keeps kj_decision / kj_note / decided_at for courses re-saved with the same title after a reopen
-- (see function body in Supabase; created with CREATE OR REPLACE, grants unchanged).
