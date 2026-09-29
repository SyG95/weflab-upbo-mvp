"use client";

// 수동기록 관리 화면. 위플랩에 안 잡히는 룰렛 결과·정가 시그니처를 스트리머가 직접 넣는 "입력/보관 창구".
// 저장 실체는 upbo_entries(source_key manual:...) 라서, 배송·양도교환·팬화면은 자동수집분과 동등하게 다룬다.
// 여기서는 추가 / 목록 / 개수 수정 / 후원 날짜 붙이기·바꾸기 / 탭 바꾸기(한 건·여러 건) / 삭제(수동분만)만 한다.
// 후원 날짜(2026-09-20): 앞으로 넣는 수동기록은 날짜(기본 오늘)가 같이 저장돼 배송 기간·월별·팬 탭이 잡힌다.
// 옛 수동기록은 목록의 [날짜 붙이기] 를 눌러야만 바뀐다(자동 소급 없음 — sy 결정).
// 탭 고르기(2026-09-21 직접 입력만 → 2026-09-29 표 상품 포함, 루빗 건의): 정가 빼고 모든 수동기록이 "어느 탭에
// 넣을까요"를 고를 수 있다 — 룰렛 탭 / 내가 만든 탭 / 새 탭 이름. 기본("")은 상품이 정한 탭(표에 없는 상품은 "표에 없음").
// 저장은 admin_note JSON 의 tabHint(스키마 0). 팬 화면은 힌트가 있으면 힌트를 먼저 본다(page.tsx resolveHoldingTabRid).
// 목록에서는 한 건씩 [탭 바꾸기] 또는 체크해서 여러 건을 한 번에 옮긴다(PATCH {ids, tabHint}).

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { normalizeAccountId, parseDonateTimeMs, type UpboEntry } from "../../lib/api";
import { bucketLabel } from "../../lib/deliveryPeriod";
import {
  kstDateOf,
  kstTodayOf,
  kstYesterdayOf,
  manualDonateTimeText,
  manualEntryDateLabel,
  manualEntryDateValue,
  type ManualDateMode,
} from "../../lib/manualEntryDate";
import {
  MANUAL_TAB_NAME_MAX,
  cleanCustomTabName,
  customNameOfKey,
  customTabKey,
  isCustomTabKey,
  sortCustomTabNames,
  type ManualTabHint,
} from "../../lib/manualTabHint";

// 수동기록 폼 "어느 탭에 넣을까요" 룰렛 선택지(page.tsx RouletteIndex.tabChoices). hintLabel = 팬 화면이 탭을 되찾는 금액대 라벨.
type TabChoice = { rid: string; label: string; hintLabel: string };

// 탭 select 값: "" = 표에 없음(기본), "rid:<rid>" = 룰렛 탭, "custom:<이름>" = 이미 있는 내 탭, NEW_TAB = 새 탭 이름 쓰기.
const NEW_TAB = "__new__";
const TAB_RID_PREFIX = "rid:";
// 여러 건 탭 바꾸기 요청 1회 크기 — 서버 BULK_TAB_MAX(100)와 같다.
const BULK_CHUNK = 100;

// select 값 + 새 이름 → 저장할 힌트(null = 표에 없음). 이름이 비면 error.
function hintOfTabPick(
  value: string,
  newName: string,
  tabChoices: TabChoice[],
): { hint: ManualTabHint | null } | { error: string } {
  if (value === "") return { hint: null };
  if (value === NEW_TAB) {
    // 서버(cleanManualTabHint)와 같은 정제 — 보이지 않는 글자 제거·코드포인트 30자.
    const name = cleanCustomTabName(newName);
    if (!name) return { error: "새 탭 이름을 적어 주세요. (예: 이벤트)" };
    return { hint: { kind: "custom", name } };
  }
  if (isCustomTabKey(value)) return { hint: { kind: "custom", name: customNameOfKey(value) } };
  if (value.startsWith(TAB_RID_PREFIX)) {
    const rid = value.slice(TAB_RID_PREFIX.length);
    const choice = tabChoices.find((t) => t.rid === rid);
    if (!choice || !choice.hintLabel) return { error: "고른 룰렛 탭을 찾을 수 없어요. 탭을 다시 골라 주세요." };
    return { hint: { kind: "label", label: choice.hintLabel, rid: choice.rid } };
  }
  return { error: "탭을 다시 골라 주세요." };
}

// 힌트 → 화면에 보이는 탭 이름. label 은 팬 화면 규칙(resolveHintedTabRid)을 같은 순서로 따른다:
// 같은 금액대 룰렛 탭이 1개면 그 탭, 2개 이상이면 rid 가 맞는 탭, 그 외(표에서 사라진 금액대)는 «이전 표 · L».
function tabNameOfHint(hint: ManualTabHint | null | undefined, tabChoices: TabChoice[]): string {
  if (!hint || hint.kind === "other") return "표에 없음";
  if (hint.kind === "custom") return hint.name;
  const same = tabChoices.filter((t) => t.hintLabel === hint.label);
  if (same.length === 1) return `룰렛 ${same[0].label}`;
  const byRid = same.length >= 2 && hint.rid ? same.find((t) => t.rid === hint.rid) : undefined;
  if (byRid) return `룰렛 ${byRid.label}`;
  return `이전 표 · ${hint.label}`;
}

// 저장된 힌트 → 목록 [탭 바꾸기] select 의 초깃값. 표에서 사라진 룰렛 탭이면 ""(표에 없음)에서 다시 고른다.
function tabPickOfHint(hint: ManualTabHint | null | undefined, tabChoices: TabChoice[], customNames: string[]): string {
  if (!hint || hint.kind === "other") return "";
  if (hint.kind === "custom") return customNames.includes(hint.name) ? customTabKey(hint.name) : "";
  const same = tabChoices.filter((t) => t.hintLabel === hint.label);
  const target = same.length === 1 ? same[0] : same.find((t) => t.rid === hint.rid);
  return target ? TAB_RID_PREFIX + target.rid : "";
}

// "어느 탭에 넣을까요" select(+ 새 탭 이름 입력). 추가 폼과 목록 [탭 바꾸기] 가 같은 선택지를 쓴다.
function TabHintSelect({
  value,
  newName,
  onChange,
  onNewName,
  tabChoices,
  customNames,
  disabled,
  compact,
  defaultLabel,
}: {
  value: string;
  newName: string;
  onChange: (value: string) => void;
  onNewName: (name: string) => void;
  tabChoices: TabChoice[];
  customNames: string[];
  disabled?: boolean;
  // 목록 줄 안(인라인)에서는 날짜 입력과 같은 36px 높이.
  compact?: boolean;
  // "" 선택지 문구. 표에 있는 상품은 "상품이 정한 탭", 표에 없는 상품은 "표에 없음"이 기본이라 문구가 다르다(2026-09-29).
  defaultLabel?: string;
}) {
  const roulettes = tabChoices.filter((t) => t.hintLabel);
  return (
    <>
      <select
        className={styles.ieSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="어느 탭에 넣을까요"
      >
        <option value="">{defaultLabel ?? "표에 없음 (기본)"}</option>
        {roulettes.length > 0 ? (
          <optgroup label="룰렛 탭">
            {roulettes.map((t) => (
              <option key={t.rid} value={TAB_RID_PREFIX + t.rid}>
                룰렛 {t.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {customNames.length > 0 ? (
          <optgroup label="내가 만든 탭">
            {customNames.map((n) => (
              <option key={n} value={customTabKey(n)}>
                {n}
              </option>
            ))}
          </optgroup>
        ) : null}
        <option value={NEW_TAB}>새 탭 이름 쓰기…</option>
      </select>
      {value === NEW_TAB ? (
        <input
          className={compact ? `${styles.ieInput} ${styles.ieDateInput}` : styles.ieInput}
          value={newName}
          onChange={(e) => onNewName(e.target.value)}
          placeholder="예: 이벤트, 핀볼"
          maxLength={MANUAL_TAB_NAME_MAX}
          disabled={disabled}
          aria-label="새 탭 이름"
        />
      ) : null}
    </>
  );
}

type ItemChoice = {
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  catalogGroupIndex?: number;
  rouletteId?: string;
  rouletteLabel?: string;
};

// "직접 입력"(룰렛확률표에 없는 상품) 선택지 sentinel — 교환 모달(ItemEventManager)과 동일 패턴.
const CUSTOM_ITEM = "__custom__";
// "정가 시그니처" sentinel — 나눠 낸 후원 등 수집기(단일 후원 갯수 일치)가 못 잡은 정가를 손으로 넣는다.
// 자동 정가기록과 같은 모양(itemName `정가 N개`, 확률 0, 라벨 "정가")으로 저장해야 팬 화면 정가 탭에서 합산된다.
const FIXED_ITEM = "__fixed__";
// "그날 표"(후원 날짜 당시 룰렛표) 상품 선택지 접두 — 현재 표 choiceKey 와 절대 겹치지 않게 한다.
const PAST_PREFIX = "__past__@@";

const MONTHLY = { mode: "monthly" as const, cutoffs: [] };

// 그날 표 조회 상태(관리자 on-demand GET catalog-items-at). 날짜가 활성 표 캡처일보다 이를 때만 부른다.
type PastTable =
  | { status: "idle" }
  | { status: "loading"; date: string }
  | { status: "error"; date: string; text: string }
  | { status: "same"; date: string }
  | { status: "ready"; date: string; version: number; capturedAt: string | null; items: ItemChoice[] };

export default function ManualEntryManager({
  slug,
  entries,
  catalogItems,
  catalogVersion,
  catalogCapturedAt,
  currentItemTabs,
  tabChoices,
  signatureCounts,
}: {
  slug: string;
  entries: UpboEntry[];
  catalogItems: ItemChoice[];
  catalogVersion: number | null;
  // 활성 표 캡처 시각(ISO). 고른 후원 날짜가 이보다 이르면 "그날 표" 상품을 추가로 보여준다.
  catalogCapturedAt: string | null;
  // 현재 표 상품명 → 팬 탭 이름(보관 룰렛이면 ""). 팬 화면이 상품명으로 탭을 먼저 찾으므로,
  // 도착지 미리보기가 실제 도착 탭과 어긋나지 않게 같은 색인을 쓴다.
  currentItemTabs: Record<string, string>;
  // 직접 입력 상품을 넣을 수 있는 룰렛 탭 목록(팬 탭 순서). hintLabel 이 빈 탭은 고를 수 없다.
  tabChoices: TabChoice[];
  signatureCounts: number[];
}) {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [idOpen, setIdOpen] = useState(false);
  const [pick, setPick] = useState(""); // choiceKey 또는 CUSTOM_ITEM / FIXED_ITEM / PAST_PREFIX+…
  // 직접 입력(룰렛확률표에 없는 상품): 이름 필수, 확률은 선택(없으면 0 — 정가·교환 직접입력과 동일 취급).
  const [customName, setCustomName] = useState("");
  const [customProb, setCustomProb] = useState("");
  // 직접 입력 상품을 넣을 탭(select 값)과 "새 탭 이름 쓰기…" 일 때의 이름. 기본 "" = 표에 없음.
  const [tabPick, setTabPick] = useState("");
  const [newTabName, setNewTabName] = useState("");
  // 정가 시그니처 갯수(풍선 갯수). 등록된 시그 갯수가 있으면 첫 값을 기본으로 깔아 준다.
  const [fixedCount, setFixedCount] = useState("");
  const [count, setCount] = useState(1);
  // 언제 후원했나요 — 기본 오늘. "날짜 고르기"면 date input 노출.
  // 렌더 중 Date.now() 를 부르지 않도록(렌더 순수성) 오늘 날짜는 처음 한 번 state 로 잡고,
  // 모드가 가리키는 날짜(donateDate)는 칩·date input 핸들러에서만 다시 계산한다. 저장 문자열은 제출 시점에 새로 만든다.
  const [today] = useState(() => kstTodayOf());
  const [dateMode, setDateMode] = useState<ManualDateMode>("today");
  const [pickedDate, setPickedDate] = useState("");
  const [donateDate, setDonateDate] = useState<string | null>(() => kstTodayOf());
  const [pastTable, setPastTable] = useState<PastTable>({ status: "idle" });
  const pastReq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 목록 줄의 날짜 편집(한 번에 한 줄).
  const [dateEdit, setDateEdit] = useState<{ id: string; value: string } | null>(null);
  // 목록 줄의 탭 편집(정가 빼고 모든 수동기록, 한 번에 한 줄).
  const [tabEdit, setTabEdit] = useState<{ id: string; value: string; newName: string } | null>(null);
  // 여러 건 한 번에 탭 바꾸기(2026-09-29, 루빗 건의): 체크한 수동기록 id 들과 일괄 select 값.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkPick, setBulkPick] = useState("");
  const [bulkNewName, setBulkNewName] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);

  // 이미 쓰고 있는 "내가 만든 탭" 이름(가나다순, 중복 제거) — 폼·목록 select 의 «내가 만든 탭» 묶음.
  const customNames = useMemo(
    () => sortCustomTabNames(entries.flatMap((e) => (e.manualTabHint?.kind === "custom" ? [e.manualTabHint.name] : []))),
    [entries],
  );

  // 시청자 계정 자동완성 후보(정가만 있는 계정 제외).
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

  const idSuggestions = useMemo(() => {
    const q = normalizeAccountId(ownerId).toLowerCase();
    const list = q
      ? accountOptions.filter(
          (a) => a.id.toLowerCase().startsWith(q) || a.nickname.toLowerCase().startsWith(q),
        )
      : accountOptions;
    return list.slice(0, 50);
  }, [accountOptions, ownerId]);

  // 상품 선택지(룰렛확률표, 사용 on + 업보 기준 이하) — 룰렛별 optgroup.
  const choiceKey = (c: ItemChoice) => `${c.rouletteId ?? ""}@@${c.itemName}@@${c.probability}`;
  const pastKey = (c: ItemChoice) => `${PAST_PREFIX}${c.catalogGroupIndex ?? ""}@@${c.itemName}@@${c.probability}`;
  const catalogSorted = useMemo(
    () =>
      [...catalogItems].sort(
        (a, b) => b.probability - a.probability || a.itemName.localeCompare(b.itemName),
      ),
    [catalogItems],
  );
  const rouletteGroups = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, { label: string; items: ItemChoice[] }>();
    for (const c of catalogSorted) {
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
  }, [catalogSorted]);
  const showGroups = rouletteGroups.length > 1;
  const picked = catalogItems.find((c) => choiceKey(c) === pick) ?? null;
  const pastItems = pastTable.status === "ready" ? pastTable.items : [];
  const pickedPast = pick.startsWith(PAST_PREFIX) ? (pastItems.find((c) => pastKey(c) === pick) ?? null) : null;
  // 현재 표에 있는 금액대 라벨 집합 — 그날 표 상품의 도착지 미리보기용.
  const currentLabels = useMemo(
    () => new Set(catalogItems.map((c) => c.amountRangeLabel?.trim() ?? "").filter(Boolean)),
    [catalogItems],
  );

  // 활성 표 캡처 시각(ms) — 저장할 후원 시각이 이보다 이르면 그날 표를 조회한다.
  const capturedMs = useMemo(() => {
    const ms = catalogCapturedAt ? Date.parse(catalogCapturedAt) : NaN;
    return Number.isNaN(ms) ? null : ms;
  }, [catalogCapturedAt]);

  // 후원 날짜(YYYY-MM-DD) — 모드에 따라. "unknown" 은 null.
  function effectiveDateOf(mode: ManualDateMode, dateValue: string): string | null {
    if (mode === "today") return kstTodayOf();
    if (mode === "yesterday") return kstYesterdayOf();
    if (mode === "pick") return dateValue.trim() || null;
    return null;
  }

  // 날짜가 바뀔 때마다 그날 표 후보를 맞춘다(이벤트 핸들러에서만 호출 — effect 없음).
  // 경계는 "저장할 시각" 그대로다 — 같은 날 표를 새로 캡처해도 그 전에 일어난 후원은 옛 표를 받는다.
  async function syncPastTable(date: string | null, at: string | null) {
    const token = ++pastReq.current;
    const atMs = at ? parseDonateTimeMs(at) : null;
    if (!date || !at || atMs === null || capturedMs === null || atMs >= capturedMs) {
      setPastTable({ status: "idle" });
      setPick((p) => (p.startsWith(PAST_PREFIX) ? "" : p));
      return;
    }
    setPastTable({ status: "loading", date });
    try {
      const res = await fetch(
        `/api/s/${encodeURIComponent(slug)}/catalog-items-at?at=${encodeURIComponent(at)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (token !== pastReq.current) return;
      if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
      if (data?.sameAsCurrent) {
        setPastTable({ status: "same", date });
        setPick((p) => (p.startsWith(PAST_PREFIX) ? "" : p));
        return;
      }
      const items: ItemChoice[] = Array.isArray(data?.items) ? data.items : [];
      setPastTable({
        status: "ready",
        date,
        version: Number(data?.version),
        capturedAt: typeof data?.capturedAt === "string" ? data.capturedAt : null,
        items,
      });
      // 이전 그날 표에서 고른 상품이 새 표에 없으면 선택 해제.
      setPick((p) => (p.startsWith(PAST_PREFIX) && !items.some((c) => pastKey(c) === p) ? "" : p));
    } catch (e) {
      if (token !== pastReq.current) return;
      setPastTable({
        status: "error",
        date,
        text: e instanceof Error && e.message ? e.message : "그날 표를 불러오지 못했어요.",
      });
      setPick((p) => (p.startsWith(PAST_PREFIX) ? "" : p));
    }
  }

  function chooseDateMode(mode: ManualDateMode) {
    setDateMode(mode);
    const date = effectiveDateOf(mode, pickedDate);
    setDonateDate(date);
    void syncPastTable(date, manualDonateTimeText(mode, pickedDate) || null);
  }

  function changePickedDate(value: string) {
    setPickedDate(value);
    const date = effectiveDateOf("pick", value);
    setDonateDate(date);
    void syncPastTable(date, manualDonateTimeText("pick", value) || null);
  }

  // 폼 select 기준으로 고른 탭(힌트). 새 탭 이름이 아직 비어 있으면 안내 문구.
  const formTabPick = hintOfTabPick(tabPick, newTabName, tabChoices);
  const formTabName = "hint" in formTabPick ? tabNameOfHint(formTabPick.hint, tabChoices) : "새 탭 (이름을 적어 주세요)";
  // 상품이 정하는 탭 = 탭을 안 골랐을 때 팬 화면이 보내는 곳. 2026-09-29(루빗 건의): 표에서 고른 상품도 탭을 고를 수
  // 있고, 골랐으면 팬 화면이 힌트를 먼저 본다(resolveHoldingTabRid). 정가만 탭 고르기 대상이 아니다.
  const productTab: string | null = (() => {
    if (pick === FIXED_ITEM) return "정가";
    if (pick === CUSTOM_ITEM) {
      const current = currentItemTabs[customName.trim()];
      if (current === undefined) return "표에 없음";
      return current || "보관된 룰렛(팬 화면에 안 보임)";
    }
    if (picked) {
      // 목록·팬 화면과 같은 이름(currentItemTabs = 팬 탭 표시명)을 우선 쓰고, 없을 때만 금액 나열 라벨로.
      const current = currentItemTabs[picked.itemName];
      if (current) return current;
      if (current === "") return "보관된 룰렛(팬 화면에 안 보임)";
      return picked.rouletteLabel ? `룰렛 ${picked.rouletteLabel}` : "룰렛";
    }
    if (pickedPast) {
      // 팬 화면은 상품명으로 현재 표 탭을 먼저 찾는다 — 같은 이름이 현재 표에도 있으면 그 탭으로 간다.
      const current = currentItemTabs[pickedPast.itemName];
      const L = pickedPast.amountRangeLabel?.trim() ?? "";
      if (current) return current;
      if (current === "") return "보관된 룰렛(팬 화면에 안 보임)";
      if (!L) return "표에 없음";
      if (currentLabels.has(L)) return `룰렛 ${L} (현재 표 금액대 — 구성이 많이 다르면 «이전 표 · ${L}»)`;
      return `이전 표 · ${L}`;
    }
    return null;
  })();
  const canPickFormTab = productTab !== null && pick !== FIXED_ITEM;
  const formDefaultTabLabel = productTab ? `${productTab} (기본 — 상품이 정한 탭)` : "표에 없음 (기본)";

  // 도착지 미리보기: → 팬 화면: {탭} · {월}. 상품을 골랐을 때만 그린다. 탭을 골랐으면 그 탭, 아니면 상품이 정한 탭.
  const destination = (() => {
    const tab: string | null =
      productTab === null ? null : canPickFormTab && tabPick !== "" ? formTabName : productTab;
    if (tab === null) return null;
    // "올해" 판단 기준도 state 의 오늘(렌더 중 Date.now() 없음).
    const nowMs = Date.parse(`${today}T00:00:00+09:00`);
    const month = donateDate ? bucketLabel(`m:${donateDate.slice(0, 7)}`, MONTHLY, nowMs) : "날짜 없음";
    return `→ 팬 화면: ${tab} · ${month}`;
  })();

  // 수동기록 목록(최근순).
  const manualEntries = useMemo(
    () =>
      entries
        .filter((e) => e.sourceKey?.startsWith("manual:"))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    [entries],
  );

  // 목록 줄에서 힌트가 없을 때 상품이 정하는 탭(표시용 근사) — 현재 표 상품명(팬 탭 표시명과 동일) → 되짚기 → 표에 없음.
  // 되짚기 부분은 팬 화면(resolvePastTabRid)의 상품 겹침·후보 2개 이상 규칙까지는 흉내 내지 않는다(금액대 라벨 기준).
  function productTabOfEntry(e: UpboEntry): string {
    const current = currentItemTabs[e.itemName];
    if (current !== undefined) return current || "보관된 룰렛(팬 화면에 안 보임)";
    const L = e.amountRangeLabel?.trim() ?? "";
    if (e.catalogVersion == null || !L) return "표에 없음";
    return currentLabels.has(L) ? `룰렛 ${L}` : `이전 표 · ${L}`;
  }

  // 여러 건 한 번에 탭 바꾸기(2026-09-29) — 정가는 대상이 아니다.
  const selectableIds = manualEntries.filter((e) => e.amountRangeLabel !== "정가").map((e) => e.id);
  // 화면에 지금 있는 줄 중 체크된 것만(삭제·새로고침으로 사라진 id 는 셈에서 빠진다).
  const validSelected = selectableIds.filter((id) => selected.has(id));
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelected(validSelected.length === selectableIds.length ? new Set() : new Set(selectableIds));
  }
  async function applyBulkTab() {
    const ids = validSelected;
    if (ids.length === 0) return;
    const pickedHint = hintOfTabPick(bulkPick, bulkNewName, tabChoices);
    if ("error" in pickedHint) {
      setMsg({ type: "err", text: pickedHint.error });
      return;
    }
    const targetName = pickedHint.hint ? tabNameOfHint(pickedHint.hint, tabChoices) : "상품이 정한 탭";
    if (
      !window.confirm(
        `선택한 ${ids.length}건을 «${targetName}»(으)로 옮길까요?\n팬 화면 탭이 바로 바뀌어요. 다시 골라서 되돌릴 수 있어요.`,
      )
    ) {
      return;
    }
    setBulkSaving(true);
    setMsg(null);
    let done = 0;
    try {
      // 서버 한도(BULK_TAB_MAX=100)에 맞춰 나눠 보낸다 — "전체 선택"이 100건을 넘어도 막히지 않는다.
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        const chunk = ids.slice(i, i + BULK_CHUNK);
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: chunk, tabHint: pickedHint.hint }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
        const n = Number(data?.updated);
        done += Number.isFinite(n) ? n : chunk.length;
      }
      setMsg({ type: "ok", text: `${done}건의 탭을 «${targetName}»(으)로 바꿨어요.` });
      setSelected(new Set());
      setBulkPick("");
      setBulkNewName("");
    } catch (e) {
      // 중간에 끊겼으면 앞 묶음은 이미 바뀌었다 — 몇 건까지 됐는지 알려 주고 목록을 새로 읽어 화면을 맞춘다.
      const reason = e instanceof Error && e.message ? e.message : "탭 저장에 실패했어요.";
      setMsg({ type: "err", text: done > 0 ? `${done}건은 바꿨고 그 뒤에서 실패했어요: ${reason}` : reason });
    } finally {
      setBulkSaving(false);
      router.refresh();
    }
  }

  async function addEntry() {
    const id = ownerId.trim();
    if (!id) {
      setMsg({ type: "err", text: "계정ID를 적어 주세요." });
      return;
    }
    // 직접 입력은 룰렛표와 무관한 상품 — 룰렛 연결(catalog) 없이 저장. DB는 상품명만 있으면 성립.
    let itemPayload: {
      itemName: string;
      probability: number;
      amountRangeLabel: string;
      catalogGroupIndex: number | null;
      catalogVersion: number | null;
    };
    // 탭 힌트(2026-09-29: 정가 빼고 모든 상품에서 고를 수 있다). 기본("")이면 payload 에서 생략 = 상품이 탭을 정한다.
    let tabHint: ManualTabHint | null = null;
    // 상품 자기 룰렛 탭을 굳이 고른 경우는 힌트를 안 남긴다 — 남기면 표가 바뀔 때 «이전 표 · L»에 묶여 상품을 따라가지 못한다.
    const ownTabPicked = Boolean(picked?.rouletteId) && tabPick === TAB_RID_PREFIX + (picked?.rouletteId ?? "");
    if (canPickFormTab && tabPick !== "" && !ownTabPicked) {
      if ("error" in formTabPick) {
        setMsg({ type: "err", text: formTabPick.error });
        return;
      }
      tabHint = formTabPick.hint;
    }
    if (pick === FIXED_ITEM) {
      // 정가 시그니처: 자동 정가기록(recordFixedPriceEntries)과 동일 지문으로 저장 — 정가 탭에서 합산.
      const n = Number(fixedCount.trim());
      if (!Number.isInteger(n) || n <= 0) {
        setMsg({ type: "err", text: "시그니처 갯수를 숫자로 적어 주세요. (예: 1000)" });
        return;
      }
      itemPayload = {
        itemName: `정가 ${n}개`,
        probability: 0,
        amountRangeLabel: "정가",
        catalogGroupIndex: null,
        catalogVersion: null,
      };
    } else if (pick === CUSTOM_ITEM) {
      const name = customName.trim();
      if (!name) {
        setMsg({ type: "err", text: "상품 이름을 적어 주세요." });
        return;
      }
      const p = customProb.trim();
      if (p !== "" && !Number.isFinite(Number(p))) {
        setMsg({ type: "err", text: "확률은 숫자로 적어 주세요. (예: 5)" });
        return;
      }
      itemPayload = {
        itemName: name,
        probability: p === "" ? 0 : Number(p),
        amountRangeLabel: "",
        catalogGroupIndex: null,
        catalogVersion: null,
      };
    } else if (pickedPast && pastTable.status === "ready") {
      // 그날 표 상품: 그 버전·그룹으로 저장 → 팬 탭 되짚기(1단계)가 금액대 탭 또는 "이전 표 · L" 로 보낸다.
      itemPayload = {
        itemName: pickedPast.itemName,
        probability: pickedPast.probability,
        amountRangeLabel: pickedPast.amountRangeLabel ?? "",
        catalogGroupIndex: pickedPast.catalogGroupIndex ?? null,
        catalogVersion: pastTable.version,
      };
    } else if (picked) {
      itemPayload = {
        itemName: picked.itemName,
        probability: picked.probability,
        amountRangeLabel: picked.amountRangeLabel ?? "",
        catalogGroupIndex: picked.catalogGroupIndex ?? null,
        catalogVersion,
      };
    } else {
      setMsg({ type: "err", text: "상품을 골라 주세요." });
      return;
    }
    const donateTimeText = manualDonateTimeText(dateMode, pickedDate);
    if (donateTimeText === null) {
      setMsg({ type: "err", text: "후원 날짜를 골라 주세요. (모르면 «날짜 모름»)" });
      return;
    }
    const known = accountOptions.find((a) => a.id === normalizeAccountId(id))?.nickname ?? "";
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fanId: id,
          fanNickname: ownerName.trim() || known,
          ...itemPayload,
          count,
          donateTimeText,
          ...(tabHint ? { tabHint } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
      setMsg({ type: "ok", text: "수동기록을 추가했어요." });
      setOwnerId("");
      setOwnerName("");
      setPick("");
      setCustomName("");
      setCustomProb("");
      setTabPick("");
      setNewTabName("");
      setFixedCount("");
      setCount(1);
      // 날짜 모드·고른 날짜·그날 표는 유지 — 같은 날 기록을 이어서 넣는 흐름이 잦다.
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "추가에 실패했어요." });
    } finally {
      setSaving(false);
    }
  }

  async function changeCount(id: string, next: number) {
    if (next < 1) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, count: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "개수 수정에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  // 목록 줄의 후원 날짜 저장(붙이기/바꾸기 = "YYYY-MM-DD 12:00", 지우기 = "").
  async function saveEntryDate(id: string, donateTimeText: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, donateTimeText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
      setMsg({ type: "ok", text: donateTimeText ? "후원 날짜를 저장했어요." : "후원 날짜를 지웠어요." });
      setDateEdit(null);
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error && e.message ? e.message : "날짜 저장에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  // 목록 줄(직접 입력만)의 탭 저장 → PATCH {id, tabHint}(표에 없음이면 null = 키 삭제).
  async function saveEntryTab(id: string) {
    if (!tabEdit || tabEdit.id !== id) return;
    const picked = hintOfTabPick(tabEdit.value, tabEdit.newName, tabChoices);
    if ("error" in picked) {
      setMsg({ type: "err", text: picked.error });
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, tabHint: picked.hint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
      // 기본("")으로 되돌렸으면 힌트 이름이 아니라 실제로 가는 곳(상품이 정한 탭)을 말해 준다.
      const target = manualEntries.find((e) => e.id === id);
      const shown = picked.hint
        ? tabNameOfHint(picked.hint, tabChoices)
        : target
          ? `${productTabOfEntry(target)} (상품이 정한 탭)`
          : "상품이 정한 탭";
      setMsg({ type: "ok", text: `탭을 «${shown}»(으)로 바꿨어요.` });
      setTabEdit(null);
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error && e.message ? e.message : "탭 저장에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  async function removeEntry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/s/${encodeURIComponent(slug)}/manual-entries?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setMsg({ type: "ok", text: "수동기록을 삭제했어요." });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "삭제에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  const dateChips: Array<{ mode: ManualDateMode; label: string }> = [
    { mode: "today", label: "오늘" },
    { mode: "yesterday", label: "어제" },
    { mode: "pick", label: "날짜 고르기" },
    { mode: "unknown", label: "날짜 모름" },
  ];
  const pastCaptureText =
    pastTable.status === "ready"
      ? pastTable.capturedAt && !Number.isNaN(Date.parse(pastTable.capturedAt))
        ? kstDateOf(Date.parse(pastTable.capturedAt))
        : "캡처일 미상"
      : "";

  return (
    <div className={styles.ieWrap}>
      {msg ? (
        <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p>
      ) : null}

      {/* 추가 폼 */}
      <div className={styles.ieForm}>
        <div className={styles.ieField}>
          <span className={styles.ieLabel}>
            시청자 계정ID <span className={styles.ieReq}>*</span>
          </span>
          <div className={styles.ieCombo}>
            <div className={styles.ieComboInputRow}>
              <input
                ref={idRef}
                className={styles.ieInput}
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  setIdOpen(e.target.value.trim().length > 0);
                }}
                onFocus={() => setIdOpen(ownerId.trim().length > 0)}
                onBlur={() => window.setTimeout(() => setIdOpen(false), 150)}
                placeholder={accountOptions[0] ? `예: ${accountOptions[0].id}` : "계정ID 입력"}
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.ieComboBtn}
                tabIndex={-1}
                aria-label="계정 목록 열기"
                onClick={() => {
                  const n = !idOpen;
                  idRef.current?.focus();
                  setIdOpen(n);
                }}
              >
                ▾
              </button>
            </div>
            {idOpen ? (
              <div className={styles.ieComboList} role="listbox">
                {idSuggestions.length === 0 ? (
                  <p className={styles.ieComboEmpty}>
                    일치하는 계정이 없어요. 그대로 넣으면 새 계정으로 처리돼요.
                  </p>
                ) : (
                  idSuggestions.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={styles.ieComboItem}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setOwnerId(a.id);
                        if (!ownerName.trim() && a.nickname) setOwnerName(a.nickname);
                        setIdOpen(false);
                      }}
                    >
                      <span className={styles.ieComboItemId}>{a.id}</span>
                      {a.nickname ? <span className={styles.ieComboItemNick}>{a.nickname}</span> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        <label className={styles.ieField}>
          <span className={styles.ieLabel}>
            닉네임 <span className={styles.ieOptional}>(선택 — 비우면 기존 기록에서 자동)</span>
          </span>
          <input
            className={styles.ieInput}
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="예: 달빛여우"
          />
        </label>

        <label className={styles.ieField}>
          <span className={styles.ieLabel}>
            상품 <span className={styles.ieReq}>*</span>
          </span>
          <select
            className={styles.ieSelect}
            value={pick}
            onChange={(e) => {
              const v = e.target.value;
              setPick(v);
              // 정가 선택 시 등록된 시그 갯수 첫 값을 기본으로 채워 준다(수정 가능).
              if (v === FIXED_ITEM && !fixedCount.trim() && signatureCounts[0]) {
                setFixedCount(String(signatureCounts[0]));
              }
            }}
          >
            <option value="">상품을 고르세요…</option>
            {pastTable.status === "ready" && pastItems.length > 0 ? (
              <optgroup label={`그날 표 (v${pastTable.version} · ${pastCaptureText} 캡처)`}>
                {pastItems.map((c) => (
                  <option key={pastKey(c)} value={pastKey(c)}>
                    {c.itemName} · {c.probability}%{c.rouletteLabel ? ` · ${c.rouletteLabel}` : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {showGroups
              ? rouletteGroups.map((g) => (
                  <optgroup key={g.rid} label={g.label}>
                    {g.items.map((c) => (
                      <option key={choiceKey(c)} value={choiceKey(c)}>
                        {c.itemName} · {c.probability}%
                      </option>
                    ))}
                  </optgroup>
                ))
              : catalogSorted.map((c) => (
                  <option key={choiceKey(c)} value={choiceKey(c)}>
                    {c.itemName} · {c.probability}%
                  </option>
                ))}
            <option value={FIXED_ITEM}>정가 시그니처… (수집에 안 잡힌 정가)</option>
            <option value={CUSTOM_ITEM}>직접 입력… (룰렛확률표에 없는 상품)</option>
          </select>
          {catalogItems.length === 0 ? (
            <span className={styles.ieFormHint}>
              룰렛확률표에 사용(on)으로 켜진 업보 대상 상품이 없어요. «설정 → 룰렛 상품 사용 설정»을
              먼저 켜거나, «직접 입력…»으로 넣을 수 있어요.
            </span>
          ) : null}
          {pastTable.status === "loading" ? (
            <span className={styles.ieFormHint}>{pastTable.date} 당시 룰렛표를 불러오는 중…</span>
          ) : pastTable.status === "error" ? (
            <span className={styles.ieFormHint}>그날 표를 불러오지 못했어요 — 현재 표 상품으로 넣을 수 있어요. ({pastTable.text})</span>
          ) : pastTable.status === "same" ? (
            <span className={styles.ieFormHint}>{pastTable.date} 당시 표는 현재 표와 같아요.</span>
          ) : pastTable.status === "ready" && pastItems.length === 0 ? (
            <span className={styles.ieFormHint}>
              {pastTable.date} 당시 표(v{pastTable.version})에는 업보 기준 이하 상품이 없어요 — 현재 표 상품이나 «직접 입력…»으로 넣을 수 있어요.
            </span>
          ) : pastTable.status === "ready" ? (
            <span className={styles.ieFormHint}>
              «그날 표» 상품을 고르면 그 당시 금액대 탭(현재 표에 없으면 «이전 표 · 금액대» 탭)으로 들어가요.
            </span>
          ) : null}
        </label>

        {pick === FIXED_ITEM ? (
          <label className={styles.ieField}>
            <span className={styles.ieLabel}>
              시그니처 갯수 <span className={styles.ieReq}>*</span>
            </span>
            <input
              className={styles.ieInput}
              value={fixedCount}
              onChange={(e) => setFixedCount(e.target.value)}
              inputMode="numeric"
              placeholder={signatureCounts[0] ? `예: ${signatureCounts[0]}` : "예: 1000"}
            />
            <span className={styles.ieFormHint}>
              {signatureCounts.length > 0
                ? `등록된 시그니처 갯수: ${signatureCounts.join(", ")} — 나눠 낸 후원처럼 수집에 안 잡힌 정가를 넣을 때 쓰세요. 팬 화면 «정가» 탭에 자동수집분과 합산돼요.`
                : "나눠 낸 후원처럼 수집에 안 잡힌 정가를 넣을 때 쓰세요. 팬 화면 «정가» 탭에 표시돼요."}
            </span>
          </label>
        ) : null}

        {pick === CUSTOM_ITEM ? (
          <>
            <label className={styles.ieField}>
              <span className={styles.ieLabel}>
                상품 이름 <span className={styles.ieReq}>*</span>
              </span>
              <input
                className={styles.ieInput}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="예: 팬미팅 초대권"
              />
            </label>
            <label className={styles.ieField}>
              <span className={styles.ieLabel}>
                확률(%) <span className={styles.ieOptional}>(선택 — 몰라도 됨)</span>
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

        {canPickFormTab ? (
          <div className={styles.ieField}>
            <span className={styles.ieLabel}>어느 탭에 넣을까요</span>
            <TabHintSelect
              value={tabPick}
              newName={newTabName}
              onChange={setTabPick}
              onNewName={setNewTabName}
              tabChoices={tabChoices}
              customNames={customNames}
              defaultLabel={formDefaultTabLabel}
            />
            <span className={styles.ieFormHint}>
              기본은 상품이 정한 탭이에요. 다른 탭에 두고 싶으면 여기서 고르세요(표에 있는 상품도 돼요). 새 탭 이름은 팬
              화면 «어느 룰렛» 줄에 그대로 떠요.
            </span>
          </div>
        ) : null}

        <div className={styles.ieField}>
          <span className={styles.ieLabel}>언제 후원했나요</span>
          <div className={styles.ieDateRow}>
            {dateChips.map((c) => (
              <button
                key={c.mode}
                type="button"
                className={styles.ieChipBtn}
                aria-pressed={dateMode === c.mode}
                onClick={() => chooseDateMode(c.mode)}
              >
                {c.label}
              </button>
            ))}
            {dateMode === "pick" ? (
              <input
                type="date"
                className={`${styles.ieInput} ${styles.ieDateInput}`}
                value={pickedDate}
                max={today}
                onChange={(e) => changePickedDate(e.target.value)}
                aria-label="후원 날짜"
              />
            ) : null}
          </div>
          <span className={styles.ieFormHint}>
            {dateMode === "unknown"
              ? "날짜 없이 저장돼요 — 배송 기간에서는 «기타», 팬 화면 월별에서는 «날짜 없음»으로 묶여요(옛 수동기록과 같음)."
              : "날짜가 있으면 배송 기간·월별 묶음에 자동수집분과 같이 들어가요. 어제·고른 날짜는 정오로 저장돼요."}
          </span>
          {destination ? <span className={styles.ieFormHint}>{destination}</span> : null}
        </div>

        <div className={styles.ieField}>
          <span className={styles.ieLabel}>개수</span>
          <div className={styles.dmStepper}>
            <button
              type="button"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              disabled={count <= 1}
              aria-label="개수 감소"
            >
              −
            </button>
            <span className={styles.dmCountDone}>{count}</span>
            <button
              type="button"
              onClick={() => setCount((c) => Math.min(9999, c + 1))}
              aria-label="개수 증가"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <button
            type="button"
            className={styles.modalConfirm}
            onClick={addEntry}
            disabled={
              saving ||
              !ownerId.trim() ||
              (dateMode === "pick" && !pickedDate.trim()) ||
              (pick === FIXED_ITEM
                ? !fixedCount.trim()
                : pick === CUSTOM_ITEM
                  ? !customName.trim()
                  : !picked && !pickedPast) ||
              (canPickFormTab && tabPick === NEW_TAB && !cleanCustomTabName(newTabName))
            }
          >
            {saving ? "추가 중…" : "수동기록 추가"}
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div className={styles.ieSummary}>
        <span className={styles.tag}>수동기록 {manualEntries.length}건</span>
        {selectableIds.length > 0 ? (
          <>
            <button type="button" className={styles.ieChipBtn} onClick={selectAll} disabled={bulkSaving}>
              {validSelected.length > 0 && validSelected.length === selectableIds.length ? "전체 해제" : "전체 선택"}
            </button>
            <span className={styles.ieFormHint}>
              선택 {validSelected.length}건 — 체크한 기록을 한 번에 다른 탭으로 옮길 수 있어요
            </span>
          </>
        ) : null}
      </div>
      {validSelected.length > 0 ? (
        <div className={styles.ieDateRow}>
          <span className={styles.ieFormHint}>선택한 {validSelected.length}건을 옮길 탭:</span>
          <TabHintSelect
            compact
            value={bulkPick}
            newName={bulkNewName}
            onChange={setBulkPick}
            onNewName={setBulkNewName}
            tabChoices={tabChoices}
            customNames={customNames}
            disabled={bulkSaving}
            defaultLabel="상품이 정한 탭으로 되돌리기 (기본)"
          />
          <button
            type="button"
            className={styles.ieChipBtn}
            disabled={bulkSaving || (bulkPick === NEW_TAB && !cleanCustomTabName(bulkNewName))}
            onClick={applyBulkTab}
          >
            {bulkSaving ? "옮기는 중…" : `${validSelected.length}건 탭 바꾸기`}
          </button>
          <button
            type="button"
            className={styles.ieChipBtn}
            disabled={bulkSaving}
            onClick={() => setSelected(new Set())}
          >
            선택 해제
          </button>
        </div>
      ) : null}
      {manualEntries.length === 0 ? (
        <p className={styles.fieldHint}>아직 수동기록이 없어요.</p>
      ) : (
        <ul className={styles.ieList}>
          {manualEntries.map((e) => {
            const cnt = Math.max(1, Number(e.effectiveCount ?? 1));
            const busy = busyId === e.id;
            const hasDate = manualEntryDateValue(e.donateTimeText) !== "";
            const editing = dateEdit?.id === e.id;
            // 정가 빼고 모든 수동기록이 탭을 고를 수 있다(2026-09-29). 힌트가 없으면 상품이 탭을 정한다(팬 화면과 동일).
            const canPickTab = e.amountRangeLabel !== "정가";
            const productTabOfRow = productTabOfEntry(e);
            // 힌트 없음: 표 상품은 "(상품이 정한 탭)", 표에 없는 상품은 "(기본)" — 둘 다 팬 화면이 실제로 보내는 곳.
            const rowTabName = e.manualTabHint
              ? tabNameOfHint(e.manualTabHint, tabChoices)
              : `${productTabOfRow} (${e.catalogVersion == null ? "기본" : "상품이 정한 탭"})`;
            const tabEditing = tabEdit?.id === e.id;
            const checked = selected.has(e.id);
            return (
              <li key={e.id} className={styles.ieCard}>
                <div className={styles.ieCardHead}>
                  <div className={styles.ieIdentity}>
                    {canPickTab ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(e.id)}
                        disabled={bulkSaving}
                        aria-label="탭 바꾸기 대상으로 선택"
                        style={{ width: 16, height: 16, marginRight: 4, cursor: "pointer" }}
                      />
                    ) : null}
                    <span className={styles.ieName}>{e.fanNickname || "(이름 없음)"}</span>
                    {e.fanId ? <span className={styles.ieId}>{e.fanId}</span> : null}
                    <span className={styles.dmItemName}>
                      {e.itemName}
                      <span className={styles.dmItemProb}>{e.probability}%</span>
                      {e.amountRangeLabel ? <span className={styles.upboSet}>{e.amountRangeLabel}</span> : null}
                    </span>
                  </div>
                  <div className={styles.ieActions}>
                    <div className={styles.dmStepper}>
                      <button
                        type="button"
                        onClick={() => changeCount(e.id, cnt - 1)}
                        disabled={busy || cnt <= 1}
                        aria-label="개수 감소"
                      >
                        −
                      </button>
                      <span className={styles.dmCountDone}>{cnt}개</span>
                      <button
                        type="button"
                        onClick={() => changeCount(e.id, cnt + 1)}
                        disabled={busy}
                        aria-label="개수 증가"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className={styles.ieChipBtnDanger}
                      onClick={() => removeEntry(e.id)}
                      disabled={busy}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <div className={styles.ieDateRow}>
                  <span className={styles.ieFormHint}>후원 날짜: {manualEntryDateLabel(e.donateTimeText)}</span>
                  {editing ? (
                    <>
                      <input
                        type="date"
                        className={`${styles.ieInput} ${styles.ieDateInput}`}
                        value={dateEdit.value}
                        max={today}
                        onChange={(ev) => setDateEdit({ id: e.id, value: ev.target.value })}
                        aria-label="후원 날짜"
                      />
                      <button
                        type="button"
                        className={styles.ieChipBtn}
                        disabled={busy || !dateEdit.value.trim()}
                        onClick={() => saveEntryDate(e.id, `${dateEdit.value.trim()} 12:00`)}
                      >
                        저장
                      </button>
                      {hasDate ? (
                        <button
                          type="button"
                          className={styles.ieChipBtn}
                          disabled={busy}
                          onClick={() => saveEntryDate(e.id, "")}
                        >
                          지우기
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.ieChipBtn}
                        disabled={busy}
                        onClick={() => setDateEdit(null)}
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.ieChipBtn}
                      disabled={busy}
                      onClick={() => setDateEdit({ id: e.id, value: manualEntryDateValue(e.donateTimeText) })}
                    >
                      {hasDate ? "날짜 바꾸기" : "날짜 붙이기"}
                    </button>
                  )}
                </div>
                {canPickTab ? (
                  <div className={styles.ieDateRow}>
                    <span className={styles.ieFormHint}>탭: {rowTabName}</span>
                    {tabEditing && tabEdit ? (
                      <>
                        <TabHintSelect
                          compact
                          defaultLabel={`${productTabOfRow} (기본 — 상품이 정한 탭)`}
                          value={tabEdit.value}
                          newName={tabEdit.newName}
                          onChange={(v) => setTabEdit({ id: e.id, value: v, newName: tabEdit.newName })}
                          onNewName={(n) => setTabEdit({ id: e.id, value: tabEdit.value, newName: n })}
                          tabChoices={tabChoices}
                          customNames={customNames}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className={styles.ieChipBtn}
                          disabled={busy || (tabEdit.value === NEW_TAB && !tabEdit.newName.trim())}
                          onClick={() => saveEntryTab(e.id)}
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          className={styles.ieChipBtn}
                          disabled={busy}
                          onClick={() => setTabEdit(null)}
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={styles.ieChipBtn}
                        disabled={busy}
                        onClick={() =>
                          setTabEdit({
                            id: e.id,
                            value: tabPickOfHint(e.manualTabHint, tabChoices, customNames),
                            newName: "",
                          })
                        }
                      >
                        탭 바꾸기
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
