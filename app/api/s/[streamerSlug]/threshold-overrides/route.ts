import { getStreamerRowBySlug, setThresholdOverrides } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_OVERRIDE_KEYS = 200;

// 룰렛표(금액대)별 기준확률 예외 저장. 키 = 금액대 라벨(예: "33"), 값 = 기준 %(0~100).
// 전역 기준확률(settings)은 그대로 두고 예외만 전체 교체 방식으로 기록한다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ overrides?: unknown }>(request);
    if (!body.overrides || typeof body.overrides !== "object" || Array.isArray(body.overrides)) {
      const error = new Error("overrides must be an object");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const entries = Object.entries(body.overrides as Record<string, unknown>);
    if (entries.length > MAX_OVERRIDE_KEYS) {
      const error = new Error(`too many override keys (max ${MAX_OVERRIDE_KEYS})`);
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    for (const [key, value] of entries) {
      const pct = Number(value);
      if (!key.trim() || key.length > 40 || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        const error = new Error(`invalid override entry: ${key}`);
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
    }

    const saved = await setThresholdOverrides(streamer, body.overrides);
    return jsonOk({ ok: true, thresholdOverrides: saved });
  } catch (error) {
    return jsonError(error);
  }
}
