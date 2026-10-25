// 다시판정 넣기가 "실제로 들어간 수"를 돌려주는지(2026-10-25 R7) — 가짜 PostgREST 에
// unique(streamer_id, source_key) + ignore-duplicates + return=representation 을 구현해 검증한다.
// 왜: 미리보기와 넣기 사이에 실시간 수집·다른 탭이 같은 키를 먼저 넣으면 DB 는 조용히 건너뛰는데,
//     예전엔 후보 수를 "n건 넣었어요"로 보여 줬다. (미러 서버는 ignore-duplicates 를 흉내 내지 못한다.)
// 리뷰(M1·L1) 뒤: 화면이 미리보기 키를 보내면 그 안의 것만 넣고, 확인창 숫자와 다른 이유를 따로 센다.
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

function row(uid: string) {
  return {
    sourceUid: uid,
    donateTimeText: "2026-10-02 12:00:00",
    donationType: "별풍선",
    donationAmount: 33,
    fanNickname: "테스트팬",
    fanId: "testfan",
    results: [{ name: "A단컷", probability: 1, index: 0, total: 1 }],
  };
}

function capture(uids: string[]) {
  return { capturedAt: "2026-10-02T12:00:00.000Z", rows: uids.map(row) };
}

const db = {
  entries: [] as Row[],
  raw: [] as Row[],
  audit: [] as Row[],
  raceKey: null as string | null, // 넣기 요청(INSERT) 직전에 "다른 경로"가 먼저 넣는 키
  inserts: 0, // upbo_entries POST 요청 수(청크 수)
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
      db.inserts += 1;
      if (db.raceKey) {
        db.entries.push({ id: "other", streamer_id: "s-r", source_key: db.raceKey, created_at: "2026-10-25T00:00:00Z" });
        db.raceKey = null;
      }
      assert.equal(q.get("on_conflict"), "streamer_id,source_key");
      const ignore = prefer.includes("resolution=ignore-duplicates");
      const inserted: Row[] = [];
      for (const r of Array.isArray(body) ? body : [body]) {
        const dup = db.entries.some((e) => e.streamer_id === r.streamer_id && e.source_key === r.source_key);
        if (dup) {
          if (!ignore) return send(409, { code: "23505", message: "duplicate key" });
          continue; // ON CONFLICT DO NOTHING
        }
        db.entries.push(r);
        inserted.push(r);
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

// 원본 배치 하나에 uid 하나씩(저장 순서대로).
function seed(uids: string[] = ["uid1", "uid2", "uid3"]) {
  db.entries = [];
  db.audit = [];
  db.raceKey = null;
  db.inserts = 0;
  db.raw = uids.map((uid, i) => ({
    id: `r${i}`,
    batch_id: `b${i}`,
    saved_at: `2026-10-02T12:00:0${i % 10}Z`,
    raw: capture([uid]),
  }));
}

const previewKeysOf = async () => (await lib.previewRejudgeForStreamer(STREAMER)).candidates.map((c) => c.sourceKey);
const lastAudit = () => db.audit.filter((a) => a.action === "rejudge_applied").at(-1)!.payload as Row;

test("다른 경로가 끼어들지 않으면: 미리보기 3건 = 실제로 넣은 3건", async () => {
  seed();
  const keys = await previewKeysOf();
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(r.requested, 3);
  assert.equal(r.recorded, 3);
  assert.equal(r.alreadyExisted, 0);
  assert.equal(r.changedSincePreview, 0);
  assert.equal(r.notInPreview, 0);
  assert.equal(lastAudit().inserted, 3);
  assert.deepEqual([...(lastAudit().sourceKeys as string[])].sort(), ["uid1::0", "uid2::0", "uid3::0"]);
});

test("미리보기 뒤 다른 경로가 1건을 먼저 넣으면: 미리보기 3건 중 2건, 이미 있음 1건", async () => {
  seed();
  const keys = await previewKeysOf();
  // 미리보기와 넣기 사이에 실시간 수집이 uid2 를 먼저 기록했다
  db.entries.push({ id: "live", streamer_id: "s-r", source_key: "uid2::0", created_at: "2026-10-25T00:00:00Z" });
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(r.requested, 3, "확인창에서 본 수");
  assert.equal(r.recorded, 2);
  assert.equal(r.alreadyExisted, 1);
  assert.equal(r.changedSincePreview, 0);
  assert.equal(db.entries.filter((e) => e.source_key === "uid2::0").length, 1, "중복 행 없음");
});

test("넣기 요청 도중(INSERT 직전)에 끼어든 것도 이미 있음으로 센다", async () => {
  seed();
  const keys = await previewKeysOf();
  db.raceKey = "uid2::0";
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(r.requested, 3);
  assert.equal(r.recorded, 2);
  assert.equal(r.alreadyExisted, 1);
  assert.deepEqual([...(lastAudit().sourceKeys as string[])].sort(), ["uid1::0", "uid3::0"], "장부에는 실제로 넣은 키만");
  // 감사 기록: previewed=확인창 수, targets=실제로 넣으려 한 수, alreadyExisted=그사이 이미 들어간 수
  assert.deepEqual(
    { previewed: lastAudit().previewed, targets: lastAudit().targets, inserted: lastAudit().inserted, alreadyExisted: lastAudit().alreadyExisted },
    { previewed: 3, targets: 3, inserted: 2, alreadyExisted: 1 },
  );
});

test("미리보기 뒤 새로 생긴 후보는 넣지 않고 숫자로만 알린다", async () => {
  seed(["uid1", "uid2"]);
  const keys = await previewKeysOf();
  db.raw.push({ id: "r9", batch_id: "b9", saved_at: "2026-10-02T12:00:09Z", raw: capture(["uid9"]) });
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(r.requested, 2);
  assert.equal(r.recorded, 2);
  assert.equal(r.notInPreview, 1);
  assert.equal(db.entries.some((e) => e.source_key === "uid9::0"), false, "확인 안 한 건 안 들어간다");
  // 다시 미리보기하면 그 1건이 보이고, 넣으면 들어간다
  const again = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: await previewKeysOf() });
  assert.equal(again.recorded, 1);
});

test("미리보기에 있었는데 이제 후보도 아니고 DB 에도 없으면 '바뀌어 빠짐'으로 센다", async () => {
  seed(["uid1", "uid2"]);
  const keys = await previewKeysOf();
  db.raw = db.raw.filter((r) => r.id !== "r1"); // uid2 원본이 더는 후보가 안 되는 상황(예: 표·기준 변경)
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(r.requested, 2);
  assert.equal(r.recorded, 1);
  assert.equal(r.alreadyExisted, 0);
  assert.equal(r.changedSincePreview, 1);
});

test("한 캡처에 같은 줄이 두 번 담겨도 미리보기·넣기 모두 1건(L1)", async () => {
  seed([]);
  db.raw = [{ id: "r0", batch_id: "b0", saved_at: "2026-10-02T12:00:00Z", raw: capture(["dup1", "dup1"]) }];
  const preview = await lib.previewRejudgeForStreamer(STREAMER);
  assert.equal(preview.summary.wouldRecord, 1);
  assert.equal(preview.candidates.length, 1);
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: preview.candidates.map((c) => c.sourceKey) });
  assert.equal(r.requested, 1);
  assert.equal(r.recorded, 1);
  assert.equal(r.alreadyExisted, 0, "자기 자신과 겹친 걸 '그사이 이미 들어감'으로 잘못 설명하지 않는다");
});

test("후보가 500건을 넘으면 나눠 넣어도 실제로 들어간 수가 다 쌓인다", async () => {
  seed([]);
  db.raw = [
    {
      id: "r0",
      batch_id: "b0",
      saved_at: "2026-10-02T12:00:00Z",
      raw: capture(Array.from({ length: 520 }, (_, i) => `bulk${String(i).padStart(4, "0")}`)),
    },
  ];
  const keys = await previewKeysOf();
  assert.equal(keys.length, 520);
  const r = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(db.inserts, 2, "500건씩 2번");
  assert.equal(r.recorded, 520);
  assert.equal(r.requested, 520);
});

test("미리보기 키를 안 보내면(옛 화면) 예전처럼 지금 후보 전부", async () => {
  seed();
  db.raceKey = "uid2::0";
  const r = await lib.applyRejudgeForStreamer(STREAMER);
  assert.equal(r.requested, 3);
  assert.equal(r.recorded, 2);
  assert.equal(r.alreadyExisted, 1);
  assert.equal(r.notInPreview, 0);
});

test("다시 누르면 넣을 게 없다(멱등)", async () => {
  seed();
  await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: await previewKeysOf() });
  const keys = await previewKeysOf();
  assert.equal(keys.length, 0);
  const again = await lib.applyRejudgeForStreamer(STREAMER, { previewKeys: keys });
  assert.equal(again.requested, 0);
  assert.equal(again.recorded, 0);
  assert.equal(db.entries.length, 3);
});
