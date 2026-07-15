import { getStreamerRowBySlug } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireDonationAdmin } from "@/lib/donationAdminAuth";
import { donationSummaryForStreamer, normalizeAmounts } from "@/lib/donationEvents";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// ISO 문자열만 통과시키고 나머지는 null (잘못된 값이 Supabase 쿼리에 닿지 않게).
function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// 후원집계 조회 — 전용 비밀번호 세션으로만 접근한다.
// donation_events 만 읽으며 업보 테이블은 조회하지 않는다.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireDonationAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const url = new URL(request.url);
    const summary = await donationSummaryForStreamer(streamer.id, {
      fromIso: isoOrNull(url.searchParams.get("from")),
      toIso: isoOrNull(url.searchParams.get("to")),
      // 룰렛 갯수 조건: "33,330" 형태. 세트(여러 값)=합산 집계, 없으면 전체.
      amounts: normalizeAmounts(url.searchParams.get("amounts") ?? ""),
      // 룰렛 탭: rouletteOnly=1 이면 룰렛이 돌아간 후원(has_roulette=true)만 집계.
      rouletteOnly: url.searchParams.get("rouletteOnly") === "1",
    });
    return jsonOk({ ok: true, ...summary });
  } catch (error) {
    return jsonError(error);
  }
}
