// 검증 대시보드(/admin/*) 접근 잠금.
//
// 기존 auth/token 구조를 바꾸지 않는다: 같은 UPBO_ADMIN_TOKEN(assertAdminToken 이 쓰는 값)을
// 그대로 재사용해 "읽기 페이지 게이트"만 추가한다. 쿠키에는 원문 토큰이 아니라 서명값만 저장한다(아래 signSession).
//
// 보안 기본값(fail-safe):
// - 토큰 설정됨        → 비밀번호 확인 필요(locked → 인증 후 authed)
// - 토큰 없음 + 로컬    → open-unconfigured (로컬 미리보기 허용 + 경고 배너)
// - 토큰 없음 + 배포    → blocked-unconfigured (배포 시 토큰 깜빡해도 노출 금지)

import { cookies } from "next/headers";
import crypto from "node:crypto";

export const ADMIN_COOKIE = "upbo_admin_session";

// Vercel 런타임에서는 VERCEL 환경변수가 "1"로 들어온다. 로컬 dev 와 구분하는 용도.
export function isDeployed(): boolean {
  return Boolean(process.env.VERCEL);
}

export function adminTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 마스터키(=UPBO_ADMIN_TOKEN) 해시. sy 전용 열쇠로 콘솔뿐 아니라 시트 관리자·후원집계
// 게이트도 이 값이면 통과한다. 스트리머 개인 PIN 체계는 그대로 두고 "또는 마스터" 조건만 얹는다.
// 미설정이면 null → 마스터 통과 없음(기존 개인/전역 PIN 동작 100% 유지).
export function masterPinHash(): string | null {
  const token = process.env.UPBO_ADMIN_TOKEN;
  return token ? adminTokenHash(token) : null;
}

// ── 세션 쿠키 서명 (2026-10-27) ──
// 예전 쿠키 값 = 비밀번호 해시(sha256) 그대로였다. 4자리 PIN 이면 해시 1만 개를 쿠키에 바꿔 끼우는 것만으로
// 관리자 세션을 위조할 수 있었고(잠금 해제 시도 제한도 우회), DB 에 저장된 PIN 해시가 곧 쿠키였다.
// 지금 쿠키 값 = HMAC(서버 비밀키, 종류·슬러그·유효 비밀번호 해시). 비밀번호가 바뀌면 옛 세션은 여전히 자동 무효.
// 서버 비밀키: UPBO_SESSION_SECRET 이 있으면 그것, 없으면 SUPABASE_SERVICE_ROLE_KEY(새 env 없이 동작).
// 배포 환경에서 둘 다 없으면 서명 불가 → 어떤 세션도 통과하지 않는다(fail-closed).
export type SessionScope = "console" | "sheet" | "donation";

function sessionKey(): string | null {
  const secret = process.env.UPBO_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return `upbo-session-v1:${secret}`;
  return isDeployed() ? null : "upbo-session-v1:local-dev";
}

export function signSession(scope: SessionScope, subject: string, secretHash: string): string | null {
  const key = sessionKey();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update(`${scope}\n${subject}\n${secretHash}`).digest("base64url");
}

export function sessionMatches(cookie: string | undefined, expected: string | null): boolean {
  if (!cookie || !expected) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function consoleSessionValue(token: string): string | null {
  return signSession("console", "", adminTokenHash(token));
}

// 스트리머 시트 관리자 비밀번호 랜덤 발급(콘솔 생성·비번 리셋·데이터 초기화 pins 범위).
// 4자리 숫자. 콘솔 마스터키(UPBO_ADMIN_TOKEN)와 같은 값은 피한다(시트 비번으로 콘솔 문을 열 수 없게).
export function randomSheetPin(): string {
  const master = process.env.UPBO_ADMIN_TOKEN;
  let pin = "";
  do {
    pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  } while (pin === master);
  return pin;
}

export type AdminAccess = "authed" | "locked" | "open-unconfigured" | "blocked-unconfigured";

export async function adminAccessState(): Promise<AdminAccess> {
  const token = process.env.UPBO_ADMIN_TOKEN;
  if (!token) return isDeployed() ? "blocked-unconfigured" : "open-unconfigured";
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  return sessionMatches(cookie, consoleSessionValue(token)) ? "authed" : "locked";
}
