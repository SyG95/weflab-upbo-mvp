-- Additive migration: existing wardrobe snapshots and assets are never rewritten.
-- Every writer uses a streamer row lock and compares the revision it read.
create or replace function public.upbo_alpha_save_wardrobe(
  p_streamer_id uuid, p_expected_revision uuid, p_state jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_previous uuid;
  v_created timestamptz;
  v_id uuid;
begin
  perform 1 from public.upbo_alpha_streamers where id = p_streamer_id for update;
  if not found then raise exception 'streamer not found'; end if;
  select id, created_at into v_previous, v_created
    from public.upbo_alpha_audit_logs
    where streamer_id = p_streamer_id and action = 'wardrobe_updated'
    order by created_at desc, id desc limit 1;
  if v_previous is distinct from p_expected_revision then
    return jsonb_build_object('conflict', true);
  end if;
  if jsonb_typeof(p_state->'items') is distinct from 'array'
     or jsonb_typeof(p_state->'themes') is distinct from 'array' then
    raise exception 'invalid wardrobe state';
  end if;
  insert into public.upbo_alpha_audit_logs(streamer_id, action, actor, payload, created_at)
    values (p_streamer_id, 'wardrobe_updated', 'wardrobe_admin', jsonb_build_object('wardrobe', p_state - 'revision'),
      greatest(clock_timestamp(), coalesce(v_created + interval '1 microsecond', clock_timestamp())))
    returning id into v_id;
  return jsonb_build_object('revision', v_id);
end;
$$;
revoke all on function public.upbo_alpha_save_wardrobe(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.upbo_alpha_save_wardrobe(uuid,uuid,jsonb) to service_role;

-- Old deployment requests may finish after promotion. Reject legacy snapshots
-- once this wardrobe contains v2 data, so delayed old writers cannot erase it.
create or replace function public.upbo_alpha_guard_wardrobe_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_version jsonb;
begin
  if new.action is distinct from 'wardrobe_updated' then return new; end if;
  perform 1 from public.upbo_alpha_streamers where id = new.streamer_id for update;
  select payload->'wardrobe'->'schemaVersion' into v_version
    from public.upbo_alpha_audit_logs
    where streamer_id = new.streamer_id and action = 'wardrobe_updated'
    order by created_at desc, id desc limit 1;
  if v_version = '2'::jsonb
     and (new.payload->'wardrobe'->'schemaVersion') is distinct from '2'::jsonb
     and new.actor is distinct from 'wardrobe_admin' then
    raise exception 'Wardrobe was upgraded. Refresh before saving.' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function public.upbo_alpha_guard_wardrobe_version() from public, anon, authenticated;
grant execute on function public.upbo_alpha_guard_wardrobe_version() to service_role;
drop trigger if exists upbo_alpha_guard_wardrobe_version on public.upbo_alpha_audit_logs;
create trigger upbo_alpha_guard_wardrobe_version
before insert on public.upbo_alpha_audit_logs for each row
when (new.action = 'wardrobe_updated') execute function public.upbo_alpha_guard_wardrobe_version();
