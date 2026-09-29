import {
  createManualEntry,
  deleteManualEntry,
  getStreamerRowBySlug,
  updateManualEntryCount,
  updateManualEntryDate,
  updateManualEntryTab,
  updateManualEntriesTab,
} from "@/lib/upboSupabase";
import { parseDonateTimeMs } from "@/lib/api";
import { isManualDonateTimeText } from "@/lib/manualEntryDate";
import { cleanManualTabHint, type ManualTabHint } from "@/lib/manualTabHint";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";
// 여러 건 탭 바꾸기는 행 수만큼 PATCH 를 보낸다(동시 5개) — 기본 함수 시한(10~15초)에 걸리지 않게 여유를 둔다.
export const maxDuration = 60;

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

// 탭 힌트 정리: 없음/null = 힌트 없음(상품이 탭을 정함 / 표에 없는 상품은 "표에 없음"). 모양이 아니면 400.
function cleanTabHintInput(raw: unknown): ManualTabHint | null {
  if (raw === undefined || raw === null) return null;
  const hint = cleanManualTabHint(raw);
  if (!hint) throw badRequest("탭 선택값이 올바르지 않아요. 탭을 다시 골라 주세요.");
  return hint;
}

// 여러 건 탭 바꾸기 한 번에 받을 수 있는 최대 건수. 100 uuid ≈ 3.7KB 라 읽기 요청 URL(8KB 한도)에 여유가 있다.
// 화면은 이 크기로 나눠 보내므로(ManualEntryManager BULK_CHUNK) "전체 선택"이 100건을 넘어도 막히지 않는다.
const BULK_TAB_MAX = 100;

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
      tabHint?: unknown;
    }>(request);

    const fanId = String(body.fanId ?? "").trim();
    const itemName = String(body.itemName ?? "").trim();
    if (!fanId) throw badRequest("계정ID를 적어 주세요.");
    if (!itemName) throw badRequest("상품을 골라 주세요.");
    const donateTimeText = cleanDonateTimeText(body.donateTimeText);
    const catalogVersion = typeof body.catalogVersion === "number" ? body.catalogVersion : null;
    // 탭 힌트(2026-09-29, 루빗 건의): 표에서 고른 상품도 스트리머가 탭을 정할 수 있다. 팬 화면은 힌트가 있으면
    // 힌트를 먼저 본다(resolveHoldingTabRid). 없으면 지금처럼 상품이 탭을 정한다. 정가는 UI 에 선택지가 없다.
    const tabHint = cleanTabHintInput(body.tabHint);

    await createManualEntry(streamer, {
      fanId,
      fanNickname: String(body.fanNickname ?? "").trim(),
      itemName,
      probability: Number(body.probability) || 0,
      amountRangeLabel: typeof body.amountRangeLabel === "string" ? body.amountRangeLabel : "",
      catalogGroupIndex:
        typeof body.catalogGroupIndex === "number" ? body.catalogGroupIndex : null,
      catalogVersion,
      count: Number(body.count) || 1,
      donateTimeText,
      tabHint,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// 수동기록 수정: {id, count} = 개수, {id, donateTimeText} = 후원 날짜(""=지우기),
// {id, tabHint} = 탭(null = 힌트 지움 → 상품이 정한 탭). 여러 개가 같이 오면 각각 처리(검증은 전부 먼저).
// {ids: [...], tabHint} = 여러 건 탭을 한 번에(2026-09-29). 정가 줄이 섞여 와도 힌트는 저장만 되고 팬 화면은 정가 탭 고정.
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{
      id?: string;
      ids?: unknown;
      count?: number;
      donateTimeText?: string;
      tabHint?: unknown;
    }>(request);

    if (body.ids !== undefined) {
      if (!Array.isArray(body.ids) || body.ids.length === 0) throw badRequest("ids 가 비어 있어요.");
      if (body.ids.length > BULK_TAB_MAX) throw badRequest(`한 번에 ${BULK_TAB_MAX}건까지만 바꿀 수 있어요.`);
      if (body.tabHint === undefined) throw badRequest("tabHint 가 필요합니다.");
      const ids = [...new Set(body.ids.map((v) => String(v ?? "").trim()).filter(Boolean))];
      if (ids.length === 0) throw badRequest("ids 가 비어 있어요.");
      const hint = cleanTabHintInput(body.tabHint);
      const updated = await updateManualEntriesTab(streamer, ids, hint);
      return jsonOk({ ok: true, updated });
    }

    const id = String(body.id ?? "").trim();
    if (!id) throw badRequest("id가 필요합니다.");
    const hasCount = body.count !== undefined;
    const hasDate = body.donateTimeText !== undefined;
    const hasTab = body.tabHint !== undefined;
    if (!hasCount && !hasDate && !hasTab) throw badRequest("count, donateTimeText 또는 tabHint 가 필요합니다.");
    // 검증을 먼저 전부 끝낸 뒤에 쓴다 — 날짜·탭이 불량인데 개수만 바뀌어 있는 반쪽 반영을 막는다.
    const nextDate = hasDate ? cleanDonateTimeText(body.donateTimeText) : null;
    const nextTab = hasTab ? cleanTabHintInput(body.tabHint) : null;
    if (hasCount) await updateManualEntryCount(streamer, id, Number(body.count) || 1);
    if (nextDate !== null) await updateManualEntryDate(streamer, id, nextDate);
    if (hasTab) await updateManualEntryTab(streamer, id, nextTab);
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
