"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type Props = {
  slug: string;
  current: number;
};

export default function ThresholdForm({ slug, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0) {
      setMsg({ type: "err", text: "0 이상의 숫자를 입력해 주세요." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thresholdPercent: pct }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg({ type: "ok", text: "저장됐어요. 다음 결과 반영부터 적용됩니다." });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "저장 실패. 수집 API 연결을 확인해 주세요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.thresholdForm} onSubmit={onSubmit}>
      <label className={styles.fieldLabel} htmlFor="threshold-input">
        기준 확률(%)
      </label>
      <div className={styles.thresholdRow}>
        <input
          id="threshold-input"
          type="number"
          min={0}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
        />
        <button type="submit" disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      <p className={styles.fieldHint}>
        기준 확률 변경은 다음 결과 반영부터 적용됩니다. 기존 기록은 자동 재계산되지 않습니다.
      </p>
      {msg ? (
        <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p>
      ) : null}
    </form>
  );
}
