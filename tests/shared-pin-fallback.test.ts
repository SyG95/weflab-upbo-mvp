// 공용 PIN 폴백 회귀 테스트 (2026-10-27 보안 줄 ②).
// 배포 환경(운영·Preview)에선 공용 env PIN(UPBO_SHEET_ADMIN_PIN·UPBO_DONATION_ADMIN_PIN)으로 열리면 안 된다.
// 로컬(미러·개발)은 그대로 공용 PIN 폴백(미러 관례 PIN 으로 검증하는 레인 유지).
// Supabase env 가 없으니 스트리머별 저장값 조회는 실패 → "개별 비번 없음"과 같은 상황이 된다.
import test from "node:test";
import assert from "node:assert/strict";

// 셸에 Supabase env 가 있더라도 실제 DB 로 나가지 않게, 모듈을 읽기 전에 지운다(모듈이 import 시점에 읽음).
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
async function load() {
  const { adminTokenHash } = await import("../lib/adminAuth");
  const { effectiveSheetPinHash } = await import("../lib/sheetAdminAuth");
  const { effectiveDonationPinHash } = await import("../lib/donationAdminAuth");
  return { adminTokenHash, effectiveSheetPinHash, effectiveDonationPinHash };
}

const KEYS = ["VERCEL", "UPBO_SHEET_ADMIN_PIN", "UPBO_DONATION_ADMIN_PIN"] as const;

async function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => Promise<void>) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    await fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("배포 환경: 개별 비번이 없으면 공용 env PIN 이 있어도 null(=공용 열쇠로 안 열림)", async () => {
  const { effectiveSheetPinHash, effectiveDonationPinHash } = await load();
  await withEnv({ VERCEL: "1", UPBO_SHEET_ADMIN_PIN: "1111", UPBO_DONATION_ADMIN_PIN: "2222" }, async () => {
    assert.equal(await effectiveSheetPinHash("poromi"), null);
    assert.equal(await effectiveDonationPinHash("poromi"), null);
  });
});

test("로컬: 공용 env PIN 폴백 유지(미러 레인)", async () => {
  const { adminTokenHash, effectiveSheetPinHash, effectiveDonationPinHash } = await load();
  await withEnv({ UPBO_SHEET_ADMIN_PIN: "1111", UPBO_DONATION_ADMIN_PIN: "2222" }, async () => {
    assert.equal(await effectiveSheetPinHash("poromi"), adminTokenHash("1111"));
    assert.equal(await effectiveDonationPinHash("poromi"), adminTokenHash("2222"));
  });
  await withEnv({}, async () => {
    assert.equal(await effectiveSheetPinHash("poromi"), null);
  });
});
