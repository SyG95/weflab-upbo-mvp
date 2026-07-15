import { setSpecialItemRule } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<{
      ruleKey?: string;
      status?: "candidate" | "confirmed" | "rejected";
      multiplier?: number;
    }>(request);
    if (!body.ruleKey) throw new Error("ruleKey is required");
    if (!body.status || !["candidate", "confirmed", "rejected"].includes(body.status)) {
      throw new Error("status must be candidate, confirmed, or rejected");
    }
    const rule = await setSpecialItemRule(streamerSlug, {
      ruleKey: body.ruleKey,
      status: body.status,
      multiplier: body.multiplier,
    });
    return jsonOk({ ok: true, rule });
  } catch (error) {
    return jsonError(error);
  }
}
