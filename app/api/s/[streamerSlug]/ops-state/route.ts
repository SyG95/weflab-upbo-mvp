import { getOperatorState } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 시청자 메모(viewerNotes)는 관리자 전용 — 배송지 등 개인정보가 담길 수 있어
// 조회도 관리자 로그인 세션이 있어야 한다. (유일한 사용처가 관리자 배송관리 화면)
export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const state = await getOperatorState(streamerSlug);
    return jsonOk({ ok: true, ...state });
  } catch (error) {
    return jsonError(error);
  }
}
