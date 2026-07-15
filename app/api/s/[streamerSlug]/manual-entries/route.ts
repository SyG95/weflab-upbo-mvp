import {
  createManualEntry,
  deleteManualEntry,
  getStreamerRowBySlug,
  updateManualEntryCount,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

function badRequest(message: string): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  return error;
}

// 수동기록 추가. 관리자 로그인 세션 필요. 저장 실체는 upbo_entries(source_key manual:...).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{
      fanId?: string;
      fanNickname?: string;
      itemName?: string;
      probability?: number;
      amountRangeLabel?: string;
      catalogGroupIndex?: number | null;
      catalogVersion?: number | null;
      count?: number;
    }>(request);

    const fanId = String(body.fanId ?? "").trim();
    const itemName = String(body.itemName ?? "").trim();
    if (!fanId) throw badRequest("계정ID를 적어 주세요.");
    if (!itemName) throw badRequest("상품을 골라 주세요.");

    await createManualEntry(streamer, {
      fanId,
      fanNickname: String(body.fanNickname ?? "").trim(),
      itemName,
      probability: Number(body.probability) || 0,
      amountRangeLabel: typeof body.amountRangeLabel === "string" ? body.amountRangeLabel : "",
      catalogGroupIndex:
        typeof body.catalogGroupIndex === "number" ? body.catalogGroupIndex : null,
      catalogVersion: typeof body.catalogVersion === "number" ? body.catalogVersion : null,
      count: Number(body.count) || 1,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// 수동기록 개수 수정.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{ id?: string; count?: number }>(request);
    const id = String(body.id ?? "").trim();
    if (!id) throw badRequest("id가 필요합니다.");
    await updateManualEntryCount(streamer, id, Number(body.count) || 1);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// 수동기록 삭제(행 제거). manual: 기록만 삭제됨.
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw badRequest("id가 필요합니다.");
    await deleteManualEntry(streamer, id);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
