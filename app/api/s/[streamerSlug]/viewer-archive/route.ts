import { getStreamerRowBySlug, setViewerArchived } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 배송완료 시청자 보관(숨김)/복구. 물리 삭제가 아니라 화면 숨김 처리다(원본 불변).
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ fanIds?: unknown; archived?: unknown }>(request);
    if (!Array.isArray(body.fanIds) || body.fanIds.length === 0 || body.fanIds.length > 500) {
      const error = new Error("fanIds must be a non-empty array (max 500)");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    if (!body.fanIds.every((f) => typeof f === "string" && f.trim())) {
      const error = new Error("fanIds must be non-empty strings");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const saved = await setViewerArchived(streamer, body.fanIds as string[], body.archived === true);
    return jsonOk({ ok: true, viewerArchive: saved });
  } catch (error) {
    return jsonError(error);
  }
}
