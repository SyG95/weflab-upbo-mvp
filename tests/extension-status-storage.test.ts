// 확프 하트비트 저장·조회(lib/upboSupabase) — 가짜 PostgREST 로 쿼리 모양과 "테이블 없음" 폴백을 검증한다.
// 핵심: sy 가 SQL 을 적용하기 전(PGRST205)에도 하트비트·목록·관리자 화면이 죽지 않아야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

type Row = Record<string, unknown>;

const state = {
  statusTableExists: false,
  status: [] as Row[],
  audit: [] as Row[],
  raw: [] as Row[],
  requests: [] as Array<{ method: string; path: string; query: URLSearchParams; prefer: string; body: unknown }>,
};

const STREAMERS = [{ id: "s-a" }, { id: "s-b" }, { id: "s-c" }];

function cursorFilter(rows: Row[], or: string | null): Row[] {
  if (!or) return rows;
  // or=(captured_at.gt.X,and(captured_at.eq.X,id.gt.Y)) — supabaseFetchAll 의 asc 2키 커서
  const m = or.match(/^\(captured_at\.gt\.([^,]+),and\(captured_at\.eq\.([^,]+),id\.gt\.([^)]+)\)\)$/);
  assert.ok(m, `unexpected cursor ${or}`);
  const [, gt, eq, id] = m;
  return rows.filter((r) => String(r.captured_at) > gt || (String(r.captured_at) === eq && String(r.id) > id));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? JSON.parse(text) : null;
  const q = url.searchParams;
  state.requests.push({ method: req.method ?? "", path: url.pathname, query: q, prefer: String(req.headers.prefer ?? ""), body });
  res.setHeader("content-type", "application/json");
  const send = (status: number, value: unknown) => {
    res.statusCode = status;
    res.end(value === "" ? "" : JSON.stringify(value));
  };
  if (url.pathname === "/rest/v1/extension_status") {
    if (!state.statusTableExists) {
      return send(404, { code: "PGRST205", message: "Could not find the table 'public.extension_status' in the schema cache" });
    }
    if (req.method === "POST") {
      const existing = state.status.find((r) => r.streamer_id === body.streamer_id);
      if (existing) Object.assign(existing, body);
      else state.status.push({ ...body });
      return send(201, "");
    }
    const sid = q.get("streamer_id")?.replace(/^eq\./, "");
    return send(200, sid ? state.status.filter((r) => r.streamer_id === sid) : state.status);
  }
  if (url.pathname === "/rest/v1/audit_logs") {
    if (req.method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      for (const r of list) state.audit.push({ ...r, created_at: new Date(Date.now() + state.audit.length).toISOString() });
      return send(201, "");
    }
    const action = q.get("action")?.replace(/^eq\./, "");
    const sid = q.get("streamer_id")?.replace(/^eq\./, "");
    let rows = state.audit.filter((r) => r.action === action && (!sid || r.streamer_id === sid));
    rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const limit = Number(q.get("limit") ?? "1000");
    return send(200, rows.slice(0, Math.min(limit, 1000)));
  }
  if (url.pathname === "/rest/v1/streamers") return send(200, STREAMERS);
  if (url.pathname === "/rest/v1/raw_imports") {
    const sid = q.get("streamer_id")?.replace(/^eq\./, "");
    let rows = state.raw.filter((r) => r.streamer_id === sid && r.type === "results");
    const gte = q.get("captured_at");
    if (gte?.startsWith("gte.")) rows = rows.filter((r) => String(r.captured_at) >= gte.slice(4));
    if (gte === "not.is.null") rows = rows.filter((r) => r.captured_at != null);
    rows = cursorFilter(rows, q.get("or"));
    const order = q.get("order") ?? "";
    rows = [...rows].sort((a, b) => {
      const c = String(a.captured_at).localeCompare(String(b.captured_at)) || String(a.id).localeCompare(String(b.id));
      return order.startsWith("captured_at.desc") ? -c : c;
    });
    const limit = Number(q.get("limit") ?? "1000");
    const select = q.get("select") ?? "*";
    return send(
      200,
      rows.slice(0, limit).map((r) =>
        select.includes("rows:raw->rows")
          ? { id: r.id, captured_at: r.captured_at, rows: (r.raw as Row).rows }
          : { captured_at: r.captured_at },
      ),
    );
  }
  send(200, []);
});

let lib: typeof import("../lib/upboSupabase");

test.before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  process.env.UPBO_SUPABASE_PAGE = "2"; // 키셋 페이지 순회를 실제로 타게
  lib = await import("../lib/upboSupabase");
});

test.after(() => {
  server.close();
});

const HEARTBEAT = {
  clientVersion: "0.4.0",
  collectorSessionId: "s",
  autoSyncEnabled: true,
  autoSyncMode: "apply",
  page: { onAlertList: true, loginOk: true },
  screen: {
    rowCount: 100,
    newestRowTime: "2026-10-12 20:00:00",
    oldestRowTime: "2026-10-06 10:00:00",
    rangeText: "",
    rangeEndIsToday: true,
    filter: { searchActive: false, minActive: false, typeValue: "all" },
    moreButtonVisible: false,
  },
  collector: { lastPostAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null, observedRows: 1, observedResults: 1, autoSeenKeyCount: 1 },
};

test("상태 테이블이 아직 없으면(PGRST205): 저장 false·조회 null·목록 빈 지도 — throw 없음", async () => {
  state.statusTableExists = false;
  assert.equal(await lib.upsertExtensionStatus("s-a", "0.4.0", HEARTBEAT), false);
  assert.equal(await lib.getExtensionStatus("s-a"), null);
  assert.equal((await lib.getExtensionStatusMap()).size, 0);
});

test("상태 저장은 streamer_id 충돌 시 덮어쓰기(upsert) 1행, 조회는 정제된 모양", async () => {
  state.statusTableExists = true;
  state.requests.length = 0;
  assert.equal(await lib.upsertExtensionStatus("s-a", "0.4.0", HEARTBEAT), true);
  assert.equal(await lib.upsertExtensionStatus("s-a", "0.4.1", { ...HEARTBEAT, clientVersion: "0.4.1" }), true);
  const post = state.requests.find((r) => r.method === "POST" && r.path === "/rest/v1/extension_status");
  assert.ok(post);
  assert.equal(post.query.get("on_conflict"), "streamer_id");
  assert.match(post.prefer, /resolution=merge-duplicates/);
  assert.match(post.prefer, /return=minimal/);
  assert.equal(state.status.length, 1);
  const status = await lib.getExtensionStatus("s-a");
  assert.equal(status?.clientVersion, "0.4.1");
  assert.equal(status?.payload.screen.rowCount, 100);
  assert.equal(typeof status?.updatedAt, "string");
  const map = await lib.getExtensionStatusMap();
  assert.deepEqual([...map.keys()], ["s-a"]);
});

test("원격 스위치: 기본값 → 줄별 저장(온 키만 병합) → 전체 저장은 스트리머마다 1건, 목록은 최신 1건", async () => {
  assert.deepEqual(await lib.getExtensionConfig("s-a"), {
    catchupEnabled: false,
    catchupLookbackHours: 48,
    catchupMaxPages: 10,
    catchupCooldownMinutes: 30,
    paused: false,
  });
  const streamerA = { id: "s-a", slug: "a", display_name: "A", threshold_percent: 2 };
  const first = await lib.setExtensionConfig(streamerA, { catchupMaxPages: 20 });
  assert.equal(first.catchupMaxPages, 20);
  const second = await lib.setExtensionConfig(streamerA, { catchupEnabled: true });
  assert.equal(second.catchupEnabled, true);
  assert.equal(second.catchupMaxPages, 20, "앞서 바꾼 값이 유지돼야 한다");
  const auditBefore = state.audit.length;
  assert.equal(await lib.setExtensionConfigForAll({ catchupEnabled: false }), 3);
  assert.equal(state.audit.length, auditBefore + 3);
  const bulk = state.requests.filter((r) => r.method === "POST" && r.path === "/rest/v1/audit_logs").at(-1);
  assert.ok(Array.isArray(bulk?.body), "전체 저장은 한 번의 POST(배열)");
  const map = await lib.getExtensionConfigMap();
  assert.equal(map.get("s-a")?.catchupEnabled, false);
  assert.equal(map.get("s-a")?.catchupMaxPages, 20, "전체 끄기도 각자 다른 설정은 유지");
  assert.equal(map.get("s-c")?.catchupMaxPages, 10);
  for (const row of state.audit) {
    assert.equal(row.action, "extension_config_updated");
    assert.equal(row.actor, "operator");
  }
});

test("최신 원본 수집 시각·본 키 시드(최근 N일, 키셋 페이지 순회)", async () => {
  const day = 86_400_000;
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  state.raw = [
    { id: "r1", streamer_id: "s-a", type: "results", captured_at: iso(10 * day), raw: { rows: [{ sourceUid: "old", results: [{ index: 0, sourceKey: "old::0" }] }] } },
    { id: "r2", streamer_id: "s-a", type: "results", captured_at: iso(3 * day), raw: { rows: [{ sourceUid: "u1", results: [{ index: 0, sourceKey: "u1::0" }] }] } },
    { id: "r3", streamer_id: "s-a", type: "results", captured_at: iso(2 * day), raw: { rows: [{ sourceUid: "u2", results: [], donationAmount: 500, donateTimeText: "2026-10-10 10:00:00" }] } },
    { id: "r4", streamer_id: "s-a", type: "results", captured_at: iso(1 * day), raw: { rows: [{ sourceUid: "u3", results: [{ index: 1 }] }] } },
    { id: "r5", streamer_id: "s-a", type: "results", captured_at: iso(0.5 * day), raw: { rows: [{ sourceUid: "u1", results: [{ index: 0, sourceKey: "u1::0" }] }] } },
    { id: "x1", streamer_id: "s-b", type: "results", captured_at: iso(1 * day), raw: { rows: [{ sourceUid: "other", results: [{ index: 0 }] }] } },
  ];
  state.requests.length = 0;
  const keys = await lib.knownSourceKeysForStreamer("s-a", 7);
  assert.deepEqual(keys.resultKeys, ["u3::1", "u1::0"]);
  assert.deepEqual(keys.donationKeys, ["don::u2::2026-10-10 10:00:00::500"]);
  const pages = state.requests.filter((r) => r.path === "/rest/v1/raw_imports");
  assert.ok(pages.length >= 2, `페이지 순회(페이지 2행) — 요청 ${pages.length}회`);
  assert.equal(pages[0].query.get("select"), "id,captured_at,rows:raw->rows");
  assert.equal(pages[0].query.get("type"), "eq.results");
  assert.equal(await lib.latestRawCaptureAt("s-a"), state.raw[4].captured_at);
  assert.equal(await lib.latestRawCaptureAt("s-none"), null);
});
