import { resolveExtensionToken, saveCatalogForStreamer } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import type { CatalogCapture } from "@/lib/upboCore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    const capture = await readJson<CatalogCapture>(request);
    const catalog = await saveCatalogForStreamer(streamer, capture);
    return jsonOk({ ok: true, streamerSlug: streamer.slug, catalog });
  } catch (error) {
    return jsonError(error);
  }
}
