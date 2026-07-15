"use client";

// 관리자 섹션 접기/펴기 — 스트리머가 마지막으로 접었냐/폈냐를 저장한다.
// Provider가 접힘 상태 전체(collapsed)를 들고, 토글 시 디바운스로 {collapsed}만 저장한다.
// 서버 setAdminUiPrefs가 부분 병합이라 탭 순서/이름은 이 저장에 안 덮인다.
// 기본 = 전부 펼침(collapsed 비어 있음). 안 만진 스트리머는 지금과 100% 동일.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type CollapseCtx = {
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
};

const Ctx = createContext<CollapseCtx | null>(null);

export function AdminCollapseProvider({
  slug,
  initialCollapsed,
  children,
}: {
  slug: string;
  initialCollapsed: Record<string, boolean>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(initialCollapsed);
  // 최초 마운트 값과 달라졌을 때만 저장(초기 렌더에서 저장 안 함).
  const dirty = useRef(false);

  const isCollapsed = useCallback((key: string) => collapsed[key] === true, [collapsed]);
  const toggle = useCallback((key: string) => {
    dirty.current = true;
    setCollapsed((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }, []);

  // 접힘 상태가 바뀌면 600ms 디바운스로 저장(연속 토글 방어). 저장은 collapsed 전체를 보낸다.
  useEffect(() => {
    if (!dirty.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/s/${encodeURIComponent(slug)}/admin-ui-prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: { collapsed } }),
        signal: controller.signal,
      }).catch(() => {
        /* 접힘 저장 실패는 화면을 막지 않는다(다음 토글에 다시 시도됨) */
      });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [collapsed, slug]);

  return <Ctx.Provider value={{ isCollapsed, toggle }}>{children}</Ctx.Provider>;
}

export function CollapsibleCard({
  sectionKey,
  title,
  children,
}: {
  sectionKey: string;
  title: string;
  children: React.ReactNode;
}) {
  const ctx = useContext(Ctx);
  // Provider 밖(안전장치)에서는 항상 펼친 상태로 그대로 렌더 — 접기 기능만 빠지고 내용은 정상.
  const collapsed = ctx ? ctx.isCollapsed(sectionKey) : false;
  return (
    <section className={styles.adminCard}>
      <button
        type="button"
        className={styles.collapseHead}
        onClick={() => ctx?.toggle(sectionKey)}
        aria-expanded={!collapsed}
      >
        <h2>{title}</h2>
        <span className={collapsed ? styles.collapseChevron : `${styles.collapseChevron} ${styles.collapseChevronOpen}`} aria-hidden>
          ▸
        </span>
      </button>
      {collapsed ? null : <div className={styles.collapseBody}>{children}</div>}
    </section>
  );
}
