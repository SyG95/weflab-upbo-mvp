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

// 3) 핵심 버그 수정: 새 버전(저장본 없음 = 키 자체가 없음)이 직전 버전에서 자동 승계.
assertJson(
  computeEffectiveOverrides(2, v2, { 1: { g1: false } }, { 1: v1, 2: v2 }),
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

// 7) 저장 후 새로고침 풀림 버그 수정: 그 버전에 저장본이 있으면(빈 것 포함) 저장본이 전부다.
//    저장은 전체 교체 방식이라, 승계를 다시 밑에 깔면 "위플랩 원본값으로 되돌린 키"가
//    옛 버전 꺼짐으로 매번 되살아난다(사용 토글이 저장 후 새로고침마다 꺼지던 실사고).
assertJson(
  computeEffectiveOverrides(2, v2, { 1: { g1: false }, 2: {} }, { 1: v1, 2: v2 }),
  {},
  "저장본이 있으면(빈 저장 포함) 승계를 다시 적용하지 않음",
);

// 8) 승계 오매핑 수정(나월 v7→v8 실사고): "같은 상품·다른 확률" 표가 여럿이라 지문이 동점이면
//    같은 금액대 라벨을 최우선 매칭하고, 라벨 일치가 없는 동점은 승계하지 않는다.
const SAME = ["A", "B", "C", "D", "E", "F"];
const n7 = [g(8, "50~51", SAME), g(9, "500~510", SAME), g(10, "100", SAME)];
const n8 = [g(1, "33", SAME), g(2, "50~51", SAME), g(3, "500~510", SAME), g(4, "300~310", SAME)];
assertJson(
  carryOverridesByContent(n7, { g8: false, g9: false, g10: false }, n8),
  { g2: false, g3: false },
  "동점 지문은 같은 라벨로 매칭(50~51→50~51, 500~510→500~510), 라벨 없는 100은 승계 생략",
);

// 9) 7+8 통합(나월 증상 재현): v8에 저장본이 있으면 g4(300~310)가 다시 꺼지지 않는다.
assertJson(
  computeEffectiveOverrides(8, n8, { 7: { g8: false, g9: false, g10: false }, 8: { g2: false } }, { 7: n7, 8: n8 }),
  { g2: false },
  "저장본(g4 없음=켜짐)이 최종 — 승계 꺼짐이 300~310을 되살려 끄지 않음",
);

console.log("catalog-usage carryover: 9개 통과");
