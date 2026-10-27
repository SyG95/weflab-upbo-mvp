// 확프 페어링 시도 제한 회귀 테스트 (2026-10-27 보안 줄 ②).
//  - 시트 관리자 잠금 해제와 같은 셈: 시트 실패 + 페어링 실패를 합쳐 15분 7회.
//  - 잠긴 동안엔 마스터키도 429(예전엔 잠금 중 마스터만 통과 → 마스터키 무한 대입 통로).
// extensionPairing.ts 는 transpile + vm 으로 로드해 upboSupabase·sheetAdminAuth 를 가짜로 바꾼다.
// unlockThrottle 은 실제 모듈 + 메모리 가짜 Supabase(fetch 스텁). 네트워크·자격증명 0.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const SHEET_PIN = "0420";
const MASTER = "master-token-for-test";

let rows = [];
let tick = 0;
process.env.SUPABASE_URL = "https://fake.supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
process.env.UPBO_TABLE_PREFIX = "upbo_alpha_";
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if ((init?.method ?? "GET") === "POST") {
    const body = JSON.parse(String(init.body));
    rows.push({ streamer_id: body.streamer_id, action: body.action, created_at: new Date(Date.now() + tick++).toISOString() });
    return new Response("", { status: 201 });
  }
  const sid = url.searchParams.get("streamer_id");
  const actions = url.searchParams.get("action").replace(/^in\.\(|\)$/g, "").split(",");
  const hit = rows.filter((r) => `eq.${r.streamer_id}` === sid && actions.includes(r.action));
  return new Response(JSON.stringify(hit.map(({ action, created_at }) => ({ action, created_at }))), { status: 200 });
};

const throttle = await import("../lib/unlockThrottle.ts");

function loadPairing() {
  const src = fs.readFileSync(path.join(root, "lib/extensionPairing.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mocks = {
    "./adminAuth": { adminTokenHash: sha, masterPinHash: () => sha(MASTER) },
    "./sheetAdminAuth": { effectiveSheetPinHash: async () => sha(SHEET_PIN) },
    "./unlockThrottle": throttle,
    "./upboSupabase": {
      getStreamerRowBySlug: async (slug) => ({ id: `id-${slug}`, slug, display_name: slug }),
      createExtensionToken: async () => ({ token: { value: "upbo_ext_test" } }),
    },
  };
  const box = { exports: {} };
  vm.runInNewContext(js, {
    module: box,
    exports: box.exports,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
    console,
    Date,
  });
  return box.exports;
}

const { pairExtension } = loadPairing();

test("틀린 비밀번호 7번까지 401(남은 횟수 줄어듦), 그다음은 마스터키여도 429", async () => {
  rows = [];
  const remaining = [];
  for (let i = 0; i < 7; i++) {
    const r = await pairExtension("poromi", "wrong");
    assert.equal(r.status, 401);
    remaining.push(r.remainingAttempts);
  }
  assert.deepEqual(remaining, [6, 5, 4, 3, 2, 1, 0]);
  assert.equal((await pairExtension("poromi", SHEET_PIN)).status, 429);
  const master = await pairExtension("poromi", MASTER);
  assert.equal(master.status, 429);
  assert.equal(master.ok, false);
});

test("잠기지 않았으면 시트 비번·마스터키로 토큰 발급, 성공하면 셈이 초기화", async () => {
  rows = [];
  for (let i = 0; i < 5; i++) await pairExtension("chaeru", "wrong");
  const ok = await pairExtension("chaeru", SHEET_PIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.token, "upbo_ext_test");
  const again = await pairExtension("chaeru", "wrong");
  assert.equal(again.remainingAttempts, 6);
  assert.equal((await pairExtension("chaeru", MASTER)).status, 200);
});

test("시트 관리자 잠금 해제 실패도 같은 셈에 들어간다", async () => {
  rows = [];
  for (let i = 0; i < 7; i++) {
    rows.push({ streamer_id: "id-rudy", action: "sheet_admin_unlock_failed", created_at: new Date(Date.now() - i * 1000).toISOString() });
  }
  assert.equal((await pairExtension("rudy", SHEET_PIN)).status, 429);
});
