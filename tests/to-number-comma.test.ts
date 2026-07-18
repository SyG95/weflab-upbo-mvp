import { toNumber } from "../lib/upboCore";
import { buildFixedPriceCandidates, donationRowsFromCapture } from "../lib/upboSupabase";
import type { ResultCapture } from "../lib/upboCore";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 위플랩 천단위 쉼표 표기 — "1,487" 이 1.487 로 붕괴하던 실사고(파깡: 500만 기록) 재발 방지.
assertEq(toNumber("500"), 500, "쉼표 없음");
assertEq(toNumber("1,487"), 1487, "천단위 쉼표");
assertEq(toNumber("2,887"), 2887, "천단위 쉼표 2");
assertEq(toNumber("12,487"), 12487, "만 단위(쉼표 1개)");
assertEq(toNumber("1,234,567"), 1234567, "쉼표 2개");
assertEq(toNumber("1,487개"), 1487, "단위 접미사");
assertEq(toNumber(1487), 1487, "숫자 그대로");
assertEq(toNumber("0.7"), 0.7, "소수점 유지");
assertEq(toNumber("0,7"), 0.7, "쉼표 소수(비천단위)는 기존 동작 유지");
assertEq(toNumber(""), null, "빈 값");

// 정가 매칭까지 관통 확인: 쉼표 문자열 금액의 후원이 시그니처 갯수와 일치해야 한다.
const capture = {
  rows: [
    { sourceUid: "u1", donateTimeText: "07-18 21:00", donationType: "별풍선", donationAmount: "1,487", fanNickname: "팬A", fanId: "aaa", results: [] },
    { sourceUid: "u2", donateTimeText: "07-18 21:01", donationType: "별풍선", donationAmount: "500", fanNickname: "팬B", fanId: "bbb", results: [] },
  ],
} as unknown as ResultCapture;
const rows = donationRowsFromCapture(capture);
assertEq(rows.map((r) => r.donationAmount), [1487, 500], "캡처 행 금액 해석");
const candidates = buildFixedPriceCandidates(rows, [500, 1487, 2887, 5787, 12487]);
assertEq(candidates.length, 2, "정가 후보 2건(쉼표 금액 포함)");
assertEq(candidates.map((c) => c.donationAmount).sort(), [1487, 500].sort(), "정가 금액");

console.log("to-number-comma.test.ts OK");
