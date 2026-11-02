// 공개 방문자는 운영 관리자와 다른 쿠키·서명 주체를 사용한다.
// 기존 adminAccessState 및 API/시트 관리자 인증은 이 쿠키를 읽지 않는다.
import { cookies } from "next/headers";
import { adminTokenHash, sessionMatches, signSession } from "./adminAuth";

export const ADMIN_VISITOR_COOKIE = "upbo_admin_visitor_session";
const VISITOR_PASSWORD = "1234";

export function visitorPasswordMatches(password: string): boolean {
  return password === VISITOR_PASSWORD;
}

export function visitorSessionValue(): string | null {
  return signSession("console", "public-visitor-v1", adminTokenHash(VISITOR_PASSWORD));
}

export async function adminVisitorAccessState(): Promise<boolean> {
  const value = (await cookies()).get(ADMIN_VISITOR_COOKIE)?.value;
  return sessionMatches(value, visitorSessionValue());
}
