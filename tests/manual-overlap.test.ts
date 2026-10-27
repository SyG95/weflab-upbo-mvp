// 수동기록 겹침 의심(1단계 묶음 3, G11) — PHASE1-TEST-PLAN.md §3-3.
import test from "node:test";
import assert from "node:assert/strict";
import { findManualOverlaps, type ManualOverlapEntry } from "../lib/manualOverlap";

const row = { fanId: "viewer07", fanNickname: "시청자07", itemName: "역팬10개", donateTimeText: "2026-10-21 19:09:57" };
const m = (patch: Partial<ManualOverlapEntry>): ManualOverlapEntry => ({
  id: "m1",
  fanId: "viewer07",
  fanNickname: "시청자07",
  itemName: "역팬10개",
  donateTimeText: "2026-10-20 12:00",
  remaining: 1,
  ...patch,
});

test("강한 의심: 계정ID 같음 + 상품 알맹이 같음(그림문자 무시) + 날짜 ±1일", () => {
  const hit = findManualOverlaps(row, [m({ itemName: "💜역팬10개" })]);
  assert.equal(hit?.level, "strong");
  assert.equal(hit?.summary, "10/20 수동기록(💜역팬10개 ×1)");
  assert.equal(findManualOverlaps(row, [m({ fanId: "(viewer07)" })])?.level, "strong", "옛 괄호 표기 계정ID도 같은 사람");
});

test("날짜가 ±1일 밖이면 의심하지 않는다(KST 달력 기준)", () => {
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-19 23:59" })]), null);
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-22 12:00" })])?.level, "strong");
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-23 00:00" })]), null);
});

test("날짜 없는 수동기록은 기간과 무관하게 의심", () => {
  const hit = findManualOverlaps(row, [m({ donateTimeText: "" })]);
  assert.equal(hit?.level, "strong");
  assert.ok(hit?.summary.startsWith("날짜 없는 수동기록"));
});

test("약한 의심: 상품 이름 포함 관계 / 계정ID 없는 수동기록의 닉네임 일치", () => {
  assert.equal(findManualOverlaps(row, [m({ itemName: "역팬10개 세트" })])?.level, "weak");
  assert.equal(findManualOverlaps(row, [m({ fanId: "" })])?.level, "weak", "닉네임만 있는 줄");
  assert.equal(findManualOverlaps(row, [m({ fanId: "", fanNickname: "다른사람" })]), null);
  assert.equal(findManualOverlaps(row, [m({ fanId: "someoneelse" })]), null, "계정ID가 다르면 닉네임이 같아도 다른 사람");
  assert.equal(findManualOverlaps(row, [m({ itemName: "손편지" })]), null);
});

test("취소 반영 남은 개수 0 이면 제외, 강한 의심이 약한 의심보다 먼저", () => {
  assert.equal(findManualOverlaps(row, [m({ remaining: 0 })]), null);
  const both = findManualOverlaps(row, [m({ id: "weak", itemName: "역팬10개 세트" }), m({ id: "strong" })]);
  assert.equal(both?.manualEntryId, "strong");
});
