import {
  couponBackfillEntryToDecision,
  filterCouponEntriesByPeriod,
  computeCouponAccruals,
} from "../lib/upboSupabase";
import type { CouponSourceMap, CouponItemDef, CouponBackfillEntry } from "../lib/upboSupabase";
import { aggregateCouponEventsBySource } from "../lib/couponAggregate";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function entry(opts: Partial<CouponBackfillEntry> & { sourceKey: string }): CouponBackfillEntry {
  return {
    status: "record",
    itemName: opts.itemName ?? "황금 열쇠",
    fanId: opts.fanId ?? "",
    fanNickname: opts.fanNickname ?? "",
    effectiveCount: opts.effectiveCount ?? 1,
    donateTimeText: opts.donateTimeText ?? "",
    sourceKey: opts.sourceKey,
  };
}

const items: CouponItemDef[] = [
  { key: "gold", name: "골드쿠폰" },
  { key: "silver", name: "실버쿠폰" },
];
const map: CouponSourceMap[] = [
  { itemKey: "gold", sources: [{ itemName: "황금 열쇠", per: 2 }] },
  { itemKey: "silver", sources: [{ itemName: "황금 열쇠", per: 1 }] },
];

// ── 1) entry → record decision 어댑터 ──────────────────────────────────
{
  const d = couponBackfillEntryToDecision(
    entry({ sourceKey: "s1", itemName: "황금 열쇠", fanId: "aaa", fanNickname: "팬A", effectiveCount: 3 }),
  );
  assertEq(
    { dec: d.decision, name: d.result.itemName, id: d.result.fanId, nick: d.result.fanNickname, ec: d.effectiveCount, sk: d.sourceKey },
    { dec: "record", name: "황금 열쇠", id: "aaa", nick: "팬A", ec: 3, sk: "s1" },
    "어댑터: record decision 으로 필드 매핑 + effectiveCount 보존",
  );
}
// effectiveCount 클램프: 0/음수/NaN → 1, 소수 → floor.
assertEq(couponBackfillEntryToDecision(entry({ sourceKey: "s", effectiveCount: 0 })).effectiveCount, 1, "effectiveCount 0 → 1");
assertEq(couponBackfillEntryToDecision(entry({ sourceKey: "s", effectiveCount: 2.9 })).effectiveCount, 2, "effectiveCount 2.9 → floor 2");
assertEq(couponBackfillEntryToDecision(entry({ sourceKey: "s", effectiveCount: NaN })).effectiveCount, 1, "effectiveCount NaN → 1");

// ── 2) 어댑터 → computeCouponAccruals 재사용(조각 2 계산 그대로) ────────
{
  const decisions = [
    entry({ sourceKey: "s1", itemName: "황금 열쇠", fanId: "aaa", fanNickname: "팬A", effectiveCount: 3 }),
  ].map(couponBackfillEntryToDecision);
  const out = computeCouponAccruals(decisions, map, items);
  const gold = out.find((a) => a.itemKey === "gold")!;
  assertEq({ d: gold.delta, sk: gold.sourceKeys }, { d: 6, sk: ["s1"] }, "어댑터+computeCouponAccruals: per(2)×수량(3)=6");
}

// ── 3) 기간 필터 ───────────────────────────────────────────────────────
const timed: CouponBackfillEntry[] = [
  entry({ sourceKey: "in1", donateTimeText: "2026-07-05 12:00:00" }),
  entry({ sourceKey: "before", donateTimeText: "2026-06-20 10:00:00" }),
  entry({ sourceKey: "bad", donateTimeText: "" }), // 해석 실패
  entry({ sourceKey: "in2", donateTimeText: "2026-07-31 23:00:00" }),
];

// 기간 미지정 → 전체 통과, 실패 카운트 0(필터 안 하므로 bad 도 포함).
{
  const r = filterCouponEntriesByPeriod(timed, {});
  assertEq({ n: r.included.length, fail: r.parseFailedCount }, { n: 4, fail: 0 }, "기간 미지정 → 전체 통과");
}
// 이번 달 범위 → in1·in2 만, before 제외, bad 는 해석 실패로 별도 카운트+제외.
{
  const r = filterCouponEntriesByPeriod(timed, { from: "2026-07-01T00:00", to: "2026-07-31T23:59" });
  assertEq(
    { keys: r.included.map((e) => e.sourceKey).sort(), fail: r.parseFailedCount, fromIso: r.fromIso },
    { keys: ["in1", "in2"], fail: 1, fromIso: "2026-07-01T00:00:00+09:00" },
    "기간 지정 → 범위 내만 + 해석 실패 별도 카운트",
  );
}
// from 만 지정(하한만) → 7월 것 통과, 6월 제외, bad 실패.
{
  const r = filterCouponEntriesByPeriod(timed, { from: "2026-07-01T00:00" });
  assertEq({ keys: r.included.map((e) => e.sourceKey).sort(), fail: r.parseFailedCount }, { keys: ["in1", "in2"], fail: 1 }, "from 만 지정(하한)");
}
// to 만 지정(상한) → 07-10 이전만(in1·before), in2(07-31) 제외, bad 실패.
{
  const r = filterCouponEntriesByPeriod(timed, { to: "2026-07-10T00:00" });
  assertEq({ keys: r.included.map((e) => e.sourceKey).sort(), fail: r.parseFailedCount }, { keys: ["before", "in1"], fail: 1 }, "to 만 지정(상한)");
}

// ── 4) 재적립 제외(이미 자동 적립된 sourceKey) — 필터 후 남은 것만 계산 ──
{
  const included = filterCouponEntriesByPeriod(timed, { from: "2026-07-01T00:00", to: "2026-07-31T23:59" }).included;
  const alreadyAccrued = new Set(["in1"]); // in1 은 이미 적립됨
  const fresh = included.filter((e) => !alreadyAccrued.has(e.sourceKey));
  assertEq(fresh.map((e) => e.sourceKey), ["in2"], "재적립 제외: 이미 적립된 in1 빠지고 in2 만 남음");
}

// ── 5) 수동/자동 분리 집계(참고값) ─────────────────────────────────────
{
  const agg = aggregateCouponEventsBySource([
    { viewerKey: "aaa", itemKey: "gold", delta: 2, createdBy: "auto" },
    { viewerKey: "aaa", itemKey: "gold", delta: 3, createdBy: "streamer_admin" },
    { viewerKey: "aaa", itemKey: "gold", delta: -1, createdBy: "streamer_admin" }, // 사용(−) 포함
    { viewerKey: "bbb", itemKey: "silver", delta: 5, createdBy: "auto" },
    { viewerKey: "", itemKey: "gold", delta: 9, createdBy: "auto" }, // 빈 viewerKey 무시
  ]);
  const goldA = agg.find((a) => a.viewerKey === "aaa" && a.itemKey === "gold")!;
  const silverB = agg.find((a) => a.viewerKey === "bbb" && a.itemKey === "silver")!;
  assertEq({ m: goldA.manual, a: goldA.auto }, { m: 2, a: 2 }, "aaa/gold: 수동 3-1=2, 자동 2");
  assertEq({ m: silverB.manual, a: silverB.auto }, { m: 0, a: 5 }, "bbb/silver: 수동 0, 자동 5");
  assertEq(agg.length, 2, "빈 viewerKey 이벤트는 집계에서 무시");
}

console.log("coupon backfill: 전부 통과");
