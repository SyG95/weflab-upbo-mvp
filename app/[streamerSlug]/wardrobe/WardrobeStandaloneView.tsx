"use client";

// 옷장 독립 화면의 클라이언트 껍데기 — 옷장 전용 검색창 + 팬 옷장 뷰(넓은 판).
// 업보시트 탭의 "내 업보 확인" 검색과 분리된 자체 검색(이름·메모·색상·테마 대상은 동일 규칙).

import { useState } from "react";
import WardrobeFanView from "../WardrobeFanView";
import type { WardrobeItem, WardrobeTheme, WardrobeSettings } from "../../../lib/wardrobeShared";
import styles from "./wardrobePage.module.css";

export default function WardrobeStandaloneView({
  slug,
  themes,
  items,
  initialItemId,
  settings,
}: {
  slug: string;
  themes: WardrobeTheme[];
  items: WardrobeItem[]; // 공개(hidden=false) 컷만 서버에서 걸러 넘어온다
  initialItemId: string | null;
  settings?: WardrobeSettings;
}) {
  const [query, setQuery] = useState("");
  return (
    <>
      <div className={styles.searchRow}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·테마·색상으로 찾기"
          aria-label="옷장 검색"
        />
      </div>
      <WardrobeFanView
        slug={slug}
        themes={themes}
        items={items}
        searchQuery={query}
        initialItemId={initialItemId}
        settings={settings}
        wide
      />
    </>
  );
}
