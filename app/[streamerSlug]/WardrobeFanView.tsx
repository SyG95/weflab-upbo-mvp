"use client";

// 팬 화면 "옷장" 탭. 스트리머가 등록한 의상·헤어 컷을 격자로 보여준다(읽기 전용).
// 기본 보기=월별(이번 달, 0장이면 최근 항목 있는 달로 폴백), 테마별 보기 전환, 파츠 필터.
// 정렬 규칙(sy 확정): 월별=최신 등록순 고정, 테마별=테마 안 수동 순서(order).
// 크게보기 모달은 ShowcasePosterRail 의 UX(←→/Esc/배경 클릭)를 따르고, 컷별 링크 복사를 더했다.
// 월/테마/파츠 전환은 전부 클라이언트 계산 — 서버 왕복 없음(전체 컷을 한 번에 받는다, 상한 100장).

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// SSR/하이드레이션 판별용 — 서버·하이드레이션 렌더=false, 그 후 클라이언트=true.
// (effect 내 setState 없이 클라이언트 전용 렌더를 여는 React 공식 패턴)
const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
import {
  WARDROBE_PARTS,
  WARDROBE_PART_LABEL as PART_LABEL,
  currentMonthKst,
  type WardrobeItem,
  type WardrobePart,
  type WardrobeTheme,
} from "../../lib/wardrobeShared";
import styles from "./wardrobe.module.css";

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // NEW 배지: 공개 시작 + 2주

type PartFilter = "all" | WardrobePart;
type ViewMode = "main" | "month" | "theme";

// 표시 단위: 색상 세트(공개 멤버 2장 이상)는 카드 1장으로 접히고 칩으로 색을 고른다.
// firstId = 현재 필터·정렬에서 먼저 걸린 컷 — 칩 기본 선택("화이트" 검색 → 화이트가 먼저 보이게).
type Unit = { key: string; members: WardrobeItem[]; firstId: string };

function isNew(item: WardrobeItem, now: number): boolean {
  if (!item.publishedAt) return false;
  const t = Date.parse(item.publishedAt);
  return Number.isFinite(t) && now - t < NEW_WINDOW_MS;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return y && m ? `${y}. ${m}` : month;
}

// 월별 보기 정렬 = 등록순(먼저 올린 컷이 앞). 옛 규칙은 최신순이었으나 "헤어A 먼저 올리면
// A가 뒤로 밀린다"는 실측 불편으로 sy 가 번복 확정(8/12). publishedAt 없으면 맨 뒤.
function byUploadOrder(a: WardrobeItem, b: WardrobeItem): number {
  return (
    (a.publishedAt ? Date.parse(a.publishedAt) : Number.POSITIVE_INFINITY) -
    (b.publishedAt ? Date.parse(b.publishedAt) : Number.POSITIVE_INFINITY)
  );
}


export default function WardrobeFanView({
  slug,
  themes,
  items,
  searchQuery,
  initialItemId,
  wide = false,
}: {
  slug: string;
  themes: WardrobeTheme[];
  items: WardrobeItem[]; // 공개(hidden=false) 컷만 서버에서 걸러 넘어온다
  searchQuery: string;
  initialItemId: string | null; // ?w=<id> 딥링크 — 해당 컷의 크게보기를 바로 연다
  wide?: boolean; // 독립 화면(넓은 판): 카드 최소 폭을 키워 컷을 크게 보여준다
}) {
  // 렌더 중 Date.now() 호출은 lint(purity) 위반 — 마운트 시각으로 고정(NEW 2주 판정엔 충분).
  const [now] = useState(() => Date.now());
  const isClient = useIsClient();
  const themeName = useMemo(() => new Map(themes.map((t) => [t.id, t.name])), [themes]);

  // 검색(상단 "내 업보 확인" 검색창 공유) + 파츠 필터.
  const [part, setPart] = useState<PartFilter>("all");
  // 파츠 칩은 실제 등록된 파츠만 노출 — 4종 상시 노출은 안 쓰는 스트리머에게 빈 필터 소음.
  // 1종뿐이면 필터 자체가 무의미하므로 칩 줄을 통째로 숨긴다.
  const presentParts = useMemo(() => {
    const has = new Set(items.map((i) => i.part));
    return WARDROBE_PARTS.filter((p) => has.has(p));
  }, [items]);
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (part !== "all" && item.part !== part) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.memo.toLowerCase().includes(q) ||
        item.variant.toLowerCase().includes(q) ||
        (themeName.get(item.themeId) ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, part, searchQuery, themeName]);

  // ── 색상 세트 접기 ────────────────────────────────────────
  // setId → 공개 멤버 전부(order 순). 칩 목록은 검색·월 필터와 무관하게 세트 전체를 보여준다 —
  // "화이트"로 검색해도 블랙 칩이 반쯤 사라지는 화면을 만들지 않기 위해서다.
  const setMembers = useMemo(() => {
    const map = new Map<string, WardrobeItem[]>();
    for (const item of items) {
      if (!item.setId) continue;
      const list = map.get(item.setId) ?? [];
      list.push(item);
      map.set(item.setId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [items]);

  // 목록(필터·정렬 반영)을 세트 단위로 접는다 — 세트의 카드 위치는 첫 등장 컷의 자리.
  const toUnits = useCallback(
    (list: WardrobeItem[]): Unit[] => {
      const seenSets = new Set<string>();
      const units: Unit[] = [];
      for (const item of list) {
        const set = item.setId ? setMembers.get(item.setId) : undefined;
        if (set && set.length > 1) {
          if (seenSets.has(item.setId)) continue;
          seenSets.add(item.setId);
          units.push({ key: `set-${item.setId}`, members: set, firstId: item.id });
        } else {
          units.push({ key: item.id, members: [item], firstId: item.id });
        }
      }
      return units;
    },
    [setMembers],
  );

  // 카드별로 고른 색(칩 선택). 딥링크가 세트의 특정 색을 가리키면 그 색으로 시작한다.
  const [variantSel, setVariantSel] = useState<Record<string, string>>(() => {
    if (!initialItemId) return {};
    const target = items.find((i) => i.id === initialItemId);
    return target?.setId ? { [`set-${target.setId}`]: target.id } : {};
  });
  const chosenOf = useCallback(
    (unit: Unit) =>
      unit.members.find((m) => m.id === variantSel[unit.key]) ??
      unit.members.find((m) => m.id === unit.firstId) ??
      unit.members[0],
    [variantSel],
  );
  const pickVariant = (unit: Unit, id: string) =>
    setVariantSel((prev) => ({ ...prev, [unit.key]: id }));

  // 월 목록(항목 있는 달만, 최신 달부터). 기본 선택=이번 달, 없으면 가장 최근 달.
  const months = useMemo(() => {
    const set = new Set(filtered.map((i) => i.month).filter(Boolean));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [filtered]);
  const [currentMonth] = useState(() => currentMonthKst());
  // 메인 고정 컷이 있으면 첫 진입 = 메인 탭(sy 확정 8/12). 0장이면 탭 자체가 없고 월별이 기본.
  const hasFeatured = useMemo(() => items.some((i) => i.featured), [items]);
  const [view, setView] = useState<ViewMode>(() => (items.some((i) => i.featured) ? "main" : "month"));
  const [month, setMonth] = useState<string | null>(null);
  const selectedMonth = month && months.includes(month) ? month : months.includes(currentMonth) ? currentMonth : months[0] ?? null;
  const monthIdx = selectedMonth ? months.indexOf(selectedMonth) : -1;

  const monthItems = useMemo(
    () =>
      selectedMonth
        ? filtered.filter((i) => i.month === selectedMonth).sort(byUploadOrder)
        : // month 값이 빈(손상) 항목만 있는 경우 — 말없이 빈 격자를 보여주지 않고 전체를 등록순으로.
          [...filtered].sort(byUploadOrder),
    [filtered, selectedMonth],
  );
  const monthUnits = useMemo(() => toUnits(monthItems), [monthItems, toUnits]);
  // 메인 탭 = 스트리머가 고정한 컷(등록순). 세트는 멤버 중 하나라도 고정이면 세트째 오른다.
  const mainUnits = useMemo(
    () => toUnits([...filtered].filter((i) => i.featured).sort(byUploadOrder)),
    [filtered, toUnits],
  );
  // 테마별 보기: 스트리머가 정한 테마 순서, 테마 안은 수동 순서(order).
  // 세트는 같은 테마 안에서만 성립(서버 검증)하므로 섹션마다 온전한 세트로 접힌다.
  const themeSections = useMemo(
    () =>
      themes
        .map((t) => ({
          theme: t,
          units: toUnits(filtered.filter((i) => i.themeId === t.id).sort((a, b) => a.order - b.order)),
        }))
        .filter((s) => s.units.length > 0),
    [themes, filtered, toUnits],
  );

  // 테마별 보기 = 노트 색인(책갈피) 방식 — 3방식 실험 중 sy 확정(8/12): 색인 채택, 서랍·선택기 폐기.
  // 테마가 1개뿐이면 색인 줄을 숨기고 격자만(11명 중 대부분이 단일 테마 — 군더더기 금지).
  const [themeSel, setThemeSel] = useState<string>(""); // 현재 색인(빈 값=첫 테마)
  const activeThemeSection =
    themeSections.find((s) => s.theme.id === themeSel) ?? themeSections[0] ?? null;

  // 크게보기 모달. ←→ 넘김 = 카드(세트) 단위, 세트 안 색 전환은 칩으로.
  // 테마별 보기는 지금 열린 색인(테마) 안에서만 넘긴다.
  // 딥링크 컷이 현재 필터에 없으면 그 컷(세트면 세트 통째)만 단독으로 연다.
  const displayUnits = useMemo(() => {
    if (view === "main") return mainUnits;
    if (view === "month") return monthUnits;
    return activeThemeSection?.units ?? [];
  }, [view, mainUnits, monthUnits, activeThemeSection]);
  // 딥링크(?w=)는 초기 상태로 바로 연다(effect 내 setState 는 lint 위반 + 불필요한 재렌더).
  const [openId, setOpenId] = useState<string | null>(() =>
    initialItemId && items.some((i) => i.id === initialItemId) ? initialItemId : null,
  );
  const modalUnits = useMemo(() => {
    if (openId && !displayUnits.some((u) => u.members.some((m) => m.id === openId))) {
      const item = items.find((i) => i.id === openId);
      if (!item) return displayUnits;
      const set = item.setId ? setMembers.get(item.setId) : undefined;
      return set && set.length > 1
        ? [{ key: `set-${item.setId}`, members: set, firstId: item.id }]
        : [{ key: item.id, members: [item], firstId: item.id }];
    }
    return displayUnits;
  }, [openId, displayUnits, items, setMembers]);
  const openUnitIdx = openId ? modalUnits.findIndex((u) => u.members.some((m) => m.id === openId)) : -1;
  const openUnit = openUnitIdx >= 0 ? modalUnits[openUnitIdx] : null;
  const openItem = openUnit?.members.find((m) => m.id === openId) ?? null;

  const close = useCallback(() => setOpenId(null), []);
  const move = useCallback(
    (dir: -1 | 1) => {
      if (openUnitIdx < 0 || modalUnits.length === 0) return;
      const nextUnit = modalUnits[(openUnitIdx + dir + modalUnits.length) % modalUnits.length];
      setOpenId(chosenOf(nextUnit).id);
    },
    [openUnitIdx, modalUnits, chosenOf],
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

  // 카드 = 표시 단위(세트면 1장으로 접힘). 본체 버튼 + 색상 칩 줄이 형제 —
  // 칩도 버튼이라 카드 전체를 button 으로 두면 중첩 버튼(HTML 위반)이 된다.
  const card = (unit: Unit) => {
    const chosen = chosenOf(unit);
    return (
      <div key={unit.key} className={styles.card}>
        <button type="button" className={styles.cardMain} onClick={() => setOpenId(chosen.id)}>
          <span className={styles.thumb}>
            {/* 세트는 어느 색이든 새 컷이 있으면 NEW — 기본 선택이 옛 색이어도 신호가 죽지 않게 */}
            {unit.members.some((m) => isNew(m, now)) ? <span className={styles.newBadge}>NEW</span> : null}
            {/* 목록은 썸네일(~320px) + lazy — 원본은 피팅룸에서만(전송량 ~1/10).
                구버전 컷(썸네일 없음)은 원본 폴백. next/image 대신 img(쇼케이스와 동일 관례). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chosen.thumbUrl || chosen.url} alt={chosen.name} loading="lazy" />
          </span>
          <span className={styles.cardName}>{chosen.name}</span>
          <span className={styles.cardMeta}>
            {themeName.get(chosen.themeId) ?? "테마 없음"} · {PART_LABEL[chosen.part]}
          </span>
        </button>
        {unit.members.length > 1 ? (
          <div className={styles.variantChips} role="group" aria-label={`${chosen.name} 색상 선택`}>
            {unit.members.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className={m.id === chosen.id ? styles.variantChipOn : styles.variantChip}
                onClick={() => pickVariant(unit, m.id)}
              >
                {m.variant || i + 1}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={wide ? `${styles.fanWrap} ${styles.fanWrapWide}` : styles.fanWrap}>
      <div className={styles.controls}>
        {view === "main" ? (
          <span className={styles.themeViewLabel}>메인 고정 컷</span>
        ) : view === "month" ? (
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
          <span className={styles.themeViewLabel}>테마별 보기</span>
        )}
        <div className={styles.chipRow}>
          {hasFeatured ? (
            <button type="button" className={view === "main" ? styles.chipOn : styles.chip} onClick={() => setView("main")}>
              메인
            </button>
          ) : null}
          <button type="button" className={view === "month" ? styles.chipOn : styles.chip} onClick={() => setView("month")}>
            월별
          </button>
          <button type="button" className={view === "theme" ? styles.chipOn : styles.chip} onClick={() => setView("theme")}>
            테마별
          </button>
          {presentParts.length > 1 ? (
            <>
              <span className={styles.chipDivider} aria-hidden="true" />
              {(["all", ...presentParts] as PartFilter[]).map((p) => (
                <button key={p} type="button" className={part === p ? styles.chipOn : styles.chip} onClick={() => setPart(p)}>
                  {p === "all" ? "전체" : PART_LABEL[p]}
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {searchQuery ? `'${searchQuery}'에 해당하는 컷이 없어요.` : "조건에 맞는 컷이 없어요."}
        </p>
      ) : view === "main" ? (
        <div className={styles.grid}>{mainUnits.map(card)}</div>
      ) : view === "month" ? (
        <div className={styles.grid}>{monthUnits.map(card)}</div>
      ) : themeSections.length <= 1 ? (
        // 테마가 1개(또는 0개)면 색인 줄 없이 격자만 — 단일 테마 스트리머에게 군더더기 금지.
        <div className={styles.grid}>{activeThemeSection?.units.map(card)}</div>
      ) : (
        <>
          {/* 노트 색인(책갈피) — 선택된 색인이 아래 종이(패널)와 한 몸으로 붙는다 */}
          <div className={styles.themeIndexRow} role="tablist" aria-label="테마 색인">
            {themeSections.map((s) => {
              const on = s.theme.id === activeThemeSection?.theme.id;
              return (
                <button
                  key={s.theme.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  className={on ? styles.themeIndexTabOn : styles.themeIndexTab}
                  onClick={() => setThemeSel(s.theme.id)}
                >
                  {s.theme.name}
                  <span className={styles.themeIndexCount}>{s.units.length}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.themePanel}>
            <div className={styles.grid}>{activeThemeSection?.units.map(card)}</div>
          </div>
        </>
      )}

      {/* 크게보기 = 피팅룸(무대+패널) — 이미지 뷰어에서 상세 무대로 승격(sy 지시 8/12).
          왼쪽(모바일=위) 무대에 이미지 고정, 오른쪽(모바일=아래) 패널에 이름·메타·색상·메모·
          액션이 줄 단위로 쌓인다 — 파츠 토글·주문 문구 같은 미래 컨트롤도 "패널 한 줄 추가"로
          끝나고 무대는 안 줄어든다. Esc/배경 클릭/←→ 키보드/딥링크/색 기억은 기존 그대로.
          딥링크(?w=)로 첫 렌더부터 열리면 SSR 에 document 가 없어 500(8/11 실측) —
          typeof document 분기는 하이드레이션 불일치라 isClient 로 하이드레이션 후에만 포털. */}
      {openItem && isClient
        ? createPortal(
            <div className={styles.modalBackdrop} onClick={close} role="dialog" aria-modal="true" aria-label={openItem.name}>
              <div className={styles.fitRoom} onClick={(e) => e.stopPropagation()}>
                <div className={styles.fitStage}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.fitImage} src={openItem.url} alt={openItem.name} />
                  {modalUnits.length > 1 ? (
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
                <aside className={styles.fitPanel}>
                  <div className={styles.fitPanelHead}>
                    <strong className={styles.fitName}>{openItem.name}</strong>
                    <span className={styles.fitMeta}>
                      {themeName.get(openItem.themeId) ?? "테마 없음"} · {PART_LABEL[openItem.part]}
                      {openItem.month ? ` · ${monthLabel(openItem.month)}` : ""}
                    </span>
                  </div>
                  {openUnit && openUnit.members.length > 1 ? (
                    <div className={styles.fitRow}>
                      <span className={styles.fitRowLabel}>색상</span>
                      <div className={styles.modalChips} role="group" aria-label="색상 선택">
                        {openUnit.members.map((m, i) => (
                          <button
                            key={m.id}
                            type="button"
                            className={m.id === openItem.id ? styles.modalChipOn : styles.modalChip}
                            onClick={() => {
                              // 모달에서 고른 색은 카드에도 남긴다 — 닫았을 때 그 색이 보이게.
                              pickVariant(openUnit, m.id);
                              setOpenId(m.id);
                            }}
                          >
                            {m.variant || i + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {openItem.memo ? (
                    <div className={styles.fitRow}>
                      <span className={styles.fitRowLabel}>메모</span>
                      <p className={styles.fitMemo}>{openItem.memo}</p>
                    </div>
                  ) : null}
                  <div className={styles.fitActions}>
                    {/* 링크 복사는 제거(sy 확정 8/12) — 딥링크(?w=)로 들어오는 길은 그대로 산다.
                        모달 열릴 때 키보드 초점을 안으로 — 간이 접근성(전체 포커스 트랩은 아님). */}
                    <button type="button" onClick={close} autoFocus>
                      닫기
                    </button>
                  </div>
                </aside>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
