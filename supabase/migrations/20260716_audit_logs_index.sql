-- audit_logs 성능 색인
-- 배경: audit_logs는 스트리머 설정(팬 레이아웃/탭이름/상품색상/공개토글 등)을 저장하는
--       사실상 만능 오버레이 테이블로, 코드 전반에서 45회 이상
--       `streamer_id = X AND action = Y ORDER BY created_at DESC LIMIT 1` 패턴으로 조회된다.
--       그런데 이 테이블에는 인덱스가 하나도 없어서 매 조회가 전체 스캔이 되고,
--       데이터가 쌓일수록 모든 설정 읽기·페이지 로딩이 함께 느려진다.
--
-- 효과: 위 조회 패턴이 색인 조회로 바뀌어 팬/관리자 페이지 로딩이 빨라진다.
-- 위험: 낮음. 색인 '추가'는 데이터/스키마를 바꾸지 않는다. CONCURRENTLY로 생성해 테이블 잠금도 없다.
-- 실행: Supabase SQL Editor에서 아래 한 줄을 실행. (idempotent — 이미 있으면 아무 일도 안 함)
--
-- 주의: CREATE INDEX CONCURRENTLY 는 트랜잭션 블록 안에서 실행할 수 없다.
--       Supabase SQL Editor에 이 문장만 단독으로 붙여넣어 실행할 것.

-- 주의: 운영 테이블은 UPBO_TABLE_PREFIX(=upbo_alpha_) 접두어가 붙어 upbo_alpha_audit_logs 이다.
-- Supabase SQL Editor는 문장을 트랜잭션으로 감싸 CONCURRENTLY가 막힐 수 있어,
-- 테이블 규모가 작은 현재는 일반 CREATE INDEX로 실행한다(락 시간 무시할 수준).
create index if not exists idx_upbo_alpha_audit_logs_streamer_action_created
  on upbo_alpha_audit_logs (streamer_id, action, created_at desc);
