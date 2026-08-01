"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./page.module.css";
import fpStyles from "./fixedPriceNote.module.css";
import HiddenViewersPanel from "./HiddenViewersPanel";
import type {
  AggItem,
  DeliveryProgressItem,
  OpsState,
  ViewerNote,
  ViewerSummary,
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
}) {
  const [committed, setCommitted] = useState<DeliveryState>({});
  const [draft, setDraft] = useState<DeliveryState>({});
  // 서버 저장 처리수량 원본(기준선 보정 전) — 숨긴 시청자 탭의 복구 미리보기 계산용.
  const [rawCommitted, setRawCommitted] = useState<DeliveryState>({});
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
  const [noteTarget, setNoteTarget] = useState<ViewerSummary | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteImagesDraft, setNoteImagesDraft] = useState<string[]>([]);
  const [savingNote, setSavingNote] = useState(false);

  // 배송 관리 하위탭: 시청자별 목록(기존 화면) / 상품별 목록(상품 총량) / 숨긴 시청자(복구).
  const [mode, setMode] = useState<"viewers" | "products" | "hidden">("viewers");
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
  const dirty = changes.length > 0;
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
  const renderItemRow = (vKey: string, it: AggItem) => {
    const k = itemKey(it);
    const n = Math.min(deliveredOf(vKey, k), it.count);
    const itemDone = n >= it.count;
    // 정가기록 판별: amountRangeLabel === "정가" (집계 단계에서 sourceKey는 유실됨).
    const isFixed = it.amountRangeLabel === "정가";
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
      setConfirmOpen(false);
      setMessage({ type: "ok", text: "처리 수량이 서버 DB에 저장됐어요." });
    } catch {
      setMessage({ type: "err", text: "처리 수량 저장 실패. 잠시 후 다시 저장해 주세요." });
    } finally {
      setSavingProgress(false);
    }
  };

  const revert = () => setDraft(committed);

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
    const payload = { slug, exportedAt: new Date().toISOString(), deliveries: committed, notes };
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
                    취소
                  </button>
                </div>
              </div>

              {open ? (
                <div className={styles.dmDetail}>
                  {pendingItems.map((it) => renderItemRow(v.key, it))}

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
                      {foldOpen ? foldedItems.map((it) => renderItemRow(v.key, it)) : null}
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
              변경 {changes.length}명 · {changedItemCount}건. 아래 내용으로 처리 상태를 서버 DB에 저장합니다.
            </p>
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
