"use client";

// 관리자 "포스터 및 배너" 탭 상단의 팬 화면 배치 편집기.
// 팬 화면 구조를 그대로 축소한 미니어처에서 포스터/확률표/공지 블록을 원하는 자리로 옮긴다.
//  - 블록 클릭(선택) → 자리 클릭(이동), 또는 블록을 자리로 드래그(정해진 슬롯 안으로만).
//  - 같은 자리 안 순서는 ↑↓ 버튼. 업보시트는 중앙 고정, 배너는 맨 위 고정(못 옮김).
// 저장 = 스트리머별 오버레이(fan_layout_updated). 기본값 = 기존 배치라 안 만지면 무변화.

import { useState, type CSSProperties, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_FAN_LAYOUT,
  fanLayoutBlocksInSlot,
  type FanLayout,
  type FanLayoutBlock,
  type FanLayoutSlot,
} from "../../lib/api";
import styles from "./signatureCounts.module.css";

const BLOCK_LABEL: Record<FanLayoutBlock, string> = {
  posters: "🖼️ 포스터",
  reveal: "🎰 확률표",
  notice: "📢 공지사항",
};

const SLOT_LABEL: Record<FanLayoutSlot, string> = {
  top: "시트 위 (가로)",
  left: "왼쪽",
  right: "오른쪽",
  bottom: "시트 아래 (가로)",
};

function cloneLayout(l: FanLayout): FanLayout {
  return {
    posters: { ...l.posters },
    reveal: { ...l.reveal },
    notice: { ...l.notice },
    railsAtHead: l.railsAtHead === true,
  };
}

export default function FanLayoutEditor({
  slug,
  initial,
  available,
}: {
  slug: string;
  initial: FanLayout | undefined;
  // 실제 내용이 있는 블록(없으면 "(비어있음)" 힌트만 — 배치는 미리 정해둘 수 있음)
  available: Record<FanLayoutBlock, boolean>;
}) {
  const [layout, setLayout] = useState<FanLayout>(() => cloneLayout(initial ?? DEFAULT_FAN_LAYOUT));
  const [selected, setSelected] = useState<FanLayoutBlock | null>(null);
  const [dragOver, setDragOver] = useState<FanLayoutSlot | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  function moveBlock(block: FanLayoutBlock, slot: FanLayoutSlot) {
    setLayout((prev) => {
      const next = cloneLayout(prev);
      const maxOrder = fanLayoutBlocksInSlot(next, slot)
        .filter((b) => b !== block)
        .reduce((m, b) => Math.max(m, next[b].order), -1);
      next[block] = { slot, order: maxOrder + 1 };
      return next;
    });
    setSelected(null);
    setMsg(null);
  }

  function reorder(block: FanLayoutBlock, dir: -1 | 1) {
    setLayout((prev) => {
      const next = cloneLayout(prev);
      const siblings = fanLayoutBlocksInSlot(next, next[block].slot);
      const idx = siblings.indexOf(block);
      const swapWith = siblings[idx + dir];
      if (!swapWith) return prev;
      const tmp = next[block].order;
      next[block].order = next[swapWith].order;
      next[swapWith].order = tmp;
      return next;
    });
  }

  function onZoneClick(slot: FanLayoutSlot) {
    if (selected) moveBlock(selected, slot);
  }

  function onDrop(e: DragEvent, slot: FanLayoutSlot) {
    e.preventDefault();
    setDragOver(null);
    const block = e.dataTransfer.getData("text/plain") as FanLayoutBlock;
    if (block === "posters" || block === "reveal" || block === "notice") moveBlock(block, slot);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-layout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 팬 화면 배치에 바로 반영됩니다." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const zoneBase: CSSProperties = {
    border: "2px dashed var(--paper-line)",
    borderRadius: 10,
    padding: 8,
    minHeight: 52,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    background: "var(--surface)",
    cursor: selected ? "copy" : "default",
    transition: "border-color 0.1s",
  };

  const renderChip = (block: FanLayoutBlock) => {
    const sel = selected === block;
    const siblings = fanLayoutBlocksInSlot(layout, layout[block].slot);
    const idx = siblings.indexOf(block);
    return (
      <div
        key={block}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", block);
          setSelected(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelected(sel ? null : block);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 9px",
          borderRadius: 8,
          fontSize: 12.5,
          fontWeight: 800,
          background: sel ? "var(--stamp)" : "var(--stamp-soft)",
          color: sel ? "var(--on-accent)" : "var(--stamp)",
          border: `1px solid ${sel ? "var(--stamp)" : "var(--paper-line)"}`,
          cursor: "grab",
          userSelect: "none",
        }}
        title="클릭해서 선택한 뒤 원하는 자리를 클릭하거나, 그대로 끌어다 놓으세요"
      >
        <span style={{ flex: 1 }}>
          {BLOCK_LABEL[block]}
          {!available[block] ? (
            <span style={{ fontWeight: 700, opacity: 0.7 }}> (비어있음)</span>
          ) : null}
        </span>
        {siblings.length > 1 ? (
          <span style={{ display: "inline-flex", gap: 2 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reorder(block, -1);
              }}
              disabled={idx === 0}
              aria-label="위로"
              style={orderBtn}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reorder(block, 1);
              }}
              disabled={idx === siblings.length - 1}
              aria-label="아래로"
              style={orderBtn}
            >
              ↓
            </button>
          </span>
        ) : null}
      </div>
    );
  };

  const renderZone = (slot: FanLayoutSlot, style?: CSSProperties) => {
    const blocks = fanLayoutBlocksInSlot(layout, slot);
    return (
      <div
        onClick={() => onZoneClick(slot)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(slot);
        }}
        onDragLeave={() => setDragOver((cur) => (cur === slot ? null : cur))}
        onDrop={(e) => onDrop(e, slot)}
        style={{
          ...zoneBase,
          ...(dragOver === slot || (selected && blocks.length === 0)
            ? { borderColor: "var(--stamp)" }
            : {}),
          ...style,
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>
          {SLOT_LABEL[slot]}
        </span>
        {blocks.map(renderChip)}
      </div>
    );
  };

  return (
    <div>
      <p className={styles.hint} style={{ margin: "0 0 10px" }}>
        블록을 <b>클릭해 선택한 뒤 자리를 클릭</b>하거나, <b>끌어다 놓아</b> 배치를 바꿔요. 저장해야
        팬 화면에 반영됩니다. (업보시트·배너 위치는 고정)
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 12,
          border: "1px solid var(--paper-line)",
          borderRadius: 14,
          background: "var(--paper)",
        }}
      >
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--paper-line)",
            color: "var(--muted)",
            fontSize: 11.5,
            fontWeight: 800,
            textAlign: "center",
          }}
        >
          배너 (맨 위 고정)
        </div>
        {renderZone("top")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 8 }}>
          {renderZone("left")}
          <div
            style={{
              border: "1px solid var(--paper-line)",
              borderRadius: 10,
              minHeight: 120,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12.5,
              fontWeight: 800,
              color: "var(--muted)",
              background: "var(--surface)",
            }}
          >
            업보시트 (중앙 고정)
          </div>
          {renderZone("right")}
        </div>
        {renderZone("bottom")}
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          margin: "12px 0 0",
          padding: "9px 12px",
          border: "1px solid var(--paper-line)",
          borderRadius: 10,
          background: "var(--surface)",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <input
          type="checkbox"
          checked={layout.railsAtHead === true}
          onChange={(e) =>
            setLayout((prev) => ({ ...cloneLayout(prev), railsAtHead: e.target.checked }))
          }
        />
        <b>양옆 슬롯을 헤드(맨 위)부터 시작</b>
        <span className={styles.hint} style={{ margin: 0 }}>
          &quot;시트 위&quot;에 블록이 있을 때: 끄면 양옆이 업보시트 높이에 맞춰 시작(기본), 켜면 맨 위부터 나란히.
        </span>
      </label>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "배치 저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}

const orderBtn: CSSProperties = {
  width: 20,
  height: 20,
  border: "1px solid var(--paper-line)",
  borderRadius: 5,
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 11,
  lineHeight: 1,
  cursor: "pointer",
};
