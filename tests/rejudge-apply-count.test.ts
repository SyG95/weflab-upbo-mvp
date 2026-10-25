// 다시판정 넣기가 "실제로 들어간 수"를 돌려주는지(2026-10-25 R7) — 가짜 PostgREST 에
// unique(streamer_id, source_key) + ignore-duplicates + return=representation 을 구현해 검증한다.
// 왜: 미리보기와 넣기 사이에 실시간 수집·다른 탭이 같은 키를 먼저 넣으면 DB 는 조용히 건너뛰는데,
//     예전엔 후보 수를 "n건 넣었어요"로 보여 줬다. (미러 서버는 ignore-duplicates 를 흉내 내지 못한다.)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { normalizeCatalogCapture } from "../lib/upboCore";

type Row = Record<string, unknown>;

const catalog = normalizeCatalogCapture({
  capturedAt: "2026-10-01T00:00:00.000Z",
  groups: [
    {
      amountMin: 33,
      amountMax: 33,
      enabled: true,
      items: [
        { name: "A단컷", probability: 1 },
        { name: "배박수", probability: 11 },
      ],
    },
  ],
});

function capture(uid: string) {
  return {
    capturedAt: "2026-10-02T12:00:00.000Z",
    rows: [
      {
        sourceUid: uid,
        donateTimeText: "2026-10-02 12:00:00",
        donationType: "별풍선",
        donationAmount: 33,
        fanNickname: "테스트팬",
        fanId: "testfan",
        results: [{ name: "A단컷", probability: 1, index: 0, total: 1 }],
      },
    ],
  };
}

const db = {
  entries: [] as Row[],
  raw: [] as Row[],
  audit: [] as Row[],
  raceKey: null as string | null, // 넣기 요청 직전에 "다른 경로"가 먼저 넣는 키
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? JSON.parse(text) : null;
  const q = url.searchParams;
  const prefer = String(req.headers.prefer ?? "");
  res.setHeader("content-type", "application/json");
  const send = (status: number, value: unknown) => {
    if (Array.isArray(value) && prefer.includes("count=exact")) {
      res.setHeader("content-range", `0-${Math.max(0, value.length - 1)}/${value.length}`);
    }
    res.statusCode = status;
    res.end(value === "" ? "" : JSON.stringify(value));
  };
  if (q.get("or")) return send(200, []);
  switch (url.pathname) {
    case "/rest/v1/catalogs":
      return send(200, [{ id: "c1", streamer_id: "s-r", version: 1, captured_at: catalog.capturedAt, groups: catalog.groups, items: catalog.items }]);
    case "/rest/v1/raw_imports":
      return send(200, db.raw);
    case "/rest/v1/upbo_entries": {
      if (req.method !== "POST") return send(200, db.entries.map((e) => ({ id: e.id, source_key: e.source_key, created_at: e.created_at })));
      if (db.raceKey) {
        db.entries.push({ id: "other", streamer_id: "s-r", source_key: db.raceKey, created_at: "2026-10-25T00:00:00Z" });
        db.raceKey = null;
      }
      assert.equal(q.get("on_conflict"), "streamer_id,source_key");
      const ignore = prefer.includes("resolution=ignore-duplicates");
      const inserted: Row[] = [];
      for (const row of Array.isArray(body) ? body : [body]) {
        const dup = db.entries.some((e) => e.streamer_id === row.streamer_id && e.source_key === row.source_key);
        if (dup) {
          if (!ignore) return send(409, { code: "23505", message: "duplicate key" });
          continue; // ON CONFLICT DO NOTHING
        }
        db.entries.push(row);
        inserted.push(row);
      }
      if (!prefer.includes("return=representation")) return send(201, "");
      const select = (q.get("select") ?? "*").split(",");
      return send(
        201,
        inserted.map((r) => (select[0] === "*" ? r : Object.fromEntries(select.map((k) => [k, r[k]])))),
      );
    }
    case "/rest/v1/audit_logs":
      if (req.method === "POST") {
        db.audit.push(...(Array.isArray(body) ? body : [body]));
        return send(201, "");
      }
      return send(200, []);
    default:
      return send(200, []);
  }
});

let lib: typeof import("../lib/upboSupabase");

test.before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  lib = await import("../lib/upboSupabase");
});

test.after(() => {
  server.close();
});

const STREAMER = { id: "s-r", slug: "rrr", display_name: "R", threshold_percent: 2 } as Parameters<
  typeof import("../lib/upboSupabase").applyRejudgeForStreamer
>[0];

function seed() {
  db.entries = [];
  db.audit = [];
  db.raceKey = null;
  db.raw = ["uid1", "uid2", "uid3"].map((uid, i) => ({
    id: `r${i}`,
    batch_id: `b${i}`,
    saved_at: `2026-10-02T12:00:0${i}Z`,
    raw: capture(uid),
  }));
}

test("다른 경로가 끼어들지 않으면: 후보 3건 = 실제로 넣은 3건", async () => {
  seed();
  const r = await lib.applyRejudgeForStreamer(STREAMER);
  assert.equal(r.requested, 3);
  assert.equal(r.recorded, 3);
  assert.equal(r.alreadyExisted, 0);
  const audit = db.audit.find((a) => a.action === "rejudge_applied")!.payload as Row;
  assert.equal(audit.inserted, 3);
  assert.deepEqual([...(audit.sourceKeys as string[])].sort(), ["uid1::0", "uid2::0", "uid3::0"]);
});

test("미리보기 뒤 다른 경로가 1건을 먼저 넣으면: 실제로 넣은 수는 2, 이미 있음 1(예전엔 3으로 보였다)", async () => {
  seed();
  db.raceKey = "uid2::0";
  const r = await lib.applyRejudgeForStreamer(STREAMER);
  assert.equal(r.requested, 3);
  assert.equal(r.recorded, 2);
  assert.equal(r.alreadyExisted, 1);
  const audit = db.audit.find((a) => a.action === "rejudge_applied")!.payload as Row;
  assert.deepEqual([...(audit.sourceKeys as string[])].sort(), ["uid1::0", "uid3::0"], "장부에는 실제로 넣은 키만");
  assert.equal(db.entries.filter((e) => e.source_key === "uid2::0").length, 1, "중복 행 없음");
});

test("다시 누르면 넣을 게 없다(멱등)", async () => {
  seed();
  await lib.applyRejudgeForStreamer(STREAMER);
  const again = await lib.applyRejudgeForStreamer(STREAMER);
  assert.equal(again.requested, 0);
  assert.equal(again.recorded, 0);
  assert.equal(db.entries.length, 3);
});
