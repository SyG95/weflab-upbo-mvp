// 교환 유입분 쿠폰 자동 적립 — exchangeReceiveToDecision 어댑터가 조각 2의 순수 계산
// (computeCouponAccruals)과 올바르게 맞물리는지 검증한다(서버·DB 불필요, 순수 계산만).
import { computeCouponAccruals, exchangeReceiveToDecision } from "../lib/upboSupabase";
import type { CouponSourceMap, CouponItemDef } from "../lib/upboSupabase";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const items: CouponItemDef[] = [{ key: "star", name: "별" }];
const map: CouponSourceMap[] = [{ itemKey: "star", sources: [{ itemName: "별", per: 1 }] }];

// 1) 어댑터 필드 매핑: decision=record, sourceKey 그대로, quantity → effectiveCount(내림, 최소 1).
{
  const d = exchangeReceiveToDecision({
    itemName: "별",
    quantity: 3,
    fanId: "aaa",
    fanNickname: "팬A",
    sourceKey: "exchange:gid:0",
  });
  assertEq(
    { decision: d.decision, sourceKey: d.sourceKey, eff: d.effectiveCount },
    { decision: "record", sourceKey: "exchange:gid:0", eff: 3 },
    "어댑터 기본 매핑",
  );
  const zero = exchangeReceiveToDecision({ itemName: "별", quantity: 0, fanId: "a", fanNickname: "", sourceKey: "s" });
  assertEq(zero.effectiveCount, 1, "수량 0/이상값은 방어적으로 1 (호출부가 이미 1 이상만 통과시킴)");
}

// 2) ★핵심 시나리오(나월 케이스): 업보 → 별 1개 교환 → 별 쿠폰 1개 적립.
{
  const out = computeCouponAccruals(
    [exchangeReceiveToDecision({ itemName: "별", quantity: 1, fanId: "aaa", fanNickname: "팬A", sourceKey: "exchange:gid:0" })],
    map,
    items,
  );
  assertEq(out.length, 1, "연결 상품 교환 → 적립 1건");
  assertEq(
    { vk: out[0].viewerKey, key: out[0].itemKey, name: out[0].itemName, d: out[0].delta, sk: out[0].sourceKeys },
    { vk: "aaa", key: "star", name: "별", d: 1, sk: ["exchange:gid:0"] },
    "별 1개 = per 1 × 수량 1, 참조키는 받은 entry 의 source_key",
  );
}

// 3) 수량 반영: 별 3개 받으면 3개 적립.
{
  const out = computeCouponAccruals(
    [exchangeReceiveToDecision({ itemName: "별", quantity: 3, fanId: "aaa", fanNickname: "", sourceKey: "exchange:gid:0" })],
    map,
    items,
  );
  assertEq(out[0].delta, 3, "per 1 × 수량 3 = 3");
}

// 4) 연결 안 된 상품은 적립 없음(일반 상품 교환은 기존 동작 그대로).
{
  const out = computeCouponAccruals(
    [exchangeReceiveToDecision({ itemName: "방셀", quantity: 2, fanId: "aaa", fanNickname: "", sourceKey: "exchange:gid:0" })],
    map,
    items,
  );
  assertEq(out, [], "미연결 상품 → 적립 0건");
}

// 5) 혼합 receives: 연결 상품만 골라 적립하고 sourceKey 는 각자 것을 쓴다.
{
  const out = computeCouponAccruals(
    [
      exchangeReceiveToDecision({ itemName: "방셀", quantity: 1, fanId: "aaa", fanNickname: "", sourceKey: "exchange:gid:0" }),
      exchangeReceiveToDecision({ itemName: "별", quantity: 2, fanId: "aaa", fanNickname: "", sourceKey: "exchange:gid:1" }),
    ],
    map,
    items,
  );
  assertEq(out.length, 1, "혼합 → 연결 상품만 적립");
  assertEq({ d: out[0].delta, sk: out[0].sourceKeys }, { d: 2, sk: ["exchange:gid:1"] }, "별 2개, 참조키는 1번 조각");
}

// 6) 옛 수집분 계정ID "(aaa)" 괄호 정규화(교환 당사자가 옛 기록 보유자여도 같은 잔액 줄로 합쳐짐).
{
  const out = computeCouponAccruals(
    [exchangeReceiveToDecision({ itemName: "별", quantity: 1, fanId: "(aaa)", fanNickname: "팬A", sourceKey: "exchange:gid:0" })],
    map,
    items,
  );
  assertEq({ vk: out[0].viewerKey, acc: out[0].accountId }, { vk: "aaa", acc: "aaa" }, "괄호 계정ID 정규화");
}

// 7) 빈 sourceMap → [] (매핑 미설정 스트리머 = 쿠폰 패스 자체가 없던 기존 동작과 100% 동일).
assertEq(
  computeCouponAccruals(
    [exchangeReceiveToDecision({ itemName: "별", quantity: 1, fanId: "aaa", fanNickname: "", sourceKey: "s" })],
    [],
    items,
  ),
  [],
  "빈 sourceMap 은 항상 []",
);

console.log("exchange-coupon-accrual.test.ts: all assertions passed");
