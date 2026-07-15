import { applyResultsForStreamer, previewResultsForStreamer, resolveExtensionToken } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import type { ResultCapture } from "@/lib/upboCore";

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
    const capture = await readJson<ResultCapture>(request);
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "preview";
    const result = mode === "apply"
      ? await applyResultsForStreamer(streamer, capture)
      : await previewResultsForStreamer(streamer, capture);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
