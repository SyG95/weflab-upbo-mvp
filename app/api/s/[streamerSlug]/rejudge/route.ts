import {
  applyRejudgeForStreamer,
  getStreamerRowBySlug,
  previewRejudgeForStreamer,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 재판정: 저장된 원본을 현재 확률표로 다시 돌려, 기록됐어야 할 결과만 새로 넣는다.
// - 기본은 미리보기(dryRun). 실제 저장은 apply:true + confirm=<슬러그> 둘 다 있어야 한다
//   (데이터 초기화와 같은 확인 게이트).
// - 기존 기록은 절대 수정·삭제하지 않는다. 새로 넣는 것만 한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ apply?: unknown; confirm?: unknown }>(request);
    const wantsApply = body.apply === true;
    if (!wantsApply) {
      return jsonOk(await previewRejudgeForStreamer(streamer));
    }
    if (String(body.confirm ?? "") !== streamerSlug) {
      const error = new Error("confirm must equal the streamer slug");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    return jsonOk(await applyRejudgeForStreamer(streamer));
  } catch (error) {
    return jsonError(error);
  }
}
