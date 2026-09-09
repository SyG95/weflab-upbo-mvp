-- Only after verifying data, assets, and the compatible application deployment.
-- Keep the normal version guard and CAS function installed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
drop trigger if exists upbo_alpha_freeze_wardrobe on public.upbo_alpha_audit_logs;
drop function if exists public.upbo_alpha_freeze_wardrobe();
commit;
