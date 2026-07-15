"use client";

// 팬 화면 오른쪽 레일 "룰렛 확률표" 카드. 공개하기로 한 룰렛마다 탭, 탭 하나 = 그 룰렛 전체 상품+%.
// 시트 테마 변수(--paper/--ink/--stamp 등)를 그대로 상속해 시트에 녹아든다(fanReveal.module.css).

import { useState } from "react";
import styles from "./fanReveal.module.css";

export type FanRevealTable = { key: string; label: string; items: Array<{ name: string; prob: number }> };

export default function FanRevealCard({ tables }: { tables: FanRevealTable[] }) {
  const [active, setActive] = useState(0);
  // 기본 접힘: 목록이 길어도 공지 등 다른 블록을 밀지 않는다. 누르면 펼침.
  const [open, setOpen] = useState(false);
  if (tables.length === 0) return null;
  const cur = tables[Math.min(active, tables.length - 1)];
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
      <div className={styles.odds}>
        {cur.items.map((it) => (
          <div key={it.name} className={styles.row}>
            <span className={styles.name}>{it.name}</span>
            <span className={styles.prob}>{it.prob}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}
