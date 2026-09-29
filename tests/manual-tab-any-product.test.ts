// 수동기록 탭 고르기 전면 개방(2026-09-29, 루빗 건의) — lib/fanPastTab resolveHoldingTabRid.
// 핵심 보장: ① 수동기록에 스트리머가 정한 탭(힌트)이 있으면 표에 있는 상품이어도(룰렛이 보관돼도) 그 탭
//           ② 힌트가 없으면 상품명이 지금 표에 있을 때 그 룰렛 탭, 보관 룰렛이면 숨김(null) — 기존 경로 그대로
//           ③ 둘 다 없으면 되짚기(같은 금액대 탭 / «이전 표 · L» / 기타) — 9/20 규칙 그대로
import test from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_TAB_KEY,
  pastTabKey,
  resolveHoldingTabRid,
  resolvePastTabRid,
  type PastTabContext,
} from "../lib/fanPastTab";
import { customTabKey } from "../lib/manualTabHint";

// 현재 표: 금액대 "1000" 룰렛(rid r1000, 상품 A·B), 금액대 "추석" 룰렛(rid rChuseok, 상품 노래 1절·방문권).
function ctx(): PastTabContext {
  return {
    labelRids: new Map([
      ["1000", ["r1000"]],
      ["추석", ["rChuseok"]],
    ]),
    groupItemsByRid: new Map([
      ["r1000", [["A", "B"]]],
      ["rChuseok", [["노래 1절", "방문권"]]],
    ]),
    oldGroups: new Map([
      ["7:0", { label: "1000", items: ["A", "B"] }],
      ["7:1", { label: "추석", items: ["노래 1절", "방문권"] }],
    ]),
  };
}
const chuseok = { rid: "rChuseok" };

test("① 표 상품 + 힌트(내가 만든 탭) → 힌트 탭 (루빗: 추석 한정 상품을 «이벤트» 탭으로)", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석", tabHint: { kind: "custom", name: "이벤트" } },
    chuseok,
    ctx(),
  );
  assert.equal(rid, customTabKey("이벤트"));
});

test("① 표 상품 + 힌트(다른 룰렛 탭 라벨) → 그 룰렛 탭", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석", tabHint: { kind: "label", label: "1000" } },
    chuseok,
    ctx(),
  );
  assert.equal(rid, "r1000");
});

test("① 상품의 룰렛이 보관돼도 힌트가 있으면 힌트 탭에 보인다(리뷰 2026-09-29 #1, sy 규칙=스트리머가 정한 탭 우선)", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석", tabHint: { kind: "custom", name: "이벤트" } },
    { rid: "rChuseok", archived: true },
    ctx(),
  );
  assert.equal(rid, customTabKey("이벤트"));
});

test("② 표 상품 + 힌트 없음 → 상품이 정한 탭(기존 경로)", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석", tabHint: null },
    chuseok,
    ctx(),
  );
  assert.equal(rid, "rChuseok");
  // undefined 도 같다(자동수집 행은 tabHint 키 자체가 없다).
  assert.equal(
    resolveHoldingTabRid({ catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석" }, chuseok, ctx()),
    "rChuseok",
  );
});

test("② 보관 룰렛 상품 + 힌트 없음 → 숨김(null) — 기존 동작 그대로", () => {
  assert.equal(
    resolveHoldingTabRid(
      { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석" },
      { rid: "rChuseok", archived: true },
      ctx(),
    ),
    null,
  );
});

test("③ 표에 없는 상품(직접 입력) + 힌트 없음 → 기타 (9/21 불변 조건 2 그대로)", () => {
  const item = { catalogVersion: null, catalogGroupIndex: null, amountRangeLabel: "", tabHint: null };
  assert.equal(resolveHoldingTabRid(item, undefined, ctx()), OTHER_TAB_KEY);
  assert.equal(resolveHoldingTabRid(item, undefined, ctx()), resolvePastTabRid(item, ctx()));
});

test("③ 옛 표 상품(현재 표에 이름 없음) + 힌트 없음 → 되짚기 결과와 동일", () => {
  const c = ctx();
  // 옛 버전 5 그룹 0: 라벨 "5000"(현재 표에 없는 금액대) → «이전 표 · 5000».
  c.oldGroups.set("5:0", { label: "5000", items: ["옛상품"] });
  const item = { catalogVersion: 5, catalogGroupIndex: 0, amountRangeLabel: "5000" };
  assert.equal(resolveHoldingTabRid(item, undefined, c), resolvePastTabRid(item, c));
  assert.equal(resolveHoldingTabRid(item, undefined, c), pastTabKey("5000"));
});

test("① 직접 입력 상품 이름이 지금 표 상품명과 같아도 힌트가 있으면 힌트 탭(9/21 '힌트 무시'를 푼 지점)", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: null, catalogGroupIndex: null, amountRangeLabel: "", tabHint: { kind: "custom", name: "핀볼" } },
    chuseok,
    ctx(),
  );
  assert.equal(rid, customTabKey("핀볼"));
});

test("힌트 label 이 지금 표에서 사라진 금액대면 «이전 표 · L» (resolveHintedTabRid 규칙)", () => {
  const rid = resolveHoldingTabRid(
    { catalogVersion: 7, catalogGroupIndex: 1, amountRangeLabel: "추석", tabHint: { kind: "label", label: "9999" } },
    chuseok,
    ctx(),
  );
  assert.equal(rid, pastTabKey("9999"));
});
