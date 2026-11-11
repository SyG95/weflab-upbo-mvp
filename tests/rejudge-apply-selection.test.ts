// 관문 2 화면 상태(순수): 🟢 기본 체크·🟡 해제, 화면에 그린 줄만 고를 수 있음, 줄 위치 표지 순서 = 미리보기 정렬 순서.
import test from "node:test";
import assert from "node:assert/strict";
import {
  approxApplyMessage,
  approxCursorOf,
  approxSelection,
  carryApproxPicks,
  compareApproxCursor,
  isApproxRowPicked,
  type ApproxRowLike,
} from "../lib/rejudgeApplySelection";

const row = (sourceKey: string, kind: ApproxRowLike["kind"], cls: string, timeMs: number | null): ApproxRowLike => ({ sourceKey, kind, cls, timeMs });

const G1 = row("g1::0", "new", "green", 1000);
const G2 = row("g2::0", "new", "green", 2000);
const Y1 = row("y1::0", "new", "yellow", 500);
const O1 = row("o1::0", "outside", "orange", 100);
const S1 = row("s1::0", "suspected", "grey", 50);

test("기본: 🟢 체크·🟡 해제, 🟠·오기록 의심은 고를 수 없음", () => {
  const out = approxSelection([G1, G2, Y1, S1], {});
  assert.deepEqual(out.keys, ["g1::0", "g2::0"]);
  assert.deepEqual(out.seenThrough, { o: 3, t: 50, k: "s1::0" });
  assert.equal(isApproxRowPicked(O1, { "o1::0": true }), false);
  assert.equal(isApproxRowPicked(S1, { "s1::0": true }), false);
});

test("사람이 바꾼 체크가 이긴다(🟢 해제·🟡 체크)", () => {
  const out = approxSelection([G1, G2, Y1], { "g1::0": false, "y1::0": true });
  assert.deepEqual(out.keys, ["g2::0", "y1::0"]);
});

test("화면에 그린 줄만: 안 그린 🟢 는 안 들어가고, 표지는 마지막으로 그린 줄", () => {
  const out = approxSelection([G1], { "g2::0": true });
  assert.deepEqual(out.keys, ["g1::0"]);
  assert.deepEqual(out.seenThrough, approxCursorOf(G1));
  assert.deepEqual(approxSelection([], {}), { keys: [], seenThrough: null });
});

test("줄 위치 표지 순서 = 미리보기 정렬(🟢→🟡→🟠→의심, 시각, 못 읽은 시각은 뒤, 그다음 키)", () => {
  const G3 = row("g0::0", "new", "green", 1000); // G1 과 같은 시각 → 키 순
  const GN = row("gn::0", "new", "green", null); // 시각 모름 → 🟢 안에서 맨 뒤
  const shuffled = [S1, O1, Y1, GN, G2, G1, G3];
  const sorted = [...shuffled].sort((a, b) => compareApproxCursor(approxCursorOf(a), approxCursorOf(b)));
  assert.deepEqual(sorted.map((r) => r.sourceKey), ["g0::0", "g1::0", "g2::0", "gn::0", "y1::0", "o1::0", "s1::0"]);
  // "본 줄까지" 검사: 표지 이하인 줄만
  const seen = approxCursorOf(G2);
  assert.ok(compareApproxCursor(approxCursorOf(G1), seen) <= 0);
  assert.ok(compareApproxCursor(approxCursorOf(GN), seen) > 0);
  assert.ok(compareApproxCursor(approxCursorOf(Y1), seen) > 0);
});

test("넣기 결과 문구는 실제로 들어간 수로", () => {
  assert.equal(approxApplyMessage({ requested: 12, inserted: 10, alreadyExisted: 2 }), "요청 12건 중 10건 넣음, 2건은 이미 있었어요.");
  assert.equal(approxApplyMessage({ requested: 3, inserted: 3, alreadyExisted: 0 }), "요청 3건 중 3건 넣음.");
  assert.match(approxApplyMessage({ requested: 3, inserted: 3, alreadyExisted: 0, couponLinked: 1 }), /쿠폰 연결 상품 1건.*지난 당첨 가져오기/);
});

test("409 뒤 다시 불러올 때: 분류가 같은 줄은 사람이 고른 그대로, 바뀐 줄은 해제, 사라진 줄은 버리고 새 줄은 기본값", () => {
  const Y2 = row("y2::0", "new", "yellow", 600);
  const prevRows = [G1, G2, Y1, Y2, O1];
  // 사람: G1 해제, Y1 체크, Y2 체크(G2 는 기본 체크 그대로)
  const prevPicks = { "g1::0": false, "y1::0": true, "y2::0": true };
  const G2toY = row("g2::0", "new", "yellow", 2000); // 🟢 → 🟡 로 바뀜
  const Y2toG = row("y2::0", "new", "green", 600); // 🟡 → 🟢 로 바뀜
  const O1toNew = row("o1::0", "new", "yellow", 100); // 🟠 → 🟡
  const G9 = row("g9::0", "new", "green", 3000); // 새 줄
  const nextRows = [G1, G2toY, Y1, Y2toG, O1toNew, G9]; // (Y1 은 그대로, 사라진 줄 없음 대신 아래에서 따로)
  const carried = carryApproxPicks(prevRows, prevPicks, nextRows);
  assert.deepEqual(carried, { "g1::0": false, "g2::0": false, "y1::0": true, "y2::0": false, "o1::0": false });
  const { keys } = approxSelection(nextRows, carried);
  assert.deepEqual(keys, ["y1::0", "g9::0"], "사람이 고른 🟡 와 새 🟢 만, 분류 바뀐 줄은 해제");
  // 사라진 줄의 선택은 남지 않는다
  assert.deepEqual(carryApproxPicks(prevRows, prevPicks, [G2]), {});
});

test("분류는 같아도 근거(이유·꼬리표·수동기록 겹침·판정 세트)가 바뀌면 사람 선택을 버린다 — 🟡 해제, 🟢 는 기본 체크", () => {
  const judged = { version: 3, groupIndex: 0, amountRangeLabel: "33", itemName: "사진", storeItemName: "사진", probability: 2, threshold: 10 };
  const Ya = { ...row("ya::0", "new", "yellow", 100), reasonText: "정가 금액과 같아요", reasons: ["정가 금액과 같아요"], tags: [], manualOverlap: null, judged };
  const Yb = { ...row("yb::0", "new", "yellow", 200), reasonText: "정가 금액과 같아요", reasons: ["정가 금액과 같아요"], tags: [], manualOverlap: null, judged };
  const Gc = { ...row("gc::0", "new", "green", 300), reasonText: "그때 표·기준과 정확히 맞아요", reasons: [], tags: [], manualOverlap: null, judged };
  const Gd = { ...row("gd::0", "new", "green", 400), reasonText: "그때 표·기준과 정확히 맞아요", reasons: [], tags: [], manualOverlap: null, judged };
  const picks = { "ya::0": true, "yb::0": true, "gc::0": false, "gd::0": false };
  const overlap = { level: "strong", manualEntryId: "m1", summary: "10/20 수동기록(사진 ×1)" };
  const next = [
    // ya: 그사이 수동기록이 생겨 겹침 이유가 붙었다(분류는 🟡 그대로)
    { ...Ya, reasons: [...Ya.reasons, `수동기록과 같은 건일 수 있어요: ${overlap.summary}`], manualOverlap: overlap },
    Yb, // 그대로
    { ...Gc, judged: { ...judged, version: 4 } }, // 🟢 그대로지만 판정 버전이 바뀜 → 기본 체크
    Gd, // 그대로 → 사람이 해제한 것 유지
  ];
  const carried = carryApproxPicks([Ya, Yb, Gc, Gd], picks, next);
  assert.deepEqual(carried, { "ya::0": false, "yb::0": true, "gd::0": false });
  assert.deepEqual(approxSelection(next, carried).keys, ["yb::0", "gc::0"]);
  // 꼬리표만 바뀌어도(예: 팬 화면 숨김) 근거가 바뀐 것
  assert.deepEqual(carryApproxPicks([Yb], { "yb::0": true }, [{ ...Yb, tags: ["넣어도 팬 화면엔 안 보여요"] }]), { "yb::0": false });
});
