import { setStreamerSettings } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{ thresholdPercent?: number }>(request);
    const settings = await setStreamerSettings(streamerSlug, body);
    return jsonOk({ ok: true, settings });
  } catch (error) {
    return jsonError(error);
  }
}
