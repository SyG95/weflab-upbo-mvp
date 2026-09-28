// 배송관리 표시 전용 집계(lib/deliverySummary) — 여올 상품별 잔여 칩 + 포로미 완료 월 숨김.
// 핵심 보장: ① 같은 상품의 세트(확률 다름)는 하나로 합치고 정가만 따로  ② 숫자 = 넘겨준 줄의 합(재계산 없음)
//           ③ 잔여 0 달은 숨기되 선택한 달은 절대 숨기지 않음  ④ 빈 달·일부 완료 달은 그대로 보임
import { splitMonthGroups, summarizeProducts } from '../lib/deliverySummary';

let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

const row = (itemName: string, quantity: number, allocated: number, amountRangeLabel?: string) => ({
  it: { itemName, amountRangeLabel },
  ref: { quantity },
  alloc: { allocated },
});

// ── 상품별 요약 ──
assertEq(summarizeProducts([]), [], '빈 줄 → 빈 요약');

const chips = summarizeProducts([
  row('❤️A단컷', 3, 1, '33~330'), // 세트 33
  row('❤️A단컷', 2, 0, '330'), // 세트 330 — 같은 상품으로 합침
  row('방셀', 1, 0),
  row('방셀', 1, 1, '정가'), // 정가 기록은 따로
  row('역구독', 4, 4),
]);
assertEq(
  chips.map((c) => [c.name, c.isFixed, c.total, c.done, c.remain]),
  [
    ['❤️A단컷', false, 5, 1, 4],
    ['방셀', false, 1, 0, 1],
    ['역구독', false, 4, 4, 0],
    ['방셀', true, 1, 1, 0],
  ],
  '세트 합산·정가 분리·잔여 많은 순(동률은 총량 많은 순 → 이름순)',
);
assertEq(chips[1].key !== chips[3].key, true, '정가 키는 룰렛 키와 다름');

assertEq(
  summarizeProducts([row('b', 1, 0), row('a', 1, 0)]).map((c) => c.name),
  ['a', 'b'],
  '잔여·총량 동률이면 이름순',
);

// ── 완료된 달 숨기기 ──
const groups: Array<[string, ReturnType<typeof row>[]]> = [
  ['2026-06', [row('x', 2, 2)]], // 전량 완료 → 숨김
  ['2026-07', [row('x', 2, 1)]], // 일부 완료 → 보임
  ['2026-08', [row('x', 1, 1), row('y', 3, 3)]], // 전량 완료 → 숨김
  ['2026-09', [row('x', 1, 0)]], // 미완료 → 보임
  ['etc', [row('x', 1, 1)]], // 기타도 같은 규칙
];

const a = splitMonthGroups(groups, '2026-09');
assertEq(a.shown.map(([m]) => m), ['2026-07', '2026-09'], '잔여 0 달(6·8월·기타)은 숨김');
assertEq(a.hidden.map(([m]) => m), ['2026-06', '2026-08', 'etc'], '숨긴 달 목록(순서 유지)');

const b = splitMonthGroups(groups, '2026-08');
assertEq(b.shown.map(([m]) => m), ['2026-07', '2026-08', '2026-09'], '보고 있는 달은 잔여 0이어도 절대 숨기지 않음');
assertEq(b.hidden.map(([m]) => m), ['2026-06', 'etc'], '선택한 달만 예외');

const c = splitMonthGroups(groups, 'all');
assertEq(c.hidden.length, 3, '"전체" 선택 중엔 잔여 0 달 전부 숨김 후보');

assertEq(splitMonthGroups([], '2026-09'), { shown: [], hidden: [] }, '달 없음');
assertEq(
  splitMonthGroups([['2026-05', []]], '2026-09').shown.map(([m]) => m),
  ['2026-05'],
  '줄이 없는 달(자리표시)은 숨기지 않음',
);

console.log(`delivery-summary: ${passed} checks passed`);
