import { judgeFixedPeriod, isFixedPeriodExpired, fixedPeriodDaysLeft } from "../lib/fixedPricePeriod.ts";

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ── judgeFixedPeriod: 기간 없는 갯수(시그니처·구버전) = 항상 수집 ──
assertEq(judgeFixedPeriod({ count: 1000 }, "2026-08-09 12:00:00"), "in", "기간 없음 → 항상 in");
assertEq(judgeFixedPeriod({ count: 1000 }, ""), "in", "기간 없음 → 시각이 비어도 in(기존 판정과 동일)");
assertEq(judgeFixedPeriod({ count: 1000 }, "이상한값"), "in", "기간 없음 → 시각 해석 불가여도 in");

// ── 기간 안/밖 (KST 하루 경계: startAt 00:00:00 ~ endAt 23:59:59, 양끝 포함) ──
const ev = { count: 3000, startAt: "2026-08-01", endAt: "2026-08-12" };
assertEq(judgeFixedPeriod(ev, "2026-08-05 20:30:00"), "in", "기간 중간 → in");
assertEq(judgeFixedPeriod(ev, "2026-08-01 00:00:00"), "in", "시작일 자정 → in(양끝 포함)");
assertEq(judgeFixedPeriod(ev, "2026-08-12 23:59:59"), "in", "종료일 23:59:59 → in(양끝 포함)");
assertEq(judgeFixedPeriod(ev, "2026-07-31 23:59:59"), "out", "시작 전날 → out");
assertEq(judgeFixedPeriod(ev, "2026-08-13 00:00:00"), "out", "종료 다음날 자정 → out");

// ── 늦은 수집: 판정 기준은 수집 시각이 아니라 위플랩에 찍힌 후원 시각(sy 확정 ②) ──
// (이 함수는 후원 시각만 보므로, 기간이 끝난 뒤 수집을 돌려도 기간 안 후원이면 in 이 나온다)
assertEq(judgeFixedPeriod(ev, "2026-08-10 01:00:00"), "in", "만료 후 늦은 수집이어도 기간 안 후원 → in");

// ── 시작만/종료만 있는 반쪽 기간 ──
assertEq(judgeFixedPeriod({ count: 1, startAt: "2026-08-05" }, "2026-08-04 12:00"), "out", "시작만: 이전 → out");
assertEq(judgeFixedPeriod({ count: 1, startAt: "2026-08-05" }, "2026-08-06 12:00"), "in", "시작만: 이후 → in");
assertEq(judgeFixedPeriod({ count: 1, endAt: "2026-08-05" }, "2026-08-06 12:00"), "out", "종료만: 이후 → out");

// ── 해석 실패: 기간이 있으면 수집 제외 + 별도 표시(쿠폰 소급 선례) ──
assertEq(judgeFixedPeriod(ev, ""), "unparsed", "빈 시각 → unparsed");
assertEq(judgeFixedPeriod(ev, "07-06 12:00"), "unparsed", "연도 없는 시각 → unparsed");
assertEq(judgeFixedPeriod(ev, "3분 전"), "unparsed", "상대 시각 → unparsed");

// ── 2자리 연도(파서 허용 형식)도 동작 ──
assertEq(judgeFixedPeriod(ev, "26-08-05 10:00"), "in", "2자리 연도 → in");

// ── 잘못된 기간 형식은 기간 없음으로 취급(안전) ──
assertEq(judgeFixedPeriod({ count: 1, endAt: "2026/08/12" }, "이상한값"), "in", "기간 형식 오류 → 기간 없음 취급");

// ── isFixedPeriodExpired / fixedPeriodDaysLeft (now 주입) ──
const NOW = Date.parse("2026-08-09T12:00:00+09:00");
assertEq(isFixedPeriodExpired("2026-08-12", NOW), false, "종료 전 → 만료 아님");
assertEq(isFixedPeriodExpired("2026-08-08", NOW), true, "종료 지남 → 만료");
assertEq(isFixedPeriodExpired("2026-08-09", NOW), false, "종료 당일(23:59 전) → 만료 아님");
assertEq(isFixedPeriodExpired("", NOW), false, "기간 없음 → 만료 아님");
assertEq(fixedPeriodDaysLeft("2026-08-12", NOW), 4, "D-4");
assertEq(fixedPeriodDaysLeft("2026-08-09", NOW), 1, "종료 당일 → D-1(자정 전까지)");
assertEq(fixedPeriodDaysLeft("", NOW), null, "기간 없음 → null");

console.log("fixed-price-period: all tests passed");
