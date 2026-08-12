"use client";

// 스트리머 관리자용 "옷장(의상)" 편집 화면. 판만 제공, 업로드·운영은 스트리머 몫.
// - 묶음 사전 지정(테마·파츠·적용 월) 후 여러 장 드래그&드롭 / Ctrl+V 붙여넣기 / 파일 선택
// - 업로드 큐: 한 장씩 순차 전송(장별 실패 재시도), 클라이언트에서 리사이즈+webp 압축 후 업로드
// - 항목 표: 체크 일괄 변경(테마/파츠/월/숨김), 이름·메모 인라인 수정, 삭제(확인창), 테마 안 드래그 순서
// - 테마 관리: 추가·이름 변경·드래그 순서, 항목이 남아있는 테마는 삭제 불가
// 인증은 관리자 로그인 세션(쿠키) — ShowcaseManager 와 동일한 fetch 패턴.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
// upboSupabase(서버 전용 모듈)가 아니라 클라이언트 안전 모듈에서 가져온다 — couponAggregate 선례.
import {
  WARDROBE_MAX_ITEMS,
  WARDROBE_MONTH_PATTERN,
  WARDROBE_PARTS,
  WARDROBE_PART_LABEL,
  currentMonthKst,
  type WardrobePart,
  type WardrobeItem,
  type WardrobeState,
} from "../../lib/wardrobeShared";

// 파츠 <option> 목록(묶음 지정·일괄 변경·행 편집 3곳 공용) — 목록은 wardrobeShared 가 단일 출처.
const partOptions = WARDROBE_PARTS.map((p) => (
  <option key={p} value={p}>
    {WARDROBE_PART_LABEL[p]}
  </option>
));
import { optimizeImage } from "./imageOptimize";
import styles from "./wardrobe.module.css";

const IMAGE_MAX_WIDTH = 1200; // 포스터와 같은 폭 기준으로 압축
const ACCEPT = "image/png,image/jpeg,image/webp";

type QueueEntry = {
  key: string;
  file: File;
  name: string;
  preview: string;
  themeId: string;
  part: WardrobePart;
  month: string;
  status: "ready" | "uploading" | "done" | "error";
  error?: string;
  addedId?: string; // 업로드 완료 후 서버가 준 컷 id — "방금 올린 N장 세트로 묶기"에 쓴다
  variant: string; // 업로드 시 장별 색상 라벨(8/12 sy 지시) — 전송 전엔 폼으로, 완료 후엔 patch 로 반영
};

function queueKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "").trim() || "이름 없음";
}

// 여러 이름의 공통 앞부분(문자 단위) — 세트 이름 기본값과 색상 라벨 추정에 쓴다.
// 예: ["리본키니화이트","리본키니블랙"] → "리본키니" / 나머지("화이트","블랙")가 색상 후보.
function commonRawPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

// 접두사·라벨 경계의 구분 문자(공백/언더바/하이픈/점) 정리.
function trimEdge(value: string): string {
  return value.replace(/^[\s_\-–·.]+/, "").replace(/[\s_\-–·.]+$/, "").trim();
}

export default function WardrobeManager({ slug, initial }: { slug: string; initial: WardrobeState | null }) {
  // 기본 테마 없음 — 첫 사용 시 스트리머가 테마부터 만든다(예시 미제공, sy 확정 8/4).
  const [state, setState] = useState<WardrobeState>(initial ?? { themes: [], items: [] });
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [preset, setPreset] = useState<{ themeId: string; part: WardrobePart; month: string }>({
    themeId: initial?.themes[0]?.id ?? "",
    part: "outfit",
    month: currentMonthKst(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkMonthRef = useRef<HTMLInputElement>(null);
  const queueRunning = useRef(false);
  // cleanup 클로저가 최신 큐를 보도록 ref 로 미러링(빈 초기 큐를 잡는 no-op 방지).
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    // 큐 미리보기 objectURL 정리(언마운트 시 전부).
    return () => {
      for (const entry of queueRef.current) URL.revokeObjectURL(entry.preview);
    };
  }, []);

  const totalCount = state.items.length + queue.filter((q) => q.status !== "done" && q.status !== "error").length;
  // 올리기 대상 테마: 고른 테마가 (삭제 등으로) 없어졌으면 첫 테마로, 테마가 하나도 없으면 빈 값.
  const presetThemeId = state.themes.some((t) => t.id === preset.themeId)
    ? preset.themeId
    : state.themes[0]?.id ?? "";
  const noThemes = state.themes.length === 0;
  // 업로드가 도는 동안 편집 액션을 잠근다 — 서버가 전체 스냅샷(last-write-wins)을 쓰는 구조라
  // 업로드와 편집이 겹치면 늦게 저장된 쪽이 먼저 저장된 쪽을 되돌린다(항목·수정 유실).
  const uploading = queue.some((q) => q.status === "ready" || q.status === "uploading");
  const locked = busy || uploading;

  // ── 업로드 큐 ──────────────────────────────────────────────

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;
      if (!presetThemeId) {
        setMsg({ kind: "err", text: "먼저 아래 ③에서 테마를 만들어 주세요." });
        return;
      }
      const room = WARDROBE_MAX_ITEMS - totalCount;
      if (room <= 0) {
        setMsg({ kind: "err", text: `옷장은 숨김 포함 최대 ${WARDROBE_MAX_ITEMS}장까지예요.` });
        return;
      }
      const accepted = images.slice(0, room);
      if (accepted.length < images.length) {
        setMsg({ kind: "err", text: `상한(${WARDROBE_MAX_ITEMS}장) 때문에 ${accepted.length}장만 올려요.` });
      }
      setQueue((prev) => [
        ...prev,
        ...accepted.map((file) => ({
          key: queueKey(),
          file,
          name: baseName(file.name),
          preview: URL.createObjectURL(file),
          themeId: presetThemeId,
          part: preset.part,
          month: preset.month,
          status: "ready" as const,
          variant: "",
        })),
      ]);
    },
    [preset, presetThemeId, totalCount],
  );

  // 큐를 한 장씩 순차 업로드. 실패한 장은 error 로 남고 "다시 올리기"로 재시도.
  // busy(편집 저장 중)일 때는 시작하지 않는다 — busy 가 풀리면 deps 로 다시 돈다.
  useEffect(() => {
    if (queueRunning.current || busy) return;
    const next = queue.find((q) => q.status === "ready");
    if (!next) return;
    queueRunning.current = true;
    (async () => {
      setQueue((prev) => prev.map((q) => (q.key === next.key ? { ...q, status: "uploading" } : q)));
      try {
        const optimized = await optimizeImage(next.file, IMAGE_MAX_WIDTH);
        const formData = new FormData();
        formData.set("file", optimized);
        formData.set("name", next.name);
        formData.set("themeId", next.themeId);
        formData.set("part", next.part);
        formData.set("month", next.month);
        // 색상은 전송 직전의 최신 입력값을 쓴다(압축하는 동안 타이핑한 값도 반영).
        formData.set("variant", (queueRef.current.find((q) => q.key === next.key)?.variant ?? "").trim());
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/wardrobe`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false || !data?.wardrobe) {
          throw new Error(data?.error || "업로드 실패");
        }
        setState(data.wardrobe as WardrobeState);
        const addedId = typeof data.addedId === "string" ? data.addedId : undefined;
        setQueue((prev) => prev.map((q) => (q.key === next.key ? { ...q, status: "done", addedId } : q)));
      } catch (error) {
        setQueue((prev) =>
          prev.map((q) =>
            q.key === next.key ? { ...q, status: "error", error: (error as Error).message } : q,
          ),
        );
      } finally {
        queueRunning.current = false;
        // 다음 ready 항목은 queue 상태 변경으로 이 effect 가 다시 돌며 집어간다.
      }
    })();
  }, [queue, slug, busy]);

  const retryEntry = (key: string) =>
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, status: "ready", error: undefined } : q)));
  const clearFinished = useCallback(
    () =>
      setQueue((prev) => {
        for (const q of prev) if (q.status === "done") URL.revokeObjectURL(q.preview);
        return prev.filter((q) => q.status !== "done");
      }),
    [],
  );

  // 화면이 떠 있는 동안 Ctrl+V 로 이미지 붙여넣기(디스코드·카톡에서 복사한 짤).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // ── JSON 액션 공통 ─────────────────────────────────────────

  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      // 업로드 진행 중엔 편집 저장을 받지 않는다(스냅샷 경합 방지 — 버튼 잠금의 이중 안전장치).
      if (queueRef.current.some((q) => q.status === "ready" || q.status === "uploading")) {
        setMsg({ kind: "err", text: "업로드가 끝난 뒤 다시 시도해 주세요." });
        return false;
      }
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/wardrobe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false || !data?.wardrobe) {
          setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
          return false;
        }
        setState(data.wardrobe as WardrobeState);
        setMsg({ kind: "ok", text: "저장했어요." });
        return true;
      } catch {
        setMsg({ kind: "err", text: "저장 실패 — 연결을 확인해 주세요." });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [slug],
  );

  const patchItems = (ids: string[], set: Record<string, unknown>) => postAction({ action: "patch", ids, set });

  // 일괄 변경(테마/파츠/월/숨김/공개) 성공 시 선택 자동 해제 — 변경 후 체크가 남아
  // 하나하나 꺼야 했던 불편(sy 실측 8/12). 행 단위 수정(patchItems 직접 호출)은 해제 안 함.
  const bulkPatch = async (set: Record<string, unknown>) => {
    if (await patchItems(selectedIds, set)) clearSelection();
  };

  // ── 선택/일괄 ─────────────────────────────────────────────

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectedIds = useMemo(() => [...selected].filter((id) => state.items.some((i) => i.id === id)), [selected, state.items]);

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`선택한 ${selectedIds.length}장을 삭제할까요? 삭제하면 되돌릴 수 없어요. (지난 의상은 삭제 대신 숨기기를 추천)`)) return;
    if (await postAction({ action: "delete", ids: selectedIds })) clearSelection();
  };

  // ── 색상 세트 ─────────────────────────────────────────────
  // 세트별 장수(이름 옆 "세트" 배지 툴팁·해체 판단은 서버 몫, 여기선 표시용).
  const setSizes = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of state.items) if (i.setId) map.set(i.setId, (map.get(i.setId) ?? 0) + 1);
    return map;
  }, [state.items]);

  // 색상 세트로 묶기 — 세트 이름 하나를 물어 전원에 통일하고, 기존 이름의 공통 접두사를
  // 뺀 나머지를 색상 라벨로 미리 채워 준다("리본키니화이트" → 세트 "리본키니" + 색상 "화이트").
  const groupByIds = useCallback(
    async (ids: string[], clearQueueAfter = false) => {
      const members = state.items.filter((i) => ids.includes(i.id));
      if (members.length < 2) {
        setMsg({ kind: "err", text: "색상 세트는 2장 이상 골라야 묶을 수 있어요." });
        return;
      }
      const rawPrefix = commonRawPrefix(members.map((m) => m.name));
      const defaultName = trimEdge(rawPrefix) || members[0].name;
      const input = window.prompt("세트 이름 — 묶인 컷 전부 이 이름으로 통일돼요", defaultName);
      if (input === null) return;
      const variants: Record<string, string> = {};
      for (const m of members) {
        variants[m.id] = m.variant || trimEdge(m.name.slice(rawPrefix.length));
      }
      if (await postAction({ action: "group", ids, name: input.trim() || defaultName, variants })) {
        clearSelection();
        if (clearQueueAfter) clearFinished();
        setMsg({ kind: "ok", text: "세트로 묶었어요 — 색상 칸이 비어 있으면 각 컷의 색 이름을 적어 주세요." });
      }
    },
    // clearSelection/clearFinished 는 매 렌더 새로 만들어지는 함수 — deps 에 넣어 린트 규칙을
    // 지키되, 내부는 setState 만 쓰므로 재생성 비용 외 부작용은 없다.
    [state.items, postAction, clearSelection, clearFinished],
  );

  const ungroupSelected = async () => {
    if (selectedIds.length === 0) return;
    if (await postAction({ action: "ungroup", ids: selectedIds })) clearSelection();
  };

  // 방금 올린 묶음(업로드 큐에서 완료된 컷들) — 큐가 다 끝났을 때만 원클릭 묶기를 권한다.
  const justUploadedIds = useMemo(
    () =>
      uploading
        ? []
        : queue
            .filter((q) => q.status === "done" && q.addedId && state.items.some((i) => i.id === q.addedId))
            .map((q) => q.addedId as string),
    [queue, uploading, state.items],
  );

  // ── 항목 표(테마별 그룹) + 드래그 순서 ─────────────────────

  const grouped = useMemo(
    () =>
      state.themes
        .map((t) => ({
          theme: t,
          items: state.items.filter((i) => i.themeId === t.id).sort((a, b) => a.order - b.order),
        }))
        .filter((g) => g.items.length > 0),
    [state],
  );

  const onRowDrop = (targetId: string) => {
    if (!dragItemId || dragItemId === targetId) return;
    const source = state.items.find((i) => i.id === dragItemId);
    const target = state.items.find((i) => i.id === targetId);
    if (!source || !target || source.themeId !== target.themeId) return; // 순서는 같은 테마 안에서만
    const list = state.items
      .filter((i) => i.themeId === source.themeId)
      .sort((a, b) => a.order - b.order)
      .map((i) => i.id);
    const srcIdx = list.indexOf(dragItemId);
    const tgtIdx = list.indexOf(targetId);
    list.splice(srcIdx, 1);
    // 아래로 끌면 대상 "뒤", 위로 끌면 대상 "앞" — 제거 후 인덱스 보정까지 tgtIdx 하나로 맞는다.
    list.splice(tgtIdx, 0, dragItemId);
    void postAction({ action: "reorder", themeId: source.themeId, orderedIds: list });
  };

  // ── 테마 관리 ─────────────────────────────────────────────

  const themeItemCount = (themeId: string) => state.items.filter((i) => i.themeId === themeId).length;
  const saveThemes = (themes: Array<{ id?: string; name: string }>) => postAction({ action: "themes", themes });

  const renameTheme = (themeId: string, name: string) => {
    const trimmed = name.trim();
    const prev = state.themes.find((t) => t.id === themeId)?.name ?? "";
    if (!trimmed || trimmed === prev) return;
    void saveThemes(state.themes.map((t) => (t.id === themeId ? { id: t.id, name: trimmed } : t)));
  };
  const addTheme = () => {
    const name = window.prompt("새 테마 이름");
    if (!name?.trim()) return;
    void saveThemes([...state.themes.map((t) => ({ id: t.id, name: t.name })), { name: name.trim() }]);
  };
  const removeTheme = (themeId: string) => {
    if (themeItemCount(themeId) > 0) {
      setMsg({ kind: "err", text: "항목이 남아있는 테마는 삭제할 수 없어요 — 먼저 옮기거나 비워 주세요." });
      return;
    }
    if (!window.confirm("이 테마를 삭제할까요?")) return;
    void saveThemes(state.themes.filter((t) => t.id !== themeId).map((t) => ({ id: t.id, name: t.name })));
  };
  const [dragThemeId, setDragThemeId] = useState<string | null>(null);
  const onThemeDrop = (targetId: string) => {
    if (!dragThemeId || dragThemeId === targetId) return;
    const ids = state.themes.map((t) => t.id).filter((id) => id !== dragThemeId);
    ids.splice(ids.indexOf(targetId), 0, dragThemeId);
    const byId = new Map(state.themes.map((t) => [t.id, t] as const));
    void saveThemes(ids.map((id) => ({ id, name: byId.get(id)!.name })));
  };

  // ── 렌더 ─────────────────────────────────────────────────

  return (
    <div className={styles.adminWrap}>
      {/* ① 올리기: 묶음 성격을 먼저 정하고 떨어뜨린 파일 전부에 일괄 적용 */}
      <div className={styles.presetRow}>
        <span className={styles.sectionLabel}>① 올리기</span>
        <label>
          테마{" "}
          <select
            value={presetThemeId}
            onChange={(e) => setPreset((p) => ({ ...p, themeId: e.target.value }))}
            disabled={noThemes}
          >
            {noThemes ? <option value="">테마를 먼저 만드세요</option> : null}
            {state.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          파츠{" "}
          <select
            value={preset.part}
            onChange={(e) => setPreset((p) => ({ ...p, part: e.target.value as WardrobePart }))}
          >
            {partOptions}
          </select>
        </label>
        <label>
          적용 월{" "}
          <input
            type="month"
            value={preset.month}
            onChange={(e) => setPreset((p) => ({ ...p, month: e.target.value || currentMonthKst() }))}
          />
        </label>
      </div>

      <div
        className={dragOver ? `${styles.dropzone} ${styles.dropzoneActive}` : styles.dropzone}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // Space 의 페이지 스크롤 방지
            fileInputRef.current?.click();
          }
        }}
      >
        <span>
          {noThemes ? "먼저 아래 ③에서 테마를 만들어 주세요" : "여기에 여러 장 끌어다 놓기 · 클릭해서 파일 선택"}
        </span>
        <span className={styles.dropzoneHint}>
          Ctrl+V(⌘V) 붙여넣기도 돼요 · jpg/png/webp · 자동으로 용량을 줄여 올려요 · 아이폰 사진(HEIC)은
          jpg 로 바꿔서 올려 주세요
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {queue.length > 0 ? (
        <div className={styles.queue}>
          {queue.map((q) => (
            <div key={q.key} className={styles.queueRow}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.queueThumb} src={q.preview} alt="" />
              <span className={styles.queueName}>{q.name}</span>
              {/* 장별 색상(선택) — 올라가기 전엔 전송에 실리고, 이미 완료된 장은 바로 저장(patch)한다.
                  여기 적고 "방금 올린 N장 세트로 묶기"를 누르면 색상 칩까지 한 번에 끝난다. */}
              <input
                className={styles.queueVariantInput}
                value={q.variant}
                placeholder="색상"
                maxLength={20}
                onChange={(e) =>
                  setQueue((prev) => prev.map((p) => (p.key === q.key ? { ...p, variant: e.target.value } : p)))
                }
                onBlur={() => {
                  const cur = queueRef.current.find((p) => p.key === q.key);
                  if (cur?.status !== "done" || !cur.addedId) return;
                  const item = state.items.find((i) => i.id === cur.addedId);
                  const v = cur.variant.trim();
                  if (item && v !== item.variant) void patchItems([cur.addedId], { variant: v });
                }}
                aria-label={`${q.name} 색상`}
              />
              {q.status === "error" ? (
                <>
                  <span className={`${styles.queueStatus} ${styles.queueError}`}>{q.error}</span>
                  <button type="button" onClick={() => retryEntry(q.key)}>
                    다시 올리기
                  </button>
                </>
              ) : (
                <span className={styles.queueStatus}>
                  {q.status === "done" ? "완료" : q.status === "uploading" ? "올리는 중…" : "대기"}
                </span>
              )}
            </div>
          ))}
          {queue.some((q) => q.status === "done") ? (
            <div className={styles.queueFootRow}>
              {justUploadedIds.length >= 2 ? (
                <button type="button" className={styles.rowBtn} onClick={() => void groupByIds(justUploadedIds, true)}>
                  방금 올린 {justUploadedIds.length}장 색상 세트로 묶기
                </button>
              ) : null}
              <button type="button" className={styles.rowBtn} onClick={clearFinished}>
                완료된 항목 지우기
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ② 정리: 체크 후 일괄 변경, 행 드래그로 같은 테마 안 순서 변경 */}
      <div className={styles.bulkBar}>
        <span className={styles.sectionLabel}>② 정리</span>
        <span>선택 {selectedIds.length}장:</span>
        <select
          disabled={selectedIds.length === 0 || locked}
          value=""
          onChange={(e) => {
            if (e.target.value) void bulkPatch({ themeId: e.target.value });
          }}
        >
          <option value="">테마 변경…</option>
          {state.themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          disabled={selectedIds.length === 0 || locked}
          value=""
          onChange={(e) => {
            if (e.target.value) void bulkPatch({ part: e.target.value });
          }}
        >
          <option value="">파츠 변경…</option>
          {partOptions}
        </select>
        <button
          type="button"
          disabled={selectedIds.length < 2 || locked}
          title="색상만 다른 같은 의상을 한 카드로 묶어요 (같은 테마·같은 파츠끼리만)"
          onClick={() => void groupByIds(selectedIds)}
        >
          색상 세트 묶기
        </button>
        <button
          type="button"
          disabled={selectedIds.length === 0 || locked}
          onClick={() => void ungroupSelected()}
        >
          세트 풀기
        </button>
        {/* month 미지원 브라우저(파이어폭스·사파리 데스크톱)는 text 폴백이라 타이핑 중 저장 금지 —
            값을 고른 뒤 "월 적용" 버튼으로만 저장한다. 형식 검사는 서버와 같은 규칙. */}
        <input
          type="month"
          ref={bulkMonthRef}
          disabled={selectedIds.length === 0 || locked}
          title="적용 월 선택"
          placeholder="YYYY-MM"
        />
        <button
          type="button"
          disabled={selectedIds.length === 0 || locked}
          onClick={() => {
            const v = bulkMonthRef.current?.value ?? "";
            if (!WARDROBE_MONTH_PATTERN.test(v)) {
              setMsg({ kind: "err", text: "월은 2026-08 형식으로 골라 주세요." });
              return;
            }
            void bulkPatch({ month: v });
          }}
        >
          월 적용
        </button>
        <button
          type="button"
          disabled={selectedIds.length === 0 || locked}
          onClick={() => void bulkPatch({ hidden: true })}
        >
          숨기기
        </button>
        <button
          type="button"
          disabled={selectedIds.length === 0 || locked}
          onClick={() => void bulkPatch({ hidden: false })}
        >
          공개
        </button>
        <button type="button" disabled={selectedIds.length === 0 || locked} onClick={() => void bulkDelete()}>
          삭제
        </button>
        <span className={styles.counter}>
          {state.items.length} / {WARDROBE_MAX_ITEMS}장
        </span>
      </div>

      {grouped.length === 0 ? (
        <p className={styles.empty}>아직 올린 컷이 없어요. 위에서 첫 의상을 올려 보세요.</p>
      ) : (
        <div className={styles.itemTableWrap}>
          <table className={styles.itemTable}>
            <thead>
              <tr>
                <th aria-label="순서" />
                <th aria-label="선택" />
                <th>컷</th>
                <th>이름</th>
                <th>색상</th>
                <th>파츠</th>
                <th>적용 월</th>
                <th>한줄메모</th>
                <th>상태</th>
                <th title="체크한 컷은 팬 옷장 '메인' 탭에 고정되고, 첫 화면이 메인 탭으로 열려요">메인</th>
              </tr>
            </thead>
            {grouped.map((g) => (
              <tbody key={g.theme.id}>
                <tr>
                  <td colSpan={10} className={styles.sectionLabel}>
                    {g.theme.name} ({g.items.length})
                  </td>
                </tr>
                {g.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    themes={state.themes}
                    setSize={item.setId ? setSizes.get(item.setId) ?? 0 : 0}
                    selected={selected.has(item.id)}
                    busy={locked}
                    dragOver={dragOverItemId === item.id}
                    onToggleSelect={() => toggleSelect(item.id)}
                    onPatch={(set) => void patchItems([item.id], set)}
                    onDragStart={(e) => {
                      // Firefox 는 setData 없이는 드래그가 시작되지 않는다(SortableSections 와 동일 패턴).
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", item.id);
                      setDragItemId(item.id);
                    }}
                    onDragOverRow={() => setDragOverItemId(item.id)}
                    onDropRow={() => {
                      onRowDrop(item.id);
                      setDragItemId(null);
                      setDragOverItemId(null);
                    }}
                    onDragEnd={() => {
                      setDragItemId(null);
                      setDragOverItemId(null);
                    }}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {/* ③ 테마 관리 */}
      <div className={styles.themeManageRow}>
        <span className={styles.sectionLabel}>③ 테마</span>
        {state.themes.map((t) => (
          <span
            key={`${t.id}-${t.name}`}
            className={styles.themeChip}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.id);
              setDragThemeId(t.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              onThemeDrop(t.id);
              setDragThemeId(null);
            }}
            onDragEnd={() => setDragThemeId(null)}
          >
            <span className={styles.dragHandle} aria-hidden="true">
              ⠿
            </span>
            <input
              defaultValue={t.name}
              disabled={locked}
              onBlur={(e) => renameTheme(t.id, e.target.value)}
              aria-label={`테마 이름: ${t.name}`}
            />
            <button
              type="button"
              onClick={() => removeTheme(t.id)}
              disabled={locked}
              title={themeItemCount(t.id) > 0 ? "항목이 남아있어 삭제할 수 없어요" : "테마 삭제"}
            >
              ×
            </button>
          </span>
        ))}
        <button type="button" className={styles.rowBtn} onClick={addTheme} disabled={locked}>
          ＋ 테마 추가
        </button>
      </div>

      {msg ? <p className={msg.kind === "ok" ? styles.statusOk : styles.statusErr}>{msg.text}</p> : null}
      <p className={styles.rightsNote}>
        업로드한 이미지의 권리·책임은 업로더(스트리머)에게 있어요. 팬 화면에는 공개 상태의 컷만, 1장
        이상일 때만 옷장 탭이 보여요.
      </p>
    </div>
  );
}

function ItemRow({
  item,
  themes,
  setSize,
  selected,
  busy,
  dragOver,
  onToggleSelect,
  onPatch,
  onDragStart,
  onDragOverRow,
  onDropRow,
  onDragEnd,
}: {
  item: WardrobeItem;
  themes: WardrobeState["themes"];
  setSize: number; // 이 컷이 속한 색상 세트의 장수(세트 없으면 0) — 배지 표시용
  selected: boolean;
  busy: boolean;
  dragOver: boolean;
  onToggleSelect: () => void;
  onPatch: (set: Record<string, unknown>) => void;
  onDragStart: (e: DragEvent<HTMLSpanElement>) => void;
  onDragOverRow: () => void;
  onDropRow: () => void;
  onDragEnd: () => void;
}) {
  // 이름/메모는 타이핑 중 서버 왕복을 막기 위해 blur 시점에만 저장한다.
  const saveText = (field: "name" | "memo", value: string, prev: string) => {
    const trimmed = value.trim();
    if (trimmed === prev) return;
    onPatch({ [field]: trimmed });
  };

  return (
    <tr
      className={[item.hidden ? styles.rowHidden : "", dragOver ? styles.rowDragOver : ""].join(" ").trim() || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverRow();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropRow();
      }}
    >
      <td>
        <span
          className={styles.dragHandle}
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="끌어서 같은 테마 안 순서 변경"
        >
          ⠿
        </span>
      </td>
      <td>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`${item.name} 선택`} />
      </td>
      <td>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.rowThumb} src={item.url} alt="" loading="lazy" />
      </td>
      <td>
        <div className={styles.nameCell}>
          {setSize > 0 ? (
            <span className={styles.setBadge} title={`색상 세트 (${setSize}벌)`}>
              세트
            </span>
          ) : null}
          {/* key 에 값 포함 — 일괄 변경 등 외부 갱신 시 defaultValue 를 다시 반영(리마운트). */}
          <input
            key={`name-${item.name}`}
            className={styles.inlineInput}
            defaultValue={item.name}
            disabled={busy}
            onBlur={(e) => {
              // 빈 이름은 서버가 기존 이름을 유지하므로, 입력창도 되돌려 화면·상태 불일치를 막는다.
              if (!e.target.value.trim()) {
                e.target.value = item.name;
                return;
              }
              saveText("name", e.target.value, item.name);
            }}
            aria-label="이름"
          />
        </div>
      </td>
      <td>
        {/* 색상 라벨 — 세트 안 칩 이름. 빈 값 저장 허용(지우기)이라 name 과 달리 되돌리지 않는다. */}
        <input
          key={`variant-${item.variant}`}
          className={styles.variantInput}
          defaultValue={item.variant}
          placeholder="색상"
          disabled={busy}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== item.variant) onPatch({ variant: v });
          }}
          aria-label="색상(세트 칩 라벨)"
        />
      </td>
      <td>
        <select
          className={styles.rowSelect}
          value={item.part}
          disabled={busy}
          onChange={(e) => onPatch({ part: e.target.value })}
          aria-label="파츠"
        >
          {partOptions}
        </select>
      </td>
      <td>
        {/* month 미지원 브라우저는 text 폴백 → 타이핑 중 저장 금지, blur 에서 형식 통과 시에만 저장. */}
        <input
          key={`month-${item.month}`}
          type="month"
          className={styles.rowSelect}
          defaultValue={item.month}
          disabled={busy}
          onBlur={(e) => {
            const v = e.target.value;
            if (v === item.month) return;
            if (!WARDROBE_MONTH_PATTERN.test(v)) {
              e.target.value = item.month;
              return;
            }
            onPatch({ month: v });
          }}
          aria-label="적용 월"
        />
      </td>
      <td>
        <input
          key={`memo-${item.memo}`}
          className={styles.inlineInput}
          defaultValue={item.memo}
          placeholder="한줄메모"
          disabled={busy}
          onBlur={(e) => saveText("memo", e.target.value, item.memo)}
          aria-label="한줄메모"
        />
      </td>
      <td>
        <button
          type="button"
          className={styles.rowBtn}
          disabled={busy}
          onClick={() => onPatch({ hidden: !item.hidden })}
        >
          {item.hidden ? "숨김 → 공개" : "공개 → 숨김"}
        </button>
      </td>
      <td>
        {/* 메인 고정(8/12 sy 지시) — 체크한 컷이 팬 옷장 "메인" 탭에 오르고 첫 화면이 된다. */}
        <input
          type="checkbox"
          checked={item.featured}
          disabled={busy}
          onChange={(e) => onPatch({ featured: e.target.checked })}
          aria-label={`${item.name} 메인 고정`}
        />
      </td>
    </tr>
  );
}
