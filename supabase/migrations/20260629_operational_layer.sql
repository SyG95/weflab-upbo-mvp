-- Operational layer: 양도/교환/취소/완료/메모 이벤트 추적
-- 기존 테이블 데이터는 건드리지 않음 (nullable 컬럼 추가 + 신규 테이블 생성)

-- 1. upbo_entries에 운영 상태 컬럼 추가 (모두 nullable → 기존 row 영향 없음)
ALTER TABLE upbo_alpha_upbo_entries
  ADD COLUMN IF NOT EXISTS raw_import_id uuid REFERENCES upbo_alpha_raw_imports(id),
  ADD COLUMN IF NOT EXISTS current_owner_name text,
  ADD COLUMN IF NOT EXISTS current_owner_id text,
  ADD COLUMN IF NOT EXISTS current_item_name text,
  ADD COLUMN IF NOT EXISTS quantity_original integer,
  ADD COLUMN IF NOT EXISTS quantity_current integer;

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_entries_raw_import
  ON upbo_alpha_upbo_entries(raw_import_id);

-- 2. 운영 변경 이벤트 테이블 신규 생성
CREATE TABLE IF NOT EXISTS upbo_alpha_upbo_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upbo_entry_id uuid NOT NULL REFERENCES upbo_alpha_upbo_entries(id) ON DELETE CASCADE,
  streamer_id uuid NOT NULL REFERENCES upbo_alpha_streamers(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'created_from_source',
    'transfer',
    'exchange',
    'cancel',
    'void',
    'complete',
    'memo',
    'quantity_adjust',
    'status_change',
    'admin_adjustment'
  )),
  actor_type text NOT NULL DEFAULT 'operator' CHECK (actor_type IN (
    'streamer', 'operator', 'system', 'viewer'
  )),
  actor_id text,
  before_json jsonb,
  after_json jsonb,
  quantity_delta integer,
  reason text,
  memo text,
  approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN (
    'not_required', 'pending', 'approved', 'rejected'
  )),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_item_events_entry
  ON upbo_alpha_upbo_item_events(upbo_entry_id);

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_item_events_streamer_time
  ON upbo_alpha_upbo_item_events(streamer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_upbo_alpha_item_events_type
  ON upbo_alpha_upbo_item_events(event_type);

-- 3. raw_imports 불변 원본 정책 명시
COMMENT ON TABLE upbo_alpha_raw_imports IS
  'Immutable source captures from weflab. Do not UPDATE or DELETE rows. Operational changes belong in upbo_item_events.';

COMMENT ON TABLE upbo_alpha_upbo_item_events IS
  'Operational change log for upbo entries. Records transfer/exchange/cancel/complete/memo events with before/after state.';
