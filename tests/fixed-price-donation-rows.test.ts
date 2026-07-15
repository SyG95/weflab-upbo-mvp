import { buildFixedPriceCandidates, donationRowsFromCapture } from "../lib/upboSupabase";
import type { ResultCapture } from "../lib/upboCore";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 순수 후원(룰렛 결과 없음, results:[]) — 원래 로직이면 통째로 누락되던 케이스.
const capture: ResultCapture = {
  rows: [
    // 룰렛 안 돌린 큰 후원 (정가 대상)
    { sourceUid: "u1", donateTimeText: "07-06 12:00", donationType: "별풍선", donationAmount: 700, fanNickname: "팬A", fanId: "aaa", results: [] },
    // 룰렛 돌린 후원 (results 있음) — donationAmount는 행 레벨에 존재
    { sourceUid: "u2", donateTimeText: "07-06 12:01", donationType: "별풍선", donationAmount: 330, fanNickname: "팬B", fanId: "bbb", results: [{ rawText: "꽝", index: 0, total: 1 }] },
    // 구독형 큰 후원 → 정가 제외 대상
    { sourceUid: "u3", donateTimeText: "07-06 12:02", donationType: "구독", donationAmount: 1452, fanNickname: "팬C", fanId: "ccc", results: [] },
    // 금액 없는 행 → 무시
    { sourceUid: "u4", donateTimeText: "07-06 12:03", donationType: "채팅", fanNickname: "팬D", fanId: "ddd", results: [] },
  ],
} as unknown as ResultCapture;

// 1) donationRowsFromCapture: 금액 있는 행만, results 유무와 무관하게 전부 뽑는다.
const rows = donationRowsFromCapture(capture);
assertEq(rows.map((r) => r.donationAmount), [700, 330, 1452], "금액 있는 행 3개 추출(results 유무 무관)");

// 2) 핵심: 순수 후원(700, results 없음)이 정가로 잡힌다.
const counts = [700, 1452, 3352];
const cands = buildFixedPriceCandidates(rows, counts);
assertEq(
  cands.map((c) => c.sourceKey).sort(),
  ["fixed:aaa:07-06 12:00:700"],
  "순수 대형 후원(700)만 정가 후보로 잡힘(구독 1452는 제외)",
);

// 3) 회귀: 정가 미설정이면 후보 0개(기존과 동일).
assertEq(buildFixedPriceCandidates(rows, []), [], "정가 미설정이면 후보 없음");

// 4) snake_case 필드도 파싱된다(과거 캡처 호환).
const snake = { rows: [{ donation_amount: 5828, donation_type: "별풍선", fan_nickname: "팬E", fan_id: "eee", donate_time_text: "07-06 13:00", results: [] }] } as unknown as ResultCapture;
assertEq(donationRowsFromCapture(snake).map((r) => r.donationAmount), [5828], "snake_case donation_amount 파싱");

console.log("fixed-price donation rows: 4개 통과");
