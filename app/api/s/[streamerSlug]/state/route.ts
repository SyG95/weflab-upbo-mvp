import { getStreamerState } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    const state = await getStreamerState(streamerSlug);
    // 정가 메모(fixedPriceNotes)는 관리자 전용 수기 메모(이미지 포함, 개인정보 담길 수 있음)라
    // 공개 state 응답에서 제외한다. 관리자 화면은 getStreamerState를 서버에서 직접 읽어 영향 없음.
    const { fixedPriceNotes, ...publicState } = state;
    void fixedPriceNotes;
    return jsonOk(publicState);
  } catch (error) {
    return jsonError(error);
  }
}
