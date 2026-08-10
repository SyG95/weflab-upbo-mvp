import { getStreamerRowBySlug, setFanIdHidden } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 계정ID 숨기기 on/off(켜면 팬 화면 표에서 계정ID 열 제거). 관리자 화면·검색은 원문 유지.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ enabled?: unknown }>(request);
    const saved = await setFanIdHidden(streamer, body.enabled === true);
    return jsonOk({ ok: true, fanIdHidden: saved });
  } catch (error) {
    return jsonError(error);
  }
}
