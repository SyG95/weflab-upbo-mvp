"use client";

// 한 줄 배치(1499px 이하)에서 양옆 칸의 공지를 시트 위로 올려 보여주는 카드.
// 한 줄 배치는 위 칸 → 시트 → 왼쪽 → 오른쪽 순서라, 양옆 칸 공지는 시트 끝까지 내려야 보였다(11/2 실측 29명).
// 긴 공지가 검색창을 밀지 않게 6줄까지만 보이고, 넘치면 "공지 펼치기". 1500px 이상에선 CSS 로 숨긴다(원래 자리 그대로).

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import styles from "./page.module.css";

export default function NoticeLead({ text, fontStyle }: { text: string; fontStyle?: CSSProperties }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const bodyId = useId();
  const [overflowing, setOverflowing] = useState(false);
  const [open, setOpen] = useState(false);

  // 접힌 상태에서만 넘침을 잰다(펼치면 높이가 같아져 버튼이 사라지면 안 된다).
  // 잘리지 않는 글(p) 높이를 지켜봐야 폭 변화·글꼴 로드로 줄 수가 바뀔 때도 다시 잰다(접힌 상자 높이는 고정이라).
  useEffect(() => {
    const body = bodyRef.current;
    const textEl = textRef.current;
    if (!body || !textEl || open) return;
    const check = () => setOverflowing(textEl.offsetHeight > body.clientHeight + 4);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(textEl);
    ro.observe(body);
    return () => ro.disconnect();
  }, [open]);

  return (
    <section className={`${styles.showcaseNotice} ${styles.noticeLead}`} aria-label="공지사항">
      <h3>공지사항</h3>
      <div
        ref={bodyRef}
        id={bodyId}
        className={styles.noticeLeadBody}
        data-open={open ? "1" : undefined}
        data-clamped={!open && overflowing ? "1" : undefined}
      >
        <p ref={textRef} style={fontStyle}>{text}</p>
      </div>
      {overflowing || open ? (
        <button
          type="button"
          className={styles.noticeLeadToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "공지 접기" : "공지 펼치기"} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      ) : null}
    </section>
  );
}
