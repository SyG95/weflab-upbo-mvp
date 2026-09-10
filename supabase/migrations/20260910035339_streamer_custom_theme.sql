-- Additive, opt-in palette. Existing preset IDs and saved data remain unchanged.
alter table public.upbo_alpha_streamers add column if not exists custom_theme jsonb;
alter table public.upbo_alpha_streamers add constraint upbo_alpha_custom_theme_object check (custom_theme is null or (jsonb_typeof(custom_theme)='object' and octet_length(custom_theme::text)<=1024));
