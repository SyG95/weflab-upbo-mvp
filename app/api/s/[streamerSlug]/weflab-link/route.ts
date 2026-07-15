import { getStreamerRowBySlug, setWeflabLinkInfo } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { isValidWeflabLink } from "@/lib/weflabPublicCatalog";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 위플랩 공개 링크 등록(저장만, 가져오기는 하지 않음). "지금 가져오기"는 별도 라우트(weflab-link/fetch).
// 관리자 세션으로만 저장 가능. 스키마 변경 없음(audit_logs 오버레이).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ url?: string }>(request);
    const url = String(body.url ?? "").trim();
    if (url && !isValidWeflabLink(url)) {
      const error = new Error("weflab.com/user/ 형식의 공개 링크만 등록할 수 있어요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const saved = await setWeflabLinkInfo(streamer, { url });
    return jsonOk({ ok: true, weflabLink: saved });
  } catch (error) {
    return jsonError(error);
  }
}
