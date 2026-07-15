"use server";

// 팬 시트 관리자 모드 잠금 해제 / 비밀번호 설정 — 스트리머(슬러그)별.
// 쿠키는 슬러그별로 격리되고, 값은 "유효 비밀번호 해시"만 담는다.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminTokenHash, isDeployed, masterPinHash } from "@/lib/adminAuth";
import {
  sheetAdminCookieName,
  effectiveSheetPinHash,
  sheetAdminAccessState,
} from "@/lib/sheetAdminAuth";
import { setSheetAdminPinHash } from "@/lib/upboSupabase";

// 오픈 리다이렉트 방지: 사이트 내부 경로("/..." 단일 슬래시 시작)만 허용.
function safeReturn(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

// slug 형식 검증(2~63자, 소문자/숫자/-/_). 잘못되면 빈 문자열.
function safeSlug(value: string): string {
  const v = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(v) ? v : "";
}

function setSessionCookie(slug: string, pinHash: string, jar: Awaited<ReturnType<typeof cookies>>) {
  jar.set(sheetAdminCookieName(slug), pinHash, {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
}

export type SheetUnlockState = { error?: string };

export async function unlockSheetAdmin(_prev: SheetUnlockState, formData: FormData): Promise<SheetUnlockState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/"));
  if (!slug) return { error: "잘못된 접근이에요." };
  // sy 마스터키면 스트리머 개인 비번 설정 여부와 무관하게 통과(쿠키엔 마스터 해시 저장).
  const master = masterPinHash();
  if (master && password && adminTokenHash(password) === master) {
    setSessionCookie(slug, master, await cookies());
    redirect(returnTo);
  }
  const pinHash = await effectiveSheetPinHash(slug);
  if (!pinHash) return { error: "서버에 관리자 비밀번호가 설정돼 있지 않습니다." };
  if (!password || adminTokenHash(password) !== pinHash) {
    return { error: "비밀번호가 올바르지 않습니다." };
  }
  setSessionCookie(slug, pinHash, await cookies());
  redirect(returnTo);
}

export type SheetPasswordState = { error?: string; ok?: boolean };

// 이 시트의 관리자 비밀번호 설정/변경. 반드시 이미 이 시트에 로그인된 상태여야 한다.
export async function setSheetAdminPassword(
  _prev: SheetPasswordState,
  formData: FormData,
): Promise<SheetPasswordState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!slug) return { error: "잘못된 접근이에요." };

  const state = await sheetAdminAccessState(slug);
  if (state !== "authed" && state !== "open-unconfigured") {
    return { error: "먼저 관리자 로그인해 주세요." };
  }
  if (newPassword.length < 4) return { error: "비밀번호는 4자 이상으로 정해 주세요." };
  if (newPassword.length > 128) return { error: "비밀번호가 너무 길어요." };
  if (newPassword !== confirmPassword) return { error: "두 비밀번호가 서로 달라요." };

  const pinHash = adminTokenHash(newPassword);
  await setSheetAdminPinHash(slug, pinHash);
  // 방금 정한 사람은 계속 로그인 유지(쿠키를 새 해시로 갱신). 다른 브라우저의 옛 세션은 무효화됨.
  setSessionCookie(slug, pinHash, await cookies());
  return { ok: true };
}
