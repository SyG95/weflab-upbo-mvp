import { getStreamerRowBySlug, itemAliasesForStreamer, setItemAliases } from "@/lib/upboSupabase";
import { cleanAliasMap } from "@/lib/itemAlias";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 이름 연결표 저장(전체 교체). 원본·확률표는 건드리지 않는 오버레이다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ aliases?: unknown }>(request);
    if (!body.aliases || typeof body.aliases !== "object" || Array.isArray(body.aliases)) {
      const error = new Error("aliases must be an object");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const cleaned = cleanAliasMap(body.aliases);
    const saved = await setItemAliases(streamer, cleaned);
    return jsonOk({ ok: true, aliases: saved, count: Object.keys(saved).length });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    return jsonOk({ aliases: await itemAliasesForStreamer(streamer.id) });
  } catch (error) {
    return jsonError(error);
  }
}
