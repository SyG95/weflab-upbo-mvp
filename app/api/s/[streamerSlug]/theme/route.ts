import { getStreamerRowBySlug, setStreamerTheme } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 스트리머가 자기 업보시트 테마를 직접 고른다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{ theme?: string }>(request);
    const settings = await setStreamerTheme(streamer, body.theme ?? "");
    return jsonOk({ ok: true, settings });
  } catch (error) {
    return jsonError(error);
  }
}
