// 팬 확률표 공개 범위(lib/fanRevealScope) — 저장값 정제와 기본값.
import test from "node:test";
import assert from "node:assert/strict";
import { FAN_REVEAL_SCOPE_DEFAULT, normalizeFanRevealScope } from "../lib/fanRevealScope";

test("기본값은 target(업보 대상 품목만) — 옛 payload(scope 키 없음)도 그대로", () => {
  assert.equal(FAN_REVEAL_SCOPE_DEFAULT, "target");
  assert.equal(normalizeFanRevealScope(undefined), "target");
  assert.equal(normalizeFanRevealScope(null), "target");
  assert.equal(normalizeFanRevealScope(""), "target");
  assert.equal(normalizeFanRevealScope("target"), "target");
});

test("all 만 전체 확률표, 그 외 문자열·타입은 전부 target 으로", () => {
  assert.equal(normalizeFanRevealScope("all"), "all");
  assert.equal(normalizeFanRevealScope("ALL"), "target");
  assert.equal(normalizeFanRevealScope("everything"), "target");
  assert.equal(normalizeFanRevealScope(1), "target");
  assert.equal(normalizeFanRevealScope({ scope: "all" }), "target");
});
