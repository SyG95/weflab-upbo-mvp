"use server";

// 후원집계 잠금 해제 — sheetAdminActions.ts 의 검증된 패턴을 전용 비밀번호로 옮긴 것.
// 쿠키에는 원문이 아니라 "유효 비밀번호 해시"만 담고, 비번이 바뀌면 옛 세션은 자동 무효.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminTokenHash, isDeployed, masterPinHash } from "@/lib/adminAuth";
import {
  donationAdminAccessState,
  donationAdminCookieName,
  effectiveDonationPinHash,
} from "@/lib/donationAdminAuth";
import { setDonationPinHashForStreamer } from "@/lib/donationEvents";
import { getStreamerRowBySlug } from "@/lib/upboSupabase";

// 오픈 리다이렉트 방지: 사이트 내부 경로("/..." 단일 슬래시 시작)만 허용.
function safeReturn(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

// slug 형식 검증(2~63자, 소문자/숫자/-/_). 잘못되면 빈 문자열.
function safeSlug(value: string): string {
  const v = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(v) ? v : "";
}

export type DonationUnlockState = { error?: string };

export async function unlockDonationAdmin(
  _prev: DonationUnlockState,
  formData: FormData,
): Promise<DonationUnlockState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/"));
  if (!slug) return { error: "잘못된 접근이에요." };

  function setSessionCookie(jar: Awaited<ReturnType<typeof cookies>>, hash: string) {
    jar.set(donationAdminCookieName(slug), hash, {
      httpOnly: true,
      secure: isDeployed(),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12, // 12시간
    });
  }

  // sy 마스터키면 스트리머 개인 비번 설정 여부와 무관하게 통과(쿠키엔 마스터 해시 저장).
  const master = masterPinHash();
  if (master && password && adminTokenHash(password) === master) {
    setSessionCookie(await cookies(), master);
    redirect(returnTo);
  }
  const pinHash = await effectiveDonationPinHash(slug);
  if (!pinHash) return { error: "서버에 후원집계 비밀번호가 설정돼 있지 않습니다." };
  if (!password || adminTokenHash(password) !== pinHash) {
    return { error: "비밀번호가 올바르지 않습니다." };
  }
  setSessionCookie(await cookies(), pinHash);
  redirect(returnTo);
}

export type DonationPasswordState = { error?: string; ok?: boolean };

// 이 스트리머만의 후원집계 비밀번호 설정/변경. 반드시 이미 열람 중(인증됨)이어야 한다.
// 설정하면 이 스트리머는 공용 env 값 대신 여기서 정한 비밀번호로만 열린다.
export async function setDonationAdminPassword(
  _prev: DonationPasswordState,
  formData: FormData,
): Promise<DonationPasswordState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (!slug) return { error: "잘못된 접근이에요." };

  const state = await donationAdminAccessState(slug);
  if (state !== "authed" && state !== "open-unconfigured") {
    return { error: "먼저 후원집계 비밀번호로 들어와 주세요." };
  }
  if (newPassword.length < 4) return { error: "비밀번호는 4자 이상으로 정해 주세요." };
  if (newPassword.length > 128) return { error: "비밀번호가 너무 길어요." };
  if (newPassword !== confirmPassword) return { error: "두 비밀번호가 서로 달라요." };

  const streamer = await getStreamerRowBySlug(slug);
  const pinHash = adminTokenHash(newPassword);
  await setDonationPinHashForStreamer(streamer.id, pinHash);
  // 방금 정한 사람은 계속 열람 유지(쿠키를 새 해시로 갱신). 다른 브라우저의 옛 세션은 무효화됨.
  (await cookies()).set(donationAdminCookieName(slug), pinHash, {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
  return { ok: true };
}
