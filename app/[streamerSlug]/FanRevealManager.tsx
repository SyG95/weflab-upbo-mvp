"use client";

// 관리자 "룰렛 관리 > 확률 공개" 하위탭. 기록 on/off처럼 단순한 토글 목록.
// 마스터 스위치(전체 on/off) + 룰렛별 "팬 공개" 토글. 공개한 룰렛의 확률표가 팬 화면 오른쪽에 뜬다.
// 저장은 roulette_config 의 revealed 플래그로(마스터는 fan_reveal 오버레이). 기록 on/off 와 독립.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RouletteConfigEntry } from "../../lib/api";
import { FAN_REVEAL_SCOPE_LABEL, type FanRevealScope } from "../../lib/fanRevealScope";
import styles from "./rouletteConfig.module.css";

export type RevealRoulette = {
  rid: string;
  label: string;
  itemCount: number;
  groupsItemSets: string[][];
  configIndex: number | null;
  revealed: boolean;
};

export default function FanRevealManager({
  slug,
  roulettes,
  master,
  scope: initialScope,
  existingConfig,
}: {
  slug: string;
  roulettes: RevealRoulette[];
  master: boolean;
  // 공개 범위(2026-09-29): target=업보 대상 품목만(기본) / all=전체 확률표.
  scope: FanRevealScope;
  existingConfig: RouletteConfigEntry[];
}) {
  const [enabled, setEnabled] = useState(master);
  const [masterSaving, setMasterSaving] = useState(false);
  const [scope, setScope] = useState<FanRevealScope>(initialScope);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeMsg, setScopeMsg] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(
    () => new Set(roulettes.filter((r) => r.revealed).map((r) => r.rid)),
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  function toggle(rid: string) {
    setRevealed((prev) => {
      const n = new Set(prev);
      if (n.has(rid)) n.delete(rid);
      else n.add(rid);
      return n;
    });
  }

  async function saveMaster(next: boolean) {
    setEnabled(next);
    setMasterSaving(true);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setEnabled(!next);
      else router.refresh();
    } catch {
      setEnabled(!next);
    } finally {
      setMasterSaving(false);
    }
  }

  // 공개 범위 저장 — 마스터 스위치와 같은 오버레이(fan_reveal_updated)에 scope 만 바꿔 쓴다.
  async function saveScope(next: FanRevealScope) {
    const prev = scope;
    setScope(next);
    setScopeSaving(true);
    setScopeMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setScope(prev);
        setScopeMsg(data?.error || "공개 범위를 저장하지 못했어요 — 다시 시도해 주세요.");
      } else {
        setScopeMsg(`공개 범위: ${FAN_REVEAL_SCOPE_LABEL[next]} — 팬 화면 확률표에 바로 반영됩니다.`);
        router.refresh();
      }
    } catch {
      setScope(prev);
      setScopeMsg("네트워크 오류로 공개 범위를 저장하지 못했어요.");
    } finally {
      setScopeSaving(false);
    }
  }

  async function save() {
    // 기존 config 의 revealed 만 갱신(이름·묶기·보관은 그대로), 새로 공개한 auto 룰렛은 엔트리 추가.
    const built: RouletteConfigEntry[] = existingConfig.map((e, i) => ({
      ...e,
      revealed: revealed.has(`named:${i}`),
    }));
    for (const r of roulettes) {
      if (r.configIndex === null && revealed.has(r.rid) && r.groupsItemSets.length > 0) {
        built.push({ groups: r.groupsItemSets, revealed: true });
      }
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/roulette-config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: built }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 팬 화면 확률표에 반영됩니다." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.sub}>
        팬 화면에 룰렛 <b>확률표</b>를 공개해요. 아래에서 공개할 룰렛만 켜면 됩니다. (기록 on/off와 무관)
      </p>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          margin: "12px 0",
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
          disabled={masterSaving}
          onChange={(e) => saveMaster(e.target.checked)}
        />
        <b>팬 화면에 확률표 공개 (on/off)</b>
        <span className={styles.hint} style={{ margin: 0 }}>
          꺼두면 아래에서 켜둔 룰렛이 있어도 팬 화면엔 안 떠요.
        </span>
      </label>

      <fieldset
        style={{
          margin: "0 0 12px",
          padding: "10px 12px",
          border: "1px solid var(--paper-line)",
          borderRadius: 10,
          background: "var(--surface)",
          opacity: enabled ? 1 : 0.55,
        }}
      >
        <legend style={{ fontWeight: 800, fontSize: 13, padding: "0 4px" }}>공개 범위</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
          {(["target", "all"] as FanRevealScope[]).map((value) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="radio"
                name={`fan-reveal-scope-${slug}`}
                value={value}
                checked={scope === value}
                disabled={scopeSaving}
                onChange={() => saveScope(value)}
              />
              <b>{FAN_REVEAL_SCOPE_LABEL[value]}</b>
              <span className={styles.hint} style={{ margin: 0 }}>
                {value === "target" ? "(기본) 업보로 기록되는 상품만 보여요" : "룰렛표 전체를 보여주고, 업보 대상 행만 진하게 표시해요"}
              </span>
            </label>
          ))}
        </div>
        {scopeMsg ? (
          <p className={styles.hint} style={{ margin: "8px 0 0" }}>
            {scopeMsg}
          </p>
        ) : null}
      </fieldset>

      {roulettes.length === 0 ? (
        <p className={styles.hint}>공개할 룰렛이 아직 없어요. 룰렛표가 들어오면 여기 떠요.</p>
      ) : (
        <div className={styles.list}>
          {roulettes.map((r) => (
            <label
              key={r.rid}
              className={styles.card}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                opacity: enabled ? 1 : 0.55,
              }}
            >
              <input type="checkbox" checked={revealed.has(r.rid)} onChange={() => toggle(r.rid)} />
              <span style={{ fontWeight: 800 }}>{r.label}</span>
              <span className={styles.hint} style={{ margin: 0 }}>
                {r.itemCount}종
              </span>
            </label>
          ))}
        </div>
      )}

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "공개 설정 저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
