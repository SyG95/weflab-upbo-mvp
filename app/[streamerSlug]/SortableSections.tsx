"use client";

// 탭 안 섹션(카드) 순서 배치 — 스트리머가 한 탭 안에서 카드 순서를 원하는 대로 바꾼다.
// CollapsibleCard 는 손대지 않고 바깥에서 감싸기만 한다(내용/접기 기능 그대로).
// CSS order 로만 재배치하므로 카드 내용은 재렌더되지 않고, 순서는 이 래퍼 안에서만 바뀐다
// (위쪽 상위탭/안내문으로 카드가 튀어나갈 수 없음 = 사이트 리스크 차단).
// 기본 = 편집모드 off + 코드 자연순서. 안 만진 스트리머는 지금과 100% 동일.
// 저장 = admin_ui_prefs 오버레이의 sectionOrder(부분 병합). 접기/탭이름 저장을 덮지 않는다.

import { Children, isValidElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "./page.module.css";

// 저장된 순서에서 실제 존재하는 key만 남기고(중복 제거), 빠진 카드는 자연순서로 뒤에 붙인다.
function sanitizeOrder(saved: string[], natural: string[]): string[] {
  const known = new Set(natural);
  const head = [...new Set(saved.filter((k) => known.has(k)))];
  const tail = natural.filter((k) => !head.includes(k));
  return head.concat(tail);
}

export default function SortableSections({
  tabId,
  slug,
  allSectionOrder,
  children,
}: {
  tabId: string;
  slug: string;
  allSectionOrder: Record<string, string[]>;
  children: ReactNode;
}) {
  // 자식(카드)에서 sectionKey를 뽑아 자연순서를 만든다. sectionKey 없는 자식은 무시(방어).
  const items = Children.toArray(children).filter(isValidElement) as Array<
    React.ReactElement<{ sectionKey?: string }>
  >;
  const natural = items
    .map((c) => c.props.sectionKey)
    .filter((k): k is string => typeof k === "string");
  // natural 배열은 렌더마다 새로 만들어지므로, 내용 기준 비교용 키 문자열을 의존성에 쓴다.
  const naturalKey = natural.join("|");

  const [order, setOrder] = useState<string[]>(() =>
    sanitizeOrder(allSectionOrder[tabId] ?? [], natural),
  );
  const [editing, setEditing] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const dirty = useRef(false);

  const move = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    dirty.current = true;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== fromKey);
      const idx = next.indexOf(toKey);
      next.splice(idx < 0 ? next.length : idx, 0, fromKey);
      return next;
    });
  }, []);

  const resetDefault = useCallback(() => {
    dirty.current = true;
    setOrder(natural);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalKey]);

  // 순서가 바뀌면 600ms 디바운스로 저장. 다른 탭의 순서는 그대로 두고 이 탭 key만 갱신해서 보낸다.
  // 자연순서와 같아지면(=되돌리기) 이 탭 key를 빼서 "커스텀 없음"으로 되돌린다.
  useEffect(() => {
    if (!dirty.current) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const nextMap: Record<string, string[]> = { ...allSectionOrder };
      const isDefault =
        order.length === natural.length && order.every((k, i) => k === natural[i]);
      if (isDefault) delete nextMap[tabId];
      else nextMap[tabId] = order;
      fetch(`/api/s/${encodeURIComponent(slug)}/admin-ui-prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: { sectionOrder: nextMap } }),
        signal: controller.signal,
      }).catch(() => {
        /* 순서 저장 실패는 화면을 막지 않는다(다음 이동에 다시 시도됨) */
      });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, slug, tabId]);

  const orderOf = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };

  return (
    <>
      <div className={styles.sortToolbar}>
        <button
          type="button"
          className={editing ? styles.sortToggleOn : styles.sortToggle}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "순서 편집 완료" : "이 탭 섹션 순서 바꾸기"}
        </button>
        {editing ? (
          <button type="button" className={styles.sortReset} onClick={resetDefault}>
            기본 순서로
          </button>
        ) : null}
        {editing ? (
          <span className={styles.sortHint}>손잡이(⠿)를 끌어 카드 순서를 바꾸세요. 자동 저장돼요.</span>
        ) : null}
      </div>
      <div className={styles.sortWrap}>
        {items.map((child) => {
          const key = child.props.sectionKey ?? "";
          return (
            <div
              key={key}
              className={dragKey === key ? `${styles.sortItem} ${styles.sortItemDrag}` : styles.sortItem}
              style={{ order: orderOf(key) }}
              onDragOver={(e) => {
                if (!editing || !dragKey) return;
                e.preventDefault();
                if (dragKey !== key) move(dragKey, key);
              }}
              onDrop={(e) => {
                if (!editing) return;
                e.preventDefault();
                setDragKey(null);
              }}
            >
              {editing ? (
                <div
                  className={styles.sortHandle}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", key);
                    setDragKey(key);
                  }}
                  onDragEnd={() => setDragKey(null)}
                  aria-label="드래그해서 순서 변경"
                >
                  <span aria-hidden>⠿</span> 드래그해서 순서 변경
                </div>
              ) : null}
              {child}
            </div>
          );
        })}
      </div>
    </>
  );
}
