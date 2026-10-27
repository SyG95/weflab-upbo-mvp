// ---------- 스트리머별 시범 기능 스위치(1단계 묶음 3~5) — 순수 ----------
// audit_logs action "upbo_feature_flags" 최신 1건(전체 값을 한 줄로 다시 적는다). 기본은 전부 꺼짐이고 sy 가 /admin 에서 켠다.
// 팬 페이지 오버레이 목록(OVERLAY_LATEST_ACTIONS)·공개 /state 에는 넣지 않는다 — 관리자 화면·라우트만 읽는다.
//   asofRejudge        다시판정 "후원 그때 표로(근사)" 미리보기(묶음 3)
//   catalogDriftNotice 위플랩 룰렛표 바뀜 알림(묶음 5 — 아직 화면 없음)
export const FEATURE_FLAGS_ACTION = "upbo_feature_flags";

export type UpboFeatureFlags = { asofRejudge: boolean; catalogDriftNotice: boolean };

export const FEATURE_FLAGS_DEFAULT: UpboFeatureFlags = { asofRejudge: false, catalogDriftNotice: false };

// 모르는 키·참이 아닌 값은 버린다(엄격 === true — 문자열 "true" 도 꺼짐).
export function normalizeFeatureFlags(raw: unknown): UpboFeatureFlags {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { asofRejudge: obj.asofRejudge === true, catalogDriftNotice: obj.catalogDriftNotice === true };
}

export function mergeFeatureFlags(current: UpboFeatureFlags, patch: unknown): UpboFeatureFlags {
  const p = patch && typeof patch === "object" && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  return {
    asofRejudge: typeof p.asofRejudge === "boolean" ? p.asofRejudge : current.asofRejudge,
    catalogDriftNotice: typeof p.catalogDriftNotice === "boolean" ? p.catalogDriftNotice : current.catalogDriftNotice,
  };
}
