// 잠금 해제 시도 제한 회귀 테스트 (2026-10-27 보안 줄 ②).
//  - 판정(evaluateThrottle): 15분 7회·24시간 30회, 성공은 15분 창만·비번 변경/운영자 풀기는 전부 초기화,
//    확프 페어링 실패 합산, 마스터키는 요청한 곳별 15분 10회 + 전체 15분 100회.
//  - 기록 순서(beginUnlockAttempt): 비밀번호를 보기 전에 먼저 기록 → 동시에 몰려온 요청도 상한 이상 못 지나감.
//  - decideStreamerUnlock: 잠긴 시트도 마스터키로는 열리고, 그 시도는 마스터키 셈으로 센다.
// 네트워크·자격증명 0 — Supabase REST 는 메모리 가짜(fetch 스텁)로 흉내 낸다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MASTER_GLOBAL_WINDOWS,
  OPERATOR_UNLOCK_ACTION,
  UNLOCK_POLICIES,
  beginMasterAttempt,
  beginUnlockAttempt,
  decideStreamerUnlock,
  evaluateThrottle,
  recordOperatorUnlock,
  recordUnlockSuccess,
  wrongPasswordMessage,
  type ThrottleRow,
} from "../lib/unlockThrottle";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-10-27T12:00:00Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const fails = (action: string, agos: number[]): ThrottleRow[] => agos.map((a) => ({ action, created_at: at(a) }));

test("시트: 15분 안 6번 실패는 통과, 7번째부터 잠김", () => {
  const sheet = UNLOCK_POLICIES.sheet;
  const six = fails("sheet_admin_unlock_failed", [1, 2, 3, 4, 5, 6].map((m) => m * MIN));
  const s6 = evaluateThrottle(six, NOW, sheet);
  assert.equal(s6.locked, false);
  assert.equal(s6.remaining, 1);
  const seven = fails("sheet_admin_unlock_failed", [1, 2, 3, 4, 5, 6, 7].map((m) => m * MIN));
  const s7 = evaluateThrottle(seven, NOW, sheet);
  assert.equal(s7.locked, true);
  // 가장 오래된 실패(7분 전)가 15분 창을 벗어나는 8분 뒤에 풀린다.
  assert.equal(s7.retryAfterSec, 8 * 60);
});

test("성공은 15분 창만, 비밀번호 변경·운영자 잠금 풀기는 모든 창을 초기화", () => {
  const sheet = UNLOCK_POLICIES.sheet;
  const rows = [
    ...fails("sheet_admin_unlock_failed", [10, 9, 8, 7, 6].map((m) => m * MIN)),
    { action: "sheet_admin_unlock_ok", created_at: at(5 * MIN + 30_000) },
    ...fails("sheet_admin_unlock_failed", [4, 3].map((m) => m * MIN)),
  ];
  const s = evaluateThrottle(rows, NOW, sheet);
  assert.equal(s.locked, false);
  assert.equal(s.remaining, 5);
  // 콘솔 "비번 리셋"(sheet_admin_pin_updated)도 잠금을 푼다.
  const locked = fails("sheet_admin_unlock_failed", [1, 2, 3, 4, 5, 6, 7].map((m) => m * MIN));
  const afterReset = evaluateThrottle(
    [...locked, { action: "sheet_admin_pin_updated", created_at: at(30_000) }],
    NOW,
    sheet,
  );
  assert.equal(afterReset.locked, false);
});

test("시트 잠금은 같은 비밀번호를 검사하는 확프 페어링 실패도 함께 센다, 후원집계는 따로", () => {
  const rows = [
    ...fails("sheet_admin_unlock_failed", [1, 2, 3].map((m) => m * MIN)),
    ...fails("extension_pair_failed", [4, 5, 6, 7].map((m) => m * MIN)),
  ];
  assert.equal(evaluateThrottle(rows, NOW, UNLOCK_POLICIES.sheet).locked, true);
  assert.equal(evaluateThrottle(rows, NOW, UNLOCK_POLICIES.donation).locked, false);
  // 후원집계 실패는 시트 잠금에 들어가지 않는다(후원집계 비번이 따로).
  const donationFails = fails("donation_admin_unlock_failed", [1, 2, 3, 4, 5, 6, 7].map((m) => m * MIN));
  assert.equal(evaluateThrottle(donationFails, NOW, UNLOCK_POLICIES.donation).locked, true);
  assert.equal(evaluateThrottle(donationFails, NOW, UNLOCK_POLICIES.sheet).locked, false);
  // 시트 로그인 성공은 후원집계 잠금을 풀지 않는다(시트 비번을 아는 사람이 후원집계 비번을 계속 대입하는 통로 차단).
  const mixed = [...donationFails, { action: "sheet_admin_unlock_ok", created_at: at(30_000) }];
  assert.equal(evaluateThrottle(mixed, NOW, UNLOCK_POLICIES.donation).locked, true);
});

test("24시간 30회 상한: 15분에 7번을 넘지 않게 천천히 틀려도 하루 30번이면 잠김", () => {
  const sheet = UNLOCK_POLICIES.sheet;
  // 40분 간격 30번(약 19시간 20분) — 15분 창에는 늘 1번뿐.
  const slow = fails("sheet_admin_unlock_failed", Array.from({ length: 30 }, (_, i) => (i * 40 + 1) * MIN));
  const s = evaluateThrottle(slow, NOW, sheet);
  assert.equal(s.locked, true);
  // 가장 오래된 실패(1161분 전)가 24시간 창을 벗어나면 풀린다.
  assert.equal(s.retryAfterSec, (24 * 60 - 1161) * 60);
  const s29 = evaluateThrottle(slow.slice(0, 29), NOW, sheet);
  assert.equal(s29.locked, false);
  assert.equal(s29.remaining, 1);
});

test("하루 상한은 성공으로 초기화되지 않는다(로그인 사이사이 대입 차단)", () => {
  const sheet = UNLOCK_POLICIES.sheet;
  // 공격자가 40분 간격으로 30번 틀리고, 그 사이마다 스트리머가 로그인(로그인도 실패 1줄을 먼저 남긴 뒤 성공 1줄).
  // 15분 창은 늘 비지만 하루 창은 공격자 실패 30.
  const rows: ThrottleRow[] = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ action: "sheet_admin_unlock_failed", created_at: at((i * 40 + 2) * MIN), actor: "ip:attacker" });
    rows.push({ action: "sheet_admin_unlock_failed", created_at: at((i * 40 + 1) * MIN + 50), actor: "ip:streamer" });
    rows.push({ action: "sheet_admin_unlock_ok", created_at: at((i * 40 + 1) * MIN), actor: "ip:streamer" });
  }
  assert.equal(evaluateThrottle(rows, NOW, sheet).locked, true);
  // 스트리머 로그인만 있으면(실패 1줄 + 성공 1줄 짝) 하루에 몇 번을 해도 셈이 늘지 않는다.
  const loginsOnly = rows.filter((r) => r.actor === "ip:streamer");
  const s = evaluateThrottle(loginsOnly, NOW, sheet);
  assert.equal(s.locked, false);
  assert.equal(s.remaining, 7);
  // 운영자 "잠금 풀기"는 하루 창까지 초기화.
  const unlocked = [...rows, { action: OPERATOR_UNLOCK_ACTION, created_at: at(30_000) }];
  assert.equal(evaluateThrottle(unlocked, NOW, sheet).locked, false);
  assert.equal(evaluateThrottle(unlocked, NOW, UNLOCK_POLICIES.donation).locked, false);
});

test("마스터키: 15분 10회(요청한 곳별), 전체는 15분 100회", () => {
  const master = UNLOCK_POLICIES.master;
  const nine = fails("master_key_failed", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => m * MIN));
  assert.equal(evaluateThrottle(nine, NOW, master).locked, false);
  const ten = [...nine, ...fails("master_key_failed", [10 * MIN])];
  assert.equal(evaluateThrottle(ten, NOW, master).locked, true);
  // 15분이 지나면 풀린다.
  const old = fails("master_key_failed", Array.from({ length: 10 }, (_, i) => (16 + i) * MIN));
  assert.equal(evaluateThrottle(old, NOW, master).locked, false);
  // 전체 창: 99 는 통과, 100 이면 잠김.
  const many = (n: number) => fails("master_key_failed", Array.from({ length: n }, (_, i) => i * 5_000));
  assert.equal(evaluateThrottle(many(99), NOW, master, 0, MASTER_GLOBAL_WINDOWS).locked, false);
  assert.equal(evaluateThrottle(many(100), NOW, master, 0, MASTER_GLOBAL_WINDOWS).locked, true);
});

test("pending: 방금 남긴 내 실패 1건은 잠금 판단에서 빼고 남은 횟수에는 넣는다", () => {
  const sheet = UNLOCK_POLICIES.sheet;
  const seven = fails("sheet_admin_unlock_failed", [0, 1, 2, 3, 4, 5, 6].map((m) => m * MIN));
  const s = evaluateThrottle(seven, NOW, sheet, 1);
  assert.equal(s.locked, false); // 앞선 6번 + 나 → 7번째 시도는 비밀번호 검사를 받는다
  assert.equal(s.remaining, 0); // 이번에 틀리면 잠김
  assert.match(wrongPasswordMessage(s.remaining), /잠시 잠겼어요/);
  assert.doesNotMatch(wrongPasswordMessage(5), /잠/);
  assert.match(wrongPasswordMessage(2), /2번 더 틀리면/);
});

// ---------- 기록 순서(동시 요청) ----------

type Row = { streamer_id: string | null; action: string; actor: string; created_at: string };

function installFakeSupabase() {
  const rows: Row[] = [];
  const saved = {
    fetch: globalThis.fetch,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    prefix: process.env.UPBO_TABLE_PREFIX,
  };
  process.env.SUPABASE_URL = "https://fake.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.UPBO_TABLE_PREFIX = "upbo_alpha_";
  let tick = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/upbo_alpha_audit_logs");
    // 실제 DB 처럼 요청마다 한 박자씩 늦게 처리돼 동시 요청이 서로 끼어든다.
    await new Promise((r) => setTimeout(r, 0));
    if ((init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body));
      rows.push({
        streamer_id: body.streamer_id,
        action: body.action,
        actor: body.actor,
        created_at: new Date(Date.now() + tick++).toISOString(),
      });
      return new Response("", { status: 201 });
    }
    const sid = url.searchParams.get("streamer_id") ?? "";
    const actor = url.searchParams.get("actor");
    const actions = (url.searchParams.get("action") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
    const since = Date.parse((url.searchParams.get("created_at") ?? "").replace(/^gte\./, ""));
    const hit = rows.filter(
      (r) =>
        (sid === "is.null" ? r.streamer_id === null : `eq.${r.streamer_id}` === sid) &&
        actions.includes(r.action) &&
        (actor === null || `eq.${r.actor}` === actor) &&
        Date.parse(r.created_at) >= since,
    );
    return new Response(JSON.stringify(hit.map(({ action, created_at }) => ({ action, created_at }))), { status: 200 });
  }) as typeof fetch;
  return {
    rows,
    restore() {
      globalThis.fetch = saved.fetch;
      for (const [k, v] of [
        ["SUPABASE_URL", saved.url],
        ["SUPABASE_SERVICE_ROLE_KEY", saved.key],
        ["UPBO_TABLE_PREFIX", saved.prefix],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

test("차례로 틀리면 7번까지만 비밀번호 검사를 받고 8번째부터 잠김", async () => {
  const db = installFakeSupabase();
  try {
    const verdicts: boolean[] = [];
    for (let i = 0; i < 10; i++) verdicts.push((await beginUnlockAttempt("sheet", "s1", "ipA")).locked);
    assert.deepEqual(verdicts, [false, false, false, false, false, false, false, true, true, true]);
    // 잠긴 시도는 기록을 늘리지 않는다(DB 를 무한히 채우지 못하게).
    assert.equal(db.rows.length, 7);
    // 다른 스트리머·마스터키 셈과 섞이지 않는다.
    assert.equal((await beginUnlockAttempt("sheet", "s2", "ipA")).locked, false);
    assert.equal((await beginMasterAttempt("ipA")).locked, false);
  } finally {
    db.restore();
  }
});

test("동시에 50개를 몰아 보내도 비밀번호 검사를 받는 요청은 7개 이하", async () => {
  const db = installFakeSupabase();
  try {
    const results = await Promise.all(Array.from({ length: 50 }, () => beginUnlockAttempt("sheet", "s1", "ipA")));
    const passed = results.filter((r) => !r.locked).length;
    assert.ok(passed <= 7, `passed=${passed}`);
  } finally {
    db.restore();
  }
});

test("성공하면 앞선 실패(방금 남긴 내 실패 포함)가 무효가 된다", async () => {
  const db = installFakeSupabase();
  try {
    for (let i = 0; i < 6; i++) await beginUnlockAttempt("donation", "s1", "ipA");
    const mine = await beginUnlockAttempt("donation", "s1", "ipA");
    assert.equal(mine.locked, false);
    await recordUnlockSuccess("donation", "s1", "ipA");
    const next = await beginUnlockAttempt("donation", "s1", "ipA");
    assert.equal(next.locked, false);
    assert.equal(next.remaining, 6);
  } finally {
    db.restore();
  }
});

test("마스터키 셈은 요청한 곳(IP 표지)별 — 한 곳이 잠겨도 다른 곳은 들어온다", async () => {
  const db = installFakeSupabase();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await beginMasterAttempt("attacker")).locked, false);
    assert.equal((await beginMasterAttempt("attacker")).locked, true);
    assert.equal((await beginMasterAttempt("sy-home")).locked, false);
  } finally {
    db.restore();
  }
});

test("잠긴 시트: 맞는 개별 비번도 거절, 마스터키는 통과(마스터키 셈으로), 운영자 잠금 풀기 뒤엔 개별 비번 통과", async () => {
  const db = installFakeSupabase();
  try {
    const base = { kind: "sheet" as const, streamerId: "s1", pinHash: "PIN", masterHash: "MASTER" };
    for (let i = 0; i < 7; i++) {
      const d = await decideStreamerUnlock({ ...base, actorTag: "bad", passwordHash: "x" });
      assert.equal(d.kind, "wrong");
    }
    const byPin = await decideStreamerUnlock({ ...base, actorTag: "streamer", passwordHash: "PIN" });
    assert.equal(byPin.kind, "locked");
    const byMaster = await decideStreamerUnlock({ ...base, actorTag: "sy", passwordHash: "MASTER" });
    assert.equal(byMaster.kind, "master");
    // 잠긴 시트로 마스터키를 대입하면 그 곳의 마스터키 셈이 찬다 → 10번 뒤엔 맞아도 거절.
    for (let i = 0; i < 10; i++) {
      assert.equal((await decideStreamerUnlock({ ...base, actorTag: "bad", passwordHash: "guess" })).kind, "locked");
    }
    assert.equal((await decideStreamerUnlock({ ...base, actorTag: "bad", passwordHash: "MASTER" })).kind, "locked");
    await recordOperatorUnlock("s1");
    assert.equal((await decideStreamerUnlock({ ...base, actorTag: "streamer", passwordHash: "PIN" })).kind, "pin");
  } finally {
    db.restore();
  }
});

test("개별 비번이 없는 시트는 마스터키로만, 틀리면 not-issued", async () => {
  const db = installFakeSupabase();
  try {
    const base = { kind: "sheet" as const, streamerId: "s9", actorTag: "t", pinHash: null, masterHash: "MASTER" };
    assert.equal((await decideStreamerUnlock({ ...base, passwordHash: "1234" })).kind, "not-issued");
    assert.equal((await decideStreamerUnlock({ ...base, passwordHash: "MASTER" })).kind, "master");
    // 스트리머 셈에는 아무것도 안 남는다(마스터키 셈에만).
    assert.equal(db.rows.filter((r) => r.streamer_id === "s9").length, 0);
  } finally {
    db.restore();
  }
});
