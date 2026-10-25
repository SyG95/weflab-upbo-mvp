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

    const body = await readJson<{ apply?: unknown; confirm?: unknown; sourceKeys?: unknown }>(request);
    const wantsApply = body.apply === true;
    if (!wantsApply) {
      return jsonOk(await previewRejudgeForStreamer(streamer));
    }
    if (String(body.confirm ?? "") !== streamerSlug) {
      const error = new Error("confirm must equal the streamer slug");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    // sourceKeys = 미리보기에서 본 후보 키. 있으면 그 안의 것만 넣는다(없으면 예전처럼 지금 후보 전부).
    let previewKeys: string[] | undefined;
    if (body.sourceKeys !== undefined) {
      const keys = body.sourceKeys;
      if (!Array.isArray(keys) || keys.length > 50000 || keys.some((k) => typeof k !== "string" || k.length > 300)) {
        const error = new Error("sourceKeys must be an array of strings");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      previewKeys = keys as string[];
    }
    return jsonOk(await applyRejudgeForStreamer(streamer, { previewKeys }));
  } catch (error) {
    return jsonError(error);
  }
}
