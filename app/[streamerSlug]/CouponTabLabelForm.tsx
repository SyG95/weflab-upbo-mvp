"use client";

// 관리자용 "쿠폰 탭 이름" 입력 — 팬 화면의 쿠폰 탭·표 머리글·안내문에 보일 이름을 정한다.
// 기본 "쿠폰", 비우고 저장하면 기본으로 되돌아간다. 표시 전용(데이터·관리자 화면은 그대로 쿠폰).
// 저장 UX 는 FanIdPrivacyForm(설정 탭 이웃)의 fetch 패턴을 따른다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./signatureCounts.module.css";

const MAX = 10; // 서버 COUPON_TAB_LABEL_MAX 와 같은 값(탭 알약이 넘치지 않는 길이)

export default function CouponTabLabelForm({ slug, initial }: { slug: string; initial: string }) {
  const [label, setLabel] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/coupon-tab-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        const saved = typeof data.couponTabLabel === "string" ? data.couponTabLabel : "";
        setLabel(saved);
        setMsg({
          kind: "ok",
          text: saved ? `저장됐어요! 팬 화면에 "${saved}"으로 보입니다.` : "저장됐어요! 기본 이름(쿠폰)으로 보입니다.",
        });
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
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          margin: "4px 0",
          padding: "10px 12px",
          border: "1px solid var(--paper-line)",
          borderRadius: 10,
          background: "var(--surface)",
        }}
      >
        <b>쿠폰 탭 이름</b>
        <input
          value={label}
          maxLength={MAX}
          placeholder="쿠폰"
          disabled={saving}
          onChange={(e) => setLabel(e.target.value)}
          style={{
            width: 120,
            padding: "6px 10px",
            border: "1px solid var(--paper-line)",
            borderRadius: 8,
            background: "var(--paper)",
            color: "var(--ink)",
            fontSize: 13,
          }}
          aria-label="쿠폰 탭 이름"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || label.trim() === initial.trim()}
          style={{
            padding: "6px 14px",
            border: "1px solid var(--paper-line)",
            borderRadius: 8,
            background: "none",
            color: "var(--ink)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          저장
        </button>
        <span className={styles.hint} style={{ margin: 0 }}>
          팬 화면 쿠폰 탭에 보일 이름이에요 (예: 꾸폰, 마일리지). 비우면 기본 &quot;쿠폰&quot;.
        </span>
      </label>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
