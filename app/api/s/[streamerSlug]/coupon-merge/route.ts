import { mergeCouponViewerIntoAccount } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 시청자 합치기 — 닉네임만 있는 잔액 줄에 계정 ID를 붙여 그 ID 줄로 합친다.
// body: { nickname: string, accountId: string }. 관리자 로그인 세션으로 인증한다.
// 잔액 이동은 coupon_events 에 조정(adjust) 2건으로 남고, 닉네임 줄은 지워진다(이력은 유지).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ nickname?: unknown; accountId?: unknown }>(request);
    const nickname = typeof body.nickname === "string" ? body.nickname : "";
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const state = await mergeCouponViewerIntoAccount(streamerSlug, nickname, accountId);
    return jsonOk({ ok: true, ...state });
  } catch (error) {
    return jsonError(error);
  }
}
