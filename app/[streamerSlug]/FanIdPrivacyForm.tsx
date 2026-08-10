"use client";

// 관리자용 "팬 화면 계정ID 숨기기" 토글. 켜면 팬 화면 표(업보·획득 기록·쿠폰)에서
// 계정ID 열이 통째로 사라진다. 관리자 화면과 검색은 원문 그대로.
// 저장 UX 는 FanRevealManager 의 마스터 스위치(체크 즉시 저장, 실패 시 되돌림)를 따른다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./signatureCounts.module.css";

export default function FanIdPrivacyForm({ slug, initial }: { slug: string; initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  async function save(next: boolean) {
    setEnabled(next);
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-id-privacy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setEnabled(!next);
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({
          kind: "ok",
          text: next
            ? "저장됐어요! 팬 화면에서 계정ID 열이 사라집니다."
            : "저장됐어요! 팬 화면에 계정ID가 다시 보입니다.",
        });
        router.refresh();
      }
    } catch {
      setEnabled(!next);
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
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => save(e.target.checked)}
        />
        <b>팬 화면에서 계정ID 숨기기 (on/off)</b>
        <span className={styles.hint} style={{ margin: 0 }}>
          켜면 표에서 계정ID 열이 통째로 사라져요.
        </span>
      </label>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
