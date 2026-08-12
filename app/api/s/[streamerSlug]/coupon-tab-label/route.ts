import { getStreamerRowBySlug, setCouponTabLabel } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 쿠폰 탭 이름(스트리머별, 표시 전용) 저장. 빈 값 = 기본 "쿠폰"으로 되돌리기.
// 인증·저장 문법은 fan-id-privacy 라우트와 동일(관리자 세션 + audit_logs 오버레이).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ label?: unknown }>(request);
    const saved = await setCouponTabLabel(streamer, body.label);
    return jsonOk({ ok: true, couponTabLabel: saved });
  } catch (error) {
    return jsonError(error);
  }
}
