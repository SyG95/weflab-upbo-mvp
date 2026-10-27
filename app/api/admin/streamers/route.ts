import { requireAdminApi } from "@/lib/adminApiAuth";
import { upsertStreamer } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";

export const runtime = "nodejs";

type CreateStreamerBody = {
  slug?: string;
  streamerSlug?: string;
  displayName?: string;
  thresholdPercent?: number;
};

export async function POST(request: Request) {
  try {
    await requireAdminApi(request);
    const body = await readJson<CreateStreamerBody>(request);
    const slug = body.slug || body.streamerSlug;
    if (!slug) throw new Error("slug is required");
    const streamer = await upsertStreamer({
      slug,
      displayName: body.displayName,
      thresholdPercent: body.thresholdPercent,
    });
    return jsonOk({ ok: true, streamer });
  } catch (error) {
    return jsonError(error);
  }
}
