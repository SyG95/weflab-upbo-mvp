import { computeCouponAccruals } from "../lib/upboSupabase";
import type { CouponSourceMap, CouponItemDef } from "../lib/upboSupabase";
import type { ReconcileDecision, NormalizedResult } from "../lib/upboCore";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// record decision 을 최소 필드로 만든다(테스트에 필요한 필드만; 나머지는 캐스팅).
function rec(
  opts: { itemName: string; fanId?: string; fanNickname?: string; sourceKey: string; effectiveCount?: number },
): ReconcileDecision {
  const result = {
    itemName: opts.itemName,
    fanId: opts.fanId ?? "",
    fanNickname: opts.fanNickname ?? "",
  } as unknown as NormalizedResult;
  return {
    sourceKey: opts.sourceKey,
    decision: "record",
    reason: "test",
    result,
    catalogItem: null,
    effectiveCount: opts.effectiveCount ?? 1,
  } as unknown as ReconcileDecision;
}

const items: CouponItemDef[] = [
  { key: "gold", name: "골드쿠폰" },
  { key: "silver", name: "실버쿠폰" },
];

const map: CouponSourceMap[] = [
  { itemKey: "gold", sources: [{ itemName: "황금 열쇠", per: 2 }, { itemName: "다이아", per: 5 }] },
  { itemKey: "silver", sources: [{ itemName: "황금 열쇠", per: 1 }] },
];

// 1) ★최우선: 빈 sourceMap → [] (매핑 미설정 스트리머 = 기존 applyResults 동작과 100% 동일).
assertEq(computeCouponAccruals([rec({ itemName: "황금 열쇠", fanId: "aaa", sourceKey: "s1" })], []), [], "빈 sourceMap 은 항상 [] (매핑 미설정 = 기존 동작)");

// 2) 매칭 → 적립. 한 상품(황금 열쇠)이 gold(2)·silver(1) 둘에 연결되어 둘 다 적립된다.
{
  const out = computeCouponAccruals([rec({ itemName: "황금 열쇠", fanId: "aaa", fanNickname: "팬A", sourceKey: "s1" })], map, items);
  assertEq(out.length, 2, "한 상품 여러 쿠폰 연결 → 각각 적립");
  const gold = out.find((a) => a.itemKey === "gold")!;
  const silver = out.find((a) => a.itemKey === "silver")!;
  assertEq({ vk: gold.viewerKey, acc: gold.accountId, nick: gold.nickname, name: gold.itemName, d: gold.delta, sk: gold.sourceKeys }, { vk: "aaa", acc: "aaa", nick: "팬A", name: "골드쿠폰", d: 2, sk: ["s1"] }, "gold 적립 = per 2 × 수량 1, viewerKey=계정ID, itemName=쿠폰표시명");
  assertEq(silver.delta, 1, "silver 적립 = per 1 × 수량 1");
}

// 3) per × 당첨수량(effectiveCount). 황금 열쇠 3개 당첨 → gold 2×3=6.
{
  const out = computeCouponAccruals([rec({ itemName: "황금 열쇠", fanId: "aaa", sourceKey: "s2", effectiveCount: 3 })], map, items);
  const gold = out.find((a) => a.itemKey === "gold")!;
  assertEq(gold.delta, 6, "per(2) × 당첨수량(3) = 6");
}

// 4) 같은 (viewer, itemKey) 합산. 같은 팬이 황금 열쇠 + 다이아 → gold = 2 + 5 = 7, sourceKeys 합쳐짐.
{
  const out = computeCouponAccruals(
    [
      rec({ itemName: "황금 열쇠", fanId: "aaa", sourceKey: "s1" }),
      rec({ itemName: "다이아", fanId: "aaa", sourceKey: "s3" }),
    ],
    map,
    items,
  );
  const gold = out.find((a) => a.itemKey === "gold")!;
  assertEq({ d: gold.delta, sk: gold.sourceKeys.sort() }, { d: 7, sk: ["s1", "s3"] }, "같은 viewer+itemKey 합산(2+5=7), sourceKeys 합쳐짐");
}

// 5) 미매칭 상품 무시. "꽝"은 연결에 없음 → 적립 0.
assertEq(computeCouponAccruals([rec({ itemName: "꽝", fanId: "aaa", sourceKey: "s4" })], map, items), [], "연결에 없는 상품(꽝)은 무시");

// 6) viewerKey 폴백: 계정ID 없으면 닉네임을 키로.
{
  const out = computeCouponAccruals([rec({ itemName: "황금 열쇠", fanNickname: "닉만있음", sourceKey: "s5" })], map, items);
  const gold = out.find((a) => a.itemKey === "gold")!;
  assertEq({ vk: gold.viewerKey, acc: gold.accountId, nick: gold.nickname }, { vk: "닉만있음", acc: "", nick: "닉만있음" }, "계정ID 없으면 viewerKey=닉네임");
}

// 7) 상품명 정규화 매칭(공백/대소문자 차이 흡수 — reconcile 상품 매칭과 동일 규칙).
{
  const out = computeCouponAccruals([rec({ itemName: "황금열쇠", fanId: "aaa", sourceKey: "s6" })], map, items);
  assertEq(out.length, 2, "'황금열쇠'(공백 없음)도 '황금 열쇠' 연결에 매칭됨");
}

// 8) record 아닌 decision 은 무시(방어). duplicate 로 들어와도 적립 안 함.
{
  const dup = { ...rec({ itemName: "황금 열쇠", fanId: "aaa", sourceKey: "s7" }), decision: "duplicate" } as ReconcileDecision;
  assertEq(computeCouponAccruals([dup], map, items), [], "record 아닌 decision 무시");
}

// 9) viewer 도 없고(계정ID·닉 둘 다 빈값) → 무시.
assertEq(computeCouponAccruals([rec({ itemName: "황금 열쇠", sourceKey: "s8" })], map, items), [], "시청자 식별 불가(빈 계정ID·빈 닉) 무시");

console.log("coupon accrual: 9개 통과");
