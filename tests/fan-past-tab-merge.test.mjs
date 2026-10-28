// 2026-10-28 땜질: "이전 표 · L" 탭을 "지난 룰렛"(past:*) 한 탭으로 합치기 — lib/fanPastTab.ts 순수 규칙 테스트
import test from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_TAB_KEY,
  PAST_MERGED_DEFAULT_NAME,
  PAST_MERGED_LABEL,
  isPastTabKey,
  mergePastTabKey,
  pastLabelOfKey,
  pastTabDefaultName,
  pastTabKey,
  pastTabLabel,
  resolvePastTabRid,
  sortPastLabels,
} from "../lib/fanPastTab.ts";
import { customTabKey } from "../lib/manualTabHint.ts";

test("mergePastTabKey: past:L 은 전부 past:* 로, 나머지는 그대로", () => {
  assert.equal(mergePastTabKey(pastTabKey("445")), pastTabKey(PAST_MERGED_LABEL));
  assert.equal(mergePastTabKey(pastTabKey("33~50")), "past:*");
  assert.equal(mergePastTabKey("past:*"), "past:*"); // 멱등
  assert.equal(mergePastTabKey("named:0"), "named:0");
  assert.equal(mergePastTabKey("auto:4"), "auto:4");
  assert.equal(mergePastTabKey(OTHER_TAB_KEY), OTHER_TAB_KEY);
  assert.equal(mergePastTabKey(customTabKey("봄 이벤트")), customTabKey("봄 이벤트"));
  assert.equal(mergePastTabKey("__fixed__"), "__fixed__");
});

test("합친 키도 past 키로 인식되고 라벨은 * 다", () => {
  const k = mergePastTabKey(pastTabKey("1000"));
  assert.equal(isPastTabKey(k), true);
  assert.equal(pastLabelOfKey(k), PAST_MERGED_LABEL);
  assert.deepEqual(sortPastLabels([PAST_MERGED_LABEL]), ["*"]);
});

test("표시 이름: 합친 탭 기본 '지난 룰렛', 이름 오버레이가 있으면 그 이름", () => {
  assert.equal(pastTabDefaultName(PAST_MERGED_LABEL), PAST_MERGED_DEFAULT_NAME);
  assert.equal(pastTabDefaultName("445"), "이전 표 · 445"); // 옛 라벨별 기본 이름은 그대로(관리자 목록 호환)
  assert.equal(pastTabLabel(PAST_MERGED_LABEL), "지난 룰렛");
  assert.equal(pastTabLabel(PAST_MERGED_LABEL, { "*": "끝난 이벤트" }), "끝난 이벤트");
  assert.equal(pastTabLabel(PAST_MERGED_LABEL, { "*": "   " }), "지난 룰렛"); // 공백 이름은 기본으로
  assert.equal(pastTabLabel(PAST_MERGED_LABEL, { "445": "서버 한정" }), "지난 룰렛"); // 옛 라벨 이름은 합친 탭에 안 붙는다
});

test("되짚기 결과가 여러 L 로 갈려도 합치면 한 키 — 깡총총 사례(445·1000·35)", () => {
  const ctx = {
    labelRids: new Map([["330", ["auto:4"]]]), // 지금 표에는 330 만 있다
    groupItemsByRid: new Map([["auto:4", [["곰인형", "쿠션"]]]]),
    oldGroups: new Map([
      ["14:0", { label: "445", items: ["서버한정 흑발 방셀 단컷", "정성방송국편지"] }],
      ["15:0", { label: "1000", items: ["서버한정 은발 방셀 단컷", "방셀 단컷 A"] }],
      ["16:2", { label: "35", items: ["얼빡 방셀"] }],
    ]),
  };
  const rids = [
    resolvePastTabRid({ catalogVersion: 14, catalogGroupIndex: 0, amountRangeLabel: "445" }, ctx),
    resolvePastTabRid({ catalogVersion: 15, catalogGroupIndex: 0, amountRangeLabel: "1000" }, ctx),
    resolvePastTabRid({ catalogVersion: 16, catalogGroupIndex: 2, amountRangeLabel: "35" }, ctx),
  ];
  assert.deepEqual(rids, ["past:445", "past:1000", "past:35"]); // 라벨별 판정은 그대로
  assert.deepEqual(new Set(rids.map(mergePastTabKey)), new Set(["past:*"])); // 탭은 하나
  // 기타·지금 표 탭으로 가는 조각은 합치기에 영향받지 않는다
  assert.equal(mergePastTabKey(resolvePastTabRid({ catalogVersion: null, catalogGroupIndex: null }, ctx)), OTHER_TAB_KEY);
  assert.equal(mergePastTabKey(resolvePastTabRid({ catalogVersion: 14, catalogGroupIndex: 0, amountRangeLabel: "330" }, ctx)), "auto:4");
});

test("수동기록 라벨 힌트가 past:L 로 떨어져도 합쳐진다(resolveHoldingTabRid 경로)", async () => {
  const { resolveHoldingTabRid } = await import("../lib/fanPastTab.ts");
  const ctx = { labelRids: new Map(), groupItemsByRid: new Map(), oldGroups: new Map() };
  const rid = resolveHoldingTabRid({ tabHint: { kind: "label", label: "77" } }, undefined, ctx);
  assert.equal(rid, "past:77");
  assert.equal(mergePastTabKey(rid), "past:*");
  // 힌트가 '표에 없음'·직접 입력이면 합치기와 무관
  assert.equal(mergePastTabKey(resolveHoldingTabRid({ tabHint: { kind: "other" } }, undefined, ctx)), OTHER_TAB_KEY);
  assert.equal(mergePastTabKey(resolveHoldingTabRid({ tabHint: { kind: "custom", name: "봄" } }, undefined, ctx)), customTabKey("봄"));
  // 보관 룰렛 상품(힌트 없음)은 여전히 숨김(null) — 합치기 전에 걸러진다
  assert.equal(resolveHoldingTabRid({}, { rid: "named:0", archived: true }, ctx), null);
});

test("sanitizeFanTabLabels 가 합친 탭 이름 키 '*' 를 받아들인다", async () => {
  const { sanitizeFanTabLabels } = await import("../lib/upboSupabase.ts");
  const out = sanitizeFanTabLabels({ entries: [], pastLabels: { "*": " 끝난 이벤트 ", "445": "서버 한정" } });
  assert.equal(out.pastLabels?.["*"], "끝난 이벤트");
  assert.equal(out.pastLabels?.["445"], "서버 한정");
});
