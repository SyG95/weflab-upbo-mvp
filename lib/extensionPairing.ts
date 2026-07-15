// 확프 "비밀번호 페어링" 서버 로직.
//
// 확프가 [시트 슬러그 + 관리자 비밀번호]를 보내면 서버가 검증 후 진짜 확장 토큰을 발급한다.
// 확프는 토큰만 저장하고 비밀번호는 저장하지 않는다(재설치마다 긴 토큰을 손입력하던 고통 제거).
//
// 보안 원칙:
// - 비밀번호 원문은 어디에도 저장/로깅하지 않는다(해시 비교만, 실패는 여부만 audit 기록).
// - 발급된 평문 토큰은 pair 응답 1회에만 실려 나간다(로깅 금지).
// - 관리자 비번이 짧을 수 있어(4자리=1만 조합) 무차별 대입 위험 → 슬러그별 시도제한.
//
// 검증 3경로(하나라도 통과하면 성공):
//   1) 마스터키(sy 전용 UPBO_ADMIN_TOKEN 해시) — 아무 시트나 페어링 허용, 잠금 무관 통과.
//   2) 그 시트 개별 관리자 비번 해시.
//   3) 전역 폴백 PIN 해시(개별 비번 미설정 시). — 2·3은 effectiveSheetPinHash 안에 함께 포함됨.

import { adminTokenHash, masterPinHash } from "./adminAuth";
import { effectiveSheetPinHash } from "./sheetAdminAuth";
import {
  createExtensionToken,
  getRecentExtensionPairAudits,
  getStreamerRowBySlug,
  recordExtensionPairAttempt,
} from "./upboSupabase";

// 시도제한 상수: 슬러그별 최근 WINDOW 내 실패가 MAX_FAILURES 이상이면 잠금.
// 잠금 창은 "마지막 실패" 기준 WINDOW. 성공 시각 이후 실패만 세므로 성공하면 리셋된다.
export const PAIR_LOCK_WINDOW_MS = 15 * 60 * 1000; // 15분
export const PAIR_MAX_FAILURES = 7;

export type PairResult =
  | { ok: true; status: 200; code: "ok"; token: string; slug: string; displayName: string }
  | { ok: false; status: 404; code: "unknown_slug" }
  | { ok: false; status: 429; code: "locked"; retryAfterSec: number }
  | { ok: false; status: 401; code: "invalid_password"; remainingAttempts: number };

// 기존 슬러그 규칙(lib/upboSupabase.ts toSlug)과 동일하게 정규화하되, 형식이 어긋나면
// 예외를 던지지 않고 null 을 돌려준다(형식 오류는 unknown_slug 로 흡수).
function normalizeSlug(value: unknown): string | null {
  const slug = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(slug) ? slug : null;
}

type LockState = { locked: boolean; retryAfterSec: number; failuresSinceSuccess: number };

// audit 기록(성공/실패, 시간순)으로 현재 잠금 상태를 계산한다.
// - 최근 WINDOW 안의 기록만 본다.
// - 그 창 안 마지막 성공 시각 이후의 실패만 카운트(성공=리셋 효과).
// - 실패가 MAX_FAILURES 이상이면 잠금이며, 마지막 실패+WINDOW 까지 남은 시간을 retryAfterSec 로 준다.
function evaluateLock(rows: Array<{ action: string; created_at: string }>, now: number): LockState {
  const windowStart = now - PAIR_LOCK_WINDOW_MS;
  const inWindow = rows.filter((r) => Date.parse(r.created_at) >= windowStart);
  let lastOkAt = 0;
  for (const r of inWindow) {
    if (r.action === "extension_pair_ok") lastOkAt = Math.max(lastOkAt, Date.parse(r.created_at));
  }
  const failureTimes = inWindow
    .filter((r) => r.action === "extension_pair_failed" && Date.parse(r.created_at) > lastOkAt)
    .map((r) => Date.parse(r.created_at));
  const count = failureTimes.length;
  if (count >= PAIR_MAX_FAILURES) {
    const lastFailAt = Math.max(...failureTimes);
    const retryAfterSec = Math.max(1, Math.ceil((lastFailAt + PAIR_LOCK_WINDOW_MS - now) / 1000));
    return { locked: true, retryAfterSec, failuresSinceSuccess: count };
  }
  return { locked: false, retryAfterSec: 0, failuresSinceSuccess: count };
}

// 페어링 교환의 전체 판정. 라우트는 이 결과의 status 를 HTTP 코드로, 나머지를 JSON body 로 쓴다.
export async function pairExtension(rawSlug: unknown, rawPassword: unknown): Promise<PairResult> {
  const slug = normalizeSlug(rawSlug);
  if (!slug) return { ok: false, status: 404, code: "unknown_slug" };

  let streamer;
  try {
    streamer = await getStreamerRowBySlug(slug);
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return { ok: false, status: 404, code: "unknown_slug" };
    }
    throw error; // 그 외(Supabase 장애 등)는 라우트의 jsonError 로 위임.
  }

  const password = String(rawPassword ?? "");
  const h = adminTokenHash(password);
  const master = masterPinHash();
  const isMaster = Boolean(master) && h === master;

  // 시도제한은 토큰 발급 "전에" 건다. 마스터키는 잠금 무관하게 통과(운영자 비상).
  const now = Date.now();
  const sinceIso = new Date(now - PAIR_LOCK_WINDOW_MS).toISOString();
  const audits = await getRecentExtensionPairAudits(streamer.id, sinceIso);
  const lock = evaluateLock(audits, now);
  if (lock.locked && !isMaster) {
    return { ok: false, status: 429, code: "locked", retryAfterSec: lock.retryAfterSec };
  }

  // 개별 비번/폴백 PIN 은 effectiveSheetPinHash 하나로 함께 검증된다.
  const passed = isMaster || h === (await effectiveSheetPinHash(slug));
  if (!passed) {
    await recordExtensionPairAttempt(streamer.id, "failed", slug);
    const remainingAttempts = Math.max(0, PAIR_MAX_FAILURES - (lock.failuresSinceSuccess + 1));
    return { ok: false, status: 401, code: "invalid_password", remainingAttempts };
  }

  // 성공: 성공 기록(카운터 리셋 효과) 후 진짜 확장 토큰 발급. 평문 token 은 이 응답에만 실린다.
  await recordExtensionPairAttempt(streamer.id, "ok", slug);
  const created = await createExtensionToken(slug, "pair");
  return {
    ok: true,
    status: 200,
    code: "ok",
    token: created.token.value,
    slug: streamer.slug,
    displayName: streamer.display_name,
  };
}
