// 팬 탭 이름 오버레이 정제 — pastLabels("이전 표 · L" 탭 이름) 추가분(2026-09-20).
// 기존 entries/order/fixedLabel/otherLabel 정제는 그대로이고, pastLabels 만 새로 정제한다.
import test, { before } from "node:test";
import assert from "node:assert/strict";

type Lib = typeof import("../lib/upboSupabase");
let sanitizeFanTabLabels: Lib["sanitizeFanTabLabels"];
before(async () => {
  // lib/upboSupabase 는 import 시점에 env 를 읽는다(query-diet.test.ts 와 같은 방식).
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  ({ sanitizeFanTabLabels } = await import("../lib/upboSupabase"));
});

test("pastLabels: 키·값 trim, 빈 값 제거, 값 30자·키 40자 제한", () => {
  const out = sanitizeFanTabLabels({
    entries: [],
    pastLabels: {
      " 330 ": "  2025 여름  ",
      "1000": "",
      "77": "   ",
      "500": "가".repeat(45),
      ["9".repeat(41)]: "너무 긴 키",
      "33~50": 123,
    },
  });
  assert.deepEqual(out.pastLabels, { "330": "2025 여름", "500": "가".repeat(30) });
});

test("pastLabels: 없거나 빈 객체·배열·문자열이면 필드 자체를 넣지 않는다(기존 payload 모양 불변)", () => {
  assert.equal("pastLabels" in sanitizeFanTabLabels({ entries: [] }), false);
  assert.equal("pastLabels" in sanitizeFanTabLabels({ entries: [], pastLabels: {} }), false);
  assert.equal("pastLabels" in sanitizeFanTabLabels({ entries: [], pastLabels: [] }), false);
  assert.equal("pastLabels" in sanitizeFanTabLabels({ entries: [], pastLabels: "330" }), false);
  assert.equal("pastLabels" in sanitizeFanTabLabels({ entries: [], pastLabels: { "330": "" } }), false);
});

test("pastLabels: 최대 50키", () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 60; i++) many[String(i)] = `이름${i}`;
  const out = sanitizeFanTabLabels({ entries: [], pastLabels: many });
  assert.equal(Object.keys(out.pastLabels ?? {}).length, 50);
});

test("기존 필드는 그대로 정제된다(pastLabels 와 독립)", () => {
  const out = sanitizeFanTabLabels({
    entries: [{ name: " 봄 ", groups: [["곰인형", "쿠션"]] }],
    order: [{ kind: "fixed" }, { kind: "tab", groups: [["곰인형", "쿠션"]] }, { kind: "other" }],
    fixedLabel: " 시그 ",
    otherLabel: "",
    pastLabels: { "330": "옛날" },
  });
  assert.deepEqual(out.entries, [{ name: "봄", groups: [["곰인형", "쿠션"]] }]);
  assert.deepEqual(out.order, [{ kind: "fixed" }, { kind: "tab", groups: [["곰인형", "쿠션"]] }, { kind: "other" }]);
  assert.equal(out.fixedLabel, "시그");
  assert.equal(out.otherLabel, undefined);
  assert.deepEqual(out.pastLabels, { "330": "옛날" });
});
