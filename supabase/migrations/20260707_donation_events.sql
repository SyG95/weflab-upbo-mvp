-- 후원집계(donation counter) 전용 이벤트 테이블.
-- 업보 파이프라인(upbo_entries / 정가 / 배수)과 완전히 분리된 독립 레인이다.
-- 후원 1건 = 1행. 확장이 같은 행을 반복 전송해도 unique(streamer_id, dedup_key) upsert로 흡수한다.
-- dedup_key: 위플랩 행 고유번호(uid) 우선, 없으면 사람+시간+수량 폴백 (확장 content.js와 동일 규칙).
-- donate_time 은 donate_time_text("YYYY-MM-DD HH:MM:SS", 위플랩 서버 KST)를 +09:00 로 해석한 값.

-- 배포(UPBO_TABLE_PREFIX=upbo_alpha_) 용
create table if not exists upbo_alpha_donation_events (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references upbo_alpha_streamers(id) on delete cascade,
  dedup_key text not null,
  source_uid text,
  fan_id text,
  fan_nickname text,
  donation_type text,
  donation_amount integer,
  donation_amount_text text,
  donate_time_text text,
  donate_time timestamptz,
  has_roulette boolean not null default false,
  source_url text,
  collector_session_id text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique(streamer_id, dedup_key)
);

create index if not exists idx_upbo_alpha_donation_events_streamer_time on upbo_alpha_donation_events(streamer_id, donate_time desc);
create index if not exists idx_upbo_alpha_donation_events_streamer_fan on upbo_alpha_donation_events(streamer_id, fan_id);

-- 참고: 무프리픽스 테이블(donation_events)은 만들지 않는다.
-- 실서버는 UPBO_TABLE_PREFIX=upbo_alpha_ 만 사용하고, 무프리픽스 streamers 가 없는
-- 환경에서 위 FK 가 실패한다(2026-07-07 실행 오류로 확인). 무프리픽스 로컬 DB 를
-- 쓰게 되면 그때 20260628_vercel_supabase_alpha.sql 계열과 함께 별도 실행한다.
