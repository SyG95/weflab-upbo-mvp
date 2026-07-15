"use client";

// 관리자용 "팬 화면 배송 반영" 설정. 배송관리에서 처리한 수량(delivery_progress)을 팬 화면에
// 어떻게 보여줄지 스트리머별로 고른다. 기본 off(반영 안 함)라 켜지 않으면 기존 동작 그대로다.
// 선택에 따라 팬 화면이 어떻게 보이는지 아래 미리보기로 바로 확인할 수 있다.
// 인증은 관리자 로그인 세션(쿠키). fetch/UX 패턴은 SignatureCountsManager 를 따른다.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FanDeliveryReflect } from "../../lib/api";
import styles from "./signatureCounts.module.css";

const OPTIONS: { value: FanDeliveryReflect; label: string; desc: string }[] = [
  {
    value: "off",
    label: "반영 안 함 (기본)",
    desc: "당첨 총량을 그대로 보여줘요. 배송해도 팬 화면 개수는 안 바뀝니다.",
  },
  {
    value: "remaining",
    label: "남은 개수 · 다 배송되면 사라짐",
    desc: "당첨 − 배송완료. 배송하면 줄고, 다 배송한 상품은 팬 화면에서 사라져요.",
  },
  {
    value: "remaining_done",
    label: "남은 개수 · 다 배송되면 '배송완료'로 남김 (추천)",
    desc: "남은 개수는 그대로 보여주고, 다 배송한 상품은 사라지지 않고 '배송완료'로 표시돼요.",
  },
  {
    value: "mark",
    label: "총량 유지 · '배송완료 N' 표시",
    desc: "개수는 당첨 그대로 두고 상품 옆에 '배송완료 N' 표시만 붙여요.",
  },
];

// 미리보기용 예시 칩 스타일(팬 화면 upboChip 느낌).
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 9px",
  borderRadius: 9,
  background: "var(--paper)",
  border: "1px solid var(--paper-line)",
  fontSize: 12,
  whiteSpace: "nowrap",
};
const itemStyle: CSSProperties = { fontWeight: 700, color: "var(--ink)" };
const probStyle: CSSProperties = { fontWeight: 800, color: "var(--stamp)" };
const countStyle: CSSProperties = { color: "var(--muted)", fontWeight: 700 };
const doneStyle: CSSProperties = {
  padding: "1px 6px",
  borderRadius: 6,
  background: "var(--paper-line)",
  color: "var(--muted)",
  fontSize: 10,
  fontWeight: 800,
};

// 예시: "움짤프사 1%" 당첨 2개 중 1개 배송완료 상황을 각 모드로 보여준다.
function Preview({ mode }: { mode: FanDeliveryReflect }) {
  const partial = (
    <span style={chipStyle}>
      <span style={itemStyle}>움짤프사</span>
      <span style={probStyle}>1%</span>
      <span style={countStyle}>×1</span>
    </span>
  );
  let chips: ReactNode;
  let note = "";
  if (mode === "off") {
    chips = (
      <span style={chipStyle}>
        <span style={itemStyle}>움짤프사</span>
        <span style={probStyle}>1%</span>
        <span style={countStyle}>×2</span>
      </span>
    );
    note = "당첨 2개 그대로 (1개 배송해도 안 바뀜)";
  } else if (mode === "remaining") {
    chips = partial;
    note = "2개 중 1개 배송 → ×1. 2개 다 배송하면 이 상품·시청자는 사라져요.";
  } else if (mode === "remaining_done") {
    chips = (
      <>
        {partial}
        <span style={chipStyle}>
          <span style={itemStyle}>포토카드</span>
          <span style={probStyle}>1%</span>
          <span style={doneStyle}>배송완료</span>
        </span>
      </>
    );
    note = "남은 건 ×1, 다 배송한 상품은 '배송완료'로 남아요.";
  } else {
    chips = (
      <span style={chipStyle}>
        <span style={itemStyle}>움짤프사</span>
        <span style={probStyle}>1%</span>
        <span style={countStyle}>×2</span>
        <span style={doneStyle}>배송완료 1</span>
      </span>
    );
    note = "개수는 2개 그대로, 옆에 '배송완료 1'만 붙어요.";
  }
  return (
    <div
      style={{
        marginTop: 14,
        padding: "12px 14px",
        border: "1px dashed var(--paper-line)",
        borderRadius: 12,
        background: "var(--surface)",
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>
        팬 화면 미리보기
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>{chips}</div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)" }}>{note}</p>
    </div>
  );
}

export default function FanDeliveryModeForm({
  slug,
  initial,
}: {
  slug: string;
  initial: FanDeliveryReflect;
}) {
  const [mode, setMode] = useState<FanDeliveryReflect>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-display`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveryReflect: mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 팬 화면에 바로 반영됩니다." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className={styles.rows}>
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className={styles.row}
            style={{ alignItems: "flex-start", cursor: "pointer" }}
          >
            <input
              type="radio"
              name="fanDeliveryReflect"
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              style={{ marginTop: 4 }}
            />
            <span>
              <b>{o.label}</b>
              <span className={styles.hint} style={{ margin: "2px 0 0", display: "block" }}>
                {o.desc}
              </span>
            </span>
          </label>
        ))}
      </div>

      <Preview mode={mode} />

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
