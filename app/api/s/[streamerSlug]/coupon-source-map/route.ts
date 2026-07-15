import { getStreamerRowBySlug, setCouponSourceMap } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 자동 적립 "연결"(매핑) 저장(2단계 조각 1 — 매핑 설정만, 적립 로직은 다음 조각).
// audit_logs(coupon_source_map_updated) 최신 1건으로 저장 — 스키마 변경 없음.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ map?: unknown }>(request);
    if (!Array.isArray(body.map) || body.map.length > 30) {
      const error = new Error("map must be an array (max 30)");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const saved = await setCouponSourceMap(streamer, body.map);
    return jsonOk({ ok: true, map: saved });
  } catch (error) {
    return jsonError(error);
  }
}
