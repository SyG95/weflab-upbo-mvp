"use client";

// 팬 화면 오른쪽 레일 "룰렛 확률표" 카드. 공개하기로 한 룰렛마다 탭, 탭 하나 = 그 룰렛 상품+%.
// 공개 범위(2026-09-29): target 이면 업보로 기록되는 상품만 온다(지금까지와 동일). all 이면 룰렛표 전체가 오고
// target=false 인 행(기준 확률 위·기록 off)은 흐리게, 범례 한 줄로 "진한 글씨 = 업보로 기록되는 상품"을 알린다.
// 시트 테마 변수(--paper/--ink/--stamp 등)를 그대로 상속해 시트에 녹아든다(fanReveal.module.css).

import { useState } from "react";
import styles from "./fanReveal.module.css";

export type FanRevealTable = {
  key: string;
  label: string;
  // target: 업보로 기록되는 상품(기준 확률 이하 + 기록 on). 없으면(옛 호출) true 취급.
  items: Array<{ name: string; prob: number; target?: boolean }>;
};

export default function FanRevealCard({ tables }: { tables: FanRevealTable[] }) {
  const [active, setActive] = useState(0);
  // 기본 접힘: 목록이 길어도 공지 등 다른 블록을 밀지 않는다. 누르면 펼침.
  const [open, setOpen] = useState(false);
  if (tables.length === 0) return null;
  const cur = tables[Math.min(active, tables.length - 1)];
  // 전체 범위에서만 비대상 행이 섞여 온다 — 그때만 범례를 그린다.
  const mixed = cur.items.some((it) => it.target === false);
  if (!open) {
    return (
      <section className={styles.card} aria-label="룰렛 확률표">
        <button type="button" className={styles.collapseBtn} onClick={() => setOpen(true)}>
          <span className={styles.title} style={{ margin: 0 }}>
            🎰 룰렛 확률표
          </span>
          <span className={styles.collapseHint}>
            {tables.map((t) => t.label).join(" · ")} ▾ 펼치기
          </span>
        </button>
      </section>
    );
  }
  return (
    <section className={styles.card} aria-label="룰렛 확률표">
      <button type="button" className={styles.collapseBtn} onClick={() => setOpen(false)}>
        <span className={styles.title} style={{ margin: 0 }}>
          🎰 룰렛 확률표
        </span>
        <span className={styles.collapseHint}>▴ 접기</span>
      </button>
      {tables.length > 1 ? (
        <div className={styles.tabs} role="tablist">
          {tables.map((t, i) => (
            <button
              key={t.key}
              type="button"
              className={i === active ? styles.tabOn : styles.tab}
              onClick={() => setActive(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.single}>{cur.label}</p>
      )}
      {mixed ? (
        <p className={styles.legend}>
          <b>진한 글씨</b> = 업보로 기록되는 상품 · 흐린 글씨는 룰렛에 있지만 업보 시트에는 안 올라가요
        </p>
      ) : null}
      <div className={mixed ? `${styles.odds} ${styles.oddsScroll}` : styles.odds}>
        {cur.items.map((it) => (
          <div key={it.name} className={it.target === false ? `${styles.row} ${styles.rowMuted}` : styles.row}>
            <span className={styles.name}>{it.name}</span>
            <span className={styles.prob}>{it.prob}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
