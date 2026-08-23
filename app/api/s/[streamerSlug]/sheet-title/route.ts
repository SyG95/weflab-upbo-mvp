import { getStreamerRowBySlug, setSheetTitle } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 대문 제목(스트리머별, 표시 전용) 저장. 빈 값 = 기본 "{이름} 업보시트"로 되돌리기.
// 인증·저장 문법은 coupon-tab-label 라우트와 동일(관리자 세션 + audit_logs 오버레이).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ title?: unknown }>(request);
    const saved = await setSheetTitle(streamer, body.title);
    return jsonOk({ ok: true, sheetTitle: saved });
  } catch (error) {
    return jsonError(error);
  }
}
