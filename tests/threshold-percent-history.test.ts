// 전역 기준%(streamers.threshold_percent) 변경 이력 — 순수 규칙(lib/thresholdHistory)과
// 저장 경로(lib/upboSupabase setStreamerSettings·upsertStreamer·리셋 보존)를 가짜 PostgREST 로 검증한다.
// 왜: "그때 기준"으로 옛 결과를 다시 판정하려면 기준% 이력이 있어야 한다(2026-10-25 1단계 묶음 1).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  THRESHOLD_PERCENT_ACTION,
  parseThresholdHistoryRow,
  thresholdChangeToRecord,
  thresholdPercentAt,
} from "../lib/thresholdHistory";

// ---------- 순수 규칙 ----------

test("이력이 없으면 첫 저장은 값이 같아도 baseline 1줄, 바뀌면 그 출처로 1줄", () => {
  assert.deepEqual(
    thresholdChangeToRecord({ hasHistory: false, latestAfter: null, before: 2, after: 2, source: "settings" }),
    { before: 2, after: 2, source: "baseline" },
  );
  assert.deepEqual(
    thresholdChangeToRecord({ hasHistory: false, latestAfter: null, before: 2, after: 5, source: "settings" }),
    { before: 2, after: 5, source: "settings" },
  );
  // 새 스트리머 생성(이전 값 없음)
  assert.deepEqual(
    thresholdChangeToRecord({ hasHistory: false, latestAfter: null, before: null, after: 2, source: "admin_upsert" }),
    { before: null, after: 2, source: "admin_upsert" },
  );
});

test("이력이 있으면 바뀔 때만 1줄 — 같은 값 저장은 0줄", () => {
  assert.equal(thresholdChangeToRecord({ hasHistory: true, latestAfter: 2, before: 2, after: 2, source: "settings" }), null);
  assert.deepEqual(
    thresholdChangeToRecord({ hasHistory: true, latestAfter: 2, before: 2, after: 3.5, source: "settings" }),
    { before: 2, after: 3.5, source: "settings" },
  );
});

test("기록 없이 바뀐 흔적(DB 값 ≠ 최신 이력)이 있으면 같은 값 저장이어도 1줄로 메운다", () => {
  // 이력은 2인데 DB 는 5(기록 실패·다른 경로) → 지금 2로 저장: before 5 → after 2 를 남긴다
  assert.deepEqual(
    thresholdChangeToRecord({ hasHistory: true, latestAfter: 2, before: 5, after: 2, source: "settings" }),
    { before: 5, after: 2, source: "settings" },
  );
});

test("payload 파싱 — 모양이 깨진 줄은 버린다", () => {
  assert.deepEqual(parseThresholdHistoryRow({ created_at: "2026-10-25T01:00:00Z", payload: { before: 2, after: 3 } }), {
    at: "2026-10-25T01:00:00Z",
    before: 2,
    after: 3,
  });
  assert.deepEqual(parseThresholdHistoryRow({ created_at: "2026-10-25T01:00:00Z", payload: { before: null, after: "4" } }), {
    at: "2026-10-25T01:00:00Z",
    before: null,
    after: 4,
  });
  assert.equal(parseThresholdHistoryRow({ created_at: "2026-10-25T01:00:00Z", payload: { before: 2 } }), null);
  assert.equal(parseThresholdHistoryRow({ created_at: "nope", payload: { after: 2 } }), null);
});

const T = (iso: string) => Date.parse(iso);

test("그때 기준%: t 이전 마지막 이력(정확), 경계는 '이전'만", () => {
  const history = [
    { at: "2026-10-20T00:00:00Z", before: 2, after: 2 },
    { at: "2026-10-22T00:00:00Z", before: 2, after: 5 },
  ];
  assert.deepEqual(thresholdPercentAt(T("2026-10-21T00:00:00Z"), history, [], 9), { value: 2, exact: true, source: "history" });
  assert.deepEqual(thresholdPercentAt(T("2026-10-23T00:00:00Z"), history, [], 9), { value: 5, exact: true, source: "history" });
  // 바뀐 바로 그 시각의 후원은 바뀌기 전 값(같은 시각은 이전 이력만 인정)
  assert.deepEqual(thresholdPercentAt(T("2026-10-22T00:00:00Z"), history, [], 9), { value: 2, exact: true, source: "history" });
});

test("그때 기준%: 다음 이력의 before 가 어긋나면 그 사이는 근사", () => {
  const history = [
    { at: "2026-10-20T00:00:00Z", before: 2, after: 2 },
    { at: "2026-10-25T00:00:00Z", before: 5, after: 2 }, // 20~25일 사이 어딘가에서 기록 없이 5가 됐었다
  ];
  assert.deepEqual(thresholdPercentAt(T("2026-10-22T00:00:00Z"), history, [], 9), { value: 2, exact: false, source: "history" });
  assert.deepEqual(thresholdPercentAt(T("2026-10-26T00:00:00Z"), history, [], 9), { value: 2, exact: true, source: "history" });
});

test("그때 기준%: 이력 시작 전은 그 시각 이전 마지막 반영 배치(근사), 없으면 현재 값(근사)", () => {
  const history = [{ at: "2026-10-20T00:00:00Z", before: 2, after: 3 }];
  const batches = [
    { appliedAt: "2026-10-01T00:00:00Z", thresholdPercent: 1 },
    { appliedAt: "2026-10-10T00:00:00Z", thresholdPercent: 2 },
    { appliedAt: "2026-10-30T00:00:00Z", thresholdPercent: 3 },
  ];
  assert.deepEqual(thresholdPercentAt(T("2026-10-15T00:00:00Z"), history, batches, 9), { value: 2, exact: false, source: "batch" });
  assert.deepEqual(thresholdPercentAt(T("2026-09-01T00:00:00Z"), history, batches, 9), { value: 9, exact: false, source: "current" });
});

// ---------- 저장 경로(가짜 PostgREST) ----------

type Row = Record<string, unknown>;

const state = {
  streamers: [] as Row[],
  audit: [] as Row[],
  failAuditPost: false,
  heads: [] as string[],
  clock: Date.parse("2026-10-25T00:00:00Z"),
};

function eqParam(q: URLSearchParams, key: string): string | undefined {
  return q.get(key)?.replace(/^eq\./, "");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? JSON.parse(text) : null;
  const q = url.searchParams;
  res.setHeader("content-type", "application/json");
  const send = (status: number, value: unknown) => {
    res.statusCode = status;
    res.end(value === "" ? "" : JSON.stringify(value));
  };
  if (req.method === "HEAD") {
    state.heads.push(`${url.pathname}?${q.toString()}`);
    res.setHeader("content-range", "*/0");
    res.statusCode = 200;
    return res.end();
  }
  if (url.pathname === "/rest/v1/streamers") {
    if (req.method === "GET") {
      const slug = eqParam(q, "slug");
      return send(200, state.streamers.filter((r) => r.slug === slug).slice(0, 1));
    }
    if (req.method === "PATCH") {
      const id = eqParam(q, "id");
      const row = state.streamers.find((r) => r.id === id);
      if (!row) return send(200, []);
      Object.assign(row, body);
      return send(200, [row]);
    }
    if (req.method === "POST") {
      // on_conflict=slug, merge-duplicates
      const existing = state.streamers.find((r) => r.slug === body.slug);
      if (existing) {
        Object.assign(existing, body);
        return send(201, [existing]);
      }
      const row = { id: `s-${body.slug}`, ...body };
      state.streamers.push(row);
      return send(201, [row]);
    }
  }
  if (url.pathname === "/rest/v1/audit_logs") {
    if (req.method === "POST") {
      if (state.failAuditPost) return send(500, { message: "boom" });
      const list = Array.isArray(body) ? body : [body];
      for (const r of list) {
        state.clock += 1000;
        state.audit.push({ ...r, created_at: new Date(state.clock).toISOString() });
      }
      return send(201, "");
    }
    const action = eqParam(q, "action");
    const sid = eqParam(q, "streamer_id");
    const rows = state.audit
      .filter((r) => r.action === action && (!sid || r.streamer_id === sid))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const limit = Number(q.get("limit") ?? "1000");
    return send(200, rows.slice(0, Math.min(limit, 1000)));
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
  lib = await import("../lib/upboSupabase");
});

test.after(() => {
  server.close();
});

function historyOf(streamerId: string) {
  return state.audit
    .filter((r) => r.streamer_id === streamerId && r.action === THRESHOLD_PERCENT_ACTION)
    .map((r) => r.payload as Row);
}

test("설정 저장: 첫 저장 baseline → 바뀌면 1줄 → 같은 값이면 0줄", async () => {
  state.streamers = [{ id: "s-a", slug: "aaa", display_name: "A", threshold_percent: 2 }];
  state.audit = [];
  await lib.setStreamerSettings("aaa", { thresholdPercent: 2 });
  assert.deepEqual(historyOf("s-a"), [{ before: 2, after: 2, source: "baseline" }]);
  await lib.setStreamerSettings("aaa", { thresholdPercent: 3 });
  assert.deepEqual(historyOf("s-a").at(-1), { before: 2, after: 3, source: "settings" });
  await lib.setStreamerSettings("aaa", { thresholdPercent: 3 });
  assert.equal(historyOf("s-a").length, 2, "같은 값 저장은 이력을 늘리지 않는다");
  const actors = state.audit.filter((r) => r.action === THRESHOLD_PERCENT_ACTION).map((r) => r.actor);
  assert.deepEqual([...new Set(actors)], ["sheet_admin"]);
});

test("설정 저장: 이력 쓰기 실패면 값은 저장되고 ThresholdHistoryWriteError — 다음 저장이 흔적을 메운다", async () => {
  state.streamers = [{ id: "s-b", slug: "bbb", display_name: "B", threshold_percent: 2 }];
  state.audit = [];
  await lib.setStreamerSettings("bbb", { thresholdPercent: 2 }); // baseline
  state.failAuditPost = true;
  await assert.rejects(
    () => lib.setStreamerSettings("bbb", { thresholdPercent: 7 }),
    (error: unknown) => {
      assert.ok(error instanceof lib.ThresholdHistoryWriteError);
      assert.equal((error as InstanceType<typeof lib.ThresholdHistoryWriteError>).code, "HISTORY_WRITE_FAILED");
      assert.equal((error as InstanceType<typeof lib.ThresholdHistoryWriteError>).settings.thresholdPercent, 7);
      return true;
    },
  );
  state.failAuditPost = false;
  assert.equal(state.streamers[0].threshold_percent, 7, "값 자체는 저장됨");
  assert.equal(historyOf("s-b").length, 1, "실패한 변경은 아직 이력에 없음");
  // 같은 값(7)으로 다시 저장: DB 7 ≠ 최신 이력 after 2 → 메운다
  await lib.setStreamerSettings("bbb", { thresholdPercent: 7 });
  assert.deepEqual(historyOf("s-b").at(-1), { before: 7, after: 7, source: "settings" });
});

test("설정 저장: 기준% 없이 저장하면 이력을 건드리지 않는다", async () => {
  state.streamers = [{ id: "s-c", slug: "ccc", display_name: "C", threshold_percent: 2 }];
  state.audit = [];
  await lib.setStreamerSettings("ccc", {});
  assert.equal(historyOf("s-c").length, 0);
});

test("관리자 등록(upsert): 새 스트리머는 1줄, 기존 슬러그 덮어쓰기도 1줄, 기록 실패는 등록을 막지 않는다", async () => {
  state.streamers = [];
  state.audit = [];
  await lib.upsertStreamer({ slug: "newbie" });
  assert.deepEqual(historyOf("s-newbie"), [{ before: null, after: 2, source: "admin_upsert" }]);
  // 기존 슬러그를 다른 기준으로 덮어쓰기
  state.streamers[0].threshold_percent = 4; // (이력 없이 바뀐 상태라고 가정)
  await lib.upsertStreamer({ slug: "newbie", thresholdPercent: 2 });
  assert.deepEqual(historyOf("s-newbie").at(-1), { before: 4, after: 2, source: "admin_upsert" });
  const actors = state.audit.filter((r) => r.action === THRESHOLD_PERCENT_ACTION).map((r) => r.actor);
  assert.deepEqual([...new Set(actors)], ["operator"]);
  state.failAuditPost = true;
  const saved = await lib.upsertStreamer({ slug: "newbie", thresholdPercent: 3 });
  state.failAuditPost = false;
  assert.equal(saved.settings.thresholdPercent, 3, "이력 기록 실패여도 등록·저장은 성공");
});

test("화면 설정 리셋: 기준% 이력은 지우지 않는다(R6)", async () => {
  state.streamers = [{ id: "s-d", slug: "ddd", display_name: "D", threshold_percent: 2 }];
  state.heads = [];
  await lib.previewStreamerReset("ddd", {
    roulette: false,
    donations: false,
    catalogs: false,
    coupons: false,
    screenState: true,
    pins: false,
  });
  const screenQuery = state.heads.find((h) => h.startsWith("/rest/v1/audit_logs"));
  assert.ok(screenQuery, "화면 설정 리셋 대상 조회가 있어야 한다");
  const notIn = decodeURIComponent(screenQuery!).match(/action=not\.in\.\(([^)]*)\)/);
  assert.ok(notIn, "화이트리스트(not.in) 방식이어야 한다");
  assert.ok(notIn![1].split(",").includes(THRESHOLD_PERCENT_ACTION), "기준% 이력은 남길 목록에 있어야 한다");
});
