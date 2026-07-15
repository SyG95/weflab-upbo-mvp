import { getStreamerRowBySlug, setFanDeliveryReflect } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { normalizeFanDeliveryReflect } from "@/lib/api";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 배송 반영 방식 저장(스트리머별 오버레이). off/remaining/mark.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ deliveryReflect?: unknown }>(request);
    const mode = normalizeFanDeliveryReflect(body.deliveryReflect);
    const saved = await setFanDeliveryReflect(streamer, mode);
    return jsonOk({ ok: true, fanDeliveryReflect: saved });
  } catch (error) {
    return jsonError(error);
  }
}
