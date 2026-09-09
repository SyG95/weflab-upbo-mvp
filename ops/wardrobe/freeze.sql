-- Emergency operation, NOT part of normal deployment. Run as database owner.
-- Stops old and new wardrobe writers. Other audit actions remain enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
create or replace function public.upbo_alpha_freeze_wardrobe()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Wardrobe recovery: writes are temporarily paused' using errcode = '55000';
end;
$$;
revoke all on function public.upbo_alpha_freeze_wardrobe() from public, anon, authenticated;
grant execute on function public.upbo_alpha_freeze_wardrobe() to service_role;
drop trigger if exists upbo_alpha_freeze_wardrobe on public.upbo_alpha_audit_logs;
create trigger upbo_alpha_freeze_wardrobe before insert on public.upbo_alpha_audit_logs
for each row when (new.action = 'wardrobe_updated') execute function public.upbo_alpha_freeze_wardrobe();
commit;
