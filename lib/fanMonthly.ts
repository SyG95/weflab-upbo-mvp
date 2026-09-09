import { allocateDeliveryToRefs, normalizeAccountId, type AggItem, type DeliveryAssignment, type DeliveryProgressItem, type FanDeliveryReflect, type HoldingItem, type ViewerHolding, type ViewerSummary } from './api';
import { resolveBucketId } from './deliveryPeriod';

export const MONTHLY = { mode: 'monthly' as const, cutoffs: [] };
export type MonthlyStatus = 'all' | 'remaining' | 'done';
export type MonthlyTotal = { quantity: number; delivered: number; remaining: number };
export function normalizeMonth(value?: string): string {
  return value === 'etc' || /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? '') ? value! : 'all';
}
export function monthOf(item: HoldingItem): string {
  return resolveBucketId(MONTHLY, item.recordedAtMs, item.recordedKind).replace(/^m:/, '');
}
const itemKey = (item: HoldingItem) => `${item.itemName}@@${item.probability}@@${item.amountRangeLabel ?? ''}`;

// Allocate once across all dates, exact owner/item/set keys, BEFORE month/tab/search filters.
export function allocateFanMonthly(holdings: ViewerHolding[], progress: DeliveryProgressItem[], assignments: DeliveryAssignment[] = [], hidden: ViewerHolding[] = []) {
  const result = new Map<HoldingItem, number>();
  const counts = new Map(progress.map(p => [`${normalizeAccountId(p.fanId)}\u0000${p.itemKey}`, p.processedCount]));
  for (const owner of hidden) for (const item of owner.items) {
    const k = `${owner.key}\u0000${itemKey(item)}`;
    counts.set(k, Math.max(0, (counts.get(k) ?? 0) - item.quantity));
  }
  const hints = new Map<string, Record<string, { doneCount: number; doneAt: string }>>();
  for (const a of assignments) {
    const k = `${a.ownerKey}\u0000${a.itemKey}`;
    if (!hints.has(k)) hints.set(k, {});
    hints.get(k)![a.entryId] = a;
  }
  for (const owner of holdings) {
    const groups = new Map<string, HoldingItem[]>();
    for (const item of owner.items) {
      const k = itemKey(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(item);
    }
    for (const [k, refs] of groups) {
      const key = `${owner.key}\u0000${k}`;
      const allocated = allocateDeliveryToRefs(refs, counts.get(key) ?? 0, hints.get(key) ?? {});
      refs.forEach((ref, i) => result.set(ref, allocated[i].allocated));
    }
  }
  return result;
}

export function summarizeMonth(holdings: ViewerHolding[], allocated: Map<HoldingItem, number>, month = 'all'): MonthlyTotal {
  let quantity = 0, delivered = 0;
  for (const owner of holdings) for (const item of owner.items) {
    if (month !== 'all' && monthOf(item) !== month) continue;
    quantity += item.quantity;
    delivered += allocated.get(item) ?? 0;
  }
  return { quantity, delivered, remaining: quantity - delivered };
}

export function monthlyViewers(holdings: ViewerHolding[], allocated: Map<HoldingItem, number>, month: string, mode: FanDeliveryReflect, status: MonthlyStatus): ViewerSummary[] {
  const result: ViewerSummary[] = [];
  for (const owner of holdings) {
    const items = new Map<string, AggItem>();
    for (const item of owner.items) {
      if (month !== 'all' && monthOf(item) !== month) continue;
      const delivered = mode === 'off' ? 0 : allocated.get(item) ?? 0;
      const fixed = item.amountRangeLabel === '정가';
      const k = `${item.itemName}@@${fixed ? '정가' : ''}`;
      const current = items.get(k) ?? { itemName: item.itemName, probability: item.probability, count: 0, delivered: 0, amountRangeLabel: fixed ? '정가' : undefined };
      current.count += item.quantity;
      current.delivered = (current.delivered ?? 0) + delivered;
      current.probability = Math.max(current.probability, item.probability);
      items.set(k, current);
    }
    const shown = [...items.values()].flatMap(item => {
      if (mode !== 'off' && status === 'remaining' && item.count <= (item.delivered ?? 0)) return [];
      if (mode !== 'off' && status === 'done' && item.count > (item.delivered ?? 0)) return [];
      if (mode === 'off') { const clean = { ...item }; delete clean.delivered; return [clean]; }
      if (mode === 'mark' || status === 'done') return [item];
      const remaining = item.count - (item.delivered ?? 0);
      if (mode === 'remaining' && remaining <= 0) return [];
      return [{ ...item, count: remaining, delivered: undefined, done: remaining === 0 }];
    }).sort((a,b) => b.probability-a.probability || b.count-a.count);
    if (!shown.length) continue;
    result.push({ key: owner.key, fanId: owner.ownerId, fanNickname: owner.ownerName, items: shown, total: shown.reduce((n,i)=>n+i.count,0), maxProb: Math.max(...shown.map(i=>i.probability)) });
  }
  return result.sort((a,b) => b.maxProb-a.maxProb || b.total-a.total || a.fanNickname.localeCompare(b.fanNickname));
}
