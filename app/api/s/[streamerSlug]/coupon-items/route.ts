import { getStreamerRowBySlug, setCouponItems } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 "종류" 정의 저장(스트리머별 커스텀 — 이름/키 목록, 최대 30개).
// audit_logs(coupon_items_updated) 최신 1건으로 저장 — 스키마 변경 없음.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ items?: unknown }>(request);
    if (!Array.isArray(body.items) || body.items.length > 30) {
      const error = new Error("items must be an array (max 30)");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const saved = await setCouponItems(streamer, body.items);
    return jsonOk({ ok: true, items: saved });
  } catch (error) {
    return jsonError(error);
  }
}
