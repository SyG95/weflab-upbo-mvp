const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { monthlyViewers, allocateFanMonthly } = require('../lib/fanMonthly.ts');
const { selectVisibleFanTabs } = require('../lib/fanVisibleTabs.ts');

const ref = (entryId, month, quantity) => ({ entryId, itemName: '상품', probability: 1, amountRangeLabel: '33', quantity, recordedAtMs: Date.parse(`${month}-15T12:00:00+09:00`), recordedKind: 'donate' });
const august = ref('august', '2026-08', 2);
const september = ref('september', '2026-09', 3);
const owner = { key: 'fan', ownerId: 'fan', ownerName: '시청자', items: [august, september], total: 5, maxProb: 1 };
const allocation = allocateFanMonthly([owner], [{ fanId: 'fan', itemKey: '상품@@1@@33', itemName: '상품', processedCount: 2 }]);
const group = (key, refs, month, mode = 'remaining', status = 'all') => ({ key, label: key, viewers: monthlyViewers([{ ...owner, items: refs }], allocation, month, mode, status) });
const keys = result => result.visibleGroups.map(g => g.key);

// Month filtering removes a historical tab and stale selection falls back.
const augustOnly = group('old', [august], '2026-09');
const septemberOnly = group('current', [september], '2026-09');
const mixed = selectVisibleFanTabs([augustOnly, septemberOnly], 'old');
assert.deepEqual(keys(mixed), ['current']);
assert.equal(mixed.activeGroup, septemberOnly);

// All completed under remaining mode, or an entirely empty month, has no tabs.
assert.deepEqual(selectVisibleFanTabs([group('done', [august], '2026-08')], 'done'), { visibleGroups: [], activeGroup: undefined });
assert.deepEqual(keys(selectVisibleFanTabs([group('empty', [august, september], '2026-07')])), []);
assert.deepEqual(keys(selectVisibleFanTabs([{ key: 'invalid', viewers: [{ items: [] }] }])), []);

// Mixed month keeps the partial tab with remaining rows, preserving identity/order.
const mixedGroup = group('mixed', [august, september], 'all');
assert.equal(selectVisibleFanTabs([mixedGroup], 'mixed').activeGroup, mixedGroup);
assert.equal(mixedGroup.viewers[0].items[0].count, 3);
const another = { ...septemberOnly, key: 'another' };
assert.deepEqual(keys(selectVisibleFanTabs([septemberOnly, another], 'another')), ['current', 'another']);
assert.equal(selectVisibleFanTabs([septemberOnly, another], 'another').activeGroup, another);

// Delivery settings remain authoritative: off ignores completion/status; marked
// completed rows and zero-remaining done indicators are displayable history.
for (const mode of ['off', 'mark', 'remaining_done']) {
  assert.deepEqual(keys(selectVisibleFanTabs([group(mode, [august], '2026-08', mode)])), [mode]);
}
assert.deepEqual(keys(selectVisibleFanTabs([group('off', [august], '2026-08', 'off', 'remaining')])), ['off']);
assert.deepEqual(keys(selectVisibleFanTabs([group('marked', [august], '2026-08', 'mark', 'remaining')])), []);
assert.deepEqual(keys(selectVisibleFanTabs([group('completed', [august], '2026-08', 'remaining', 'done')])), ['completed']);

// Input is immutable and a subsequent nickname miss must not alter tab inventory.
const before = JSON.stringify([augustOnly, septemberOnly]);
selectVisibleFanTabs([augustOnly, septemberOnly], 'missing');
assert.equal(JSON.stringify([augustOnly, septemberOnly]), before);
const searchResult = mixed.activeGroup.viewers.filter(v => v.fanNickname.includes('없는닉네임'));
assert.equal(searchResult.length, 0);
assert.deepEqual(keys(mixed), ['current']);

// keepEmpty (2026-09-21 B3): 월을 골랐을 때 빈 탭을 흐리게 남기고, 요청 탭이 비어도 튕기지 않는다.
const withAny = (g, anyViewers) => ({ ...g, anyViewers });
// (1) 이 달에는 비었지만 전체 기간에는 기록이 있는 탭은 남는다(순서 유지). keepEmpty=false 면 종전대로 숨김.
const keptBoth = selectVisibleFanTabs([withAny(augustOnly, true), withAny(septemberOnly, true)], 'current', true);
assert.deepEqual(keys(keptBoth), ['old', 'current']);
assert.equal(keptBoth.activeGroup.key, 'current');
assert.deepEqual(keys(selectVisibleFanTabs([withAny(augustOnly, true), withAny(septemberOnly, true)], 'current')), ['current'], 'keepEmpty 기본값은 종전 동작');
// (2) 요청한 탭이 이 달에 비어 있어도 그 탭이 활성으로 남는다(첫 탭으로 튕기지 않음). 요청 탭이 없으면 기록 있는 탭 우선.
const stayEmpty = selectVisibleFanTabs([withAny(augustOnly, true), withAny(septemberOnly, true)], 'old', true);
assert.equal(stayEmpty.activeGroup.key, 'old');
assert.equal(stayEmpty.activeGroup.viewers.length, 0);
const noRequest = selectVisibleFanTabs([withAny(augustOnly, true), withAny(septemberOnly, true)], undefined, true);
assert.equal(noRequest.activeGroup.key, 'current', '요청 없음 → 기록 있는 첫 탭');
const allEmpty = selectVisibleFanTabs([withAny(augustOnly, true), withAny(group('other-old', [august], '2026-09'), true)], 'missing', true);
assert.equal(allEmpty.activeGroup.key, 'old', '전부 비면 첫 탭');
// (3) anyViewers=false(전체 기간에도 없음)·누락은 keepEmpty 여도 숨긴다.
assert.deepEqual(keys(selectVisibleFanTabs([withAny(augustOnly, false), withAny(septemberOnly, true)], 'old', true)), ['current']);
assert.deepEqual(keys(selectVisibleFanTabs([augustOnly, septemberOnly], 'old', true)), ['current'], 'anyViewers 누락 = 숨김');
assert.deepEqual(keys(selectVisibleFanTabs([{ key: 'invalid', viewers: [{ items: [] }], anyViewers: false }], 'invalid', true)), []);
assert.deepEqual(selectVisibleFanTabs([withAny(group('done', [august], '2026-08'), false)], 'done', true), { visibleGroups: [], activeGroup: undefined });
// keepEmpty 도 입력 불변.
const beforeKeep = JSON.stringify([augustOnly, septemberOnly]);
selectVisibleFanTabs([withAny(augustOnly, true), withAny(septemberOnly, true)], 'old', true);
assert.equal(JSON.stringify([augustOnly, septemberOnly]), beforeKeep);
console.log('fan-visible-tabs: empty month, completion modes, fallback, search independence, and keepEmpty passed');
