import { setDeliveryAssignments } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 시트 보기(B뷰) 배정 메모 저장 — 어느 후원 건을 완료로 쳤는지(관리자 전용 오버레이).
// 수량 장부(delivery_progress)가 진실이고 이 배열은 표시 힌트다. 조회는 ops-state 에 실려 나간다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ assignments?: unknown }>(request);
    const result = await setDeliveryAssignments(streamerSlug, body.assignments);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
