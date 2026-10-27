// 세션 쿠키 서명 회귀 테스트 (2026-10-27 보안 줄 ②).
// 예전 쿠키 값 = 비밀번호 해시(sha256) 그대로라, 4자리 PIN 이면 해시 1만 개를 쿠키로 바꿔 끼워 세션을 위조할 수 있었다.
// 이제 쿠키 값 = HMAC(서버 비밀키, 종류·슬러그·해시) — 비밀키 없이는 만들 수 없어야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { adminTokenHash, consoleSessionValue, sessionMatches, signSession } from "../lib/adminAuth";
import { sheetSessionValue } from "../lib/sheetAdminAuth";
import { donationSessionValue } from "../lib/donationAdminAuth";

const KEYS = ["UPBO_SESSION_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL"] as const;

function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const pinHash = adminTokenHash("0420");

test("쿠키 값은 비밀번호 해시와 다르고, 비밀키가 다르면 값도 다르다", () => {
  let a: string | null = null;
  let b: string | null = null;
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "service-key-A", VERCEL: "1" }, () => {
    a = sheetSessionValue("poromi", pinHash);
  });
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "service-key-B", VERCEL: "1" }, () => {
    b = sheetSessionValue("poromi", pinHash);
  });
  assert.ok(a && b);
  assert.notEqual(a, pinHash);
  assert.notEqual(a, b);
});

test("UPBO_SESSION_SECRET 이 있으면 그것을 우선 쓴다", () => {
  let a: string | null = null;
  let b: string | null = null;
  withEnv({ UPBO_SESSION_SECRET: "s1", SUPABASE_SERVICE_ROLE_KEY: "k", VERCEL: "1" }, () => {
    a = signSession("sheet", "poromi", pinHash);
  });
  withEnv({ UPBO_SESSION_SECRET: "s2", SUPABASE_SERVICE_ROLE_KEY: "k", VERCEL: "1" }, () => {
    b = signSession("sheet", "poromi", pinHash);
  });
  assert.notEqual(a, b);
});

test("슬러그·종류가 다르면 같은 비밀번호여도 쿠키가 다르다(다른 시트·후원집계로 옮겨 쓰기 불가)", () => {
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "k", VERCEL: "1" }, () => {
    const sheetA = sheetSessionValue("poromi", pinHash);
    const sheetB = sheetSessionValue("chaeru", pinHash);
    const donation = donationSessionValue("poromi", pinHash);
    const consoleValue = signSession("console", "", pinHash);
    assert.equal(new Set([sheetA, sheetB, donation, consoleValue]).size, 4);
    // 같은 입력이면 같은 값(서버 재시작·다른 인스턴스에서도 세션 유지).
    assert.equal(sheetSessionValue("poromi", pinHash), sheetA);
  });
});

test("배포 환경에 비밀키가 하나도 없으면 서명 불가 → 어떤 쿠키도 통과 못 함", () => {
  withEnv({ VERCEL: "1" }, () => {
    assert.equal(sheetSessionValue("poromi", pinHash), null);
    assert.equal(consoleSessionValue("token"), null);
    assert.equal(sessionMatches(pinHash, sheetSessionValue("poromi", pinHash)), false);
  });
  // 로컬(미러·개발)은 고정 개발용 키로 동작한다.
  withEnv({}, () => {
    assert.ok(sheetSessionValue("poromi", pinHash));
  });
});

test("sessionMatches: 정확히 같을 때만 true, 빈 값·길이 다름은 false", () => {
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: "k", VERCEL: "1" }, () => {
    const v = sheetSessionValue("poromi", pinHash)!;
    assert.equal(sessionMatches(v, v), true);
    assert.equal(sessionMatches(undefined, v), false);
    assert.equal(sessionMatches("", v), false);
    assert.equal(sessionMatches(v.slice(1), v), false);
    assert.equal(sessionMatches(pinHash, v), false); // 옛 방식 쿠키(=PIN 해시)는 더 이상 안 통한다
  });
});
