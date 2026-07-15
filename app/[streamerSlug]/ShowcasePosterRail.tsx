"use client";

// 팬 업보시트 왼쪽 포스터 레일 + "크게보기" 모달.
// 아이코 업보시트(aiko-upbo)의 PosterGallery UX를 포로미(weflab) 디자인 토큰으로 옮긴 것:
// 썸네일 아래 "크게보기" 버튼 → 전체화면 모달(이전/다음, Esc·좌우 화살표 키, 배경 클릭 닫기).
// 포스터 이미지는 page.tsx 가 이미 빈 슬롯을 걸러 넘겨준다(원본 슬롯 번호 i 유지).

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Poster = { url: string; i: number; link?: string | null };

function posterLabel(slotIndex: number): string {
  return slotIndex === 0 ? "메인 포스터" : `포스터 ${slotIndex + 1}`;
}

export default function ShowcasePosterRail({
  posters,
  horizontal = false,
}: {
  posters: Poster[];
  // 가로 슬롯(시트 위/아래)에 배치된 경우 — 포스터를 가로로 나란히 배열한다.
  horizontal?: boolean;
}) {
  // 열려있는 포스터의 (필터된 배열 기준) 순번. null 이면 모달 닫힘.
  // 모달은 클릭 이후에만 열리므로(=하이드레이션 후) 별도 mounted 가드 없이 createPortal 안전.
  const [activeOrder, setActiveOrder] = useState<number | null>(null);
  const active = activeOrder === null ? null : posters[activeOrder] ?? null;

  const close = useCallback(() => setActiveOrder(null), []);
  const showPrev = useCallback(() => {
    setActiveOrder((cur) => (cur === null ? cur : (cur - 1 + posters.length) % posters.length));
  }, [posters.length]);
  const showNext = useCallback(() => {
    setActiveOrder((cur) => (cur === null ? cur : (cur + 1) % posters.length));
  }, [posters.length]);

  // 모달이 열려 있는 동안만 키보드 조작 + 배경 스크롤 잠금.
  useEffect(() => {
    if (activeOrder === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") showPrev();
      else if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [activeOrder, close, showPrev, showNext]);

  return (
    <aside
      className={horizontal ? `${styles.showcaseSide} ${styles.showcaseSideH}` : styles.showcaseSide}
      aria-label="포스터"
    >
      {posters.map((p, order) => (
        <figure key={p.i} className={styles.showcasePoster}>
          {p.link ? (
            <a href={p.link} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={posterLabel(p.i)} />
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.url} alt={posterLabel(p.i)} />
          )}
          <button
            type="button"
            className={styles.showcasePosterOpen}
            onClick={() => setActiveOrder(order)}
          >
            {posterLabel(p.i)} 크게보기
          </button>
        </figure>
      ))}

      {active ? (
        // createPortal 로 body 에 붙이면 테마 변수(--modal-bg 등)가 .page 밖으로 빠져
        // 다크 테마에서 흰 팝업이 됐다. 관리자 모달들처럼 .page 트리 안에서 렌더한다
        // (.page/.shell 에 transform·filter 가 없어 position:fixed 는 그대로 화면 기준).
        <div
          className={styles.posterModal}
          role="dialog"
          aria-modal="true"
          aria-label={`${posterLabel(active.i)} 크게보기`}
        >
          <button
            type="button"
            className={styles.posterModalBackdrop}
            aria-label="닫기"
            onClick={close}
          />
          <div className={styles.posterModalCard}>
            <div className={styles.posterModalHeader}>
              <strong>{posterLabel(active.i)}</strong>
              <button type="button" className={styles.posterModalClose} onClick={close}>
                닫기
              </button>
            </div>
            {posters.length > 1 ? (
              <>
                <button
                  type="button"
                  className={`${styles.posterModalArrow} ${styles.posterModalPrev}`}
                  onClick={showPrev}
                  aria-label="이전 포스터"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={`${styles.posterModalArrow} ${styles.posterModalNext}`}
                  onClick={showNext}
                  aria-label="다음 포스터"
                >
                  ›
                </button>
              </>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.posterModalImage}
              src={active.url}
              alt={`${posterLabel(active.i)} 원본 보기`}
            />
          </div>
        </div>
      ) : null}
    </aside>
  );
}
