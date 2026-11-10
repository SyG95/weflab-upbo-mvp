// 운영자 목록(getAdminStreamerIndex)이 수집 원본의 확프 버전을 하트비트와 합치는지, 그 조회가 실패해도 목록이 뜨는지 검증한다.
import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

const STREAMERS = [
  { id: "s-none", slug: "none", display_name: "하트비트없음", threshold_percent: 3, updated_at: "2026-11-08T00:00:00+00:00" },
  { id: "s-stale", slug: "stale", display_name: "뒤처짐", threshold_percent: 3, updated_at: "2026-11-08T00:00:00+00:00" },
  { id: "s-fresh", slug: "fresh", display_name: "정상", threshold_percent: 3, updated_at: "2026-11-08T00:00:00+00:00" },
  { id: "s-empty", slug: "empty", display_name: "수집없음", threshold_percent: 3, updated_at: "2026-11-08T00:00:00+00:00" },
];
const RAW_ROWS = [
  { streamer_id: "s-fresh", saved_at: "2026-11-08T03:00:00.5+00:00", client_version: "0.4.0" },
  { streamer_id: "s-stale", saved_at: "2026-11-08T02:00:00+00:00", client_version: "0.3.0" },
  { streamer_id: "s-none", saved_at: "2026-11-07T08:05:29.045347+00:00", client_version: "0.4.0" },
  { streamer_id: "s-none", saved_at: "2026-11-05T11:28:00+00:00", client_version: "0.3.0" },
];
const heartbeat = (id: string, updatedAt: string) => ({
  streamer_id: id,
  updated_at: updatedAt,
  client_version: "0.4.0",
  payload: { clientVersion: "0.4.0", page: { onAlertList: true, loginOk: true }, screen: {}, collector: {} },
});
const STATUS = [heartbeat("s-stale", "2026-11-04T16:49:57+00:00"), heartbeat("s-fresh", "2026-11-08T03:04:00+00:00")];

let rawFails = false;
let rawQuery = "";
let rawRequests = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/rest/v1/streamers") return void res.end(JSON.stringify(STREAMERS));
  if (url.pathname === "/rest/v1/extension_status") return void res.end(JSON.stringify(STATUS));
  if (url.pathname === "/rest/v1/raw_imports") {
    rawRequests += 1;
    rawQuery = decodeURIComponent(url.search);
    if (rawFails) {
      res.statusCode = 500;
      return void res.end(JSON.stringify({ message: "boom" }));
    }
    return void res.end(JSON.stringify(RAW_ROWS));
  }
  res.end("[]");
});

test("getAdminStreamerIndex: 수집 버전 한 줄 합치기와 조회 실패 내성", async (t) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server address unavailable");
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  const { getAdminStreamerIndex } = await import("../lib/upboSupabase");

  const rows = await getAdminStreamerIndex();
  const line = (slug: string) => rows.find((r) => r.slug === slug)?.collectedVersionLine;
  assert.equal(line("none"), "확프 v0.4.0 · 마지막 수집 저장 11/07 17:05 · 상태 신호 없음");
  assert.equal(line("stale"), "수집 기록 v0.3.0 · 마지막 수집 저장 11/08 11:00 · 상태 신호보다 최신");
  assert.equal(line("fresh"), undefined);
  assert.equal(line("empty"), undefined);
  assert.match(rawQuery, /type=eq\.results/);
  assert.match(rawQuery, /saved_at=gte\.\d{4}-\d{2}-\d{2}T/);
  assert.match(rawQuery, /client_version:raw->>clientVersion/);
  assert.match(rawQuery, /order=saved_at\.desc/);
  assert.match(rawQuery, /limit=1000/);
  assert.ok(!/select=[^&]*\braw\b(?!->>)/.test(rawQuery), "원본 전체(raw)를 통째로 받지 않는다");

  const requestsBefore = rawRequests;
  const visitorRows = await getAdminStreamerIndex({ collectedVersions: false });
  assert.equal(rawRequests, requestsBefore, "방문자 경로는 수집 버전 조회를 하지 않는다");
  assert.ok(visitorRows.every((r) => r.collectedVersionLine === undefined));

  rawFails = true;
  const fallback = await getAdminStreamerIndex();
  assert.equal(fallback.length, STREAMERS.length, "버전 조회가 실패해도 목록은 뜬다");
  assert.ok(fallback.every((r) => r.collectedVersionLine === undefined));
  const color = (list: typeof rows, slug: string) => list.find((r) => r.slug === slug)?.extension?.light.color;
  assert.ok(color(rows, "stale"), "하트비트 신호등이 있다");
  assert.equal(color(fallback, "stale"), color(rows, "stale"), "수집 버전 조회 결과와 무관하게 신호등 색은 같다");
});
