// 수동기록 "직접 입력" 탭 힌트(2026-09-21) — lib/manualTabHint 정제·키 + lib/upboSupabase mergeManualAdminNote.
// 핵심 보장: ① 힌트 모양이 아니면 null(= 힌트 없음 = 표에 없음)  ② 이름은 trim 후 30자, 라벨은 40자 초과면 거부
//           ③ admin_note 병합은 다른 키(exchangeGroupId 등)를 보존하고 undefined 는 키 삭제, 파싱 실패는 {} 에서 시작
import test, { before } from "node:test";
import assert from "node:assert/strict";
import {
  cleanManualTabHint,
  customNameOfKey,
  customTabKey,
  isCustomTabKey,
  sortCustomTabNames,
  storableManualTabHint,
} from "../lib/manualTabHint";

type Lib = typeof import("../lib/upboSupabase");
let mergeManualAdminNote: Lib["mergeManualAdminNote"];
before(async () => {
  // lib/upboSupabase 는 import 시점에 env 를 읽는다(fan-past-labels-sanitize.test.ts 와 같은 방식).
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  ({ mergeManualAdminNote } = await import("../lib/upboSupabase"));
});

test("clean 정상 3종: other / label(+rid) / custom", () => {
  assert.deepEqual(cleanManualTabHint({ kind: "other" }), { kind: "other" });
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: "330" }), { kind: "label", label: "330" });
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: " 1000 ", rid: "named:1" }), {
    kind: "label",
    label: "1000",
    rid: "named:1",
  });
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: "이벤트" }), { kind: "custom", name: "이벤트" });
  // 모르는 키는 버린다(저장 모양 고정).
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: "핀볼", extra: 1 }), { kind: "custom", name: "핀볼" });
  // rid 가 빈 문자열/비문자열이면 label 만 남긴다.
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: "330", rid: "  " }), { kind: "label", label: "330" });
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: "330", rid: 7 }), { kind: "label", label: "330" });
});

test("clean 불량 5종: 비객체·kind 외 값·빈 label·빈 name·label 40자 초과 → null", () => {
  assert.equal(cleanManualTabHint(null), null);
  assert.equal(cleanManualTabHint("custom:이벤트"), null);
  assert.equal(cleanManualTabHint([]), null);
  assert.equal(cleanManualTabHint({ kind: "past", label: "330" }), null);
  assert.equal(cleanManualTabHint({ kind: "label" }), null);
  assert.equal(cleanManualTabHint({ kind: "label", label: "   " }), null);
  assert.equal(cleanManualTabHint({ kind: "label", label: 330 }), null);
  assert.equal(cleanManualTabHint({ kind: "custom", name: "" }), null);
  assert.equal(cleanManualTabHint({ kind: "custom", name: "   " }), null);
  assert.equal(cleanManualTabHint({ kind: "custom" }), null);
  assert.equal(cleanManualTabHint({ kind: "label", label: "9".repeat(41) }), null);
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: "9".repeat(40) }), { kind: "label", label: "9".repeat(40) });
});

test("clean custom name: trim 후 30자로 자름(팬 탭 이름 오버레이와 같은 자리수)", () => {
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: "  이벤트  " }), { kind: "custom", name: "이벤트" });
  const long = "가".repeat(45);
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: long }), { kind: "custom", name: "가".repeat(30) });
  // trim 이 slice 보다 먼저 — 앞 공백이 자리수를 먹지 않는다.
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: "   " + "나".repeat(31) }), { kind: "custom", name: "나".repeat(30) });
});

test("storable: other/null/undefined 는 저장 생략(undefined), 나머지는 그대로", () => {
  assert.equal(storableManualTabHint(null), undefined);
  assert.equal(storableManualTabHint(undefined), undefined);
  assert.equal(storableManualTabHint({ kind: "other" }), undefined);
  assert.deepEqual(storableManualTabHint({ kind: "custom", name: "이벤트" }), { kind: "custom", name: "이벤트" });
  assert.deepEqual(storableManualTabHint({ kind: "label", label: "330", rid: "named:0" }), { kind: "label", label: "330", rid: "named:0" });
});

test("custom 탭 키 왕복 + 다른 키와 안 겹침", () => {
  assert.equal(customTabKey("이벤트"), "custom:이벤트");
  assert.equal(isCustomTabKey("custom:이벤트"), true);
  assert.equal(isCustomTabKey("custom:"), false, "빈 이름은 custom 키가 아니다");
  assert.equal(isCustomTabKey("past:330"), false);
  assert.equal(isCustomTabKey("named:0"), false);
  assert.equal(isCustomTabKey("__other__"), false);
  assert.equal(customNameOfKey("custom:핀볼 보상"), "핀볼 보상");
  assert.equal(customNameOfKey("named:0"), "");
  assert.equal(customNameOfKey(customTabKey("역팬")), "역팬");
});

test("custom 탭 이름 가나다순·중복 제거", () => {
  assert.deepEqual(sortCustomTabNames(["핀볼", "이벤트", "역팬", "이벤트", "10주년", "2주년"]), ["2주년", "10주년", "역팬", "이벤트", "핀볼"]);
  assert.deepEqual(sortCustomTabNames([]), []);
});

test("mergeManualAdminNote: 기존 키 보존(effectiveCount 만 바꿔도 tabHint·exchangeGroupId 유지)", () => {
  const existing = JSON.stringify({ effectiveCount: 2, tabHint: { kind: "custom", name: "이벤트" }, exchangeGroupId: "g-1" });
  assert.deepEqual(JSON.parse(mergeManualAdminNote(existing, { effectiveCount: 5 })), {
    effectiveCount: 5,
    tabHint: { kind: "custom", name: "이벤트" },
    exchangeGroupId: "g-1",
  });
  // 탭만 바꿔도 개수·다른 키 유지.
  assert.deepEqual(JSON.parse(mergeManualAdminNote(existing, { tabHint: { kind: "label", label: "330", rid: "named:0" } })), {
    effectiveCount: 2,
    tabHint: { kind: "label", label: "330", rid: "named:0" },
    exchangeGroupId: "g-1",
  });
});

test("mergeManualAdminNote: undefined 값은 키 삭제(표에 없음으로 되돌리기)", () => {
  const existing = JSON.stringify({ effectiveCount: 3, tabHint: { kind: "custom", name: "이벤트" } });
  assert.deepEqual(JSON.parse(mergeManualAdminNote(existing, { tabHint: undefined })), { effectiveCount: 3 });
  // 없는 키를 지워도 무해.
  assert.deepEqual(JSON.parse(mergeManualAdminNote(existing, { nope: undefined })), {
    effectiveCount: 3,
    tabHint: { kind: "custom", name: "이벤트" },
  });
  // null 은 값이다(삭제 아님) — 호출측은 storableManualTabHint 로 undefined 를 만든다.
  assert.deepEqual(JSON.parse(mergeManualAdminNote(existing, { tabHint: null })), { effectiveCount: 3, tabHint: null });
});

test("mergeManualAdminNote: 파싱 실패·빈 값·비객체는 {} 에서 시작", () => {
  assert.deepEqual(JSON.parse(mergeManualAdminNote(null, { effectiveCount: 4 })), { effectiveCount: 4 });
  assert.deepEqual(JSON.parse(mergeManualAdminNote("", { effectiveCount: 4 })), { effectiveCount: 4 });
  assert.deepEqual(JSON.parse(mergeManualAdminNote("메모 텍스트(옛 형식)", { effectiveCount: 4 })), { effectiveCount: 4 });
  assert.deepEqual(JSON.parse(mergeManualAdminNote("[1,2]", { effectiveCount: 4 })), { effectiveCount: 4 });
  assert.deepEqual(JSON.parse(mergeManualAdminNote("42", { effectiveCount: 4 })), { effectiveCount: 4 });
  // 결과는 항상 JSON 문자열(mapEntry 가 JSON.parse 로 읽는다).
  assert.equal(typeof mergeManualAdminNote(null, {}), "string");
  assert.deepEqual(JSON.parse(mergeManualAdminNote(null, {})), {});
});
