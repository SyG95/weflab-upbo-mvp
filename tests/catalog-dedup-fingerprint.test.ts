import { catalogContentFingerprint } from "../lib/upboSupabase";

function assertEq(a: string, b: string, label: string) {
  if (a !== b) throw new Error(`${label}: NOT equal\n  a=${a}\n  b=${b}`);
}
function assertNe(a: string, b: string, label: string) {
  if (a === b) throw new Error(`${label}: unexpectedly equal (${a})`);
}

// 내용 동일, 그룹·상품 순서만 뒤바뀜 → 지문 같아야 함(중복으로 판정).
const a = [
  { amountRangeLabel: "33", items: [{ itemName: "A", probability: 1 }, { itemName: "B", probability: 2 }] },
  { amountRangeLabel: "330", items: [{ itemName: "X", probability: 3 }] },
];
const aReordered = [
  { amountRangeLabel: "330", items: [{ itemName: "X", probability: 3 }] },
  { amountRangeLabel: "33", items: [{ itemName: "B", probability: 2 }, { itemName: "A", probability: 1 }] },
];
assertEq(catalogContentFingerprint(a), catalogContentFingerprint(aReordered), "순서만 다른 동일 내용은 같은 지문");

// 위플랩 on/off 상태가 달라도 지문은 같아야 함(enabled는 지문에서 제외).
const aEnabledDiff = [
  { amountRangeLabel: "33", enabled: false, items: [{ itemName: "A", probability: 1, enabled: false }, { itemName: "B", probability: 2 }] },
  { amountRangeLabel: "330", items: [{ itemName: "X", probability: 3 }] },
];
assertEq(catalogContentFingerprint(a), catalogContentFingerprint(aEnabledDiff), "enabled 차이는 지문에 영향 없음");

// 확률이 바뀌면 다른 표 → 지문 달라야 함(새 버전 생성).
const probChanged = [
  { amountRangeLabel: "33", items: [{ itemName: "A", probability: 9 }, { itemName: "B", probability: 2 }] },
  { amountRangeLabel: "330", items: [{ itemName: "X", probability: 3 }] },
];
assertNe(catalogContentFingerprint(a), catalogContentFingerprint(probChanged), "확률 변경은 다른 지문");

// 상품이 추가되면 다른 표 → 지문 달라야 함.
const itemAdded = [
  { amountRangeLabel: "33", items: [{ itemName: "A", probability: 1 }, { itemName: "B", probability: 2 }, { itemName: "C", probability: 5 }] },
  { amountRangeLabel: "330", items: [{ itemName: "X", probability: 3 }] },
];
assertNe(catalogContentFingerprint(a), catalogContentFingerprint(itemAdded), "상품 추가는 다른 지문");

console.log("catalog dedup fingerprint: 4개 통과");
