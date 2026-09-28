// 배송관리(FinalDeliveryView) 표시 전용 집계 — 장부·저장과 무관한 순수 함수(테스트 대상).
// 입력은 화면이 "지금 보여주는 줄" 그대로다. 따로 다시 계산하지 않아야 표와 요약이 어긋나지 않는다.

export type SummaryRow = {
  it: { itemName: string; amountRangeLabel?: string };
  ref: { quantity: number };
  alloc: { allocated: number };
};

export type ProductChip = {
  key: string;
  name: string;
  // 정가 기록 — 룰렛 세트(33/330 등)는 같은 상품으로 합치되 정가만 구분(DeliveryManager 상품별 목록과 같은 키 규칙).
  isFixed: boolean;
  total: number;
  done: number;
  remain: number;
};

// Node·브라우저 동일 정렬(locale 무관).
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 선택한 시청자의 줄들을 상품별로 합산한다(여올 2026-09-24 "각각 몇 개씩 배송해야 하는지").
// 잔여 많은 순 → 총량 많은 순 → 이름순.
export function summarizeProducts(rows: SummaryRow[]): ProductChip[] {
  const map = new Map<string, ProductChip>();
  for (const r of rows) {
    const isFixed = r.it.amountRangeLabel === '정가';
    const key = `${isFixed ? 'f' : 'r'}@@${r.it.itemName}`;
    const cur = map.get(key);
    if (cur) {
      cur.total += r.ref.quantity;
      cur.done += r.alloc.allocated;
      cur.remain = cur.total - cur.done;
    } else {
      map.set(key, {
        key,
        name: r.it.itemName,
        isFixed,
        total: r.ref.quantity,
        done: r.alloc.allocated,
        remain: r.ref.quantity - r.alloc.allocated,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.remain - a.remain || b.total - a.total || compareText(a.name, b.name));
}

export type MonthGroup<R> = [string, R[]];

// 완료된 달 숨기기(포로미 2026-09-22 "남은 배송이 없으면 월이 사라지면").
// 잔여 0인 달은 hidden 으로 보내되, 지금 보고 있는 달(selected)은 절대 숨기지 않는다 —
// 마지막 건을 완료하고 저장하는 순간 버튼이 사라져 화면이 튀는 일을 막는다. 기록은 그대로, 표시만 나눈다.
export function splitMonthGroups<R extends SummaryRow>(
  groups: MonthGroup<R>[],
  selected: string,
): { shown: MonthGroup<R>[]; hidden: MonthGroup<R>[] } {
  const shown: MonthGroup<R>[] = [];
  const hidden: MonthGroup<R>[] = [];
  for (const g of groups) {
    const [m, rs] = g;
    const remain = rs.reduce((n, r) => n + (r.ref.quantity - r.alloc.allocated), 0);
    if (rs.length > 0 && remain <= 0 && m !== selected) hidden.push(g);
    else shown.push(g);
  }
  return { shown, hidden };
}
