"use client";

// 관리자용 "팬 화면 구분 축" 설정(2026-09-21). 팬 화면의 두 축 — "언제"(월별 보기 레일)와
// "어느 룰렛"(룰렛 탭) — 을 스트리머별로 켜고 끈다. 기본 둘 다 켬이라 바꾸지 않으면 종전 화면 그대로.
// fetch/저장/새로고침 패턴은 FanDeliveryModeForm 을 따른다(POST → 메시지 → router.refresh()).

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FanAxisPrefs } from "../../lib/api";
import styles from "./signatureCounts.module.css";

const ROWS: { key: keyof FanAxisPrefs; label: string; desc: string }[] = [
  {
    key: "monthRail",
    label: "월별 보기(언제) 보이기",
    desc: "끄면 팬 화면이 항상 전체 기간을 보여주고, 월별 잔여 수치도 같이 사라져요.",
  },
  {
    key: "rouletteTabs",
    label: "룰렛 탭(어느 룰렛) 보이기",
    desc: "끄면 룰렛 구분 없이 한 목록으로 보여요. 정가 기록만 따로 탭이 남아요.",
  },
];

export default function FanAxisForm({ slug, initial }: { slug: string; initial: FanAxisPrefs }) {
  const [prefs, setPrefs] = useState<FanAxisPrefs>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-axis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ axis: prefs }),
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
        {ROWS.map((r) => (
          <label key={r.key} className={styles.row} style={{ alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              name={`fanAxis-${r.key}`}
              checked={prefs[r.key]}
              disabled={saving}
              onChange={(e) => setPrefs((p) => ({ ...p, [r.key]: e.target.checked }))}
              style={{ marginTop: 4 }}
            />
            <span>
              <b>{r.label}</b>
              <span className={styles.hint} style={{ margin: "2px 0 0", display: "block" }}>
                {r.desc}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
