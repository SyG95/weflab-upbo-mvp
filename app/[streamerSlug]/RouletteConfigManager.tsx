"use client";

// 스트리머 관리자용 "룰렛 관리" 화면.
// 룰렛표 그룹(33·330·152 등)을 골라 "같은 룰렛"으로 묶고 이름을 붙인다.
//  - 이름 만들고 → 그룹 골라 담기(직접 선언). 자동 추천(상품 겹침)은 도우미로만 제안.
//  - 사용/보관(숨김): 보관하면 팬·후보에서 빠짐(원본 catalog 불변, 복구 가능).
// 저장은 "각 멤버 그룹의 상품 구성"에 매달려(config.groups), 새 캡처가 들어와도 같은 그룹이면
// 소속 룰렛이 자동으로 따라온다. 인증은 관리자 로그인 세션(쿠키).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { jaccardStrings, type RouletteConfigEntry } from "../../lib/api";
import styles from "./rouletteConfig.module.css";

export type GroupForManager = {
  index: number; // groupIndex (현재 렌더 내 식별)
  amountLabel: string;
  itemCount: number;
  sampleItems: string[];
  items: string[]; // 이 그룹의 상품명 집합(지문)
  assignedConfigIndex: number;
  assignedName?: string;
  suggestKey: string; // 자동 추천 묶음 키(같으면 함께 담길 후보)
};

export type NamedRouletteForManager = {
  configIndex: number;
  name: string;
  archived: boolean;
  revealed: boolean;
  groupIndices: number[];
};

type EditRoulette = { name: string; archived: boolean; revealed: boolean; groupIndices: number[] };

export default function RouletteConfigManager({
  slug,
  groups,
  roulettes,
  existingConfig,
}: {
  slug: string;
  groups: GroupForManager[];
  roulettes: NamedRouletteForManager[];
  existingConfig: RouletteConfigEntry[];
}) {
  // revealed(팬 확률표 공개)는 별도 "확률 공개" 하위탭에서 관리한다. 여기선 값만 보존(덮어쓰지 않게).
  const [items, setItems] = useState<EditRoulette[]>(() =>
    roulettes.map((r) => ({
      name: r.name ?? "",
      archived: r.archived,
      revealed: r.revealed,
      groupIndices: [...r.groupIndices],
    })),
  );
  const [newName, setNewName] = useState("");
  const [newSelected, setNewSelected] = useState<number[]>([]);
  // 기본 접힘. "룰렛 이름 설정" 버튼으로 열어 그룹화한다(이미 만든 룰렛이 있으면 펼쳐서 보여줌).
  const [open, setOpen] = useState(roulettes.length > 0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  const groupByIndex = useMemo(() => {
    const m = new Map<number, GroupForManager>();
    for (const g of groups) m.set(g.index, g);
    return m;
  }, [groups]);

  const assignedSet = useMemo(() => {
    const s = new Set<number>();
    for (const r of items) for (const gi of r.groupIndices) s.add(gi);
    return s;
  }, [items]);

  const unassigned = useMemo(
    () => groups.filter((g) => !assignedSet.has(g.index)),
    [groups, assignedSet],
  );

  const label = (g: GroupForManager) => g.amountLabel || g.sampleItems[0] || "그룹";

  function addGroupTo(ri: number, gi: number) {
    setItems((prev) =>
      prev.map((r, i) => {
        const without = r.groupIndices.filter((x) => x !== gi);
        return i === ri ? { ...r, groupIndices: [...without, gi] } : { ...r, groupIndices: without };
      }),
    );
  }
  function removeGroupFrom(ri: number, gi: number) {
    setItems((prev) =>
      prev.map((r, i) => (i === ri ? { ...r, groupIndices: r.groupIndices.filter((x) => x !== gi) } : r)),
    );
  }
  function setName(ri: number, name: string) {
    setItems((prev) => prev.map((r, i) => (i === ri ? { ...r, name: name.slice(0, 60) } : r)));
  }
  function setArchived(ri: number, archived: boolean) {
    setItems((prev) => prev.map((r, i) => (i === ri ? { ...r, archived } : r)));
  }
  function removeRoulette(ri: number) {
    setItems((prev) => prev.filter((_, i) => i !== ri));
  }
  function toggleNew(gi: number) {
    setNewSelected((prev) => (prev.includes(gi) ? prev.filter((x) => x !== gi) : [...prev, gi]));
  }
  function createRoulette() {
    if (newSelected.length === 0) return;
    setItems((prev) => [
      ...prev,
      { name: newName.trim(), archived: false, revealed: false, groupIndices: [...newSelected] },
    ]);
    setNewName("");
    setNewSelected([]);
  }

  async function save() {
    const groupItemsOf = (gi: number) => groupByIndex.get(gi)?.items ?? [];
    // 편집한 룰렛 → config. 이름·보관·그룹지문 저장. 의미 없는 건(이름·보관 없고 그룹 1개) 제외.
    const built: RouletteConfigEntry[] = items
      .map((r) => ({
        name: r.name.trim() || undefined,
        archived: r.archived,
        revealed: r.revealed,
        groups: r.groupIndices.map(groupItemsOf).filter((a) => a.length > 0),
      }))
      .filter(
        (r) =>
          r.groups.length > 0 &&
          (Boolean(r.name) || r.archived || r.revealed || r.groups.length >= 2),
      );
    // 현재 카탈로그에 없는(어느 그룹과도 안 겹치는) 기존 설정은 그대로 보존.
    const preserved = existingConfig.filter(
      (e) => !groups.some((g) => (e.groups ?? []).some((m) => jaccardStrings(g.items, m) >= 0.5)),
    );
    const entries = [...built, ...preserved];

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/roulette-config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 팬 화면 룰렛 탭·보관에 반영됩니다." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  if (groups.length === 0) {
    return (
      <p className={styles.empty}>
        현재 사용 중인 룰렛표에서 그룹을 찾지 못했어요. Extension으로 룰렛표를 먼저 저장해 주세요.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.nameSetBtn} onClick={() => setOpen((o) => !o)}>
        <span>🎯 룰렛 이름 설정 · 묶기</span>
        {items.length > 0 ? <span className={styles.nameSetCount}>내 룰렛 {items.length}개</span> : null}
        <span className={styles.nameSetCaret}>{open ? "▲ 접기" : "▼ 열기"}</span>
      </button>

      {!open ? null : (
        <div className={styles.panel}>
          <p className={styles.sub}>
            아래 그룹들을 <b>같은 룰렛</b>으로 묶으면, 시청자 화면 한 탭에 묶인 룰렛들의 기록 상품이
            전부 함께 표시됩니다(상품 합산). 탭에 보일 이름은 위 <b>&quot;팬 탭 이름&quot;</b>에서 따로
            정할 수 있어요(묶지 않아도 가능). 안 쓰는 그룹은 <b>보관</b>하면 팬·후보에서 빠집니다(원본 그대로, 복구 가능).
          </p>


          {/* 내가 만든 룰렛 */}
          {items.length > 0 ? (
            <>
              <p className={styles.sectionTitle}>내 룰렛</p>
              <div className={styles.list}>
            {items.map((r, ri) => (
              <div key={ri} className={r.archived ? `${styles.card} ${styles.cardArchived}` : styles.card}>
                <div className={styles.controls}>
                  <input
                    className={styles.nameInput}
                    type="text"
                    value={r.name}
                    placeholder="룰렛 이름 (예: 생일룰렛)"
                    maxLength={60}
                    onChange={(e) => setName(ri, e.target.value)}
                  />
                  <div className={styles.toggle} role="group" aria-label="사용/보관">
                    <button
                      type="button"
                      className={!r.archived ? `${styles.toggleBtn} ${styles.toggleBtnActiveUse}` : styles.toggleBtn}
                      onClick={() => setArchived(ri, false)}
                    >
                      사용
                    </button>
                    <button
                      type="button"
                      className={r.archived ? `${styles.toggleBtn} ${styles.toggleBtnActiveArchive}` : styles.toggleBtn}
                      onClick={() => setArchived(ri, true)}
                    >
                      보관
                    </button>
                  </div>
                  <button type="button" className={styles.deleteBtn} onClick={() => removeRoulette(ri)}>
                    묶음 해제
                  </button>
                </div>

                <div className={styles.memberChips}>
                  {r.groupIndices.map((gi) => {
                    const g = groupByIndex.get(gi);
                    return (
                      <span key={gi} className={styles.memberChip}>
                        {g ? label(g) : `#${gi}`}
                        <button
                          type="button"
                          className={styles.memberChipX}
                          onClick={() => removeGroupFrom(ri, gi)}
                          aria-label="이 그룹 빼기"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {unassigned.length > 0 ? (
                    <select
                      className={styles.addSelect}
                      value=""
                      onChange={(e) => {
                        const gi = Number(e.target.value);
                        if (!Number.isNaN(gi) && e.target.value !== "") addGroupTo(ri, gi);
                      }}
                    >
                      <option value="">+ 그룹 추가…</option>
                      {unassigned.map((g) => (
                        <option key={g.index} value={g.index}>
                          {label(g)} ({g.itemCount}종)
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

          {/* 새 룰렛 만들기 */}
          <p className={styles.sectionTitle}>새 룰렛 만들기</p>
          <div className={styles.createBox}>
        <input
          className={styles.nameInput}
          type="text"
          value={newName}
          placeholder="룰렛 이름 (선택 — 안 적어도 묶기만 가능)"
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
        />
        {unassigned.length === 0 ? (
          <p className={styles.hint}>모든 그룹이 룰렛에 담겼어요.</p>
        ) : (
          <div className={styles.checkList}>
            {unassigned.map((g) => (
              <label key={g.index} className={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={newSelected.includes(g.index)}
                  onChange={() => toggleNew(g.index)}
                />
                <span className={styles.amountBadge}>{label(g)}</span>
                <span className={styles.groupMeta}>
                  {g.itemCount}종 · {g.sampleItems.slice(0, 2).join(", ")}
                </span>
              </label>
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.saveBtn}
          onClick={() => createRoulette()}
          disabled={newSelected.length === 0}
        >
          룰렛 만들기 ({newSelected.length})
        </button>
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "전체 저장"}
        </button>
        <span className={styles.summary}>내 룰렛 {items.length}개 · 안 정한 그룹 {unassigned.length}개</span>
      </div>
          {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
        </div>
      )}
    </div>
  );
}
