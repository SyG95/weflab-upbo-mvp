// GET /api/s/[slug]/item-events 보안 수리 회귀 테스트 (2026-10-18 점검 critical).
//  - 로그인 없는 GET 차단: requireSheetAdmin 없으면 401.
//  - entry id 검사: UUID 가 아니면(주입 모양 포함) 400, 쿼리에 도달하지 않음.
//  - 정상 조회: 유효 UUID 는 통과하고, 쿼리에 인코딩된 값만 들어간다(여분 파라미터 주입 없음).
// 라우트는 transpile + vm 으로 로드해 의존성을 가짜로 주입한다(자격증명·네트워크 0). 실제
// getItemEvents 는 env·fetch 를 스텁해 직접 호출한다.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// @/lib/* 등을 가짜로 바꿔 route.ts 만 실제로 실행한다.
function loadRoute(mocks) {
  const src = fs.readFileSync(path.join(root, "app/api/s/[streamerSlug]/item-events/route.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const box = { exports: {} };
  vm.runInNewContext(js, {
    module: box,
    exports: box.exports,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
    URL,
    Request,
    Response,
    console,
    process,
  });
  return box.exports;
}

// upboRoute 의 실제 동작을 그대로 흉내낸다(에러 status 없으면 400).
const upboRouteMock = {
  jsonOk: (body, status = 200) => Response.json(body, { status }),
  jsonError: (error) => {
    const status = error && error.status && error.status >= 400 ? error.status : 400;
    return Response.json({ ok: false, error: (error && error.message) || "unknown error" }, { status });
  },
  readJson: async (req) => {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  },
};

function makeRoute({ deny = false, events = [] } = {}) {
  const calls = { auth: [], get: [] };
  return {
    calls,
    route: loadRoute({
      "@/lib/upboRoute": upboRouteMock,
      "@/lib/sheetAdminAuth": {
        requireSheetAdmin: async (slug) => {
          calls.auth.push(slug);
          if (deny) {
            const e = new Error("관리자 인증이 필요합니다.");
            e.status = 401;
            throw e;
          }
        },
      },
      "@/lib/upboSupabase": {
        getItemEvents: async (slug, id) => {
          calls.get.push({ slug, id });
          return events;
        },
        getStreamerRowBySlug: async () => ({ id: "s1" }),
        recordItemEvent: async () => ({ entry: {}, itemEvents: [] }),
        setTransferOwnerId: async () => {},
      },
    }),
  };
}

const UUID = "11111111-1111-1111-1111-111111111111";

async function callGet(route, qs) {
  const res = await route.GET(new Request(`https://example.invalid/api/s/local/item-events${qs}`), {
    params: Promise.resolve({ streamerSlug: "local" }),
  });
  return { status: res.status, body: await res.json() };
}

test("GET: 로그인 안 되어 있으면 401 (requireSheetAdmin 강제)", async () => {
  const { route, calls } = makeRoute({ deny: true });
  const r = await callGet(route, `?upboEntryId=${UUID}`);
  assert.equal(r.status, 401);
  assert.equal(r.body.ok, false);
  assert.equal(calls.auth.length, 1, "requireSheetAdmin 이 먼저 불려야 한다");
  assert.equal(calls.get.length, 0, "인증 실패 시 조회로 넘어가지 않는다");
});

test("GET: 인증돼도 upboEntryId 없으면 400", async () => {
  const { route, calls } = makeRoute({ deny: false });
  const r = await callGet(route, "");
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.equal(calls.get.length, 0);
});

test("GET: 인증 + 유효 id → 200 과 이벤트 목록", async () => {
  const sample = [{ id: "e1", upboEntryId: UUID, eventType: "cancel" }];
  const { route, calls } = makeRoute({ deny: false, events: sample });
  const r = await callGet(route, `?upboEntryId=${UUID}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.events, sample);
  assert.deepEqual(calls.get[0], { slug: "local", id: UUID });
});

// ── 실제 getItemEvents: UUID 검사 + 인코딩 ─────────────────────────────────
let getItemEvents;
before(async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  ({ getItemEvents } = await import("../lib/upboSupabase.ts"));
});

test("getItemEvents: UUID 가 아니면(주입 모양) 거부하고 네트워크로 안 간다", async () => {
  const origFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("[]", { status: 200 });
  });
  try {
    // 과거 공격 입력 형태: 유효 UUID 뒤에 쿼리 파라미터를 끼워 넣으려는 값.
    for (const bad of [`${UUID}&select=id`, `${UUID}#`, "not-a-uuid", ""]) {
      await assert.rejects(() => getItemEvents("local", bad), /invalid entry id/, `bad=${JSON.stringify(bad)}`);
    }
    assert.equal(called, false, "검사 실패 입력은 fetch 로 가지 않는다");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("getItemEvents: 유효 UUID 는 인코딩된 값만 쿼리에 들어간다", async () => {
  const origFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/streamers")) {
      return new Response(JSON.stringify([{ id: "s1", slug: "local" }]), { status: 200 });
    }
    // item_events 조회
    return new Response(
      JSON.stringify([{ id: "e1", upbo_entry_id: UUID, event_type: "cancel", actor_type: "operator", created_at: "2026-10-18T00:00:00Z" }]),
      { status: 200 },
    );
  });
  try {
    const events = await getItemEvents("local", UUID);
    assert.equal(events.length, 1);
    assert.equal(events[0].upboEntryId, UUID);
    const itemUrl = urls.find((u) => u.includes("item_events"));
    assert.ok(itemUrl, "item_events 조회가 있어야 한다");
    assert.ok(itemUrl.includes(`upbo_entry_id=eq.${UUID}`), `entry id 필터가 그대로: ${itemUrl}`);
    // 코드가 붙이는 select 는 정확히 1개여야 한다(공격자 select 가 끼지 않음).
    assert.equal((itemUrl.match(/select=/g) || []).length, 1, `select 파라미터 1개: ${itemUrl}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});
