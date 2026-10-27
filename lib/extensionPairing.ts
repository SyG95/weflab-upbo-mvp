// 확프 "비밀번호 페어링" 서버 로직.
//
// 확프가 [시트 슬러그 + 관리자 비밀번호]를 보내면 서버가 검증 후 진짜 확장 토큰을 발급한다.
// 확프는 토큰만 저장하고 비밀번호는 저장하지 않는다(재설치마다 긴 토큰을 손입력하던 고통 제거).
//
// 보안 원칙:
// - 비밀번호 원문은 어디에도 저장/로깅하지 않는다(해시 비교만, 실패는 여부만 audit 기록).
// - 발급된 평문 토큰은 pair 응답 1회에만 실려 나간다(로깅 금지).
// - 관리자 비번이 짧을 수 있어(4자리=1만 조합) 무차별 대입 위험 → 슬러그별 시도제한.
//   2026-10-27: 시트 관리자 잠금 해제와 같은 비밀번호라 한 셈으로 묶었다(lib/unlockThrottle.ts,
//   15분 7회·24시간 30회). 비밀번호를 보기 전에 시도를 먼저 기록한다. 잠긴 동안엔 마스터키만 받고,
//   그 시도는 마스터키 셈(요청한 곳별)으로 센다 — 예전처럼 잠금 중 마스터키를 끝없이 대입하지 못한다.
//
// 검증 3경로(하나라도 통과하면 성공):
//   1) 마스터키(sy 전용 UPBO_ADMIN_TOKEN 해시) — 아무 시트나 페어링 허용.
//   2) 그 시트 개별 관리자 비번 해시.
//   3) 전역 폴백 PIN 해시(개별 비번 미설정 시, 로컬 전용). — 2·3은 effectiveSheetPinHash 안에 함께 포함됨.

import { adminTokenHash, masterPinHash } from "./adminAuth";
import { effectiveSheetPinHash } from "./sheetAdminAuth";
import { decideStreamerUnlock } from "./unlockThrottle";
import { createExtensionToken, getStreamerRowBySlug } from "./upboSupabase";

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

// 페어링 교환의 전체 판정. 라우트는 이 결과의 status 를 HTTP 코드로, 나머지를 JSON body 로 쓴다.
// actorTag = 요청한 곳 표지(adminAuth.clientTag). 라우트가 요청 헤더로 만들어 넘긴다.
export async function pairExtension(rawSlug: unknown, rawPassword: unknown, actorTag = "unknown"): Promise<PairResult> {
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
  // 시도제한은 토큰 발급 "전에", 비밀번호를 보기 "전에" 건다(이 시도를 실패로 먼저 기록).
  // 개별 비번/폴백 PIN 은 effectiveSheetPinHash 하나로 함께 검증된다.
  const decision = await decideStreamerUnlock({
    kind: "pair",
    streamerId: streamer.id,
    actorTag,
    passwordHash: adminTokenHash(password),
    pinHash: await effectiveSheetPinHash(slug),
    masterHash: masterPinHash(),
  });
  if (decision.kind === "locked") {
    return { ok: false, status: 429, code: "locked", retryAfterSec: decision.retryAfterSec };
  }
  if (decision.kind === "wrong" || decision.kind === "not-issued") {
    const remainingAttempts = decision.kind === "wrong" ? decision.remaining : 0;
    return { ok: false, status: 401, code: "invalid_password", remainingAttempts };
  }

  // 성공(성공 기록은 decideStreamerUnlock 이 남김) → 진짜 확장 토큰 발급. 평문 token 은 이 응답에만 실린다.
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
