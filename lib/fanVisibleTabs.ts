/** A tab is visible only if its already-filtered viewers contain a displayable row.
 * Apply after month/status/delivery filtering, but before nickname search.
 * Do not infer visibility from counts: remaining_done deliberately displays zero
 * remaining rows, and delivery reflection off deliberately ignores completion.
 */
export function selectVisibleFanTabs<
  T extends { key: string; viewers: ReadonlyArray<{ items: readonly unknown[] }> },
>(groups: readonly T[], requestedKey?: string) {
  const visibleGroups = groups.filter(group => group.viewers.some(viewer => viewer.items.length > 0));
  const activeGroup = visibleGroups.find(group => group.key === requestedKey) ?? visibleGroups[0];
  return { visibleGroups, activeGroup };
}
