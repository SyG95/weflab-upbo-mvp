// 두배권 × 사용여부 분리 테스트(sy 2026-10-01 결정: 두배권 적용은 "두배권 맞음" 확정만 보고, 사용 안 함은 보지 않는다).
// 핵심 보장: ① 사용 안 함 칸이어도 확정 두배권이면 부여(ignore+grant) → 같은 시청자 다음 결과 ×2
//           ② 사용 안 함 + 미확정은 기존처럼 검토함(needs_review), 부여 없음
//           ③ 사용 중 + 확정은 기존과 100% 동일(회귀 고정)
//           ④ 규칙 off(옛 배치 재현)는 도입 전 판정(사용 안 함 확정 칸 = 검토함) 그대로
//           ⑤ judgeRules 스냅샷: 없으면 false, 있으면 그대로 / 후보 목록은 꺼진 칸도 올리고 itemEnabled 로 표시
//           ⑥ 정산 뭉치 + 꺼진 확정 칸 → 정산 무시가 우선(부여 없음)  ⑦ 중복 + 꺼진 확정 칸 → duplicate(부여 없음)
//           ⑧ 표 전체 꺼짐 → 두배권은 부여·다음 결과(꺼진 상품)는 검토함 / 금액대에 상품이 없으면 두배권도 검토함
//           ⑨ 재판정: 꺼진 확정 두배권은 ignore 로 세고 이름 연결(unmatched)에 안 섞임  ⑩ 같은 ruleKey 두 칸 → 후보 1장
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
import { collectRejudgeCandidates, type RejudgeSourceBatch } from "../lib/rejudge";

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

// ⑥ 정산 뭉치 + 꺼진 확정 칸 → 정산 무시가 우선, 부여 없음
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, [confirmed]);
  const settle = { ...result("", "다음 룰렛 2배", 5, "2026-09-28 20:00:00", "s1"), donationType: "도전미션 별풍선 성공", fanId: "", fanNickname: "상자 11개 모으기" };
  const r = reconcileResults({ catalogItems: catalogOff, results: [settle], thresholdPercent: THRESHOLD, specialItemRules: rules });
  assertEq([r.decisions[0].decision, r.decisions[0].modifierAction, r.summary.modifierCount, r.summary.missionSettlementCount], ["ignore", null, 0, 1], "정산 뭉치는 꺼진 확정 칸이어도 부여 없음");
  assertEq(r.modifierState.pendingByViewer, {}, "정산 뭉치는 대기 두배권을 만들지 않는다");
}

// ⑦ 중복 + 꺼진 확정 칸 → duplicate, 부여 없음·다음 결과 ×1
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, [confirmed]);
  const r = reconcileResults({ catalogItems: catalogOff, results: twoSpins, thresholdPercent: THRESHOLD, existingSourceKeys: new Set(["k1"]), specialItemRules: rules });
  assertEq(r.decisions.map((d) => d.decision), ["duplicate", "record"], "이미 처리한 두배권은 duplicate");
  assertEq([r.decisions[1].effectiveCount, r.summary.modifierCount], [1, 0], "중복 두배권은 부여 없음·×1");
}

// ⑧ 표 전체 꺼짐(그룹 단위 사용 안 함) + 확정 → 두배권은 부여, 다음 결과(꺼진 상품)는 검토함(쿠폰 소진) / 금액대 밖이면 검토함
{
  const allOff = catalogOn.map((it) => ({ ...it, enabled: false }));
  const rules = buildSpecialItemRuleCandidates(allOff, [confirmed]);
  const r = reconcileResults({ catalogItems: allOff, results: twoSpins, thresholdPercent: THRESHOLD, specialItemRules: rules });
  assertEq(r.decisions.map((d) => [d.decision, d.modifierAction]), [["ignore", "grant"], ["needs_review", null]], "표 전체 꺼짐: 두배권 부여·다음 결과는 검토함");
  assertEq(r.modifierState.pendingByViewer, {}, "검토함으로 간 다음 결과가 대기 두배권을 소진한다(기존 규칙 유지)");
  const outside = { ...result("fan1", "다음 룰렛 2배", 5, "2026-09-28 20:00:00", "k9"), donationAmount: 999 };
  const r2 = reconcileResults({ catalogItems: catalogOff, results: [outside], thresholdPercent: THRESHOLD, specialItemRules: rules });
  assertEq([r2.decisions[0].decision, r2.summary.modifierCount], ["needs_review", 0], "금액대에 상품이 없으면 두배권도 검토함");
}

// ⑨ 재판정: 꺼진 확정 두배권은 ignore 로 세고 이름 연결(unmatched)에 섞이지 않는다
{
  const rules = buildSpecialItemRuleCandidates(catalogOff, [confirmed]);
  const capture: RejudgeSourceBatch["capture"] = {
    capturedAt: "2026-09-28T12:00:00.000Z",
    rows: [{ sourceUid: "u1", donateTimeText: "2026-09-28 20:00:00", donationType: "별풍선", donationAmount: 500, fanNickname: "팬", fanId: "fan1", results: [{ name: "다음 룰렛 2배", probability: 5, index: 0, total: 1 }] }],
  };
  const r = collectRejudgeCandidates({ batches: [{ batchId: "b1", capture }], catalogItems: catalogOff, thresholdPercent: THRESHOLD, existingSourceKeys: new Set(), specialItemRules: rules });
  assertEq([r.summary.ignored, r.summary.stillNeedsReview, r.unmatched.length, r.candidates.length], [1, 0, 0, 0], "재판정: 꺼진 확정 두배권은 ignore·연결 화면 제외·기록 0");
}

// ⑩ 같은 ruleKey 두 칸(사용 중 + 꺼짐) → 후보 1장, itemEnabled=true
{
  const dup = [item("다음 룰렛 2배", 5, true), { ...item("다음 룰렛 2배", 5, false), groupIndex: 1 }];
  const rules = buildSpecialItemRuleCandidates(dup, [confirmed]);
  assertEq(rules.map((r) => [r.ruleKey, r.status, r.itemEnabled]), [["500::다음룰렛2배::5", "confirmed", true]], "중복 ruleKey 는 하나로, 하나라도 사용 중이면 true");
  const dupOff = [item("다음 룰렛 2배", 5, false), { ...item("다음 룰렛 2배", 5, false), groupIndex: 1 }];
  assertEq(buildSpecialItemRuleCandidates(dupOff, [confirmed]).map((r) => r.itemEnabled), [false], "둘 다 꺼짐이면 false");
}

console.log(`double-ticket-usage-free: ${passed} assertions passed`);
