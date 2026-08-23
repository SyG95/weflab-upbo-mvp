// 룰렛표별 기준확률 예외 "표시·후보" 반영 테스트 — 판정은 threshold-overrides.test.ts 가 고정하고,
// 여기는 판정과 화면이 같은 값을 보게 하는 두 재료를 고정한다:
//   ① effectiveThresholdForLabel(배지·팬 확률표·교환/수동 후보의 단일 소스)이
//      판정 규칙(thresholdOverridePercent ?? 전역)과 동일한 값인지
//   ② 별칭 연결 힌트 wouldRecord 가 예외 기준으로 계산되는지
import {
  applyThresholdOverrides,
  effectiveThresholdForLabel,
  normalizeName,
  normalizeResultCapture,
  type NormalizedCatalogItem,
} from "../lib/upboCore";
import { buildAliasCandidates } from "../lib/itemAlias";

let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

function item(itemName: string, probability: number, amount = 300): NormalizedCatalogItem {
  return {
    groupIndex: 0, amountMin: amount, amountMax: amount, amountRangeLabel: String(amount),
    enabled: true, doubleEnabled: false, itemName, normalizedName: normalizeName(itemName),
    probability, sortOrder: 0, raw: null,
  };
}
function capture(uid: string, itemName: string, probability: number, amount = 300) {
  return {
    capturedAt: "2026-08-24T00:00:00.000Z",
    rows: [{
      sourceUid: uid, donateTimeText: "2026-08-24 16:45:29", donationType: "별풍선",
      donationAmount: amount, fanNickname: "흑설", fanId: "n11appless",
      results: [{ name: itemName, probability, index: 0, total: 1 }],
    }],
  };
}

// ── ① effectiveThresholdForLabel = 판정 규칙과 동일 ──────────────────────────
assertEq(effectiveThresholdForLabel({}, "300", 1.5), 1.5, "예외 없음 → 전역 기준");
assertEq(effectiveThresholdForLabel({ "300": 4.1 }, "300", 1.5), 4.1, "예외 있음 → 예외 기준");
assertEq(effectiveThresholdForLabel({ "300": 4.1 }, "145", 1.5), 1.5, "다른 라벨 예외는 무시");
assertEq(effectiveThresholdForLabel({ "300": 0 }, "300", 1.5), 0, "예외 0% 도 존중(?? 규칙)");
assertEq(effectiveThresholdForLabel({ "300": 4.1 }, "", 1.5), 1.5, "라벨 없음 → 전역 기준");
assertEq(effectiveThresholdForLabel({ "300": 4.1 }, undefined, 1.5), 1.5, "라벨 undefined → 전역 기준");

// 판정이 실제로 쓰는 값(thresholdOverridePercent ?? 전역)과 케이스별 일치 확인.
const stamped = applyThresholdOverrides([item("YUKATA", 4), item("와압", 35.6, 145)], { "300": 4.1 });
for (const it of stamped) {
  assertEq(
    it.thresholdOverridePercent ?? 1.5,
    effectiveThresholdForLabel({ "300": 4.1 }, it.amountRangeLabel, 1.5),
    `판정 값과 표시 값 일치(${it.itemName})`,
  );
}

// ── ② 별칭 힌트 wouldRecord — 예외 기준으로 계산 ─────────────────────────────
// 카탈로그: ✨ YUKATA 4% (300 룰렛). 결과: "YUKATA" (이모지 빠짐 → 추천 완전일치).
const catalogPlain = [item("✨ YUKATA", 4)];
const results = normalizeResultCapture(capture("u1", "YUKATA", 4)).results;

// 예외 없음(전역 1.5%): 4% 상품은 연결해도 기록 안 됨 → wouldRecord=false
const before = buildAliasCandidates({ results, catalogItems: catalogPlain, thresholdPercent: 1.5 });
assertEq(before.length, 1, "후보 1건");
assertEq(before[0].options[0].recommended, true, "이모지만 다른 이름 → 추천");
assertEq(before[0].wouldRecord, false, "예외 없으면 4% 는 기록 안 됨");

// 예외 300→4.1%: 같은 상황에서 wouldRecord=true
const catalogStamped = applyThresholdOverrides(catalogPlain, { "300": 4.1 });
const after = buildAliasCandidates({ results, catalogItems: catalogStamped, thresholdPercent: 1.5 });
assertEq(after[0].wouldRecord, true, "예외 4.1 이면 4% 도 기록됨");

// 다른 룰렛(145)의 예외는 영향 없음
const other = buildAliasCandidates({
  results,
  catalogItems: applyThresholdOverrides(catalogPlain, { "145": 4.1 }),
  thresholdPercent: 1.5,
});
assertEq(other[0].wouldRecord, false, "다른 룰렛 예외는 영향 없음");

console.log(`threshold-display: ${passed}개 통과`);
