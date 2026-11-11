// 관문 2 — 후원 시점 근사 다시판정 "눌러 넣기" 계약(PHASE1-TEST-PLAN §4-1, 방식 C: 가짜 PostgREST).
// 가짜 PostgREST: unique(streamer_id, source_key) + ON CONFLICT DO NOTHING + return=representation(실제 삽입 행만) + 1,000행 상한
// + 실패 흉내(계획 장부·넣기 묶음) + 동시 쓰기 장벽.
// 데이터는 전부 합성(tests/fixtures/donationTimeSynthetic.ts — 실명·계정ID 0).
import test from "node:test";
import assert from "node:assert/strict";
import { SYNTH_RAW_IMPORTS, SYNTH_STREAMER, SYNTH_TABLES } from "./fixtures/donationTimeSynthetic";
import { startFakePostgrest, type FakePostgrest } from "./fixtures/fakePostgrest";
import { approxCursorOf, approxSelection, carryApproxPicks, isApproxRowPicked, isInsertableApproxRow, type ApproxCursor } from "../lib/rejudgeApplySelection";
import { approxOriginOf, REJUDGE_APPROX_PLANNED_ACTION } from "../lib/rejudgeRevert";
import { normalizeCatalogCapture } from "../lib/upboCore";

type Row = Record<string, unknown>;
type Lib = typeof import("../lib/upboSupabase");
type Preview = Awaited<ReturnType<Lib["previewDonationTimeRejudgeForStreamer"]>>;
type StreamerArg = Parameters<Lib["previewDonationTimeRejudgeForStreamer"]>[0];

const STREAMER = SYNTH_STREAMER as unknown as StreamerArg;
const SID = SYNTH_STREAMER.id;
let fake: FakePostgrest;
let lib: Lib;

test.before(async () => {
  fake = await startFakePostgrest({ upbo_entries: [["streamer_id", "source_key"]] });
  process.env.SUPABASE_URL = fake.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  lib = await import("../lib/upboSupabase");
});

test.after(async () => {
  await fake.close();
});

const mainRows = (p: Preview) => p.rows.filter((r) => r.kind !== "outside");
const lastCursor = (p: Preview): ApproxCursor => approxCursorOf(mainRows(p).at(-1)!);
const newKeys = (p: Preview) => p.rows.filter((r) => isInsertableApproxRow(r)).map((r) => r.sourceKey);
const statusOf = (error: unknown) => (error as { status?: number }).status;

async function freshPreview(tables: Record<string, unknown[]> = SYNTH_TABLES): Promise<Preview> {
  fake.reset(tables);
  const p = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  fake.writes.length = 0; // 미리보기의 미처리 수 기록 1줄은 관문 1 몫 — 넣기 쓰기만 본다
  return p;
}

function apply(p: Preview, sourceKeys: string[], seenThrough: ApproxCursor = lastCursor(p), fingerprint = p.planFingerprint) {
  return lib.applyApproxRejudgeForStreamer(STREAMER, { fingerprint, rawUntil: p.rawUntil!, seenThrough, sourceKeys });
}

const entryWrites = () => fake.writes.filter((w) => w.table === "upbo_entries");
const planWrites = () =>
  fake.writes.filter((w) => w.table === "audit_logs" && (w.body as Row).action === REJUDGE_APPROX_PLANNED_ACTION);
type PlanPayload = { runId: string; chunk: number; at: string; v: number; entryIds: string[] };
const planPayload = (w: { body: unknown }) => (w.body as Row).payload as PlanPayload;

test("미리보기가 계획 지문을 싣고, 판정 재료가 바뀌면 넣기는 409 + 쓰기 0", async () => {
  const p = await freshPreview();
  assert.match(p.planFingerprint, /^[0-9a-f]{16}$/);
  assert.notEqual(p.planFingerprint, p.inputFingerprint, "계획 지문은 판정 지문에 판(v)을 얹은 별도 값");
  // 미리보기 뒤 금액대 기준 예외가 바뀌었다(판정 재료)
  fake.db.audit_logs.push({
    id: "5e1f0000-0000-4000-8000-0000000009f1",
    streamer_id: SID,
    action: "threshold_overrides_updated",
    created_at: "2026-10-27T00:00:00.000Z",
    payload: { overrides: { "170": 30 } },
  });
  await assert.rejects(apply(p, newKeys(p)), (e) => statusOf(e) === 409 && /판정 기준이 바뀌었어요/.test((e as Error).message));
  assert.deepEqual(fake.writes, [], "지문이 다르면 아무것도 안 쓴다");
  // 지문 글자 자체가 다른 경우도 같다
  const q = await freshPreview();
  await assert.rejects(apply(q, newKeys(q), lastCursor(q), "0000000000000000"), (e) => statusOf(e) === 409);
  assert.deepEqual(fake.writes, []);
});

test("12건 요청 중 2건이 이미 있으면 inserted 10 · alreadyExisted 2, 계획 장부(넣기 전)엔 넣을 10개 id만·결과 키 없음", async () => {
  const p = await freshPreview();
  const keys = newKeys(p);
  assert.equal(keys.length, 11, "합성 데이터: 새로 기록될 것 🟢3+🟡8");
  const existing = "synth0001::0"; // 미리보기 때 이미 기록돼 있던 결과
  assert.ok(fake.db.upbo_entries.some((e) => e.source_key === existing));
  // 미리보기 뒤 실시간 수집이 새 후보 하나를 먼저 넣었다(지문은 그대로 — 판정 재료가 아님)
  fake.db.upbo_entries.push({ ...fake.db.upbo_entries[0], id: "5e1f0000-0000-4000-8000-0000000007a1", source_key: keys[0], admin_note: "" });
  const out = await apply(p, [...keys, existing]);
  assert.equal(out.requested, 12);
  assert.equal(out.inserted, 10);
  assert.equal(out.alreadyExisted, 2);
  assert.equal(out.insertedEntryIds.length, 10);
  const plans = planWrites();
  assert.equal(plans.length, 1);
  assert.ok(fake.writes.indexOf(plans[0]) < fake.writes.findIndex((w) => w.table === "upbo_entries"), "계획 장부가 넣기보다 먼저");
  const payload = planPayload(plans[0]);
  assert.equal(payload.runId, out.runId);
  assert.equal(payload.chunk, 0);
  assert.deepEqual(new Set(payload.entryIds), new Set(out.insertedEntryIds));
  assert.deepEqual(Object.keys(payload).sort(), ["at", "chunk", "entryIds", "runId", "v"]);
  const text = JSON.stringify((plans[0].body as Row).payload);
  for (const key of [...keys, existing]) assert.ok(!text.includes(key), "장부에 결과 키(계정 ID 포함)를 넣지 않는다");
  // 장부 id 는 실제로 들어간 행의 id
  const stored = new Set(fake.db.upbo_entries.filter((e) => approxOriginOf(e.admin_note as string)?.runId === out.runId).map((e) => e.id));
  assert.deepEqual(stored, new Set(out.insertedEntryIds));
});

test("동시에 두 번 눌러도 합계 = 고유 키 수(두 번째는 '이미 있음'으로 정직하게 센다)", async () => {
  const p = await freshPreview();
  const keys = newKeys(p);
  // 두 요청이 둘 다 "아직 없음"으로 계산한 뒤 쓰기가 겹치게 붙잡는다 — DB unique + DO NOTHING 이 막아야 한다.
  fake.setPostBarrier("upbo_entries", 2);
  const [x, y] = await Promise.all([apply(p, keys), apply(p, keys)]);
  assert.ok(x.inserted === 0 || y.inserted === 0, "겹친 두 번째 쓰기는 하나도 안 들어간다");
  assert.equal(x.inserted + y.inserted, keys.length);
  assert.equal(x.inserted + x.alreadyExisted, keys.length);
  assert.equal(y.inserted + y.alreadyExisted, keys.length);
  const bySource = new Map<string, number>();
  for (const e of fake.db.upbo_entries) bySource.set(String(e.source_key), (bySource.get(String(e.source_key)) ?? 0) + 1);
  assert.ok([...bySource.values()].every((n) => n === 1), "같은 결과 키가 두 줄이 되지 않는다");
});

test("저장 값: (판정 버전·그 버전 칸·라벨·그 표 확률) 한 세트, 원문 이름, pending, batch null, 원본 행 id, 실행 시각 공통, admin_note 는 origin 만", async () => {
  const p = await freshPreview();
  const rowsByKey = new Map(p.rows.map((r) => [r.sourceKey, r]));
  const keys = newKeys(p);
  const before = Date.now();
  const out = await apply(p, keys);
  const inserted = fake.db.upbo_entries.filter((e) => out.insertedEntryIds.includes(String(e.id)));
  assert.equal(inserted.length, keys.length);
  for (const e of inserted) {
    const row = rowsByKey.get(String(e.source_key))!;
    assert.equal(e.catalog_version, row.judged.version);
    assert.equal(e.catalog_group_index, row.judged.groupIndex);
    assert.equal(e.amount_range_label, row.judged.amountRangeLabel);
    assert.equal(e.probability, row.judged.probability, "그 표 칸의 확률");
    assert.equal(e.item_name, row.judged.storeItemName);
    assert.equal(e.status, "pending");
    assert.equal(e.batch_id, null);
    assert.equal(e.created_at, out.at, "실행 시각 공통");
    assert.equal(e.updated_at, out.at);
    assert.ok(Date.parse(String(e.created_at)) >= before - 1000, "후원 시각으로 꾸미지 않는다");
    assert.equal(e.donate_time_text, row.donateTimeText, "후원 시각은 원문 그대로");
    const note = JSON.parse(String(e.admin_note));
    assert.deepEqual(Object.keys(note), ["origin"], "admin_note 는 origin 하나(배수·수량 키 없음 = ×1)");
    assert.deepEqual(note.origin, { kind: "rejudge_approx", runId: out.runId, at: out.at, v: 1 });
  }
  // 원본 행 id: synth0101 은 묶음 3·4 둘 다에 있다 → 판정에 쓴 첫 모양(묶음 3)
  const r101 = inserted.find((e) => e.source_key === "synth0101::0")!;
  assert.equal(r101.raw_import_id, SYNTH_RAW_IMPORTS[2].id);
  assert.equal(r101.item_name, "사진10장", "원문 상품명");
  // 170 표 칸(그때 예외 45%): 그 표의 확률로 저장
  const r118 = inserted.find((e) => e.source_key === "synth0118::0")!;
  assert.equal(r118.probability, 45);
  assert.equal(r118.amount_range_label, "170");
  // 이름 연결로 맞춘 줄(🟡 G12)은 연결 대상 이름으로 저장(실시간·지금 표로 다시판정과 같은 규칙)
  const r113 = inserted.find((e) => e.source_key === "synth0113::0")!;
  assert.equal(r113.item_name, "하트뿅뿅");
  // 팬 화면 읽기에서도 수량 1
  const state = await lib.getStreamerState(SYNTH_STREAMER.slug);
  for (const id of out.insertedEntryIds) {
    const mapped = state.upboEntries.find((e) => e.id === id)!;
    assert.equal(mapped.effectiveCount, 1);
    assert.equal(mapped.multiplier, 1);
  }
});

test("부수 쓰기 0: 기록 줄과 장부 말고는 아무것도 안 쓴다(정가·쿠폰·두배권 상태·처리 키·원본·배치)", async () => {
  const coupon = [
    { id: "5e1f0000-0000-4000-8000-0000000008c1", streamer_id: SID, action: "coupon_items_updated", created_at: "2026-10-01T00:00:00.000Z", payload: { items: [{ key: "photo", name: "사진권" }] } },
    {
      id: "5e1f0000-0000-4000-8000-0000000008c2",
      streamer_id: SID,
      action: "coupon_source_map_updated",
      created_at: "2026-10-01T00:00:01.000Z",
      payload: { map: [{ itemKey: "photo", sources: [{ itemName: "사진10장", per: 1 }] }] },
    },
  ];
  const p = await freshPreview({ ...SYNTH_TABLES, audit_logs: [...SYNTH_TABLES.audit_logs, ...coupon] });
  const out = await apply(p, newKeys(p));
  assert.ok(out.inserted > 0);
  for (const w of fake.writes) {
    assert.equal(w.method, "POST", `${w.method} ${w.table}`);
    if (w.table === "audit_logs") assert.equal((w.body as Row).action, REJUDGE_APPROX_PLANNED_ACTION);
    else assert.equal(w.table, "upbo_entries");
  }
  assert.ok(!fake.writes.some((w) => /coupon|raw_imports|import_batches|item_events/.test(w.table)));
  assert.ok(!fake.writes.some((w) => w.table === "audit_logs" && ["modifier_state", "signature_counts_updated"].includes(String((w.body as Row).action))));
});

test("쿠폰 연결 상품: 미리보기 줄에 표시, 넣기 응답이 수를 알려 주고 쿠폰은 안 쌓는다", async () => {
  const coupon = [
    { id: "5e1f0000-0000-4000-8000-0000000008c1", streamer_id: SID, action: "coupon_items_updated", created_at: "2026-10-01T00:00:00.000Z", payload: { items: [{ key: "photo", name: "사진권" }] } },
    {
      id: "5e1f0000-0000-4000-8000-0000000008c2",
      streamer_id: SID,
      action: "coupon_source_map_updated",
      created_at: "2026-10-01T00:00:01.000Z",
      payload: { map: [{ itemKey: "photo", sources: [{ itemName: "사진 10장", per: 1 }] }] },
    },
  ];
  const p = await freshPreview({ ...SYNTH_TABLES, audit_logs: [...SYNTH_TABLES.audit_logs, ...coupon] });
  const linked = p.rows.filter((r) => r.couponLinked);
  assert.deepEqual(
    linked.map((r) => r.sourceKey).sort(),
    ["synth0002::0", "synth0101::0", "synth0111::0"],
    "정규화 이름(띄어쓰기 무시)으로 연결된 새 후보만 표시",
  );
  assert.ok(p.rows.filter((r) => r.kind !== "new").every((r) => !r.couponLinked));
  const { keys } = approxSelection(mainRows(p), { "synth0111::0": true });
  const out = await apply(p, keys);
  assert.equal(out.couponLinked, 2);
  assert.ok(!fake.writes.some((w) => w.table.startsWith("coupon")), "자동 적립 안 함(D9)");
});

test("사람이 본 줄까지만: 마지막으로 그린 줄 뒤의 줄·🟠·⚪·모르는 키는 거부(400, 쓰기 0)", async () => {
  const p = await freshPreview();
  const greens = p.rows.filter((r) => r.kind === "new" && r.cls === "green");
  assert.ok(greens.length >= 2);
  // 화면에 첫 🟢 한 줄만 그렸다 → 두 번째 🟢 는 못 넣는다
  const firstOnly = approxCursorOf(greens[0]);
  await assert.rejects(apply(p, [greens[0].sourceKey, greens[1].sourceKey], firstOnly), (e) => statusOf(e) === 400);
  // 그린 줄까지면 들어간다(아래 별도 실행으로 확인) — 거부는 통째로, 앞 줄도 안 들어간다
  assert.deepEqual(fake.writes, []);
  const outside = p.rows.find((r) => r.kind === "outside")!;
  await assert.rejects(apply(p, [outside.sourceKey]), (e) => statusOf(e) === 400);
  await assert.rejects(apply(p, ["synth0103::0"]), (e) => statusOf(e) === 400, "⚪ 제외(기준 초과)");
  await assert.rejects(apply(p, ["nope::0"]), (e) => statusOf(e) === 400);
  assert.deepEqual(fake.writes, []);
  const ok = await apply(p, [greens[0].sourceKey], firstOnly);
  assert.equal(ok.inserted, 1);
});

test("앞쪽 줄이 그사이 기록돼 목록에서 빠져도, 못 본 뒤쪽 줄은 밀려 들어오지 않는다(쪽 번호 대신 줄 위치 표지)", async () => {
  const p = await freshPreview();
  const insertable = p.rows.filter((r) => isInsertableApproxRow(r));
  // 화면에 앞 2줄만 그렸다
  const seen = approxCursorOf(insertable[1]);
  // 그사이 첫 줄이 실시간으로 기록됐다 → 다시 계산한 목록에서 셋째 줄이 둘째 자리로 당겨진다
  fake.db.upbo_entries.push({ ...fake.db.upbo_entries[0], id: "5e1f0000-0000-4000-8000-0000000007a2", source_key: insertable[0].sourceKey, admin_note: "" });
  await assert.rejects(apply(p, [insertable[2].sourceKey], seen), (e) => statusOf(e) === 400);
  const out = await apply(p, [insertable[0].sourceKey, insertable[1].sourceKey], seen);
  assert.equal(out.inserted, 1);
  assert.equal(out.alreadyExisted, 1);
});

test("×N 이 될 수 있는 줄(바로 앞이 두배권)도 ×1 로 저장", async () => {
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "다음 룰렛 2배", probability: 3 }, { name: "사진", probability: 2 }, { name: "하트", probability: 95 }] }],
  }).groups;
  const viewer = { fanId: "viewer51", fanNickname: "시청자51", donationAmount: 33, donationType: "별풍선" };
  const p = await freshPreview({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "5e1f0000-0000-4000-8000-0000000001d1", streamer_id: SID, version: 1, captured_at: "2026-10-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z", groups }],
    audit_logs: [],
    raw_imports: [
      {
        id: "5e1f0000-0000-4000-8000-0000000004d1",
        streamer_id: SID,
        type: "results",
        batch_id: null,
        saved_at: "2026-10-03T00:00:00.000Z",
        raw: {
          rows: [
            { ...viewer, sourceUid: "dbl51a", donateTimeText: "2026-10-02 20:00:00", results: [{ name: "다음 룰렛 2배", probability: 3 }] },
            { ...viewer, sourceUid: "dbl51b", donateTimeText: "2026-10-02 20:01:00", results: [{ name: "사진", probability: 2 }] },
          ],
        },
      },
    ],
    upbo_entries: [],
  });
  const row = p.rows.find((r) => r.sourceKey === "dbl51b::0")!;
  assert.equal(row.cls, "yellow");
  assert.ok(row.reasons.some((t) => t.includes("두배권")), "×2 가능성은 이유로만 보인다");
  const out = await apply(p, [row.sourceKey]);
  assert.equal(out.inserted, 1);
  const stored = fake.db.upbo_entries.find((e) => e.source_key === "dbl51b::0")!;
  assert.deepEqual(Object.keys(JSON.parse(String(stored.admin_note))), ["origin"]);
  const state = await lib.getStreamerState(SYNTH_STREAMER.slug);
  assert.equal(state.upboEntries.find((e) => e.sourceKey === "dbl51b::0")!.effectiveCount, 1);
});

test("500개 묶음: 1,200건이면 계획 장부 3줄(500·500·200)을 넣기 전에 다 쓰고, 넣기도 3번, 자르기 없음", async () => {
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "단컷", probability: 2 }, { name: "하트", probability: 98 }] }],
  }).groups;
  const rows = Array.from({ length: 1200 }, (_, n) => ({
    sourceUid: `bulk${String(n).padStart(5, "0")}`,
    donateTimeText: `2026-10-${String(2 + (n % 20)).padStart(2, "0")} ${String(n % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`,
    donationType: "별풍선",
    donationAmount: 33,
    fanNickname: `시청자${n}`,
    fanId: `viewer${n}`,
    results: [{ name: "단컷", probability: 2 }],
  }));
  const p = await freshPreview({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "5e1f0000-0000-4000-8000-0000000001e1", streamer_id: SID, version: 1, captured_at: "2026-10-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z", groups }],
    audit_logs: [],
    raw_imports: [{ id: "5e1f0000-0000-4000-8000-0000000004e1", streamer_id: SID, type: "results", batch_id: null, saved_at: "2026-10-23T00:00:00.000Z", raw: { rows } }],
    upbo_entries: [],
  });
  assert.equal(p.summary.d, 1200);
  assert.equal(p.pageCount, 1);
  const out = await apply(p, newKeys(p));
  assert.equal(out.inserted, 1200);
  const posts = entryWrites();
  assert.deepEqual(posts.map((w) => (w.body as unknown[]).length), [500, 500, 200]);
  const plans = planWrites();
  assert.deepEqual(plans.map((w) => [planPayload(w).chunk, planPayload(w).entryIds.length]), [
    [0, 500],
    [1, 500],
    [2, 200],
  ]);
  const firstEntryPost = fake.writes.indexOf(posts[0]);
  assert.ok(plans.every((w) => fake.writes.indexOf(w) < firstEntryPost), "계획 장부를 전부 쓴 뒤에 넣는다");
  assert.deepEqual(new Set(plans.flatMap((w) => planPayload(w).entryIds)), new Set(out.insertedEntryIds));
});

test("넣은 뒤 미리보기를 다시 부르면 넣은 줄은 '이미 기록'으로 옮겨 가고 미처리 수 기록이 줄어든다", async () => {
  const p = await freshPreview();
  const { keys } = approxSelection(mainRows(p), {});
  assert.equal(keys.length, p.summary.green, "🟢 만 기본 선택");
  const out = await apply(p, keys);
  fake.writes.length = 0;
  const again = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  assert.equal(again.summary.d, p.summary.d - out.inserted);
  assert.equal(again.summary.a, p.summary.a + out.inserted);
  const snapshot = fake.writes.find((w) => (w.body as Row).action === "missing_preview_snapshot");
  assert.ok(snapshot, "미처리 수 기록이 다시 남는다");
  const remaining = ((snapshot!.body as Row).payload as { remaining: number }).remaining;
  assert.equal(remaining, again.summary.d + again.summary.outside.rows - again.summary.outside.manualOverlap);
  assert.notEqual(again.planFingerprint, "", "판정 재료는 그대로라 같은 계획 지문");
  assert.equal(again.planFingerprint, p.planFingerprint);
});

test("계획 장부를 못 쓰면 아무것도 넣지 않는다(503, 기록 쓰기 0)", async () => {
  const p = await freshPreview();
  fake.setPostFailure((table, body) => table === "audit_logs" && (body as Row)?.action === REJUDGE_APPROX_PLANNED_ACTION);
  await assert.rejects(apply(p, newKeys(p)), (e) => statusOf(e) === 503 && /아무것도 넣지 않았어요/.test((e as Error).message));
  assert.deepEqual(entryWrites(), [], "upbo_entries 쓰기 0");
  assert.equal(fake.db.upbo_entries.filter((e) => approxOriginOf(e.admin_note as string)).length, 0);
});

test("넣기 묶음 2에서 멈추면(502) 1묶음분은 같은 runId 로 실행 목록·되돌리기에 잡힌다", async () => {
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "단컷", probability: 2 }, { name: "하트", probability: 98 }] }],
  }).groups;
  const rows = Array.from({ length: 700 }, (_, n) => ({
    sourceUid: `half${String(n).padStart(5, "0")}`,
    donateTimeText: `2026-10-${String(2 + (n % 20)).padStart(2, "0")} ${String(n % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`,
    donationType: "별풍선",
    donationAmount: 33,
    fanNickname: `시청자${n}`,
    fanId: `viewer${n}`,
    results: [{ name: "단컷", probability: 2 }],
  }));
  const p = await freshPreview({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "5e1f0000-0000-4000-8000-0000000001f1", streamer_id: SID, version: 1, captured_at: "2026-10-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z", groups }],
    audit_logs: [],
    raw_imports: [{ id: "5e1f0000-0000-4000-8000-0000000004f1", streamer_id: SID, type: "results", batch_id: null, saved_at: "2026-10-23T00:00:00.000Z", raw: { rows } }],
    upbo_entries: [],
    upbo_item_events: [],
  });
  fake.setPostFailure((table, _body, n) => table === "upbo_entries" && n === 2);
  await assert.rejects(apply(p, newKeys(p)), (e) => statusOf(e) === 502 && /일부가 들어갔을 수 있어요/.test((e as Error).message));
  fake.setPostFailure(null);
  assert.equal(planWrites().length, 2, "계획 장부는 넣기 전에 2묶음 다 썼다");
  const runId = planPayload(planWrites()[0]).runId;
  const present = fake.db.upbo_entries.filter((e) => approxOriginOf(e.admin_note as string)?.runId === runId);
  assert.equal(present.length, 500, "1묶음만 들어갔다");
  const runs = await lib.approxRejudgeRuns(STREAMER);
  assert.deepEqual(runs.map((r) => [r.runId, r.inserted, r.voided]), [[runId, 500, 0]]);
  const revert = await lib.previewApproxRejudgeRevert(STREAMER, runId);
  assert.equal(revert.targets, 500);
  assert.equal(revert.voidable, 500);
  assert.equal(revert.missing, 200, "계획엔 있지만 안 들어간 200건");
  assert.equal(revert.ledgerMismatch, null);
});

test("미리보기 뒤 실시간 수집 배치가 생겨도 409 가 아니고, 그 배치가 같은 결과를 기록했으면 '이미 있었어요'", async () => {
  const p = await freshPreview();
  const keys = newKeys(p);
  // 미리보기 뒤 실시간 수집 1번: 배치 + 원본(rawUntil 뒤) + 그 원본이 기록한 줄(미리보기의 🟢 하나와 같은 결과)
  fake.db.import_batches.push({ id: "5e1f0000-0000-4000-8000-0000000003f9", streamer_id: SID, catalog_version: 3, threshold_percent: 10, applied_at: "2026-11-11T01:00:00.000Z", captured_at: "2026-11-11T01:00:00.000Z", summary: {}, entry_count: 1, source_url: null });
  fake.db.raw_imports.push({
    id: "5e1f0000-0000-4000-8000-0000000004f9",
    streamer_id: SID,
    type: "results",
    batch_id: "5e1f0000-0000-4000-8000-0000000003f9",
    saved_at: "2026-11-11T01:00:00.100Z",
    raw: { rows: [{ sourceUid: "synth0101", donateTimeText: "2026-10-21 19:12:40", donationAmount: 33, fanId: "viewer01", fanNickname: "시청자01", results: [{ name: "사진10장", probability: 2 }] }] },
  });
  fake.db.upbo_entries.push({ ...fake.db.upbo_entries[0], id: "5e1f0000-0000-4000-8000-0000000007f9", source_key: "synth0101::0", admin_note: "", batch_id: "5e1f0000-0000-4000-8000-0000000003f9" });
  const out = await apply(p, keys);
  assert.equal(out.requested, keys.length);
  assert.equal(out.alreadyExisted, 1);
  assert.equal(out.inserted, keys.length - 1);
});

test("원본 기준 시각(rawUntil) 뒤 배치는 판정 재료·지문에서 빠진다 — 기준%가 다른 배치가 와도 분류·지문이 같다", async () => {
  const p = await freshPreview();
  const shape = (rows: Preview["rows"]) => rows.map((r) => [r.sourceKey, r.kind, r.cls, r.reasons.join("|"), r.judged.threshold].join("~"));
  // 지금까지 어떤 이력에도 없던 기준% 1 인 배치(일부러 엇나간 값) — 포함되면 기준% 후보 최솟값이 바뀌어 분류가 흔들릴 수 있는 재료
  fake.db.import_batches.push({ id: "5e1f0000-0000-4000-8000-0000000003fa", streamer_id: SID, catalog_version: 3, threshold_percent: 1, applied_at: "2026-11-11T02:00:00.000Z", captured_at: "2026-11-11T02:00:00.000Z", summary: {}, entry_count: 0, source_url: null });
  const pinned = await lib.previewDonationTimeRejudgeForStreamer(STREAMER, { rawUntil: p.rawUntil });
  assert.equal(pinned.inputFingerprint, p.inputFingerprint);
  assert.equal(pinned.planFingerprint, p.planFingerprint);
  assert.deepEqual(shape(pinned.rows), shape(p.rows));
  assert.deepEqual(pinned.summary, p.summary);
  // 첫 쪽(rawUntil 없음)도 원본 마지막 저장 시각 기준으로 같은 배치를 거른다
  const fresh = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  assert.equal(fresh.inputFingerprint, p.inputFingerprint);
  // 넣기도 같은 기준이라 기준% 1 배치가 있어도 409 가 아니다
  const out = await apply(p, newKeys(p).slice(0, 1));
  assert.equal(out.inserted, 1);
  // 원본 기준 시각 이전(같은 원본 범위 안)에 배치가 끼어들면 그건 판정 재료라 지문이 바뀐다(거르는 건 기준 시각 뒤만)
  fake.db.import_batches.push({ id: "5e1f0000-0000-4000-8000-0000000003fb", streamer_id: SID, catalog_version: 3, threshold_percent: 10, applied_at: "2026-10-25T13:59:59.999Z", captured_at: "2026-10-25T13:59:59.999Z", summary: {}, entry_count: 0, source_url: null });
  const inside = await lib.previewDonationTimeRejudgeForStreamer(STREAMER, { rawUntil: p.rawUntil });
  assert.notEqual(inside.inputFingerprint, p.inputFingerprint);
});

test("seenThrough 위조: 목록에 없는 키·실제 줄과 다른 분류/시각이면 409(쓰기 0)", async () => {
  const p = await freshPreview();
  const greens = p.rows.filter((r) => r.kind === "new" && r.cls === "green");
  const keys = [greens[0].sourceKey];
  await assert.rejects(apply(p, keys, { o: 3, t: null, k: "made-up::0" }), (e) => statusOf(e) === 409);
  // 실제로 있는 첫 🟢 의 키에 분류만 "오기록 의심(3)"으로 바꿔 범위를 끝까지 넓히려는 요청
  await assert.rejects(apply(p, keys, { ...approxCursorOf(greens[0]), o: 3 }), (e) => statusOf(e) === 409);
  await assert.rejects(apply(p, keys, { ...approxCursorOf(greens[0]), t: null }), (e) => statusOf(e) === 409);
  assert.deepEqual(fake.writes, []);
  const ok = await apply(p, keys, approxCursorOf(greens[0]));
  assert.equal(ok.inserted, 1);
});

test("(순수) rawUntil 뒤 배치가 지금 기준%와 같으면 기준% 후보·그때 기준%가 그대로, 엇나간 값이면 후보가 바뀐다 — 그래서 뺀다", async () => {
  const { buildJudgeHistory, thresholdPercentCandidates, thresholdPercentAtFast, parseDonateTimeMsStrict } = await import("../lib/judgeInputsAt");
  const { SYNTH_CATALOGS, SYNTH_AUDITS, SYNTH_BATCHES, SYNTH_RESULTS } = await import("./fixtures/donationTimeSynthetic");
  const base = { catalogs: SYNTH_CATALOGS, audits: SYNTH_AUDITS, currentThresholdPercent: SYNTH_STREAMER.threshold_percent };
  const later = (threshold: number) => ({ ...SYNTH_BATCHES[0], id: "later", threshold_percent: threshold, applied_at: "2026-11-11T02:00:00.000Z" });
  const before = buildJudgeHistory({ ...base, batches: SYNTH_BATCHES } as never);
  const realistic = buildJudgeHistory({ ...base, batches: [...SYNTH_BATCHES, later(SYNTH_STREAMER.threshold_percent)] } as never);
  const outlier = buildJudgeHistory({ ...base, batches: [...SYNTH_BATCHES, later(1)] } as never);
  const sorted = (h: typeof before) => [...thresholdPercentCandidates(h)].sort((a, b) => a - b);
  assert.deepEqual(sorted(realistic), sorted(before));
  for (const r of SYNTH_RESULTS) {
    const t = parseDonateTimeMsStrict(r.time);
    if (t === null) continue;
    assert.deepEqual(thresholdPercentAtFast(t, realistic), thresholdPercentAtFast(t, before), r.uid);
  }
  assert.notDeepEqual(sorted(outlier), sorted(before), "엇나간 기준%의 뒤 배치는 후보 최솟값을 바꾼다(분류가 흔들릴 수 있는 재료)");
});

test("409 뒤 재미리보기: 그사이 같은 당첨이 수동기록으로 들어와 겹침이 붙은 🟡 는 체크가 풀린다(수동기록과 중복 넣기 방지)", async () => {
  const p = await freshPreview();
  const main = mainRows(p);
  const y = main.find((r) => r.kind === "new" && r.cls === "yellow" && !r.manualOverlap && r.fanId)!;
  const picks = { [y.sourceKey]: true };
  // 미리보기 뒤 스트리머가 같은 당첨을 수동기록으로 넣었다
  fake.db.upbo_entries.push({
    ...fake.db.upbo_entries[0],
    id: "5e1f0000-0000-4000-8000-0000000c0001",
    source_key: "manual:5e1f0000-0000-4000-8000-0000000c0001",
    status: "pending",
    item_name: y.judged.storeItemName,
    fan_id: y.fanId,
    fan_nickname: y.fanNickname,
    donate_time_text: y.donateTimeText,
    admin_note: "",
    created_at: "2026-11-11T00:00:00.000Z",
  });
  const sel = approxSelection(main, picks);
  await assert.rejects(apply(p, sel.keys, sel.seenThrough!), (e) => statusOf(e) === 409, "수동기록은 판정 재료 → 409");
  assert.deepEqual(entryWrites(), []);
  const again = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  const y2 = again.rows.find((r) => r.sourceKey === y.sourceKey)!;
  assert.equal(y2.cls, "yellow", "분류는 그대로");
  assert.ok(y2.manualOverlap, "겹침이 새로 붙었다");
  const carried = carryApproxPicks(p.rows, picks, again.rows);
  assert.equal(isApproxRowPicked(y2, carried), false, "근거가 바뀐 줄의 체크는 풀린다");
  assert.ok(!approxSelection(again.rows.filter((r) => r.kind !== "outside"), carried).keys.includes(y.sourceKey));
});
