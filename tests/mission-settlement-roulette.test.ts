// 미션 성공 정산 뭉치 × 룰렛 판정 테스트(reconcileResults·collectRejudgeCandidates·단일 소스 규칙).
// 핵심 보장: ① 정산 뭉치("대결/도전미션 별풍선 성공")의 룰렛 결과는 저확률이어도 기록·검토함 없이 무시
//           ② 개인 미션 후원(타입에 "성공" 없음)·일반 별풍선은 기존 판정 그대로(회귀 고정)
//           ③ 이미 기록된 옛 정산 건은 duplicate 로 남고(멱등성), 두배권 상품이어도 부여 없음
//           ④ 정산 없는 배치는 규칙 on/off 결과가 100% 동일, 규칙 off 는 도입 전 판정 재현(검증실용)
//           ⑤ 후원집계 isMissionSuccess·정가 제외·재판정이 같은 규칙(isMissionSettlementType)을 쓴다
import {
  buildBatchSummary,
  isMissionSettlementType,
  normalizeName,
  readJudgeRules,
  reconcileResults,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type ResultCapture,
  type SpecialItemRule,
} from "../lib/upboCore";
import { isMissionPersonal, isMissionSuccess } from "../lib/donationEvents";
import { buildFixedPriceCandidates, isCouponBackfillEligible } from "../lib/upboSupabase";
import { collectRejudgeCandidates } from "../lib/rejudge";

let passed = 0;
function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

function item(itemName: string, probability: number, amount = 1000, groupIndex = 0): NormalizedCatalogItem {
  return {
    groupIndex,
    amountMin: amount,
    amountMax: amount,
    amountRangeLabel: String(amount),
    enabled: true,
    doubleEnabled: false,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    sortOrder: 0,
    raw: null,
  };
}

function result(
  uid: string,
  itemName: string,
  probability: number,
  over: Partial<NormalizedResult> = {},
): NormalizedResult {
  return {
    sourceUid: uid,
    rowIndex: 0,
    donateTimeText: "2026-09-08 20:56:08",
    donationType: "별풍선",
    donationAmount: 1000,
    donationAmountText: "1,000개",
    fanNickname: `팬${uid}`,
    fanId: uid,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    rawText: "",
    rouletteIndex: 0,
    rouletteTotal: 1,
    raw: null,
    sourceKey: `key-${uid}`,
    ...over,
  };
}

// 실물 정산 행 모양(포로미 2026-09-08): 계정 없음, 닉네임 칸=미션명.
const SETTLE_DOJEON = { donationType: "도전미션 별풍선 성공", fanId: "", fanNickname: "상자 11개 모으기 (1000개)" };
const SETTLE_DAEGYEOL = { donationType: "대결미션 별풍선 성공", fanId: "", fanNickname: "리셋빙고" };
const THRESHOLD = 5;
const catalog = [item("방셀", 0.8), item("사랑해", 5), item("앙냠냠", 30), item("두배권", 3)];

// ① 정산 뭉치 결과는 저확률이어도 무시 — 기록·검토함 없음, 카운트는 ignore + missionSettlement 에 잡힘
{
  const r = reconcileResults({ catalogItems: catalog, results: [result("s1", "방셀", 0.8, SETTLE_DOJEON)], thresholdPercent: THRESHOLD });
  assertEq(r.decisions[0].decision, "ignore", "도전미션 정산 뭉치 0.8% → ignore");
  assertEq(r.decisions[0].reason.includes("mission settlement"), true, "사유에 mission settlement 명시");
  assertEq(
    [r.summary.recordCount, r.summary.ignoreCount, r.summary.needsReviewCount, r.summary.missionSettlementCount, r.summary.effectiveRecordCount],
    [0, 1, 0, 1, 0],
    "요약: record 0 / ignore 1 / review 0 / 정산 1 / 유효 0",
  );
  assertEq(r.decisions[0].effectiveCount, 0, "유효 수량 0(업보 없음)");
}
{
  const r = reconcileResults({ catalogItems: catalog, results: [result("s2", "방셀", 0.8, SETTLE_DAEGYEOL)], thresholdPercent: THRESHOLD });
  assertEq(r.decisions[0].decision, "ignore", "대결미션 정산 뭉치 → ignore");
}
// 표에 없는 상품이어도 검토함(needs_review)에 넣지 않는다 — 귀속할 시청자가 없어 검토 의미가 없음
{
  const r = reconcileResults({ catalogItems: catalog, results: [result("s3", "표에없는상품", 1, SETTLE_DOJEON)], thresholdPercent: THRESHOLD });
  assertEq([r.decisions[0].decision, r.summary.needsReviewCount, r.summary.missionSettlementCount], ["ignore", 0, 1], "정산 뭉치 + 미등록 상품 → ignore(검토함 X)");
}

// ② 개인 미션 후원·일반 별풍선은 기존 판정 그대로
{
  const rows = [
    result("p1", "방셀", 0.8, { donationType: "도전미션 별풍선" }),
    result("p2", "방셀", 0.8, { donationType: "대결미션 별풍선" }),
    result("p3", "방셀", 0.8),
    result("p4", "앙냠냠", 30, { donationType: "도전미션 별풍선" }),
  ];
  const r = reconcileResults({ catalogItems: catalog, results: rows, thresholdPercent: THRESHOLD });
  assertEq(r.decisions.map((d) => d.decision), ["record", "record", "record", "ignore"], "개인 도전/대결/일반 저확률 → record, 고확률 → ignore(기존)");
  assertEq(r.summary.missionSettlementCount, 0, "개인 미션은 정산 카운트에 안 잡힘");
}

// ③ 이미 기록된 옛 정산 건은 duplicate 가 우선(멱등성) / 두배권 상품이어도 부여·대기 없음
{
  const r = reconcileResults({
    catalogItems: catalog,
    results: [result("s4", "방셀", 0.8, SETTLE_DOJEON)],
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(["key-s4"]),
  });
  assertEq([r.decisions[0].decision, r.summary.duplicateCount, r.summary.missionSettlementCount], ["duplicate", 1, 0], "이미 기록된 정산 건 → duplicate 유지");
}
{
  const rule: SpecialItemRule = { ruleKey: "1000::두배권::3", ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2 };
  const r = reconcileResults({
    catalogItems: catalog,
    results: [result("s5", "두배권", 3, SETTLE_DOJEON), result("s6", "방셀", 0.8, SETTLE_DOJEON)],
    thresholdPercent: THRESHOLD,
    specialItemRules: [rule],
  });
  assertEq(r.decisions.map((d) => d.decision), ["ignore", "ignore"], "정산 뭉치의 두배권·저확률 모두 ignore");
  assertEq([r.decisions[0].modifierRule ?? null, r.decisions[0].modifierAction ?? null, r.summary.modifierCount], [null, null, 0], "정산 뭉치 두배권은 감지·부여 없음");
  assertEq(r.modifierState.pendingByViewer, {}, "대기 두배권 없음");
  assertEq(r.decisions[1].effectiveCount, 0, "뒤따르는 저확률도 수량 0");
}

// ④ 정산 없는 배치는 규칙 on/off 가 100% 동일 / off 는 도입 전 판정 재현(검증실 옛 배치용)
{
  const rows = [result("n1", "방셀", 0.8), result("n2", "사랑해", 5), result("n3", "앙냠냠", 30), result("n4", "미등록", 1)];
  const on = reconcileResults({ catalogItems: catalog, results: rows, thresholdPercent: THRESHOLD });
  const off = reconcileResults({ catalogItems: catalog, results: rows, thresholdPercent: THRESHOLD, missionSettlementIgnore: false });
  assertEq(on.decisions.map((d) => [d.sourceKey, d.decision, d.effectiveCount]), off.decisions.map((d) => [d.sourceKey, d.decision, d.effectiveCount]), "정산 없는 배치: on/off 판정 동일");
  assertEq(on.summary, off.summary, "정산 없는 배치: 요약 동일");
}
{
  const r = reconcileResults({ catalogItems: catalog, results: [result("s7", "방셀", 0.8, SETTLE_DOJEON)], thresholdPercent: THRESHOLD, missionSettlementIgnore: false });
  assertEq([r.decisions[0].decision, r.summary.recordCount, r.summary.missionSettlementCount], ["record", 1, 0], "규칙 off = 도입 전 판정(유령 기록) 재현");
}

// ⑤ 단일 소스: 실물 문자열 4종 + 빈 값, 집계·정가·재판정이 같은 규칙
{
  const cases: Array<[unknown, boolean]> = [
    ["도전미션 별풍선 성공", true],
    ["대결미션 별풍선 성공", true],
    ["도전미션 별풍선", false],
    ["대결미션 별풍선", false],
    ["별풍선", false],
    ["", false],
    [null, false],
    [undefined, false],
    ["  도전미션   별풍선 성공  ", true],
  ];
  for (const [type, expected] of cases) {
    assertEq(isMissionSettlementType(type), expected, `isMissionSettlementType(${JSON.stringify(type)})`);
    assertEq(isMissionSuccess((type as string | null | undefined) ?? null), expected, `isMissionSuccess 동치(${JSON.stringify(type)})`);
  }
  assertEq(isMissionPersonal("도전미션 별풍선"), true, "개인 미션 판별 유지");
  assertEq(isMissionPersonal("도전미션 별풍선 성공"), false, "정산은 개인 아님(유지)");
  // 정가: 정산 뭉치 제외, 개인 미션 유지(2026-08-24 규칙 회귀 고정)
  const fixedRow = { fanId: "", fanNickname: "다뿌서버를 위한..💗", donateTimeText: "2026-08-24 20:00:00", donationType: "도전미션 별풍선 성공", donationAmount: 5555, donationAmountText: "5,555개", rawText: "" };
  assertEq(buildFixedPriceCandidates([fixedRow], [5555]).length, 0, "정가: 정산 뭉치 제외 유지");
  assertEq(buildFixedPriceCandidates([{ ...fixedRow, fanId: "fan1", donationType: "도전미션 별풍선" }], [5555]).length, 1, "정가: 개인 미션 유지");
  // 재판정: 정산 뭉치 결과는 후보가 되지 않고 ignored 로 센다
  const capture: ResultCapture = {
    rows: [
      { sourceUid: "u1", ...SETTLE_DOJEON, donationAmount: 1000, donateTimeText: "2026-09-08 20:56:08", results: [{ name: "방셀", probability: 0.8, index: 0, total: 1 }] },
      { sourceUid: "u2", donationType: "별풍선", fanId: "fan2", fanNickname: "팬2", donationAmount: 1000, donateTimeText: "2026-09-08 21:00:00", results: [{ name: "방셀", probability: 0.8, index: 0, total: 1 }] },
    ],
  };
  const rj = collectRejudgeCandidates({ batches: [{ batchId: "b1", capture }], catalogItems: catalog, thresholdPercent: THRESHOLD, existingSourceKeys: new Set() });
  assertEq([rj.summary.wouldRecord, rj.summary.ignored, rj.summary.stillNeedsReview, rj.candidates.map((c) => c.sourceKey)], [1, 1, 0, ["u2::0"]], "재판정: 정산 뭉치 제외, 개인 후원만 후보");
}

// ⑥ 리뷰 반영: 정산 행은 대기 두배권을 소모하지 않고 processed 에도 남지 않는다
//    (가정: 정산 행에 계정이 붙는 변종이 와도 시청자의 룰렛이 아니므로 배수는 진짜 당첨으로 넘어가야 한다)
{
  const rule: SpecialItemRule = { ruleKey: "1000::두배권::3", ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2 };
  const rows = [
    result("m1", "두배권", 3, { fanId: "v1", fanNickname: "뷰어", rowIndex: 0 }), // 두배권 획득 → v1 대기 ×2
    result("m2", "방셀", 0.8, { ...SETTLE_DOJEON, fanId: "v1", rowIndex: 1 }), // 정산 행(계정 붙은 변종) — 소모하면 안 됨
    result("m3", "방셀", 0.8, { fanId: "v1", fanNickname: "뷰어", rowIndex: 2 }), // 진짜 당첨 → ×2 적용
  ];
  const r = reconcileResults({ catalogItems: catalog, results: rows, thresholdPercent: THRESHOLD, specialItemRules: [rule] });
  const byKey = Object.fromEntries(r.decisions.map((d) => [d.sourceKey, d]));
  assertEq([byKey["key-m1"].decision, byKey["key-m2"].decision, byKey["key-m3"].decision], ["ignore", "ignore", "record"], "두배권 ignore(감지) / 정산 ignore / 진짜 당첨 record");
  assertEq([byKey["key-m3"].multiplier, byKey["key-m3"].effectiveCount], [2, 2], "대기 두배권이 정산 행을 건너뛰고 진짜 당첨에 적용");
  assertEq(r.summary.effectiveRecordCount, 2, "유효 수량 2");
  assertEq(r.modifierState.processedSourceKeys, ["key-m1", "key-m3"], "정산 행은 processed 에 남지 않음");
  assertEq(r.modifierState.pendingByViewer, {}, "대기 두배권 소진 완료");
}

// ⑦ 리뷰 반영: 판정 규칙 스냅샷 판독·조립(순수)
{
  assertEq(readJudgeRules(undefined), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "summary 없음 → 규칙 없음(옛 배치)");
  assertEq(readJudgeRules(null), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "null → 규칙 없음");
  assertEq(readJudgeRules({}), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "judgeRules 없음 → 규칙 없음");
  assertEq(readJudgeRules({ judgeRules: "true" }), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "깨진 스냅샷(문자열) → 규칙 없음");
  assertEq(readJudgeRules({ judgeRules: { missionSettlementIgnore: "true" } }), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "문자열 'true' → 규칙 없음(엄격)");
  assertEq(readJudgeRules({ judgeRules: { missionSettlementIgnore: true } }), { missionSettlementIgnore: true, modifierIgnoresUsage: false }, "true → 규칙 켬(새 키 없으면 false)");
  assertEq(readJudgeRules({ judgeRules: { missionSettlementIgnored: true } }), { missionSettlementIgnore: false, modifierIgnoresUsage: false }, "키 오타 → 규칙 없음(안전 낙하)");
  const base = { totalResults: 3, recordCount: 1, ignoreCount: 2, duplicateCount: 0, needsReviewCount: 0, missionSettlementCount: 2 };
  const on = { missionSettlementIgnore: true, modifierIgnoresUsage: true };
  assertEq(buildBatchSummary(base, {}, on), { ...base, judgeRules: on }, "예외 없음 → thresholdOverrides 키 없음 + judgeRules");
  assertEq(buildBatchSummary(base, { "1000": 1 }, on), { ...base, thresholdOverrides: { "1000": 1 }, judgeRules: on }, "예외 있음 → 둘 다");
  assertEq(readJudgeRules(buildBatchSummary(base, {}, on)), on, "저장한 스냅샷을 그대로 읽는다(왕복)");
}

// ⑧ 리뷰 반영: 쿠폰 소급은 이미 기록된 정산 뭉치 유령(계정 없음·닉네임=미션명)을 적립 대상에서 뺀다
{
  assertEq(isCouponBackfillEligible({ donationType: "도전미션 별풍선 성공" }), false, "정산 뭉치 기록 → 소급 제외");
  assertEq(isCouponBackfillEligible({ donationType: "대결미션 별풍선 성공" }), false, "대결 정산 → 소급 제외");
  assertEq(isCouponBackfillEligible({ donationType: "도전미션 별풍선" }), true, "개인 미션 → 소급 대상");
  assertEq(isCouponBackfillEligible({ donationType: "별풍선" }), true, "일반 → 소급 대상");
  assertEq(isCouponBackfillEligible({}), true, "유형 없음(옛 픽스처) → 기존과 동일하게 대상");
}

console.log(`mission-settlement-roulette: ${passed}개 통과`);
