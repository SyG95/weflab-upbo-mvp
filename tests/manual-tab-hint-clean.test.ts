// 리뷰 반영(2026-09-21): custom 탭 이름 정제는 보이지 않는 글자를 걷어내고 코드포인트 단위로 자른다.
// (이모지가 반쪽으로 잘려 lone surrogate 가 저장되거나, U+200B/U+200D 만 든 "빈 이름"·겉보기 중복 탭이 생기지 않게.)
import test from "node:test";
import assert from "node:assert/strict";
import { cleanCustomTabName, cleanManualTabHint } from "../lib/manualTabHint";

const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const SOH = String.fromCodePoint(0x0001);
const EMOJI = String.fromCodePoint(0x1f600); // 😀 (서로게이트 쌍 = 코드유닛 2개)

test("custom 이름: 이모지 경계에서 반쪽으로 잘리지 않는다(코드포인트 30자)", () => {
  const name = "가".repeat(29) + EMOJI; // 코드유닛 31, 코드포인트 30 → 그대로
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name }), { kind: "custom", name });
  const over = "가".repeat(30) + EMOJI; // 코드포인트 31 → 이모지째로 떨어져 나감
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: over }), { kind: "custom", name: "가".repeat(30) });
  assert.equal(cleanCustomTabName(over).length, 30);
});

test("custom 이름: 제어·서식 문자는 제거되고, 그것만 있으면 null", () => {
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: `이벤트${ZWJ}` }), { kind: "custom", name: "이벤트" });
  assert.deepEqual(cleanManualTabHint({ kind: "custom", name: `${ZWSP}이${SOH}벤트${ZWSP}` }), { kind: "custom", name: "이벤트" });
  assert.equal(cleanManualTabHint({ kind: "custom", name: `${ZWSP}${ZWJ}` }), null);
  assert.equal(cleanCustomTabName(`  ${ZWSP}  `), "");
});

test("label 도 보이지 않는 글자를 걷어낸다", () => {
  assert.deepEqual(cleanManualTabHint({ kind: "label", label: `330${ZWSP}` }), { kind: "label", label: "330" });
});
