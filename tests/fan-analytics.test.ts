// Vercel Web Analytics 팬 화면 전용 필터(2026-09-17 sy 결정) 순수 로직 테스트.
//  - 팬 화면(/[slug], /[slug]/wardrobe)만 통과, 관리·미리보기·운영·검증실은 전부 차단
//  - 통과한 이벤트는 쿼리를 떼고 경로만 남긴다
import test from "node:test";
import assert from "node:assert/strict";
import { isFanPageUrl, fanOnlyBeforeSend } from "../app/FanAnalytics";

const ORIGIN = "https://weflab-upbo-mvp.vercel.app";

test("팬 화면 URL 은 통과한다", () => {
  for (const u of [
    `${ORIGIN}/rudy`,
    `${ORIGIN}/chaeru/`,
    `${ORIGIN}/ming_ggyunyang?tab=coupon`,
    `${ORIGIN}/poromi?ftab=2&month=2026-09`,
    `${ORIGIN}/gguya/wardrobe`,
    `${ORIGIN}/gguya/wardrobe?w=3`,
    "/rabom",
  ]) {
    assert.equal(isFanPageUrl(u), true, u);
  }
});

test("관리 화면·미리보기 쿼리는 차단한다", () => {
  for (const u of [
    `${ORIGIN}/rabom?admin=1`,
    `${ORIGIN}/rabom?admin=1&atab=items`,
    `${ORIGIN}/liche?design=ref-u&rtab=a`,
    `${ORIGIN}/chaeru?preview=1`,
    `${ORIGIN}/chaeru?layout=b`,
    `${ORIGIN}/chaeru?theme=aurora`,
    `${ORIGIN}/gguya/wardrobe?theme=aurora`,
  ]) {
    assert.equal(isFanPageUrl(u), false, u);
  }
});

test("운영·검증실·안내·정적 경로는 차단한다", () => {
  for (const u of [
    `${ORIGIN}/`,
    `${ORIGIN}/admin`,
    `${ORIGIN}/admin/chaeru`,
    `${ORIGIN}/chaeru/settings`,
    `${ORIGIN}/chaeru/donations`,
    `${ORIGIN}/chaeru/board-requests`,
    `${ORIGIN}/api/s/chaeru/ops-state`,
    `${ORIGIN}/favicon.ico`,
    `${ORIGIN}/s/aiko`,
    `${ORIGIN}/a/b/c`,
    "not a url at all ::",
  ]) {
    assert.equal(isFanPageUrl(u), false, u);
  }
});

test("beforeSend: 팬 페이지뷰는 쿼리를 떼고 보내고, 나머지는 null", () => {
  const sent = fanOnlyBeforeSend({ type: "pageview", url: `${ORIGIN}/poromi?ftab=2&pin=1234` });
  assert.deepEqual(sent, { type: "pageview", url: `${ORIGIN}/poromi` });

  assert.equal(fanOnlyBeforeSend({ type: "pageview", url: `${ORIGIN}/poromi?admin=1` }), null);
  assert.equal(fanOnlyBeforeSend({ type: "pageview", url: `${ORIGIN}/admin/poromi` }), null);
  // 커스텀 이벤트는 무료 플랜에서 쓰지 않으므로 전부 버린다.
  assert.equal(fanOnlyBeforeSend({ type: "event", url: `${ORIGIN}/poromi` }), null);
});
