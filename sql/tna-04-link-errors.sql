-- TNA: clearer link errors (applied to Supabase as migration tna_02_link_resolve_errors, 2026-10-09)
-- LINK_INVALID (token unknown/revoked) · STAFF_NO_MISMATCH · CYCLE_NOT_OPEN (draft/closed; correct staff no. is not counted as a failed attempt)
create or replace function public.tna_link_resolve(p_token text, p_staff_no text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  v_fail int; v_id bigint; v_staff_no text; v_cycle text; v_close date;
begin
  select count(*) into v_fail from tna_link_attempts
   where token_hash = v_hash and not success and attempted_at > now() - interval '15 minutes';
  if v_fail >= 5 then
    return jsonb_build_object('ok',false,'error','LINK_LOCKED','message','Terlalu banyak cubaan. Cuba semula selepas 15 minit atau hubungi RMCQ.');
  end if;
  select a.id, s.staff_no, c.status, c.close_date into v_id, v_staff_no, v_cycle, v_close
  from tna_assignments a join tna_staff s on s.id = a.staff_id join tna_cycles c on c.id = a.cycle_id
  where a.token_hash = v_hash and not a.token_revoked and a.status <> 'archived' and s.status = 'active';
  if v_id is null then
    insert into tna_link_attempts (token_hash, success) values (v_hash, false);
    return jsonb_build_object('ok',false,'error','LINK_INVALID','message','Link ini tidak sah atau telah dibatalkan. Minta link baharu daripada RMCQ.');
  end if;
  if v_staff_no <> trim(coalesce(p_staff_no,'')) then
    insert into tna_link_attempts (token_hash, success) values (v_hash, false);
    return jsonb_build_object('ok',false,'error','STAFF_NO_MISMATCH','message','No. staf tidak sepadan dengan link ini. Semak semula No. Staf anda.');
  end if;
  insert into tna_link_attempts (token_hash, success) values (v_hash, true);
  if v_cycle <> 'open' then
    return jsonb_build_object('ok',false,'error','CYCLE_NOT_OPEN','message',
      case when v_cycle = 'closed' then 'Kitaran TNA telah ditutup' || coalesce(' pada ' || to_char(v_close,'DD/MM/YYYY'),'') || '. Hubungi RMCQ jika perlu.'
           else 'Penilaian TNA belum dibuka. Anda akan dimaklumkan apabila kitaran dibuka.' end);
  end if;
  return jsonb_build_object('ok',true,'id',v_id);
end $function$;
revoke all on function public.tna_link_resolve(text,text) from public, anon, authenticated;
