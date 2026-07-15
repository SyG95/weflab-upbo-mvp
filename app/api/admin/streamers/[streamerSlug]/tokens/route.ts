import { assertAdminToken, createExtensionToken } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertAdminToken(request.headers.get("authorization"));
    const { streamerSlug } = await context.params;
    const body = await readJson<{ label?: string }>(request);
    const result = await createExtensionToken(streamerSlug, body.label || "");
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
