import { getStreamerRowBySlug, setFanLayout } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 블록 배치(포스터/확률표/공지 × 슬롯) 저장. 검증은 normalizeFanLayout 에서 수행.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ layout?: unknown }>(request);
    const saved = await setFanLayout(streamer, body.layout);
    return jsonOk({ ok: true, fanLayout: saved });
  } catch (error) {
    return jsonError(error);
  }
}
