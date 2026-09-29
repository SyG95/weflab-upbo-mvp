import { NextResponse } from "next/server";
import { getCouponStateBySlug, mergeCouponViewerIntoAccount } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 시청자 합치기 — 닉네임만 있는 잔액 줄에 계정 ID를 붙여 그 ID 줄로 합친다.
// body: { nickname: string(닉네임 줄의 viewer_key), accountId: string }. 관리자 로그인 세션으로 인증한다.
// 잔액 이동은 coupon_events 에 조정(adjust) 2건으로 남고, 닉네임 줄은 지워진다(이력은 유지).
// 실패해도 최신 잔액·이력을 함께 돌려줘 화면이 낡은 숫자로 재시도하지 않게 한다(부분 실패 대비).
export async function POST(request: Request, context: RouteContext) {
  let streamerSlug = "";
  try {
    ({ streamerSlug } = await context.params);
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ nickname?: unknown; accountId?: unknown }>(request);
    const nickname = typeof body.nickname === "string" ? body.nickname : "";
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const state = await mergeCouponViewerIntoAccount(streamerSlug, nickname, accountId);
    return jsonOk({ ok: true, ...state });
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = err.status && err.status >= 400 ? err.status : 400;
    // 인증 실패(401/403)엔 상태를 실어 보내지 않는다.
    if (!streamerSlug || status === 401 || status === 403) return jsonError(error);
    try {
      const fresh = await getCouponStateBySlug(streamerSlug);
      return NextResponse.json(
        { ok: false, error: err.message || "unknown error", balances: fresh.balances, events: fresh.events, items: fresh.items },
        { status },
      );
    } catch {
      return jsonError(error);
    }
  }
}
