import { getStreamerRowBySlug, setFanTabLabels } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 탭 이름(팬 화면 룰렛 탭 표시 이름) 저장. 룰렛 묶기(roulette-config)와 독립 레인 —
// 이름은 탭의 상품 지문에 매달린다(sy 확정 2026-07-08). 검증·정규화는 setFanTabLabels 에서 수행.
// 관리자 세션(시트 비밀번호)으로만 저장 가능. 스키마 변경 없음(audit_logs 오버레이 최신 1건).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ labels?: unknown }>(request);
    const saved = await setFanTabLabels(streamer, body.labels);
    return jsonOk({ ok: true, fanTabLabels: saved });
  } catch (error) {
    return jsonError(error);
  }
}
