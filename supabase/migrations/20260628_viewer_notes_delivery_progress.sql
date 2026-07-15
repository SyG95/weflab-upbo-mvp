-- Upbo Beta operator notes + delivery progress.
-- Purpose:
-- 1) Keep automatic upbo counts in upbo_alpha_upbo_entries.
-- 2) Store streamer/operator 처리값 separately so new automatic entries increase total while processed counts remain stable.
-- 3) Store per-viewer private notes separately from public/automatic upbo rows.

create table if not exists upbo_alpha_viewer_notes (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  fan_id text not null,
  fan_nickname_snapshot text,
  note_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(streamer_id, fan_id)
);

create table if not exists upbo_alpha_delivery_progress (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  fan_id text not null,
  fan_nickname_snapshot text,
  item_key text not null,
  item_name text not null,
  probability numeric,
  amount_range_label text,
  processed_count integer not null default 0 check (processed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(streamer_id, fan_id, item_key)
);

create index if not exists idx_upbo_alpha_viewer_notes_streamer_fan on upbo_alpha_viewer_notes(streamer_id, fan_id);
create index if not exists idx_upbo_alpha_viewer_notes_streamer_updated on upbo_alpha_viewer_notes(streamer_id, updated_at desc);
create index if not exists idx_upbo_alpha_delivery_progress_streamer_fan on upbo_alpha_delivery_progress(streamer_id, fan_id);
create index if not exists idx_upbo_alpha_delivery_progress_streamer_updated on upbo_alpha_delivery_progress(streamer_id, updated_at desc);
