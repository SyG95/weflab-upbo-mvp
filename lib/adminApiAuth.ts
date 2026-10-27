// 관리자 API(Bearer UPBO_ADMIN_TOKEN) 검사 + 마스터키 시도 제한 (2026-10-27).
// 스트리머 생성·데이터 초기화·확프 토큰 발급 API 는 예전엔 틀린 토큰을 몇 번이든 받아 줬다 → 마스터키를 끝없이
// 대입하는 통로. 콘솔 로그인과 같은 마스터키 셈(요청한 곳별 15분 10회 + 전체 15분 100회)을 쓴다.

import { clientTag } from "./adminAuth";
import { beginMasterAttempt, recordUnlockSuccess } from "./unlockThrottle";
import { assertAdminToken } from "./upboSupabase";

export async function requireAdminApi(request: Request): Promise<void> {
  // env 가 없으면 DB 를 읽기 전에 503(assertAdminToken 이 fail-closed 로 던진다).
  if (!process.env.UPBO_ADMIN_TOKEN) assertAdminToken(null);
  const tag = clientTag(request.headers);
  const throttle = await beginMasterAttempt(tag);
  if (throttle.locked) {
    const error = new Error(`too many invalid admin token attempts; retry after ${throttle.retryAfterSec}s`);
    (error as Error & { status?: number }).status = 429;
    throw error;
  }
  assertAdminToken(request.headers.get("authorization")); // 틀리면 401(실패는 이미 기록됨)
  await recordUnlockSuccess("master", null, tag);
}
