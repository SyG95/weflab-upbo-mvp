import { setStreamerSettings, ThresholdHistoryWriteError } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ thresholdPercent?: number }>(request);
    const settings = await setStreamerSettings(streamerSlug, body);
    return jsonOk({ ok: true, settings });
  } catch (error) {
    // 기준 값은 저장됐는데 변경 기록(이력)만 못 남긴 경우 — 성공으로 답하지 않고 다시 저장하도록 알린다.
    if (error instanceof ThresholdHistoryWriteError) {
      return jsonOk(
        {
          ok: false,
          code: error.code,
          settings: error.settings,
          error: "기준은 저장됐지만 변경 기록을 못 남겼어요. 한 번 더 저장해 주세요.",
        },
        503,
      );
    }
    return jsonError(error);
  }
}
