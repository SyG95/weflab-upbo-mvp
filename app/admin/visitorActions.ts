"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, isDeployed } from "@/lib/adminAuth";
import {
  ADMIN_VISITOR_COOKIE,
  visitorPasswordMatches,
  visitorSessionValue,
} from "@/lib/adminVisitorAccess";
import { unlockAdmin, type UnlockState } from "./actions";

function safeReturn(path: string): string {
  return path === "/admin" || path.startsWith("/admin/") ? path : "/admin";
}

async function expireSession(name: string): Promise<void> {
  // 운영 쿠키도 /admin 에서 발급된다. 기본 / 경로 삭제로 남겨두지 않는다.
  (await cookies()).set(name, "", {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/admin",
    maxAge: 0,
  });
}

export async function unlockAdminOrVisitor(
  prev: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const password = String(formData.get("password") ?? "");
  await expireSession(ADMIN_VISITOR_COOKIE);

  if (!visitorPasswordMatches(password)) return unlockAdmin(prev, formData);

  // 1234 는 방문자 전용이다. 이전 운영자 로그인도 남기지 않는다.
  await expireSession(ADMIN_COOKIE);
  const session = visitorSessionValue();
  if (!session) return { error: "서버 설정 문제로 방문자 세션을 만들 수 없습니다." };
  (await cookies()).set(ADMIN_VISITOR_COOKIE, session, {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/admin",
    maxAge: 60 * 60 * 12,
  });
  redirect(safeReturn(String(formData.get("returnTo") ?? "/admin")));
}

export async function lockAdminOrVisitor(formData: FormData): Promise<void> {
  await expireSession(ADMIN_COOKIE);
  await expireSession(ADMIN_VISITOR_COOKIE);
  redirect(safeReturn(String(formData.get("returnTo") ?? "/admin")));
}
