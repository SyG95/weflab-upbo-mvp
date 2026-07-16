"use server";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, adminAccessState, adminTokenHash, isDeployed } from "@/lib/adminAuth";
import {
  createExtensionToken,
  deleteStreamer,
  executeStreamerReset,
  getStreamerRowBySlug,
  hasResetScope,
  previewStreamerReset,
  setSheetAdminPinHash,
  upsertStreamer,
  type ResetCount,
  type ResetScope,
} from "@/lib/upboSupabase";

// 오픈 리다이렉트 방지: /admin 으로 시작하는 경로만 허용.
function safeReturn(path: string): string {
  return path.startsWith("/admin/") || path === "/admin" ? path : "/admin";
}

export type UnlockState = { error?: string };

export async function unlockAdmin(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const token = process.env.UPBO_ADMIN_TOKEN;
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/admin"));
  if (!token) return { error: "서버에 관리자 토큰(UPBO_ADMIN_TOKEN)이 설정돼 있지 않습니다." };
  if (!password || password !== token) return { error: "비밀번호가 올바르지 않습니다." };
  (await cookies()).set(ADMIN_COOKIE, adminTokenHash(token), {
    httpOnly: true,
    secure: isDeployed(),
    sameSite: "lax",
    path: "/admin",
    maxAge: 60 * 60 * 12, // 12시간
  });
  redirect(returnTo);
}

export async function lockAdmin(formData: FormData): Promise<void> {
  const returnTo = safeReturn(String(formData.get("returnTo") ?? "/admin"));
  (await cookies()).delete(ADMIN_COOKIE);
  redirect(returnTo);
}

// ── 온보딩 콘솔 (스트리머 추가 / 비번 리셋) ──────────────────────────────
// 콘솔은 이미 UPBO_ADMIN_TOKEN 로 로그인된 상태에서만 동작한다(쿠키 세션 검사).
// 로컬 미설정(open-unconfigured)은 미리보기용으로 허용.

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;

async function assertConsoleAdmin(): Promise<void> {
  const state = await adminAccessState();
  if (state === "authed" || state === "open-unconfigured") return;
  throw new Error("관리자 인증이 필요합니다.");
}

// 스트리머 초기 4자리 비밀번호. 콘솔 마스터키(UPBO_ADMIN_TOKEN)와 같은 값은 피한다
// (스트리머가 자기 시트 비번으로 대장 콘솔 문을 열 수 있으면 안 되므로).
function randomPin(): string {
  const master = process.env.UPBO_ADMIN_TOKEN;
  let pin = "";
  do {
    pin = String(crypto.randomInt(0, 10000)).padStart(4, "0");
  } while (pin === master);
  return pin;
}

async function streamerExists(slug: string): Promise<boolean> {
  try {
    await getStreamerRowBySlug(slug);
    return true;
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) return false;
    throw error;
  }
}

export type CreateStreamerState = {
  ok?: boolean;
  error?: string;
  result?: { slug: string; displayName: string; token: string; pin: string };
};

// 슬러그 하나로 스트리머 생성 + 확장 토큰 발급 + 랜덤 초기 PIN 심기를 한 번에.
// 성공 시 슬러그/토큰/PIN 을 돌려주고(생성 직후 1회 표시용), 목록을 갱신한다.
export async function createStreamerAction(
  _prev: CreateStreamerState,
  formData: FormData,
): Promise<CreateStreamerState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const displayName = String(formData.get("displayName") ?? "").trim();
    if (!SLUG_RE.test(slug)) {
      return { error: "슬러그는 영문 소문자·숫자로 시작하는 2~63자여야 해요 (예: poromi)." };
    }
    if (await streamerExists(slug)) {
      return { error: `이미 있는 슬러그예요(/${slug}). 비밀번호는 목록에서 '비번 리셋'을 쓰세요.` };
    }
    const streamer = await upsertStreamer({ slug, displayName: displayName || slug });
    const tokenResult = await createExtensionToken(slug, "console-onboarding");
    const pin = randomPin();
    await setSheetAdminPinHash(slug, adminTokenHash(pin));
    revalidatePath("/admin");
    return {
      ok: true,
      result: {
        slug: streamer.slug,
        displayName: streamer.displayName,
        token: tokenResult.token.value,
        pin,
      },
    };
  } catch (error) {
    return { error: (error as Error).message || "스트리머 추가에 실패했어요." };
  }
}

export type DeleteStreamerState = { ok?: boolean; error?: string; slug?: string };

// 스트리머 완전 삭제(되돌릴 수 없음 — cascade 로 토큰/수집기록/시트 데이터 전부 삭제).
// 실수 방지: 확인칸에 슬러그를 똑같이 입력해야만 실행된다.
export async function deleteStreamerAction(
  _prev: DeleteStreamerState,
  formData: FormData,
): Promise<DeleteStreamerState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
    if (!slug) return { error: "슬러그가 없어요." };
    if (confirm !== slug) return { error: `확인 문구가 달라요. "${slug}" 를 똑같이 입력해야 삭제돼요.` };
    if (!(await streamerExists(slug))) return { error: `없는 슬러그예요(/${slug}).` };
    await deleteStreamer(slug);
    revalidatePath("/admin");
    return { ok: true, slug };
  } catch (error) {
    return { error: (error as Error).message || "삭제에 실패했어요." };
  }
}

export type ResetDataState = {
  ok?: boolean;
  error?: string;
  slug?: string;
  mode?: "preview" | "execute";
  scope?: ResetScope;
  items?: ResetCount[];
  total?: number;
};

function scopeFromForm(formData: FormData): ResetScope {
  const on = (name: string) => formData.get(name) === "on";
  return {
    roulette: on("scope_roulette"),
    donations: on("scope_donations"),
    catalogs: on("scope_catalogs"),
    coupons: on("scope_coupons"),
    screenState: on("scope_screen"),
    pins: on("scope_pins"),
  };
}

// 스트리머 데이터 초기화(계정·테마·확장 토큰은 유지, 되돌릴 수 없음).
// 미리보기(건수 확인) → 슬러그 타이핑 확인 → 실행 2단계. mode 는 누른 버튼이 정한다.
export async function resetStreamerDataAction(
  _prev: ResetDataState,
  formData: FormData,
): Promise<ResetDataState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const mode = formData.get("mode") === "execute" ? "execute" : "preview";
    const scope = scopeFromForm(formData);
    if (!slug) return { error: "슬러그가 없어요." };
    if (!hasResetScope(scope)) return { error: "지울 항목을 하나 이상 선택하세요." };
    if (!(await streamerExists(slug))) return { error: `없는 슬러그예요(/${slug}).` };
    if (mode === "preview") {
      const result = await previewStreamerReset(slug, scope);
      return { ok: true, mode, slug, scope, items: result.items, total: result.total };
    }
    const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();
    if (confirm !== slug) {
      return { error: `확인 문구가 달라요. "${slug}" 를 똑같이 입력해야 실행돼요.` };
    }
    const result = await executeStreamerReset(slug, scope);
    revalidatePath("/admin");
    return { ok: true, mode, slug, scope, items: result.items, total: result.total };
  } catch (error) {
    return { error: (error as Error).message || "데이터 초기화에 실패했어요." };
  }
}

export type ResetPinState = { ok?: boolean; error?: string; slug?: string; pin?: string };

// 기존 스트리머의 시트 비밀번호를 랜덤 4자리로 강제 리셋. 8031 공용키에서 끌어내는 용도 겸.
export async function resetStreamerPinAction(
  _prev: ResetPinState,
  formData: FormData,
): Promise<ResetPinState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    if (!slug) return { error: "슬러그가 없어요." };
    if (!(await streamerExists(slug))) return { error: `없는 슬러그예요(/${slug}).` };
    const pin = randomPin();
    await setSheetAdminPinHash(slug, adminTokenHash(pin));
    return { ok: true, slug, pin };
  } catch (error) {
    return { error: (error as Error).message || "비번 리셋에 실패했어요." };
  }
}
