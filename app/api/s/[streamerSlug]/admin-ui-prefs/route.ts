import { getStreamerRowBySlug, setAdminUiPrefs } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 관리자 상위탭 순서/이름 커스텀 저장. 검증·정규화는 setAdminUiPrefs(normalizeAdminUiPrefs)에서 수행.
// 관리자 세션(시트 비밀번호)으로만 저장 가능. 스키마 변경 없음(audit_logs 오버레이).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ prefs?: unknown }>(request);
    const saved = await setAdminUiPrefs(streamer, body.prefs);
    return jsonOk({ ok: true, adminUiPrefs: saved });
  } catch (error) {
    return jsonError(error);
  }
}
