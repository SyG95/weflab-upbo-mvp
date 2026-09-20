import {
  createManualEntry,
  deleteManualEntry,
  getStreamerRowBySlug,
  updateManualEntryCount,
  updateManualEntryDate,
} from "@/lib/upboSupabase";
import { parseDonateTimeMs } from "@/lib/api";
import { isManualDonateTimeText } from "@/lib/manualEntryDate";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

function badRequest(message: string): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  return error;
}

// 후원 날짜 입력값 정리: 없음/"" = 날짜 모름(옛 수동기록과 동일), 아니면 "YYYY-MM-DD HH:MM"(KST) 만 허용.
// 아직 오지 않은 시각은 막는다(달력 max 는 UI 에만 걸려서 직접 호출·타이핑으로 새어 들어온다).
const FUTURE_SKEW_MS = 10 * 60_000;
function cleanDonateTimeText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw badRequest("후원 날짜 형식이 올바르지 않아요. (예: 2026-09-01 12:00)");
  const text = raw.trim();
  if (!isManualDonateTimeText(text)) throw badRequest("후원 날짜 형식이 올바르지 않아요. (예: 2026-09-01 12:00)");
  const ms = parseDonateTimeMs(text);
  if (ms !== null && ms > Date.now() + FUTURE_SKEW_MS) {
    throw badRequest("후원 날짜는 오늘까지만 넣을 수 있어요.");
  }
  return text;
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
      donateTimeText?: string;
    }>(request);

    const fanId = String(body.fanId ?? "").trim();
    const itemName = String(body.itemName ?? "").trim();
    if (!fanId) throw badRequest("계정ID를 적어 주세요.");
    if (!itemName) throw badRequest("상품을 골라 주세요.");
    const donateTimeText = cleanDonateTimeText(body.donateTimeText);

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
      donateTimeText,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// 수동기록 수정: {id, count} = 개수(기존 그대로), {id, donateTimeText} = 후원 날짜(""=지우기). 둘 다 오면 각각 처리.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{ id?: string; count?: number; donateTimeText?: string }>(request);
    const id = String(body.id ?? "").trim();
    if (!id) throw badRequest("id가 필요합니다.");
    const hasCount = body.count !== undefined;
    const hasDate = body.donateTimeText !== undefined;
    if (!hasCount && !hasDate) throw badRequest("count 또는 donateTimeText 가 필요합니다.");
    // 검증을 먼저 전부 끝낸 뒤에 쓴다 — 날짜가 불량인데 개수만 바뀌어 있는 반쪽 반영을 막는다.
    const nextDate = hasDate ? cleanDonateTimeText(body.donateTimeText) : null;
    if (hasCount) await updateManualEntryCount(streamer, id, Number(body.count) || 1);
    if (nextDate !== null) await updateManualEntryDate(streamer, id, nextDate);
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
