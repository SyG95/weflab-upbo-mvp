// 팬 탭 되짚기(1단계-a) 순수 규칙 테스트 — lib/fanPastTab.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  OTHER_TAB_KEY,
  PAST_TAB_PREFIX,
  insertPastAfterRoulettes,
  isPastTabKey,
  jaccard,
  oldGroupKey,
  pastLabelOfKey,
  pastTabKey,
  pastTabLabel,
  resolvePastTabRid,
  sortPastLabels,
} from "../lib/fanPastTab.ts";

// 현재 표(활성): 330 = named:0(곰인형·쿠션), 1000 = named:1(키링·스티커·포토카드)
// 500 은 두 룰렛에 있음(rule 4 용): auto:2(텀블러·머그·엽서) · auto:3(모자·양말·장갑)
// 3000 은 보관 룰렛(named:9)에만 있음 → labelRids 에서 빠져 있어야 한다(호출측 규칙).
function ctx() {
  return {
    labelRids: new Map([
      ["330", ["named:0"]],
      ["1000", ["named:1", "named:1"]], // 중복은 제거되어 1개로 본다
      ["500", ["auto:2", "auto:3"]],
    ]),
    groupItemsByRid: new Map([
      ["named:0", [["곰인형", "쿠션"]]],
      ["named:1", [["키링", "스티커"], ["포토카드"]]],
      ["auto:2", [["텀블러", "머그", "엽서"]]],
      ["auto:3", [["모자", "양말", "장갑"]]],
      ["named:9", [["옛한정판"]]],
    ]),
    oldGroups: new Map([
      [oldGroupKey(3, 0), { label: "330", items: ["곰인형", "옛쿠션"] }],
      [oldGroupKey(3, 1), { label: "500", items: ["텀블러", "머그", "옛엽서"] }], // auto:2 와 2/4 = 0.5
      [oldGroupKey(3, 2), { label: "500", items: ["전혀", "다른", "구성"] }],
      [oldGroupKey(3, 3), { label: "", items: ["라벨없음"] }],
      [oldGroupKey(3, 4), { label: "77", items: ["단종상품"] }],
      [oldGroupKey(3, 5), { label: "3000", items: ["옛한정판"] }],
      [oldGroupKey(3, 6), { label: "500", items: ["텀블러", "머그", "옛엽서", "옛스티커", "옛키링"] }], // 2/6 < 0.5
    ]),
  };
}

test("자카드 경계", () => {
  assert.equal(jaccard([], []), 1, "둘 다 비면 1");
  assert.equal(jaccard(["a"], []), 0, "한쪽만 비면 0");
  assert.equal(jaccard(["a", "b"], ["b", "c"]), 1 / 3);
  assert.equal(jaccard(new Set(["a", "b"]), ["a", "b", "c", "d"]), 0.5, "Set 입력도 같은 값");
  assert.equal(jaccard(["a", "a", "b"], ["a", "b"]), 1, "중복 원소는 집합으로");
});

test("규칙 1: (버전, 그룹) 없으면 기타(현행 유지)", () => {
  const c = ctx();
  assert.equal(resolvePastTabRid({ catalogVersion: null, catalogGroupIndex: null, amountRangeLabel: "330" }, c), OTHER_TAB_KEY);
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: null, amountRangeLabel: "330" }, c), OTHER_TAB_KEY);
  assert.equal(resolvePastTabRid({ catalogVersion: undefined, catalogGroupIndex: 0, amountRangeLabel: "330" }, c), OTHER_TAB_KEY);
  assert.equal(resolvePastTabRid({}, c), OTHER_TAB_KEY);
});

test("규칙 2: 라벨은 기록 라벨 → 옛 그룹 라벨 순 폴백, 둘 다 없으면 기타", () => {
  const c = ctx();
  // 기록에 라벨이 없고 옛 그룹 라벨 330 → named:0
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 0, amountRangeLabel: "" }, c), "named:0");
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 0 }, c), "named:0");
  // 기록 라벨이 있으면 옛 그룹 라벨보다 우선(공백은 trim)
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 0, amountRangeLabel: " 1000 " }, c), "named:1");
  // 옛 그룹 자체를 모르면(버전이 state.catalogs 에 없음) 기록 라벨만으로 진행
  assert.equal(resolvePastTabRid({ catalogVersion: 99, catalogGroupIndex: 7, amountRangeLabel: "330" }, c), "named:0");
  // 둘 다 없음 → 기타
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 3, amountRangeLabel: "" }, c), OTHER_TAB_KEY);
  assert.equal(resolvePastTabRid({ catalogVersion: 99, catalogGroupIndex: 7, amountRangeLabel: "  " }, c), OTHER_TAB_KEY);
});

test("규칙 3: 같은 라벨의 비보관 rid 가 정확히 1개면 그 rid(중복 rid 는 1개로)", () => {
  const c = ctx();
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 0, amountRangeLabel: "330" }, c), "named:0");
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 0, amountRangeLabel: "1000" }, c), "named:1");
});

test("규칙 4: 후보 2개 이상이면 옛 그룹 상품 자카드 ≥ 0.5 인 rid, 미만이면 past:L", () => {
  const c = ctx();
  // 2/4 = 0.5 → 경계 포함 → auto:2
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 1, amountRangeLabel: "500" }, c), "auto:2");
  // 2/6 < 0.5 → past:500
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 6, amountRangeLabel: "500" }, c), "past:500");
  // 전혀 다른 구성 → past:500
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 2, amountRangeLabel: "500" }, c), "past:500");
  // 옛 그룹을 모르면(상품명 비교 불가) → past:500
  assert.equal(resolvePastTabRid({ catalogVersion: 99, catalogGroupIndex: 7, amountRangeLabel: "500" }, c), "past:500");
});

test("규칙 5: 같은 라벨의 후보가 0개면 past:L (단종 금액대)", () => {
  const c = ctx();
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 4, amountRangeLabel: "77" }, c), "past:77");
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 4 }, c), "past:77", "옛 그룹 라벨 폴백으로도 past");
});

test("보관 rid 제외: 라벨이 보관 룰렛에만 있으면(labelRids 에 없음) past:L, 색인엔 안 넣는다", () => {
  const c = ctx();
  // 3000 은 보관 룰렛(named:9)에만 있어 호출측이 labelRids 에 넣지 않는다 → past:3000
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 5, amountRangeLabel: "3000" }, c), "past:3000");
  // 상품명이 같아도(옛한정판) groupItemsByRid 만으로는 절대 rid 를 고르지 않는다(labelRids 가 문).
  assert.equal(resolvePastTabRid({ catalogVersion: 3, catalogGroupIndex: 5 }, c), "past:3000");
});

test("입력 불변: ctx 와 item 을 바꾸지 않는다", () => {
  const c = ctx();
  const before = JSON.stringify([...c.labelRids], null, 0) + JSON.stringify([...c.oldGroups]);
  const item = { catalogVersion: 3, catalogGroupIndex: 1, amountRangeLabel: "500" };
  const itemBefore = JSON.stringify(item);
  resolvePastTabRid(item, c);
  assert.equal(JSON.stringify([...c.labelRids], null, 0) + JSON.stringify([...c.oldGroups]), before);
  assert.equal(JSON.stringify(item), itemBefore);
});

test("past 키·라벨 헬퍼", () => {
  assert.equal(pastTabKey("330"), `${PAST_TAB_PREFIX}330`);
  assert.equal(isPastTabKey("past:330"), true);
  assert.equal(isPastTabKey("past:"), false, "빈 라벨은 past 키가 아니다");
  assert.equal(isPastTabKey("named:0"), false);
  assert.equal(isPastTabKey("__other__"), false);
  assert.equal(pastLabelOfKey("past:33~50"), "33~50");
  assert.equal(pastLabelOfKey("named:0"), "");
  assert.equal(pastTabLabel("330"), "이전 표 · 330", "기본 이름");
  assert.equal(pastTabLabel("330", undefined), "이전 표 · 330");
  assert.equal(pastTabLabel("330", { "330": "2025 여름" }), "2025 여름", "관리자 이름 우선");
  assert.equal(pastTabLabel("330", { "330": "   " }), "이전 표 · 330", "공백 이름은 기본으로");
  assert.equal(pastTabLabel("330", { "1000": "다른탭" }), "이전 표 · 330");
});

test("past 라벨 숫자순 정렬(중복 제거)", () => {
  assert.deepEqual(sortPastLabels(["1000", "330", "33~50", "330", "77"]), ["33~50", "77", "330", "1000"]);
});

test("시퀀스 순서: 룰렛 → past(숫자순) → 정가 → 기타", () => {
  const seq = [
    { kind: "roulette", rid: "named:0", label: "330" },
    { kind: "roulette", rid: "named:1", label: "1000" },
    { kind: "fixed" },
    { kind: "other" },
  ];
  const past = sortPastLabels(["1000", "77"]).map((L) => ({ kind: "past", rid: pastTabKey(L), label: L }));
  assert.deepEqual(
    insertPastAfterRoulettes(seq, past).map((s) => s.rid ?? s.kind),
    ["named:0", "named:1", "past:77", "past:1000", "fixed", "other"],
  );
  // 저장된 드래그 순서로 정가가 앞에 있어도 past 는 마지막 룰렛 뒤 고정.
  const dragged = [{ kind: "fixed" }, { kind: "roulette", rid: "named:0", label: "330" }, { kind: "other" }];
  assert.deepEqual(
    insertPastAfterRoulettes(dragged, past).map((s) => s.rid ?? s.kind),
    ["fixed", "named:0", "past:77", "past:1000", "other"],
  );
  // 룰렛이 없으면 맨 앞.
  assert.deepEqual(
    insertPastAfterRoulettes([{ kind: "fixed" }, { kind: "other" }], past).map((s) => s.rid ?? s.kind),
    ["past:77", "past:1000", "fixed", "other"],
  );
  // past 가 없으면 원본 그대로(새 배열).
  const same = insertPastAfterRoulettes(seq, []);
  assert.deepEqual(same, seq);
  assert.notEqual(same, seq);
});
