// 관리자 머리말 기간 한정 공지(lib/adminNotice) — 기한·닫음 판정.
import test from "node:test";
import assert from "node:assert/strict";
import { THEME_UPDATE_NOTICE, noticeStorageKey, noticeVisible } from "../lib/adminNotice";

const kst = (s: string) => Date.parse(`${s}+09:00`);

test("테마 업데이트 공지: 11/3 자정(KST) 전까지만 보이고, 그 뒤엔 닫지 않아도 사라진다", () => {
  assert.equal(THEME_UPDATE_NOTICE.text, "시트 테마가 업데이트됐어요.");
  assert.equal(noticeVisible(THEME_UPDATE_NOTICE, kst("2026-10-27T13:00:00"), false), true);
  assert.equal(noticeVisible(THEME_UPDATE_NOTICE, kst("2026-11-02T23:59:59"), false), true);
  assert.equal(noticeVisible(THEME_UPDATE_NOTICE, kst("2026-11-03T00:00:00"), false), false);
  assert.equal(noticeVisible(THEME_UPDATE_NOTICE, kst("2026-12-01T00:00:00"), false), false);
});

test("닫은 브라우저에서는 기한 안이어도 안 보인다", () => {
  assert.equal(noticeVisible(THEME_UPDATE_NOTICE, kst("2026-10-28T09:00:00"), true), false);
});

test("닫음 기억 키는 공지마다 따로(새 공지는 id 를 바꾸면 다시 보인다)", () => {
  assert.equal(noticeStorageKey(THEME_UPDATE_NOTICE.id), "upbo-notice-closed:theme-update-2026-10-27");
  assert.notEqual(noticeStorageKey("other"), noticeStorageKey(THEME_UPDATE_NOTICE.id));
});

test("공지 상자(옅은 강조 바탕) 위 글자: 모든 테마에서 4.5:1 이상", async () => {
  const { THEMES } = await import("../lib/themes");
  const { contrastRatio, mixHex } = await import("../lib/toneTheme");
  const flat = (v: string, under: string) => {
    if (v.startsWith("#")) return v;
    const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)!;
    const hex = "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    return m[4] === undefined ? hex : mixHex(under, hex, Number(m[4]));
  };
  for (const t of THEMES) {
    const v = t.vars;
    const head = flat(v["--surface"], v["--paper"]); // 관리자 머리말 카드
    const box = flat(v["--stamp-soft"], head);
    assert.ok(contrastRatio(v["--ink"], box) >= 4.5, `${t.id} 본문 ${contrastRatio(v["--ink"], box).toFixed(2)}`);
  }
});
