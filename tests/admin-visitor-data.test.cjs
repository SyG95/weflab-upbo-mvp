const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// 실제 읽기 어댑터 대신 canary가 섞인 입력만 주입한다. DB/환경변수/네트워크를 사용하지 않는다.
function loadVisitorData(loaders) {
  const filename = path.resolve(__dirname, '../lib/adminVisitorData.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.require = (name) => {
    assert.equal(name, './adminDashboard', 'unexpected dependency must not load a real DB adapter');
    return loaders;
  };
  compiled._compile(code, filename);
  return compiled.exports;
}

const CANARY = 'PRIVATE-CANARY-never-return';
const privateFields = {
  fanNickname: CANARY, fanId: CANARY, rawText: CANARY, sourceKey: CANARY,
  raw: { secret: CANARY }, results: [CANARY], reflections: [CANARY], deliveryProgress: [CANARY],
  token: CANARY, password: CANARY, pin: CANARY, ip: CANARY,
  sourceUrl: CANARY, currentUrl: CANARY, notes: [CANARY], futurePrivateField: { nested: CANARY },
};
const forbiddenKeys = new Set(Object.keys(privateFields));

function assertPublicOnly(value) {
  if (typeof value === 'string') assert.ok(!value.includes(CANARY), 'private canary escaped');
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!forbiddenKeys.has(key), `private field escaped: ${key}`);
    assertPublicOnly(nested);
  }
}

function fixtureDashboard() {
  return {
    ...privateFields,
    source: 'live', slug: 'demo', displayName: '공개 시트', thresholdPercent: 2, currentCatalogVersion: 3,
    counts: { ...privateFields, batches: 2, catalogs: 1, rawResults: 10, record: 4, ignore: 2, duplicate: 3, needsReview: 1, reflections: 4 },
    batches: [{
      ...privateFields, id: CANARY, catalogVersion: 3, thresholdPercent: 2, appliedAt: '2026-11-02T12:30:00+09:00',
      capturedAt: CANARY, entryCount: 4, clientVersion: CANARY, rawAvailable: true,
      officialSummary: { ...privateFields, totalResults: 10, recordCount: 4, effectiveRecordCount: 5, ignoreCount: 2, duplicateCount: 3, needsReviewCount: 1 },
      rederivedSummary: { sourceKey: CANARY },
    }],
    catalogs: [{
      ...privateFields, version: 3, isCurrent: true, capturedAt: '2026-11-01T00:00:00.000Z', groupCount: 2, itemCount: 7,
      warnings: [CANARY], probabilitySums: [{ secret: CANARY }], groups: [{ items: [{ fanId: CANARY }] }],
    }],
  };
}

test('index copies only public summary fields; new nested/private fields never escape', async () => {
  const sourceRow = { ...privateFields, slug: 'demo', displayName: '공개 시트', recordSum: 8, needsReviewSum: 2,
    lastAppliedAt: '2026-11-02T12:30:00+09:00', extension: { notes: [CANARY], currentUrl: CANARY } };
  const before = JSON.stringify(sourceRow);
  const api = loadVisitorData({ getAdminIndex: async () => ({ ok: true, streamers: [sourceRow] }) });
  const result = await api.getVisitorIndex();
  assert.deepEqual(result, { ok: true, streamers: [{ slug: 'demo', displayName: '공개 시트', recordSum: 8,
    needsReviewSum: 2, lastAppliedAt: '2026-11-02T03:30:00.000Z' }] });
  assertPublicOnly(result);
  assert.equal(JSON.stringify(sourceRow), before, 'source must remain unchanged');
});

test('dashboard copies nested official counts/catalog metadata, never original rows or inherited metadata', async () => {
  const source = fixtureDashboard();
  const before = JSON.stringify(source);
  const api = loadVisitorData({ getAdminDashboardData: async (slug) => {
    assert.equal(slug, 'demo'); return { ok: true, data: source };
  } });
  const result = await api.getVisitorDashboardData('demo');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), ['catalogs','counts','currentCatalogVersion','displayName','recentBatches','slug','thresholdPercent']);
  assert.deepEqual(result.data.counts, { batches: 2, catalogs: 1, record: 4, ignore: 2, duplicate: 3, needsReview: 1, recordedEntries: 4 });
  assert.deepEqual(result.data.recentBatches, [{ catalogVersion: 3, entryCount: 4,
    officialSummary: { totalResults: 10, recordCount: 4, effectiveRecordCount: 5, ignoreCount: 2, duplicateCount: 3, needsReviewCount: 1 },
    appliedAt: '2026-11-02T03:30:00.000Z' }]);
  assert.deepEqual(result.data.catalogs, [{ version: 3, isCurrent: true, groupCount: 2, itemCount: 7, capturedAt: '2026-11-01T00:00:00.000Z' }]);
  assertPublicOnly(result);
  assert.equal(JSON.stringify(source), before, 'source must remain unchanged');
});

test('wrongly typed allowed fields cannot smuggle private nested objects', async () => {
  const source = fixtureDashboard();
  source.displayName = { fanId: CANARY };
  source.thresholdPercent = { raw: CANARY };
  source.counts.record = { fanNickname: CANARY };
  source.batches[0].entryCount = { password: CANARY };
  source.batches[0].officialSummary.totalResults = { sourceKey: CANARY };
  source.batches[0].officialSummary.effectiveRecordCount = { token: CANARY };
  source.batches[0].appliedAt = CANARY;
  source.catalogs[0].version = { sourceUrl: CANARY };
  source.catalogs[0].capturedAt = { ip: CANARY };
  const api = loadVisitorData({ getAdminDashboardData: async () => ({ ok: true, data: source }) });
  const result = await api.getVisitorDashboardData('demo');
  assert.equal(result.ok, true);
  assert.equal(result.data.displayName, 'demo');
  assert.equal(result.data.counts.record, 0);
  assert.equal(result.data.recentBatches[0].officialSummary.effectiveRecordCount, undefined);
  assert.equal(result.data.recentBatches[0].appliedAt, undefined);
  assert.equal(result.data.catalogs[0].capturedAt, undefined);
  assertPublicOnly(result);
});

test('bounds recent detail lists without mutating complete source arrays', async () => {
  const source = fixtureDashboard();
  source.batches = Array.from({ length: 25 }, (_, i) => ({ ...source.batches[0], catalogVersion: 25 - i }));
  source.catalogs = Array.from({ length: 25 }, (_, i) => ({ ...source.catalogs[0], version: 25 - i }));
  const api = loadVisitorData({ getAdminDashboardData: async () => ({ ok: true, data: source }) });
  const result = await api.getVisitorDashboardData('demo');
  assert.equal(result.data.recentBatches.length, 20);
  assert.equal(result.data.catalogs.length, 20);
  assert.equal(source.batches.length, 25);
  assert.equal(source.catalogs.length, 25);
  assert.equal(result.data.recentBatches[19].catalogVersion, 6);
  assertPublicOnly(result);
});

test('loader failure results and exceptions return one fixed Korean error, never underlying diagnostics', async () => {
  const expected = { ok: false, message: '관제 현황을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.' };
  for (const loader of [async () => ({ ok: false, reason: CANARY, message: CANARY }), async () => { throw new Error(CANARY); }]) {
    const api = loadVisitorData({ getAdminIndex: loader, getAdminDashboardData: loader });
    assert.deepEqual(await api.getVisitorIndex(), expected);
    assert.deepEqual(await api.getVisitorDashboardData('demo'), expected);
  }
});

test('invalid slug never calls the source; a mismatched source slug never returns another sheet', async () => {
  let called = 0;
  const source = fixtureDashboard();
  source.slug = 'another-sheet';
  const api = loadVisitorData({ getAdminDashboardData: async () => { called += 1; return { ok: true, data: source }; } });
  assert.equal((await api.getVisitorDashboardData('../admin')).ok, false);
  assert.equal(called, 0);
  assert.equal((await api.getVisitorDashboardData('demo')).ok, false);
  assert.equal(called, 1);
});
