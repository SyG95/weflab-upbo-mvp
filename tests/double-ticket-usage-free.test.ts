// 두배권 × 사용여부 분리 테스트(sy 2026-10-01 결정: 두배권 적용은 "두배권 맞음" 확정만 보고, 사용 안 함은 보지 않는다).
// 핵심 보장: ① 사용 안 함 칸이어도 확정 두배권이면 부여(ignore+grant) → 같은 시청자 다음 결과 ×2
//           ② 사용 안 함 + 미확정은 기존처럼 검토함(needs_review), 부여 없음
//           ③ 사용 중 + 확정은 기존과 100% 동일(회귀 고정)
//           ④ 규칙 off(옛 배치 재현)는 도입 전 판정(사용 안 함 확정 칸 = 검토함) 그대로
//           ⑤ judgeRules 스냅샷: 없으면 false, 있으면 그대로 / 후보 목록은 꺼진 칸도 올리고 itemEnabled 로 표시
import {
  buildBatchSummary,
  buildSpecialItemRuleCandidates,
  normalizeName,
  readJudgeRules,
  reconcileResults,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type SpecialItemRule,
} from "../lib/upboCore";

let passed = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

function item(itemName: string, probability: number, enabled = true, amount = 500): NormalizedCatalogItem {
  return {
    groupIndex: 0,
    amountMin: amount,
    amountMax: amount,
    amountRangeLabel: String(amount),
    enabled,
    doubleEnabled: false,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    sortOrder: 0,
    raw: null,
  };
}
function result(uid: string, itemName: string, probability: number, time: string, key: string): NormalizedResult {
  return {
    sourceUid: uid,
    rowIndex: 0,
    donateTimeText: time,
    donationType: "별풍선",
    donationAmount: 500,
    donationAmountText: "500개",
    fanNickname: `팬${uid}`,
    fanId: uid,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    rawText: "",
    rouletteIndex: 0,
    rouletteTotal: 1,
    raw: null,
    sourceKey: key,
  };
}

const THRESHOLD = 17;
const confirmed: SpecialItemRule = { ruleKey: "500::다음룰렛2배::5", ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2 };
const catalogOff = [item("다음 룰렛 2배", 5, false), item("베이직 꾸폰", 10), item("꽝", 60)];
const catalogOn = [item("다음 룰렛 2배", 5, true), item("베이직 꾸폰", 10), item("꽝", 60)];
const twoSpins = [
  result("fan1", "다음 룰렛 2배", 5, "2026-09-28 20:00:00", "k1"),
  result("fan1", "베이직 꾸폰", 10, "2026-09-28 20:01:00", "k2"),
];

// ① 사용 안 함 + 확정 → 부여, 다음 결과 ×2 (꾸야 9/3~9/30 사고 재현 → 새 규칙으로 복구)
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, [confirmed]);
  assertEq(rules.map((r) => [r.status, r.itemEnabled]), [["confirmed", false]], "꺼진 두배권 칸도 후보에 확정 상태로 올라온다");
  const r = reconcileResults({ catalogItems: catalogOff, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules });
  assertEq(r.decisions.map((d) => d.decision), ["ignore", "record"], "두배권=ignore(부여), 다음 결과=record");
  assertEq([r.decisions[0].modifierAction, r.decisions[0].catalogItem?.itemName], ["grant", "다음 룰렛 2배"], "꺼진 칸이어도 grant + 칸 정보 유지");
  assertEq([r.decisions[1].multiplier, r.decisions[1].effectiveCount], [2, 2], "다음 결과 ×2");
  assertEq([r.summary.modifierCount, r.summary.multiplierAppliedCount, r.summary.needsReviewCount], [1, 1, 0], "요약: 감지 1·적용 1·검토함 0");
  assertEq(Object.keys(r.modifierState.pendingByViewer ?? {}), [], "대기 두배권은 소진됨");
}

// ② 사용 안 함 + 미확정 → 검토함, 부여 없음(기존 동일)
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, []);
  assertEq(rules.map((r) => r.status), ["candidate"], "미확정 후보");
  const r = reconcileResults({ catalogItems: catalogOff, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules });
  assertEq(r.decisions.map((d) => d.decision), ["needs_review", "record"], "미확정 꺼진 칸은 검토함");
  assertEq([r.decisions[1].effectiveCount, r.summary.modifierCount], [1, 0], "부여 없음");
}

// ③ 사용 중 + 확정 → 기존과 동일(회귀 고정): 규칙 on/off 결과가 같다
{
  const rules = buildSpecialItemRuleCandidates(catalogOn, [confirmed]);
  const on = reconcileResults({ catalogItems: catalogOn, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules });
  const off = reconcileResults({ catalogItems: catalogOn, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules, modifierIgnoresUsage: false });
  assertEq(on.decisions.map((d) => [d.decision, d.effectiveCount]), [["ignore", 0], ["record", 2]], "사용 중 확정: 부여·×2");
  assertEq(off.decisions.map((d) => [d.decision, d.effectiveCount]), on.decisions.map((d) => [d.decision, d.effectiveCount]), "사용 중 칸은 규칙 on/off 동일");
  assertEq(off.summary, on.summary, "요약도 동일");
}

// ④ 규칙 off(옛 배치 재현) → 꺼진 확정 칸은 도입 전처럼 검토함
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, [confirmed]);
  const r = reconcileResults({ catalogItems: catalogOff, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules, modifierIgnoresUsage: false });
  assertEq(r.decisions.map((d) => [d.decision, d.effectiveCount]), [["needs_review", 0], ["record", 1]], "규칙 off = 옛 판정(검토함·×1)");
  assertEq(r.summary.modifierCount, 0, "규칙 off 감지 0");
}

// ⑤ judgeRules 스냅샷
{
  assertEq(readJudgeRules({}), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "스냅샷 없음 → 둘 다 false");
  assertEq(readJudgeRules({ judgeRules: { missionSettlementIgnore: true } }), { missionSettlementIgnore: true, modifierIgnoresUsage: false }, "옛 스냅샷(키 없음) → false");
  const built = buildBatchSummary({ recordCount: 1 }, {}, { missionSettlementIgnore: true, modifierIgnoresUsage: true });
  assertEq(readJudgeRules(built), { missionSettlementIgnore: true, modifierIgnoresUsage: true }, "새 스냅샷 왕복");
  const rules = buildSpecialItemRuleCandidates([item("다음 룰렛 2배", 5, true), item("다음 룰렛 2배", 3, false, 990)], []);
  assertEq(rules.map((r) => [r.amountRangeLabel, r.itemEnabled]), [["500", true], ["990", false]], "후보는 사용 중/안 함 모두, itemEnabled 로 구분");
}

console.log(`double-ticket-usage-free: ${passed} assertions passed`);
