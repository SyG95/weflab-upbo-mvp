import { getStreamerRowBySlug, setFanRevealConfig } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 팬 화면 룰렛 확률표 공개 "마스터 스위치" on/off + 공개 범위(target=업보 대상 품목만 / all=전체 확률표, 2026-09-29).
// body 에 온 키만 바꾸고 나머지는 최신 값을 유지한다. 개별 룰렛 공개는 roulette-config 의 revealed.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ enabled?: unknown; scope?: unknown }>(request);
    const patch: { enabled?: boolean; scope?: "target" | "all" } = {};
    if (body.enabled !== undefined) patch.enabled = body.enabled === true;
    if (body.scope !== undefined) {
      if (body.scope !== "target" && body.scope !== "all") {
        const error = new Error("scope 는 target 또는 all 이어야 해요.");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      patch.scope = body.scope;
    }
    if (patch.enabled === undefined && patch.scope === undefined) {
      const error = new Error("enabled 또는 scope 가 필요합니다.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const saved = await setFanRevealConfig(streamer, patch);
    return jsonOk({ ok: true, fanRevealEnabled: saved.enabled, fanRevealScope: saved.scope });
  } catch (error) {
    return jsonError(error);
  }
}
