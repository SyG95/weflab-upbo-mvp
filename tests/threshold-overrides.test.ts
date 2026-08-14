// 룰렛표(금액대)별 기준확률 오버레이 판정 테스트.
// 핵심 보장: ① 오버라이드가 없으면 기존 판정과 100% 동일(회귀 기준)
//           ② 오버라이드는 해당 금액대 룰렛표에만 적용되고 다른 룰렛표는 건드리지 않는다.
import {
  applyThresholdOverrides,
  cleanThresholdOverrides,
  normalizeName,
  reconcileResults,
  type NormalizedCatalogItem,
  type NormalizedResult,
} from "../lib/upboCore";

let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

function item(
  itemName: string,
  probability: number,
  amount = 33,
  groupIndex = 0,
): NormalizedCatalogItem {
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

function result(uid: string, itemName: string, probability: number, amount = 33): NormalizedResult {
  return {
    sourceUid: uid,
    rowIndex: 0,
    donateTimeText: "07-31 12:00",
    donationType: "룰렛",
    donationAmount: amount,
    donationAmountText: String(amount),
    fanNickname: `팬${uid}`,
    fanId: uid,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    rawText: "",
    rouletteIndex: 1,
    rouletteTotal: 1,
    raw: null,
    sourceKey: `key-${uid}`,
  };
}

// 확률표: 33원 룰렛(1%·5%) + 10000원 룰렛(5%)
const catalogItems = [
  item("곰인형", 1, 33, 0),
  item("스킨교체권", 5, 33, 0),
  item("황금열쇠", 5, 10000, 1),
];
// 결과: 각 상품이 한 번씩 당첨
const results = [
  result("a", "곰인형", 1, 33),
  result("b", "스킨교체권", 5, 33),
  result("c", "황금열쇠", 5, 10000),
];

function judge(items: NormalizedCatalogItem[], thresholdPercent: number) {
  return reconcileResults({
    catalogItems: items,
    results,
    thresholdPercent,
    existingSourceKeys: new Set(),
    specialItemRules: [],
    modifierState: {},
  });
}

function decisionsOf(recon: ReturnType<typeof judge>) {
  return recon.decisions.map((d) => [d.result.itemName, d.decision]);
}

// ① 기준 1% + 오버라이드 없음: 1%만 기록, 5%는 양쪽 룰렛 모두 무시(기존 동작).
const base = judge(catalogItems, 1);
assertEq(
  decisionsOf(base),
  [
    ["곰인형", "record"],
    ["스킨교체권", "ignore"],
    ["황금열쇠", "ignore"],
  ],
  "오버라이드 없음(기준 1%)",
);

// ② 10000원 룰렛만 기준 5%: 황금열쇠(5%)는 기록되고 33원 룰렛의 5%는 그대로 무시.
const withOverride = judge(applyThresholdOverrides(catalogItems, { "10000": 5 }), 1);
assertEq(
  decisionsOf(withOverride),
  [
    ["곰인형", "record"],
    ["스킨교체권", "ignore"],
    ["황금열쇠", "record"],
  ],
  "10000원 룰렛만 예외 5%",
);
assertEq(
  withOverride.decisions[2].reason.includes("<= threshold 5%"),
  true,
  "예외 판정 사유에 예외 기준이 남는다",
);
assertEq(
  withOverride.decisions[1].reason.includes("> threshold 1%"),
  true,
  "예외 없는 룰렛표 판정 사유는 전역 기준 그대로",
);

// ③ 반대 방향(전역을 올리고 특정 룰렛만 낮춤): 기준 5% + 33원 룰렛 예외 1%
//    → sy가 겪던 "전역 올리면 저확률 룰렛이 다 기록되는" 문제가 예외로 해결되는지.
const inverse = judge(applyThresholdOverrides(catalogItems, { "33": 1 }), 5);
assertEq(
  decisionsOf(inverse),
  [
    ["곰인형", "record"],
    ["스킨교체권", "ignore"],
    ["황금열쇠", "record"],
  ],
  "전역 5% + 33원 룰렛 예외 1%",
);

// ④ 회귀: 빈 오버라이드는 원본 배열 그대로(같은 참조) + 판정 결과 완전 동일.
assertEq(applyThresholdOverrides(catalogItems, {}) === catalogItems, true, "빈 오버라이드 = 원본 그대로");
assertEq(
  JSON.stringify(judge(applyThresholdOverrides(catalogItems, {}), 1).decisions),
  JSON.stringify(base.decisions),
  "빈 오버라이드 판정 = 기존 판정과 100% 동일",
);

// ⑤ 저장값 정리: 잘못된 키·범위 밖 값은 버리고, 숫자 문자열은 숫자로 받는다.
assertEq(
  cleanThresholdOverrides({ "10000": "5", "  33  ": 2, "": 3, bad: "abc", over: 101, minus: -1 }),
  { "10000": 5, "33": 2 },
  "오버라이드 정리(cleanThresholdOverrides)",
);
assertEq(cleanThresholdOverrides(null), {}, "null 입력은 빈 오버라이드");
assertEq(cleanThresholdOverrides([1, 2]), {}, "배열 입력은 빈 오버라이드");

// ⑥ 요약 카운트도 예외를 반영한다.
assertEq(withOverride.summary.recordCount, 2, "예외 적용 시 기록 2건");
assertEq(base.summary.recordCount, 1, "예외 미적용 시 기록 1건");

console.log(`threshold-overrides: ${passed}개 통과`);
