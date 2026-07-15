-- Upbo Beta Vercel + Supabase Private Alpha schema with upbo_alpha_ table prefix for existing Supabase projects.
-- Apply this in the Supabase SQL Editor for the Upbo Beta project.
-- Do not paste service_role keys into client/browser code.

create extension if not exists pgcrypto;

create table if not exists upbo_alpha_streamers (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  display_name text not null,
  threshold_percent numeric not null default 2 check (threshold_percent >= 0 and threshold_percent <= 100),
  site_title text,
  sheet_name text,
  poster_image_url text,
  accent_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists upbo_alpha_streamer_tokens (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  token_hash text unique not null,
  role text not null check (role in ('extension_write', 'admin')),
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists upbo_alpha_catalogs (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  version integer not null,
  display_name text,
  amount_set_label text,
  source_url text,
  captured_at timestamptz,
  group_count integer,
  item_count integer,
  probability_sums jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  groups jsonb not null,
  items jsonb not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique(streamer_id, version)
);

create table if not exists upbo_alpha_import_batches (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  catalog_version integer not null,
  threshold_percent numeric not null,
  source_url text,
  captured_at timestamptz,
  applied_at timestamptz not null default now(),
  summary jsonb not null,
  entry_count integer not null default 0
);

create table if not exists upbo_alpha_upbo_entries (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  source_key text not null,
  batch_id uuid references upbo_alpha_import_batches(id) on delete set null,
  catalog_version integer,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'hidden')),
  fan_nickname text,
  fan_id text,
  item_name text not null,
  probability numeric,
  donate_time_text text,
  donation_type text,
  donation_amount integer,
  donation_amount_text text,
  catalog_group_index integer,
  amount_range_label text,
  roulette_index integer,
  roulette_total integer,
  raw_text text,
  public_note text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(streamer_id, source_key)
);

create table if not exists upbo_alpha_raw_imports (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  type text not null check (type in ('catalog', 'results')),
  batch_id uuid references upbo_alpha_import_batches(id) on delete set null,
  catalog_version integer,
  captured_at timestamptz,
  saved_at timestamptz not null default now(),
  raw jsonb not null
);

create table if not exists upbo_alpha_audit_logs (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid references upbo_alpha_streamers(id) on delete cascade,
  action text not null,
  actor text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_upbo_alpha_catalogs_streamer_version on upbo_alpha_catalogs(streamer_id, version desc);
create index if not exists idx_upbo_alpha_import_batches_streamer_applied on upbo_alpha_import_batches(streamer_id, applied_at desc);
create index if not exists idx_upbo_alpha_upbo_entries_streamer_fan_id on upbo_alpha_upbo_entries(streamer_id, fan_id);
create index if not exists idx_upbo_alpha_upbo_entries_streamer_status on upbo_alpha_upbo_entries(streamer_id, status);
create index if not exists idx_upbo_alpha_raw_imports_streamer_saved on upbo_alpha_raw_imports(streamer_id, saved_at desc);
