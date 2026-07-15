import { saveDeliveryProgress } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

type DeliveryProgressPayload = {
  items?: Array<{
    fanId?: string;
    fanNickname?: string;
    itemKey?: string;
    itemName?: string;
    probability?: number;
    amountRangeLabel?: string;
    processedCount?: number;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<DeliveryProgressPayload>(request);
    const items = (body.items || []).map((item) => ({
      fanId: String(item.fanId || ""),
      fanNickname: item.fanNickname,
      itemKey: String(item.itemKey || ""),
      itemName: String(item.itemName || ""),
      probability: item.probability,
      amountRangeLabel: item.amountRangeLabel,
      processedCount: Number(item.processedCount || 0),
    }));
    const result = await saveDeliveryProgress(streamerSlug, { items });
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
