import { resolveExtensionToken, saveCatalogForStreamer } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import type { CatalogCapture } from "@/lib/upboCore";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    if (streamer.slug !== streamerSlug) {
      const error = new Error("extension token does not match streamer slug");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }
    const capture = await readJson<CatalogCapture>(request);
    const catalog = await saveCatalogForStreamer(streamer, capture);
    return jsonOk({ ok: true, streamerSlug: streamer.slug, catalog });
  } catch (error) {
    return jsonError(error);
  }
}
