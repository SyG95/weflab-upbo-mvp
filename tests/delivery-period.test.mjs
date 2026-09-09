import {
  BUCKET_CURRENT,
  BUCKET_ETC,
  bucketLabel,
  cutoffBoundaryMs,
  isValidCutoffDate,
  orderBucketIds,
  resolveBucketId,
  sameDeliveryPeriodConfig,
  sanitizeDeliveryPeriodConfig,
} from "../lib/deliveryPeriod.ts";

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// KST 시각 문자열 → ms (테스트 입력 헬퍼). 밀리초까지 지정 가능.
const kst = (text) => Date.parse(`${text}+09:00`);

// ── 날짜 검증: 형식·실제 달력 ──
assertEq(isValidCutoffDate("2026-08-31"), true, "정상 날짜");
assertEq(isValidCutoffDate("2026-02-31"), false, "달력에 없는 날짜(2/31) 거부");
assertEq(isValidCutoffDate("2026-8-31"), false, "형식 불량(0 패딩 없음) 거부");
assertEq(isValidCutoffDate("이상한값"), false, "문자열 거부");

// ── 반개구간 경계: 마감일 다음날 0시(KST) exclusive ──
const aug31 = cutoffBoundaryMs("2026-08-31");
assertEq(aug31, kst("2026-09-01T00:00:00"), "8/31 마감선 상한 = 9/1 0시(KST)");
assertEq(cutoffBoundaryMs("2026-02-31"), null, "불량 날짜 경계 = null");

// ── monthly: KST 연월 귀속(반개구간 — 밀리초 기록도 흘리지 않음) ──
const monthly = { mode: "monthly", cutoffs: [] };
assertEq(resolveBucketId(monthly, kst("2026-08-31T23:59:59.500"), "donate"), "m:2026-08", "8/31 23:59:59.5 → 8월");
assertEq(resolveBucketId(monthly, kst("2026-09-01T00:00:00.000"), "donate"), "m:2026-09", "9/1 0시 정각 → 9월");
assertEq(resolveBucketId(monthly, kst("2026-01-01T00:00:00"), "donate"), "m:2026-01", "연초 KST 경계");
// UTC 로는 전년 12/31 15:00 인 시각 — KST 연월로 잡혀야 한다.
assertEq(resolveBucketId(monthly, Date.parse("2025-12-31T15:00:00Z"), "donate"), "m:2026-01", "UTC 섣달그믐=KST 1/1");

// ── custom: 마감선 사이 구간 귀속 ──
const custom = {
  mode: "custom",
  cutoffs: [{ date: "2026-07-15", name: "여름 이벤트분" }, { date: "2026-08-31" }],
};
assertEq(resolveBucketId(custom, kst("2026-06-20T12:00:00"), "donate"), "c:2026-07-15", "첫 마감선 이전 → 첫 묶음");
assertEq(resolveBucketId(custom, kst("2026-07-15T23:59:59.999"), "donate"), "c:2026-07-15", "마감일 그날 끝까지 포함");
assertEq(resolveBucketId(custom, kst("2026-07-16T00:00:00"), "donate"), "c:2026-08-31", "마감 다음날 0시 → 다음 묶음");
assertEq(resolveBucketId(custom, kst("2026-09-01T00:00:00"), "donate"), BUCKET_CURRENT, "마지막 마감선 이후 → 진행 중");

// ── 기타 묶음: 시각 없음·후원 원문 시각이 아닌 조각(교환=교환 시각, 수동·반영=기록 시각) ──
assertEq(resolveBucketId(monthly, null, "donate"), BUCKET_ETC, "시각 없음 → 기타");
assertEq(resolveBucketId(monthly, kst("2026-08-05T12:00:00"), "exchange"), BUCKET_ETC, "교환 조각 → 기타");
assertEq(resolveBucketId(monthly, kst("2026-08-05T12:00:00"), "manual"), BUCKET_ETC, "수동 조각 → 기타");
assertEq(resolveBucketId(monthly, kst("2026-08-05T12:00:00"), "created"), BUCKET_ETC, "반영 폴백 조각 → 기타");
assertEq(resolveBucketId(monthly, kst("2026-08-05T12:00:00"), null), BUCKET_ETC, "종류 없음 → 기타");

// ── none 모드: 묶음 UI 자체가 없으므로 빈 id ──
assertEq(resolveBucketId({ mode: "none", cutoffs: [] }, kst("2026-08-05T12:00:00"), "donate"), "", "none → 빈 id");

// ── 라벨 ──
const now2026 = kst("2026-09-03T12:00:00");
assertEq(bucketLabel("m:2026-08", monthly, now2026), "8월분", "올해 월 라벨");
assertEq(bucketLabel("m:2025-12", monthly, now2026), "2025년 12월분", "지난해 월 라벨(연도 병기)");
assertEq(bucketLabel("c:2026-07-15", custom, now2026), "여름 이벤트분", "이름 지정 마감선 라벨");
assertEq(bucketLabel("c:2026-08-31", custom, now2026), "~8/31분", "이름 없는 마감선 자동 라벨");
assertEq(
  bucketLabel("c:2025-12-31", { mode: "custom", cutoffs: [{ date: "2025-12-31" }] }, now2026),
  "2025년 ~12/31분",
  "지난해 마감선 라벨(연도 병기 — 월별과 동일 규칙)",
);
assertEq(bucketLabel(BUCKET_CURRENT, custom, now2026), "진행 중", "진행 중 라벨");
assertEq(bucketLabel(BUCKET_ETC, custom, now2026), "기타", "기타 라벨");

// ── 칩 순서: 기간 오래된 순 → 진행 중 → 기타 ──
assertEq(
  orderBucketIds(["etc", "current", "m:2026-09", "m:2026-07", "m:2026-08"]),
  ["m:2026-07", "m:2026-08", "m:2026-09", BUCKET_CURRENT, BUCKET_ETC],
  "월별 칩 순서",
);
assertEq(
  orderBucketIds(["current", "c:2026-08-31", "c:2026-07-15"]),
  ["c:2026-07-15", "c:2026-08-31", BUCKET_CURRENT],
  "마감선 칩 순서",
);

// ── sanitize: 불량 모드·불량 날짜·중복 제거, 정렬, 이름 상한 ──
assertEq(
  sanitizeDeliveryPeriodConfig({
    mode: "custom",
    cutoffs: [
      { date: "2026-08-31" },
      { date: "2026-07-15", name: "  여름 이벤트분  " },
      { date: "2026-08-31" },
      { date: "2026-02-31" },
      { date: 20260831 },
      "이상한값",
    ],
  }),
  { mode: "custom", cutoffs: [{ date: "2026-07-15", name: "여름 이벤트분" }, { date: "2026-08-31" }] },
  "sanitize: 중복·불량 제거+오름차순 정렬+이름 트림",
);
assertEq(
  sanitizeDeliveryPeriodConfig({ mode: "이상한모드", cutoffs: [] }),
  { mode: "none", cutoffs: [] },
  "sanitize: 불량 모드 → none",
);
assertEq(sanitizeDeliveryPeriodConfig(null), { mode: "none", cutoffs: [] }, "sanitize: null → 기본값");
{
  const longName = "가".repeat(100);
  const out = sanitizeDeliveryPeriodConfig({ mode: "custom", cutoffs: [{ date: "2026-08-31", name: longName }] });
  assertEq(out.cutoffs[0].name.length, 40, "sanitize: 이름 길이 상한 40");
}
{
  // 마감선 개수 상한(60): 61개 넣으면 60개만 남고, "정렬 후" 상한이라 항상 이른 날짜부터 살아남는다
  // (입력 순서로 자르면 초과분이 임의로 탈락 — 리뷰 지적 사항의 회귀 테스트).
  const uniq = [];
  for (let m = 1; m <= 3; m += 1)
    for (let d = 1; d <= 28 && uniq.length < 61; d += 1)
      uniq.push({ date: `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
  uniq.reverse(); // 늦은 날짜가 입력 앞에 오게 뒤집어도
  const out = sanitizeDeliveryPeriodConfig({ mode: "custom", cutoffs: uniq });
  assertEq(out.cutoffs.length, 60, "sanitize: 마감선 개수 상한 60");
  assertEq(out.cutoffs[0].date, "2026-01-01", "sanitize: 상한은 정렬 후 적용 — 가장 이른 날짜 생존");
  assertEq(out.cutoffs[59].date, "2026-03-04", "sanitize: 가장 늦은 날짜(3/5)만 탈락");
}

// ── 설정 비교 ──
assertEq(sameDeliveryPeriodConfig(custom, sanitizeDeliveryPeriodConfig(custom)), true, "동일 설정 비교 true");
assertEq(
  sameDeliveryPeriodConfig(custom, { mode: "custom", cutoffs: [{ date: "2026-07-15" }, { date: "2026-08-31" }] }),
  false,
  "이름 다르면 false",
);

console.log("delivery-period: all tests passed");
