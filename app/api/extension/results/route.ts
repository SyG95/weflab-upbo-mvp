import { applyResultsForStreamer, previewResultsForStreamer, resolveExtensionToken } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import type { ResultCapture } from "@/lib/upboCore";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
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
