select jsonb_build_object(
 'writes_frozen',exists(select 1 from pg_trigger where tgrelid='public.upbo_alpha_audit_logs'::regclass and tgname='upbo_alpha_freeze_wardrobe' and tgenabled in ('O','A')),
 'version_guard',exists(select 1 from pg_trigger where tgrelid='public.upbo_alpha_audit_logs'::regclass and tgname='upbo_alpha_guard_wardrobe_version' and tgenabled in ('O','A')),
 'save_rpc',to_regprocedure('public.upbo_alpha_save_wardrobe(uuid,uuid,jsonb)') is not null,
 'v2_snapshots', (select count(*) from public.upbo_alpha_audit_logs where action='wardrobe_updated' and payload->'wardrobe'->>'schemaVersion'='2')) as recovery_status;
