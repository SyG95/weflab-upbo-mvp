// 검증 대시보드(/admin/*) 접근 잠금.
//
// 기존 auth/token 구조를 바꾸지 않는다: 같은 UPBO_ADMIN_TOKEN(assertAdminToken 이 쓰는 값)을
// 그대로 재사용해 "읽기 페이지 게이트"만 추가한다. 쿠키에는 원문 토큰이 아니라 해시만 저장한다.
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

export type AdminAccess = "authed" | "locked" | "open-unconfigured" | "blocked-unconfigured";

export async function adminAccessState(): Promise<AdminAccess> {
  const token = process.env.UPBO_ADMIN_TOKEN;
  if (!token) return isDeployed() ? "blocked-unconfigured" : "open-unconfigured";
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  return cookie && cookie === adminTokenHash(token) ? "authed" : "locked";
}
