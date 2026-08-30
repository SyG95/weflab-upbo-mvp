"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { computeHoldings, mergeHoldingItemsByName, normalizeAccountId } from "../../lib/api";
import type { DeliveryProgressItem, HoldingItem, ItemEvent, MergedHolding, UpboEntry, ViewerHolding } from "../../lib/api";

type CatalogChoice = {
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  // 이 상품이 속한 원본 그룹 인덱스. 교환으로 받은 상품이 같은 룰렛·세트로 묶이는 데 쓴다.
  catalogGroupIndex?: number;
  // 이 상품이 속한 룰렛(상품 구성이 같은 그룹 묶음) id. 같은 룰렛 필터에 사용.
  rouletteId?: string;
  // 룰렛 표시 라벨(그 룰렛의 금액대들, 예: "33/100/175/330").
  rouletteLabel?: string;
};

// 교환에서 "받을 상품" 한 줄(N:M — 종류·수량 자유).
type ReceiveItem = {
  key: string;
  itemName: string;
  probability?: number;
  amountRangeLabel?: string;
  catalogGroupIndex?: number;
  qty: number;
};

type ActionType = "transfer" | "exchange" | "cancel";

// "직접 입력"(룰렛표에 없는 상품으로 교환) 선택지의 sentinel 값.
const CUSTOM_ITEM = "__custom__";

// 시스템 시각(UTC ISO)을 Asia/Seoul "MM-DD HH:mm"로. 위플랩 원문 시간엔 쓰지 않는다.
function fmtKst(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

const EVENT_LABEL: Record<string, string> = {
  created_from_source: "생성",
  transfer: "양도",
  exchange: "교환",
  cancel: "취소",
  void: "무효",
  complete: "완료",
  memo: "메모",
  quantity_adjust: "수량 조정",
  status_change: "상태 변경",
  admin_adjustment: "되돌리기",
};

const ACTION_META: Record<ActionType, { title: string; verb: string; hint: string }> = {
  transfer: {
    title: "다른 사람에게 양도",
    verb: "양도 기록",
    hint: "원본 당첨 기록은 그대로 남고, 고른 상품·수량만큼 현재 소유자가 바뀝니다.",
  },
  exchange: {
    title: "다른 상품으로 교환",
    verb: "교환 기록",
    hint: "고른 상품·수량은 장부에서 나가고, '받을 상품' 목록이 새 기록으로 들어옵니다. 주고받는 개수는 자유예요(예: 3개 주고 1개 받기). 원본 당첨 기록은 그대로 남아요.",
  },
  cancel: {
    title: "취소 / 무효 처리",
    verb: "취소 기록",
    hint: "고른 상품·수량만큼 공개 시트에서 숨겨집니다. 원본 기록은 지워지지 않고, 이력에서 되돌릴 수 있어요.",
  },
};

type ActionLabel = { verb: string; cls: string; Icon: React.ComponentType };
const ACTION_LABELS: Record<ActionType, ActionLabel> = {
  transfer: { verb: "양도", cls: "ieChipBtn", Icon: IconTransfer },
  exchange: { verb: "교환", cls: "ieChipBtn", Icon: IconExchange },
  cancel: { verb: "취소", cls: "ieChipBtnDanger", Icon: IconCancel },
};

/* ── 아이콘 (1.6 stroke, currentColor) ───────────────────── */
function IconTransfer() {
  return (
    <svg className={styles.ieIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 7h11M11 4l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 13H6M9 16l-3-3 3-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconExchange() {
  return (
    <svg className={styles.ieIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 8a6 6 0 0 1 10-3M16 12a6 6 0 0 1-10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2v3h-3M6 18v-3h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCancel() {
  return (
    <svg className={styles.ieIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function IconHistory() {
  return (
    <svg className={styles.ieIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconRestore() {
  return (
    <svg className={styles.ieIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10a6 6 0 1 0 1.8-4.3M5 3v3h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 통합 줄에 붙는 작은 배지(양도받은 것/교환된 것이 섞여 있으면 표시).
function mergedBadge(m: MergedHolding): { label: string; cls: string } | null {
  if (m.anyTransferred && m.anyExchanged) return { label: "양도·교환 포함", cls: styles.ieBadgeInfo };
  if (m.anyTransferred) return { label: "양도받음 포함", cls: styles.ieBadgeInfo };
  if (m.anyExchanged) return { label: "교환됨", cls: styles.ieBadgeInfo };
  return null;
}

export default function ItemEventManager({
  slug,
  entries,
  events: initialEvents,
  catalogItems,
  rouletteByGroupIndex,
  catalogVersion,
  deliveryProgress,
}: {
  slug: string;
  entries: UpboEntry[];
  events: ItemEvent[];
  catalogItems: CatalogChoice[];
  // 원본 그룹(catalogGroupIndex) → 룰렛 id 매핑. 상품이 어느 룰렛에서 나왔는지 되짚는 데 쓴다.
  rouletteByGroupIndex: Record<number, string>;
  // 현재 사용 중인 룰렛표 버전. 교환으로 받은 상품 기록에 저장한다.
  catalogVersion: number | null;
  // 배송관리 처리수량 장부(읽기 전용). 전량 배송완료 시청자를 기본으로 접는 데만 쓴다 —
  // 장부는 여기서 절대 쓰지 않고, 수량 계산(computeHoldings)에도 섞지 않는다.
  deliveryProgress: DeliveryProgressItem[];
}) {
  const router = useRouter();
  // events 가 단일 진실원본. POST 응답의 itemEvents(해당 entryId 전체)로 부분 교체한다.
  const [events, setEvents] = useState<ItemEvent[]>(initialEvents);
  // initialEvents(서버 최신)가 바뀌면 로컬 events를 동기화. effect 대신 렌더 중 조정(React 권장 패턴).
  const [syncedInitial, setSyncedInitial] = useState<ItemEvent[]>(initialEvents);
  if (initialEvents !== syncedInitial) {
    setSyncedInitial(initialEvents);
    setEvents(initialEvents);
  }
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 이력 펼침: ownerKey 단위.
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  // 액션 모달: 시청자 단위로 연다. 그 시청자의 통합 상품 목록에서 상품별 수량을 고른다.
  const [action, setAction] = useState<{ group: ViewerHolding; merged: MergedHolding[] } | null>(null);
  const [actionType, setActionType] = useState<ActionType>("transfer");
  // 상품별 선택 수량: mergedKey(상품명) -> 개수(0..보유).
  const [sel, setSel] = useState<Record<string, number>>({});
  const [ownerName, setOwnerName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  // 양도 계정ID 자동완성 드롭다운 열림 여부.
  const [idListOpen, setIdListOpen] = useState(false);
  // 교환 후보를 "다른 룰렛 상품까지" 넓혀 볼지(기본 false = 같은 룰렛만).
  const [showAllRoulettes, setShowAllRoulettes] = useState(false);
  const [exchangePick, setExchangePick] = useState<string>(CUSTOM_ITEM);
  const [customItem, setCustomItem] = useState("");
  const [customProb, setCustomProb] = useState("");
  // 교환에서 "받을 상품" 목록. 주는 쪽과 개수 비율이 독립(N:M).
  const [receives, setReceives] = useState<ReceiveItem[]>([]);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // 성공 메시지 자동 사라짐(4초).
  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const closeModal = useCallback(() => {
    setAction(null);
    setFormError(null);
  }, []);

  // 모달 Esc 닫기 + 첫 입력칸 포커스.
  useEffect(() => {
    if (!action) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [action, closeModal]);

  // entries + events → 현재 보유 현황(보유자 단위).
  const holdings = useMemo(() => computeHoldings(entries, events), [entries, events]);

  // 양도 계정ID 자동완성 후보: 원본데이터(entries)에 "룰렛기록"이 한 번이라도 있는 계정.
  // 정가기록(fixed:)만 있는 계정은 제외한다. 계정ID(괄호 제거) 기준 중복 제거, 닉네임은 표시용.
  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.sourceKey?.startsWith("fixed:")) continue;
      const id = normalizeAccountId(e.fanId);
      if (!id) continue;
      const nick = e.fanNickname?.trim() ?? "";
      const cur = map.get(id);
      if (cur === undefined) map.set(id, nick);
      else if (!cur && nick) map.set(id, nick);
    }
    return [...map.entries()]
      .map(([id, nickname]) => ({ id, nickname }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [entries]);

  // 입력칸 예시(placeholder)는 이 시트의 실제 계정에서 뽑는다 — 시트마다 맞는 예시가 뜨도록.
  const idExample = accountOptions[0]?.id ?? "";
  const nickExample = accountOptions.find((a) => a.nickname)?.nickname ?? "";

  // 입력한 앞글자로 좁혀지는 자동완성(계정ID 앞글자 우선, 닉네임 앞글자도 매칭). 최대 50개.
  const idSuggestions = useMemo(() => {
    const q = normalizeAccountId(ownerId).toLowerCase();
    const list = q
      ? accountOptions.filter(
          (a) => a.id.toLowerCase().startsWith(q) || a.nickname.toLowerCase().startsWith(q),
        )
      : accountOptions;
    return list.slice(0, 50);
  }, [accountOptions, ownerId]);

  // 원본 엔트리(entryId) → 그 상품이 나온 룰렛 id. 교환 시 "같은 룰렛" 판정에 쓴다.
  const entryRouletteId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      const gi = e.catalogGroupIndex;
      if (gi == null) continue;
      const rid = rouletteByGroupIndex[gi];
      if (rid) map.set(e.id, rid);
    }
    return map;
  }, [entries, rouletteByGroupIndex]);

  // 보유자별 통합 보유 목록(상품명 기준).
  const mergedByOwner = useMemo(() => {
    const map = new Map<string, MergedHolding[]>();
    for (const g of holdings) map.set(g.key, mergeHoldingItemsByName(g.items));
    return map;
  }, [holdings]);

  // 보유자 단위 검색.
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return holdings;
    return holdings.filter((v) => {
      const hay = `${v.ownerName} ${v.ownerId} ${v.items
        .map((it) => `${it.itemName} ${it.originalItemName} ${it.sourceOwnerName}`)
        .join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [holdings, q]);

  const totalQuantity = useMemo(
    () => holdings.reduce((s, v) => s + v.total, 0),
    [holdings],
  );

  // ── 배송 전량완료 접기 ──────────────────────────────────────────────
  // 배송관리와 같은 매칭 규칙(fanId=보유자 key, itemKey=상품명@@확률@@라벨)으로
  // 처리수량을 읽어, "보유 전량이 배송 처리된" 시청자를 기본으로 접는다.
  // 표시 계산 전용 — 보유 수량(computeHoldings)에는 영향이 없다.
  const processedByOwner = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of deliveryProgress) {
      if (!row.fanId || !row.itemKey) continue;
      const m = map.get(row.fanId) ?? new Map<string, number>();
      m.set(row.itemKey, Math.max(0, Math.floor(Number(row.processedCount || 0))));
      map.set(row.fanId, m);
    }
    return map;
  }, [deliveryProgress]);

  // 보유자별 처리 현황(done/total). 같은 itemKey 조각은 보유량을 먼저 합쳐 중복 계산을 막고,
  // 처리수량은 보유량을 상한으로 잘라 센다(취소 등으로 보유가 줄어도 안전).
  const deliveryDoneByOwner = useMemo(() => {
    const out = new Map<string, { done: number; total: number }>();
    for (const g of holdings) {
      const m = processedByOwner.get(g.key);
      const qtyByKey = new Map<string, number>();
      for (const it of g.items) {
        const k = `${it.itemName}@@${it.probability}@@${it.amountRangeLabel ?? ""}`;
        qtyByKey.set(k, (qtyByKey.get(k) ?? 0) + it.quantity);
      }
      let done = 0;
      for (const [k, qty] of qtyByKey) done += Math.min(m?.get(k) ?? 0, qty);
      out.set(g.key, { done, total: g.total });
    }
    return out;
  }, [holdings, processedByOwner]);

  const allDoneKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, d] of deliveryDoneByOwner) {
      if (d.total > 0 && d.done >= d.total) set.add(key);
    }
    return set;
  }, [deliveryDoneByOwner]);

  // 검색 중에는 접지 않는다 — 사람을 찾는데 배송완료라고 안 보이면 더 헷갈린다.
  const activeView = useMemo(() => view.filter((g) => !allDoneKeys.has(g.key)), [view, allDoneKeys]);
  const doneView = useMemo(() => view.filter((g) => allDoneKeys.has(g.key)), [view, allDoneKeys]);
  const [showDone, setShowDone] = useState(false);

  // 한 보유자에 묶인 entryId 전체의 이벤트(이력 타임라인용). 최근순.
  const eventsForOwner = useCallback(
    (group: ViewerHolding): ItemEvent[] => {
      const entryIds = new Set(group.items.map((h) => h.entryId));
      return events
        .filter((ev) => entryIds.has(ev.upboEntryId))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    },
    [events],
  );

  const toggleHistory = (key: string) =>
    setOpenHistory((p) => ({ ...p, [key]: !p[key] }));

  // 이미 되돌려진 이벤트/교환 묶음 — 되돌리기 버튼을 숨겨 이중 복구를 막는다(서버에도 같은 가드 있음).
  const revertedEventIds = useMemo(() => {
    const s = new Set<string>();
    for (const ev of events) {
      if (ev.eventType !== "admin_adjustment") continue;
      const id = ev.afterJson?.revertOfEventId;
      if (typeof id === "string" && id) s.add(id);
      const gid = ev.afterJson?.revertOfGroupId;
      if (typeof gid === "string" && gid) s.add(`group:${gid}`);
    }
    return s;
  }, [events]);

  function openAction(group: ViewerHolding, type: ActionType) {
    const merged = mergedByOwner.get(group.key) ?? [];
    setAction({ group, merged });
    setActionType(type);
    // 상품이 1종뿐이면 1개를 미리 선택해 클릭 수를 줄인다.
    setSel(merged.length === 1 ? { [merged[0].key]: 1 } : {});
    setOwnerName("");
    setOwnerId("");
    setIdListOpen(false);
    setShowAllRoulettes(false);
    // ""(빈 값)은 "아직 미정" 신호 — 아래 효과가 보이는 후보 중 첫 상품으로 채운다.
    setExchangePick("");
    setCustomItem("");
    setCustomProb("");
    setReceives([]);
    setReason("");
    setFormError(null);
  }

  const setSelQty = (key: string, n: number, max: number) =>
    setSel((prev) => ({ ...prev, [key]: Math.max(0, Math.min(n, max)) }));

  const selectedList = useMemo(() => {
    if (!action) return [] as { m: MergedHolding; n: number }[];
    return action.merged
      .map((m) => ({ m, n: Math.min(sel[m.key] ?? 0, m.quantity) }))
      .filter((x) => x.n > 0);
  }, [action, sel]);
  const selectedTotal = selectedList.reduce((s, x) => s + x.n, 0);

  // 교환 후보 안정 키(같은 이름이라도 룰렛이 다르면 다른 항목). select 값으로 쓴다.
  const choiceKey = useCallback(
    (c: CatalogChoice) => `${c.rouletteId ?? ""}@@${c.itemName}@@${c.probability}`,
    [],
  );

  // 지금 고른 상품(없으면 이 시청자의 보유 상품 전체)이 나온 룰렛 id 집합.
  const sourceRouletteIds = useMemo(() => {
    const ids = new Set<string>();
    if (!action) return ids;
    const pieces =
      selectedList.length > 0
        ? selectedList.flatMap((x) => x.m.sources)
        : action.merged.flatMap((m) => m.sources);
    for (const p of pieces) {
      const rid = entryRouletteId.get(p.entryId);
      if (rid) ids.add(rid);
    }
    return ids;
  }, [action, selectedList, entryRouletteId]);

  // 교환 select에 보여줄 후보. 기본은 같은 룰렛만, "다른 룰렛도 보기"면 전체.
  // 룰렛을 못 되짚는 경우(구 데이터 등)엔 안전하게 전체를 보여준다.
  const visibleCatalog = useMemo(() => {
    const base =
      showAllRoulettes || sourceRouletteIds.size === 0
        ? catalogItems
        : catalogItems.filter((c) => c.rouletteId && sourceRouletteIds.has(c.rouletteId));
    return [...base].sort(
      (a, b) => b.probability - a.probability || a.itemName.localeCompare(b.itemName),
    );
  }, [catalogItems, showAllRoulettes, sourceRouletteIds]);

  // 후보에 룰렛이 2개 이상 섞이면 optgroup으로 나눠 어느 룰렛 상품인지 구분해 준다.
  const rouletteGroupsForSelect = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, { label: string; items: CatalogChoice[] }>();
    for (const c of visibleCatalog) {
      const rid = c.rouletteId ?? "";
      let g = byId.get(rid);
      if (!g) {
        g = { label: c.rouletteLabel ? `룰렛 ${c.rouletteLabel}` : "룰렛", items: [] };
        byId.set(rid, g);
        order.push(rid);
      }
      g.items.push(c);
    }
    return order.map((rid) => ({ rid, ...byId.get(rid)! }));
  }, [visibleCatalog]);
  const showRouletteGroups = rouletteGroupsForSelect.length > 1;

  // 같은 룰렛 밖에도 보여줄 상품이 있을 때만 "다른 룰렛도 보기" 토글을 노출한다.
  const otherRouletteAvailable = useMemo(
    () =>
      sourceRouletteIds.size > 0 &&
      catalogItems.some((c) => !c.rouletteId || !sourceRouletteIds.has(c.rouletteId)),
    [catalogItems, sourceRouletteIds],
  );

  // 실제 적용되는 선택 키(렌더 중 파생). 저장된 선택이 지금 보이는 후보에서 사라졌으면
  // (룰렛 필터/선택 변경 등) 첫 후보로 자동 대체한다. "직접 입력"(CUSTOM_ITEM)은 그대로 존중.
  // setState-in-effect 없이 파생값으로 처리해 불필요한 리렌더를 피한다.
  const effectivePick =
    exchangePick === CUSTOM_ITEM
      ? CUSTOM_ITEM
      : visibleCatalog.some((c) => choiceKey(c) === exchangePick)
        ? exchangePick
        : visibleCatalog.length > 0
          ? choiceKey(visibleCatalog[0])
          : CUSTOM_ITEM;

  const selectAll = () => {
    if (!action) return;
    setSel(Object.fromEntries(action.merged.map((m) => [m.key, m.quantity])));
  };
  const clearAll = () => setSel({});

  // "받을 상품"에 현재 고른 후보(또는 직접 입력)를 추가. 같은 항목이면 수량 +1.
  function addReceive() {
    if (effectivePick === CUSTOM_ITEM) {
      const name = customItem.trim();
      if (!name) {
        setFormError("받을 상품 이름을 적어 주세요.");
        return;
      }
      const prob = customProb.trim() === "" ? undefined : Number(customProb);
      if (prob !== undefined && !Number.isFinite(prob)) {
        setFormError("확률은 숫자로 적어 주세요. (예: 5)");
        return;
      }
      const key = `custom@@${name}@@${prob ?? ""}`;
      setReceives((prev) => {
        const hit = prev.find((r) => r.key === key);
        return hit
          ? prev.map((r) => (r.key === key ? { ...r, qty: Math.min(9999, r.qty + 1) } : r))
          : [...prev, { key, itemName: name, probability: prob, qty: 1 }];
      });
      setCustomItem("");
      setCustomProb("");
    } else {
      const picked = catalogItems.find((c) => choiceKey(c) === effectivePick);
      if (!picked) return;
      const key = choiceKey(picked);
      setReceives((prev) => {
        const hit = prev.find((r) => r.key === key);
        return hit
          ? prev.map((r) => (r.key === key ? { ...r, qty: Math.min(9999, r.qty + 1) } : r))
          : [
              ...prev,
              {
                key,
                itemName: picked.itemName,
                probability: picked.probability,
                amountRangeLabel: picked.amountRangeLabel,
                catalogGroupIndex: picked.catalogGroupIndex,
                qty: 1,
              },
            ];
      });
    }
    setFormError(null);
  }

  // 받을 상품 수량 조절(0이 되면 목록에서 제거).
  const setReceiveQty = (key: string, n: number) =>
    setReceives((prev) =>
      n <= 0
        ? prev.filter((r) => r.key !== key)
        : prev.map((r) => (r.key === key ? { ...r, qty: Math.min(9999, n) } : r)),
    );
  const receiveTotal = receives.reduce((s, r) => s + r.qty, 0);

  // 단일 POST. 성공 시 응답 itemEvents(해당 entryId 전체)를 반환, 실패 시 null.
  async function postOne(entryId: string, body: Record<string, unknown>): Promise<ItemEvent[] | null> {
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/item-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, upboEntryId: entryId, actorType: "operator" }),
      });
      const json = (await res.json()) as { ok?: boolean; itemEvents?: ItemEvent[]; error?: string };
      if (!res.ok || !json.ok || !json.itemEvents) return null;
      return json.itemEvents;
    } catch {
      return null;
    }
  }

  // 고른 수량을 통합 항목의 원본 조각들에 순서대로(본인 당첨분 먼저) 나눠 담는다.
  function allocate(sources: HoldingItem[], amount: number): { source: HoldingItem; take: number }[] {
    const out: { source: HoldingItem; take: number }[] = [];
    let remaining = amount;
    for (const source of sources) {
      if (remaining <= 0) break;
      const take = Math.min(source.quantity, remaining);
      if (take <= 0) continue;
      out.push({ source, take });
      remaining -= take;
    }
    return out;
  }

  async function submitAction() {
    if (!action) return;

    if (selectedTotal <= 0) {
      setFormError("처리할 상품 수량을 1개 이상 골라 주세요.");
      return;
    }
    // 양도: 시청자 구분 기준이 계정ID라서 ID를 필수로 받는다(닉네임만 적으면 ID가 비어
    // 팬 화면에 같은 닉네임의 별도 시청자 줄이 새로 생긴다). 닉네임은 비우면
    // 그 ID로 이미 있는 기록(보유 현황 → 원본 기록 순)에서 찾아 자동으로 채운다.
    let transferName = "";
    if (actionType === "transfer") {
      const id = normalizeAccountId(ownerId);
      if (!id) {
        setFormError("양도받을 사람의 계정ID를 적어 주세요.");
        firstFieldRef.current?.focus();
        return;
      }
      const known =
        holdings.find((g) => g.ownerId === id && g.ownerName.trim())?.ownerName ||
        entries.find((e) => e.fanId === id && e.fanNickname.trim())?.fanNickname ||
        "";
      transferName = ownerName.trim() || known;
      if (!transferName) {
        setFormError("이 계정ID로 남아있는 기록이 없어요. 닉네임도 같이 적어 주세요.");
        return;
      }
    }
    if (actionType === "cancel" && !reason.trim()) {
      setFormError("취소 사유를 적어 주세요. (예: 중복 집계 / 오입력)");
      return;
    }

    // 교환(N:M): 받을 목록이 1개 이상 있어야 한다. 주는/받는 개수는 서로 독립(비율 자유).
    if (actionType === "exchange" && receives.length === 0) {
      setFormError("'받을 상품' 목록에 최소 1개를 추가해 주세요.");
      return;
    }

    // 상품별 선택 수량 → 원본 조각 배분 → POST 목록.
    const plan: { source: HoldingItem; take: number }[] = [];
    for (const { m, n } of selectedList) plan.push(...allocate(m.sources, n));
    if (plan.length === 0) return;

    // 교환은 단일 번들 POST — 주는 조각들과 받을 목록을 한 번에 기록(부분 실패 없음).
    if (actionType === "exchange") {
      setSaving(true);
      setFormError(null);
      try {
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            viewer: { fanId: action.group.ownerId, fanNickname: action.group.ownerName },
            gives: plan.map(({ source, take }) => ({
              entryId: source.entryId,
              quantity: take,
              itemName: source.itemName,
            })),
            receives: receives.map((r) => ({
              itemName: r.itemName,
              probability: r.probability,
              amountRangeLabel: r.amountRangeLabel,
              catalogGroupIndex: r.catalogGroupIndex ?? null,
              quantity: r.qty,
            })),
            catalogVersion,
            reason: reason.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          // 받은 상품이 쿠폰 연결 상품이면 서버가 자동 적립하고 결과를 실어 보낸다.
          coupon?: { accrued?: number; totalDelta?: number; error?: string } | null;
        };
        if (!res.ok || data.ok === false) {
          setFormError(data.error || "교환 기록에 실패했어요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        const giveText = selectedList.map(({ m, n }) => `${m.itemName} ${n}개`).join(" + ");
        const receiveText = receives.map((r) => `${r.itemName} ${r.qty}개`).join(" + ");
        if (data.coupon?.error) {
          // 교환 자체는 저장됐고 쿠폰 적립만 실패 — 수동 보정이 필요하니 경고 톤으로 알린다.
          setMessage({
            type: "err",
            text: `${giveText} → ${receiveText} 교환은 기록됐지만, 쿠폰 자동 적립에 실패했어요. 쿠폰 탭에서 수동으로 확인해 주세요.`,
          });
        } else {
          const accruedText =
            (data.coupon?.totalDelta ?? 0) > 0 ? ` · 쿠폰 ${data.coupon!.totalDelta}개 자동 적립` : "";
          setMessage({ type: "ok", text: `${giveText} → ${receiveText} 교환 기록 완료${accruedText}` });
        }
        closeModal();
        // 받은 상품은 새 기록(entry)으로 들어오므로 서버 데이터를 다시 불러온다.
        router.refresh();
      } catch {
        setFormError("네트워크 오류로 기록하지 못했어요. 잠시 후 다시 시도해 주세요.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const buildBody = (_source: HoldingItem, take: number): Record<string, unknown> => {
      if (actionType === "transfer") {
        return {
          eventType: "transfer",
          newOwnerName: transferName,
          newOwnerId: ownerId.trim(),
          quantityDelta: take,
          reason: reason.trim() || undefined,
        };
      }
      return { eventType: "cancel", quantityDelta: take, reason: reason.trim() };
    };

    setSaving(true);
    setFormError(null);

    const results = await Promise.all(
      plan.map(({ source, take }) =>
        postOne(source.entryId, buildBody(source, take)).then((ev) => ({ entryId: source.entryId, ev })),
      ),
    );
    setSaving(false);

    const okResults = results.filter((r) => r.ev);
    if (okResults.length > 0) {
      const touched = new Set(okResults.map((r) => r.entryId));
      setEvents((prev) => {
        const kept = prev.filter((ev) => !touched.has(ev.upboEntryId));
        const fresh = okResults.flatMap((r) => r.ev as ItemEvent[]);
        return [...kept, ...fresh];
      });
    }

    const summary = selectedList.map(({ m, n }) => `${m.itemName} ${n}개`).join(", ");
    if (okResults.length === plan.length) {
      const okText =
        actionType === "transfer"
          ? `${action.group.ownerName} → ${ownerName.trim()} · ${summary} 양도 기록 완료`
          : `${summary} 취소 처리 완료 (공개 시트에서 숨겨졌어요)`;
      setMessage({ type: "ok", text: okText });
      closeModal();
    } else if (okResults.length === 0) {
      setMessage({ type: "err", text: "처리에 실패했어요. 잠시 후 다시 시도해 주세요." });
    } else {
      setMessage({
        type: "err",
        text: `일부만 처리됐어요(${okResults.length}/${plan.length}건). 이력과 남은 수량을 확인해 주세요.`,
      });
      closeModal();
    }
  }

  async function revert(ev: ItemEvent) {
    setReverting(ev.id);
    try {
      // 번들 교환(주는 쪽)은 묶음 전체를 한 번에 되돌린다: 준 수량 복구 + 받은 기록 삭제.
      if (ev.eventType === "exchange" && ev.afterJson?.exchangeOut === true) {
        const gid = String(ev.afterJson?.exchangeGroupId ?? "");
        const res = await fetch(
          `/api/s/${encodeURIComponent(slug)}/exchange?groupId=${encodeURIComponent(gid)}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          coupon?: { revoked?: number; totalDelta?: number; error?: string } | null;
        };
        if (!res.ok || data.ok === false) {
          setMessage({ type: "err", text: data.error || "되돌리기에 실패했어요. 잠시 후 다시 시도해 주세요." });
        } else if (data.coupon?.error) {
          setMessage({
            type: "err",
            text: "교환 묶음은 되돌렸지만, 자동 적립됐던 쿠폰 회수에 실패했어요. 쿠폰 탭에서 수동으로 빼 주세요.",
          });
          router.refresh();
        } else {
          const revokedText =
            (data.coupon?.totalDelta ?? 0) > 0 ? `, 쿠폰 ${data.coupon!.totalDelta}개 회수` : "";
          setMessage({ type: "ok", text: `교환 묶음을 되돌렸어요. (준 수량 복구, 받은 기록 삭제${revokedText})` });
          // 받은 기록(entry) 삭제까지 화면에 반영되게 서버 데이터를 재조회.
          router.refresh();
        }
        return;
      }

      // 단건 되돌리기: 역연산 재료(revertOf)를 함께 보내 보유 수량까지 실제로 복구한다.
      const revertOf =
        ev.eventType === "cancel"
          ? { eventId: ev.id, kind: "restore", quantity: ev.quantityDelta ?? undefined }
          : ev.eventType === "transfer"
            ? {
                eventId: ev.id,
                kind: "transfer_back",
                quantity: ev.quantityDelta ?? undefined,
                toOwnerId:
                  typeof ev.afterJson?.currentOwnerId === "string" ? ev.afterJson.currentOwnerId : "",
                toOwnerName:
                  typeof ev.afterJson?.currentOwnerName === "string" ? ev.afterJson.currentOwnerName : "",
              }
            : ev.eventType === "exchange"
              ? {
                  eventId: ev.id,
                  kind: "exchange_back",
                  quantity: ev.quantityDelta ?? undefined,
                  newItemName:
                    typeof ev.afterJson?.currentItemName === "string" ? ev.afterJson.currentItemName : "",
                }
              : undefined;
      const fresh = await postOne(ev.upboEntryId, {
        eventType: "admin_adjustment",
        reason: `${EVENT_LABEL[ev.eventType] ?? ev.eventType} 되돌리기`,
        ...(revertOf ? { revertOf } : {}),
      });
      if (fresh) {
        setEvents((prev) => [...prev.filter((e) => e.upboEntryId !== ev.upboEntryId), ...fresh]);
        setMessage({ type: "ok", text: "되돌렸어요. (보유 수량 복구 반영)" });
      } else {
        setMessage({ type: "err", text: "처리에 실패했어요. 이미 되돌린 기록인지 확인해 주세요." });
      }
    } finally {
      setReverting(null);
    }
  }

  const meta = action ? ACTION_META[actionType] : null;
  const previewSummary =
    selectedList.length === 0
      ? "(상품을 골라 주세요)"
      : selectedList.map(({ m, n }) => `${m.itemName} ${n}개`).join(", ");
  const previewReceive =
    receives.length === 0
      ? "(받을 상품을 추가해 주세요)"
      : receives.map((r) => `${r.itemName} ${r.qty}개`).join(" + ");

  return (
    <div className={styles.ieWrap}>
      <p className={styles.ieBanner}>
        <strong>시청자 단위</strong>로 양도·교환·취소를 진행해요. 버튼을 누르면 그 시청자가 가진 모든 상품이
        한 창에 뜨고, 상품별 개수를 골라 한 번에 처리할 수 있어요. 원본 당첨 기록은 절대 바뀌지 않고,{" "}
        <strong>처리(지급) 수량</strong>은 «배송 관리» 탭에서 관리해요. 배송이 전량 끝난 시청자는
        목록에서 기본으로 접혀요(검색하면 항상 보여요).
      </p>

      {message ? (
        <p className={message.type === "ok" ? styles.fieldOk : styles.fieldErr} role="status" aria-live="polite">
          {message.text}
        </p>
      ) : null}

      <div className={styles.ieToolbar}>
        <input
          className={styles.ieSearch}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="닉네임 · 계정ID · 상품 검색"
          aria-label="보유 현황 검색"
        />
      </div>

      <div className={styles.ieSummary}>
        <span className={styles.tag}>현재 보유자 {holdings.length}명</span>
        <span className={styles.tagMuted}>보유 수량 합계 {totalQuantity}개</span>
        {q.trim() ? <span className={styles.tagMuted}>검색 결과 {view.length}명</span> : null}
        {!q.trim() && doneView.length > 0 ? (
          <button
            type="button"
            className={styles.ieDoneToggle}
            onClick={() => setShowDone((v) => !v)}
            aria-pressed={showDone}
            title="배송관리 기준 보유 전량이 처리 완료된 시청자예요. 기록은 그대로 있고 화면에서만 접혀요."
          >
            {showDone ? `배송완료 ${doneView.length}명 접기 ▲` : `배송완료 ${doneView.length}명 보기 ▼`}
          </button>
        ) : null}
      </div>

      {view.length === 0 ? (
        <p className={styles.fieldHint}>
          {q.trim() ? "조건에 맞는 보유자가 없어요." : "아직 보유 중인 업보가 없어요."}
        </p>
      ) : (
        <>
          {!q.trim() && !showDone && activeView.length === 0 ? (
            <p className={styles.fieldHint}>
              남은(미배송) 업보가 없어요 — 배송 전량완료 {doneView.length}명은 위 «배송완료 보기» 버튼으로 볼 수 있어요.
            </p>
          ) : null}
        <ul className={styles.ieList}>
          {(q.trim() || showDone ? view : activeView).map((group) => {
            const key = group.key;
            const open = openHistory[key] ?? false;
            const ledgerEvents = open ? eventsForOwner(group) : [];
            // 배송 장부 기준 처리 현황 배지. 전량완료는 기본 목록에서 접힌다(검색·펼침 시 표시).
            const dd = deliveryDoneByOwner.get(key);
            const allDone = allDoneKeys.has(key);
            const partialDone = !allDone && (dd?.done ?? 0) > 0;
            return (
              <li key={key} className={styles.ieCard}>
                <div className={styles.ieCardHead}>
                  <div className={styles.ieIdentity}>
                    <span className={styles.ieName}>{group.ownerName || "(이름 없음)"}</span>
                    {group.ownerId ? <span className={styles.ieId}>{group.ownerId}</span> : null}
                    <span className={styles.ieTotal}>{group.total}개</span>
                    {allDone ? (
                      <span className={styles.tagActive} title="배송관리 기준 보유 전량 처리 완료">
                        배송완료
                      </span>
                    ) : partialDone ? (
                      <span className={styles.tagMuted} title="배송관리 기준 처리 수량 / 보유 수량">
                        배송 {dd?.done}/{dd?.total}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.ieActions}>
                    {(["transfer", "exchange", "cancel"] as ActionType[]).map((t) => {
                      const lbl = ACTION_LABELS[t];
                      const Icon = lbl.Icon;
                      return (
                        <button
                          key={t}
                          type="button"
                          className={styles[lbl.cls]}
                          onClick={() => openAction(group, t)}
                        >
                          <Icon /> {lbl.verb}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className={styles.ieHistoryBtn}
                      onClick={() => toggleHistory(key)}
                      aria-expanded={open}
                    >
                      <IconHistory /> 이력
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className={styles.ieHistory}>
                    {ledgerEvents.length === 0 ? (
                      <p className={styles.fieldHint}>아직 변경 이력이 없어요. (원본 그대로)</p>
                    ) : (
                      <ol className={styles.ieTimeline}>
                        {ledgerEvents.map((ev) => {
                          const bundleGid =
                            ev.eventType === "exchange" && ev.afterJson?.exchangeOut === true
                              ? String(ev.afterJson?.exchangeGroupId ?? "")
                              : "";
                          const alreadyReverted =
                            revertedEventIds.has(ev.id) ||
                            (bundleGid !== "" && revertedEventIds.has(`group:${bundleGid}`));
                          const revertible =
                            !alreadyReverted &&
                            (ev.eventType === "transfer" ||
                              ev.eventType === "exchange" ||
                              ev.eventType === "cancel");
                          return (
                            <li key={ev.id} className={styles.ieEvent}>
                              <span className={styles.ieEventDot} aria-hidden="true" />
                              <div className={styles.ieEventBody}>
                                <div className={styles.ieEventHead}>
                                  <span className={styles.ieEventLabel}>
                                    {EVENT_LABEL[ev.eventType] ?? ev.eventType}
                                  </span>
                                  {ev.quantityDelta != null ? (
                                    <span className={styles.ieEventQty}>{ev.quantityDelta}개</span>
                                  ) : null}
                                  <span className={styles.ieEventTime}>{fmtKst(ev.createdAt)}</span>
                                  {revertible ? (
                                    <button
                                      type="button"
                                      className={styles.ieRevertBtn}
                                      onClick={() => revert(ev)}
                                      disabled={reverting === ev.id}
                                    >
                                      <IconRestore />{" "}
                                      {reverting === ev.id
                                        ? "처리 중…"
                                        : bundleGid
                                          ? "묶음 되돌리기"
                                          : "되돌리기"}
                                    </button>
                                  ) : alreadyReverted ? (
                                    <span className={styles.tagMuted}>되돌려짐</span>
                                  ) : null}
                                </div>
                                <Delta ev={ev} />
                                {ev.reason ? <p className={styles.ieEventReason}>{ev.reason}</p> : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        </>
      )}

      {action && meta ? (
        <div className={styles.modalOverlay} role="presentation" onClick={closeModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ie-modal-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="ie-modal-title" className={styles.modalTitle}>
              {meta.title}
            </h3>
            <p className={styles.ieModalTarget}>
              <span className={styles.dmName}>{action.group.ownerName || "(이름 없음)"}</span>
              {action.group.ownerId ? <span className={styles.dmId}>{action.group.ownerId}</span> : null}
              <span className={styles.ieModalItem}>보유 {action.group.total}개 · {action.merged.length}종</span>
            </p>

            <div className={styles.ieTabs} role="tablist" aria-label="처리 종류">
              {(["transfer", "exchange", "cancel"] as ActionType[]).map((t) => {
                const lbl = ACTION_LABELS[t];
                const Icon = lbl.Icon;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={actionType === t}
                    className={actionType === t ? styles.ieTabOn : styles.ieTab}
                    onClick={() => {
                      setActionType(t);
                      setFormError(null);
                    }}
                  >
                    <Icon /> {lbl.verb}
                  </button>
                );
              })}
            </div>

            <div className={styles.ieForm}>
              {/* 상품별 수량 선택 (배송 관리와 같은 스테퍼 UI) */}
              <div className={styles.ieField}>
                <span className={styles.ieLabel}>
                  상품 선택 <span className={styles.ieReq}>*</span>{" "}
                  <span className={styles.ieOptional}>({selectedTotal}개 선택됨)</span>
                </span>
                <div className={styles.ieQuickRow}>
                  <button type="button" className={styles.dmAllBtn} onClick={selectAll}>
                    전체 선택
                  </button>
                  <button type="button" className={styles.dmClearBtn} onClick={clearAll} disabled={selectedTotal <= 0}>
                    초기화
                  </button>
                </div>
                <div className={styles.modalBody}>
                  {action.merged.map((m) => {
                    const n = Math.min(sel[m.key] ?? 0, m.quantity);
                    const badge = mergedBadge(m);
                    return (
                      <div key={m.key} className={styles.dmItemRow}>
                        <span className={styles.dmItemName}>
                          {m.itemName}
                          <span className={styles.dmItemProb}>{m.probability}%</span>
                          {badge ? <span className={badge.cls}>{badge.label}</span> : null}
                        </span>
                        <div className={styles.dmStepper}>
                          <button
                            type="button"
                            onClick={() => setSelQty(m.key, n - 1, m.quantity)}
                            disabled={n <= 0}
                            aria-label={`${m.itemName} 수량 감소`}
                          >
                            −
                          </button>
                          <span className={n > 0 ? styles.dmCountDone : styles.dmCount}>
                            {n}/{m.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelQty(m.key, n + 1, m.quantity)}
                            disabled={n >= m.quantity}
                            aria-label={`${m.itemName} 수량 증가`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {actionType === "transfer" ? (
                <>
                  <div className={styles.ieField}>
                    <span className={styles.ieLabel}>
                      양도받을 사람 계정ID <span className={styles.ieReq}>*</span>
                    </span>
                    <div className={styles.ieCombo}>
                      <div className={styles.ieComboInputRow}>
                        <input
                          ref={firstFieldRef as React.RefObject<HTMLInputElement>}
                          className={styles.ieInput}
                          value={ownerId}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOwnerId(v);
                            // 첫 글자를 입력한 뒤부터 자동완성 목록을 띄운다(비어 있으면 닫음).
                            setIdListOpen(v.trim().length > 0);
                          }}
                          // 포커스만으로는 열지 않는다. 이미 입력값이 있을 때만 다시 표시.
                          onFocus={() => setIdListOpen(ownerId.trim().length > 0)}
                          onBlur={() => window.setTimeout(() => setIdListOpen(false), 150)}
                          placeholder={idExample ? `예: ${idExample} (직접 입력도 돼요)` : "계정ID 입력 (직접 입력도 돼요)"}
                          role="combobox"
                          aria-expanded={idListOpen}
                          aria-controls="ie-transfer-id-list"
                          aria-autocomplete="list"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          className={styles.ieComboBtn}
                          onClick={() => {
                            // ▾ = 전체 목록 보기(빈 칸이어도). onFocus가 덮어쓰지 않도록 focus 뒤에 상태를 정한다.
                            const next = !idListOpen;
                            firstFieldRef.current?.focus();
                            setIdListOpen(next);
                          }}
                          aria-label="계정 목록 열기"
                          tabIndex={-1}
                        >
                          ▾
                        </button>
                      </div>
                      {idListOpen ? (
                        <div className={styles.ieComboList} role="listbox" id="ie-transfer-id-list">
                          {idSuggestions.length === 0 ? (
                            <p className={styles.ieComboEmpty}>
                              일치하는 계정이 없어요. 그대로 입력하면 새 계정으로 처리돼요.
                            </p>
                          ) : (
                            idSuggestions.map((a) => (
                              <button
                                type="button"
                                key={a.id}
                                className={styles.ieComboItem}
                                // input의 blur보다 먼저 선택되도록 mousedown에서 처리(preventDefault로 blur 억제).
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setOwnerId(a.id);
                                  if (!ownerName.trim() && a.nickname) setOwnerName(a.nickname);
                                  setIdListOpen(false);
                                }}
                              >
                                <span className={styles.ieComboItemId}>{a.id}</span>
                                {a.nickname ? (
                                  <span className={styles.ieComboItemNick}>{a.nickname}</span>
                                ) : null}
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                    <span className={styles.ieFormHint}>
                      룰렛기록이 있는 계정 {accountOptions.length}명 중에서 고르거나, 기록 없는 새 사람은 직접 입력하세요.
                    </span>
                  </div>
                  <label className={styles.ieField}>
                    <span className={styles.ieLabel}>
                      닉네임 <span className={styles.ieOptional}>(선택 — 비우면 기존 기록에서 자동으로 채워요)</span>
                    </span>
                    <input
                      className={styles.ieInput}
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder={nickExample ? `예: ${nickExample}` : "닉네임 입력"}
                    />
                  </label>
                </>
              ) : actionType === "exchange" ? (
                <>
                  <div className={styles.ieField}>
                    <span className={styles.ieLabel}>
                      받을 상품 고르기 <span className={styles.ieReq}>*</span>
                    </span>
                    {otherRouletteAvailable ? (
                      <label className={styles.ieAltToggle}>
                        <input
                          type="checkbox"
                          checked={showAllRoulettes}
                          onChange={(e) => setShowAllRoulettes(e.target.checked)}
                        />
                        <span>다른 룰렛 상품도 보기</span>
                      </label>
                    ) : null}
                    <select
                      ref={firstFieldRef as React.RefObject<HTMLSelectElement>}
                      className={styles.ieSelect}
                      value={effectivePick}
                      onChange={(e) => setExchangePick(e.target.value)}
                    >
                      {showRouletteGroups
                        ? rouletteGroupsForSelect.map((g) => (
                            <optgroup key={g.rid} label={g.label}>
                              {g.items.map((c) => (
                                <option key={choiceKey(c)} value={choiceKey(c)}>
                                  {c.itemName} · {c.probability}%
                                </option>
                              ))}
                            </optgroup>
                          ))
                        : visibleCatalog.map((c) => (
                            <option key={choiceKey(c)} value={choiceKey(c)}>
                              {c.itemName} · {c.probability}%
                            </option>
                          ))}
                      <option value={CUSTOM_ITEM}>직접 입력…</option>
                    </select>
                    <span className={styles.ieFormHint}>
                      {showAllRoulettes
                        ? "켜진(사용) 모든 룰렛의 상품을 보여줘요."
                        : "이 상품이 나온 같은 룰렛의 상품만 보여줘요."}
                    </span>
                  </div>
                  {effectivePick === CUSTOM_ITEM ? (
                    <>
                      <label className={styles.ieField}>
                        <span className={styles.ieLabel}>
                          상품 이름 <span className={styles.ieReq}>*</span>
                        </span>
                        <input
                          className={styles.ieInput}
                          value={customItem}
                          onChange={(e) => setCustomItem(e.target.value)}
                          placeholder="예: 치킨 쿠폰"
                        />
                      </label>
                      <label className={styles.ieField}>
                        <span className={styles.ieLabel}>
                          확률(%) <span className={styles.ieOptional}>(선택)</span>
                        </span>
                        <input
                          className={styles.ieInput}
                          value={customProb}
                          onChange={(e) => setCustomProb(e.target.value)}
                          inputMode="decimal"
                          placeholder="예: 5"
                        />
                      </label>
                    </>
                  ) : null}
                  <div className={styles.ieQuickRow}>
                    <button type="button" className={styles.dmAllBtn} onClick={addReceive}>
                      + 받을 목록에 담기
                    </button>
                  </div>
                  <div className={styles.ieField}>
                    <span className={styles.ieLabel}>
                      받을 상품 목록{" "}
                      <span className={styles.ieOptional}>
                        ({receiveTotal}개 — 주는 개수({selectedTotal}개)와 달라도 돼요)
                      </span>
                    </span>
                    {receives.length === 0 ? (
                      <span className={styles.ieFormHint}>
                        위에서 상품을 골라 담아 주세요. 여러 종류를 섞어도 되고, 개수도 자유예요.
                      </span>
                    ) : (
                      <div className={styles.modalBody}>
                        {receives.map((r) => (
                          <div key={r.key} className={styles.dmItemRow}>
                            <span className={styles.dmItemName}>
                              {r.itemName}
                              {r.probability != null ? (
                                <span className={styles.dmItemProb}>{r.probability}%</span>
                              ) : null}
                            </span>
                            <div className={styles.dmStepper}>
                              <button
                                type="button"
                                onClick={() => setReceiveQty(r.key, r.qty - 1)}
                                aria-label={`${r.itemName} 받을 수량 감소`}
                              >
                                −
                              </button>
                              <span className={styles.dmCountDone}>{r.qty}</span>
                              <button
                                type="button"
                                onClick={() => setReceiveQty(r.key, r.qty + 1)}
                                aria-label={`${r.itemName} 받을 수량 증가`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              <label className={styles.ieField}>
                <span className={styles.ieLabel}>
                  사유{" "}
                  {actionType === "cancel" ? (
                    <span className={styles.ieReq}>*</span>
                  ) : (
                    <span className={styles.ieOptional}>(선택)</span>
                  )}
                </span>
                <input
                  ref={actionType === "cancel" ? (firstFieldRef as React.RefObject<HTMLInputElement>) : undefined}
                  className={styles.ieInput}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    actionType === "transfer"
                      ? "예: 방송 중 합의로 양도"
                      : actionType === "exchange"
                        ? "예: 재고 사정으로 교환"
                        : "예: 중복 집계 / 오입력"
                  }
                />
              </label>

              {/* 미리보기 */}
              <p className={styles.iePreview}>
                {actionType === "transfer" ? (
                  <>
                    <span className={styles.iePreviewFrom}>{action.group.ownerName || "현재 보유자"}</span>
                    <span className={styles.ieArrow} aria-hidden="true">→</span>
                    <span className={styles.iePreviewTo}>{ownerName.trim() || "(받을 사람)"}</span>
                    <span className={styles.iePreviewQty}>{previewSummary}</span>
                  </>
                ) : actionType === "exchange" ? (
                  <>
                    <span className={styles.iePreviewFrom}>{previewSummary}</span>
                    <span className={styles.ieArrow} aria-hidden="true">→</span>
                    <span className={styles.iePreviewTo}>{previewReceive}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.iePreviewTo}>{previewSummary} 취소</span>
                    <span className={styles.iePreviewQty}>공개 시트에서 숨김</span>
                  </>
                )}
              </p>

              <p className={styles.ieFormHint}>{meta.hint}</p>
              {formError ? (
                <p className={styles.ieFieldError} role="alert">
                  {formError}
                </p>
              ) : null}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className={styles.modalCancel} onClick={closeModal} disabled={saving}>
                닫기
              </button>
              <button
                type="button"
                className={actionType === "cancel" ? styles.ieConfirmDanger : styles.modalConfirm}
                onClick={submitAction}
                disabled={saving || selectedTotal <= 0 || (actionType === "exchange" && receiveTotal <= 0)}
              >
                {saving ? "처리 중…" : meta.verb}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 한 이벤트의 before/after 차이를 사람이 읽는 라벨로.
function Delta({ ev }: { ev: ItemEvent }) {
  const before = ev.beforeJson ?? {};
  const after = ev.afterJson ?? {};
  // N:M 번들 교환(주는 쪽): 주고받은 묶음을 그대로 보여준다.
  if (after.exchangeOut === true) {
    const fmt = (raw: unknown) =>
      Array.isArray(raw)
        ? raw
            .map((x) => {
              const r = (x ?? {}) as Record<string, unknown>;
              return typeof r.itemName === "string" && r.itemName
                ? `${r.itemName} ${Number(r.quantity) || "?"}개`
                : "";
            })
            .filter(Boolean)
            .join(" + ")
        : "";
    const gave = fmt(after.gave);
    const received = fmt(after.received);
    if (gave || received) {
      return (
        <div className={styles.ieDelta}>
          <span className={styles.ieDeltaRow}>
            <span className={styles.ieDeltaKey}>묶음 교환</span>
            <span className={styles.ieDeltaFrom}>{gave || "—"}</span>
            <span className={styles.ieArrow} aria-hidden="true">→</span>
            <span className={styles.ieDeltaTo}>{received || "—"}</span>
          </span>
        </div>
      );
    }
  }
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const labelOf: Record<string, string> = {
    currentOwnerName: "소유자",
    currentOwnerId: "계정ID",
    currentItemName: "상품",
    currentItemProbability: "확률",
    currentAmountRangeLabel: "룰렛 세트",
    status: "상태",
    quantityCurrent: "수량",
  };
  const rows = keys
    .filter((k) => k in labelOf)
    .map((k) => ({ k, from: before[k], to: after[k] }))
    .filter((r) => String(r.from ?? "") !== String(r.to ?? ""));
  if (rows.length === 0) return null;
  return (
    <div className={styles.ieDelta}>
      {rows.map((r) => (
        <span key={r.k} className={styles.ieDeltaRow}>
          <span className={styles.ieDeltaKey}>{labelOf[r.k] ?? r.k}</span>
          <span className={styles.ieDeltaFrom}>{String(r.from ?? "—")}</span>
          <span className={styles.ieArrow} aria-hidden="true">→</span>
          <span className={styles.ieDeltaTo}>{String(r.to ?? "—")}</span>
        </span>
      ))}
    </div>
  );
}
