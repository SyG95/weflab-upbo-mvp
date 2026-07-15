import { getStreamerRowBySlug, saveViewerNote, setViewerNoteImages } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{
      fanId?: string;
      fanNickname?: string;
      noteText?: string;
      noteImages?: string[];
    }>(request);
    if (!body.fanId) throw new Error("fanId is required");
    const note = await saveViewerNote(streamerSlug, {
      fanId: body.fanId,
      fanNickname: body.fanNickname,
      noteText: body.noteText,
    });
    // 첨부 이미지는 텍스트 메모와 별도 오버레이에 저장한다(스키마 변경 없음).
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const noteImages = await setViewerNoteImages(streamer, body.fanId, body.noteImages ?? []);
    return jsonOk({ ok: true, note: { ...note, noteImages } });
  } catch (error) {
    return jsonError(error);
  }
}
