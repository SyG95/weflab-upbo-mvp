// 후원 시점 근사 다시판정 — DB 왕복 모양(PHASE1-TEST-PLAN.md §3-4, 방식 C).
// 가짜 PostgREST: 요청당 1,000행 상한(운영 max-rows) + 키셋 커서(or=) + count=exact. 쓰기 요청은 전부 기록만 한다.
//   - 재료(이력·원본)를 전량 페이지 순회로 읽는다(special_item_rule 이 1,000행을 넘어도 안 잘린다, F17).
//   - 미리보기는 쓰기 0, 🟢·🟡·오기록 의심 행만 쪽(200)으로, 무거운 표본(3만 결과)도 응답 4.5MB 미만.
//   - 판정 입력 지문은 입력 이벤트 하나가 바뀌면 바뀐다.
//   - 시범 스위치는 기본 꺼짐, 팬 페이지 오버레이 조회에 새 action 이 끼지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SYNTH_EXPECTED_SUMMARY, SYNTH_STREAMER, SYNTH_TABLES } from "./fixtures/donationTimeSynthetic";
import { normalizeCatalogCapture, specialRuleKeyForItem } from "../lib/upboCore";

type Row = Record<string, unknown>;
const CAP = 1000;

const db: Record<string, Row[]> = {};
const writes: Array<{ method: string; table: string; body: unknown }> = [];
const gets: string[] = [];

function reset(tables: Record<string, unknown[]>) {
  for (const key of Object.keys(db)) delete db[key];
  for (const [k, v] of Object.entries(tables)) db[k] = structuredClone(v) as Row[];
  writes.length = 0;
  gets.length = 0;
}

function col(row: Row, path: string): unknown {
  if (!path.includes("->")) return row[path];
  let cur: unknown = row;
  for (const part of path.split(/->>?/)) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Row)[part];
  }
  return path.includes("->>") && cur !== null && typeof cur === "object" ? JSON.stringify(cur) : cur;
}

function cmp(a: unknown, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (typeof a === "number" && Number.isFinite(y)) return x - y;
  const s = String(a);
  return s < b ? -1 : s > b ? 1 : 0;
}

function cond(text: string): (row: Row) => boolean {
  const and = text.match(/^and\((.*)\)$/);
  if (and) {
    const parts = splitTop(and[1]).map(cond);
    return (row) => parts.every((f) => f(row));
  }
  const m = text.match(/^([A-Za-z0-9_>-]+)\.(.+)$/)!;
  return filter(m[1], m[2]);
}

function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function filter(key: string, expr: string): (row: Row) => boolean {
  const neg = expr.startsWith("not.");
  const body = neg ? expr.slice(4) : expr;
  const dot = body.indexOf(".");
  const op = body.slice(0, dot);
  const value = body.slice(dot + 1);
  let f: (v: unknown) => boolean;
  if (op === "eq") f = (v) => v !== null && v !== undefined && String(v) === value;
  else if (op === "in") {
    const set = new Set(value.slice(1, -1).split(",").map((s) => s.trim()));
    f = (v) => v !== null && v !== undefined && set.has(String(v));
  } else if (op === "like") {
    const re = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    f = (v) => typeof v === "string" && re.test(v);
  } else if (op === "is") f = (v) => (value === "null" ? v === null || v === undefined : false);
  else if (["lt", "gt", "lte", "gte"].includes(op)) {
    f = (v) => {
      if (v === null || v === undefined) return false;
      const c = cmp(v, value);
      return op === "lt" ? c < 0 : op === "gt" ? c > 0 : op === "lte" ? c <= 0 : c >= 0;
    };
  } else throw new Error(`fake postgrest: unsupported ${key}=${expr}`);
  return (row) => (neg ? !f(col(row, key)) : f(col(row, key)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const table = url.pathname.replace(/^\/rest\/v1\//, "");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  res.setHeader("content-type", "application/json");
  if (req.method !== "GET" && req.method !== "HEAD") {
    writes.push({ method: req.method ?? "", table, body: text ? JSON.parse(text) : null });
    res.statusCode = 201;
    return res.end(String(req.headers.prefer ?? "").includes("return=representation") ? "[]" : "");
  }
  gets.push(`${table}?${url.searchParams.toString()}`);
  let rows = [...(db[table] ?? [])];
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or") {
      const parts = splitTop(value.slice(1, -1)).map(cond);
      rows = rows.filter((row) => parts.some((f) => f(row)));
      continue;
    }
    rows = rows.filter(filter(key, value));
  }
  const total = rows.length;
  const order = url.searchParams.get("order");
  if (order) {
    const keys = order.split(",").map((p) => ({ c: p.split(".")[0], desc: p.includes(".desc") }));
    rows.sort((a, b) => {
      for (const k of keys) {
        const va = col(a, k.c);
        const vb = col(b, k.c);
        const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
        if (c !== 0) return k.desc ? -c : c;
      }
      return 0;
    });
  }
  const limit = Math.min(Number(url.searchParams.get("limit") || CAP), CAP);
  rows = rows.slice(0, limit);
  const select = url.searchParams.get("select");
  const projected =
    !select || select === "*"
      ? rows
      : rows.map((row) =>
          Object.fromEntries(
            select.split(",").map((s) => {
              const m = s.match(/^([A-Za-z0-9_]+):(.+)$/);
              return [m ? m[1] : s, col(row, m ? m[2] : s) ?? null];
            }),
          ),
        );
  if (String(req.headers.prefer ?? "").includes("count=exact")) res.setHeader("content-range", `0-${Math.max(0, projected.length - 1)}/${total}`);
  res.statusCode = 200;
  res.end(JSON.stringify(projected));
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

type StreamerArg = Parameters<typeof import("../lib/upboSupabase").previewDonationTimeRejudgeForStreamer>[0];
const STREAMER = SYNTH_STREAMER as unknown as StreamerArg;

test("합성 정답 사례가 DB 읽기 경로로도 같은 요약을 낸다(쓰기 0)", async () => {
  reset(SYNTH_TABLES);
  const out = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  const picked = Object.fromEntries(Object.keys(SYNTH_EXPECTED_SUMMARY).map((k) => [k, out.summary[k as keyof typeof out.summary]]));
  assert.deepEqual(picked, SYNTH_EXPECTED_SUMMARY);
  assert.equal(out.totalRows, SYNTH_EXPECTED_SUMMARY.d + SYNTH_EXPECTED_SUMMARY.suspectedOver, "🟢·🟡·오기록 의심만 행으로");
  assert.ok(out.rows.every((r) => r.kind === "suspected" || r.cls !== "grey"));
  assert.equal(out.latestVersion, 3);
  assert.ok(Array.isArray(out.aliasCandidates));
  assert.deepEqual(writes, [], "미리보기는 쓰기 0(entries·modifier_state·쿠폰·audit 무변화)");
});

test("이력은 페이지 순회로 전량 읽는다 — special_item_rule 1,200줄의 마지막 확정도 반영", async () => {
  const cell = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "다음 룰렛 2배", probability: 3, sortOrder: 0 }] }],
  }).items[0];
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "다음 룰렛 2배", probability: 3 }, { name: "하트", probability: 97 }] }],
  }).groups;
  const sid = SYNTH_STREAMER.id;
  const rules: Row[] = [];
  for (let i = 0; i < 1200; i += 1) {
    const last = i === 1199;
    rules.push({
      id: `r${String(i).padStart(5, "0")}`,
      streamer_id: sid,
      action: "special_item_rule",
      created_at: new Date(Date.parse("2026-10-01T00:00:00Z") + i * 1000).toISOString(),
      payload: {
        rule: {
          ruleKey: last ? specialRuleKeyForItem(cell) : `x${i}::y::1`,
          ruleType: "next_result_multiplier",
          status: last ? "confirmed" : "rejected",
          multiplier: 2,
          amountRangeLabel: last ? "33" : `x${i}`,
          itemName: cell.itemName,
          normalizedName: last ? cell.normalizedName : `y${i}`,
          probability: 3,
        },
      },
    });
  }
  reset({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "c1", streamer_id: sid, version: 1, captured_at: "2026-09-30T00:00:00Z", created_at: "2026-09-30T00:00:00Z", groups }],
    audit_logs: rules,
    raw_imports: [
      {
        id: "raw1",
        streamer_id: sid,
        type: "results",
        batch_id: null,
        saved_at: "2026-10-02T00:00:00Z",
        raw: { rows: [{ sourceUid: "dbl1", donateTimeText: "2026-10-01 20:00:00", donationAmount: 33, fanId: "viewer01", results: [{ name: "다음 룰렛 2배", probability: 3 }] }] },
      },
    ],
  });
  const out = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  assert.equal(out.summary.excluded.modifier, 1, "1,000행에서 잘렸으면 확정을 못 봐서 '새로 기록'이 됐을 것");
  assert.equal(out.summary.d, 0);
  const auditGets = gets.filter((g) => g.startsWith("audit_logs?") && g.includes("special_item_rule") && g.includes("threshold_percent_updated"));
  assert.equal(auditGets.length, 2, "1,000행 + 커서로 나머지 200행");
  assert.ok(auditGets[1].includes("or="));
});

test("무거운 표본(3만 결과 + 반영 배치 3,000 + 이력 1,500줄): 쪽(2,000행)으로 나뉘고 응답 4.5MB 미만, 계산 시간 상한", async () => {
  const sid = SYNTH_STREAMER.id;
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "단컷", probability: 2 }, { name: "하트", probability: 98 }] }],
  }).groups;
  const raw: Row[] = [];
  for (let b = 0; b < 300; b += 1) {
    const rows = [];
    for (let i = 0; i < 100; i += 1) {
      const n = b * 100 + i;
      const green = n % 10 === 0; // 10% 는 기록 후보(3,000건), 나머지는 기준 초과
      rows.push({
        sourceUid: `heavy${String(n).padStart(6, "0")}`,
        donateTimeText: `2026-10-${String(2 + (n % 20)).padStart(2, "0")} ${String(n % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`,
        donationType: "별풍선",
        donationAmount: 33,
        fanNickname: `시청자${n % 500}`,
        fanId: `viewer${n % 500}`,
        results: [{ name: green ? "단컷" : "하트", probability: green ? 2 : 98, rawText: green ? "(2%) 단컷" : "(98%) 하트" }],
      });
    }
    raw.push({ id: `raw${String(b).padStart(4, "0")}`, streamer_id: sid, type: "results", batch_id: null, saved_at: new Date(Date.parse("2026-10-23T00:00:00Z") + b * 1000).toISOString(), raw: { rows } });
  }
  // 반영 배치 3,000개(전 스트리머 합계 7,690줄 중 무거운 1명 가정)와 사용 설정·기준% 이력 — 결과마다 다시 정렬하면 느려지던 재료
  const batches: Row[] = Array.from({ length: 3000 }, (_, i) => ({
    id: `b${String(i).padStart(5, "0")}`,
    streamer_id: sid,
    applied_at: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 900_000).toISOString(),
    threshold_percent: 10,
  }));
  const audits: Row[] = Array.from({ length: 1500 }, (_, i) => ({
    id: `a${String(i).padStart(5, "0")}`,
    streamer_id: sid,
    action: i % 2 ? "catalog_usage_updated" : "threshold_percent_updated",
    created_at: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 1_700_000).toISOString(),
    payload: i % 2 ? { catalogVersion: 1, overrides: { "g0-i1": i % 4 === 1 } } : { before: 10, after: 10, source: "settings" },
  }));
  reset({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "c1", streamer_id: sid, version: 1, captured_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z", groups }],
    audit_logs: audits,
    import_batches: batches,
    raw_imports: raw,
  });
  const started = Date.now();
  const first = await lib.previewDonationTimeRejudgeForStreamer(STREAMER, { page: 0 });
  const elapsed = Date.now() - started;
  assert.equal(first.summary.N, 30000);
  assert.equal(first.summary.d, 3000);
  assert.equal(first.summary.b, 27000);
  assert.equal(first.rows.length, 2000);
  assert.equal(first.pageCount, 2);
  const bytes = Buffer.byteLength(JSON.stringify(first));
  assert.ok(bytes < 4.5 * 1024 * 1024, `응답 ${bytes} bytes`);
  assert.ok(elapsed < 20_000, `계산 ${elapsed}ms — Vercel 60초 제한 안쪽 여유`);
  const last = await lib.previewDonationTimeRejudgeForStreamer(STREAMER, { page: 99 });
  assert.equal(last.page, 1, "넘친 쪽 번호는 마지막 쪽으로");
  assert.equal(last.rows.length, 1000);
  assert.deepEqual(last.aliasCandidates, [], "이름 연결 재료는 첫 쪽에만");
  console.log(`  [heavy] 3만 결과·배치 3,000·이력 1,500 미리보기 ${elapsed}ms, 첫 쪽 응답 ${(bytes / 1024).toFixed(1)}KB`);
});

test("판정 입력 지문: 같은 데이터면 같고, 입력 이벤트 하나가 바뀌면 바뀐다", async () => {
  reset(SYNTH_TABLES);
  const a = (await lib.previewDonationTimeRejudgeForStreamer(STREAMER)).inputFingerprint;
  const b = (await lib.previewDonationTimeRejudgeForStreamer(STREAMER)).inputFingerprint;
  assert.equal(a, b);
  db.audit_logs.push({
    id: "5e1f0000-0000-4000-8000-0000000009ff",
    streamer_id: SYNTH_STREAMER.id,
    action: "threshold_overrides_updated",
    created_at: "2026-10-27T00:00:00.000Z",
    payload: { overrides: { "170": 35 } },
  });
  const c = (await lib.previewDonationTimeRejudgeForStreamer(STREAMER)).inputFingerprint;
  assert.notEqual(a, c);
});

test("다음 쪽은 첫 쪽의 원본 기준 시각(rawUntil)까지만 — 방송 중 새 원본이 쌓여도 지문·행이 같다", async () => {
  reset(SYNTH_TABLES);
  const first = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  assert.ok(first.rawUntil, "첫 쪽이 기준 시각을 준다");
  db.raw_imports.push({
    id: "5e1f0000-0000-4000-8000-0000000004ff",
    streamer_id: SYNTH_STREAMER.id,
    type: "results",
    batch_id: null,
    saved_at: "2026-10-27T05:00:00.000Z",
    raw: { rows: [{ sourceUid: "synthlive1", donateTimeText: "2026-10-27 13:59:00", donationAmount: 33, fanId: "viewer30", results: [{ name: "사진 1장", probability: 3 }] }] },
  });
  const pinned = await lib.previewDonationTimeRejudgeForStreamer(STREAMER, { rawUntil: first.rawUntil });
  assert.equal(pinned.inputFingerprint, first.inputFingerprint);
  assert.equal(pinned.summary.N, first.summary.N);
  const fresh = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  assert.notEqual(fresh.inputFingerprint, first.inputFingerprint, "새 미리보기는 새 원본까지 본다");
  assert.equal(fresh.summary.N, first.summary.N + 1);
});

test("시범 스위치: 기본 꺼짐, 켜면 한 줄(전체 값), 팬 페이지 오버레이 조회엔 새 action 이 없다", async () => {
  reset(SYNTH_TABLES);
  assert.deepEqual(await lib.featureFlagsForStreamer(SYNTH_STREAMER.id), { asofRejudge: false, catalogDriftNotice: false });
  const next = await lib.setFeatureFlags(STREAMER, { asofRejudge: true, unknown: true });
  assert.deepEqual(next, { asofRejudge: true, catalogDriftNotice: false });
  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0].body as Row).payload, { asofRejudge: true, catalogDriftNotice: false });
  assert.equal((writes[0].body as Row).action, "upbo_feature_flags");
  // 팬 페이지(getStreamerState)의 오버레이 묶음 조회에 시범 스위치·근사 판정 이력이 끼지 않는다
  gets.length = 0;
  await lib.getStreamerState(SYNTH_STREAMER.slug).catch(() => null);
  const overlay = gets.find((g) => g.startsWith("audit_logs?") && g.includes("action=in."));
  assert.ok(overlay, "오버레이 조회를 찾지 못함");
  assert.ok(!overlay!.includes("upbo_feature_flags"));
});
