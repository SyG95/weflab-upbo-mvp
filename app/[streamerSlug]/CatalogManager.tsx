"use client";

// 룰렛 상품 사용여부(on/off) 편집 화면.
// 위플랩 캡처(원본)는 그대로 두고, 그 위에 "우리 사이트가 이 상품/룰렛을 쓸지"를
// sy가 직접 정하는 오버레이 층만 관리한다. 내용(상품명·확률) 수정은 이 화면의 범위가 아니다.
// 설계: docs/roulette-usage-overlay-design.md

import { Fragment, useMemo, useState } from "react";
import styles from "./page.module.css";
import cu from "./catalogUsage.module.css";
import type { Catalog, CatalogGroup, CatalogItem } from "../../lib/api";

type SortKey = "prob-desc" | "prob-asc" | "name";

type Overrides = Record<string, boolean>;

function groupLabel(g: CatalogGroup): string {
  if (g.amountRangeLabel) return g.amountRangeLabel;
  return g.amountMin === g.amountMax ? `금액 ${g.amountMin}` : `금액 ${g.amountMin}~${g.amountMax}`;
}

// 키 규칙: 그룹 "g{groupIndex}", 상품 "g{groupIndex}-i{sortOrder ?? 그룹내인덱스}".
function groupKey(g: CatalogGroup): string {
  return `g${g.groupIndex}`;
}
function itemKey(g: CatalogGroup, item: CatalogItem, idxInGroup: number): string {
  return `g${g.groupIndex}-i${item.sortOrder ?? idxInGroup}`;
}

// 위플랩 캡처 원본 값(오버라이드 반영 전).
function captureEnabled(g: CatalogGroup, item: CatalogItem): boolean {
  return item.enabled !== false && g.enabled !== false;
}

// 효과적 사용여부 = 내 오버라이드(상품 키) ?? 내 오버라이드(그룹 키) ?? 위플랩 캡처 값.
function effectiveEnabled(g: CatalogGroup, item: CatalogItem, idxInGroup: number, overrides: Overrides): boolean {
  const ik = itemKey(g, item, idxInGroup);
  const gk = groupKey(g);
  if (overrides[ik] !== undefined) return overrides[ik];
  if (overrides[gk] !== undefined) return overrides[gk];
  return captureEnabled(g, item);
}

function sortItems(items: { item: CatalogItem; idx: number }[], sort: SortKey) {
  const arr = [...items];
  if (sort === "prob-desc") arr.sort((a, b) => b.item.probability - a.item.probability);
  else if (sort === "prob-asc") arr.sort((a, b) => a.item.probability - b.item.probability);
  else arr.sort((a, b) => a.item.itemName.localeCompare(b.item.itemName));
  return arr;
}

export default function CatalogManager({
  slug,
  groups,
  threshold,
  version,
  catalogs,
  usageByVersion,
}: {
  slug: string;
  groups: CatalogGroup[];
  threshold: number;
  version: number | null;
  catalogs: Catalog[];
  usageByVersion: Record<number, Record<string, boolean>>;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("prob-desc");
  const [overrides, setOverrides] = useState<Overrides>(() => (version != null ? usageByVersion[version] ?? {} : {}));
  const [savedOverrides, setSavedOverrides] = useState<Overrides>(() =>
    version != null ? usageByVersion[version] ?? {} : {},
  );
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const needle = q.trim().toLowerCase();

  const view = useMemo(() => {
    return groups.map((g) => {
      const withIdx = (g.items ?? []).map((item, idx) => ({ item, idx }));
      const filtered = withIdx.filter(({ item }) =>
        needle ? item.itemName.toLowerCase().includes(needle) : true,
      );
      return { group: g, items: sortItems(filtered, sort) };
    });
  }, [groups, needle, sort]);

  const totals = useMemo(() => {
    let total = 0;
    let target = 0;
    for (const { items } of view) {
      total += items.length;
      target += items.filter(({ item }) => item.probability <= threshold).length;
    }
    return { total, target };
  }, [view, threshold]);

  // 그룹 접기/펼치기. 기본은 전부 접힘, 검색 중에는 결과가 있는 그룹을 자동으로 펼친다.
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  // 꺼진 룰렛 묶음 펼침 여부(기본 접힘). 켜진 룰렛만 기본 노출.
  const [showOff, setShowOff] = useState(false);

  function toggleExpanded(groupIndex: number) {
    setExpandedGroups((prev) => ({ ...prev, [groupIndex]: !prev[groupIndex] }));
  }

  const dirtyCount = useMemo(() => {
    const keys = new Set([...Object.keys(overrides), ...Object.keys(savedOverrides)]);
    let n = 0;
    for (const k of keys) {
      if (overrides[k] !== savedOverrides[k]) n++;
    }
    return n;
  }, [overrides, savedOverrides]);

  // 직전 버전(현재보다 낮은 버전 중 가장 높은 버전) — 변경점 비교용.
  const prevCatalog = useMemo(() => {
    if (version == null) return null;
    const lower = catalogs.filter((c) => c.version < version);
    if (lower.length === 0) return null;
    return lower[lower.length - 1];
  }, [catalogs, version]);

  // 이전 표에서 내 설정이 있는 가장 최신 버전(현재보다 낮은 버전 한정).
  const importSourceVersion = useMemo(() => {
    if (version == null) return null;
    const candidates = Object.keys(usageByVersion)
      .map(Number)
      .filter((v) => Number.isFinite(v) && v < version && Object.keys(usageByVersion[v] ?? {}).length > 0)
      .sort((a, b) => b - a);
    return candidates.length > 0 ? candidates[0] : null;
  }, [usageByVersion, version]);

  // (amountRangeLabel, itemName) -> 현재 표의 키. 가져오기/변경점 비교에 공용으로 쓴다.
  const currentNameIndex = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => {
      (g.items ?? []).forEach((item, idx) => {
        map.set(`${groupLabel(g)}::${item.itemName}`, itemKey(g, item, idx));
      });
    });
    return map;
  }, [groups]);

  // 직전 버전 상품 (amountRangeLabel, itemName) -> 확률/존재 여부. 변경점 하이라이트용.
  const prevNameIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!prevCatalog) return map;
    (prevCatalog.groups ?? []).forEach((g) => {
      (g.items ?? []).forEach((item) => {
        map.set(`${groupLabel(g)}::${item.itemName}`, item.probability);
      });
    });
    return map;
  }, [prevCatalog]);

  const diffSummary = useMemo(() => {
    if (!prevCatalog) return null;
    let added = 0;
    let changed = 0;
    const currentNames = new Set<string>();
    groups.forEach((g) => {
      (g.items ?? []).forEach((item) => {
        const key = `${groupLabel(g)}::${item.itemName}`;
        currentNames.add(key);
        const prevProb = prevNameIndex.get(key);
        if (prevProb === undefined) added++;
        else if (prevProb !== item.probability) changed++;
      });
    });
    let removed = 0;
    prevNameIndex.forEach((_prob, key) => {
      if (!currentNames.has(key)) removed++;
    });
    if (added === 0 && removed === 0 && changed === 0) return null;
    return { added, removed, changed };
  }, [groups, prevCatalog, prevNameIndex]);

  function setOverride(key: string, nextValue: boolean, captureValue: boolean) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (nextValue === captureValue) {
        delete next[key];
      } else {
        next[key] = nextValue;
      }
      return next;
    });
  }

  function toggleGroup(g: CatalogGroup) {
    const gk = groupKey(g);
    const current = overrides[gk] ?? g.enabled !== false;
    setOverride(gk, !current, g.enabled !== false);
  }

  function toggleItem(g: CatalogGroup, item: CatalogItem, idx: number) {
    const ik = itemKey(g, item, idx);
    const current = effectiveEnabled(g, item, idx, overrides);
    // 기준값 = 상품 키를 지웠을 때 실제로 돌아가는 값(그룹 오버라이드 > 캡처 값).
    // 캡처 값만 기준으로 삼으면 "그룹은 껐지만 이 상품만 켜기"가 키 삭제로 무시되는 버그가 생긴다.
    const baseline = overrides[groupKey(g)] ?? captureEnabled(g, item);
    setOverride(ik, !current, baseline);
  }

  function importFromPrevious() {
    if (importSourceVersion == null) return;
    const sourceCatalog = catalogs.find((c) => c.version === importSourceVersion);
    const sourceOverrides = usageByVersion[importSourceVersion] ?? {};
    if (!sourceCatalog) {
      setImportMsg("이전 표 데이터를 찾지 못했어요.");
      return;
    }
    // 이전 버전의 키(g{groupIndex}-i{sortOrder} 등)를 그 버전 카탈로그에서 실제 상품으로 해석한다.
    const sourceGroupsByIndex = new Map<number, CatalogGroup>();
    (sourceCatalog.groups ?? []).forEach((g) => sourceGroupsByIndex.set(g.groupIndex, g));

    let imported = 0;
    let skipped = 0;
    const next = { ...overrides };

    for (const [key, value] of Object.entries(sourceOverrides)) {
      const m = key.match(/^g(\d+)(?:-i(\d+))?$/);
      if (!m) {
        skipped++;
        continue;
      }
      const gIdx = Number(m[1]);
      const iOrder = m[2] !== undefined ? Number(m[2]) : null;
      const sourceGroup = sourceGroupsByIndex.get(gIdx);
      if (!sourceGroup) {
        skipped++;
        continue;
      }

      if (iOrder === null) {
        // 그룹 단위 오버라이드: 같은 금액대 라벨을 가진 현재 그룹을 찾아 그대로 적용.
        const targetGroup = groups.find((g) => groupLabel(g) === groupLabel(sourceGroup));
        if (!targetGroup) {
          skipped++;
          continue;
        }
        next[groupKey(targetGroup)] = value;
        imported++;
        continue;
      }

      // 상품 단위 오버라이드: sortOrder(없으면 그룹 내 인덱스)로 이전 표 상품을 찾는다.
      const sourceItems = sourceGroup.items ?? [];
      const sourceItemEntry = sourceItems
        .map((it, idx) => ({ it, idx }))
        .find(({ it, idx }) => (it.sortOrder ?? idx) === iOrder);
      if (!sourceItemEntry) {
        skipped++;
        continue;
      }
      const { it: sourceItem } = sourceItemEntry;
      const lookupKey = `${groupLabel(sourceGroup)}::${sourceItem.itemName}`;
      const targetKey = currentNameIndex.get(lookupKey);
      if (!targetKey) {
        skipped++;
        continue;
      }
      next[targetKey] = value;
      imported++;
    }

    setOverrides(next);
    setImportMsg(`${imported}개 가져옴, ${skipped}개는 현재 표에 없어 건너뜀`);
  }

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    if (version == null) {
      setMsg({ kind: "err", text: "현재 카탈로그 버전을 확인할 수 없어요." });
      return;
    }
    setSaving(true);
    setStep("저장 중…");
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/catalog-usage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalogVersion: version, overrides }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
        return;
      }
      const nextOverrides: Overrides = data?.catalogUsage?.overrides ?? overrides;
      setOverrides(nextOverrides);
      setSavedOverrides(nextOverrides);
      setMsg({ kind: "ok", text: "적용됐어요! 다음 판정부터 반영됩니다." });
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
      setStep(null);
    }
  }

  // 켜진 룰렛을 위에, 꺼진 룰렛(내 설정/위플랩에서 꺼짐)은 아래로 모아 접는다. 검색 중엔 원래 순서·전부 노출.
  // 표시 순서/접힘만 바꾼다 — 업보 판정·저장에는 영향 없음.
  const isGroupOn = (g: CatalogGroup) => overrides[groupKey(g)] ?? (g.enabled !== false);
  const orderedView = needle
    ? view
    : [...view.filter(({ group }) => isGroupOn(group)), ...view.filter(({ group }) => !isGroupOn(group))];
  const offCount = needle ? 0 : view.filter(({ group }) => !isGroupOn(group)).length;

  return (
    <div className={styles.cm}>
      <p className={cu.banner}>
        여기서 끈 상품은 다음 판정부터 업보 계산에서 빠져요. 위플랩 원본 캡처는 바뀌지 않아요.
      </p>

      {diffSummary ? (
        <p className={cu.diffSummary}>
          직전 표 대비: 추가 {diffSummary.added} · 삭제 {diffSummary.removed} · 확률변경 {diffSummary.changed}
        </p>
      ) : null}

      <div className={styles.cmToolbar}>
        <input
          className={styles.cmSearch}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="상품 이름 검색"
          aria-label="상품 검색"
        />
        <select
          className={styles.cmSort}
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="정렬"
        >
          <option value="prob-desc">확률 높은순</option>
          <option value="prob-asc">확률 낮은순</option>
          <option value="name">이름순</option>
        </select>
        {importSourceVersion != null ? (
          <button type="button" className={cu.importBtn} onClick={importFromPrevious}>
            이전 표에서 내 설정 가져오기 (v{importSourceVersion})
          </button>
        ) : null}
      </div>
      {importMsg ? <p className={cu.importMsg}>{importMsg}</p> : null}

      <div className={styles.cmSummary}>
        <span className={styles.tagActive}>catalog v{version ?? "?"}</span>
        <span className={styles.tagMuted}>전체 {totals.total}개</span>
        <span className={styles.tag}>업보 대상 {totals.target}개 (기준 {threshold}% 이하)</span>
        {dirtyCount > 0 ? <span className={cu.dirtyBadge}>저장 안 된 변경 {dirtyCount}건</span> : null}
      </div>

      {orderedView.map(({ group, items }, viewIdx) => {
        const groupCaptureOn = group.enabled !== false;
        const groupEffectiveOn = overrides[groupKey(group)] ?? groupCaptureOn;
        // 검색 중엔 결과가 있는 그룹을 자동으로 펼치고, 평소엔 접힘이 기본.
        const isExpanded = q.trim() ? items.length > 0 : (expandedGroups[group.groupIndex] ?? false);
        // 꺼진 룰렛은 아래로 모아 기본 숨김(검색 중엔 전부 노출). 첫 꺼진 룰렛 앞에 "보기/접기" 버튼.
        const isOff = !needle && !groupEffectiveOn;
        const prevOn = viewIdx === 0 ? true : isGroupOn(orderedView[viewIdx - 1].group);
        const isFirstOff = isOff && prevOn;
        return (
          <Fragment key={group.groupIndex}>
            {isFirstOff ? (
              <button
                type="button"
                onClick={() => setShowOff((s) => !s)}
                aria-expanded={showOff}
                style={{
                  width: "100%",
                  margin: "10px 0 2px",
                  padding: "10px 12px",
                  border: "1px dashed var(--paper-line)",
                  borderRadius: 10,
                  background: "var(--surface)",
                  color: "var(--muted)",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                꺼진 룰렛 {offCount}개 {showOff ? "접기 ▲" : "보기 ▼"}
              </button>
            ) : null}
            {isOff && !showOff ? null : (
          <section className={styles.cmGroup}>
            <div className={styles.cmGroupHead}>
              <button
                type="button"
                className={`${cu.toggle} ${groupEffectiveOn ? cu.toggleOn : ""}`}
                onClick={() => toggleGroup(group)}
                role="switch"
                aria-checked={groupEffectiveOn}
                aria-label={`${groupLabel(group)} 그룹 사용 여부`}
              >
                <span className={cu.toggleKnob} />
              </button>
              <button
                type="button"
                className={cu.expandHead}
                onClick={() => toggleExpanded(group.groupIndex)}
                aria-expanded={isExpanded}
              >
                <span className={`${cu.chevron} ${isExpanded ? cu.chevronOpen : ""}`} aria-hidden>
                  ▸
                </span>
                <span className={styles.cmGroupName}>{groupLabel(group)}</span>
              </button>
              <span className={styles.tagMuted}>{items.length}개</span>
              {!groupCaptureOn ? <span className={cu.groupOffBadge}>위플랩에선 꺼짐</span> : null}
              <button type="button" className={cu.expandBtn} onClick={() => toggleExpanded(group.groupIndex)}>
                {isExpanded ? "접기" : "펼치기"}
              </button>
            </div>

            {!isExpanded ? null : items.length === 0 ? (
              <p className={styles.fieldHint}>검색 결과가 없어요.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>상품</th>
                      <th className={styles.probCol}>확률</th>
                      <th className={styles.cmStateCol}>상태</th>
                      <th className={styles.cmUseCol}>사용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ item, idx }) => {
                      const isTarget = item.probability <= threshold;
                      const effectiveOn = effectiveEnabled(group, item, idx, overrides);
                      const ik = itemKey(group, item, idx);
                      const mineOverridden = overrides[ik] !== undefined;
                      const nameLookupKey = `${groupLabel(group)}::${item.itemName}`;
                      const prevProb = prevNameIndex.get(nameLookupKey);
                      const isNew = prevCatalog ? prevProb === undefined : false;
                      const isChanged = prevCatalog && prevProb !== undefined && prevProb !== item.probability;
                      return (
                        <tr key={`${group.groupIndex}-${item.itemName}-${idx}`} className={!effectiveOn ? cu.rowOff : ""}>
                          <td className={styles.nameCell}>{item.itemName}</td>
                          <td className={styles.probCell}>{item.probability}%</td>
                          <td>
                            <div className={cu.badgeCell}>
                              {isTarget ? (
                                <span className={`${styles.badge} ${styles.badgePending}`}>업보 대상</span>
                              ) : (
                                <span className={styles.cmMutedDash}>—</span>
                              )}
                              {isNew ? <span className={cu.newBadge}>NEW</span> : null}
                              {isChanged ? (
                                <span className={cu.changedBadge}>
                                  확률 변경 {prevProb}%→{item.probability}%
                                </span>
                              ) : null}
                              {mineOverridden ? (
                                effectiveOn ? (
                                  <span className={cu.mineOnBadge}>내 설정: 사용</span>
                                ) : (
                                  <span className={cu.mineOffBadge}>내 설정: 사용 안 함</span>
                                )
                              ) : null}
                            </div>
                          </td>
                          <td className={styles.cmUseCell}>
                            <button
                              type="button"
                              className={`${cu.toggle} ${effectiveOn ? cu.toggleOn : ""}`}
                              onClick={() => toggleItem(group, item, idx)}
                              role="switch"
                              aria-checked={effectiveOn}
                              aria-label={`${item.itemName} 사용 여부`}
                            >
                              <span className={cu.toggleKnob} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
            )}
          </Fragment>
        );
      })}

      <div className={styles.cmSaveRow}>
        <div className={cu.tokenRow}>
          <button className={styles.cmSaveBtn} type="button" onClick={save} disabled={saving}>
            {saving ? step ?? "저장 중…" : "사용 설정 저장"}
          </button>
        </div>
        {msg ? <p className={msg.kind === "ok" ? cu.ok : cu.err}>{msg.text}</p> : null}
      </div>
    </div>
  );
}
