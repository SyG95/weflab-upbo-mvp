"use server";

// 팬 시트 관리자 모드 잠금 해제 / 비밀번호 설정 — 스트리머(슬러그)별.
// 쿠키는 슬러그별로 격리되고, 값은 "유효 비밀번호 해시"를 서버 비밀키로 서명한 값만 담는다.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminTokenHash, isDeployed, masterPinHash } from "@/lib/adminAuth";
import {
  sheetAdminCookieName,
  effectiveSheetPinHash,
  sheetAdminAccessState,
  sheetSessionValue,
} from "@/lib/sheetAdminAuth";
import { getStreamerRowBySlug, setSheetAdminPinHash } from "@/lib/upboSupabase";
import { beginUnlockAttempt, lockedMessage, recordUnlockSuccess, wrongPasswordMessage } from "@/lib/unlockThrottle";

// 오픈 리다이렉트 방지: 사이트 내부 경로("/..." 단일 슬래시 시작)만 허용.
function safeReturn(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

// slug 형식 검증(2~63자, 소문자/숫자/-/_). 잘못되면 빈 문자열.
function safeSlug(value: string): string {
  const v = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(v) ? v : "";
}

// 서명할 비밀키가 없으면(배포 환경 설정 누락) false — 호출자가 오류로 돌려준다.
function setSessionCookie(slug: string, pinHash: string, jar: Awaited<ReturnType<typeof cookies>>): boolean {
  const value = sheetSessionValue(slug, pinHash);
  if (!value) return false;
  jar.set(sheetAdminCookieName(slug), value, {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
  return true;
}

const SESSION_CONFIG_ERROR = "서버 설정 문제로 로그인할 수 없어요. 운영자에게 알려 주세요.";
const NOT_ISSUED_ERROR = "이 시트의 관리자 비밀번호가 아직 발급되지 않았어요. 운영자에게 발급을 요청해 주세요.";

export type SheetUnlockState = { error?: string };

export async function unlockSheetAdmin(_prev: SheetUnlockState, formData: FormData): Promise<SheetUnlockState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/"));
  if (!slug) return { error: "잘못된 접근이에요." };
  if (!password) return { error: "비밀번호를 입력해 주세요." };
  const streamer = await getStreamerRowBySlug(slug).catch(() => null);
  if (!streamer) return { error: "잘못된 접근이에요." };

  const master = masterPinHash();
  const pinHash = await effectiveSheetPinHash(slug);
  if (!pinHash && !master) return { error: NOT_ISSUED_ERROR };

  // 시도 제한(15분 7회·24시간 30회, 확프 페어링 실패 포함). 비밀번호를 보기 전에 이 시도를 먼저 센다.
  // 잠긴 동안엔 마스터키도 받지 않는다(lib/unlockThrottle.ts 머리말).
  let throttle;
  try {
    throttle = await beginUnlockAttempt("sheet", streamer.id);
  } catch {
    return { error: "잠시 후 다시 시도해 주세요." };
  }
  if (throttle.locked) return { error: lockedMessage(throttle.retryAfterSec) };

  const h = adminTokenHash(password);
  // sy 마스터키면 스트리머 개인 비번 설정 여부와 무관하게 통과(쿠키엔 마스터 해시 서명값 저장).
  if (master && h === master) {
    await recordUnlockSuccess("sheet", streamer.id);
    if (!setSessionCookie(slug, master, await cookies())) return { error: SESSION_CONFIG_ERROR };
    redirect(returnTo);
  }
  if (!pinHash) return { error: NOT_ISSUED_ERROR };
  if (h !== pinHash) return { error: wrongPasswordMessage(throttle.remaining) };
  await recordUnlockSuccess("sheet", streamer.id);
  if (!setSessionCookie(slug, pinHash, await cookies())) return { error: SESSION_CONFIG_ERROR };
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
  if (!setSessionCookie(slug, pinHash, await cookies())) return { error: SESSION_CONFIG_ERROR };
  return { ok: true };
}
