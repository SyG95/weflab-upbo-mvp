// 관문 1: 수집 반영에 의심 수를 얹어도 판정·기록·두배권 상태는 그대로이고, 계산이 실패해도 수집은 멈추지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { normalizeCatalogCapture, type ResultCapture } from "../lib/upboCore";

const CATALOG = (() => {
  const n = normalizeCatalogCapture({
    capturedAt: "2026-11-01T00:00:00.000Z",
    groups: [
      {
        amountMin: 33,
        amountMax: 33,
        items: [
          { name: "단컷", probability: 2, sortOrder: 0 },
          { name: "하트", probability: 98, sortOrder: 1 },
        ],
      },
    ],
  });
  return { id: "c1", version: 1, captured_at: n.capturedAt, groups: n.groups, items: n.items };
})();

const STREAMER = { id: "s1", slug: "demo", threshold_percent: 3 };
const row = (uid: string, name: string, probability: number) => ({
  sourceUid: uid,
  donateTimeText: "2026-11-02 12:00:00",
  donationType: "별풍선",
  donationAmount: 33,
  fanNickname: "시청자",
  fanId: "viewer01",
  results: [{ name, probability }],
});
const capture = (rows: unknown[]): ResultCapture => ({ capturedAt: "2026-11-02T04:00:00.000Z", rows }) as unknown as ResultCapture;

type Write = { table: string; body: unknown };
const writes: Write[] = [];
let auditFails = false;
let auditHangs = false;
let auditGets = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const table = url.pathname.replace("/rest/v1/", "");
  res.setHeader("content-type", "application/json");
  if (req.method === "GET") {
    if (table === "catalogs") return void res.end(JSON.stringify([CATALOG]));
    if (table === "audit_logs") {
      const action = url.searchParams.get("action") ?? "";
      if (action.includes("missing_candidate_policy")) auditGets += 1;
      if (action.includes("catalog_usage_updated") || action.includes("missing_candidate_policy")) {
        // 평소 판정이 읽는 사용 설정(payload)은 살리고, 의심 수 전용 조회(created_at 또는 정책)만 실패·지연시킨다.
        const suspectOnly = url.searchParams.get("select") === "created_at" || action.includes("missing_candidate_policy");
        if (auditHangs && suspectOnly) return; // 응답하지 않는다
        if (auditFails && suspectOnly) {
          res.statusCode = 500;
          return void res.end(JSON.stringify({ message: "boom" }));
        }
      }
    }
    return void res.end("[]");
  }
  let text = "";
  req.on("data", (chunk) => (text += chunk));
  req.on("end", () => {
    const body = text ? JSON.parse(text) : null;
    writes.push({ table, body });
    res.end(JSON.stringify(Array.isArray(body) ? body : [{ id: `${table}-1`, ...body }]));
  });
});

const bodiesOf = (table: string) => writes.filter((w) => w.table === table).map((w) => w.body as Record<string, unknown>);

test("수집 반영: 의심 수는 배치 summary 숫자로만 남고 나머지 쓰기는 같다", async (t) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  const lib = await import("../lib/upboSupabase");
  const apply = (cap: ResultCapture) => lib.applyResultsForStreamer(STREAMER as never, cap);

  // 시각·랜덤 값과 의심 수 필드만 뺀 "모든 쓰기"를 비교한다(기록·원본·배치·두배권 상태·쿠폰·정가 포함).
  const VOLATILE = new Set(["id", "batch_id", "raw_import_id", "created_at", "updated_at", "suspectCount"]);
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, stable(v)]));
    }
    return value;
  };
  const allWrites = () => JSON.stringify(writes.map((w) => ({ table: w.table, body: stable(w.body) })));

  // 1) 기록 1건 + 검토함 저확률 1건
  writes.length = 0;
  const first = await apply(capture([row("a", "단컷", 2), row("b", "없는상품", 1)]));
  assert.equal(first.summary.recordCount, 1);
  assert.equal(first.summary.needsReviewCount, 1);
  const batch = bodiesOf("import_batches")[0];
  assert.equal((batch.summary as Record<string, unknown>).suspectCount, 1);
  assert.equal((first.summary as Record<string, unknown>).suspectCount, undefined, "판정 결과(summary)는 그대로");
  assert.ok(bodiesOf("audit_logs").some((b) => b.action === "modifier_state"), "두배권 상태 저장도 비교 대상에 들어 있다");
  const baseline = allWrites();

  // 2) 계산 재료 읽기가 실패해도 수집은 그대로, 숫자만 안 남는다 — 모든 쓰기가 같아야 한다
  writes.length = 0;
  auditFails = true;
  const failed = await apply(capture([row("a", "단컷", 2), row("b", "없는상품", 1)]));
  auditFails = false;
  assert.equal(failed.summary.recordCount, 1);
  assert.equal((bodiesOf("import_batches")[0].summary as Record<string, unknown>).suspectCount, undefined);
  assert.equal(allWrites(), baseline, "의심 수 성공·실패가 다른 쓰기를 바꾸지 않는다");

  // 2-1) 재료 읽기가 멈춰도 1초 안팎에 끊고 수집은 끝난다
  writes.length = 0;
  auditHangs = true;
  const started = Date.now();
  const slow = await apply(capture([row("a", "단컷", 2), row("b", "없는상품", 1)]));
  auditHangs = false;
  assert.equal(slow.summary.recordCount, 1);
  assert.ok(Date.now() - started < 2500, "의심 수 때문에 수집이 오래 멈추지 않는다");
  assert.equal(allWrites(), baseline);

  // 3) 검토함이 없으면 추가 조회도, 필드도 없다
  writes.length = 0;
  auditGets = 0;
  await apply(capture([row("c", "단컷", 2)]));
  assert.equal(auditGets, 0, "추가 조회 0");
  assert.equal(((bodiesOf("import_batches")[0].summary) as Record<string, unknown>).suspectCount, undefined);
});
