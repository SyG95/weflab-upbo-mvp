// 수동기록 겹침 의심(1단계 묶음 3, G11) — PHASE1-TEST-PLAN.md §3-3 + 2026-10-27 리뷰(늦게 적은 날짜·연결 이름).
import test from "node:test";
import assert from "node:assert/strict";
import { findManualOverlaps, type ManualOverlapEntry } from "../lib/manualOverlap";

const row = { fanId: "viewer07", fanNickname: "시청자07", itemName: "사진10장", donateTimeText: "2026-10-21 19:12:40" };
const m = (patch: Partial<ManualOverlapEntry>): ManualOverlapEntry => ({
  id: "m1",
  fanId: "viewer07",
  fanNickname: "시청자07",
  itemName: "사진10장",
  donateTimeText: "2026-10-20 12:00",
  remaining: 1,
  ...patch,
});

test("강한 의심: 계정ID 같음 + 상품 알맹이 같음(그림문자 무시) + 날짜 ±1일", () => {
  const hit = findManualOverlaps(row, [m({ itemName: "💜사진10장" })]);
  assert.equal(hit?.level, "strong");
  assert.equal(hit?.summary, "10/20 수동기록(💜사진10장 ×1)");
  assert.equal(findManualOverlaps(row, [m({ fanId: "(viewer07)" })])?.level, "strong", "옛 괄호 표기 계정ID도 같은 사람");
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-22 12:00" })])?.level, "strong");
});

test("날짜: 후원 전 2일 이상은 의심 안 함, 후원 뒤 30일 안에 적은 날짜는 약한 의심(늦게 발견해 기록한 날)", () => {
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-19 23:59" })]), null);
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-24 12:00" })])?.level, "weak");
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-11-20 12:00" })])?.level, "weak", "30일째");
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-11-21 12:00" })]), null, "31일째");
});

test("수동기록을 만든 시각이 후원 뒤면 날짜 칸과 무관하게 약한 의심", () => {
  const hit = findManualOverlaps(row, [m({ donateTimeText: "2026-10-01 12:00", createdAt: "2026-10-25T01:00:00.000Z" })]);
  assert.equal(hit?.level, "weak");
  assert.equal(findManualOverlaps(row, [m({ donateTimeText: "2026-10-01 12:00", createdAt: "2026-10-02T01:00:00.000Z" })]), null);
});

test("날짜 없는 수동기록은 기간과 무관하게 의심", () => {
  const hit = findManualOverlaps(row, [m({ donateTimeText: "" })]);
  assert.equal(hit?.level, "strong");
  assert.ok(hit?.summary.startsWith("날짜 없는 수동기록"));
});

test("약한 의심: 상품 이름 포함 관계 / 계정ID 없는 수동기록의 닉네임 일치", () => {
  assert.equal(findManualOverlaps(row, [m({ itemName: "사진10장 세트" })])?.level, "weak");
  assert.equal(findManualOverlaps(row, [m({ fanId: "" })])?.level, "weak", "닉네임만 있는 줄");
  assert.equal(findManualOverlaps(row, [m({ fanId: "", fanNickname: "다른사람" })]), null);
  assert.equal(findManualOverlaps(row, [m({ fanId: "someoneelse" })]), null, "계정ID가 다르면 닉네임이 같아도 다른 사람");
  assert.equal(findManualOverlaps(row, [m({ itemName: "손편지" })]), null);
});

test("상품 이름은 원본·그때 칸·연결 대상 중 하나라도 맞으면 같은 상품(수동기록을 새 이름으로 적은 경우)", () => {
  const manual = [m({ itemName: "사진 1장" })];
  assert.equal(findManualOverlaps(row, manual), null, "원본 이름만으로는 다른 상품");
  assert.equal(findManualOverlaps({ ...row, itemNames: ["사진10장", "사진 1장"] }, manual)?.level, "strong");
});

test("취소 반영 남은 개수 0 이면 제외, 강한 의심이 약한 의심보다 먼저", () => {
  assert.equal(findManualOverlaps(row, [m({ remaining: 0 })]), null);
  const both = findManualOverlaps(row, [m({ id: "weak", itemName: "사진10장 세트" }), m({ id: "strong" })]);
  assert.equal(both?.manualEntryId, "strong");
});
