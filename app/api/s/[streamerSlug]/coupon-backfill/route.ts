import { getStreamerRowBySlug, previewCouponBackfill, applyCouponBackfill } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 소급 적립(2단계 조각 3 — 과거 record 당첨을 연결된 쿠폰으로 소급).
// GET = 미리보기(저장 안 함), POST = 반영(실제 적립). 관리자 로그인 세션으로 인증한다.
// 기간은 datetime-local 문자열("YYYY-MM-DDTHH:MM", KST 로 해석). 미지정이면 전체 record 대상.

function cleanPeriodValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const url = new URL(request.url);
    const period = {
      from: cleanPeriodValue(url.searchParams.get("from")),
      to: cleanPeriodValue(url.searchParams.get("to")),
    };
    const preview = await previewCouponBackfill(streamer, period);
    return jsonOk({ ok: true, preview });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{ from?: unknown; to?: unknown }>(request);
    const period = { from: cleanPeriodValue(body.from), to: cleanPeriodValue(body.to) };
    const result = await applyCouponBackfill(streamer, period);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
