// 실제 라우트·Bearer 검사·페어링 판정을 메모리 안에서 연결한다.
// process.env / global fetch / 운영 DB를 건드리지 않는다. DB 어댑터는 호출 기록용 가짜다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = "boundary-tests-only-operator-token";

// 큰 DB 모듈에서는 인증 순수 함수만 AST로 꺼낸다. 검사 로직을 테스트에 다시 구현하지 않는다.
function sourceFunctions(relative, names) {
  const filename = path.join(root, relative);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length, `source functions missing from ${relative}`);
  return selected.map((node) => node.getText(source)).join("\n");
}

function harness({ env: overrides = {}, sheetPin = "0420" } = {}) {
  const env = { VERCEL: "1", UPBO_SESSION_SECRET: "boundary-tests-only-signing-secret", UPBO_ADMIN_TOKEN: MASTER, ...overrides };
  const cookies = new Map();
  const calls = { mutations: [], reads: [], attempts: 0, successes: 0 };
  const jar = {
    get: (name) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
    set: (name, value) => cookies.set(name, value),
  };
  const headers = { cookies: async () => jar, headers: async () => ({ get: () => null }) };

  function load(relative, mocks = {}, { source, globals = {} } = {}) {
    const filename = path.join(root, relative);
    const js = ts.transpileModule(source ?? fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const box = { exports: {} };
    vm.runInNewContext(js, {
      module: box, exports: box.exports,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === "node:crypto") return require(name);
        throw new Error(`Unexpected dependency in ${relative}: ${name}`);
      },
      process: { env }, Buffer, URL, Request, Response, FormData, console,
      fetch() { throw new Error("Network access is forbidden in boundary tests"); },
      ...globals,
    }, { filename });
    return box.exports;
  }

  const auth = load("lib/adminAuth.ts", { "next/headers": headers });
  const visitor = load("lib/adminVisitorAccess.ts", { "next/headers": headers, "./adminAuth": auth });
  const bearer = load("lib/upboSupabase.ts", {}, {
    source: 'import crypto from "node:crypto";\n' + sourceFunctions("lib/upboSupabase.ts", ["assertAdminToken", "tokenHashBuffer", "bearerToken"]),
  });
  const throttle = {
    beginMasterAttempt: async () => { calls.attempts++; return { locked: false, remaining: 9 }; },
    beginUnlockAttempt: async () => { calls.attempts++; return { locked: false, remaining: 6 }; },
    recordUnlockSuccess: async () => { calls.successes++; },
    recordOperatorUnlock: async (...args) => { calls.mutations.push(["recordOperatorUnlock", ...args]); },
    wrongPasswordMessage: () => "wrong password", lockedMessage: () => "locked",
  };
  const apiAuth = load("lib/adminApiAuth.ts", {
    "./adminAuth": auth, "./unlockThrottle": throttle, "./upboSupabase": bearer,
  });
  const routeHelpers = load("lib/upboRoute.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  });
  const mutation = (name, result) => async (...args) => {
    calls.mutations.push([name, ...args]);
    return result;
  };
  const database = {
    upsertStreamer: mutation("upsertStreamer", { slug: "demo", displayName: "Demo" }),
    createExtensionToken: mutation("createExtensionToken", { token: { value: "extension-token-fixture" } }),
    executeStreamerReset: mutation("executeStreamerReset", { items: [], total: 0 }),
    setSheetAdminPinHash: mutation("setSheetAdminPinHash"),
    deleteStreamer: mutation("deleteStreamer"), renameStreamer: mutation("renameStreamer"),
    setExtensionConfig: mutation("setExtensionConfig", {}), setExtensionConfigForAll: mutation("setExtensionConfigForAll", 1),
    previewStreamerReset: async () => { calls.reads.push("previewStreamerReset"); return { items: [], total: 0 }; },
    getStreamerRowBySlug: async (slug) => { calls.reads.push("getStreamerRowBySlug"); return { id: "streamer-fixture", slug, display_name: "Demo" }; },
    hasResetScope: (scope) => Object.values(scope).some(Boolean),
  };
  const mocks = {
    "@/lib/adminAuth": auth, "@/lib/adminApiAuth": apiAuth,
    "@/lib/upboSupabase": database, "@/lib/upboRoute": routeHelpers,
  };
  const actions = load("app/admin/actions.ts", {
    ...mocks, "next/headers": headers, "next/navigation": { redirect() { throw new Error("Unexpected redirect"); } },
    "next/cache": { revalidatePath() {} }, "@/lib/adminVisitorAccess": visitor, "@/lib/unlockThrottle": throttle,
  });
  const decision = load("lib/unlockThrottle.ts", {}, {
    source: sourceFunctions("lib/unlockThrottle.ts", ["decideStreamerUnlock"]), globals: throttle,
  });
  const pairing = load("lib/extensionPairing.ts", {
    "./adminAuth": auth,
    "./sheetAdminAuth": { effectiveSheetPinHash: async () => sheetPin === null ? null : auth.adminTokenHash(sheetPin) },
    "./unlockThrottle": decision, "./upboSupabase": database,
  });
  return {
    auth, visitor, actions, cookies, calls,
    route: (relative) => load(relative, { ...mocks, "@/lib/extensionPairing": pairing }),
    visit() { cookies.set(visitor.ADMIN_VISITOR_COOKIE, visitor.visitorSessionValue()); },
  };
}

const ADMIN_ROUTES = [
  { name: "create", file: "app/api/admin/streamers/route.ts", body: { slug: "demo", displayName: "Demo" }, mutation: "upsertStreamer" },
  { name: "reset", file: "app/api/admin/streamers/[streamerSlug]/reset/route.ts", body: { preset: "full", dryRun: false, confirm: "demo" }, mutation: "executeStreamerReset" },
  { name: "token", file: "app/api/admin/streamers/[streamerSlug]/tokens/route.ts", body: { label: "fixture" }, mutation: "createExtensionToken" },
];

function request(body, headers = {}) {
  return new Request("https://example.invalid/api/test", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
}

for (const spec of ADMIN_ROUTES) {
  test(`${spec.name} API: signed visitor cookie / public PIN / visitor signature Bearer never authorizes a write`, async () => {
    for (const authorization of [undefined, "Bearer 1234", "Bearer visitor1234", "visitor-signature"]) {
      const h = harness();
      h.visit();
      assert.equal(await h.visitor.adminVisitorAccessState(), true);
      const session = h.visitor.visitorSessionValue();
      const bearer = authorization === "visitor-signature" ? `Bearer ${session}` : authorization;
      const res = await h.route(spec.file).POST(request(spec.body, {
        Cookie: `${h.visitor.ADMIN_VISITOR_COOKIE}=${session}; ${h.auth.ADMIN_COOKIE}=${session}`,
        ...(bearer ? { Authorization: bearer } : {}),
      }), { params: Promise.resolve({ streamerSlug: "demo" }) });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).ok, false);
      assert.equal(h.calls.mutations.length, 0, "denial must precede every business mutation");
      assert.equal(h.calls.reads.length, 0, "denial must precede private data lookup too");
      assert.equal(h.calls.successes, 0);
    }
  });

  test(`${spec.name} API: configured operator Bearer still reaches the expected mutation`, async () => {
    const h = harness();
    h.visit();
    const res = await h.route(spec.file).POST(request(spec.body, { Authorization: `Bearer ${MASTER}` }), {
      params: Promise.resolve({ streamerSlug: "demo" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
    assert.deepEqual(h.calls.mutations.map(([name]) => name), [spec.mutation]);
  });

  test(`${spec.name} API: missing admin environment fails closed even on local with visitor cookie`, async () => {
    const h = harness({ env: { VERCEL: undefined, UPBO_ADMIN_TOKEN: undefined } });
    h.visit();
    const res = await h.route(spec.file).POST(request(spec.body, { Authorization: "Bearer 1234" }), {
      params: Promise.resolve({ streamerSlug: "demo" }),
    });
    assert.equal(res.status, 503);
    assert.equal(h.calls.attempts, 0);
    assert.equal(h.calls.mutations.length, 0);
    assert.equal(h.calls.reads.length, 0);
  });
}

test("direct operator-unlock / one-streamer config / all-streamer config actions reject a visitor before I/O", async () => {
  for (const env of [{}, { VERCEL: undefined, UPBO_ADMIN_TOKEN: undefined }]) {
    const h = harness({ env });
    h.visit();
    const form = new FormData();
    form.set("slug", "demo");
    const results = [
      await h.actions.unlockStreamerThrottleAction({}, form),
      await h.actions.setExtensionConfigAction("demo", { staleTabHours: 0 }),
      await h.actions.setExtensionConfigForAllAction({ staleTabHours: 0 }),
    ];
    for (const result of results) assert.match(result.error, /관리자 인증/);
    assert.equal(h.calls.mutations.length, 0);
    assert.equal(h.calls.reads.length, 0);
  }
});

test("extension pair: a visitor session adds no pairing permission without the streamer's real credential", async () => {
  for (const sheetPin of ["0420", null]) {
    for (const password of ["", "1234", "visitor1234", "signed-visitor-session"]) {
      const h = harness({ sheetPin });
      h.visit();
      const session = h.visitor.visitorSessionValue();
      const res = await h.route("app/api/extension/pair/route.ts").POST(request({
        slug: "demo", password: password === "signed-visitor-session" ? session : password,
      }, { Cookie: `${h.visitor.ADMIN_VISITOR_COOKIE}=${session}` }));
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "invalid_password");
      assert.equal(Object.hasOwn(body, "token"), false);
      assert.equal(h.calls.mutations.length, 0, "visitor must never cause extension-token creation");
    }
  }
});

test("extension pair: an actual per-streamer PIN of 1234 remains valid independently of visitor status", async () => {
  for (const visiting of [false, true]) {
    const h = harness({ sheetPin: "1234" });
    if (visiting) h.visit();
    const res = await h.route("app/api/extension/pair/route.ts").POST(request({ slug: "demo", password: "1234" }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).token, "extension-token-fixture");
    assert.deepEqual(h.calls.mutations.map(([name]) => name), ["createExtensionToken"]);
  }
});
