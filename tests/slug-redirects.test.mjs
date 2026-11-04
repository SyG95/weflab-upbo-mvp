import test from "node:test";
import assert from "node:assert/strict";
import { buildSlugRedirects, SLUG_REDIRECTS } from "../lib/slugRedirects.ts";

test("옛 슬러그 하나당 팬 길 2개 + 관리자 길 2개, 전부 308(permanent)", () => {
  const rules = buildSlugRedirects({ olda: "newa" });
  assert.deepEqual(rules, [
    { source: "/olda", destination: "/newa", permanent: true },
    { source: "/olda/:path*", destination: "/newa/:path*", permanent: true },
    { source: "/admin/olda", destination: "/admin/newa", permanent: true },
    { source: "/admin/olda/:path*", destination: "/admin/newa/:path*", permanent: true },
  ]);
});

test("/api 로 시작하는 길은 만들지 않는다(확프 옛 슬러그 403 을 가리지 않음)", () => {
  for (const r of buildSlugRedirects({ olda: "newa" })) assert.ok(!r.source.startsWith("/api"), r.source);
});

test("모양이 이상하거나 같은 값·사슬이면 거부", () => {
  assert.throws(() => buildSlugRedirects({ "Bad Slug": "x" }));
  assert.throws(() => buildSlugRedirects({ a: "a" }));
  assert.throws(() => buildSlugRedirects({ a: "b", b: "c" }));
});

test("실제 표: ddamming → yuibi 가 들어 있고 전부 유효", () => {
  assert.equal(SLUG_REDIRECTS.ddamming, "yuibi");
  assert.doesNotThrow(() => buildSlugRedirects());
});
