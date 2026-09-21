import { getStreamerRowBySlug, setFanAxisPrefs } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 구분 축(언제=월 레일 / 어느 룰렛=룰렛 탭) 켜고 끄기(스트리머별 오버레이, 2026-09-21).
// body { axis: { monthRail, rouletteTabs } } — 불리언이 아닌 항목은 기본값(켬)으로 정규화된다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ axis?: unknown }>(request);
    const saved = await setFanAxisPrefs(streamer, body.axis);
    return jsonOk({ ok: true, fanAxisPrefs: saved });
  } catch (error) {
    return jsonError(error);
  }
}
