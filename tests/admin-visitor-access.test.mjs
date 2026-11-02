// 실제 인증·액션 모듈을 메모리 쿠키/시도제한으로 실행한다. DB·네트워크 접근 없음.
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

function harness(envOverrides = {}) {
  const env = { VERCEL: "1", UPBO_SESSION_SECRET: "visitor-tests-only", UPBO_ADMIN_TOKEN: "operator-test-token", ...envOverrides };
  const values = new Map();
  const writes = [];
  const calls = { attempts: 0, successes: 0, database: 0 };
  const jar = {
    get: (name) => values.has(name) ? { value: values.get(name) } : undefined,
    set(name, value, options) {
      writes.push({ name, value, options });
      if (options?.maxAge === 0) values.delete(name);
      else values.set(name, value);
    },
  };
  const nextHeaders = { cookies: async () => jar, headers: async () => ({ get: () => null }) };
  const navigation = { redirect(location) { throw Object.assign(new Error("redirect"), { location }); } };
  function load(relative, mocks) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const box = { exports: {} };
    vm.runInNewContext(js, {
      module: box, exports: box.exports,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === "node:crypto") return require(name);
        throw new Error(`Unexpected dependency: ${name}`);
      },
      process: { env }, Buffer, console,
    });
    return box.exports;
  }
  const auth = load("lib/adminAuth.ts", { "next/headers": nextHeaders });
  const visitor = load("lib/adminVisitorAccess.ts", { "next/headers": nextHeaders, "./adminAuth": auth });
  const database = new Proxy({}, { get: () => () => { calls.database++; throw new Error("Unexpected database access"); } });
  const actions = load("app/admin/actions.ts", {
    "next/headers": nextHeaders, "next/navigation": navigation,
    "next/cache": { revalidatePath() { throw new Error("Unexpected revalidation"); } },
    "@/lib/adminAuth": auth, "@/lib/adminVisitorAccess": visitor,
    "@/lib/upboSupabase": database,
    "@/lib/unlockThrottle": {
      beginMasterAttempt: async () => { calls.attempts++; return { locked: false, remaining: 9 }; },
      recordUnlockSuccess: async () => { calls.successes++; },
      wrongPasswordMessage: () => "wrong password",
      lockedMessage: () => "locked",
    },
  });
  const visitorActions = load("app/admin/visitorActions.ts", {
    "next/headers": nextHeaders, "next/navigation": navigation,
    "@/lib/adminAuth": auth, "@/lib/adminVisitorAccess": visitor, "./actions": actions,
  });
  return { auth, visitor, actions, visitorActions, values, writes, calls, env };
}

function form(password, returnTo = "/admin") {
  const data = new FormData();
  data.set("password", password);
  data.set("returnTo", returnTo);
  return data;
}

async function redirected(action, location = "/admin") {
  await assert.rejects(action, (error) => error.message === "redirect" && error.location === location);
}

async function mutationsDenied(h) {
  const data = new FormData();
  data.set("slug", "chaeru");
  data.set("confirm", "chaeru");
  data.set("displayName", "test name");
  data.set("mode", "execute");
  data.set("scope_roulette", "on");
  const actions = [
    () => h.actions.createStreamerAction({}, data),
    () => h.actions.renameStreamerAction({}, data),
    () => h.actions.deleteStreamerAction({}, data),
    () => h.actions.resetStreamerDataAction({}, data),
    () => h.actions.resetStreamerPinAction({}, data),
    () => h.actions.unlockStreamerThrottleAction({}, data),
    () => h.actions.setExtensionConfigAction("chaeru", { staleTabHours: 0 }),
    () => h.actions.setExtensionConfigForAllAction({ staleTabHours: 0 }),
  ];
  for (const run of actions) assert.match((await run()).error, /관리자 인증/);
  assert.equal(h.calls.database, 0);
  assert.equal(h.calls.attempts, 0);
  assert.equal(h.calls.successes, 0);
}

test("공개 PIN 은 정확한 1234만 허용하고 일반 운영 비밀번호와 분리한다", () => {
  const { visitor } = harness();
  assert.equal(visitor.visitorPasswordMatches("1234"), true);
  for (const password of ["", "123", "12345", " 1234", "1234 ", "１２３４", "operator-test-token"]) {
    assert.equal(visitor.visitorPasswordMatches(password), false);
  }
});

test("서명된 방문자 쿠키만 통과하고 평문·해시·변조·다른 인증 주체를 거부한다", async () => {
  const h = harness();
  assert.equal(await h.visitor.adminVisitorAccessState(), false);
  const session = h.visitor.visitorSessionValue();
  assert.ok(session);
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, session);
  assert.equal(await h.visitor.adminVisitorAccessState(), true);
  const pinHash = h.auth.adminTokenHash("1234");
  for (const bad of ["1234", pinHash, session.slice(1), `${session}!`,
    h.auth.consoleSessionValue("1234"), h.auth.consoleSessionValue(h.env.UPBO_ADMIN_TOKEN),
    h.auth.signSession("sheet", "chaeru", pinHash), h.auth.signSession("donation", "chaeru", pinHash)]) {
    h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, bad);
    assert.equal(await h.visitor.adminVisitorAccessState(), false);
  }
});

test("방문자 서명을 기존 관리자 쿠키에 옮겨도 관리자·쓰기 권한이 생기지 않는다", async () => {
  const h = harness();
  h.values.set(h.auth.ADMIN_COOKIE, h.visitor.visitorSessionValue());
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, h.visitor.visitorSessionValue());
  assert.equal(await h.auth.adminAccessState(), "locked");
  await mutationsDenied(h);
});

test("로컬에 마스터 env 가 없어도 방문자 쿠키로 쓰기 액션 8개를 호출하면 전부 거부한다", async () => {
  const h = harness({ VERCEL: undefined, UPBO_ADMIN_TOKEN: undefined });
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, h.visitor.visitorSessionValue());
  assert.equal(await h.auth.adminAccessState(), "open-unconfigured");
  assert.equal(await h.visitor.adminVisitorAccessState(), true);
  await mutationsDenied(h);
});

test("방문자가 아닌 로컬 미설정 미리보기의 기존 인증 예외는 유지한다", async () => {
  const h = harness({ VERCEL: undefined, UPBO_ADMIN_TOKEN: undefined });
  const result = await h.actions.renameStreamerAction({}, new FormData());
  assert.match(result.error, /잘못된 슬러그/);
  assert.equal(h.calls.database, 0);
});

test("기존 운영자 쿠키만으로는 방문자 쿠키 검사가 통과하지 않는다", async () => {
  const h = harness();
  h.values.set(h.auth.ADMIN_COOKIE, h.auth.consoleSessionValue(h.env.UPBO_ADMIN_TOKEN));
  assert.equal(await h.auth.adminAccessState(), "authed");
  assert.equal(await h.visitor.adminVisitorAccessState(), false);
});

test("배포에 서명 비밀키가 없으면 방문자 로그인도 fail-closed", async () => {
  const h = harness({ UPBO_SESSION_SECRET: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  h.values.set(h.auth.ADMIN_COOKIE, "previous-operator-session");
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, "forged");
  assert.equal(h.visitor.visitorSessionValue(), null);
  assert.equal(await h.visitor.adminVisitorAccessState(), false);
  const result = await h.visitorActions.unlockAdminOrVisitor({}, form("1234"));
  assert.match(result.error, /세션/);
  assert.equal(h.values.has(h.auth.ADMIN_COOKIE), false);
  assert.equal(h.values.has(h.visitor.ADMIN_VISITOR_COOKIE), false);
  assert.equal(h.calls.attempts, 0);
});

test("서버 서명 비밀키가 바뀌면 이전 방문자 쿠키도 무효다", async () => {
  const h = harness();
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, h.visitor.visitorSessionValue());
  h.env.UPBO_SESSION_SECRET = "rotated-test-key";
  assert.equal(await h.visitor.adminVisitorAccessState(), false);
});

test("1234 입장은 기존 운영자 쿠키를 같은 /admin 경로에서 만료하고 방문자로만 로그인한다", async () => {
  const h = harness();
  h.values.set(h.auth.ADMIN_COOKIE, h.auth.consoleSessionValue(h.env.UPBO_ADMIN_TOKEN));
  await redirected(() => h.visitorActions.unlockAdminOrVisitor({}, form("1234", "/admin/chaeru")), "/admin/chaeru");
  assert.equal(await h.visitor.adminVisitorAccessState(), true);
  assert.equal(await h.auth.adminAccessState(), "locked");
  assert.equal(h.calls.attempts, 0);
  assert.equal(h.calls.successes, 0);
  assert.equal(h.calls.database, 0);
  const cleared = h.writes.find((w) => w.name === h.auth.ADMIN_COOKIE && w.options.maxAge === 0);
  assert.equal(cleared.options.path, "/admin");
  const issued = h.writes.find((w) => w.options.maxAge > 0);
  assert.equal(issued.name, h.visitor.ADMIN_VISITOR_COOKIE);
  assert.equal(issued.options.httpOnly, true);
  assert.equal(issued.options.secure, true);
  assert.equal(issued.options.sameSite, "lax");
  assert.equal(issued.options.path, "/admin");
});

test("마스터 env 가 1234여도 기존 unlockAdmin 직접 호출과 새 경로 모두 마스터 승격 불가", async () => {
  const h = harness({ UPBO_ADMIN_TOKEN: "1234" });
  const result = await h.actions.unlockAdmin({}, form("1234"));
  assert.match(result.error, /방문자/);
  assert.equal(h.values.has(h.auth.ADMIN_COOKIE), false);
  assert.equal(h.calls.attempts, 0);
  await redirected(() => h.visitorActions.unlockAdminOrVisitor({}, form("1234")));
  assert.equal(await h.auth.adminAccessState(), "locked");
  assert.equal(await h.visitor.adminVisitorAccessState(), true);
});

test("일반 비밀번호는 기존 마스터 인증과 시도 제한에 위임하고 방문자 쿠키를 지운다", async () => {
  const h = harness();
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, h.visitor.visitorSessionValue());
  await redirected(() => h.visitorActions.unlockAdminOrVisitor({}, form(h.env.UPBO_ADMIN_TOKEN)));
  assert.equal(await h.auth.adminAccessState(), "authed");
  assert.equal(await h.visitor.adminVisitorAccessState(), false);
  assert.equal(h.calls.attempts, 1);
  assert.equal(h.calls.successes, 1);
  assert.equal(h.calls.database, 0);
  const invalid = harness();
  const result = await invalid.visitorActions.unlockAdminOrVisitor({}, form("wrong"));
  assert.equal(result.error, "wrong password");
  assert.equal(invalid.calls.attempts, 1);
  assert.equal(invalid.calls.successes, 0);
  assert.equal(await invalid.auth.adminAccessState(), "locked");
});

test("로그아웃은 두 쿠키를 발급 경로에서 지우고 외부 returnTo 는 허용하지 않는다", async () => {
  const h = harness();
  h.values.set(h.auth.ADMIN_COOKIE, h.auth.consoleSessionValue(h.env.UPBO_ADMIN_TOKEN));
  h.values.set(h.visitor.ADMIN_VISITOR_COOKIE, h.visitor.visitorSessionValue());
  await redirected(() => h.visitorActions.lockAdminOrVisitor(form("", "https://example.invalid")));
  assert.equal(h.values.size, 0);
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes.every((w) => w.options.path === "/admin" && w.options.maxAge === 0));
  await redirected(() => h.visitorActions.unlockAdminOrVisitor({}, form("1234", "//example.invalid")));
});
