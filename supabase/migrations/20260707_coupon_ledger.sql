-- 쿠폰 장부 (1단계 수동 MVP) — 업보(배송 대상)와 별개로 시청자별로 쌓이는 지불 수단.
-- 설계: 잔액(balances) + 변경이력(events, append-only). 월 개념 없음(다 쓸 때까지 귀속).
-- 기존 테이블·로직 무변경(순수 추가). 쿠폰 "종류" 정의는 audit_logs(action=coupon_items_updated)에
-- 스트리머별 최신 1건으로 저장하므로 여기서 테이블을 만들지 않는다.
-- 적용: sy가 Supabase 대시보드 SQL Editor에서 실행(서비스키로는 DDL 불가).

-- 1. 현재 잔액: 시청자 × 쿠폰 종류당 1행
CREATE TABLE IF NOT EXISTS upbo_alpha_coupon_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_id uuid NOT NULL REFERENCES upbo_alpha_streamers(id) ON DELETE CASCADE,
  -- 시청자 식별: 계정ID 우선, 없으면 닉네임(운영 레이어 holdingOwnerKey 규약과 동일)
  viewer_key text NOT NULL,
  nickname text,
  account_id text,
  item_key text NOT NULL,   -- 쿠폰 종류 키(스트리머가 정의, audit_logs 참조)
  item_name text NOT NULL,  -- 표시명 스냅샷(종류 이름이 바뀌어도 과거 표기는 남게)
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  note text,
  -- 팬 공개는 다음 단계 — 지금은 관리자만. 켤 때 스키마 변경 없이 읽기 필터만 추가.
  public_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (streamer_id, viewer_key, item_key)
);

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_coupon_balances_streamer
  ON upbo_alpha_coupon_balances(streamer_id, viewer_key);

-- 2. 변경 이력: 모든 지급/사용/조정을 1건씩 추가 기록(수정·삭제 없음)
CREATE TABLE IF NOT EXISTS upbo_alpha_coupon_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streamer_id uuid NOT NULL REFERENCES upbo_alpha_streamers(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  nickname text,
  item_key text NOT NULL,
  item_name text NOT NULL,
  delta integer NOT NULL,            -- +N(지급) / -N(사용) / set이면 next-previous
  action_type text NOT NULL CHECK (action_type IN ('grant', 'use', 'adjust', 'set')),
  previous_count integer NOT NULL,   -- 감사용 스냅샷
  next_count integer NOT NULL,
  note text,
  created_by text NOT NULL DEFAULT 'streamer_admin',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_coupon_events_streamer_time
  ON upbo_alpha_coupon_events(streamer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upbo_alpha_coupon_events_viewer
  ON upbo_alpha_coupon_events(streamer_id, viewer_key, item_key);

-- 3. RLS: 앱은 service_role(우회)만 쓰므로 켜두면 anon 접근이 차단된다(안전 기본값).
ALTER TABLE upbo_alpha_coupon_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE upbo_alpha_coupon_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE upbo_alpha_coupon_balances IS
  'Coupon ledger current balances (viewer x coupon type). Balance is the fold of coupon_events.';
COMMENT ON TABLE upbo_alpha_coupon_events IS
  'Append-only coupon change log (grant/use/adjust/set). Do not UPDATE or DELETE rows.';
