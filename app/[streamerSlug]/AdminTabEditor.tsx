"use client";

// 관리자 상위탭 순서·이름 편집기(스트리머별). 드래그로 순서 바꾸고, 각 탭에 원하는 이름을 붙인다.
// 저장 = admin_ui_prefs 오버레이(스키마 무변경). 안 만지거나 "기본으로 되돌리기"면 코드 기본값 그대로.
// 안전: 없는 탭 id/과다 값은 서버 normalizeAdminUiPrefs 가 버리므로 사이트에 리스크가 새지 않는다.

import { useState } from "react";
import styles from "./page.module.css";

type TabDef = { id: string; defaultLabel: string };

export default function AdminTabEditor({
  slug,
  tabs,
  initialOrder,
  initialLabels,
}: {
  slug: string;
  tabs: TabDef[];
  initialOrder: string[];
  initialLabels: Record<string, string>;
}) {
  const defaultOrder = tabs.map((t) => t.id);
  const labelOf = (id: string) => tabs.find((t) => t.id === id)?.defaultLabel ?? id;

  const [order, setOrder] = useState<string[]>(() =>
    // 안전: 초기 순서에서 알 수 없는 id 제거 + 빠진 기본 탭 뒤에 append.
    [...new Set(initialOrder.filter((id) => defaultOrder.includes(id)))].concat(
      defaultOrder.filter((id) => !initialOrder.includes(id)),
    ),
  );
  const [labels, setLabels] = useState<Record<string, string>>(initialLabels);
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setOrder((prev) => {
      const next = prev.filter((id) => id !== fromId);
      const idx = next.indexOf(toId);
      next.splice(idx, 0, fromId);
      return next;
    });
  };

  const setName = (id: string, value: string) => {
    setLabels((prev) => {
      const next = { ...prev };
      const trimmed = value.slice(0, 24);
      if (trimmed.trim()) next[id] = trimmed;
      else delete next[id];
      return next;
    });
  };

  const resetDefault = () => {
    setOrder(defaultOrder);
    setLabels({});
    setMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/admin-ui-prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefs: { tabOrder: order, tabLabels: labels } }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "저장됐어요. 새로고침하면 탭이 이 순서·이름으로 보여요." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message || "저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className={styles.fieldHint}>
        탭을 드래그해서 순서를 바꾸고, 원하는 이름을 붙이세요. 안 바꾸면 지금 그대로예요. 저장 후
        새로고침하면 위쪽 탭에 반영됩니다. (후원집계는 별도 페이지지만 순서는 함께 바꿀 수 있어요.)
      </p>
      <ul className={styles.tabEditList}>
        {order.map((id) => (
          <li
            key={id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", id);
              setDragId(id);
            }}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId && dragId !== id) move(dragId, id);
            }}
            className={dragId === id ? `${styles.tabEditRow} ${styles.tabEditRowDrag}` : styles.tabEditRow}
          >
            <span className={styles.tabEditGrip} aria-hidden>
              ⠿
            </span>
            <span className={styles.tabEditDefault}>{labelOf(id)}</span>
            <input
              className={styles.tabEditInput}
              type="text"
              value={labels[id] ?? ""}
              onChange={(e) => setName(id, e.target.value)}
              placeholder={`${labelOf(id)} (기본 이름)`}
              maxLength={24}
              aria-label={`${labelOf(id)} 탭 이름`}
            />
          </li>
        ))}
      </ul>
      <div className={styles.tabEditActions}>
        <button type="button" className={styles.tabEditSave} onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "탭 순서·이름 저장"}
        </button>
        <button type="button" className={styles.tabEditReset} onClick={resetDefault} disabled={saving}>
          기본으로 되돌리기
        </button>
      </div>
      {msg ? <p className={msg.ok ? styles.fieldOk : styles.fieldErr}>{msg.text}</p> : null}
    </div>
  );
}
