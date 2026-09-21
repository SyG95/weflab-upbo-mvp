// 팬 화면 구분 축 설정 정규화(normalizeFanAxisPrefs, 2026-09-21) — 기본값·부분 객체·타입 오류.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FAN_AXIS_PREFS, normalizeFanAxisPrefs } from "../lib/api";

test("기본값: 비어 있거나 객체가 아니면 둘 다 켬", () => {
  assert.deepEqual(DEFAULT_FAN_AXIS_PREFS, { monthRail: true, rouletteTabs: true });
  assert.deepEqual(normalizeFanAxisPrefs(undefined), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs(null), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs({}), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs("off"), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs(0), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs([]), DEFAULT_FAN_AXIS_PREFS);
});

test("부분 객체: 있는 항목만 반영, 없는 항목은 기본값", () => {
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: false }), { monthRail: false, rouletteTabs: true });
  assert.deepEqual(normalizeFanAxisPrefs({ rouletteTabs: false }), { monthRail: true, rouletteTabs: false });
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: false, rouletteTabs: false }), { monthRail: false, rouletteTabs: false });
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: true, rouletteTabs: true, extra: 1 }), DEFAULT_FAN_AXIS_PREFS, "모르는 키는 버린다");
});

test("타입 오류: 불리언이 아닌 값은 그 항목만 기본값", () => {
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: "false", rouletteTabs: false }), { monthRail: true, rouletteTabs: false });
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: 0, rouletteTabs: 1 }), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(normalizeFanAxisPrefs({ monthRail: null, rouletteTabs: undefined }), DEFAULT_FAN_AXIS_PREFS);
});

test("결과는 새 객체(입력·기본값 객체를 돌려주지 않는다)", () => {
  const input = { monthRail: false, rouletteTabs: true };
  const out = normalizeFanAxisPrefs(input);
  assert.notEqual(out, input);
  assert.notEqual(normalizeFanAxisPrefs({}), DEFAULT_FAN_AXIS_PREFS);
  assert.deepEqual(input, { monthRail: false, rouletteTabs: true }, "입력 불변");
});
