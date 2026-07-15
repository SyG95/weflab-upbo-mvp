import { resolveExtensionToken } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { ingestDonationCapture, type DonationCapture } from "@/lib/donationEvents";

export const runtime = "nodejs";

// 후원집계 전용 수집 통로. donation_events 에만 기록하며
// 업보 파이프라인(reconcile/정가/배수/upbo_entries)은 호출하지 않는다.
// 반복 전송은 dedup_key upsert 로 흡수되므로 preview/apply 구분이 없다.
export async function POST(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    const capture = await readJson<DonationCapture>(request);
    const summary = await ingestDonationCapture(streamer, capture);
    return jsonOk({ ok: true, ...summary });
  } catch (error) {
    return jsonError(error);
  }
}
