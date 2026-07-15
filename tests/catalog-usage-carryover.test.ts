import { carryOverridesByContent, computeEffectiveOverrides } from "../lib/upboSupabase";
import type { CatalogGroup } from "../lib/api";

function assertJson(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const g = (groupIndex: number, label: string, items: string[]): CatalogGroup => ({
  groupIndex,
  amountMin: 0,
  amountMax: 0,
  enabled: true,
  amountRangeLabel: label,
  items: items.map((itemName, i) => ({ itemName, probability: 1, sortOrder: i, enabled: true })),
});

// v1: g0="33"[A,B,C], g1="330"[X,Y,Z]. sy가 330 룰렛(g1)을 껐다.
const v1 = [g(0, "33", ["A", "B", "C"]), g(1, "330", ["X", "Y", "Z"])];
// v2: 내용 동일하지만 그룹 순서가 뒤바뀜 → 330이 이제 g0.
const v2 = [g(0, "330", ["X", "Y", "Z"]), g(1, "33", ["A", "B", "C"])];

// 1) 그룹 off가 "룰렛 내용"을 따라 새 버전의 바뀐 인덱스로 승계돼야 한다.
assertJson(
  carryOverridesByContent(v1, { g1: false }, v2),
  { g0: false },
  "group off는 내용(330) 기준으로 v2의 g0으로 번역돼야 함",
);

// 2) 회귀: 승계할 이전 설정이 없으면 빈 객체(=기존 판정과 동일).
assertJson(
  computeEffectiveOverrides(2, v2, { 2: {} }, { 1: v1, 2: v2 }),
  {},
  "설정 없으면 빈 오버라이드(회귀 없음)",
);

// 3) 핵심 버그 수정: 새 버전(설정 없음)이 직전 버전에서 자동 승계.
assertJson(
  computeEffectiveOverrides(2, v2, { 1: { g1: false }, 2: {} }, { 1: v1, 2: v2 }),
  { g0: false },
  "새 버전은 직전 버전 off를 내용 기준으로 자동 승계",
);

// 4) 내 직접 저장분이 승계값을 이긴다(위플랩값으로 되돌리기 가능).
assertJson(
  computeEffectiveOverrides(2, v2, { 1: { g1: false }, 2: { g0: true } }, { 1: v1, 2: v2 }),
  { g0: true },
  "그 버전 직접 저장분(own)이 승계(inherited)를 덮어씀",
);

// 5) 상품 단위 off는 (금액대라벨::상품명)으로 매칭 — 상품 순서가 바뀌어도 따라온다.
const p1 = [g(0, "33", ["A", "B"])]; // B = sortOrder 1 → key g0-i1
const p2 = [g(0, "33", ["B", "A"])]; // B = sortOrder 0 → key g0-i0
assertJson(
  carryOverridesByContent(p1, { "g0-i1": false }, p2),
  { "g0-i0": false },
  "item off는 상품명 기준으로 새 sortOrder 키로 번역돼야 함",
);

// 6) 같은 금액대 여러 룰렛 구분: "33"이 둘이어도 지문이 다르면 정확히 그 룰렛만 승계.
const m1 = [g(0, "33", ["A", "B"]), g(1, "33", ["P", "Q"])];
const m2 = [g(0, "33", ["P", "Q"]), g(1, "33", ["A", "B"])]; // 순서 뒤바뀜
assertJson(
  carryOverridesByContent(m1, { g1: false }, m2), // g1=[P,Q] off
  { g0: false }, // v2에서 [P,Q]는 g0
  "같은 금액대라도 상품 지문으로 정확히 매칭",
);

console.log("catalog-usage carryover: 6개 통과");
