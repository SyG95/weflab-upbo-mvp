// assertAdminToken fail-closed 회귀 테스트 (2026-10-27 보안 줄 ②).
// 관리자 API(스트리머 생성·데이터 초기화·확프 토큰 발급)는 UPBO_ADMIN_TOKEN 이 없으면 거부해야 한다.
// 예전엔 env 가 없으면 검사 없이 통과했다(Preview 배포 등에서 인증 없이 열림).
import test from "node:test";
import assert from "node:assert/strict";
import { assertAdminToken } from "../lib/upboSupabase";

const KEY = "UPBO_ADMIN_TOKEN";

function withEnv(value: string | undefined, fn: () => void) {
  const saved = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

function statusOf(fn: () => void): number | "passed" {
  try {
    fn();
    return "passed";
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

test("env 미설정이면 헤더가 무엇이든 거부(503)", () => {
  withEnv(undefined, () => {
    assert.equal(statusOf(() => assertAdminToken(null)), 503);
    assert.equal(statusOf(() => assertAdminToken("")), 503);
    assert.equal(statusOf(() => assertAdminToken("Bearer anything")), 503);
  });
  withEnv("", () => {
    assert.equal(statusOf(() => assertAdminToken("Bearer ")), 503);
  });
});

test("env 설정 시 맞는 토큰만 통과", () => {
  withEnv("test-admin-token-long-random", () => {
    assert.equal(statusOf(() => assertAdminToken("Bearer test-admin-token-long-random")), "passed");
    assert.equal(statusOf(() => assertAdminToken("bearer   test-admin-token-long-random  ")), "passed");
    assert.equal(statusOf(() => assertAdminToken("Bearer wrong")), 401);
    assert.equal(statusOf(() => assertAdminToken("Bearer test-admin-token-long-randoM")), 401);
    assert.equal(statusOf(() => assertAdminToken(null)), 401);
    assert.equal(statusOf(() => assertAdminToken("test-admin-token-long-random")), 401);
  });
});
