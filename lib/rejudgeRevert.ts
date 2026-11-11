// ---------- 후원 시점 근사 다시판정 "넣기" 출처 표시·되돌리기 막힘 판정(관문 2) — 순수 ----------
//
// 넣기(lib/upboSupabase.ts applyApproxRejudgeForStreamer)는 넣기 **전에** 계획 장부(rejudge_approx_planned: runId + 넣을 기록 id,
// 결과 키는 안 넣음)를 쓰고, 기록마다 admin_note 에 출처를 짧게 남긴다(공개 /state 로 나가는 칸이라 JSON origin 만, F11).
// 계획 장부를 못 쓰면 아무것도 넣지 않으므로 "들어갔는데 장부가 없는" 기록이 생기지 않는다.
// 되돌리기는 실행(runId)별로 "계획 장부 id ∩ 실제로 있는 기록 ∩ admin_note runId" 만 대상으로 하고, 어긋나면 화면에 그대로 알린다.
// 되돌리기도 void 를 쓰기 전에 계획 장부(rejudge_approx_revert_planned)를 먼저 쓴다.
//
// 되돌리기는 물리 삭제가 아니라 void 이벤트다(PHASE1-DESIGN §6-2). 아래 중 하나라도 있으면 막고 이유를 보여 준다 —
// 사람이 따로 처리한다(이 경로는 운영 처리를 되감지 않는다).
//   - 운영 이벤트(양도·교환·완료·메모·수량 조정·되돌리기 등 취소·void 말고 전부)
//   - 기록 상태가 대기(pending)가 아님
//   - 배송 완료 배정(delivery_assignment_updated 최신)에 이 기록이 있음
//   - 되돌린 뒤 (보유자, 상품) 배송 처리 수량이 남은 보유보다 많아짐
//   - 쿠폰 적립 메모에 이 결과 키가 있음, 또는 이 기록이 생긴 뒤 시각의 잘린 옛 적립 메모가 같은 (시청자, 쿠폰)에 있음
// 이미 취소·void 된 기록은 "이미 취소"로 따로 센다(다시 void 하지 않는다).
import { computeHoldings, normalizeAccountId, type ItemEvent, type UpboEntry } from "./api";
import { cleanText, normalizeName } from "./upboCore";

export const REJUDGE_APPROX_PLANNED_ACTION = "rejudge_approx_planned";
export const REJUDGE_APPROX_REVERT_PLANNED_ACTION = "rejudge_approx_revert_planned";
export const APPROX_ORIGIN_KIND = "rejudge_approx";
// 넣기 계획 지문·출처 표시의 판(판정 분류 코드가 바뀌면 올린다 — 옛 미리보기로 새 코드에 넣지 못하게).
export const APPROX_PLAN_VERSION = 1;

export type ApproxOrigin = { kind: typeof APPROX_ORIGIN_KIND; runId: string; at: string; v: number };

export function approxOriginNote(origin: { runId: string; at: string; v?: number }): string {
  return JSON.stringify({ origin: { kind: APPROX_ORIGIN_KIND, runId: origin.runId, at: origin.at, v: origin.v ?? APPROX_PLAN_VERSION } });
}

export function approxOriginOf(adminNote: string | null | undefined): ApproxOrigin | null {
  if (!adminNote) return null;
  try {
    const parsed = JSON.parse(adminNote) as { origin?: Record<string, unknown> } | null;
    const origin = parsed && typeof parsed === "object" ? parsed.origin : null;
    if (!origin || origin.kind !== APPROX_ORIGIN_KIND || typeof origin.runId !== "string") return null;
    return {
      kind: APPROX_ORIGIN_KIND,
      runId: origin.runId,
      at: typeof origin.at === "string" ? origin.at : "",
      v: Number(origin.v ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

export type RevertBlockCode =
  | "ops_event"
  | "status_changed"
  | "delivery_assignment"
  | "processed_over_holding"
  | "coupon_accrued"
  | "coupon_unknown"
  | "changed_since_check";

export const REVERT_BLOCK_TEXT: Record<RevertBlockCode, string> = {
  ops_event: "양도·교환·완료·메모·수량 조정·되돌리기 같은 처리가 있어요",
  status_changed: "기록 상태가 바뀌었어요",
  delivery_assignment: "배송 완료 배정에 들어 있어요",
  processed_over_holding: "되돌리면 배송 처리 수량이 남은 보유보다 많아져요",
  coupon_accrued: "이 당첨으로 쿠폰이 이미 적립됐어요",
  coupon_unknown: "잘린 옛 쿠폰 적립 메모가 있어 이미 적립됐는지 알 수 없어요",
  changed_since_check: "확인하는 사이 새 처리가 생겼어요(다시 미리보기 해 주세요)",
};

// 보유자 열쇠 — lib/api.ts holdingOwnerKey(배송관리 ViewerSummary.key)와 같은 규칙. 처리 수량 쪽도 이걸로 맞춘다.
export function holdingOwnerKeyOf(id: string | null | undefined, name: string | null | undefined): string {
  return normalizeAccountId(id) || (name ?? "") || "";
}

export type RevertClassifyInput = {
  targets: UpboEntry[]; // 이 실행의 기록(장부 ∩ admin_note runId)
  // 배송관리가 보는 기록(룰렛표 사용 필터 뒤, 팬 페이지와 같은 목록) — 처리 수량 대조용. 상태 필터는 화면과 같이 하지 않는다.
  deliveryEntries: UpboEntry[];
  events: ItemEvent[]; // 운영 이벤트 전량
  assignmentEntryIds: ReadonlySet<string>;
  progress: Array<{ fanId: string; fanNickname?: string; itemKey: string; processedCount: number }>;
  couponExcludedNames: ReadonlySet<string>; // 쿠폰 연결 상품명(normalizeName) — 배송관리에서 빠지는 상품
  accruedKeys: ReadonlySet<string>; // 자동 적립 메모에 든 결과 키
  truncatedMarks: Array<{ viewerKey: string; itemKey: string; createdAt: string }>;
  couponItemKeysByName: ReadonlyMap<string, string[]>; // normalizeName(상품) → 연결된 쿠폰 종류 키
};

export type RevertClassified = {
  voidable: string[];
  alreadyCancelled: string[];
  blocked: Array<{ entryId: string; reasons: RevertBlockCode[] }>;
};

const holdingPairKey = (ownerKey: string, item: { itemName: string; probability: number; amountRangeLabel?: string }) =>
  `${ownerKey}\u0000${item.itemName}@@${item.probability}@@${item.amountRangeLabel ?? ""}`;

export function classifyRevertTargets(input: RevertClassifyInput): RevertClassified {
  const eventsByEntry = new Map<string, ItemEvent[]>();
  for (const ev of input.events) {
    const list = eventsByEntry.get(ev.upboEntryId);
    if (list) list.push(ev);
    else eventsByEntry.set(ev.upboEntryId, [ev]);
  }
  const alreadyCancelled: string[] = [];
  const blocked = new Map<string, RevertBlockCode[]>();
  const candidates: UpboEntry[] = [];

  for (const entry of input.targets) {
    const events = eventsByEntry.get(entry.id) ?? [];
    // 취소·void 말고 다른 처리가 하나라도 있으면 막는다(되돌린 취소=admin_adjustment 도 여기).
    if (events.some((ev) => ev.eventType !== "cancel" && ev.eventType !== "void")) {
      blocked.set(entry.id, ["ops_event"]);
      continue;
    }
    if (entry.status === "cancelled" || events.length > 0) {
      alreadyCancelled.push(entry.id);
      continue;
    }
    const codes: RevertBlockCode[] = [];
    if (entry.status !== "pending") codes.push("status_changed");
    if (input.assignmentEntryIds.has(entry.id)) codes.push("delivery_assignment");
    if (input.accruedKeys.has(cleanText(entry.sourceKey))) codes.push("coupon_accrued");
    else if (truncatedAccrualMayHold(entry, input)) codes.push("coupon_unknown");
    if (codes.length > 0) blocked.set(entry.id, codes);
    else candidates.push(entry);
  }

  // 되돌린 뒤 (보유자, 상품)별 배송 처리 수량 > 보유: 남은 후보를 전부 void 한 상태로 보유를 다시 계산해 대조한다.
  // 넘치는 줄에 걸친 후보는 전부 막는다(어느 조각을 배송한 것으로 쳤는지는 힌트일 뿐이라 골라 낼 수 없다).
  if (candidates.length > 0 && input.progress.length > 0) {
    const processed = new Map<string, number>();
    for (const p of input.progress) {
      const key = `${holdingOwnerKeyOf(p.fanId, p.fanNickname)}\u0000${p.itemKey}`;
      processed.set(key, Math.max(processed.get(key) ?? 0, Math.max(0, Math.floor(Number(p.processedCount) || 0))));
    }
    const candidateIds = new Set(candidates.map((e) => e.id));
    const counted = (itemName: string) => !input.couponExcludedNames.has(normalizeName(itemName));
    const pairsByEntry = new Map<string, Set<string>>();
    for (const owner of computeHoldings(input.deliveryEntries, input.events)) {
      for (const item of owner.items) {
        if (!candidateIds.has(item.entryId) || !counted(item.itemName)) continue;
        const pairs = pairsByEntry.get(item.entryId) ?? new Set<string>();
        pairs.add(holdingPairKey(owner.key, item));
        pairsByEntry.set(item.entryId, pairs);
      }
    }
    if (pairsByEntry.size > 0) {
      const simulated: ItemEvent[] = candidates.map((entry) => ({
        id: `revert-preview:${entry.id}`,
        upboEntryId: entry.id,
        eventType: "void",
        actorType: "operator",
        actorId: null,
        beforeJson: null,
        afterJson: null,
        quantityDelta: null,
        reason: null,
        memo: null,
        approvalStatus: "not_required",
        approvedBy: null,
        approvedAt: null,
        createdAt: "9999-12-31T23:59:59.999Z",
      }));
      const after = new Map<string, number>();
      for (const owner of computeHoldings(input.deliveryEntries, [...input.events, ...simulated])) {
        for (const item of owner.items) {
          if (!counted(item.itemName)) continue;
          const key = holdingPairKey(owner.key, item);
          after.set(key, (after.get(key) ?? 0) + item.quantity);
        }
      }
      const overflowing = new Set<string>();
      for (const pairs of pairsByEntry.values()) {
        for (const pair of pairs) if ((processed.get(pair) ?? 0) > (after.get(pair) ?? 0)) overflowing.add(pair);
      }
      if (overflowing.size > 0) {
        for (const [entryId, pairs] of pairsByEntry) {
          if ([...pairs].some((pair) => overflowing.has(pair))) blocked.set(entryId, ["processed_over_holding"]);
        }
      }
    }
  }

  return {
    voidable: candidates.filter((e) => !blocked.has(e.id)).map((e) => e.id),
    alreadyCancelled,
    blocked: input.targets.filter((e) => blocked.has(e.id)).map((e) => ({ entryId: e.id, reasons: blocked.get(e.id)! })),
  };
}

// 잘린 옛 적립 메모(500자에서 잘려 뒤쪽 키가 사라짐)가 같은 (시청자, 쿠폰)에 있고, 그 적립이 이 기록보다 뒤(또는 시각 불명)면
// 이 기록의 키가 잘린 부분에 숨어 있을 수 있다 — 쿠폰 소급의 "확인 불가"와 같은 규칙(lib/couponNotes.ts splitAccrualsByTruncation).
// 이 기록이 생기기 전에 쓴 메모에는 이 키가 들어갈 수 없으므로 막지 않는다.
function truncatedAccrualMayHold(entry: UpboEntry, input: RevertClassifyInput): boolean {
  if (input.truncatedMarks.length === 0) return false;
  const itemKeys = input.couponItemKeysByName.get(normalizeName(entry.itemName)) ?? [];
  if (itemKeys.length === 0) return false;
  const viewerKey = normalizeAccountId(entry.fanId) || cleanText(entry.fanNickname);
  if (!viewerKey) return false;
  const createdMs = Date.parse(entry.createdAt ?? "");
  return input.truncatedMarks.some(
    (mark) =>
      mark.viewerKey === viewerKey &&
      itemKeys.includes(mark.itemKey) &&
      !(Number.isFinite(createdMs) && Date.parse(mark.createdAt) < createdMs),
  );
}

// void 를 쓰기 직전 다시 확인(순수): 판정 뒤 그 기록에 생긴 이벤트(종류 무관)·배송 배정·쿠폰 적립을 다시 읽어 대조한다.
// 이벤트가 취소·void 뿐이면 "이미 취소"(같이 누른 다른 되돌리기 등), 다른 종류가 하나라도 있으면 막힘으로 보고 건너뛴다.
export function recheckRevertTargets(input: {
  targets: Array<{ id: string; sourceKey: string }>;
  events: Array<{ upboEntryId: string; eventType: string }>;
  assignmentEntryIds: ReadonlySet<string>;
  accruedKeys: ReadonlySet<string>;
}): RevertClassified {
  const typesByEntry = new Map<string, string[]>();
  for (const ev of input.events) {
    const list = typesByEntry.get(ev.upboEntryId) ?? [];
    list.push(ev.eventType);
    typesByEntry.set(ev.upboEntryId, list);
  }
  const voidable: string[] = [];
  const alreadyCancelled: string[] = [];
  const blocked: RevertClassified["blocked"] = [];
  for (const target of input.targets) {
    const types = typesByEntry.get(target.id) ?? [];
    if (types.length > 0 && types.every((t) => t === "cancel" || t === "void")) {
      alreadyCancelled.push(target.id);
      continue;
    }
    const codes: RevertBlockCode[] = [];
    if (types.length > 0) codes.push("changed_since_check");
    if (input.assignmentEntryIds.has(target.id)) codes.push("delivery_assignment");
    if (input.accruedKeys.has(cleanText(target.sourceKey))) codes.push("coupon_accrued");
    if (codes.length > 0) blocked.push({ entryId: target.id, reasons: codes });
    else voidable.push(target.id);
  }
  return { voidable, alreadyCancelled, blocked };
}
