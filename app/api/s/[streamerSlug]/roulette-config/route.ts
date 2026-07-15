import { getStreamerRowBySlug, setRouletteConfig } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import type { RouletteConfigEntry } from "@/lib/api";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 룰렛 관리(이름·사용/보관) 저장. 스트리머별 오버레이(audit_logs)에 최신 1건으로 덮어쓴다.
// 원본 catalog 는 건드리지 않는다(보관=숨김, 복구 가능). 관리자 로그인 세션으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ entries?: unknown }>(request);
    if (!Array.isArray(body.entries)) {
      const error = new Error("entries must be an array");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    if (body.entries.length > 500) {
      const error = new Error("too many entries");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    // 실제 정제(상품 지문/이름/보관 검증)는 setRouletteConfig(sanitizeRouletteConfig)에서 수행한다.
    const saved = await setRouletteConfig(streamer, body.entries as RouletteConfigEntry[]);
    return jsonOk({ ok: true, rouletteConfig: saved });
  } catch (error) {
    return jsonError(error);
  }
}
