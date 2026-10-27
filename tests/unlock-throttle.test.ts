// 잠금 해제 시도 제한 회귀 테스트 (2026-10-27 보안 줄 ②).
//  - 판정(evaluateThrottle): 15분 7회·24시간 30회, 성공·비번 변경 이후만 셈, 확프 페어링 실패 합산.
//  - 기록 순서(beginUnlockAttempt): 비밀번호를 보기 전에 먼저 기록 → 동시에 몰려온 요청도 상한 이상 못 지나감.
// 네트워크·자격증명 0 — Supabase REST 는 메모리 가짜(fetch 스텁)로 흉내 낸다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  UNLOCK_POLICIES,
  beginUnlockAttempt,
  evaluateThrottle,
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

test("성공·비밀번호 변경 이후의 실패만 센다", () => {
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

test("전역 /admin 콘솔: 15분 10회", () => {
  const consolePolicy = UNLOCK_POLICIES.console;
  const nine = fails("admin_console_unlock_failed", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => m * MIN));
  assert.equal(evaluateThrottle(nine, NOW, consolePolicy).locked, false);
  const ten = [...nine, ...fails("admin_console_unlock_failed", [10 * MIN])];
  assert.equal(evaluateThrottle(ten, NOW, consolePolicy).locked, true);
  // 15분이 지나면 풀린다.
  const old = fails("admin_console_unlock_failed", Array.from({ length: 10 }, (_, i) => (16 + i) * MIN));
  assert.equal(evaluateThrottle(old, NOW, consolePolicy).locked, false);
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

type Row = { streamer_id: string | null; action: string; created_at: string };

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
      rows.push({ streamer_id: body.streamer_id, action: body.action, created_at: new Date(Date.now() + tick++).toISOString() });
      return new Response("", { status: 201 });
    }
    const sid = url.searchParams.get("streamer_id") ?? "";
    const actions = (url.searchParams.get("action") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
    const since = Date.parse((url.searchParams.get("created_at") ?? "").replace(/^gte\./, ""));
    const hit = rows.filter(
      (r) =>
        (sid === "is.null" ? r.streamer_id === null : `eq.${r.streamer_id}` === sid) &&
        actions.includes(r.action) &&
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
    for (let i = 0; i < 10; i++) verdicts.push((await beginUnlockAttempt("sheet", "s1")).locked);
    assert.deepEqual(verdicts, [false, false, false, false, false, false, false, true, true, true]);
    // 잠긴 시도는 기록을 늘리지 않는다(DB 를 무한히 채우지 못하게).
    assert.equal(db.rows.length, 7);
    // 다른 스트리머·전역 콘솔 카운터와 섞이지 않는다.
    assert.equal((await beginUnlockAttempt("sheet", "s2")).locked, false);
    assert.equal((await beginUnlockAttempt("console", null)).locked, false);
  } finally {
    db.restore();
  }
});

test("동시에 50개를 몰아 보내도 비밀번호 검사를 받는 요청은 7개 이하", async () => {
  const db = installFakeSupabase();
  try {
    const results = await Promise.all(Array.from({ length: 50 }, () => beginUnlockAttempt("sheet", "s1")));
    const passed = results.filter((r) => !r.locked).length;
    assert.ok(passed <= 7, `passed=${passed}`);
  } finally {
    db.restore();
  }
});

test("성공하면 앞선 실패(방금 남긴 내 실패 포함)가 무효가 된다", async () => {
  const db = installFakeSupabase();
  try {
    for (let i = 0; i < 6; i++) await beginUnlockAttempt("donation", "s1");
    const mine = await beginUnlockAttempt("donation", "s1");
    assert.equal(mine.locked, false);
    await recordUnlockSuccess("donation", "s1");
    const next = await beginUnlockAttempt("donation", "s1");
    assert.equal(next.locked, false);
    assert.equal(next.remaining, 6);
  } finally {
    db.restore();
  }
});
