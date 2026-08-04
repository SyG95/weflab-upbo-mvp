"use client";

// 팬 화면 "옷장" 탭. 스트리머가 등록한 의상·헤어 컷을 격자로 보여준다(읽기 전용).
// 기본 보기=월별(이번 달, 0장이면 최근 항목 있는 달로 폴백), 테마별 보기 전환, 파츠 필터.
// 정렬 규칙(sy 확정): 월별=최신 등록순 고정, 테마별=테마 안 수동 순서(order).
// 크게보기 모달은 ShowcasePosterRail 의 UX(←→/Esc/배경 클릭)를 따르고, 컷별 링크 복사를 더했다.
// 월/테마/파츠 전환은 전부 클라이언트 계산 — 서버 왕복 없음(전체 컷을 한 번에 받는다, 상한 100장).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { currentMonthKst, type WardrobeItem, type WardrobeTheme } from "../../lib/wardrobeShared";
import styles from "./wardrobe.module.css";

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // NEW 배지: 공개 시작 + 2주
const PART_LABEL: Record<WardrobeItem["part"], string> = { outfit: "의상", hair: "헤어" };

type PartFilter = "all" | "outfit" | "hair";
type ViewMode = "month" | "theme";

function isNew(item: WardrobeItem, now: number): boolean {
  if (!item.publishedAt) return false;
  const t = Date.parse(item.publishedAt);
  return Number.isFinite(t) && now - t < NEW_WINDOW_MS;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return y && m ? `${y}. ${m}` : month;
}

// 최신 등록순(월별 보기 고정 정렬). publishedAt 이 없으면 뒤로.
function byNewest(a: WardrobeItem, b: WardrobeItem): number {
  return (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0);
}

export default function WardrobeFanView({
  slug,
  themes,
  items,
  searchQuery,
  initialItemId,
}: {
  slug: string;
  themes: WardrobeTheme[];
  items: WardrobeItem[]; // 공개(hidden=false) 컷만 서버에서 걸러 넘어온다
  searchQuery: string;
  initialItemId: string | null; // ?w=<id> 딥링크 — 해당 컷의 크게보기를 바로 연다
}) {
  // 렌더 중 Date.now() 호출은 lint(purity) 위반 — 마운트 시각으로 고정(NEW 2주 판정엔 충분).
  const [now] = useState(() => Date.now());
  const themeName = useMemo(() => new Map(themes.map((t) => [t.id, t.name])), [themes]);

  // 검색(상단 "내 업보 확인" 검색창 공유) + 파츠 필터.
  const [part, setPart] = useState<PartFilter>("all");
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (part !== "all" && item.part !== part) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.memo.toLowerCase().includes(q) ||
        (themeName.get(item.themeId) ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, part, searchQuery, themeName]);

  // 월 목록(항목 있는 달만, 최신 달부터). 기본 선택=이번 달, 없으면 가장 최근 달.
  const months = useMemo(() => {
    const set = new Set(filtered.map((i) => i.month).filter(Boolean));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [filtered]);
  const [currentMonth] = useState(() => currentMonthKst());
  const [view, setView] = useState<ViewMode>("month");
  const [month, setMonth] = useState<string | null>(null);
  const selectedMonth = month && months.includes(month) ? month : months.includes(currentMonth) ? currentMonth : months[0] ?? null;
  const monthIdx = selectedMonth ? months.indexOf(selectedMonth) : -1;

  const monthItems = useMemo(
    () =>
      selectedMonth
        ? filtered.filter((i) => i.month === selectedMonth).sort(byNewest)
        : // month 값이 빈(손상) 항목만 있는 경우 — 말없이 빈 격자를 보여주지 않고 전체를 최신순으로.
          [...filtered].sort(byNewest),
    [filtered, selectedMonth],
  );
  // 테마별 보기: 스트리머가 정한 테마 순서, 테마 안은 수동 순서(order).
  const themeSections = useMemo(
    () =>
      themes
        .map((t) => ({
          theme: t,
          items: filtered.filter((i) => i.themeId === t.id).sort((a, b) => a.order - b.order),
        }))
        .filter((s) => s.items.length > 0),
    [themes, filtered],
  );

  // 크게보기 모달. 넘김 목록 = 현재 보기의 표시 순서. 딥링크 컷이 현재 필터에 없으면 그 컷 하나만.
  const displayList = useMemo(
    () => (view === "month" ? monthItems : themeSections.flatMap((s) => s.items)),
    [view, monthItems, themeSections],
  );
  // 딥링크(?w=)는 초기 상태로 바로 연다(effect 내 setState 는 lint 위반 + 불필요한 재렌더).
  const [openId, setOpenId] = useState<string | null>(() =>
    initialItemId && items.some((i) => i.id === initialItemId) ? initialItemId : null,
  );
  const modalList = useMemo(() => {
    if (openId && !displayList.some((i) => i.id === openId)) {
      const item = items.find((i) => i.id === openId);
      return item ? [item] : displayList;
    }
    return displayList;
  }, [openId, displayList, items]);
  const openIdx = openId ? modalList.findIndex((i) => i.id === openId) : -1;
  const openItem = openIdx >= 0 ? modalList[openIdx] : null;

  const close = useCallback(() => setOpenId(null), []);
  const move = useCallback(
    (dir: -1 | 1) => {
      if (openIdx < 0 || modalList.length === 0) return;
      setOpenId(modalList[(openIdx + dir + modalList.length) % modalList.length].id);
    },
    [openIdx, modalList],
  );

  // 모달이 열려 있는 동안만 키보드 조작 + 배경 스크롤 잠금(ShowcasePosterRail 과 동일).
  useEffect(() => {
    if (!openItem) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openItem, close, move]);

  // 컷별 공유 링크 복사(스트리머가 공지에서 특정 컷을 바로 가리킬 때).
  const [copied, setCopied] = useState(false);
  const copyLink = useCallback(
    async (id: string) => {
      const url = `${window.location.origin}/${encodeURIComponent(slug)}?tab=wardrobe&w=${encodeURIComponent(id)}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        window.prompt("이 주소를 복사해 주세요", url);
      }
    },
    [slug],
  );

  const card = (item: WardrobeItem) => (
    <button key={item.id} type="button" className={styles.card} onClick={() => setOpenId(item.id)}>
      <span className={styles.thumb}>
        {isNew(item, now) ? <span className={styles.newBadge}>NEW</span> : null}
        {/* 목록 썸네일은 lazy — 수십 장이어도 화면에 들어올 때만 내려받는다.
            원본 비율·외부 도메인 문제로 next/image 대신 img(쇼케이스와 동일 관례). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.name} loading="lazy" />
      </span>
      <span className={styles.cardName}>{item.name}</span>
      <span className={styles.cardMeta}>
        {themeName.get(item.themeId) ?? "테마 없음"} · {PART_LABEL[item.part]}
      </span>
    </button>
  );

  return (
    <div className={styles.fanWrap}>
      <div className={styles.controls}>
        {view === "month" ? (
          <div className={styles.monthNav} aria-label="월 이동">
            <button
              type="button"
              onClick={() => monthIdx < months.length - 1 && setMonth(months[monthIdx + 1])}
              disabled={monthIdx >= months.length - 1}
              aria-label="지난 달"
            >
              ‹
            </button>
            <strong>{selectedMonth ? monthLabel(selectedMonth) : "—"}</strong>
            <button
              type="button"
              onClick={() => monthIdx > 0 && setMonth(months[monthIdx - 1])}
              disabled={monthIdx <= 0}
              aria-label="다음 달"
            >
              ›
            </button>
          </div>
        ) : (
          <span className={styles.themeViewLabel}>테마별 전체 보기</span>
        )}
        <div className={styles.chipRow}>
          <button type="button" className={view === "month" ? styles.chipOn : styles.chip} onClick={() => setView("month")}>
            월별
          </button>
          <button type="button" className={view === "theme" ? styles.chipOn : styles.chip} onClick={() => setView("theme")}>
            테마별
          </button>
          <span className={styles.chipDivider} aria-hidden="true" />
          {(["all", "outfit", "hair"] as const).map((p) => (
            <button key={p} type="button" className={part === p ? styles.chipOn : styles.chip} onClick={() => setPart(p)}>
              {p === "all" ? "전체" : PART_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {searchQuery ? `'${searchQuery}'에 해당하는 컷이 없어요.` : "조건에 맞는 컷이 없어요."}
        </p>
      ) : view === "month" ? (
        <div className={styles.grid}>{monthItems.map(card)}</div>
      ) : (
        themeSections.map((s) => (
          <section key={s.theme.id} className={styles.themeSection}>
            <h3 className={styles.themeTitle}>
              {s.theme.name} <span className={styles.themeCount}>{s.items.length}</span>
            </h3>
            <div className={styles.grid}>{s.items.map(card)}</div>
          </section>
        ))
      )}

      {openItem
        ? createPortal(
            <div className={styles.modalBackdrop} onClick={close} role="dialog" aria-modal="true" aria-label={openItem.name}>
              <div className={styles.modalBody} onClick={(e) => e.stopPropagation()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.modalImage} src={openItem.url} alt={openItem.name} />
                <div className={styles.modalInfo}>
                  <strong>{openItem.name}</strong>
                  <span>
                    {themeName.get(openItem.themeId) ?? "테마 없음"} · {PART_LABEL[openItem.part]}
                    {openItem.month ? ` · ${monthLabel(openItem.month)}` : ""}
                  </span>
                  {openItem.memo ? <p className={styles.modalMemo}>{openItem.memo}</p> : null}
                  <div className={styles.modalActions}>
                    <button type="button" onClick={() => copyLink(openItem.id)}>
                      {copied ? "복사됨!" : "링크 복사"}
                    </button>
                    {/* 모달 열릴 때 키보드 초점을 안으로 — 간이 접근성(전체 포커스 트랩은 아님). */}
                    <button type="button" onClick={close} autoFocus>
                      닫기
                    </button>
                  </div>
                </div>
                {modalList.length > 1 ? (
                  <>
                    <button type="button" className={styles.modalPrev} onClick={() => move(-1)} aria-label="이전 컷">
                      ‹
                    </button>
                    <button type="button" className={styles.modalNext} onClick={() => move(1)} aria-label="다음 컷">
                      ›
                    </button>
                  </>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
