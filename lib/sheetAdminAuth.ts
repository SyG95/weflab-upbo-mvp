// 팬 시트 관리자 모드(/[streamerSlug]?admin=1) 접근 잠금 — 스트리머별 비밀번호.
//
// 예전: 전역 env PIN(UPBO_SHEET_ADMIN_PIN) 1개 + 전역 쿠키 → 모든 시트 공통.
// 지금: 스트리머별 비밀번호(DB 저장, 해시) + 슬러그별 쿠키 → 시트마다 따로.
//   - 스트리머별 비번이 저장돼 있으면 그 값으로 검증.
//   - 아직 없으면: 로컬(미러·개발)만 전역 env PIN 으로 폴백. 배포 환경(운영·Preview)은 2026-10-27 부터
//     공용 열쇠를 받지 않는다 — 모든 시트가 같은 4자리 하나로 열리던 구멍. 개별 비번이 없는 시트는
//     마스터키로만 열리고, 운영자가 콘솔 "비번 리셋"으로 발급한다.
//   - 둘 다 없으면 미설정 상태.
// 쿠키에는 원문이 아니라 "유효 비밀번호 해시"를 서버 비밀키로 서명한 값만 저장한다(adminAuth.signSession).
// 비번을 바꾸면 옛 세션은 자동 무효.
//
// 보안 기본값(fail-safe):
// - 유효 비번 있음      → 비밀번호 확인 필요(locked → 인증 후 authed)
// - 없음 + 로컬         → open-unconfigured (로컬 미리보기 허용)
// - 없음 + 배포         → 마스터키 있으면 locked(폼은 보이지만 sy 만 열림), 없으면 blocked-unconfigured

import { cookies } from "next/headers";
import { adminTokenHash, isDeployed, masterPinHash, sessionMatches, signSession } from "./adminAuth";
import { getSheetAdminPinHash } from "./upboSupabase";

export const SHEET_ADMIN_COOKIE_PREFIX = "upbo_sheet_admin_session_";

export function sheetAdminCookieName(slug: string): string {
  return `${SHEET_ADMIN_COOKIE_PREFIX}${slug}`;
}

export type SheetAdminAccess = "authed" | "locked" | "open-unconfigured" | "blocked-unconfigured";

// 이 시트 세션 쿠키 값. secretHash = 유효 비밀번호 해시 또는 마스터키 해시.
export function sheetSessionValue(slug: string, secretHash: string): string | null {
  return signSession("sheet", slug, secretHash);
}

// 이 슬러그의 "유효 비밀번호 해시": 스트리머별 저장값이 있으면 그것, 없으면 (로컬만) 전역 env PIN 해시.
// 둘 다 없으면 null(미설정).
export async function effectiveSheetPinHash(slug: string): Promise<string | null> {
  const perStreamer = await getSheetAdminPinHash(slug).catch(() => null);
  if (perStreamer) return perStreamer;
  if (isDeployed()) return null;
  const envPin = process.env.UPBO_SHEET_ADMIN_PIN;
  return envPin ? adminTokenHash(envPin) : null;
}

export async function sheetAdminAccessState(slug: string): Promise<SheetAdminAccess> {
  const cookie = (await cookies()).get(sheetAdminCookieName(slug))?.value;
  // sy 마스터키 세션이면 스트리머 개인 PIN 설정 여부와 무관하게 통과.
  const master = masterPinHash();
  if (master && sessionMatches(cookie, sheetSessionValue(slug, master))) return "authed";
  const pinHash = await effectiveSheetPinHash(slug);
  if (!pinHash) {
    if (!isDeployed()) return "open-unconfigured";
    return master ? "locked" : "blocked-unconfigured";
  }
  return sessionMatches(cookie, sheetSessionValue(slug, pinHash)) ? "authed" : "locked";
}

// 라우트/서버액션에서 쓰는 강제 검사. 인증 안 됐으면 401 을 throw 한다.
// 로컬 미설정(open-unconfigured)은 허용(로컬 미리보기), 배포 미설정(blocked)은 차단.
export async function requireSheetAdmin(slug: string): Promise<void> {
  const state = await sheetAdminAccessState(slug);
  if (state === "authed" || state === "open-unconfigured") return;
  const error = new Error("관리자 인증이 필요합니다.");
  (error as Error & { status?: number }).status = 401;
  throw error;
}
