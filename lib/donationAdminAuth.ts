// 후원집계(/[streamerSlug]/donations) 접근 잠금 — 업보시트 관리자 비밀번호와 별도의 전용 비밀번호.
//
// sheetAdminAuth.ts 의 검증된 패턴을 그대로 옮긴 독립 게이트다(기존 auth 파일 무수정).
// - 스트리머별 비밀번호(DB 저장, 해시) + 슬러그별 쿠키 → 스트리머마다 따로.
//   - 스트리머별 비번이 저장돼 있으면 그 값으로 검증.
//   - 아직 없으면: 업보시트 관리자로 로그인돼 있으면 들어와서 전용 비밀번호를 정할 수 있다.
//     예전엔 모든 스트리머 공용 env PIN(UPBO_DONATION_ADMIN_PIN)이 초기 진입 열쇠였다 — 하나만 알면
//     전용 비번을 안 정한 모든 스트리머의 후원집계가 열렸다. 2026-10-27 부터 공용 PIN 은 로컬(미러·개발)만.
//   - 둘 다 없으면 미설정 상태.
// - 쿠키에는 원문이 아니라 "유효 비밀번호 해시"를 서버 비밀키로 서명한 값만 저장(adminAuth.signSession).
//   비번을 바꾸면 옛 세션 자동 무효.
// - 보안 기본값(fail-safe):
//   유효 비번 있음      → 비밀번호 확인 필요(locked → 인증 후 authed)
//   없음 + 로컬         → open-unconfigured (로컬 미리보기 허용)
//   없음 + 배포         → blocked-unconfigured (배포 시 깜빡해도 노출 금지)

import { cookies } from "next/headers";
import { adminTokenHash, isDeployed, masterPinHash, sessionMatches, signSession } from "./adminAuth";
import { getStreamerRowBySlug } from "./upboSupabase";
import { getDonationPinHashForStreamer } from "./donationEvents";
import { sheetAdminAccessState } from "./sheetAdminAuth";

export const DONATION_ADMIN_COOKIE_PREFIX = "upbo_donation_admin_session_";

export function donationAdminCookieName(slug: string): string {
  return `${DONATION_ADMIN_COOKIE_PREFIX}${slug}`;
}

export type DonationAdminAccess = "authed" | "locked" | "open-unconfigured" | "blocked-unconfigured";

// 후원집계 세션 쿠키 값. secretHash = 유효 비밀번호 해시 또는 마스터키 해시.
export function donationSessionValue(slug: string, secretHash: string): string | null {
  return signSession("donation", slug, secretHash);
}

// 이 슬러그의 "유효 비밀번호 해시": 스트리머별 저장값이 있으면 그것, 없으면 (로컬만) 공용 env PIN 해시.
// 둘 다 없으면 null(미설정). 스트리머 조회 실패(미등록 슬러그 등)는 저장값 없음으로 취급.
export async function effectiveDonationPinHash(slug: string): Promise<string | null> {
  const perStreamer = await getStreamerRowBySlug(slug)
    .then((streamer) => getDonationPinHashForStreamer(streamer.id))
    .catch(() => null);
  if (perStreamer) return perStreamer;
  if (isDeployed()) return null;
  const envPin = process.env.UPBO_DONATION_ADMIN_PIN;
  return envPin ? adminTokenHash(envPin) : null;
}

export async function donationAdminAccessState(slug: string): Promise<DonationAdminAccess> {
  const cookie = (await cookies()).get(donationAdminCookieName(slug))?.value;
  // sy 마스터키 세션이면 스트리머 개인 PIN 설정 여부와 무관하게 통과.
  const master = masterPinHash();
  if (master && sessionMatches(cookie, donationSessionValue(slug, master))) return "authed";
  const pinHash = await effectiveDonationPinHash(slug);
  if (!pinHash) {
    // 전용 비번을 아직 안 정한 스트리머: 업보시트 관리자 세션이면 들어와서 정하게 한다(화면 아래 비밀번호 폼).
    if ((await sheetAdminAccessState(slug)) === "authed") return "authed";
    return isDeployed() ? "blocked-unconfigured" : "open-unconfigured";
  }
  return sessionMatches(cookie, donationSessionValue(slug, pinHash)) ? "authed" : "locked";
}

// 라우트/서버액션에서 쓰는 강제 검사. 인증 안 됐으면 401 을 throw 한다.
export async function requireDonationAdmin(slug: string): Promise<void> {
  const state = await donationAdminAccessState(slug);
  if (state === "authed" || state === "open-unconfigured") return;
  const error = new Error("후원집계 비밀번호 확인이 필요합니다.");
  (error as Error & { status?: number }).status = 401;
  throw error;
}
