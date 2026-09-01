"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import fpStyles from "./fixedPriceNote.module.css";
import HiddenViewersPanel from "./HiddenViewersPanel";
import {
  allocateDeliveryToRefs,
  DELIVERY_PROGRESS_TS_CUTOFF,
  type AggItem,
  type DeliveryAssignment,
  type DeliveryProgressItem,
  type OpsState,
  type RecordedKind,
  type ViewerNote,
  type ViewerSummary,
} from "../../lib/api";

// 정가기록(시그니처 후원) 1건 — 이 스트리머의 fixed: 프리픽스 entry 목록(page.tsx 에서 전달).
type FixedEntry = {
  sourceKey: string;
  fanId: string;
  fanNickname: string;
  itemName: string;
  donateTimeText?: string;
};

// 정가기록별 수기 메모 1건(entrySourceKey 단위, page.tsx 에서 전달).
type FixedPriceNote = {
  entrySourceKey: string;
  noteText: string;
  images?: string[];
  updatedAt?: string;
};

// 시청자 계정ID → 숲 방송국 주소. ch.sooplive.co.kr/{id} 는 www.sooplive.com/station/{id} 로
// 301 리다이렉트되므로 최종 주소를 바로 쓴다. 계정ID가 없으면 null → 버튼을 그리지 않는다.
// (숲이 없는 계정도 200을 주기 때문에 링크가 살아있는지는 미리 확인할 수 없다.)
function soopStationUrl(fanId: string | null | undefined): string | null {
  const id = (fanId ?? "").trim().toLowerCase();
  if (!id) return null;
  return `https://www.sooplive.com/station/${encodeURIComponent(id)}`;
}

const MAX_FIXED_NOTE_LEN = 2000;
// 메모당 첨부 이미지 최대 개수(서버 MAX_MEMO_IMAGES와 동일하게 맞춤).
const MAX_MEMO_IMAGES = 5;

// 메모 이미지 1장 업로드 → 공개 URL. 인증은 관리자 로그인 세션(쿠키)으로 처리.
async function uploadMemoImageFile(slug: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.set("image", file);
  const res = await fetch(`/api/s/${encodeURIComponent(slug)}/memo-image`, { method: "POST", body: fd });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || data.ok === false || typeof data.url !== "string") {
    throw new Error(typeof data.error === "string" && data.error ? data.error : "이미지 업로드 실패");
  }
  return data.url;
}

// 메모 이미지 첨부 UI(썸네일 + 추가 버튼 + 붙여넣기). 관리자 전용, 팬 화면엔 안 나온다.
function MemoImageAttach({
  slug,
  images,
  onChange,
  disabled,
  children,
}: {
  slug: string;
  images: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  // 메모 textarea를 감싸서, textarea에 이미지를 붙여넣으면(Ctrl+V) 자동 첨부되도록 한다.
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (imgs.length === 0) return;
      const room = MAX_MEMO_IMAGES - images.length;
      if (room <= 0) {
        setErr(`이미지는 최대 ${MAX_MEMO_IMAGES}장까지예요.`);
        return;
      }
      setErr(null);
      setBusy(true);
      try {
        const added: string[] = [];
        for (const f of imgs.slice(0, room)) added.push(await uploadMemoImageFile(slug, f));
        onChange([...images, ...added]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "이미지 업로드 실패");
      } finally {
        setBusy(false);
      }
    },
    [images, onChange, slug],
  );

  return (
    <div
      className={fpStyles.memoImgWrap}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length > 0) {
          e.preventDefault();
          void addFiles(files);
        }
      }}
    >
      {children}
      {images.length > 0 ? (
        <div className={fpStyles.memoThumbs}>
          {images.map((url, i) => (
            <div key={`${url}@${i}`} className={fpStyles.memoThumb}>
              <a href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="첨부 이미지" />
              </a>
              <button
                type="button"
                className={fpStyles.memoThumbDel}
                onClick={() => onChange(images.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label="이미지 삭제"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className={fpStyles.memoImgBar}>
        <button
          type="button"
          className={fpStyles.memoAddBtn}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy || images.length >= MAX_MEMO_IMAGES}
        >
          {busy ? "올리는 중…" : `＋ 이미지 (${images.length}/${MAX_MEMO_IMAGES})`}
        </button>
        <span className={fpStyles.memoImgHint}>붙여넣기(Ctrl+V)도 돼요 · 관리자만 보여요</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {err ? <span className={fpStyles.noteMsgErr}>{err}</span> : null}
    </div>
  );
}

// 시청자별 처리 상태: 자동 업보 총량은 서버 upbo_entries에서 계산하고,
// 스트리머가 처리한 수량만 별도 운영 DB 레이어에 저장한다.
type DeliveryState = Record<string, Record<string, number>>; // viewerKey(fanId) -> itemKey -> processedCount

type Change = {
  viewerKey: string;
  nickname: string;
  fanId: string;
  items: { itemName: string; from: number; to: number }[];
};

const itemKey = (it: AggItem) =>
  `${it.itemName}@@${it.probability}@@${it.amountRangeLabel ?? ""}`;

// ── 시각 표시 도우미 ──────────────────────────────────────────────────────────
// diff 저장 도입(컷오프) 이전의 delivery_progress.updated_at 은 "마지막 전체 저장 시각"이라
// 항목별 완료 시각이 아니다 — 컷오프 이후 값만 완료 시각으로 표시한다(결정 1 = A안: 이전분 미표시).
const TS_CUTOFF_MS = Date.parse(DELIVERY_PROGRESS_TS_CUTOFF);

// epoch ms → "6.10" (Asia/Seoul). 시각 없음은 호출 전에 걸러진다.
function fmtShortDate(ms: number): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}.${get("day")}`;
}

// ISO/epoch → "8/25 20:45" (Asia/Seoul) — 완료 시각 표시용.
function fmtShortDateTime(input: string | number): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

// 기록 시각으로부터의 경과일(그날=1일째). 오래 밀린 줄 강조 기준(30일)과 함께 쓴다.
const AGE_OLD_DAYS = 30;
function ageDaysFrom(ms: number, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - ms) / 86_400_000) + 1);
}

// 시각 출처 배지 문구 — donate(원문 후원 시각)는 배지 없이 날짜만.
const KIND_BADGE: Partial<Record<RecordedKind, { label: string; title: string }>> = {
  manual: { label: "수동", title: "수동기록 — 원문 후원 시각이 없어 기록 생성 시각으로 표시" },
  exchange: { label: "교환", title: "교환으로 받은 기록 — 교환된 시각이라 실제 대기 기간보다 짧아 보일 수 있어요" },
  created: { label: "반영", title: "원문 후원 시각을 해석하지 못해 시트 반영 시각으로 표시" },
};

// 한 줄(같은 상품 묶음)의 대표 기록 시각 = 조각들 중 가장 오래된 것(제일 밀린 빚 기준).
function lineRecordedInfo(it: AggItem): { ms: number; kind: RecordedKind | null; text?: string } | null {
  let best: { ms: number; kind: RecordedKind | null; text?: string } | null = null;
  for (const ref of it.refs ?? []) {
    const ms = ref.recordedAtMs;
    if (ms === null || ms === undefined) continue;
    if (!best || ms < best.ms) best = { ms, kind: ref.recordedKind ?? null, text: ref.recordedText };
  }
  return best;
}

// 배정 메모의 클라이언트 키(스트리머 전체에서 조각 1개를 특정).
const assignKey = (ownerKey: string, iKey: string, entryId: string) =>
  `${ownerKey}@@${iKey}@@${entryId}`;

function computeChanges(
  viewers: ViewerSummary[],
  committed: DeliveryState,
  draft: DeliveryState,
): Change[] {
  const out: Change[] = [];
  for (const v of viewers) {
    const items: Change["items"] = [];
    for (const it of v.items) {
      const k = itemKey(it);
      const from = Math.min(committed[v.key]?.[k] ?? 0, it.count);
      const to = Math.min(draft[v.key]?.[k] ?? 0, it.count);
      if (from !== to) items.push({ itemName: it.itemName, from, to });
    }
    if (items.length > 0) {
      out.push({ viewerKey: v.key, nickname: v.fanNickname, fanId: v.fanId, items });
    }
  }
  return out;
}

function progressToDeliveryState(progress: DeliveryProgressItem[]): DeliveryState {
  const state: DeliveryState = {};
  for (const item of progress) {
    if (!item.fanId || !item.itemKey) continue;
    state[item.fanId] = {
      ...(state[item.fanId] ?? {}),
      [item.itemKey]: Math.max(0, Math.floor(Number(item.processedCount || 0))),
    };
  }
  return state;
}

function notesToMap(notes: ViewerNote[]): Record<string, ViewerNote> {
  const out: Record<string, ViewerNote> = {};
  for (const note of notes) {
    if (note.fanId) out[note.fanId] = note;
  }
  return out;
}

export default function DeliveryManager({
  slug,
  viewers,
  fixedEntries,
  fixedPriceNotes,
  archivedHiddenCounts,
  hiddenViewers,
  archivedFanAt,
  entryCount,
}: {
  slug: string;
  viewers: ViewerSummary[];
  // 정가기록(시그니처 후원) 목록 — fanId 로 시청자와 매칭한다. 없으면 정가 UI 자체가 안 보인다.
  fixedEntries?: FixedEntry[];
  // 정가기록별 기존 메모 — entrySourceKey 로 매칭해 초기값으로 채운다.
  fixedPriceNotes?: FixedPriceNote[];
  // 보관 시청자의 숨긴 옛 당첨분 (fanId -> itemKey -> 개수). 저장된 처리수량 기준선 보정용.
  // page.tsx 가 "보관 시각 이후 새 당첨"만 걸러 viewers 로 넘기고, 그때 숨긴 옛 기록 개수를 여기로 준다.
  archivedHiddenCounts?: Record<string, Record<string, number>>;
  // 숨긴 시청자의 옛 기록(숨긴 시청자 탭 목록·복구 미리보기용). archivedHiddenCounts 와 같은 계산.
  hiddenViewers?: ViewerSummary[];
  // fanId -> 숨긴 시각(ISO). 숨긴 시청자 탭의 날짜 표시·정렬용.
  archivedFanAt?: Record<string, string>;
  // 서버가 로드한 upbo_entries 총 건수 — 5,000건(조회 상한) 도달 시 시트 보기에 잘림 경고를 띄운다.
  entryCount?: number;
}) {
  const [committed, setCommitted] = useState<DeliveryState>({});
  const [draft, setDraft] = useState<DeliveryState>({});
  // 서버 저장 처리수량 원본(기준선 보정 전) — 숨긴 시청자 탭의 복구 미리보기 계산용.
  const [rawCommitted, setRawCommitted] = useState<DeliveryState>({});
  // 항목별 저장 시각(fanId → itemKey → updated_at ISO). diff 저장 이후분만 완료 시각으로 신뢰.
  const [committedAt, setCommittedAt] = useState<Record<string, Record<string, string>>>({});
  // 시트 보기 배정 메모(assignKey → 배정). assignments=현재 편집본, savedAssignments=서버 저장본.
  const [assignments, setAssignments] = useState<Record<string, DeliveryAssignment>>({});
  const [savedAssignments, setSavedAssignments] = useState<Record<string, DeliveryAssignment>>({});
  const [notes, setNotes] = useState<Record<string, ViewerNote>>({});
  const [q, setQ] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [onlyWithNotes, setOnlyWithNotes] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 시청자 상세의 "저장된 완료분" 접기 펼침 상태(기본 접힘, sy 2026-07-09 확정).
  const [foldExpanded, setFoldExpanded] = useState<Record<string, boolean>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadingOps, setLoadingOps] = useState(true);
  const [savingProgress, setSavingProgress] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  // 기록 삭제(취소 이벤트) 확인 모달 대상. 삭제는 영구 삭제가 아니라 취소 도장(교환·양도 이력에서 되돌리기 가능).
  const [deleteTarget, setDeleteTarget] = useState<{ viewer: ViewerSummary; item: AggItem } | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [noteTarget, setNoteTarget] = useState<ViewerSummary | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteImagesDraft, setNoteImagesDraft] = useState<string[]>([]);
  const [savingNote, setSavingNote] = useState(false);

  // 배송 관리 하위탭: 시청자별 목록(기존 화면) / 상품별 목록(상품 총량) / 시트 보기(엑셀형) / 숨긴 시청자(복구).
  const [mode, setMode] = useState<"viewers" | "products" | "sheet" | "hidden">("viewers");
  // 시트 보기 정렬(기준 select + 방향 토글 — 검증실 FilterableTable 문법)과 표시 상한(대량 기록 청크).
  const [sheetSort, setSheetSort] = useState<"date" | "name" | "amount" | "qty" | "item" | "state">("date");
  const [sheetDir, setSheetDir] = useState<"asc" | "desc">("asc");
  const [sheetLimit, setSheetLimit] = useState(300);
  // 시트 보기 배송완료 접기 — 교환·양도 탭(ItemEventManager)의 committed 기준 접기와 동일 문법.
  const [showDoneSheetRows, setShowDoneSheetRows] = useState(false);
  // 배송 중 / 배송완료 탭. 배송완료 탭 = 처리 완료 + 보관되지 않은 시청자만.
  const [tab, setTab] = useState<"active" | "done">("active");
  // 이번 세션에서 방금 보관한 fanId — 즉시 목록에서 숨긴다.
  // (서버에 이미 보관된 시청자는 page.tsx 가 "보관 시각 이후 새 당첨"만 남겨 보내므로 여기서 다시 거르지 않는다.
  //  그래야 재당첨자가 새 기록을 들고 배송 목록에 다시 뜬다.)
  const [sessionArchivedIds, setSessionArchivedIds] = useState<Set<string>>(() => new Set());
  const localArchivedIds = sessionArchivedIds;
  // 처리수량 기준선 보정값을 ref 로 들고 있어, ops 로딩 effect 를 slug 에만 묶는다(불필요한 재요청 방지).
  // 초기값은 useRef 인자로 세팅되므로 마운트 시 로딩 effect 가 바로 올바른 값을 읽는다.
  const hiddenOffsetRef = useRef(archivedHiddenCounts);
  useEffect(() => {
    hiddenOffsetRef.current = archivedHiddenCounts;
  }, [archivedHiddenCounts]);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 정가 메모: 기록(entrySourceKey) 단위 초안/저장중/결과 메시지.
  const [fixedNoteDrafts, setFixedNoteDrafts] = useState<Record<string, string>>({});
  const [fixedImageDrafts, setFixedImageDrafts] = useState<Record<string, string[]>>({});
  const [savingFixedNote, setSavingFixedNote] = useState<Record<string, boolean>>({});
  const [fixedNoteMsg, setFixedNoteMsg] = useState<Record<string, { type: "ok" | "err"; text: string } | null>>({});

  // fanId -> 그 시청자의 정가기록 목록.
  const fixedEntriesByFan = useMemo(() => {
    const out: Record<string, FixedEntry[]> = {};
    for (const fe of fixedEntries ?? []) {
      if (!fe.fanId) continue;
      (out[fe.fanId] ??= []).push(fe);
    }
    return out;
  }, [fixedEntries]);

  // entrySourceKey -> 기존 정가 메모.
  const fixedNoteBySourceKey = useMemo(() => {
    const out: Record<string, FixedPriceNote> = {};
    for (const n of fixedPriceNotes ?? []) {
      if (n.entrySourceKey) out[n.entrySourceKey] = n;
    }
    return out;
  }, [fixedPriceNotes]);

  const fixedNoteValue = (sourceKey: string) =>
    fixedNoteDrafts[sourceKey] ?? fixedNoteBySourceKey[sourceKey]?.noteText ?? "";
  const fixedImagesValue = (sourceKey: string): string[] =>
    fixedImageDrafts[sourceKey] ?? fixedNoteBySourceKey[sourceKey]?.images ?? [];

  const saveFixedNote = async (sourceKey: string) => {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    const noteText = fixedNoteValue(sourceKey).slice(0, MAX_FIXED_NOTE_LEN);
    setSavingFixedNote((prev) => ({ ...prev, [sourceKey]: true }));
    setFixedNoteMsg((prev) => ({ ...prev, [sourceKey]: null }));
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fixed-price-note`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entrySourceKey: sourceKey, noteText, images: fixedImagesValue(sourceKey) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(String(res.status));
      setFixedNoteDrafts((prev) => ({ ...prev, [sourceKey]: noteText }));
      setFixedNoteMsg((prev) => ({ ...prev, [sourceKey]: { type: "ok", text: "메모 저장됨!" } }));
    } catch {
      setFixedNoteMsg((prev) => ({ ...prev, [sourceKey]: { type: "err", text: "저장 실패 — 다시 시도해 주세요." } }));
    } finally {
      setSavingFixedNote((prev) => ({ ...prev, [sourceKey]: false }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadOps() {
      setLoadingOps(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/ops-state`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as OpsState;
        if (cancelled) return;
        // 보정 전 원본을 따로 보관(복구 미리보기용). loaded 는 아래에서 변형되므로 별도 사본.
        setRawCommitted(progressToDeliveryState(json.deliveryProgress || []));
        const loaded = progressToDeliveryState(json.deliveryProgress || []);
        // 보관 시청자의 숨긴 옛 당첨분 몫만큼 저장된 처리수량 기준선을 낮춘다.
        // → 옛 기록과 같은 itemKey 의 새 당첨이 "이미 배송됨"으로 잘못 뜨는 것을 막는다.
        //   (보이지 않는 옛 itemKey 는 낮춰도 화면에 영향 없음. 새 itemKey 는 대개 offset 없어 그대로.)
        const offset = hiddenOffsetRef.current;
        if (offset) {
          for (const [fanId, perItem] of Object.entries(offset)) {
            const row = loaded[fanId];
            if (!row) continue;
            for (const [k, hidden] of Object.entries(perItem)) {
              if (row[k] !== undefined) row[k] = Math.max(0, row[k] - hidden);
            }
          }
        }
        setCommitted(loaded);
        setDraft(loaded);
        setNotes(notesToMap(json.viewerNotes || []));
        // 항목별 저장 시각(완료 시각 표시용 — 컷오프 이후분만 화면에 노출).
        const atMap: Record<string, Record<string, string>> = {};
        for (const item of json.deliveryProgress || []) {
          if (!item.fanId || !item.itemKey || !item.updatedAt) continue;
          (atMap[item.fanId] ??= {})[item.itemKey] = item.updatedAt;
        }
        setCommittedAt(atMap);
        // 시트 보기 배정 메모.
        const aMap: Record<string, DeliveryAssignment> = {};
        for (const a of json.deliveryAssignments || []) {
          aMap[assignKey(a.ownerKey, a.itemKey, a.entryId)] = a;
        }
        setAssignments(aMap);
        setSavedAssignments(aMap);
      } catch {
        if (!cancelled) {
          setMessage({ type: "err", text: "운영 저장값을 불러오지 못했어요. 새로고침 후 다시 확인해 주세요." });
        }
      } finally {
        if (!cancelled) setLoadingOps(false);
      }
    }
    loadOps();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // 보관된 시청자는 배송 중/배송완료 화면 전체에서 제외한다(저장 payload 포함 전 범위).
  const nonArchivedViewers = useMemo(
    () => viewers.filter((v) => !localArchivedIds.has(v.fanId)),
    [viewers, localArchivedIds],
  );

  // 상품별 목록: 시청자 구분 없이 상품명 기준으로 총 당첨/처리/남은 수량을 합산한다.
  // 룰렛 세트(33/330 등)는 같은 상품으로 보고 합치고(sy 전제), 정가기록만 배지로 구분한다.
  const productRows = useMemo(() => {
    const map = new Map<
      string,
      { name: string; isFixed: boolean; total: number; processed: number }
    >();
    for (const v of nonArchivedViewers) {
      for (const it of v.items) {
        const isFixed = it.amountRangeLabel === "정가";
        const key = `${isFixed ? "f" : "r"}@@${it.itemName}`;
        const processed = Math.min(draft[v.key]?.[itemKey(it)] ?? 0, it.count);
        const cur = map.get(key);
        if (cur) {
          cur.total += it.count;
          cur.processed += processed;
        } else {
          map.set(key, { name: it.itemName, isFixed, total: it.count, processed });
        }
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.total - b.processed - (a.total - a.processed) ||
        b.total - a.total ||
        a.name.localeCompare(b.name),
    );
  }, [nonArchivedViewers, draft]);

  const productTotals = useMemo(
    () =>
      productRows.reduce(
        (acc, r) => {
          acc.total += r.total;
          acc.remaining += Math.max(0, r.total - r.processed);
          return acc;
        },
        { total: 0, remaining: 0 },
      ),
    [productRows],
  );

  const changes = useMemo(
    () => computeChanges(nonArchivedViewers, committed, draft),
    [nonArchivedViewers, committed, draft],
  );
  // 시트 보기 배정 메모의 미저장 변경 수(추가/삭제/수량 변경 합).
  const assignChangedCount = useMemo(() => {
    let n = 0;
    for (const [k, a] of Object.entries(assignments)) {
      const s = savedAssignments[k];
      if (!s || s.doneCount !== a.doneCount || s.doneAt !== a.doneAt) n += 1;
    }
    for (const k of Object.keys(savedAssignments)) {
      if (!assignments[k]) n += 1;
    }
    return n;
  }, [assignments, savedAssignments]);
  const dirty = changes.length > 0 || assignChangedCount > 0;
  const changedItemCount = changes.reduce((s, c) => s + c.items.length, 0);

  // 저장 안 된 변경이 있으면 페이지 이탈 시 경고
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const deliveredOf = (vKey: string, iKey: string) => draft[vKey]?.[iKey] ?? 0;

  const setDelivered = (vKey: string, iKey: string, n: number, max: number) =>
    setDraft((prev) => {
      const clamped = Math.max(0, Math.min(n, max));
      return { ...prev, [vKey]: { ...(prev[vKey] ?? {}), [iKey]: clamped } };
    });

  const deliverAll = (v: ViewerSummary) =>
    setDraft((prev) => {
      const m: Record<string, number> = {};
      for (const it of v.items) m[itemKey(it)] = it.count;
      return { ...prev, [v.key]: m };
    });

  const clearViewer = (v: ViewerSummary) => setDraft((prev) => ({ ...prev, [v.key]: {} }));

  const deliveredTotal = (v: ViewerSummary) =>
    v.items.reduce((s, it) => s + Math.min(deliveredOf(v.key, itemKey(it)), it.count), 0);

  // 시청자 상세의 상품 한 줄(스테퍼 포함). 미완료 목록과 접힌 완료 목록이 같은 UI를 쓴다.
  const renderItemRow = (v: ViewerSummary, it: AggItem) => {
    const vKey = v.key;
    const k = itemKey(it);
    const n = Math.min(deliveredOf(vKey, k), it.count);
    const itemDone = n >= it.count;
    // 정가기록 판별: amountRangeLabel === "정가" (집계 단계에서 sourceKey는 유실됨).
    const isFixed = it.amountRangeLabel === "정가";
    // 기록 시각(줄의 가장 오래된 조각 기준)·경과일·저장된 완료 시각(컷오프 이후분만).
    const rec = lineRecordedInfo(it);
    const recBadge = rec?.kind ? KIND_BADGE[rec.kind] : undefined;
    const ageDays = rec ? ageDaysFrom(rec.ms, nowMs) : null;
    const savedDone = (committed[vKey]?.[k] ?? 0) >= it.count;
    const doneAtIso = savedDone ? committedAt[v.fanId]?.[k] : undefined;
    const doneAtMs = doneAtIso ? Date.parse(doneAtIso) : NaN;
    const showDoneAt = savedDone && Number.isFinite(doneAtMs) && doneAtMs >= TS_CUTOFF_MS;
    return (
      <div key={k} className={styles.dmItemRow}>
        <span className={styles.dmItemName}>
          {isFixed ? (
            <span className={fpStyles.fixedBadge}>정가</span>
          ) : it.amountRangeLabel ? (
            <span className={styles.upboSet}>{it.amountRangeLabel}</span>
          ) : null}
          {it.itemName}
          {isFixed ? null : <span className={styles.dmItemProb}>{it.probability}%</span>}
          {it.mission ? (
            <span
              className={fpStyles.fixedBadge}
              style={{ background: "#b3541e", marginLeft: 6 }}
              title="미션 후원이 정가 갯수와 일치해 기록된 건 — 모금 참여라면 오른쪽 삭제로 정리하세요"
            >
              미션
            </span>
          ) : null}
          {rec ? (
            <span
              className={styles.dmTimeChip}
              title={
                (rec.kind === "donate" && rec.text ? `후원 시각(위플랩 원문): ${rec.text}` : recBadge?.title) ??
                undefined
              }
            >
              {fmtShortDate(rec.ms)}
              {recBadge ? <em className={styles.dmTimeKind}>{recBadge.label}</em> : null}
            </span>
          ) : null}
          {rec && ageDays !== null && !itemDone ? (
            <span className={ageDays >= AGE_OLD_DAYS ? styles.dmAgeOld : styles.dmAge}>{ageDays}일째</span>
          ) : null}
          {showDoneAt ? (
            <span className={styles.dmDoneAt} title="배송완료로 저장된 시각">
              완료 {fmtShortDateTime(doneAtMs)}
            </span>
          ) : null}
        </span>
        <div className={styles.dmStepper}>
          <button
            type="button"
            onClick={() => setDelivered(vKey, k, n - 1, it.count)}
            disabled={n <= 0}
            aria-label={`${it.itemName} 처리 감소`}
          >
            −
          </button>
          <span className={itemDone ? styles.dmCountDone : styles.dmCount}>
            {n}/{it.count}
          </span>
          <button
            type="button"
            onClick={() => setDelivered(vKey, k, n + 1, it.count)}
            disabled={itemDone}
            aria-label={`${it.itemName} 처리 증가`}
          >
            +
          </button>
        </div>
        {it.refs && it.refs.length > 0 ? (
          <button
            type="button"
            className={styles.dmClearBtn}
            style={{ marginLeft: 8, color: "#b3261e", borderColor: "#e5b5b1" }}
            onClick={() => {
              setDeleteReason(it.mission ? "미션 모금 오인 기록" : "");
              setDeleteTarget({ viewer: v, item: it });
            }}
            disabled={deleting}
            aria-label={`${it.itemName} 기록 삭제`}
          >
            삭제
          </button>
        ) : null}
      </div>
    );
  };

  const hasNote = useCallback(
    (v: ViewerSummary) =>
      Boolean(notes[v.key]?.noteText?.trim() || (notes[v.key]?.noteImages?.length ?? 0) > 0),
    [notes],
  );
  const noteCount = nonArchivedViewers.filter(hasNote).length;

  // 계정ID 없는 시청자 — 서버(delivery_progress)가 fanId 없는 행을 받지 않아 처리수량이
  // 저장되지 않는다(새로고침하면 사라짐). 있으면 목록 위에 경고를 띄운다(sy 2026-07-09 확정).
  const idlessCount = useMemo(
    () => nonArchivedViewers.filter((v) => !v.fanId.trim()).length,
    [nonArchivedViewers],
  );

  // 배송 중/배송완료 탭 배치는 "서버에 저장된 상태(committed)"만 따른다(sy 2026-07-09 확정).
  // 입력 중(draft) 변경은 배지로만 표시하고, 저장하는 순간 탭이 정리된다 — 입력 도중 줄이 사라지지 않는다.
  const isViewerDone = useCallback(
    (v: ViewerSummary) => {
      const d = v.items.reduce(
        (s, it) => s + Math.min(committed[v.key]?.[itemKey(it)] ?? 0, it.count),
        0,
      );
      return d >= v.total;
    },
    [committed],
  );

  const summary = useMemo(() => {
    let done = 0;
    let partial = 0;
    let none = 0;
    for (const v of nonArchivedViewers) {
      const d = v.items.reduce((s, it) => s + Math.min(draft[v.key]?.[itemKey(it)] ?? 0, it.count), 0);
      if (d <= 0) none += 1;
      else if (d >= v.total) done += 1;
      else partial += 1;
    }
    return { done, partial, none };
  }, [nonArchivedViewers, draft]);

  // 배송 중 탭 = 처리 완료되지 않은 시청자만. 기존 검색/필터 그대로 적용.
  const activeViewers = useMemo(
    () => nonArchivedViewers.filter((v) => !isViewerDone(v)),
    [nonArchivedViewers, isViewerDone],
  );

  // 배송완료 탭 = 모든 항목이 처리 완료된 시청자만.
  const doneViewers = useMemo(
    () => nonArchivedViewers.filter(isViewerDone),
    [nonArchivedViewers, isViewerDone],
  );

  // 보관 가능한 완료 시청자 수(계정ID 있는 시청자만 — ID 없는 기록은 서버가 받지 않는다).
  const archivableDoneCount = useMemo(
    () => doneViewers.filter((v) => v.fanId.trim()).length,
    [doneViewers],
  );

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = tab === "done" ? doneViewers : activeViewers;
    return base.filter((v) => {
      if (
        needle &&
        !(v.fanId.toLowerCase().includes(needle) || v.fanNickname.toLowerCase().includes(needle))
      )
        return false;
      if (onlyWithNotes && !hasNote(v)) return false;
      if (tab === "active" && onlyIncomplete) {
        const d = v.items.reduce(
          (s, it) => s + Math.min(draft[v.key]?.[itemKey(it)] ?? 0, it.count),
          0,
        );
        if (d >= v.total) return false;
      }
      return true;
    });
  }, [tab, activeViewers, doneViewers, q, onlyIncomplete, onlyWithNotes, draft, hasNote]);

  const progressPayload = () => ({
    items: nonArchivedViewers.flatMap((v) =>
      v.items.map((it) => {
        const k = itemKey(it);
        // 로딩 때 기준선에서 뺀 옛 기록 몫을 저장 시 되돌려, 서버에 저장된 옛 배송완료 수량을 보존한다.
        const hidden = archivedHiddenCounts?.[v.fanId]?.[k] ?? 0;
        return {
          fanId: v.fanId,
          fanNickname: v.fanNickname,
          itemKey: k,
          itemName: it.itemName,
          probability: it.probability,
          amountRangeLabel: it.amountRangeLabel,
          processedCount: Math.min(draft[v.key]?.[k] ?? 0, it.count) + hidden,
        };
      }),
    ),
  });

  // 기록 삭제 = 취소 이벤트(교환·양도의 취소와 같은 엔진). 원본은 남고 되돌리기 가능,
  // 팬 화면·배송관리에서 즉시 사라진다. 줄이 여러 원본 조각이면 전부 순서대로 취소한다.
  const commitDelete = async () => {
    if (!deleteTarget) return;
    const { item } = deleteTarget;
    const reason = deleteReason.trim();
    if (!reason) return;
    setDeleting(true);
    setMessage(null);
    let failed = 0;
    for (const ref of item.refs ?? []) {
      try {
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/item-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            upboEntryId: ref.entryId,
            actorType: "operator",
            eventType: "cancel",
            quantityDelta: ref.quantity,
            reason,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (!res.ok || json.ok === false) failed += 1;
      } catch {
        failed += 1;
      }
    }
    setDeleting(false);
    setDeleteTarget(null);
    if (failed > 0) {
      setMessage({ type: "err", text: `일부(${failed}건) 삭제에 실패했어요. 새로고침 후 다시 시도해 주세요.` });
    } else {
      setMessage({
        type: "ok",
        text: `"${item.itemName}" ${item.count}개 기록을 삭제(취소 처리)했어요. 실수였다면 교환·양도 탭 이력에서 되돌릴 수 있어요.`,
      });
    }
    router.refresh();
  };

  const commitSave = async () => {
    setSavingProgress(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/delivery-progress`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(progressPayload()),
      });
      if (!res.ok) throw new Error(String(res.status));
      setCommitted(draft);
      // 방금 바뀐 항목의 완료 시각을 즉시 반영(서버 updated_at=지금과 근사 — 새로고침하면 서버값).
      const nowIso = new Date().toISOString();
      setCommittedAt((prev) => {
        const next = { ...prev };
        for (const c of changes) {
          if (!c.fanId.trim()) continue;
          const row = { ...(next[c.fanId] ?? {}) };
          for (const v of nonArchivedViewers) {
            if (v.key !== c.viewerKey) continue;
            for (const it of v.items) {
              const k = itemKey(it);
              const from = Math.min(committed[v.key]?.[k] ?? 0, it.count);
              const to = Math.min(draft[v.key]?.[k] ?? 0, it.count);
              if (from !== to) row[k] = nowIso;
            }
          }
          next[c.fanId] = row;
        }
        return next;
      });
      // 시트 보기 배정 메모 저장(변경 있을 때만). 저장 전에 현재 보이는 조각 기준으로 정리(prune):
      // 취소·보관 등으로 사라진 조각의 배정은 버리고, 수량 초과 배정은 조각 수량으로 자른다.
      let assignFailed = false;
      {
        const pruned: Record<string, DeliveryAssignment> = {};
        // 화면에 없는 보유자(보관된 시청자 등)의 배정은 판단 근거가 없으므로 그대로 보존한다 —
        // 지우면 나중에 복구했을 때 완료 시각 힌트가 전부 "수량 기준"으로 강등된다.
        const visibleOwners = new Set(nonArchivedViewers.map((v) => v.key));
        for (const [aKey, a] of Object.entries(assignments)) {
          if (!visibleOwners.has(a.ownerKey)) pruned[aKey] = a;
        }
        // pin(doneAt="") 먼저 → doneAt 오래된 순. allocateDeliveryToRefs 의 힌트 소비 순서와 동일.
        const hintOrderMs = (doneAt: string): number => {
          if (!doneAt) return Number.NEGATIVE_INFINITY;
          const ms = Date.parse(doneAt);
          return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
        };
        for (const v of nonArchivedViewers) {
          if (!v.fanId.trim()) continue; // 계정ID 없는 팬은 수량 저장이 안 되므로 배정도 안 남긴다
          for (const it of v.items) {
            const k = itemKey(it);
            const n = Math.min(draft[v.key]?.[k] ?? 0, it.count);
            const lineAssigns = (it.refs ?? [])
              .map((ref) => ({ ref, aKey: assignKey(v.key, k, ref.entryId), a: assignments[assignKey(v.key, k, ref.entryId)] }))
              .filter((x): x is typeof x & { a: DeliveryAssignment } => Boolean(x.a))
              .sort((x, y) => {
                const xm = hintOrderMs(x.a.doneAt);
                const ym = hintOrderMs(y.a.doneAt);
                return xm === ym ? 0 : xm < ym ? -1 : 1;
              });
            // 줄의 처리수량 n 까지만 배정을 남긴다(조각 수량으로도 자름) — 스테퍼로 수량을 줄인 뒤
            // 초과 배정이 서버에 남아 나중에 옛 doneAt 으로 부활하는 것 방지(리뷰 실측 시나리오).
            let budget = n;
            for (const x of lineAssigns) {
              const take = Math.min(x.a.doneCount, x.ref.quantity, budget);
              if (take <= 0) continue;
              budget -= take;
              pruned[x.aKey] = { ...x.a, doneCount: take };
            }
          }
        }
        // 정리 결과가 서버 저장본과 다를 때만 저장한다. 시트 조작 없이 스테퍼로 수량만 줄인 저장도
        // 여기서 초과 배정이 정리되므로(위 clamp), 잔존 배정이 옛 doneAt 으로 부활하는 일이 없다.
        const prunedChanged =
          Object.keys(pruned).length !== Object.keys(savedAssignments).length ||
          Object.entries(pruned).some(([aKey, a]) => {
            const s = savedAssignments[aKey];
            return !s || s.doneCount !== a.doneCount || s.doneAt !== a.doneAt;
          });
        if (prunedChanged) {
          const assignRes = await fetch(`/api/s/${encodeURIComponent(slug)}/delivery-assignments`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assignments: Object.values(pruned) }),
          }).catch(() => null);
          if (assignRes?.ok) {
            setAssignments(pruned);
            setSavedAssignments(pruned);
          } else {
            assignFailed = true;
          }
        } else {
          // 변경 없음 — 편집 중이던 배정 상태도 정리본으로 정돈해 둔다(초과분 표시 잔재 제거).
          setAssignments(pruned);
        }
      }
      setConfirmOpen(false);
      // 계정ID 없는 시청자의 처리 수량은 서버가 저장하지 않는다(saveDeliveryProgress 필터) —
      // 성공 메시지가 이를 숨기면 "처리했는데 팬 화면 그대로" 사고가 된다(2026-08-24 포로미 실사고).
      const skippedIdless = nonArchivedViewers.filter(
        (v) => !v.fanId.trim() && deliveredTotal(v) > 0,
      ).length;
      setMessage(
        assignFailed
          ? {
              type: "err",
              text: "처리 수량은 저장됐지만 시트 보기 완료 표시(배정)는 저장에 실패했어요. 잠시 후 저장을 한 번 더 눌러 주세요.",
            }
          : skippedIdless > 0
            ? {
                type: "err",
                text: `저장했지만 계정ID 없는 시청자 ${skippedIdless}명의 처리 수량은 저장되지 않았어요(새로고침하면 되돌아감). 업보가 아닌 기록이면 줄의 "삭제"로 정리하세요.`,
              }
            : { type: "ok", text: "처리 수량이 서버 DB에 저장됐어요." },
      );
      router.refresh();
    } catch {
      setMessage({ type: "err", text: "처리 수량 저장 실패. 잠시 후 다시 저장해 주세요." });
    } finally {
      setSavingProgress(false);
    }
  };

  const revert = () => {
    setDraft(committed);
    setAssignments(savedAssignments);
  };

  const openNote = (v: ViewerSummary) => {
    setNoteTarget(v);
    setNoteDraft(notes[v.key]?.noteText ?? "");
    setNoteImagesDraft(notes[v.key]?.noteImages ?? []);
  };

  const saveNote = async () => {
    if (!noteTarget) return;
    setSavingNote(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/viewer-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fanId: noteTarget.fanId,
          fanNickname: noteTarget.fanNickname,
          noteText: noteDraft,
          noteImages: noteImagesDraft,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { note?: ViewerNote };
      const saved = json.note ?? {
        fanId: noteTarget.fanId,
        fanNickname: noteTarget.fanNickname,
        noteText: noteDraft,
        noteImages: noteImagesDraft,
        updatedAt: new Date().toISOString(),
      };
      setNotes((prev) => ({ ...prev, [noteTarget.key]: saved }));
      setNoteTarget(null);
      const hasContent = saved.noteText.trim() || (saved.noteImages?.length ?? 0) > 0;
      setMessage({ type: "ok", text: hasContent ? "메모가 저장됐어요." : "메모가 비워졌어요." });
    } catch {
      setMessage({ type: "err", text: "메모 저장 실패. 잠시 후 다시 저장해 주세요." });
    } finally {
      setSavingNote(false);
    }
  };

  const exportJson = () => {
    const payload = {
      slug,
      exportedAt: new Date().toISOString(),
      deliveries: committed,
      notes,
      // 시트 보기 배정 메모(서버 저장본)도 백업에 포함 — 없으면 복구 시 완료 시각·줄 지정이 유실된다.
      deliveryAssignments: Object.values(savedAssignments),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upbo-operator-state-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 배송완료 탭의 모든 시청자를 한 번에 숨김 처리한다. 원본 기록은 삭제되지 않는다(복구 가능).
  // 계정ID 없는 시청자(과거 ID 없이 양도된 기록)는 서버가 요청 전체를 거절하므로 건너뛴다.
  // 성공하면 전체 새로고침 — 숨긴 시청자 탭 목록과 기준선 보정(SSR 계산)을 처음부터 다시 읽는다.
  // 그래서 저장 안 된 변경이 있으면 막는다(새로고침으로 날아가는 사고 방지).
  const archiveDoneViewers = async () => {
    if (dirty) {
      setArchiveMessage({
        type: "err",
        text: "저장 안 된 변경이 있어요. 먼저 저장하거나 되돌린 뒤 숨겨 주세요.",
      });
      return;
    }
    const fanIds = doneViewers.map((v) => v.fanId).filter((id) => id.trim());
    const skipped = doneViewers.length - fanIds.length;
    if (fanIds.length === 0) {
      setArchiveMessage({
        type: "err",
        text:
          skipped > 0
            ? "완료 시청자가 전부 계정ID가 없어서 숨길 수 없어요. 양도 기록에 계정ID를 채운 뒤 다시 시도해 주세요."
            : "숨길 완료 시청자가 없어요.",
      });
      return;
    }
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    setArchiving(true);
    setArchiveMessage({ type: "ok", text: "숨김 처리 중…" });
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/viewer-archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fanIds, archived: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const text =
          res.status === 401
            ? "로그인이 풀렸어요. 관리자 비밀번호로 다시 들어와 주세요."
            : `숨김 처리 실패 — ${typeof data?.error === "string" && data.error ? data.error : `서버 오류(${res.status})`}`;
        setArchiveMessage({ type: "err", text });
        setArchiving(false);
        return;
      }
      setSessionArchivedIds((prev) => {
        const next = new Set(prev);
        for (const id of fanIds) next.add(id);
        return next;
      });
      setArchiveConfirmOpen(false);
      setArchiveMessage({
        type: "ok",
        text:
          `${fanIds.length}명 숨김 완료! 팬 화면에서도 숨겨졌어요. 화면을 새로 불러옵니다…` +
          (skipped > 0 ? ` (계정ID 없는 ${skipped}명은 건너뛰었어요.)` : ""),
      });
      window.location.reload();
    } catch {
      setArchiveMessage({ type: "err", text: "네트워크 문제로 숨기지 못했어요. 잠시 후 다시 시도해 주세요." });
      setArchiving(false);
    }
  };

  // ── 시트 보기(B뷰): 한 후원 조각 = 한 줄. 수량 장부가 진실, 배정은 힌트(allocateDeliveryToRefs) ──
  // 경과일 기준 시각 — 렌더 순수성(react-hooks/purity) 때문에 마운트 시 1회 고정(일 단위라 충분).
  const [nowMs] = useState(() => Date.now());
  type SheetRef = NonNullable<AggItem["refs"]>[number];
  type SheetRow = {
    v: ViewerSummary;
    it: AggItem;
    ref: SheetRef;
    alloc: { allocated: number; state: "done" | "part" | "pending"; doneAt: string | null };
    aKey: string;
  };
  const sheetRows = useMemo<SheetRow[]>(() => {
    const needle = q.trim().toLowerCase();
    const rows: SheetRow[] = [];
    for (const v of nonArchivedViewers) {
      if (
        needle &&
        !(v.fanId.toLowerCase().includes(needle) || v.fanNickname.toLowerCase().includes(needle))
      )
        continue;
      for (const it of v.items) {
        const k = itemKey(it);
        const refs = it.refs ?? [];
        if (refs.length === 0) continue;
        const n = Math.min(draft[v.key]?.[k] ?? 0, it.count);
        const assignForLine: Record<string, { doneCount: number; doneAt: string }> = {};
        for (const ref of refs) {
          const a = assignments[assignKey(v.key, k, ref.entryId)];
          if (a) assignForLine[ref.entryId] = { doneCount: a.doneCount, doneAt: a.doneAt };
        }
        const allocs = allocateDeliveryToRefs(refs, n, assignForLine);
        refs.forEach((ref, i) => {
          rows.push({ v, it, ref, alloc: allocs[i], aKey: assignKey(v.key, k, ref.entryId) });
        });
      }
    }
    // 정렬은 반드시 해석된 값(ms/숫자)으로 — 원문 문자열 비교는 시간대·이형 포맷에서 틀어진다.
    const dir = sheetDir === "asc" ? 1 : -1;
    const stateRank = { done: 2, part: 1, pending: 0 } as const;
    const msOf = (r: SheetRow) => r.ref.recordedAtMs ?? Number.POSITIVE_INFINITY; // 시각 없음=맨 뒤(오름차순 기준)
    const cmpMs = (a: SheetRow, b: SheetRow) => {
      const am = msOf(a);
      const bm = msOf(b);
      return am === bm ? 0 : am < bm ? -1 : 1;
    };
    rows.sort((a, b) => {
      let d = 0;
      if (sheetSort === "date") d = cmpMs(a, b);
      else if (sheetSort === "name")
        d = (a.v.fanNickname || a.v.fanId).localeCompare(b.v.fanNickname || b.v.fanId, "ko");
      else if (sheetSort === "amount") d = (a.ref.amount ?? -1) - (b.ref.amount ?? -1);
      else if (sheetSort === "qty") d = a.ref.quantity - b.ref.quantity;
      else if (sheetSort === "item") d = a.it.itemName.localeCompare(b.it.itemName, "ko");
      else d = stateRank[a.alloc.state] - stateRank[b.alloc.state];
      if (d !== 0) return d * dir;
      return cmpMs(a, b) || a.ref.entryId.localeCompare(b.ref.entryId);
    });
    return rows;
  }, [nonArchivedViewers, q, draft, assignments, sheetSort, sheetDir]);

  const sheetSummary = useMemo(() => {
    let done = 0;
    let part = 0;
    for (const r of sheetRows) {
      if (r.alloc.state === "done") done += 1;
      else if (r.alloc.state === "part") part += 1;
    }
    return { total: sheetRows.length, done, part, pending: sheetRows.length - done - part };
  }, [sheetRows]);

  // ── 시트 보기 배송완료 접기: 서버 저장본(committed/savedAssignments) 기준으로만 판단한다 ──
  // draft(미저장 변경)로 방금 완료 토글한 줄까지 접으면, 저장 전인데 줄이 사라져 조작감이 나쁘다
  // (교환·양도 탭 접기와 동일 기준: 2f98a6e/76061ac 참고).
  const committedDoneAKeys = useMemo(() => {
    const set = new Set<string>();
    for (const v of nonArchivedViewers) {
      for (const it of v.items) {
        const k = itemKey(it);
        const refs = it.refs ?? [];
        if (refs.length === 0) continue;
        const n = Math.min(committed[v.key]?.[k] ?? 0, it.count);
        const assignForLine: Record<string, { doneCount: number; doneAt: string }> = {};
        for (const ref of refs) {
          const a = savedAssignments[assignKey(v.key, k, ref.entryId)];
          if (a) assignForLine[ref.entryId] = { doneCount: a.doneCount, doneAt: a.doneAt };
        }
        const allocs = allocateDeliveryToRefs(refs, n, assignForLine);
        refs.forEach((ref, i) => {
          if (allocs[i].state === "done") set.add(assignKey(v.key, k, ref.entryId));
        });
      }
    }
    return set;
  }, [nonArchivedViewers, committed, savedAssignments]);

  // 검색 중에는 접지 않는다(교환·양도 탭과 동일 규칙) — 찾는 사람이 배송완료라 안 보이면 더 헷갈린다.
  const visibleSheetRows = useMemo(() => {
    if (q.trim() || showDoneSheetRows) return sheetRows;
    return sheetRows.filter((r) => !committedDoneAKeys.has(r.aKey));
  }, [sheetRows, q, showDoneSheetRows, committedDoneAKeys]);

  const doneSheetRowsCount = useMemo(
    () => sheetRows.filter((r) => committedDoneAKeys.has(r.aKey)).length,
    [sheetRows, committedDoneAKeys],
  );

  // 시트 줄 완료 토글: 줄의 조각 수량만큼 묶음 처리수량을 늘리고/줄이고, 배정 메모를 남긴다/지운다.
  // 부분(part) 줄은 여기서 못 만진다 — A안 스테퍼(수량 입력)로 조정(이진 드롭다운으로 뭉개지 않기).
  const toggleSheetRow = (row: SheetRow, toDone: boolean) => {
    const k = itemKey(row.it);
    const cur = Math.min(deliveredOf(row.v.key, k), row.it.count);
    if (toDone) {
      setDelivered(row.v.key, k, cur + (row.ref.quantity - row.alloc.allocated), row.it.count);
      setAssignments((prev) => ({
        ...prev,
        [row.aKey]: {
          entryId: row.ref.entryId,
          ownerKey: row.v.key,
          itemKey: k,
          doneCount: row.ref.quantity,
          doneAt: new Date().toISOString(),
        },
      }));
    } else {
      // 내리기 전에, 같은 줄에서 완료로 배분돼 있던 "다른" 조각들을 시각 미상 pin(doneAt="")으로
      // 고정한다. 안 하면 수량이 줄어든 뒤 FIFO 재배분이 오래된 조각부터 다시 채워, 사용자가 내린
      // 조각은 완료로 남고 엉뚱한 조각이 풀린다(리뷰 실측 시나리오). 이미 배정 있는 조각은 그대로.
      const refs = row.it.refs ?? [];
      const assignForLine: Record<string, { doneCount: number; doneAt: string }> = {};
      for (const ref of refs) {
        const a = assignments[assignKey(row.v.key, k, ref.entryId)];
        if (a) assignForLine[ref.entryId] = { doneCount: a.doneCount, doneAt: a.doneAt };
      }
      const allocs = allocateDeliveryToRefs(refs, cur, assignForLine);
      setAssignments((prev) => {
        const next = { ...prev };
        refs.forEach((ref, i) => {
          if (ref.entryId === row.ref.entryId) return;
          const otherKey = assignKey(row.v.key, k, ref.entryId);
          if (!next[otherKey] && allocs[i].allocated > 0) {
            next[otherKey] = {
              entryId: ref.entryId,
              ownerKey: row.v.key,
              itemKey: k,
              doneCount: allocs[i].allocated,
              doneAt: "",
            };
          }
        });
        delete next[row.aKey];
        return next;
      });
      setDelivered(row.v.key, k, Math.max(0, cur - row.alloc.allocated), row.it.count);
    }
  };

  return (
    <div className={styles.cm}>
      <p className={styles.cmBanner}>
        자동 업보 총량은 원본 기록에서 계산하고, 스트리머가 처리한 수량과 메모는 별도 운영 DB에 저장돼요.
        새 업보가 추가되면 총량만 늘고 기존 처리값은 유지됩니다.
      </p>
      {message ? (
        <p className={message.type === "ok" ? styles.fieldOk : styles.fieldErr}>{message.text}</p>
      ) : null}
      {loadingOps ? <p className={styles.fieldHint}>운영 저장값 불러오는 중…</p> : null}

      {/* 하위탭: 시청자별 목록(처리 입력) / 상품별 목록(상품 총량 요약) */}
      <div className={styles.subTabs} role="tablist">
        <button
          type="button"
          className={mode === "viewers" ? styles.subTabActiveLink : styles.subTabLink}
          onClick={() => setMode("viewers")}
        >
          시청자별 목록
        </button>
        <button
          type="button"
          className={mode === "products" ? styles.subTabActiveLink : styles.subTabLink}
          onClick={() => setMode("products")}
        >
          상품별 목록
        </button>
        <button
          type="button"
          className={mode === "sheet" ? styles.subTabActiveLink : styles.subTabLink}
          onClick={() => setMode("sheet")}
        >
          시트 보기
        </button>
        <button
          type="button"
          className={mode === "hidden" ? styles.subTabActiveLink : styles.subTabLink}
          onClick={() => setMode("hidden")}
        >
          숨긴 시청자 {(hiddenViewers ?? []).length}
        </button>
      </div>

      {mode === "viewers" ? (
        <>
      <div className={styles.cmToolbar}>
        <input
          className={styles.cmSearch}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="닉네임 또는 계정ID 검색"
          aria-label="시청자 검색"
        />
        <label className={styles.dmCheckLabel}>
          <input
            type="checkbox"
            checked={onlyIncomplete}
            onChange={(e) => setOnlyIncomplete(e.target.checked)}
          />
          미완료만
        </label>
        <label className={styles.dmCheckLabel}>
          <input
            type="checkbox"
            checked={onlyWithNotes}
            onChange={(e) => setOnlyWithNotes(e.target.checked)}
          />
          메모 있음만
        </label>
        <button type="button" className={styles.cmEditBtn} onClick={exportJson}>
          내보내기(JSON)
        </button>
      </div>

      <div className={styles.cmSummary}>
        <span className={styles.tagActive}>완료 {summary.done}명</span>
        <span className={styles.tag}>부분 {summary.partial}명</span>
        <span className={styles.tagMuted}>미처리 {summary.none}명</span>
        <span className={noteCount > 0 ? styles.tagWarn : styles.tagMuted}>메모 {noteCount}명</span>
      </div>

      {idlessCount > 0 ? (
        <p className={styles.fieldErr}>
          계정ID 없는 시청자 {idlessCount}명은 처리 수량이 서버에 저장되지 않아요. 교환·양도 탭에서
          계정ID를 채운 뒤 처리해 주세요.
        </p>
      ) : null}

      {/* 배송 중 / 배송완료 탭 */}
      <div className={fpStyles.dmTabs}>
        <button
          type="button"
          className={tab === "active" ? fpStyles.dmTabOn : fpStyles.dmTab}
          onClick={() => setTab("active")}
        >
          배송 중 {activeViewers.length}
        </button>
        <button
          type="button"
          className={tab === "done" ? fpStyles.dmTabOn : fpStyles.dmTab}
          onClick={() => setTab("done")}
        >
          배송완료 {doneViewers.length}
        </button>
      </div>

      {tab === "done" ? (
        <div className={fpStyles.archiveBar}>
          <button
            type="button"
            className={fpStyles.archiveBtn}
            onClick={() => {
              // 숨김 성공 시 전체 새로고침을 하므로, 저장 안 된 변경이 있으면 모달을 열기 전에 막는다.
              if (dirty) {
                setArchiveMessage({
                  type: "err",
                  text: "저장 안 된 변경이 있어요. 먼저 저장하거나 되돌린 뒤 숨겨 주세요.",
                });
                return;
              }
              setArchiveConfirmOpen(true);
            }}
            disabled={archiving || doneViewers.length === 0}
          >
            완료 시청자 일괄 숨김
          </button>
          {archiveMessage ? (
            <span className={archiveMessage.type === "ok" ? fpStyles.noteMsgOk : fpStyles.noteMsgErr}>
              {archiveMessage.text}
            </span>
          ) : null}
        </div>
      ) : null}

      {tab === "done" && doneViewers.length === 0 ? (
        <p className={styles.fieldHint}>완료된 시청자가 없어요.</p>
      ) : null}

      <ul className={styles.dmList}>
        {view.map((v) => {
          const delivered = deliveredTotal(v);
          const remaining = Math.max(0, v.total - delivered);
          const isDone = delivered >= v.total;
          const isNone = delivered <= 0;
          const savedDone = isViewerDone(v);
          const open = expanded[v.key] ?? false;
          const noteExists = hasNote(v);
          // 저장된 완료 항목(committed 기준)은 아래 접힌 묶음으로 내린다. 이번 세션에 완료한
          // 항목은 저장 전까지 제자리 유지(입력 중 줄 점프 방지). 배송완료 탭은 전부 완료라 안 접는다.
          const savedDoneItem = (it: AggItem) =>
            (committed[v.key]?.[itemKey(it)] ?? 0) >= it.count;
          const pendingItems = tab === "active" ? v.items.filter((it) => !savedDoneItem(it)) : v.items;
          const foldedItems = tab === "active" ? v.items.filter(savedDoneItem) : [];
          const foldedCount = foldedItems.reduce((s, it) => s + it.count, 0);
          const foldOpen = foldExpanded[v.key] ?? false;
          const stationUrl = soopStationUrl(v.fanId);
          return (
            <li key={v.key} className={styles.dmItem}>
              <div className={styles.dmRow}>
                <button
                  type="button"
                  className={styles.dmToggle}
                  onClick={() => setExpanded((p) => ({ ...p, [v.key]: !open }))}
                  aria-expanded={open}
                >
                  <span className={styles.dmCaret}>{open ? "▾" : "▸"}</span>
                  <span className={styles.dmName}>{v.fanNickname}</span>
                  <span className={styles.dmId}>{v.fanId}</span>
                </button>
                <span className={isDone ? styles.dmDone : isNone ? styles.dmNone : styles.dmPartial}>
                  {isDone ? (savedDone ? "처리 완료" : "처리 완료 · 저장 전") : `처리 ${delivered}/${v.total}`}
                </span>
                {!isDone ? <span className={styles.tagMuted}>남음 {remaining}</span> : null}
                <button
                  type="button"
                  className={noteExists ? styles.dmNoteOnBtn : styles.dmNoteBtn}
                  onClick={() => openNote(v)}
                >
                  {noteExists ? "메모 있음" : "메모"}
                </button>
                {stationUrl ? (
                  <a
                    className={styles.dmStationBtn}
                    href={stationUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`${v.fanNickname || v.fanId} 방송국 열기 (새 탭)`}
                  >
                    방송국 ↗
                  </a>
                ) : null}
                <div className={styles.dmActions}>
                  <button
                    type="button"
                    className={styles.dmAllBtn}
                    onClick={() => deliverAll(v)}
                    disabled={isDone}
                  >
                    전체 처리
                  </button>
                  <button
                    type="button"
                    className={styles.dmClearBtn}
                    onClick={() => clearViewer(v)}
                    disabled={isNone}
                  >
                    처리 초기화
                  </button>
                </div>
              </div>

              {open ? (
                <div className={styles.dmDetail}>
                  {pendingItems.map((it) => renderItemRow(v, it))}

                  {foldedItems.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className={fpStyles.foldBar}
                        onClick={() => setFoldExpanded((p) => ({ ...p, [v.key]: !foldOpen }))}
                        aria-expanded={foldOpen}
                      >
                        <span>{foldOpen ? "▾" : "▸"}</span>
                        <span>
                          처리 완료 {foldedItems.length}종 · {foldedCount}개
                        </span>
                        <span className={fpStyles.foldHint}>
                          저장된 완료분 · {foldOpen ? "접기" : "펼치기"}
                        </span>
                      </button>
                      {foldOpen ? foldedItems.map((it) => renderItemRow(v, it)) : null}
                    </>
                  ) : null}

                  {/* 정가 메모 블록 — 이 시청자의 정가기록(fixedEntries)이 있을 때만 노출 */}
                  {(fixedEntriesByFan[v.fanId]?.length ?? 0) > 0 ? (
                    <div className={fpStyles.noteWrap}>
                      {fixedEntriesByFan[v.fanId]!.map((fe) => {
                        const val = fixedNoteValue(fe.sourceKey);
                        const saving = savingFixedNote[fe.sourceKey] ?? false;
                        const msg = fixedNoteMsg[fe.sourceKey] ?? null;
                        return (
                          <div key={fe.sourceKey} className={fpStyles.noteBlock}>
                            <span className={fpStyles.noteLabel}>
                              <span className={fpStyles.fixedBadge}>정가</span>
                              {fe.itemName}
                              {fe.donateTimeText ? (
                                <span className={fpStyles.noteLabelTime}>· {fe.donateTimeText}</span>
                              ) : null}
                            </span>
                            <MemoImageAttach
                              slug={slug}
                              images={fixedImagesValue(fe.sourceKey)}
                              onChange={(next) =>
                                setFixedImageDrafts((prev) => ({ ...prev, [fe.sourceKey]: next }))
                              }
                              disabled={saving}
                            >
                              <textarea
                                className={fpStyles.noteTextarea}
                                value={val}
                                onChange={(e) =>
                                  setFixedNoteDrafts((prev) => ({
                                    ...prev,
                                    [fe.sourceKey]: e.target.value.slice(0, MAX_FIXED_NOTE_LEN),
                                  }))
                                }
                                placeholder="이 정가 업보로 드릴 상품 목록을 적어두세요 (이미지도 붙여넣기 가능)"
                                maxLength={MAX_FIXED_NOTE_LEN}
                                rows={3}
                              />
                            </MemoImageAttach>
                            <div className={fpStyles.noteFoot}>
                              <span className={fpStyles.noteCounter}>
                                {val.length}/{MAX_FIXED_NOTE_LEN}
                              </span>
                              {msg ? (
                                <span className={msg.type === "ok" ? fpStyles.noteMsgOk : fpStyles.noteMsgErr}>
                                  {msg.text}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className={fpStyles.noteSaveBtn}
                                onClick={() => saveFixedNote(fe.sourceKey)}
                                disabled={saving}
                              >
                                {saving ? "저장 중…" : "저장"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {view.length === 0 && !(tab === "done" && doneViewers.length === 0) ? (
        <p className={styles.fieldHint}>조건에 맞는 시청자가 없어요.</p>
      ) : null}
        </>
      ) : mode === "products" ? (
        <>
          <p className={styles.fieldHint}>
            시청자 구분 없이 상품별 총 수량을 모아서 보여줘요. 룰렛 세트(33/330 등)는 같은 상품으로
            합산하고, 숨긴 시청자는 제외돼요. 처리 수량 입력은 시청자별 목록에서 해요(저장 전 변경도
            여기 바로 반영).
          </p>
          <div className={styles.cmSummary}>
            <span className={styles.tag}>상품 {productRows.length}종</span>
            <span className={styles.tagMuted}>총 갯수 {productTotals.total}개</span>
            <span className={productTotals.remaining > 0 ? styles.tagWarn : styles.tagActive}>
              남은 갯수 {productTotals.remaining}개
            </span>
          </div>
          {productRows.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>상품</th>
                    <th className={styles.pmCountCol}>총 갯수</th>
                    <th className={styles.pmCountCol}>배송완료</th>
                    <th className={styles.pmCountCol}>남은 갯수</th>
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((row) => {
                    const remaining = Math.max(0, row.total - row.processed);
                    return (
                      <tr key={`${row.isFixed ? "f" : "r"}@@${row.name}`}>
                        <td>
                          {row.isFixed ? <span className={fpStyles.fixedBadge}>정가</span> : null}{" "}
                          {row.name}
                        </td>
                        <td className={styles.countCell}>{row.total}</td>
                        <td className={styles.countCell}>{row.processed}</td>
                        <td className={styles.countCell}>
                          {remaining > 0 ? (
                            <strong>{remaining}</strong>
                          ) : (
                            <span className={styles.tagActive}>완료</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.fieldHint}>아직 배송할 업보 기록이 없어요.</p>
          )}
        </>
      ) : mode === "sheet" ? (
        <>
          <p className={styles.fieldHint}>
            한 후원 기록이 한 줄이에요(엑셀 시트 문법). 상태를 바꾸면 아래 저장 버튼을 눌러야 서버에
            저장돼요. 처리 수량은 시청자별 목록과 같은 장부를 쓰니 어느 쪽에서 처리해도 숫자가 같아요.
          </p>
          <div className={styles.cmToolbar}>
            <input
              className={styles.cmSearch}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="닉네임 또는 계정ID 검색"
              aria-label="시청자 검색"
            />
            <label className={styles.dmCheckLabel}>
              정렬
              <select
                className={styles.sheetSortSel}
                value={sheetSort}
                onChange={(e) => setSheetSort(e.target.value as typeof sheetSort)}
                aria-label="시트 정렬 기준"
              >
                <option value="date">날짜</option>
                <option value="name">닉네임</option>
                <option value="amount">금액</option>
                <option value="qty">수량</option>
                <option value="item">종류</option>
                <option value="state">상태</option>
              </select>
            </label>
            <button
              type="button"
              className={styles.cmEditBtn}
              onClick={() => setSheetDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label="정렬 방향 전환"
            >
              {sheetDir === "asc" ? "오름차순 ↑" : "내림차순 ↓"}
            </button>
          </div>
          <div className={styles.cmSummary}>
            <span className={styles.tag}>전체 {sheetSummary.total}건</span>
            <span className={styles.tagActive}>완료 {sheetSummary.done}건</span>
            {sheetSummary.part > 0 ? (
              <span className={styles.tagWarn}>일부 {sheetSummary.part}건</span>
            ) : null}
            <span className={styles.tagMuted}>배송 중 {sheetSummary.pending}건</span>
            {!q.trim() && doneSheetRowsCount > 0 ? (
              <button
                type="button"
                className={styles.ieDoneToggle}
                onClick={() => setShowDoneSheetRows((v) => !v)}
                aria-pressed={showDoneSheetRows}
                title="저장된 기준으로 배송이 전량 완료된 줄이에요. 기록은 그대로 있고 화면에서만 접혀요."
              >
                {showDoneSheetRows
                  ? `배송완료 ${doneSheetRowsCount}건 접기 ▲`
                  : `배송완료 ${doneSheetRowsCount}건 보기 ▼`}
              </button>
            ) : null}
          </div>
          {(entryCount ?? 0) >= 5000 ? (
            <p className={styles.fieldErr}>
              기록이 5,000건에 도달했어요 — 가장 오래된 기록부터 화면에서 잘려 이 표가 전체 장부보다
              적게 보일 수 있어요.
            </p>
          ) : null}
          {sheetRows.length > 0 ? (
            <>
              {!q.trim() && !showDoneSheetRows && visibleSheetRows.length === 0 ? (
                <p className={styles.fieldHint}>
                  배송 중인 기록이 없어요 — 배송완료 {doneSheetRowsCount}건은 위 «배송완료 보기» 버튼으로
                  볼 수 있어요.
                </p>
              ) : (
              <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>닉네임</th>
                      <th className={styles.pmCountCol}>금액</th>
                      <th className={styles.pmCountCol}>수량</th>
                      <th className={styles.sheetDateCol}>날짜</th>
                      <th>종류</th>
                      <th className={styles.sheetStateCol}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSheetRows.slice(0, sheetLimit).map((row) => {
                      const ms = row.ref.recordedAtMs;
                      const kindBadge = row.ref.recordedKind ? KIND_BADGE[row.ref.recordedKind] : undefined;
                      const days = ms !== null && ms !== undefined ? ageDaysFrom(ms, nowMs) : null;
                      const isFixed = row.it.amountRangeLabel === "정가";
                      return (
                        <tr key={row.aKey}>
                          <td>
                            {row.v.fanNickname || <span className={styles.tagMuted}>닉네임 없음</span>}
                            {row.v.fanId.trim() ? (
                              <span className={styles.sheetFanId}>({row.v.fanId})</span>
                            ) : null}
                          </td>
                          {/* countCell 금지: 480px sticky(right:0) 규칙이 걸려 상태 열과 겹쳐 쌓인다 */}
                          <td className={styles.sheetNumCell}>{row.ref.amount ?? "–"}</td>
                          <td className={styles.sheetNumCell}>{row.ref.quantity}</td>
                          <td className={styles.sheetDateCell}>
                            {ms !== null && ms !== undefined ? (
                              <span
                                className={styles.dmTimeChip}
                                title={
                                  (row.ref.recordedKind === "donate" && row.ref.recordedText
                                    ? `후원 시각(위플랩 원문): ${row.ref.recordedText}`
                                    : kindBadge?.title) ?? undefined
                                }
                              >
                                {fmtShortDate(ms)}
                                {kindBadge ? <em className={styles.dmTimeKind}>{kindBadge.label}</em> : null}
                              </span>
                            ) : (
                              <span className={styles.tagMuted}>—</span>
                            )}
                            {days !== null && row.alloc.state !== "done" ? (
                              <span className={days >= AGE_OLD_DAYS ? styles.dmAgeOld : styles.dmAge}>
                                {days}일째
                              </span>
                            ) : null}
                          </td>
                          <td>
                            {isFixed ? (
                              <span className={fpStyles.fixedBadge}>정가</span>
                            ) : row.it.amountRangeLabel ? (
                              <span className={styles.upboSet}>{row.it.amountRangeLabel}</span>
                            ) : null}{" "}
                            {row.it.itemName}
                          </td>
                          <td className={styles.sheetStateCell}>
                            {!row.v.fanId.trim() ? (
                              <span
                                className={styles.sheetLock}
                                title="계정ID 없는 시청자는 처리 수량이 저장되지 않아요 — 교환·양도 탭에서 계정ID를 채워 주세요"
                              >
                                ID 필요
                              </span>
                            ) : row.alloc.state === "part" ? (
                              <span
                                className={styles.tagWarn}
                                title="수량 일부만 처리된 조각 — 시청자별 목록의 −/+ 로 조정해요"
                              >
                                일부 {row.alloc.allocated}/{row.ref.quantity}
                              </span>
                            ) : (
                              <select
                                className={row.alloc.state === "done" ? styles.sheetSelDone : styles.sheetSel}
                                value={row.alloc.state === "done" ? "done" : "pending"}
                                onChange={(e) => toggleSheetRow(row, e.target.value === "done")}
                                aria-label={`${row.it.itemName} 배송 상태`}
                              >
                                <option value="pending">배송 중</option>
                                <option value="done">완료</option>
                              </select>
                            )}
                            {row.alloc.state === "done" ? (
                              row.alloc.doneAt ? (
                                <span className={styles.sheetDoneAt}>{fmtShortDateTime(row.alloc.doneAt)}</span>
                              ) : (
                                <span
                                  className={styles.sheetDoneAtWeak}
                                  title="완료 시각을 따로 기록하기 전에 수량으로 저장된 완료분 — 오래된 기록부터 자동 배정"
                                >
                                  수량 기준
                                </span>
                              )
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibleSheetRows.length > sheetLimit ? (
                <button
                  type="button"
                  className={styles.cmEditBtn}
                  onClick={() => setSheetLimit((n) => n + 300)}
                >
                  더 보기 ({Math.min(sheetLimit, visibleSheetRows.length)}/{visibleSheetRows.length}건 표시 중)
                </button>
              ) : null}
              </>
              )}
            </>
          ) : (
            <p className={styles.fieldHint}>아직 배송할 업보 기록이 없어요.</p>
          )}
        </>
      ) : (
        <HiddenViewersPanel
          slug={slug}
          hidden={hiddenViewers ?? []}
          archivedFanAt={archivedFanAt ?? {}}
          visibleViewers={nonArchivedViewers}
          rawProgress={rawCommitted}
          loading={loadingOps}
          dirty={dirty}
        />
      )}

      {/* 저장 바: 변경이 있을 때만 노출, 스크롤해도 따라옴 */}
      {dirty ? (
        <div className={styles.dmSaveBar}>
          <span className={styles.dmSaveInfo}>
            저장 안 됨 · 변경 {changes.length}명 · {changedItemCount}건
            {assignChangedCount > 0 ? ` · 시트 완료표시 ${assignChangedCount}건` : ""}
          </span>
          <div className={styles.dmSaveActions}>
            <button type="button" className={styles.dmRevertBtn} onClick={revert} disabled={savingProgress}>
              되돌리기
            </button>
            <button type="button" className={styles.dmSaveBtn} onClick={() => setConfirmOpen(true)} disabled={savingProgress}>
              저장
            </button>
          </div>
        </div>
      ) : null}

      {/* 기록 삭제 확인 모달 — 취소 엔진 재사용(되돌리기 가능) */}
      {deleteTarget ? (
        <div className={styles.modalOverlay} onClick={() => (deleting ? null : setDeleteTarget(null))} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dm-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="dm-delete-title" className={styles.modalTitle}>
              이 기록을 삭제할까요?
            </h3>
            <p className={styles.fieldHint}>
              <b>{deleteTarget.viewer.fanNickname || deleteTarget.viewer.fanId}</b> ·{" "}
              <b>{deleteTarget.item.itemName}</b> {deleteTarget.item.count}개를 업보에서 지웁니다. 팬
              화면·배송관리에서 사라지고, 교환·양도 탭 이력에는 취소로 남아 되돌릴 수 있어요.
            </p>
            <label style={{ display: "block", margin: "10px 0" }}>
              <span className={styles.fieldHint}>삭제 사유 (필수)</span>
              <input
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="예: 미션 모금 오인 기록 / 중복 집계"
                disabled={deleting}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  border: "1px solid var(--paper-line)",
                  borderRadius: 8,
                  background: "var(--paper)",
                  color: "var(--ink)",
                  fontSize: 13,
                }}
                aria-label="삭제 사유"
              />
            </label>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                닫기
              </button>
              <button
                type="button"
                className={styles.modalConfirm}
                style={{ background: "#b3261e" }}
                onClick={() => void commitDelete()}
                disabled={deleting || !deleteReason.trim()}
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 저장 전 확인 모달 */}
      {confirmOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setConfirmOpen(false)}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dm-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="dm-confirm-title" className={styles.modalTitle}>
              이대로 저장할까요?
            </h3>
            <p className={styles.fieldHint}>
              변경 {changes.length}명 · {changedItemCount}건
              {assignChangedCount > 0 ? ` · 시트 완료표시 ${assignChangedCount}건` : ""}. 아래 내용으로
              처리 상태를 서버 DB에 저장합니다.
            </p>
            {changes.length === 0 && assignChangedCount > 0 ? (
              <p className={styles.fieldHint}>
                수량 변경 없이 시트 보기 완료 표시(어느 후원 건을 완료로 쳤는지)만 바뀌었어요.
              </p>
            ) : null}
            <div className={styles.modalBody}>
              {changes.map((c) => (
                <div key={c.viewerKey} className={styles.changeRow}>
                  <div className={styles.changeName}>
                    <span className={styles.dmName}>{c.nickname}</span>
                    <span className={styles.dmId}>{c.fanId}</span>
                  </div>
                  <ul className={styles.changeItems}>
                    {c.items.map((ci) => (
                      <li key={ci.itemName} className={styles.changeItem}>
                        {ci.itemName} <span className={styles.changeArrow}>{ci.from} → {ci.to}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setConfirmOpen(false)}
                disabled={savingProgress}
              >
                취소
              </button>
              <button type="button" className={styles.modalConfirm} onClick={commitSave} disabled={savingProgress}>
                {savingProgress ? "저장 중…" : "확정 저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 시청자 메모 모달 */}
      {noteTarget ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setNoteTarget(null)}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dm-note-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="dm-note-title" className={styles.modalTitle}>
              시청자 메모
            </h3>
            <p className={styles.fieldHint}>
              {noteTarget.fanNickname} {noteTarget.fanId} · 현재 총 {noteTarget.total}개
            </p>
            <MemoImageAttach
              slug={slug}
              images={noteImagesDraft}
              onChange={setNoteImagesDraft}
              disabled={savingNote}
            >
              <textarea
                className={styles.dmNoteTextarea}
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="예: 2개 B에게 양도, 1개 처리 완료 (이미지도 붙여넣기 가능)"
                rows={9}
              />
            </MemoImageAttach>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setNoteTarget(null)}
                disabled={savingNote}
              >
                닫기
              </button>
              <button type="button" className={styles.modalConfirm} onClick={saveNote} disabled={savingNote}>
                {savingNote ? "저장 중…" : "메모 저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 완료 시청자 일괄 보관 확인 모달 */}
      {archiveConfirmOpen ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setArchiveConfirmOpen(false)}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dm-archive-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="dm-archive-title" className={styles.modalTitle}>
              완료 시청자를 숨길까요?
            </h3>
            <p className={styles.fieldHint}>
              {archivableDoneCount}명을 화면에서 숨길까요? 원본 기록은 삭제되지 않고, 팬 화면에서도
              보이지 않게 됩니다. 숨긴 시청자 탭에서 언제든 복구할 수 있어요.
              {doneViewers.length > archivableDoneCount
                ? ` (계정ID 없는 ${doneViewers.length - archivableDoneCount}명은 건너뜁니다.)`
                : ""}
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setArchiveConfirmOpen(false)}
                disabled={archiving}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.modalConfirm}
                onClick={archiveDoneViewers}
                disabled={archiving}
              >
                {archiving ? "숨김 처리 중…" : "숨기기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
