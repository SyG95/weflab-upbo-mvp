import { setDeliveryPeriodConfig } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 배송관리 "묶음(기간) 보기" 설정 저장. { config: { mode, cutoffs } }.
// 표시 전용 설정 — 장부·판정에 영향 없음. 검증(모드·날짜·상한)은 sanitizeDeliveryPeriodConfig 에서.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ config?: unknown }>(request);
    const saved = await setDeliveryPeriodConfig(streamerSlug, body.config);
    return jsonOk({ ok: true, deliveryPeriod: saved });
  } catch (error) {
    return jsonError(error);
  }
}
