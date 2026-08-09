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

    const body = await readJson<{ counts?: unknown; details?: unknown; fanFixedTabMode?: unknown }>(request);
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

    // details = 갯수별 표시·유형 정보(구성품·이미지·유형·기간, 선택). 형태만 여기서 거르고
    // 내용 검증(갯수 매칭·글자수·이미지 URL 신뢰·유형/날짜 형식)은 setSignatureCounts 가 한다.
    let details: Record<string, Record<string, unknown>> | undefined;
    if (body.details !== undefined) {
      if (typeof body.details !== "object" || body.details === null || Array.isArray(body.details)) {
        const error = new Error("details must be an object keyed by count");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      if (Object.keys(body.details).length > 100) {
        const error = new Error("too many detail entries (max 100)");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      details = body.details as Record<string, Record<string, unknown>>;
    }

    const saved = await setSignatureCounts(streamer, counts, details, body.fanFixedTabMode);
    return jsonOk({
      ok: true,
      signatureCounts: saved.counts,
      signatureDetails: saved.details,
      fanFixedTabMode: saved.fanFixedTabMode,
    });
  } catch (error) {
    return jsonError(error);
  }
}
