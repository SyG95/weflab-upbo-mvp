import { getStreamerRowBySlug, setProductColors } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 상품별 색상(팬 화면 하이라이트) 저장. { colors: { 상품명: "c1"~"c20" } }.
// 실제 검증(팔레트 id·개수 제한)은 setProductColors(sanitizeProductColors)에서 수행한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ colors?: unknown }>(request);
    const colors =
      body.colors && typeof body.colors === "object"
        ? (body.colors as Record<string, string>)
        : {};
    const saved = await setProductColors(streamer, colors);
    return jsonOk({ ok: true, productColors: saved });
  } catch (error) {
    return jsonError(error);
  }
}
