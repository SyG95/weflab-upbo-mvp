"use client";

// 관리자 "팬 탭 이름" — 팬 화면 룰렛 탭에 보일 이름을 정한다(룰렛 묶기와 완전 분리, sy 확정 2026-07-08).
// 이름은 탭의 상품 지문(멤버 그룹 상품명 집합)에 매달려 저장된다:
//  - 묶기/해제와 무관하게 유지되고, 같은 상품 구성의 탭이 다시 생기면 이름이 되살아난다.
//  - 새 캡처가 와도 상품이 비슷하면(자카드 ≥ 0.5) 이름이 따라온다. 절반 이상 바뀌면 자동 이름 복귀.
// 저장 = audit_logs 오버레이 최신 1건(스키마 무변경). 지금 화면에 없는 탭의 옛 이름은 보존한다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { jaccardStrings, type FanTabLabelEntry } from "../../lib/api";
import styles from "./page.module.css";

export type FanTabForNaming = {
  rid: string;
  currentLabel: string; // 지금 팬 화면에 보이는 라벨(오버레이 > 묶음 이름 > 자동)
  autoLabel: string; // 자동(금액 나열) 라벨
  overlayName?: string; // 이 화면에서 저장한 이름(있으면)
  configName?: string; // 룰렛 묶기에서 저장된 이름(있으면 — 오버레이가 없을 때 대신 표시됨)
  groups: string[][]; // 이 탭의 멤버 그룹 상품 지문
};

export default function FanTabNameManager({
  slug,
  tabs,
  showFixed,
  showOther,
  fixedLabel,
  otherLabel,
  existingEntries,
}: {
  slug: string;
  tabs: FanTabForNaming[];
  showFixed: boolean;
  showOther: boolean;
  fixedLabel: string;
  otherLabel: string;
  existingEntries: FanTabLabelEntry[];
}) {
  const [names, setNames] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const t of tabs) m[t.rid] = t.overlayName ?? "";
    return m;
  });
  const [fixedName, setFixedName] = useState(fixedLabel);
  const [otherName, setOtherName] = useState(otherLabel);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const setName = (rid: string, value: string) =>
    setNames((prev) => ({ ...prev, [rid]: value.slice(0, 30) }));

  const resetAll = () => {
    setNames(Object.fromEntries(tabs.map((t) => [t.rid, ""])));
    setFixedName("");
    setOtherName("");
    setMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // 현재 탭들에 입력된 이름 → 그 탭의 상품 지문과 함께 저장.
      const entries: FanTabLabelEntry[] = tabs
        .map((t) => ({ name: (names[t.rid] ?? "").trim(), groups: t.groups }))
        .filter((e) => e.name.length > 0);
      // 지금 화면에 없는 탭(옛 룰렛)의 이름은 보존 — 같은 구성이 돌아오면 이름도 되살아난다.
      const matchesAnyTab = (entry: FanTabLabelEntry): boolean =>
        tabs.some((t) =>
          t.groups.some((g) => entry.groups.some((m) => jaccardStrings(g, m) >= 0.5)),
        );
      const preserved = existingEntries.filter((e) => !matchesAnyTab(e));
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-tab-labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labels: {
            entries: [...entries, ...preserved],
            fixedLabel: fixedName.trim(),
            otherLabel: otherName.trim(),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "저장됐어요. 팬 화면 룰렛 탭에 바로 반영됩니다." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message || "저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  };

  const nothingToName = tabs.length === 0 && !showFixed && !showOther;

  return (
    <div>
      {nothingToName ? (
        <p className={styles.fieldHint}>
          지금은 팬 화면에 구분되는 룰렛 탭이 없어요. 서로 다른 룰렛의 당첨 기록이 2가지 이상 쌓이면
          팬 화면에 탭이 생기고, 그때 여기서 각 탭 이름을 정할 수 있어요.
        </p>
      ) : (
        <p className={styles.fieldHint}>
          탭 이름은 이 순서로 정해져요 — ① <b>여기(팬 탭 이름)</b>에 적은 이름이 가장 우선,
          ② 없으면 <b>룰렛 묶기</b>에서 그 묶음에 적은 이름, ③ 둘 다 없으면 자동(묶인 룰렛들에 지어둔
          이름이 이어져 보이고, 그것도 없으면 금액이 그대로 떠요).
        </p>
      )}
      <ul className={styles.tabEditList}>
        {tabs.map((t) => (
          <li key={t.rid} className={styles.tabEditRow}>
            <span className={styles.tabEditDefault}>{t.currentLabel}</span>
            <input
              className={styles.tabEditInput}
              type="text"
              value={names[t.rid] ?? ""}
              onChange={(e) => setName(t.rid, e.target.value)}
              placeholder={
                t.configName
                  ? `${t.configName} (묶기에서 정한 이름)`
                  : `${t.autoLabel || "자동 이름"} (자동)`
              }
              maxLength={30}
              aria-label={`${t.currentLabel} 탭 이름`}
            />
          </li>
        ))}
        {showFixed ? (
          <li className={styles.tabEditRow}>
            <span className={styles.tabEditDefault}>정가</span>
            <input
              className={styles.tabEditInput}
              type="text"
              value={fixedName}
              onChange={(e) => setFixedName(e.target.value.slice(0, 30))}
              placeholder="정가 (기본 이름)"
              maxLength={30}
              aria-label="정가 탭 이름"
            />
          </li>
        ) : null}
        {showOther ? (
          <li className={styles.tabEditRow}>
            <span className={styles.tabEditDefault}>기타</span>
            <input
              className={styles.tabEditInput}
              type="text"
              value={otherName}
              onChange={(e) => setOtherName(e.target.value.slice(0, 30))}
              placeholder="기타 (기본 이름)"
              maxLength={30}
              aria-label="기타 탭 이름"
            />
          </li>
        ) : null}
      </ul>
      <div className={styles.tabEditActions}>
        <button type="button" className={styles.tabEditSave} onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "팬 탭 이름 저장"}
        </button>
        <button type="button" className={styles.tabEditReset} onClick={resetAll} disabled={saving}>
          모두 비우기
        </button>
      </div>
      {msg ? <p className={msg.ok ? styles.fieldOk : styles.fieldErr}>{msg.text}</p> : null}
      <p className={styles.fieldHint}>
        비워두면 자동 이름(금액 나열)이 보여요. 정가·기타 탭은 해당 기록이 있을 때만 팬 화면에 떠요.
        룰렛 상품 구성이 절반 이상 바뀌면 이름이 자동으로 풀립니다(다시 정하면 돼요).
      </p>
    </div>
  );
}
