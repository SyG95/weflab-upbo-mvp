import { getStreamerRowBySlug, setFixedPriceNote } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_NOTE_LENGTH = 2000;

// 정가기록 전용 메모 저장(배송관리에서 상품목록 수기 작성). 기록별 최신 1건이 현재 메모.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ entrySourceKey?: unknown; noteText?: unknown; images?: unknown }>(request);
    const entrySourceKey = typeof body.entrySourceKey === "string" ? body.entrySourceKey : "";
    if (!entrySourceKey.startsWith("fixed:") || entrySourceKey.length > 300) {
      const error = new Error("entrySourceKey must be a fixed-price record key");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const noteText = typeof body.noteText === "string" ? body.noteText.slice(0, MAX_NOTE_LENGTH) : "";
    const images = Array.isArray(body.images)
      ? body.images.filter((u): u is string => typeof u === "string")
      : [];

    const saved = await setFixedPriceNote(streamer, entrySourceKey, noteText, images);
    return jsonOk({ ok: true, fixedPriceNote: saved });
  } catch (error) {
    return jsonError(error);
  }
}
