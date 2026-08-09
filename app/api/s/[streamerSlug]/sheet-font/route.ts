import { getStreamerRowBySlug, setSheetFont } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 시트 글씨체 저장. { fontKey: "" | sheetFonts 화이트리스트 키 }.
// 검증(화이트리스트 정규화)은 setSheetFont(normalizeSheetFont)에서 수행한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ fontKey?: unknown }>(request);
    const saved = await setSheetFont(streamer, body.fontKey);
    return jsonOk({ ok: true, fontKey: saved });
  } catch (error) {
    return jsonError(error);
  }
}
