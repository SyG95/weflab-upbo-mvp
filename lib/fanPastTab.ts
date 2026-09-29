// 팬 탭 되짚기(1단계-a, sy 승인 2026-09-20) — 순수 계산. DB·React 의존 0.
//
// 배경: 팬 화면 룰렛 탭은 "최신 룰렛표 1장"의 상품명 색인(itemRoulette)으로만 기록을 나눈다.
// 표가 바뀌어 상품명이 사라진 옛 기록은 전부 "기타"로 떨어졌다(수동 35%·채루 자동 72%가 기타행).
// 이 모듈은 그 "기타로 가던 분기"에서만 기록의 (catalogVersion, catalogGroupIndex)와 금액대 라벨을
// 되짚어 ① 지금 표의 같은 금액대 탭으로 보내거나 ② "이전 표 · L" 탭을 만든다.
//
// 불변 조건(impl-spec-stage1-2.md):
//  - 상품명이 최신 표에 있는 기록(info 있음)은 이 모듈을 거치지 않는다 — 호출측이 보장.
//  - 옛 버전 그룹을 색인(itemsByRid)에 넣지 않는다 — 여기서는 rid 문자열만 고른다.
//  - 새 저장 없음. 탭 이름 오버레이(pastLabels)는 기존 fan_tab_labels_updated 에 얹는다.

import { customTabKey, type ManualTabHint } from "./manualTabHint";

export const PAST_TAB_PREFIX = "past:";
// partitionHoldingsByRoulette 의 "기타" 키와 같은 값이어야 한다(page.tsx OTHER).
export const OTHER_TAB_KEY = "__other__";
export const PAST_TAB_DEFAULT_PREFIX = "이전 표 · ";

export type PastTabItem = {
  catalogVersion?: number | null;
  catalogGroupIndex?: number | null;
  amountRangeLabel?: string | null;
};

export type PastTabOldGroup = { label: string; items: string[] };

export type PastTabContext = {
  // 금액대 라벨 L → 활성 표에서 그 라벨을 가진 그룹들의 rid(보관 룰렛 제외, 중복 제거).
  labelRids: Map<string, string[]>;
  // rid → 멤버 그룹 상품명 배열들(현재 표). buildRouletteIndex 의 groupsByRid 그대로.
  groupItemsByRid: Map<string, string[][]>;
  // `${version}:${groupIndex}` → 옛(및 현재) 버전 그룹의 라벨·상품명.
  oldGroups: Map<string, PastTabOldGroup>;
};

export function oldGroupKey(version: number, groupIndex: number): string {
  return `${version}:${groupIndex}`;
}

// 자카드 유사도(교집합/합집합). lib/api.ts jaccardStrings 와 같은 규칙(둘 다 비면 1, 합집합 0이면 0).
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const x of small) if (large.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni > 0 ? inter / uni : 0;
}

export function pastTabKey(label: string): string {
  return PAST_TAB_PREFIX + label;
}

export function isPastTabKey(key: string): boolean {
  return key.startsWith(PAST_TAB_PREFIX) && key.length > PAST_TAB_PREFIX.length;
}

export function pastLabelOfKey(key: string): string {
  return isPastTabKey(key) ? key.slice(PAST_TAB_PREFIX.length) : "";
}

// 팬 화면 표시 이름: 관리자가 지은 이름(pastLabels[L]) > 기본 "이전 표 · L".
export function pastTabLabel(label: string, pastLabels?: Record<string, string> | null): string {
  const custom = pastLabels?.[label];
  return (typeof custom === "string" && custom.trim()) || PAST_TAB_DEFAULT_PREFIX + label;
}

// 금액대 라벨 숫자순("33~50" < "330" < "1000"). 같은 숫자면 문자열 비교.
export function sortPastLabels(labels: Iterable<string>): string[] {
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// 규칙(명세 1단계-a). 상품명이 최신 표에 없는 기록에만 호출한다.
//  1. (버전, 그룹) 없음 → 기타.
//  2. L = 기록 라벨 → 없으면 옛 그룹 라벨 → 그래도 없으면 기타.
//  3. 활성 표에서 라벨 L 인 비보관 rid 가 정확히 1개 → 그 rid.
//  4. 2개 이상 → 옛 그룹 상품명 vs 후보 멤버 그룹 상품명 자카드 최고값 ≥ 0.5 → 그 rid, 미만 → past:L.
//  5. 0개 → past:L.
export function resolvePastTabRid(item: PastTabItem, ctx: PastTabContext): string {
  const version = item.catalogVersion;
  const groupIndex = item.catalogGroupIndex;
  if (version === null || version === undefined || groupIndex === null || groupIndex === undefined) {
    return OTHER_TAB_KEY;
  }
  const old = ctx.oldGroups.get(oldGroupKey(version, groupIndex));
  const label = (item.amountRangeLabel ?? "").trim() || (old?.label ?? "").trim();
  if (!label) return OTHER_TAB_KEY;

  const rids = [...new Set(ctx.labelRids.get(label) ?? [])];
  if (rids.length === 1) return rids[0];
  if (rids.length === 0) return pastTabKey(label);

  const oldItems = new Set(old?.items ?? []);
  let best: string | undefined;
  let bestScore = 0;
  for (const rid of rids) {
    for (const members of ctx.groupItemsByRid.get(rid) ?? []) {
      const score = jaccard(oldItems, members);
      if (score > bestScore) {
        bestScore = score;
        best = rid;
      }
    }
  }
  return best !== undefined && bestScore >= 0.5 ? best : pastTabKey(label);
}

// 수동기록 "직접 입력" 탭 힌트(2026-09-21) → 팬 탭 rid. 호출측은 catalogVersion == null 이고 상품명이 최신 표에 없는
// 기록에만 부른다(표 버전이 있는 기록은 힌트를 보지 않는다 — 불변 조건 1).
//  other  → 기타(__other__)
//  custom → custom:<이름> (partition 이 이름 그대로 탭을 만든다)
//  label  → 활성 표에서 라벨 L 인 팬 탭 rid 가 정확히 1개면 그 rid,
//           2개 이상이고 hint.rid 가 그중 하나면 hint.rid,
//           그 외(0개 = 단종 금액대, 2개 이상인데 rid 불일치) → past:L
export function resolveHintedTabRid(hint: ManualTabHint, ctx: PastTabContext): string {
  if (hint.kind === "other") return OTHER_TAB_KEY;
  if (hint.kind === "custom") return customTabKey(hint.name);
  const label = hint.label.trim();
  if (!label) return OTHER_TAB_KEY;
  const rids = [...new Set(ctx.labelRids.get(label) ?? [])];
  if (rids.length === 1) return rids[0];
  if (rids.length >= 2 && hint.rid && rids.includes(hint.rid)) return hint.rid;
  return pastTabKey(label);
}

// 기록 한 조각이 갈 팬 탭 rid — 수동기록 탭 힌트 전면 개방(2026-09-29, sy 승인 / 루빗 건의 9-23).
// 순서: ① 스트리머가 수동기록에 직접 정한 탭(힌트)이 있으면 무조건 그 탭
//       ② 없으면 상품명이 지금 표에 있을 때 그 룰렛 탭(productRid) — 자동수집·힌트 없는 수동기록의 기존 경로
//       ③ 둘 다 없으면 되짚기(resolvePastTabRid: 같은 금액대 탭 / «이전 표 · L» / 기타).
// 9/21 규칙("표 버전이 있는 기록은 힌트를 보지 않는다")을 "수동기록이 직접 정한 경우에만" 푼 것이다. 힌트는
// 수동기록(manual:*)에만 저장되므로 자동수집 기록의 경로는 이 함수로도 바뀌지 않는다. 정가(FIXED)는 호출측이 먼저 뺀다.
export function resolveHoldingTabRid(
  item: PastTabItem & { tabHint?: ManualTabHint | null },
  productRid: string | undefined,
  ctx: PastTabContext,
): string {
  if (item.tabHint) return resolveHintedTabRid(item.tabHint, ctx);
  if (productRid) return productRid;
  return resolvePastTabRid(item, ctx);
}

// 팬 탭 시퀀스에 past 항목을 끼운다: 마지막 룰렛 항목 바로 뒤(룰렛이 없으면 맨 앞).
// 저장된 드래그 순서가 기본(룰렛 → 정가 → 기타)이면 결과는 룰렛 → past → 정가 → 기타.
// past 항목은 드래그 순서에 참여하지 않는다(항상 룰렛 뒤 고정).
export function insertPastAfterRoulettes<T extends { kind: string }>(sequence: readonly T[], pastItems: readonly T[]): T[] {
  if (pastItems.length === 0) return [...sequence];
  let lastRoulette = -1;
  sequence.forEach((s, i) => {
    if (s.kind === "roulette") lastRoulette = i;
  });
  const head = sequence.slice(0, lastRoulette + 1);
  const tail = sequence.slice(lastRoulette + 1);
  return [...head, ...pastItems, ...tail];
}
