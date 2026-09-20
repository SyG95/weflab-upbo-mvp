// 배송관리 "묶음(기간) 보기" 판정 — 표시 전용 순수 모듈.
// 스트리머 설정(없음/월별/직접 마감선)에 따라 배송 시트의 조각 1건을 기간 묶음에 배정한다.
// 원칙(설계 확정 2026-09-03):
//  - 표시 전용: 장부(delivery_progress)·판정·원본에 어떤 영향도 주지 않는다.
//  - 완료 배분(allocateDeliveryToRefs)은 항상 전체 refs 로 먼저 계산하고, 이 모듈은 그 결과 행을
//    묶음으로 "거르기만" 한다 — 조각 부분집합으로 배분을 다시 돌리면 완료가 엉뚱한 묶음으로 이동한다.
//  - 반개구간: 경계 비교는 [시작, 다음 경계 0시) — 23:59:59 비교는 밀리초 기록을 흘린다.
//  - 후원 시각(donate, KST)과 스트리머가 적은 수동기록 날짜(manual_dated)만 기간 묶음에 넣는다.
//    옛 수동(manual)·교환·반영(created 폴백)·시각 없음 조각은 후원한 달을 모르거나 다른 시각
//    (교환 시각 등)이라 "기타" 묶음으로 분리한다(숨기지 않음).
// fixedPricePeriod.ts(정가 기간, sy 확정 2026-08-09)와 같은 KST 경계 축 — 순수 모듈 관례에 따라
// 레인 간 직접 import 없이 자급자족한다.

export type DeliveryPeriodMode = "none" | "monthly" | "custom";

// 마감선 1개: date(YYYY-MM-DD, KST)의 "그날 끝"까지가 이 묶음. name 은 표시용(식별자 아님).
export type DeliveryCutoff = { date: string; name?: string };

export type DeliveryPeriodConfig = {
  mode: DeliveryPeriodMode;
  // custom 모드에서만 판정에 쓰인다. 모드를 바꿔도 보존(다시 custom 으로 돌아오면 그대로).
  cutoffs: DeliveryCutoff[];
};

export const DELIVERY_PERIOD_DEFAULT: DeliveryPeriodConfig = { mode: "none", cutoffs: [] };

// 묶음 id: "m:YYYY-MM"(월별) / "c:YYYY-MM-DD"(마감선, 값=그 묶음의 마감일) /
// "current"(마지막 마감선 이후 진행 중) / "etc"(기타 — 시각 불확실·교환·수기).
export const BUCKET_CURRENT = "current";
export const BUCKET_ETC = "etc";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
export const MAX_CUTOFFS = 60;
export const MAX_CUTOFF_NAME_LEN = 40;

// 실제 달력에 있는 날짜인지(2026-02-31 같은 값 거부). Date.parse 는 이런 값을 밀어 올려 통과시킨다.
export function isValidCutoffDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 마감선의 상한 경계(exclusive): 마감일 다음날 0시(KST). ms < 경계 ⇒ 그 묶음.
// 시트 행 수천 × 마감선 수십 조합으로 반복 호출되므로 날짜 문자열별로 캐시한다
// (입력은 검증된 YYYY-MM-DD 유한 집합이라 캐시가 무한정 자라지 않는다).
const boundaryCache = new Map<string, number | null>();
export function cutoffBoundaryMs(date: string): number | null {
  const cached = boundaryCache.get(date);
  if (cached !== undefined) return cached;
  let boundary: number | null = null;
  if (isValidCutoffDate(date)) {
    const ms = Date.parse(`${date}T00:00:00+09:00`);
    boundary = Number.isNaN(ms) ? null : ms + DAY_MS;
  }
  if (boundaryCache.size < 10_000) boundaryCache.set(date, boundary);
  return boundary;
}

function kstYearMonth(ms: number): { year: number; month: number } {
  const d = new Date(ms + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// 설정 정화 — 서버 저장·클라이언트 편집 공용. 잘못된 모드→none, 날짜 불량·중복 마감선 제거,
// 오름차순 정렬, 이름 길이·개수 상한. (audit_logs 한 행이 무한정 부풀지 않게)
export function sanitizeDeliveryPeriodConfig(value: unknown): DeliveryPeriodConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DELIVERY_PERIOD_DEFAULT };
  const rec = value as Record<string, unknown>;
  const mode: DeliveryPeriodMode =
    rec.mode === "monthly" || rec.mode === "custom" ? rec.mode : "none";
  const seen = new Set<string>();
  const cutoffs: DeliveryCutoff[] = [];
  if (Array.isArray(rec.cutoffs)) {
    for (const raw of rec.cutoffs) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const c = raw as Record<string, unknown>;
      const date = typeof c.date === "string" ? c.date.trim() : "";
      if (!isValidCutoffDate(date) || seen.has(date)) continue;
      seen.add(date);
      const name = typeof c.name === "string" ? c.name.trim().slice(0, MAX_CUTOFF_NAME_LEN) : "";
      cutoffs.push(name ? { date, name } : { date });
    }
  }
  // 정렬을 상한보다 먼저 — 입력 순서로 자르면 상한 초과 시 살아남는 마감선이 임의가 된다(리뷰 지적).
  cutoffs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { mode, cutoffs: cutoffs.slice(0, MAX_CUTOFFS) };
}

// 조각 1건의 묶음 id. kind 는 배송 refs 의 recordedKind("donate"|"manual"|"manual_dated"|"exchange"|"created"|null).
// 기간에 들어가는 시각 = 위플랩 원문(donate) + 스트리머가 적은 수동기록 날짜(manual_dated). 옛 수동기록(manual,
// 시각=기록 생성 시각)은 그대로 기타 — 기존 기록의 의미가 조용히 바뀌지 않는다(sy 2026-09-20).
// mode==="none" 이면 호출부가 묶음 UI 자체를 그리지 않으므로 여기선 항상 "" 을 돌려준다.
export function resolveBucketId(
  config: DeliveryPeriodConfig,
  recordedAtMs: number | null | undefined,
  recordedKind: string | null | undefined,
): string {
  if (config.mode === "none") return "";
  // 후원 시각이 아닌 것(교환=교환 시각, 옛 수동·반영=기록 시각)은 기간 숫자를 오염시키지 않게 기타로.
  if (
    recordedAtMs === null ||
    recordedAtMs === undefined ||
    (recordedKind !== "donate" && recordedKind !== "manual_dated")
  ) {
    return BUCKET_ETC;
  }
  if (config.mode === "monthly") {
    const { year, month } = kstYearMonth(recordedAtMs);
    return `m:${year}-${String(month).padStart(2, "0")}`;
  }
  for (const cutoff of config.cutoffs) {
    const boundary = cutoffBoundaryMs(cutoff.date);
    if (boundary !== null && recordedAtMs < boundary) return `c:${cutoff.date}`;
  }
  return BUCKET_CURRENT;
}

// 묶음 표시 이름. 월별="8월분"(해가 다르면 "2025년 8월분"), 마감선=지정 이름 또는 "~8/31분",
// current="진행 중", etc="기타". nowMs 는 "올해" 판단용(테스트 주입 가능).
export function bucketLabel(
  bucketId: string,
  config: DeliveryPeriodConfig,
  nowMs: number = Date.now(),
): string {
  if (bucketId === BUCKET_ETC) return "기타";
  if (bucketId === BUCKET_CURRENT) return "진행 중";
  if (bucketId.startsWith("m:")) {
    const [y, m] = bucketId.slice(2).split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return bucketId;
    return y === kstYearMonth(nowMs).year ? `${m}월분` : `${y}년 ${m}월분`;
  }
  if (bucketId.startsWith("c:")) {
    const date = bucketId.slice(2);
    const named = config.cutoffs.find((c) => c.date === date)?.name;
    if (named) return named;
    const [y, m, d] = date.split("-").map(Number);
    if (!Number.isFinite(m) || !Number.isFinite(d)) return bucketId;
    // 월별 라벨과 같은 규칙: 올해가 아니면 연도를 병기해 해 넘김 혼동을 막는다.
    return y === kstYearMonth(nowMs).year ? `~${m}/${d}분` : `${y}년 ~${m}/${d}분`;
  }
  return bucketId;
}

// 칩 나열 순서: 기간 묶음 오래된 순 → 진행 중 → 기타. m:/c: 은 값이 날짜 문자열이라 사전순=시간순.
export function orderBucketIds(ids: Iterable<string>): string[] {
  const period: string[] = [];
  let hasCurrent = false;
  let hasEtc = false;
  for (const id of ids) {
    if (id === BUCKET_CURRENT) hasCurrent = true;
    else if (id === BUCKET_ETC) hasEtc = true;
    else if (id) period.push(id);
  }
  period.sort();
  if (hasCurrent) period.push(BUCKET_CURRENT);
  if (hasEtc) period.push(BUCKET_ETC);
  return period;
}

// 설정 두 벌이 같은가(저장 버튼 활성·변경 미리보기 필요 여부).
export function sameDeliveryPeriodConfig(a: DeliveryPeriodConfig, b: DeliveryPeriodConfig): boolean {
  if (a.mode !== b.mode) return false;
  if (a.cutoffs.length !== b.cutoffs.length) return false;
  for (let i = 0; i < a.cutoffs.length; i += 1) {
    if (a.cutoffs[i].date !== b.cutoffs[i].date) return false;
    if ((a.cutoffs[i].name ?? "") !== (b.cutoffs[i].name ?? "")) return false;
  }
  return true;
}
