"use server";

// 후원집계 잠금 해제 — sheetAdminActions.ts 의 검증된 패턴을 전용 비밀번호로 옮긴 것.
// 쿠키에는 원문이 아니라 "유효 비밀번호 해시"를 서버 비밀키로 서명한 값만 담고, 비번이 바뀌면 옛 세션은 자동 무효.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { adminTokenHash, clientTag, isDeployed, masterPinHash } from "@/lib/adminAuth";
import {
  donationAdminAccessState,
  donationAdminCookieName,
  donationSessionValue,
  effectiveDonationPinHash,
} from "@/lib/donationAdminAuth";
import { setDonationPinHashForStreamer } from "@/lib/donationEvents";
import { getStreamerRowBySlug } from "@/lib/upboSupabase";
import { decideStreamerUnlock, unlockErrorMessage } from "@/lib/unlockThrottle";

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
function setSessionCookie(slug: string, hash: string, jar: Awaited<ReturnType<typeof cookies>>): boolean {
  const value = donationSessionValue(slug, hash);
  if (!value) return false;
  jar.set(donationAdminCookieName(slug), value, {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12시간
  });
  return true;
}

const SESSION_CONFIG_ERROR = "서버 설정 문제로 열 수 없어요. 운영자에게 알려 주세요.";
const NOT_SET_ERROR = "후원집계 전용 비밀번호가 아직 없어요. 업보시트 관리자로 먼저 로그인해 주세요.";

export type DonationUnlockState = { error?: string };

export async function unlockDonationAdmin(
  _prev: DonationUnlockState,
  formData: FormData,
): Promise<DonationUnlockState> {
  const slug = safeSlug(String(formData.get("slug") ?? ""));
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/"));
  if (!slug) return { error: "잘못된 접근이에요." };
  if (!password) return { error: "비밀번호를 입력해 주세요." };
  const streamer = await getStreamerRowBySlug(slug).catch(() => null);
  if (!streamer) return { error: "잘못된 접근이에요." };

  const master = masterPinHash();
  const pinHash = await effectiveDonationPinHash(slug);
  if (!pinHash && !master) return { error: NOT_SET_ERROR };

  // 시도 제한(15분 7회·24시간 30회). 비밀번호를 보기 전에 이 시도를 먼저 센다.
  // 잠겼으면 마스터키만 받고, 그 시도는 마스터키 셈(요청한 곳별)으로 센다(lib/unlockThrottle.ts).
  let decision;
  try {
    decision = await decideStreamerUnlock({
      kind: "donation",
      streamerId: streamer.id,
      actorTag: clientTag(await headers()),
      passwordHash: adminTokenHash(password),
      pinHash,
      masterHash: master,
    });
  } catch {
    return { error: "잠시 후 다시 시도해 주세요." };
  }
  if (decision.kind !== "pin" && decision.kind !== "master") {
    return { error: unlockErrorMessage(decision, NOT_SET_ERROR) };
  }
  // 마스터키 통과면 쿠키엔 마스터 해시 서명값(스트리머 개인 비번 설정 여부와 무관).
  const secret = decision.kind === "pin" ? pinHash : master;
  if (!secret || !setSessionCookie(slug, secret, await cookies())) return { error: SESSION_CONFIG_ERROR };
  redirect(returnTo);
}

export type DonationPasswordState = { error?: string; ok?: boolean };

// 이 스트리머만의 후원집계 비밀번호 설정/변경. 반드시 이미 열람 중(인증됨)이어야 한다.
// 설정하면 이 스트리머는 업보시트 관리자 세션 대신 여기서 정한 비밀번호로만 열린다.
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
  if (!setSessionCookie(slug, pinHash, await cookies())) return { error: SESSION_CONFIG_ERROR };
  return { ok: true };
}
