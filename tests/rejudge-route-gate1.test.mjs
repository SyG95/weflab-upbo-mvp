// 관문 1: 다시판정 경로의 표 밖 제외·의심 수가 시트 관리자 인증과 시범 스위치 뒤에 있는지.
// 라우트는 transpile + vm 으로 로드해 의존성을 가짜로 주입한다(자격증명·네트워크 0).
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

function loadRoute(mocks) {
  const src = fs.readFileSync(path.join(root, "app/api/s/[streamerSlug]/rejudge/route.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const box = { exports: {} };
  vm.runInNewContext(js, { module: box, exports: box.exports, require: (name) => (name in mocks ? mocks[name] : require(name)), URL, Request, Response, console, process });
  return box.exports;
}

const upboRoute = {
  jsonOk: (body, status = 200) => Response.json(body, { status }),
  jsonError: (error) => Response.json({ ok: false, error: error?.message ?? "unknown" }, { status: error?.status >= 400 ? error.status : 400 }),
  readJson: async (req) => {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  },
};

function make({ deny = false, flag = true } = {}) {
  const calls = { policy: [], headline: 0 };
  const route = loadRoute({
    "@/lib/upboRoute": upboRoute,
    "@/lib/sheetAdminAuth": {
      requireSheetAdmin: async () => {
        if (deny) throw Object.assign(new Error("관리자 인증이 필요합니다."), { status: 401 });
      },
    },
    // 관문 2 에서 라우트가 새로 읽는 마스터키 세션 판별(여기 시험은 관문 1 범위라 늘 아님).
    "@/lib/sheetMasterSession": { isSheetMasterSession: async () => false },
    "@/lib/upboSupabase": {
      getStreamerRowBySlug: async () => ({ id: "s1", slug: "demo" }),
      featureFlagsForStreamer: async () => ({ asofRejudge: flag, catalogDriftNotice: false }),
      missingSuspectHeadline: async () => {
        calls.headline += 1;
        return { remaining: 1, newSince: 2, numberHidden: false };
      },
      setMissingCandidatePolicy: async (_s, p) => {
        calls.policy.push(p);
        return { key: "33|x", decision: p.decision };
      },
      applyRejudgeForStreamer: async () => ({}),
      previewRejudgeForStreamer: async () => ({}),
      previewDonationTimeRejudgeForStreamer: async () => ({}),
    },
  });
  return { calls, route };
}

const context = { params: Promise.resolve({ streamerSlug: "demo" }) };
const post = (body) => new Request("http://localhost/api/s/demo/rejudge", { method: "POST", body: JSON.stringify(body) });
const get = (q = "") => new Request(`http://localhost/api/s/demo/rejudge${q}`);
const policy = { policy: { amount: 33, itemName: "5킬", decision: "exclude" } };

test("POST policy: 시트 관리자가 아니면 401, 저장 안 함", async () => {
  const { route, calls } = make({ deny: true });
  const res = await route.POST(post(policy), context);
  assert.equal(res.status, 401);
  assert.equal(calls.policy.length, 0);
});

test("POST policy: 시범 스위치가 꺼져 있으면 403, 저장 안 함", async () => {
  const { route, calls } = make({ flag: false });
  const res = await route.POST(post(policy), context);
  assert.equal(res.status, 403);
  assert.equal(calls.policy.length, 0);
});

test("POST policy: 인증·스위치가 있으면 저장", async () => {
  const { route, calls } = make();
  const res = await route.POST(post(policy), context);
  assert.equal(res.status, 200);
  assert.equal(calls.policy.length, 1);
});

test("POST policy: 객체가 아니면 400", async () => {
  const { route, calls } = make();
  const res = await route.POST(post({ policy: "x" }), context);
  assert.equal(res.status, 400);
  assert.equal(calls.policy.length, 0);
});

test("GET ?suspect=1: 스위치 꺼짐이면 숫자를 읽지 않는다", async () => {
  const { route, calls } = make({ flag: false });
  const res = await route.GET(get("?suspect=1"), context);
  assert.equal((await res.json()).suspect, null);
  assert.equal(calls.headline, 0);
});

test("GET ?suspect=1: 인증 없으면 401", async () => {
  const { route, calls } = make({ deny: true });
  const res = await route.GET(get("?suspect=1"), context);
  assert.equal(res.status, 401);
  assert.equal(calls.headline, 0);
});

test("GET: suspect 를 요청하지 않으면 숫자를 읽지 않는다", async () => {
  const { route, calls } = make();
  await route.GET(get(), context);
  assert.equal(calls.headline, 0);
});

test("GET ?suspect=1: 스위치 켜짐이면 숫자를 준다", async () => {
  const { route, calls } = make();
  const res = await route.GET(get("?suspect=1"), context);
  assert.deepEqual((await res.json()).suspect, { remaining: 1, newSince: 2, numberHidden: false });
  assert.equal(calls.headline, 1);
});

test("클라이언트 화면은 판정 모듈을 끌어오지 않는다(공개 번들 보호)", () => {
  for (const file of ["RejudgeManager.tsx", "MissingSuspectNotice.tsx", "ManualEntryManager.tsx"]) {
    const src = fs.readFileSync(path.join(root, "app/[streamerSlug]", file), "utf8");
    assert.ok(!/from\s+"[^"]*missingCandidate"/.test(src), `${file}: missingCandidate 를 import 하면 안 된다`);
  }
  const prefill = fs.readFileSync(path.join(root, "lib/manualPrefill.ts"), "utf8");
  assert.ok(!/^import\s/m.test(prefill), "manualPrefill 은 의존성이 없어야 한다");
});
