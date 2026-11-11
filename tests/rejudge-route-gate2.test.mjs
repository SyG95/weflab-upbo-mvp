// 관문 2: "그때 표로" 넣기·되돌리기의 문(시트 관리자 인증 → sy 마스터키 세션 → 시범 스위치 → 형식 검사).
// 라우트는 transpile + vm 으로 로드해 의존성을 가짜로 주입한다(자격증명·네트워크 0).
// 마스터키 세션 판별(lib/sheetMasterSession.ts)은 실제 인증 파일(adminAuth·sheetAdminAuth)을 그대로 실어 확인한다 — 인증 동작 불변.
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

function load(relative, mocks, globals = {}) {
  const src = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const box = { exports: {} };
  vm.runInNewContext(js, {
    module: box,
    exports: box.exports,
    require: (name) => {
      if (name in mocks) return mocks[name];
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency in ${relative}: ${name}`);
    },
    URL,
    Request,
    Response,
    Buffer,
    console,
    process,
    ...globals,
  });
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

function make({ deny = false, flag = true, master = true } = {}) {
  const calls = { apply: [], preview: 0, nowApply: 0, master: 0, revertPreview: [], revertApply: [], runs: 0, streamer: 0 };
  const mocks = {
    "@/lib/upboRoute": upboRoute,
    "@/lib/sheetAdminAuth": {
      requireSheetAdmin: async () => {
        if (deny) throw Object.assign(new Error("관리자 인증이 필요합니다."), { status: 401 });
      },
    },
    "@/lib/sheetMasterSession": {
      isSheetMasterSession: async () => {
        calls.master += 1;
        return master;
      },
    },
    "@/lib/upboSupabase": {
      getStreamerRowBySlug: async () => {
        calls.streamer += 1;
        return { id: "s1", slug: "demo" };
      },
      featureFlagsForStreamer: async () => ({ asofRejudge: flag, catalogDriftNotice: false }),
      missingSuspectHeadline: async () => ({ remaining: 0, newSince: 0, numberHidden: false }),
      setMissingCandidatePolicy: async () => ({}),
      applyRejudgeForStreamer: async () => {
        calls.nowApply += 1;
        return { applied: true };
      },
      previewRejudgeForStreamer: async () => ({}),
      previewDonationTimeRejudgeForStreamer: async () => {
        calls.preview += 1;
        return { rows: [] };
      },
      applyApproxRejudgeForStreamer: async (_s, input) => {
        calls.apply.push(input);
        return { runId: "r", requested: input.sourceKeys.length, inserted: 1, alreadyExisted: 0, insertedEntryIds: ["e"] };
      },
      approxRejudgeRuns: async () => {
        calls.runs += 1;
        return [];
      },
      previewApproxRejudgeRevert: async (_s, runId) => {
        calls.revertPreview.push(runId);
        return { runId };
      },
      applyApproxRejudgeRevert: async (_s, runId, input) => {
        calls.revertApply.push({ runId, ...input });
        return { runId, voided: 1 };
      },
    },
  };
  return {
    calls,
    rejudge: load("app/api/s/[streamerSlug]/rejudge/route.ts", mocks),
    revert: load("app/api/s/[streamerSlug]/rejudge-revert/route.ts", mocks),
  };
}

const context = { params: Promise.resolve({ streamerSlug: "demo" }) };
const post = (url, body) => new Request(`http://localhost/api/s/demo/${url}`, { method: "POST", body: JSON.stringify(body) });
const get = (url) => new Request(`http://localhost/api/s/demo/${url}`);

const RUN = "5e1f0000-0000-4000-8000-00000000a001";
const goodApply = {
  mode: "donation_time",
  apply: true,
  confirm: "demo",
  fingerprint: "0123456789abcdef",
  rawUntil: "2026-10-25T14:00:00.000Z",
  seenThrough: { o: 1, t: 1761000000000, k: "synth0101::0" },
  sourceKeys: ["synth0101::0"],
};

test("넣기: 인증 없으면 401, 쓰기 함수 안 부름", async () => {
  const { rejudge, calls } = make({ deny: true });
  assert.equal((await rejudge.POST(post("rejudge", goodApply), context)).status, 401);
  assert.equal(calls.apply.length, 0);
});

test("넣기: 스트리머 개인 비밀번호 세션(마스터키 아님)이면 403, 쓰기 0", async () => {
  const { rejudge, calls } = make({ master: false });
  const res = await rejudge.POST(post("rejudge", goodApply), context);
  assert.equal(res.status, 403);
  assert.equal(calls.apply.length, 0);
});

test("넣기: 시범 스위치가 꺼져 있으면 403, 쓰기 0", async () => {
  const { rejudge, calls } = make({ flag: false });
  assert.equal((await rejudge.POST(post("rejudge", goodApply), context)).status, 403);
  assert.equal(calls.apply.length, 0);
  assert.equal(calls.master, 0, "스위치가 꺼졌으면 세션도 볼 필요 없다");
});

test("넣기: 마스터키 + 스위치 + 올바른 요청이면 계획 지문·원본 범위·본 줄 표지·키를 그대로 넘긴다", async () => {
  const { rejudge, calls } = make();
  const res = await rejudge.POST(post("rejudge", goodApply), context);
  assert.equal(res.status, 200);
  // vm 안에서 만든 객체라 프로토타입이 달라 JSON 으로 비교한다.
  assert.deepEqual(JSON.parse(JSON.stringify(calls.apply)), [
    { fingerprint: goodApply.fingerprint, rawUntil: goodApply.rawUntil, seenThrough: goodApply.seenThrough, sourceKeys: goodApply.sourceKeys },
  ]);
});

test("넣기: 형식이 틀리면 400(확인 슬러그·지문·원본 시각·본 줄 표지·키), 쓰기 0", async () => {
  const bad = [
    { confirm: "other" },
    { fingerprint: "xyz" },
    { fingerprint: undefined },
    { rawUntil: undefined },
    { rawUntil: "어제" },
    { seenThrough: undefined },
    { seenThrough: { o: 7, t: null, k: "a" } },
    { seenThrough: { o: 1, t: "x", k: "a" } },
    { seenThrough: { o: 1, t: null, k: "" } },
    { sourceKeys: [] },
    { sourceKeys: "a" },
    { sourceKeys: [1] },
    { sourceKeys: ["x".repeat(301)] },
  ];
  for (const patch of bad) {
    const { rejudge, calls } = make();
    const res = await rejudge.POST(post("rejudge", { ...goodApply, ...patch }), context);
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.equal(calls.apply.length, 0);
  }
});

test("미리보기는 지금처럼 스트리머 세션에서도 된다(넣기만 마스터키)", async () => {
  const { rejudge, calls } = make({ master: false });
  const res = await rejudge.POST(post("rejudge", { mode: "donation_time", page: 0 }), context);
  assert.equal(res.status, 200);
  assert.equal(calls.preview, 1);
  assert.equal(calls.apply.length, 0);
});

test("'지금 표로' 넣기(mode now)는 이번에 동작 그대로 — 마스터키를 보지 않는다", async () => {
  const { rejudge, calls } = make({ master: false });
  const res = await rejudge.POST(post("rejudge", { apply: true, confirm: "demo" }), context);
  assert.equal(res.status, 200);
  assert.equal(calls.nowApply, 1);
  assert.equal(calls.master, 0);
});

test("GET canApply = 스위치 켜짐 + 마스터키 세션일 때만", async () => {
  assert.equal((await (await make().rejudge.GET(get("rejudge"), context)).json()).canApply, true);
  assert.equal((await (await make({ master: false }).rejudge.GET(get("rejudge"), context)).json()).canApply, false);
  const off = make({ flag: false });
  assert.equal((await (await off.rejudge.GET(get("rejudge"), context)).json()).canApply, false);
  assert.equal(off.calls.master, 0);
});

test("되돌리기 라우트: 401 → 403(마스터키 아님, DB 안 읽음) → 400(runId) → 403(스위치)", async () => {
  {
    const { revert, calls } = make({ deny: true });
    assert.equal((await revert.POST(post("rejudge-revert", { runId: RUN }), context)).status, 401);
    assert.equal((await revert.GET(get("rejudge-revert"), context)).status, 401);
    assert.equal(calls.streamer, 0);
  }
  {
    const { revert, calls } = make({ master: false });
    assert.equal((await revert.POST(post("rejudge-revert", { runId: RUN, apply: true, confirm: "demo", reason: "x" }), context)).status, 403);
    assert.equal((await revert.GET(get("rejudge-revert"), context)).status, 403);
    assert.equal(calls.streamer, 0);
    assert.deepEqual(calls.revertApply, []);
    assert.equal(calls.runs, 0);
  }
  {
    const { revert, calls } = make();
    for (const runId of ["", "abc", `${RUN}&x=1`, 5]) {
      assert.equal((await revert.POST(post("rejudge-revert", { runId }), context)).status, 400);
    }
    assert.deepEqual(calls.revertPreview, []);
  }
  {
    const { revert, calls } = make({ flag: false });
    assert.equal((await revert.POST(post("rejudge-revert", { runId: RUN }), context)).status, 403);
    assert.equal((await revert.GET(get("rejudge-revert"), context)).status, 403);
    assert.deepEqual(calls.revertPreview, []);
  }
});

test("되돌리기 라우트: 미리보기·실행·목록이 맞는 함수로 간다", async () => {
  const { revert, calls } = make();
  assert.equal((await revert.POST(post("rejudge-revert", { runId: RUN }), context)).status, 200);
  assert.deepEqual(calls.revertPreview, [RUN]);
  assert.equal((await revert.POST(post("rejudge-revert", { runId: RUN, apply: true, confirm: "demo", reason: "잘못 넣음" }), context)).status, 200);
  assert.deepEqual(calls.revertApply, [{ runId: RUN, confirm: "demo", reason: "잘못 넣음" }]);
  const runs = await revert.GET(get("rejudge-revert"), context);
  assert.deepEqual(await runs.json(), { runs: [] });
  assert.equal(revert.maxDuration, 60);
});

// ---------- 마스터키 세션 판별: 실제 인증 파일로 ----------
const MASTER = "gate2-tests-only-operator-token";
const PIN = "0420";

function authHarness(env, cookieValue) {
  const jar = { get: (name) => (cookieValue && name === "upbo_sheet_admin_session_demo" ? { value: cookieValue } : undefined) };
  const headers = { cookies: async () => jar };
  const globals = { process: { env } };
  const adminAuth = load("lib/adminAuth.ts", { "next/headers": headers }, globals);
  const sheetAuth = load(
    "lib/sheetAdminAuth.ts",
    { "next/headers": headers, "./adminAuth": adminAuth, "./upboSupabase": { getSheetAdminPinHash: async () => adminAuth.adminTokenHash(PIN) } },
    globals,
  );
  const master = load("lib/sheetMasterSession.ts", { "next/headers": headers, "./adminAuth": adminAuth, "./sheetAdminAuth": sheetAuth }, globals);
  return { adminAuth, sheetAuth, master };
}

test("마스터키 세션 판별: 마스터키로 연 쿠키만 참, 스트리머 비번 쿠키는 거짓(둘 다 시트 관리자로는 그대로 authed)", async () => {
  const env = { VERCEL: "1", UPBO_SESSION_SECRET: "gate2-tests-only-signing-secret", UPBO_ADMIN_TOKEN: MASTER };
  const base = authHarness(env, null);
  const masterCookie = base.sheetAuth.sheetSessionValue("demo", base.adminAuth.adminTokenHash(MASTER));
  const pinCookie = base.sheetAuth.sheetSessionValue("demo", base.adminAuth.adminTokenHash(PIN));

  const asMaster = authHarness(env, masterCookie);
  assert.equal(await asMaster.master.isSheetMasterSession("demo"), true);
  assert.equal(await asMaster.sheetAuth.sheetAdminAccessState("demo"), "authed");

  const asStreamer = authHarness(env, pinCookie);
  assert.equal(await asStreamer.master.isSheetMasterSession("demo"), false);
  assert.equal(await asStreamer.sheetAuth.sheetAdminAccessState("demo"), "authed", "스트리머 세션의 시트 관리자 권한은 그대로");

  const none = authHarness(env, null);
  assert.equal(await none.master.isSheetMasterSession("demo"), false);
  assert.equal(await none.sheetAuth.sheetAdminAccessState("demo"), "locked");

  // 다른 시트의 마스터키 쿠키 값은 이 시트에서 안 통한다(슬러그별 서명)
  const otherSlug = authHarness(env, base.sheetAuth.sheetSessionValue("other", base.adminAuth.adminTokenHash(MASTER)));
  assert.equal(await otherSlug.master.isSheetMasterSession("demo"), false);
});

test("마스터키 환경변수가 없으면(로컬 미러 기본) 언제나 거짓 — 로컬 미설정 시트도 넣기 403", async () => {
  const env = { UPBO_SESSION_SECRET: "gate2-tests-only-signing-secret" };
  const local = authHarness(env, "anything");
  assert.equal(await local.master.isSheetMasterSession("demo"), false);
});

test("클라이언트 화면은 판정·되돌리기·DB 모듈을 끌어오지 않는다(공개 번들 보호)", () => {
  const src = fs.readFileSync(path.join(root, "app/[streamerSlug]/RejudgeManager.tsx"), "utf8");
  for (const banned of ["upboCore", "upboSupabase", "rejudgeRevert", "missingCandidate", "judgeInputsAt", "sheetMasterSession", "crypto"]) {
    assert.ok(!new RegExp(`from\\s+"[^"]*${banned}"`).test(src), `RejudgeManager: ${banned} 를 import 하면 안 된다`);
  }
  assert.ok(/import type \{[^}]*\} from "@\/lib\/rejudge";/.test(src), "rejudge 는 타입만");
  const selection = fs.readFileSync(path.join(root, "lib/rejudgeApplySelection.ts"), "utf8");
  assert.ok(!/^import\s/m.test(selection), "rejudgeApplySelection 은 의존성이 없어야 한다");
});
