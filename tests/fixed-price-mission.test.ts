// 미션 후원 × 정가 매칭 테스트(buildFixedPriceCandidates).
// 핵심 보장: ① 미션 "성공 정산 뭉치"(대결/도전미션 별풍선 성공)는 갯수가 일치해도 정가 후보 제외(유령 차단)
//           ② 개인 미션 후원(타입에 "성공" 없음)은 기록 유지 — 한 사람이 정가 갯수를 통째로 쏘는 정당 구매
//           ③ 일반 별풍선·구독 규칙은 기존과 동일(회귀 고정)
import { buildFixedPriceCandidates, type FixedPriceSourceRow } from "../lib/upboSupabase";

let passed = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

function row(over: Partial<FixedPriceSourceRow>): FixedPriceSourceRow {
  return {
    fanId: "fan1", fanNickname: "펭귄", donateTimeText: "2026-08-24 20:00:00",
    donationType: "별풍선", donationAmount: 5555, donationAmountText: "5,555개", rawText: "",
    ...over,
  };
}
const COUNTS = [5555, 1111];

// ① 성공 정산 뭉치 제외(도전/대결, 계정 없이 미션명만 와도)
assertEq(
  buildFixedPriceCandidates([row({ donationType: "도전미션 별풍선 성공", fanId: "", fanNickname: "다뿌서버를 위한..💗" })], COUNTS).length,
  0, "도전미션 성공 뭉치 → 제외",
);
assertEq(
  buildFixedPriceCandidates([row({ donationType: "대결미션 별풍선 성공" })], COUNTS).length,
  0, "대결미션 성공 뭉치 → 제외(계정 있어도)",
);

// ② 개인 미션 후원은 유지
const personal = buildFixedPriceCandidates([row({ donationType: "도전미션 별풍선" })], COUNTS);
assertEq(personal.length, 1, "개인 도전미션 5555 → 정가 기록 유지");
assertEq(personal[0].donationType, "도전미션 별풍선", "후원 유형 보존(배지 판별용)");
assertEq(
  buildFixedPriceCandidates([row({ donationType: "도전미션 별풍선", donationAmount: 500 })], COUNTS).length,
  0, "정가 갯수와 다른 미션 후원 → 애초에 후보 아님",
);

// ③ 기존 규칙 회귀 고정
assertEq(buildFixedPriceCandidates([row({})], COUNTS).length, 1, "일반 별풍선 5555 → 기록");
assertEq(buildFixedPriceCandidates([row({ donationType: "구독" })], COUNTS).length, 0, "구독 → 제외(기존)");
assertEq(buildFixedPriceCandidates([row({ donationAmount: 7777 })], COUNTS).length, 0, "미등록 갯수 → 제외(기존)");
assertEq(
  buildFixedPriceCandidates([row({ fanId: "", fanNickname: "" })], COUNTS).length,
  0, "계정·닉네임 모두 없음 → 제외(기존)",
);

console.log(`fixed-price-mission: ${passed}개 통과`);
