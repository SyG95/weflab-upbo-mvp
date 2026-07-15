import { getStreamerRowBySlug, setFanRevealEnabled } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 룰렛 확률표 공개 "마스터 스위치" on/off. 개별 룰렛 공개는 roulette-config 의 revealed.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ enabled?: unknown }>(request);
    const saved = await setFanRevealEnabled(streamer, body.enabled === true);
    return jsonOk({ ok: true, fanRevealEnabled: saved });
  } catch (error) {
    return jsonError(error);
  }
}
