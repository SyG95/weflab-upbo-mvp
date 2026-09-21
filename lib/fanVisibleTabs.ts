/** A tab is visible only if its already-filtered viewers contain a displayable row.
 * Apply after month/status/delivery filtering, but before nickname search.
 * Do not infer visibility from counts: remaining_done deliberately displays zero
 * remaining rows, and delivery reflection off deliberately ignores completion.
 *
 * keepEmpty (2026-09-21 B3, 월을 골랐을 때만 호출측이 켠다): 이 달에는 비었지만 전체 기간에는
 * 기록이 있는 탭(`anyViewers`)을 숨기지 않고 남긴다 — 달을 바꿔도 탭이 사라지거나 첫 탭으로
 * 튕기지 않는다. 요청한 탭이 비어 있어도 그 탭을 그대로 활성으로 둔다. keepEmpty=false(기본)면
 * 종전 동작과 100% 같다(월 = 전체 기간일 때의 불변 조건).
 */
export function selectVisibleFanTabs<
  T extends { key: string; viewers: ReadonlyArray<{ items: readonly unknown[] }>; anyViewers?: boolean },
>(groups: readonly T[], requestedKey?: string, keepEmpty = false) {
  const hasRows = (group: T) => group.viewers.some(viewer => viewer.items.length > 0);
  if (!keepEmpty) {
    const visibleGroups = groups.filter(hasRows);
    const activeGroup = visibleGroups.find(group => group.key === requestedKey) ?? visibleGroups[0];
    return { visibleGroups, activeGroup };
  }
  const visibleGroups = groups.filter(group => hasRows(group) || group.anyViewers === true);
  const activeGroup =
    visibleGroups.find(group => group.key === requestedKey) ??
    visibleGroups.find(hasRows) ??
    visibleGroups[0];
  return { visibleGroups, activeGroup };
}
