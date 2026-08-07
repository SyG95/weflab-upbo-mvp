"use client";

// 관리자 "팬 탭 이름" — 팬 화면 룰렛 탭에 보일 이름 + 탭 순서(드래그)를 정한다(묶기와 완전 분리,
// 이름은 sy 확정 2026-07-08, 순서 드래그는 2026-08-07 추가). 이름/순서 모두 탭의 상품 지문에 매달린다:
//  - 묶기/해제와 무관하게 유지되고, 같은 상품 구성의 탭이 다시 생기면 이름·자리가 되살아난다.
//  - 새 캡처가 와도 상품이 비슷하면(자카드 ≥ 0.5) 따라온다. 절반 이상 바뀌면 자동으로 풀린다.
// 정가/기타 탭은 지문이 없어 kind 로 순서에 참여한다. 저장 = audit_logs 오버레이 최신 1건(스키마 무변경).
// 지금 화면에 없는 탭의 옛 이름은 보존한다(순서는 보이는 탭끼리만 저장).

import { useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  jaccardStrings,
  type FanTabLabelEntry,
  type FanTabOrderItem,
} from "../../lib/api";
import styles from "./page.module.css";

export type FanTabForNaming = {
  rid: string;
  currentLabel: string; // 지금 팬 화면에 보이는 라벨(오버레이 > 묶음 이름 > 자동)
  autoLabel: string; // 자동(금액 나열) 라벨
  overlayName?: string; // 이 화면에서 저장한 이름(있으면)
  configName?: string; // 룰렛 묶기에서 저장된 이름(있으면 — 오버레이가 없을 때 대신 표시됨)
  groups: string[][]; // 이 탭의 멤버 그룹 상품 지문
};

// 관리자 목록 한 줄 — 팬 화면 탭 순서 그대로 내려온다(정가/기타 자리 포함).
export type FanNameRow =
  | { kind: "tab"; tab: FanTabForNaming }
  | { kind: "fixed" }
  | { kind: "other" };

const FIXED_KEY = "__fixed__";
const OTHER_KEY = "__other__";

const keyOfRow = (r: FanNameRow): string =>
  r.kind === "tab" ? r.tab.rid : r.kind === "fixed" ? FIXED_KEY : OTHER_KEY;

export default function FanTabNameManager({
  slug,
  rows,
  fixedLabel,
  otherLabel,
  existingEntries,
}: {
  slug: string;
  rows: FanNameRow[];
  fixedLabel: string;
  otherLabel: string;
  existingEntries: FanTabLabelEntry[];
}) {
  const tabs = rows.filter((r): r is Extract<FanNameRow, { kind: "tab" }> => r.kind === "tab");
  const rowByKey = new Map(rows.map((r) => [keyOfRow(r), r]));

  const [names, setNames] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of tabs) m[r.tab.rid] = r.tab.overlayName ?? "";
    return m;
  });
  const [fixedName, setFixedName] = useState(fixedLabel);
  const [otherName, setOtherName] = useState(otherLabel);
  const [order, setOrder] = useState<string[]>(() => rows.map(keyOfRow));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const setName = (rid: string, value: string) =>
    setNames((prev) => ({ ...prev, [rid]: value.slice(0, 30) }));

  const move = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== fromKey);
      const idx = next.indexOf(toKey);
      next.splice(idx, 0, fromKey);
      return next;
    });
  };

  const resetAll = () => {
    setNames(Object.fromEntries(tabs.map((r) => [r.tab.rid, ""])));
    setFixedName("");
    setOtherName("");
    // 순서도 기본으로: 룰렛 탭 가나다순(오버레이 이름을 지운 상태의 라벨 근사치) → 정가 → 기타.
    // 정확한 기본 라벨은 저장 후 서버가 다시 계산하므로 여기선 묶기 이름/자동 라벨로 근사한다.
    const defaultTabs = [...tabs].sort((a, b) =>
      (a.tab.configName || a.tab.autoLabel || a.tab.currentLabel).localeCompare(
        b.tab.configName || b.tab.autoLabel || b.tab.currentLabel,
        undefined,
        { numeric: true },
      ),
    );
    setOrder(
      defaultTabs
        .map((r) => r.tab.rid)
        .concat(rowByKey.has(FIXED_KEY) ? [FIXED_KEY] : [])
        .concat(rowByKey.has(OTHER_KEY) ? [OTHER_KEY] : []),
    );
    setMsg(null);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // 현재 탭들에 입력된 이름 → 그 탭의 상품 지문과 함께 저장.
      const entries: FanTabLabelEntry[] = tabs
        .map((r) => ({ name: (names[r.tab.rid] ?? "").trim(), groups: r.tab.groups }))
        .filter((e) => e.name.length > 0);
      // 지금 화면에 없는 탭(옛 룰렛)의 이름은 보존 — 같은 구성이 돌아오면 이름도 되살아난다.
      const matchesAnyTab = (entry: FanTabLabelEntry): boolean =>
        tabs.some((r) =>
          r.tab.groups.some((g) => entry.groups.some((m) => jaccardStrings(g, m) >= 0.5)),
        );
      const preserved = existingEntries.filter((e) => !matchesAnyTab(e));
      // 탭 순서 = 지금 목록의 드래그 순서 스냅샷. 룰렛 탭은 지문으로, 정가/기타는 kind 로 저장.
      const orderPayload: FanTabOrderItem[] = order
        .map((k) => rowByKey.get(k))
        .filter((r): r is FanNameRow => Boolean(r))
        .map((r) => (r.kind === "tab" ? { kind: "tab" as const, groups: r.tab.groups } : { kind: r.kind }));
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/fan-tab-labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labels: {
            entries: [...entries, ...preserved],
            order: orderPayload,
            fixedLabel: fixedName.trim(),
            otherLabel: otherName.trim(),
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
      setMsg({ ok: true, text: "저장됐어요. 팬 화면 룰렛 탭에 이름·순서가 바로 반영됩니다." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message || "저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  };

  const nothingToName = rows.length === 0;

  const dragProps = (key: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/plain", key);
      setDragKey(key);
    },
    onDragEnd: () => setDragKey(null),
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (dragKey && dragKey !== key) move(dragKey, key);
    },
    className:
      dragKey === key ? `${styles.tabEditRow} ${styles.tabEditRowDrag}` : styles.tabEditRow,
  });

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
          이름이 이어져 보이고, 그것도 없으면 금액이 그대로 떠요). 탭을 <b>드래그</b>해서 순서를 바꾸면
          팬 화면 탭도 그 순서로 보여요.
        </p>
      )}
      <ul className={styles.tabEditList}>
        {order.map((key) => {
          const row = rowByKey.get(key);
          if (!row) return null;
          if (row.kind === "fixed") {
            return (
              <li key={key} {...dragProps(key)}>
                <span className={styles.tabEditGrip} aria-hidden>
                  ⠿
                </span>
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
            );
          }
          if (row.kind === "other") {
            return (
              <li key={key} {...dragProps(key)}>
                <span className={styles.tabEditGrip} aria-hidden>
                  ⠿
                </span>
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
            );
          }
          const t = row.tab;
          return (
            <li key={key} {...dragProps(key)}>
              <span className={styles.tabEditGrip} aria-hidden>
                ⠿
              </span>
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
          );
        })}
      </ul>
      <div className={styles.tabEditActions}>
        <button type="button" className={styles.tabEditSave} onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "팬 탭 이름·순서 저장"}
        </button>
        <button type="button" className={styles.tabEditReset} onClick={resetAll} disabled={saving}>
          모두 비우기
        </button>
      </div>
      {msg ? <p className={msg.ok ? styles.fieldOk : styles.fieldErr}>{msg.text}</p> : null}
      <p className={styles.fieldHint}>
        비워두면 자동 이름(금액 나열)이 보여요. 정가·기타 탭은 해당 기록이 있을 때만 팬 화면에 떠요.
        룰렛 상품 구성이 절반 이상 바뀌면 이름·순서가 자동으로 풀립니다(다시 정하면 돼요).
      </p>
    </div>
  );
}
