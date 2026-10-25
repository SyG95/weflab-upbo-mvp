"use client";

// 기준 확률 설정 — 전역 기본값 + 룰렛표(금액대)별 예외.
// 예외는 판정 전용(threshold-overrides API)이며 룰렛 묶기·팬 표시와 완전히 별개다.
// 입력을 비우면 그 룰렛표는 기본값을 따른다(예외 삭제). 저장은 전체 교체 방식.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

export type ThresholdGroupRow = {
  label: string; // 금액대 라벨(예: "33", "330")
  itemCount: number;
  sampleItems: string[];
};

type Props = {
  slug: string;
  current: number;
  groups: ThresholdGroupRow[];
  overrides: Record<string, number>;
};

export default function ThresholdForm({ slug, current, groups, overrides }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(String(current));
  const [ov, setOv] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [label, pct] of Object.entries(overrides)) initial[label] = String(pct);
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 예외가 저장돼 있는데 최신 확률표에 없는 금액대 — 지우기 전까지 경고와 함께 보여준다.
  const knownLabels = new Set(groups.map((g) => g.label));
  const orphanLabels = Object.keys(overrides).filter((label) => !knownLabels.has(label));

  function setOverride(label: string, next: string) {
    setOv((prev) => ({ ...prev, [label]: next }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0) {
      setMsg({ type: "err", text: "기본 기준은 0 이상의 숫자를 입력해 주세요." });
      return;
    }
    const cleanedOverrides: Record<string, number> = {};
    for (const [label, raw] of Object.entries(ov)) {
      if (raw.trim() === "") continue; // 비움 = 예외 해제(기본값 사용)
      const opct = Number(raw);
      if (!Number.isFinite(opct) || opct < 0 || opct > 100) {
        setMsg({ type: "err", text: `${label} 룰렛표의 예외는 0~100 사이 숫자여야 해요.` });
        return;
      }
      cleanedOverrides[label] = opct;
    }
    setSaving(true);
    setMsg(null);
    try {
      const settingsRes = await fetch(`/api/s/${encodeURIComponent(slug)}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thresholdPercent: pct }),
      });
      // 기준 값은 저장됐는데 변경 기록만 실패(HISTORY_WRITE_FAILED) — 예외 저장은 이어서 하고, 다시 저장을 안내한다.
      let historyFailed = false;
      if (!settingsRes.ok) {
        const body = (await settingsRes.json().catch(() => null)) as { code?: string } | null;
        if (body?.code !== "HISTORY_WRITE_FAILED") throw new Error(String(settingsRes.status));
        historyFailed = true;
      }
      const overridesRes = await fetch(`/api/s/${encodeURIComponent(slug)}/threshold-overrides`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides: cleanedOverrides }),
      });
      if (!overridesRes.ok) throw new Error(String(overridesRes.status));
      setMsg(
        historyFailed
          ? { type: "err", text: "기준은 저장됐지만 변경 기록을 못 남겼어요. 한 번 더 저장해 주세요." }
          : { type: "ok", text: "저장됐어요. 다음 결과 반영부터 적용됩니다." },
      );
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
        기본 기준 확률(%)
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
        이 확률 이하로 뜬 상품만 업보로 기록돼요. 특정 룰렛표만 다른 기준을 쓰려면 아래에 예외를
        적어 주세요.
      </p>

      {groups.length > 0 || orphanLabels.length > 0 ? (
        <div className={styles.thresholdGroupList}>
          <p className={styles.fieldLabel} style={{ marginBottom: 4 }}>
            룰렛표별 예외(선택)
          </p>
          {groups.map((g) => (
            <div key={g.label} className={styles.thresholdGroupRow}>
              <div className={styles.thresholdGroupInfo}>
                <span className={styles.thresholdGroupLabel}>{g.label}</span>
                <span className={styles.thresholdGroupMeta}>
                  상품 {g.itemCount}개
                  {g.sampleItems.length > 0 ? ` · ${g.sampleItems.slice(0, 2).join(", ")}…` : ""}
                </span>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                placeholder="기본"
                value={ov[g.label] ?? ""}
                onChange={(e) => setOverride(g.label, e.target.value)}
                disabled={saving}
                aria-label={`${g.label} 룰렛표 기준 확률`}
              />
            </div>
          ))}
          {orphanLabels.map((label) => (
            <div key={label} className={styles.thresholdGroupRow}>
              <div className={styles.thresholdGroupInfo}>
                <span className={styles.thresholdGroupLabel}>{label}</span>
                <span className={styles.thresholdGroupWarn}>
                  최신 확률표에 없는 금액대예요. 비우고 저장하면 예외가 삭제돼요.
                </span>
              </div>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                placeholder="기본"
                value={ov[label] ?? ""}
                onChange={(e) => setOverride(label, e.target.value)}
                disabled={saving}
                aria-label={`${label} 룰렛표 기준 확률(최신 확률표에 없음)`}
              />
            </div>
          ))}
          <p className={styles.fieldHint}>
            예외를 적은 룰렛표는 그 기준으로 판정돼요. 비워두면 기본 기준을 따라요. 변경은 다음
            결과 반영부터 적용되고, 지난 기록은 &ldquo;빠진 기록 다시 판정하기&rdquo;로 살릴 수
            있어요.
          </p>
        </div>
      ) : null}
      {msg ? (
        <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p>
      ) : null}
    </form>
  );
}
