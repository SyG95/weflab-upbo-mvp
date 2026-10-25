import {
  getItemEvents,
  getStreamerRowBySlug,
  recordItemEvent,
  setTransferOwnerId,
  type RecordItemEventInput,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

type ItemEventPayload = {
  upboEntryId?: string;
  eventType?: string;
  actorType?: string;
  actorId?: string;
  reason?: string;
  memo?: string;
  newOwnerName?: string;
  newOwnerId?: string;
  newItemName?: string;
  newItemProbability?: number;
  newAmountRangeLabel?: string;
  quantityDelta?: number;
  // 되돌리기(admin_adjustment) 역연산 재료 — 있어야 보유 수량이 실제로 복구된다.
  revertOf?: {
    eventId?: string;
    kind?: string;
    quantity?: number;
    toOwnerId?: string;
    toOwnerName?: string;
    newItemName?: string;
  };
};

const VALID_REVERT_KINDS = new Set(["restore", "transfer_back", "exchange_back"]);

const VALID_EVENT_TYPES = new Set([
  "transfer", "exchange", "cancel", "void", "complete",
  "memo", "quantity_adjust", "admin_adjustment",
]);

const VALID_ACTOR_TYPES = new Set(["streamer", "operator", "system"]);

export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const body = await readJson<ItemEventPayload>(request);

    const upboEntryId = String(body.upboEntryId || "").trim();
    if (!upboEntryId) return jsonError(new Error("upboEntryId is required"));

    const eventType = String(body.eventType || "").trim();
    if (!VALID_EVENT_TYPES.has(eventType)) {
      return jsonError(new Error(`eventType must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`));
    }

    const actorType = body.actorType && VALID_ACTOR_TYPES.has(body.actorType)
      ? body.actorType
      : "operator";

    const input: RecordItemEventInput = {
      eventType: eventType as RecordItemEventInput["eventType"],
      actorType: actorType as RecordItemEventInput["actorType"],
      actorId: body.actorId,
      reason: body.reason,
      memo: body.memo,
      newOwnerName: body.newOwnerName,
      newOwnerId: body.newOwnerId,
      newItemName: body.newItemName,
      newItemProbability: body.newItemProbability !== undefined ? Number(body.newItemProbability) : undefined,
      newAmountRangeLabel: body.newAmountRangeLabel,
      quantityDelta: body.quantityDelta !== undefined ? Number(body.quantityDelta) : undefined,
    };

    if (
      eventType === "admin_adjustment" &&
      body.revertOf &&
      typeof body.revertOf === "object" &&
      typeof body.revertOf.kind === "string" &&
      VALID_REVERT_KINDS.has(body.revertOf.kind)
    ) {
      input.revertOf = {
        eventId: typeof body.revertOf.eventId === "string" ? body.revertOf.eventId : undefined,
        kind: body.revertOf.kind as "restore" | "transfer_back" | "exchange_back",
        quantity: body.revertOf.quantity !== undefined ? Number(body.revertOf.quantity) : undefined,
        toOwnerId: typeof body.revertOf.toOwnerId === "string" ? body.revertOf.toOwnerId : undefined,
        toOwnerName: typeof body.revertOf.toOwnerName === "string" ? body.revertOf.toOwnerName : undefined,
        newItemName: typeof body.revertOf.newItemName === "string" ? body.revertOf.newItemName : undefined,
      };
    }

    const { entry, itemEvents } = await recordItemEvent(streamerSlug, upboEntryId, input);
    return jsonOk({ ok: true, entry, itemEvents });
  } catch (error) {
    return jsonError(error);
  }
}

// 양도 기록에 빠진 계정ID 보정(닉네임만 적혀 같은 사람이 갈라진 경우 통합).
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const body = await readJson<{ eventId?: string; ownerId?: string }>(request);
    const eventId = String(body.eventId ?? "").trim();
    const ownerId = String(body.ownerId ?? "").trim();
    if (!eventId) return jsonError(new Error("eventId is required"));
    if (!ownerId) return jsonError(new Error("계정ID를 적어 주세요."));
    await setTransferOwnerId(streamer, eventId, ownerId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    // POST/PATCH 와 동일한 관리자 잠금. 이 GET 은 운영 이벤트(PIN 해시가 든 audit_logs 등)로
    // 번질 수 있는 service_role 조회라, 로그인 없이 열어 두지 않는다(2026-10-18 점검 critical).
    await requireSheetAdmin(streamerSlug);
    const url = new URL(request.url);
    const upboEntryId = url.searchParams.get("upboEntryId") || "";
    if (!upboEntryId) return jsonError(new Error("upboEntryId query param is required"));

    const events = await getItemEvents(streamerSlug, upboEntryId);
    return jsonOk({ ok: true, events });
  } catch (error) {
    return jsonError(error);
  }
}
