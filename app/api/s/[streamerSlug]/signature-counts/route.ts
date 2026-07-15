import { getStreamerRowBySlug, setSignatureCounts } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 시그니처 후원 갯수 설정 저장. 이 갯수와 일치하는 후원은 다음 반영부터 정가기록으로 남는다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ counts?: unknown }>(request);
    if (!Array.isArray(body.counts) || body.counts.length > 100) {
      const error = new Error("counts must be an array (max 100)");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const counts: number[] = [];
    for (const value of body.counts) {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 100_000_000) {
        const error = new Error(`invalid signature count: ${String(value)}`);
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      counts.push(n);
    }

    const saved = await setSignatureCounts(streamer, counts);
    return jsonOk({ ok: true, signatureCounts: saved });
  } catch (error) {
    return jsonError(error);
  }
}
