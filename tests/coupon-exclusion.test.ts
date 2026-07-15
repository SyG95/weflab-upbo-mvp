import {
  couponExcludedNameSet,
  filterHoldingsByExcludedNames,
} from "../lib/upboSupabase";
import type { CouponSourceMap } from "../lib/upboSupabase";
import type { HoldingItem, ViewerHolding } from "../lib/api";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}
function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`${label}: expected true`);
}

// 테스트에 필요한 필드만 채운 HoldingItem/ViewerHolding(나머지는 캐스팅).
function item(itemName: string, quantity: number, probability: number): HoldingItem {
  return { itemName, quantity, probability } as unknown as HoldingItem;
}
function holding(owner: string, items: HoldingItem[]): ViewerHolding {
  return {
    key: owner,
    ownerId: owner,
    ownerName: owner,
    items,
    maxProb: items.reduce((m, it) => Math.max(m, it.probability), 0),
    total: items.reduce((s, it) => s + it.quantity, 0),
  };
}

// ---------- couponExcludedNameSet: 연결 상품명 → normalizeName 집합 ----------

const sourceMap: CouponSourceMap[] = [
  { itemKey: "coin", sources: [{ itemName: "포토카드", per: 1 }, { itemName: "movie ticket", per: 2 }] },
  { itemKey: "ticket", sources: [{ itemName: " 포토카드 ", per: 3 }] }, // 공백 → 같은 정규화 키(중복 흡수)
];
const excluded = couponExcludedNameSet(sourceMap);
assertEq([...excluded].sort(), ["movieticket", "포토카드"], "연결 상품명 정규화 집합(공백·대소문자 흡수·중복 제거)");
assertEq(couponExcludedNameSet([]).size, 0, "매핑 0개면 빈 집합");

// ① 쿠폰 연결 상품 item 제외 (해당 상품만 가진 시청자는 통째 빠짐)
{
  const holdings = [holding("A", [item("포토카드", 2, 5)])];
  const out = filterHoldingsByExcludedNames(holdings, excluded);
  assertEq(out.length, 0, "① 쿠폰상품만 보유한 시청자는 목록에서 사라짐");
}

// ② 쿠폰상품+일반상품 혼합 → 일반상품만 남고 total/maxProb 재계산 (시청자 통째 제외 아님)
{
  const holdings = [
    holding("B", [
      item("포토카드", 2, 5), // 쿠폰 연결(제외)
      item("움짤프사", 3, 1.2), // 일반(유지)
      item("Movie Ticket", 1, 9), // 쿠폰 연결(대소문자 무시 제외)
    ]),
  ];
  const out = filterHoldingsByExcludedNames(holdings, excluded);
  assertEq(out.length, 1, "② 혼합 보유자는 남는다");
  assertEq(out[0].items.map((it) => it.itemName), ["움짤프사"], "② 일반상품만 남음");
  assertEq(out[0].total, 3, "② total 재계산(남은 수량만)");
  assertEq(out[0].maxProb, 1.2, "② maxProb 재계산(남은 상품만)");
}

// ③ 빈 Set(매핑 없음) → holdings 를 그대로(동일 참조) 반환 = 회귀 0
{
  const holdings = [holding("C", [item("포토카드", 1, 5), item("움짤프사", 2, 1)])];
  const out = filterHoldingsByExcludedNames(holdings, new Set<string>());
  assert(out === holdings, "③ 빈 Set이면 원본 배열 동일 참조(회귀 0)");
  assertEq(out[0].items.length, 2, "③ 아이템 그대로 유지");
}

// ④ 제외 대상이 없는 보유자는 원본 holding 객체 그대로(불필요한 재계산 회피)
{
  const only = holding("D", [item("움짤프사", 4, 1)]);
  const out = filterHoldingsByExcludedNames([only], excluded);
  assertEq(out.length, 1, "④ 쿠폰상품 없는 보유자는 유지");
  assert(out[0] === only, "④ 제외 대상 없으면 원본 holding 그대로");
}

console.log("coupon-exclusion.test.ts: all assertions passed");
