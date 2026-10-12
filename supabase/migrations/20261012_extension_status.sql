-- 확프 하트비트 상태 테이블(수집 레인 1단계, 2026-10-12) — 스트리머당 1행 덮어쓰기(upsert).
--
-- ★적용: sy 가 Supabase 대시보드 SQL Editor 에서 직접 실행한다(서비스키로는 DDL 불가, 자동 적용 없음).
--   이 레포엔 자동 적용 경로가 없다(supabase/config.toml·CI 없음, 기존 마이그레이션도 전부 수동 적용).
--   실행 전에는 앱이 "확프 상태 없음"(회색)으로 동작하고
--   하트비트는 저장만 생략한다(설정 응답·수집은 정상). 운영 테이블은 UPBO_TABLE_PREFIX(=upbo_alpha_) 접두어.
-- 순수 추가: 새 테이블 1개. 기존 테이블·데이터·판정 로직 변경 0. idempotent(이미 있으면 아무 일도 안 함).
--
-- 쓰는 곳: POST /api/extension/heartbeat (확프 0.4.0+, 5분마다·시작·탭 복귀) → lib/upboSupabase.upsertExtensionStatus
-- 읽는 곳: /admin 목록 신호등, 스트리머 관리자 화면 상단 상태 줄.
-- 왜 audit_logs 가 아닌가: 5분×60명 = 하루 1.7만 행. 덮어쓰기 1행이면 스트리머 수(≈60행)로 고정된다.
-- 원격 스위치(되읽기 켜기/끄기 등)는 드물게 바뀌므로 audit_logs(action=extension_config_updated) 이벤트 — 여기 아님.
-- payload: 확프 본문을 서버가 허용 목록으로 정제한 것(lib/extensionStatus.normalizeHeartbeat). 닉네임·계정 등 개인정보 없음.
-- 스트리머 삭제 시 함께 삭제(on delete cascade, 다른 테이블과 같은 규칙).

create table if not exists upbo_alpha_extension_status (
  streamer_id uuid primary key references upbo_alpha_streamers(id) on delete cascade,
  updated_at timestamptz not null default now(),
  client_version text,
  payload jsonb not null default '{}'::jsonb
);

-- RLS: 앱은 service_role(우회)만 쓰므로 켜두면 anon 접근이 차단된다(쿠폰 장부 테이블과 같은 안전 기본값).
alter table upbo_alpha_extension_status enable row level security;

comment on table upbo_alpha_extension_status is
  'Latest extension heartbeat per streamer (upsert, one row each). Whitelisted payload, no personal data.';
