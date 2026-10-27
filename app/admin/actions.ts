"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ADMIN_COOKIE,
  adminAccessState,
  adminTokenHash,
  clientTag,
  consoleSessionValue,
  isDeployed,
  randomSheetPin,
} from "@/lib/adminAuth";
import {
  createExtensionToken,
  deleteStreamer,
  executeStreamerReset,
  getStreamerRowBySlug,
  hasResetScope,
  previewStreamerReset,
  renameStreamer,
  setExtensionConfig,
  setExtensionConfigForAll,
  setSheetAdminPinHash,
  upsertStreamer,
  type ResetCount,
  type ResetScope,
} from "@/lib/upboSupabase";
import type { ExtensionConfig } from "@/lib/extensionStatus";
import {
  beginMasterAttempt,
  lockedMessage,
  recordOperatorUnlock,
  recordUnlockSuccess,
  wrongPasswordMessage,
} from "@/lib/unlockThrottle";

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
  if (!password) return { error: "비밀번호를 입력해 주세요." };
  // 시도 제한: 콘솔은 마스터키 셈(요청한 곳별 15분 10회 + 전체 15분 100회, lib/unlockThrottle.ts).
  // 비밀번호를 보기 전에 이 시도를 먼저 센다. 누가 일부러 틀려도 그 IP 만 잠긴다.
  const tag = clientTag(await headers());
  let throttle;
  try {
    throttle = await beginMasterAttempt(tag);
  } catch {
    return { error: "잠시 후 다시 시도해 주세요." };
  }
  if (throttle.locked) return { error: lockedMessage(throttle.retryAfterSec) };
  if (adminTokenHash(password) !== adminTokenHash(token)) return { error: wrongPasswordMessage(throttle.remaining) };
  await recordUnlockSuccess("master", null, tag);
  const session = consoleSessionValue(token);
  if (!session) return { error: "서버 설정 문제로 세션을 만들 수 없습니다(SUPABASE_SERVICE_ROLE_KEY 확인)." };
  (await cookies()).set(ADMIN_COOKIE, session, {
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
    const pin = randomSheetPin();
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

export type RenameStreamerState = { ok?: boolean; error?: string; displayName?: string };

// 표시 이름 수정(콘솔 전용). 슬러그(주소)·비번·토큰·수집 연결은 그대로 두고
// 팬 시트 제목에 쓰는 이름(한글 가능)만 바꾼다.
export async function renameStreamerAction(
  _prev: RenameStreamerState,
  formData: FormData,
): Promise<RenameStreamerState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    const displayName = String(formData.get("displayName") ?? "").trim();
    if (!SLUG_RE.test(slug)) return { error: "잘못된 슬러그예요." };
    if (!displayName) return { error: "이름을 입력해 주세요." };
    if (displayName.length > 40) return { error: "이름은 40자 이내로 해주세요." };
    const streamer = await renameStreamer(slug, displayName);
    revalidatePath("/admin");
    revalidatePath(`/${slug}`);
    return { ok: true, displayName: streamer.displayName };
  } catch (error) {
    return { error: (error as Error).message || "이름 수정에 실패했어요." };
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
  // pins 범위를 지웠으면 새로 발급한 시트 관리자 비밀번호(1회 표시용).
  newPin?: string;
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
    // pins 범위는 개별 비번을 지운다. 예전엔 그러면 공용 PIN 으로 돌아갔다 → 지금은 새 랜덤 비번을 바로 발급.
    let newPin: string | undefined;
    if (scope.pins) {
      newPin = randomSheetPin();
      await setSheetAdminPinHash(slug, adminTokenHash(newPin));
    }
    revalidatePath("/admin");
    return { ok: true, mode, slug, scope, items: result.items, total: result.total, newPin };
  } catch (error) {
    return { error: (error as Error).message || "데이터 초기화에 실패했어요." };
  }
}

export type ResetPinState = { ok?: boolean; error?: string; slug?: string; pin?: string };

// 기존 스트리머의 시트 비밀번호를 랜덤 4자리로 강제 리셋(공용 PIN 을 쓰던 시트를 개별 비번으로 옮기는 용도 겸).
export async function resetStreamerPinAction(
  _prev: ResetPinState,
  formData: FormData,
): Promise<ResetPinState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    if (!slug) return { error: "슬러그가 없어요." };
    if (!(await streamerExists(slug))) return { error: `없는 슬러그예요(/${slug}).` };
    const pin = randomSheetPin();
    await setSheetAdminPinHash(slug, adminTokenHash(pin));
    return { ok: true, slug, pin };
  } catch (error) {
    return { error: (error as Error).message || "비번 리셋에 실패했어요." };
  }
}

export type UnlockThrottleState = { ok?: boolean; error?: string };

// 이 스트리머의 잠금 해제 시도 제한(시트·확프 페어링·후원집계, 하루 상한 포함)을 바로 푼다.
// 누가 일부러 틀려 스트리머가 잠겼을 때 운영자가 비밀번호를 바꾸지 않고 풀어 주는 용도.
export async function unlockStreamerThrottleAction(
  _prev: UnlockThrottleState,
  formData: FormData,
): Promise<UnlockThrottleState> {
  try {
    await assertConsoleAdmin();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return { error: "잘못된 슬러그예요." };
    const streamer = await getStreamerRowBySlug(slug);
    await recordOperatorUnlock(streamer.id);
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message || "잠금 풀기에 실패했어요." };
  }
}

// ── 확프 원격 스위치(수집 레인 1단계, 2026-10-12) ─────────────────────────
// 스트리머별·전체 되읽기 켜기/끄기 등. 저장은 audit_logs 이벤트(스키마 0), 확프는 다음 하트비트(≤5분)에 따른다.
// patch 로 바꿀 수 있는 키 = ExtensionConfig 전부(예: 오래 열린 탭 되읽기 끄기 { staleTabHours: 0 }, 주기 { staleSweepHours }).
// 화면이 보낸 patch 는 믿지 않는다 — 아는 키만, 타입·범위는 서버에서 정제(mergeExtensionConfig).

export type ExtensionConfigActionResult = { ok: boolean; error?: string; config?: ExtensionConfig; count?: number };

export async function setExtensionConfigAction(
  slug: string,
  patch: Partial<ExtensionConfig>,
): Promise<ExtensionConfigActionResult> {
  try {
    await assertConsoleAdmin();
    const clean = String(slug ?? "").trim().toLowerCase();
    if (!SLUG_RE.test(clean)) return { ok: false, error: "잘못된 슬러그예요." };
    const streamer = await getStreamerRowBySlug(clean);
    const config = await setExtensionConfig(streamer, patch ?? {});
    revalidatePath("/admin");
    return { ok: true, config };
  } catch (error) {
    return { ok: false, error: (error as Error).message || "확프 설정 저장에 실패했어요." };
  }
}

export async function setExtensionConfigForAllAction(
  patch: Partial<ExtensionConfig>,
): Promise<ExtensionConfigActionResult> {
  try {
    await assertConsoleAdmin();
    const count = await setExtensionConfigForAll(patch ?? {});
    revalidatePath("/admin");
    return { ok: true, count };
  } catch (error) {
    return { ok: false, error: (error as Error).message || "전체 확프 설정 저장에 실패했어요." };
  }
}
