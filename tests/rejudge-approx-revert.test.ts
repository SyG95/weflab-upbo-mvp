// 관문 2 — 후원 시점 근사 넣기 되돌리기(PHASE1-TEST-PLAN §4-2, A 순수 + C 가짜 PostgREST).
// 물리 삭제 없이 void 이벤트만. 막힘 판정(classifyRevertTargets)·장부 대조(ledgerMismatch)·중복 void 방지·void 뒤 재넣기.
// 데이터는 전부 합성(실명·계정ID 0).
import test from "node:test";
import assert from "node:assert/strict";
import { SYNTH_STREAMER, SYNTH_TABLES } from "./fixtures/donationTimeSynthetic";
import { startFakePostgrest, type FakePostgrest } from "./fixtures/fakePostgrest";
import { approxCursorOf, approxSelection, isInsertableApproxRow } from "../lib/rejudgeApplySelection";
import {
  approxOriginNote,
  approxOriginOf,
  classifyRevertTargets,
  holdingOwnerKeyOf,
  recheckRevertTargets,
  REJUDGE_APPROX_PLANNED_ACTION,
  REJUDGE_APPROX_REVERT_PLANNED_ACTION,
  type RevertClassifyInput,
} from "../lib/rejudgeRevert";
import { computeHoldings, type ItemEvent, type UpboEntry } from "../lib/api";

type Row = Record<string, unknown>;

// ---------- A. 순수: classifyRevertTargets ----------

const RUN = "5e1f0000-0000-4000-8000-00000000a001";
const AT = "2026-11-11T03:00:00.000Z";

function approxEntry(id: string, over: Partial<UpboEntry> = {}): UpboEntry {
  return {
    id,
    streamerSlug: "demo",
    sourceKey: `uid-${id}::0`,
    batchId: "",
    status: "pending",
    fanNickname: "시청자01",
    fanId: "viewer01",
    itemName: "사진",
    probability: 2,
    donateTimeText: "2026-10-02 20:00:00",
    donationType: "별풍선",
    rouletteIndex: 0,
    rouletteTotal: 1,
    rawText: "(2%) 사진",
    amountRangeLabel: "33",
    effectiveCount: 1,
    adminNote: approxOriginNote({ runId: RUN, at: AT }),
    createdAt: AT,
    ...over,
  };
}

function ev(id: string, entryId: string, eventType: string, over: Partial<ItemEvent> = {}): ItemEvent {
  return {
    id,
    upboEntryId: entryId,
    eventType,
    actorType: "operator",
    actorId: null,
    beforeJson: null,
    afterJson: null,
    quantityDelta: null,
    reason: null,
    memo: null,
    approvalStatus: "not_required",
    approvedBy: null,
    approvedAt: null,
    createdAt: "2026-11-11T04:00:00.000Z",
    ...over,
  };
}

function input(targets: UpboEntry[], over: Partial<RevertClassifyInput> = {}): RevertClassifyInput {
  return {
    targets,
    deliveryEntries: targets,
    events: [],
    assignmentEntryIds: new Set(),
    progress: [],
    couponExcludedNames: new Set(),
    accruedKeys: new Set(),
    truncatedMarks: [],
    couponItemKeysByName: new Map(),
    ...over,
  };
}

test("출처 표시: origin JSON 만 짧게, 다른 admin_note 는 출처 없음", () => {
  const note = approxOriginNote({ runId: RUN, at: AT });
  assert.equal(note, `{"origin":{"kind":"rejudge_approx","runId":"${RUN}","at":"${AT}","v":1}}`);
  assert.deepEqual(approxOriginOf(note), { kind: "rejudge_approx", runId: RUN, at: AT, v: 1 });
  assert.equal(approxOriginOf(""), null);
  assert.equal(approxOriginOf('{"effectiveCount":2}'), null);
  assert.equal(approxOriginOf("not json"), null);
  assert.equal(approxOriginOf('{"origin":{"kind":"manual","runId":"x"}}'), null);
});

test("막힘 없음 → 되돌릴 수 있음", () => {
  assert.deepEqual(classifyRevertTargets(input([approxEntry("e1")])), { voidable: ["e1"], alreadyCancelled: [], blocked: [] });
});

test("운영 이벤트가 있으면 종류마다 막는다(취소·void 말고 전부)", () => {
  for (const type of ["transfer", "exchange", "complete", "memo", "quantity_adjust", "admin_adjustment", "status_change"]) {
    const out = classifyRevertTargets(input([approxEntry("e1")], { events: [ev("x1", "e1", type)] }));
    assert.deepEqual(out.blocked, [{ entryId: "e1", reasons: ["ops_event"] }], type);
    assert.deepEqual(out.voidable, []);
  }
  // 취소 뒤 되돌린(admin_adjustment) 기록도 막는다 — 운영 처리를 되감지 않는다
  const reverted = classifyRevertTargets(
    input([approxEntry("e1")], { events: [ev("c1", "e1", "cancel"), ev("r1", "e1", "admin_adjustment", { afterJson: { revertOfEventId: "c1" } })] }),
  );
  assert.deepEqual(reverted.blocked, [{ entryId: "e1", reasons: ["ops_event"] }]);
});

test("이미 전량 취소(cancel·void·상태 cancelled)는 따로 센다", () => {
  const out = classifyRevertTargets(
    input([approxEntry("e1"), approxEntry("e2"), approxEntry("e3", { status: "cancelled" }), approxEntry("e4")], {
      events: [ev("c1", "e1", "cancel"), ev("v1", "e2", "void", { quantityDelta: 1 })],
    }),
  );
  assert.deepEqual(out.alreadyCancelled, ["e1", "e2", "e3"]);
  assert.deepEqual(out.voidable, ["e4"]);
  assert.deepEqual(out.blocked, []);
});

test("상태가 대기가 아니거나 배송 배정에 있으면 막는다", () => {
  const out = classifyRevertTargets(
    input([approxEntry("e1", { status: "hidden" }), approxEntry("e2")], { assignmentEntryIds: new Set(["e2"]) }),
  );
  assert.deepEqual(out.blocked, [
    { entryId: "e1", reasons: ["status_changed"] },
    { entryId: "e2", reasons: ["delivery_assignment"] },
  ]);
});

test("되돌린 뒤 (보유자, 상품) 배송 처리 수량 > 보유면 그 줄에 걸친 후보를 막는다", () => {
  const target = approxEntry("e1");
  const other = approxEntry("e9", { adminNote: "", sourceKey: "live::0" }); // 같은 시청자·상품의 실시간 기록
  const itemKey = "사진@@2@@33";
  const base = { targets: [target], deliveryEntries: [target, other] };
  const over = classifyRevertTargets(input([target], { ...base, progress: [{ fanId: "viewer01", itemKey, processedCount: 2 }] }));
  assert.deepEqual(over.blocked, [{ entryId: "e1", reasons: ["processed_over_holding"] }]);
  const fits = classifyRevertTargets(input([target], { ...base, progress: [{ fanId: "viewer01", itemKey, processedCount: 1 }] }));
  assert.deepEqual(fits.voidable, ["e1"]);
  // 다른 시청자·다른 상품의 처리 수량은 상관없다
  const elsewhere = classifyRevertTargets(input([target], { ...base, progress: [{ fanId: "viewer02", itemKey, processedCount: 5 }] }));
  assert.deepEqual(elsewhere.voidable, ["e1"]);
  // 쿠폰 연결 상품은 배송관리에서 빠지므로 대조하지 않는다
  const coupon = classifyRevertTargets(
    input([target], { ...base, progress: [{ fanId: "viewer01", itemKey, processedCount: 2 }], couponExcludedNames: new Set(["사진"]) }),
  );
  assert.deepEqual(coupon.voidable, ["e1"]);
});

test("쿠폰: 적립 메모에 키가 있으면 막고, 이 기록이 생긴 뒤의 잘린 메모가 같은 (시청자, 쿠폰)에 있어도 막는다", () => {
  const target = approxEntry("e1");
  const accrued = classifyRevertTargets(input([target], { accruedKeys: new Set([target.sourceKey]) }));
  assert.deepEqual(accrued.blocked, [{ entryId: "e1", reasons: ["coupon_accrued"] }]);
  const links = new Map([["사진", ["photo"]]]);
  const after = classifyRevertTargets(
    input([target], { couponItemKeysByName: links, truncatedMarks: [{ viewerKey: "viewer01", itemKey: "photo", createdAt: "2026-11-12T00:00:00.000Z" }] }),
  );
  assert.deepEqual(after.blocked, [{ entryId: "e1", reasons: ["coupon_unknown"] }]);
  // 이 기록이 생기기 전에 쓴 메모에는 이 키가 들어갈 수 없다
  const before = classifyRevertTargets(
    input([target], { couponItemKeysByName: links, truncatedMarks: [{ viewerKey: "viewer01", itemKey: "photo", createdAt: "2026-10-01T00:00:00.000Z" }] }),
  );
  assert.deepEqual(before.voidable, ["e1"]);
  // 다른 시청자·연결 안 된 쿠폰이면 상관없다
  const other = classifyRevertTargets(
    input([target], { couponItemKeysByName: links, truncatedMarks: [{ viewerKey: "viewer02", itemKey: "photo", createdAt: "2026-11-12T00:00:00.000Z" }] }),
  );
  assert.deepEqual(other.voidable, ["e1"]);
});

test("처리 수량 열쇠는 배송관리 보유자 열쇠와 같은 규칙(괄호 계정 ID·계정 없는 닉네임)", () => {
  assert.equal(holdingOwnerKeyOf("(viewer01)", "시청자01"), "viewer01");
  assert.equal(holdingOwnerKeyOf("", "시청자01"), "시청자01");
  const itemKey = "사진@@2@@33";
  // 저장된 처리 수량의 계정이 괄호 모양이어도 같은 보유자로 맞춘다
  const target = approxEntry("e1");
  const other = approxEntry("e9", { adminNote: "", sourceKey: "live::0" });
  const wrapped = classifyRevertTargets(
    input([target], { deliveryEntries: [target, other], progress: [{ fanId: "(viewer01)", itemKey, processedCount: 2 }] }),
  );
  assert.deepEqual(wrapped.blocked, [{ entryId: "e1", reasons: ["processed_over_holding"] }]);
  // 계정 없는 시청자는 닉네임이 보유자 열쇠
  const nick = approxEntry("e2", { fanId: "", fanNickname: "닉만있음" });
  const nickOther = approxEntry("e8", { fanId: "", fanNickname: "닉만있음", adminNote: "", sourceKey: "live2::0" });
  const byNick = classifyRevertTargets(
    input([nick], { deliveryEntries: [nick, nickOther], progress: [{ fanId: "", fanNickname: "닉만있음", itemKey, processedCount: 2 }] }),
  );
  assert.deepEqual(byNick.blocked, [{ entryId: "e2", reasons: ["processed_over_holding"] }]);
});

test("쓰기 직전 재확인(순수): 새 이벤트(종류 무관)·배송 배정·쿠폰 적립이 생기면 건너뛰고, 취소·void 뿐이면 이미 취소", () => {
  const targets = ["a", "b", "c", "d", "e"].map((id) => ({ id, sourceKey: `${id}::0` }));
  const out = recheckRevertTargets({
    targets,
    events: [
      { upboEntryId: "a", eventType: "transfer" },
      { upboEntryId: "b", eventType: "void" },
      { upboEntryId: "c", eventType: "memo" },
      { upboEntryId: "c", eventType: "cancel" },
    ],
    assignmentEntryIds: new Set(["d"]),
    accruedKeys: new Set(["e::0"]),
  });
  assert.deepEqual(out.alreadyCancelled, ["b"]);
  assert.deepEqual(out.voidable, []);
  assert.deepEqual(out.blocked, [
    { entryId: "a", reasons: ["changed_since_check"] },
    { entryId: "c", reasons: ["changed_since_check"] },
    { entryId: "d", reasons: ["delivery_assignment"] },
    { entryId: "e", reasons: ["coupon_accrued"] },
  ]);
});

// ---------- C. 저장 흉내(가짜 PostgREST) ----------

type Lib = typeof import("../lib/upboSupabase");
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

const COUPON_AUDITS = [
  { id: "5e1f0000-0000-4000-8000-0000000008c1", streamer_id: SID, action: "coupon_items_updated", created_at: "2026-10-01T00:00:00.000Z", payload: { items: [{ key: "photo", name: "사진권" }] } },
  {
    id: "5e1f0000-0000-4000-8000-0000000008c2",
    streamer_id: SID,
    action: "coupon_source_map_updated",
    created_at: "2026-10-01T00:00:01.000Z",
    payload: { map: [{ itemKey: "photo", sources: [{ itemName: "영상편지", per: 1 }] }] },
  },
];

// 합성 데이터를 미리보고 🟢 3건을 넣은 상태를 만든다.
async function appliedGreens(extraAudits: Row[] = []) {
  fake.reset({ ...SYNTH_TABLES, audit_logs: [...SYNTH_TABLES.audit_logs, ...extraAudits] });
  const p = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  const main = p.rows.filter((r) => r.kind !== "outside");
  const { keys, seenThrough } = approxSelection(main, {});
  const out = await lib.applyApproxRejudgeForStreamer(STREAMER, { fingerprint: p.planFingerprint, rawUntil: p.rawUntil!, seenThrough: seenThrough!, sourceKeys: keys });
  assert.equal(out.inserted, 3);
  fake.writes.length = 0;
  return { p, out, keys };
}

const statusOf = (error: unknown) => (error as { status?: number }).status;

test("되돌리기 미리보기: 대상 = 장부 ∩ admin_note, 쓰기 0", async () => {
  const { out } = await appliedGreens();
  const preview = await lib.previewApproxRejudgeRevert(STREAMER, out.runId);
  assert.equal(preview.targets, 3);
  assert.equal(preview.voidable, 3);
  assert.equal(preview.alreadyCancelled, 0);
  assert.deepEqual(preview.blocked, []);
  assert.equal(preview.missing, 0);
  assert.equal(preview.ledgerMismatch, null);
  assert.deepEqual(fake.writes, []);
  await assert.rejects(lib.previewApproxRejudgeRevert(STREAMER, "not-a-uuid"), (e) => statusOf(e) === 400);
});

test("확인(슬러그)·사유가 없으면 400, 쓰기 0", async () => {
  const { out } = await appliedGreens();
  await assert.rejects(lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: "x", reason: "잘못 넣음" }), (e) => statusOf(e) === 400);
  await assert.rejects(lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "  " }), (e) => statusOf(e) === 400);
  await assert.rejects(lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "x".repeat(201) }), (e) => statusOf(e) === 400);
  assert.deepEqual(fake.writes, []);
});

test("voidEntriesBulk: 계획 장부를 먼저 쓰고 void 를 배열로 한 번에(전량·rollbackRunId). 두 번째는 건너뛴다(같은 줄 void 2번 0)", async () => {
  const { out } = await appliedGreens();
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "시험 되돌리기" });
  assert.equal(done.voided, 3);
  const posts = fake.writes.filter((w) => w.table === "upbo_item_events");
  assert.equal(posts.length, 1, "한 번의 POST 에 배열로");
  const body = posts[0].body as Row[];
  assert.equal(body.length, 3);
  for (const row of body) {
    assert.equal(row.event_type, "void");
    assert.equal(row.quantity_delta, null, "전량");
    assert.deepEqual(row.after_json, { status: "cancelled", rollbackRunId: out.runId });
    assert.ok(!String(row.reason).includes("시험 되돌리기"), "사람이 적은 이유는 공개로 나가는 이벤트가 아니라 audit 에만");
  }
  assert.ok(!fake.writes.some((w) => w.method !== "POST"), "물리 삭제·수정 없음");
  const auditWrites = fake.writes.filter((w) => w.table === "audit_logs");
  assert.equal(auditWrites.length, 1);
  assert.ok(fake.writes.indexOf(auditWrites[0]) < fake.writes.indexOf(posts[0]), "되돌리기 장부가 void 보다 먼저");
  const audit = auditWrites[0].body as Row;
  assert.equal(audit.action, REJUDGE_APPROX_REVERT_PLANNED_ACTION);
  const payload = audit.payload as { runId: string; reason: string; entryIds: string[]; eventIds: string[] };
  assert.equal(payload.runId, out.runId);
  assert.equal(payload.reason, "시험 되돌리기");
  assert.deepEqual(new Set(payload.entryIds), new Set(out.insertedEntryIds));
  assert.deepEqual(new Set(payload.eventIds), new Set(posts[0].inserted.map((r) => r.id)), "장부의 이벤트 id = 실제로 쓴 void 의 id");
  assert.ok(!JSON.stringify(payload).includes("::0"), "장부에 결과 키 없음");
  assert.deepEqual(done.voidedEntryIds.sort(), [...out.insertedEntryIds].sort());
  // 다시 눌러도 같은 줄에 void 가 또 생기지 않는다
  fake.writes.length = 0;
  const again = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "또" });
  assert.equal(again.voided, 0);
  assert.equal(again.alreadyCancelled, 3);
  assert.ok(!fake.writes.some((w) => w.table === "upbo_item_events"));
  for (const id of out.insertedEntryIds) {
    assert.equal(fake.db.upbo_item_events.filter((e) => e.upbo_entry_id === id).length, 1);
  }
});

test("동시에 두 번 되돌려도 기록마다 void 는 1개(이벤트 id 를 기록 id 로 정해 on_conflict 가 막는다)", async () => {
  const { out } = await appliedGreens();
  // 두 요청의 "이미 void 있나" 확인 읽기가 둘 다 끝난 뒤에 쓰기가 겹치게 붙잡는다(확인 읽기만으로는 못 막는 경우).
  fake.setPostBarrier("upbo_item_events", 2);
  const [x, y] = await Promise.all([
    lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "a" }),
    lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "b" }),
  ]);
  assert.equal(x.voided + y.voided, 3);
  for (const id of out.insertedEntryIds) {
    assert.equal(fake.db.upbo_item_events.filter((e) => e.upbo_entry_id === id && e.event_type === "void").length, 1);
  }
});

test("계획 장부와 admin_note 가 다르면 ledgerMismatch, 장부에만 있는 없는 기록은 missing — 계획 ∩ 실제 ∩ 표시만 대상", async () => {
  const { out } = await appliedGreens();
  const [a, b] = out.insertedEntryIds;
  // 장부에는 있는데 기록 표시가 지워진 줄(장부에만), 장부엔 없는데 같은 실행 표시가 있는 줄(기록에만), 장부에만 있는 사라진 id
  const ea = fake.db.upbo_entries.find((e) => e.id === a)!;
  ea.admin_note = "";
  fake.db.upbo_entries.push({
    ...fake.db.upbo_entries.find((e) => e.id === b)!,
    id: "5e1f0000-0000-4000-8000-0000000007b1",
    source_key: "stray::0",
  });
  fake.db.audit_logs.push({
    id: "5e1f0000-0000-4000-8000-0000000009b1",
    streamer_id: SID,
    action: REJUDGE_APPROX_PLANNED_ACTION,
    created_at: "2026-11-11T05:00:00.000Z",
    payload: { runId: out.runId, chunk: 9, at: "2026-11-11T05:00:00.000Z", v: 1, entryIds: ["5e1f0000-0000-4000-8000-0000000007ff"] },
  });
  const preview = await lib.previewApproxRejudgeRevert(STREAMER, out.runId);
  assert.deepEqual(preview.ledgerMismatch, { ledgerOnly: 1, noteOnly: 1 });
  assert.equal(preview.missing, 1);
  assert.equal(preview.targets, 2);
  assert.equal(preview.voidable, 2);
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "대조" });
  assert.equal(done.voided, 2);
  assert.ok(!fake.db.upbo_item_events.some((e) => e.upbo_entry_id === a || e.upbo_entry_id === "5e1f0000-0000-4000-8000-0000000007b1"));
});

test("막힌 기록(양도·배송 배정)은 건너뛰고 이유를 보여 준다", async () => {
  const { out } = await appliedGreens();
  const [a, b] = out.insertedEntryIds;
  fake.db.upbo_item_events = [
    {
      id: "5e1f0000-0000-4000-8000-0000000006a1",
      upbo_entry_id: a,
      streamer_id: SID,
      event_type: "transfer",
      actor_type: "streamer",
      after_json: { currentOwnerId: "viewer99", currentOwnerName: "시청자99" },
      quantity_delta: null,
      approval_status: "not_required",
      created_at: "2026-11-11T06:00:00.000Z",
    },
  ];
  fake.db.audit_logs.push({
    id: "5e1f0000-0000-4000-8000-0000000009c1",
    streamer_id: SID,
    action: "delivery_assignment_updated",
    created_at: "2026-11-11T06:00:01.000Z",
    payload: { assignments: [{ entryId: b, ownerKey: "viewer02", itemKey: "짧은영상@@1@@33", doneCount: 1, doneAt: "2026-11-11T06:00:00.000Z" }] },
  });
  const preview = await lib.previewApproxRejudgeRevert(STREAMER, out.runId);
  assert.equal(preview.voidable, 1);
  assert.deepEqual(
    preview.blocked.map((x) => [x.entryId, x.reasons.map((r) => r.code)]).sort(),
    [
      [a, ["ops_event"]],
      [b, ["delivery_assignment"]],
    ].sort(),
  );
  assert.ok(preview.blocked.every((x) => x.reasons.every((r) => r.text.length > 0) && x.itemName && x.fanNickname));
  assert.ok(!JSON.stringify(preview).includes("::0"), "결과 키(계정 ID 포함)는 화면 응답에 싣지 않는다");
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "일부" });
  assert.equal(done.voided, 1);
  assert.equal(done.blocked.length, 2);
  assert.ok(!fake.db.upbo_item_events.some((e) => e.event_type === "void" && (e.upbo_entry_id === a || e.upbo_entry_id === b)));
});

test("배송 처리 수량이 남은 보유보다 많아지는 기록은 막는다(팬 페이지와 같은 읽기로 대조)", async () => {
  const { out } = await appliedGreens();
  const target = fake.db.upbo_entries.find((e) => e.source_key === "synth0101::0" && out.insertedEntryIds.includes(String(e.id)))!;
  const itemKey = `${target.item_name}@@${target.probability}@@${target.amount_range_label}`;
  fake.db.audit_logs.push({
    id: "5e1f0000-0000-4000-8000-0000000009d1",
    streamer_id: SID,
    action: "delivery_progress_updated",
    created_at: "2026-11-11T07:00:00.000Z",
    payload: { items: [{ fanId: target.fan_id, fanNickname: target.fan_nickname, itemKey, itemName: target.item_name, processedCount: 1 }] },
  });
  const preview = await lib.previewApproxRejudgeRevert(STREAMER, out.runId);
  assert.deepEqual(
    preview.blocked.map((x) => [x.entryId, x.reasons.map((r) => r.code)]),
    [[target.id, ["processed_over_holding"]]],
  );
  assert.equal(preview.voidable, 2);
});

test("void 뒤: 팬 보유·쿠폰 소급에서 빠지고, 같은 원본을 다시 넣으면 '이미 있음'", async () => {
  // 영상편지(🟢, 170 표)를 쿠폰에 연결해 둔다 — 소급이 void 된 키를 세지 않는지 본다
  const { p, out } = await appliedGreens(COUPON_AUDITS);
  const r118 = fake.db.upbo_entries.find((e) => e.source_key === "synth0118::0" && out.insertedEntryIds.includes(String(e.id)))!;
  const backfillBefore = await lib.previewCouponBackfill(STREAMER, {});
  const holdingIds = async () => {
    const state = await lib.getStreamerState(SYNTH_STREAMER.slug);
    return new Set(computeHoldings(state.upboEntries as unknown as UpboEntry[], state.itemEvents as ItemEvent[]).flatMap((h) => h.items.map((i) => i.entryId)));
  };
  assert.ok((await holdingIds()).has(String(r118.id)));
  await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "재넣기 시험" });
  const held = await holdingIds();
  for (const id of out.insertedEntryIds) assert.ok(!held.has(id), "void 된 기록은 팬 보유에서 빠진다");
  const backfillAfter = await lib.previewCouponBackfill(STREAMER, {});
  assert.equal(backfillAfter.consideredCount, backfillBefore.consideredCount - out.inserted);
  assert.equal(backfillAfter.totalDelta, backfillBefore.totalDelta - 1, "void 된 영상편지 당첨은 쿠폰 소급이 세지 않는다");
  // 판정 재료는 그대로라 같은 계획으로 다시 넣으려 하면 → 이미 있음(키가 남아 있다)
  const insertable = p.rows.filter((r) => isInsertableApproxRow(r));
  const again = await lib.applyApproxRejudgeForStreamer(STREAMER, {
    fingerprint: p.planFingerprint,
    rawUntil: p.rawUntil!,
    seenThrough: approxCursorOf(insertable.at(-1)!),
    sourceKeys: ["synth0118::0"],
  });
  assert.equal(again.inserted, 0);
  assert.equal(again.alreadyExisted, 1);
});

test("실행 목록: 실행별 넣은 수·되돌린 수(실제 기록·void 기준), 결과 키는 안 내보낸다", async () => {
  const { out } = await appliedGreens();
  await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "목록" });
  const runs = await lib.approxRejudgeRuns(STREAMER);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, out.runId);
  assert.equal(runs[0].inserted, 3);
  assert.equal(runs[0].voided, 3);
  assert.ok(runs[0].revertedAt);
  assert.ok(!JSON.stringify(runs).includes("::0"));
});

test("되돌리기 장부를 못 쓰면 void 0(503)", async () => {
  const { out } = await appliedGreens();
  fake.setPostFailure((table, body) => table === "audit_logs" && (body as Row)?.action === REJUDGE_APPROX_REVERT_PLANNED_ACTION);
  await assert.rejects(
    lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "장부 실패" }),
    (e) => statusOf(e) === 503,
  );
  assert.ok(!fake.writes.some((w) => w.table === "upbo_item_events"));
  assert.equal((fake.db.upbo_item_events ?? []).length, 0);
});

test("판정 뒤·쓰기 직전에 양도가 생기거나 배송 배정에 들어가면 그 기록은 건너뛰고 막힘으로 보고", async () => {
  const { out } = await appliedGreens();
  const [a, b] = out.insertedEntryIds;
  // 되돌리기 판정(팬 페이지 읽기)이 끝난 뒤, 쓰기 직전 다시 읽기 사이에 다른 화면에서 처리가 생긴 상황
  let assignmentReads = 0;
  fake.setBeforeGet((table, query) => {
    if (table === "upbo_item_events" && (query.get("upbo_entry_id") ?? "").startsWith("in.")) {
      fake.db.upbo_item_events.push({
        id: "5e1f0000-0000-4000-8000-0000000006b1",
        upbo_entry_id: a,
        streamer_id: SID,
        event_type: "transfer",
        actor_type: "streamer",
        after_json: { currentOwnerId: "viewer98", currentOwnerName: "시청자98" },
        quantity_delta: null,
        approval_status: "not_required",
        created_at: "2026-11-11T08:00:00.000Z",
      });
    }
    // 배송 배정 읽기는 판정 때 1번, 쓰기 직전 다시 읽기에서 1번 — 두 번째 읽기 직전에 배정이 생긴다
    if (table === "audit_logs" && query.get("action") === "eq.delivery_assignment_updated" && ++assignmentReads === 2) {
      fake.db.audit_logs.push({
        id: "5e1f0000-0000-4000-8000-0000000009e1",
        streamer_id: SID,
        action: "delivery_assignment_updated",
        created_at: "2026-11-11T08:00:01.000Z",
        payload: { assignments: [{ entryId: b, ownerKey: "viewer02", itemKey: "x@@1@@33", doneCount: 1, doneAt: "2026-11-11T08:00:00.000Z" }] },
      });
    }
  });
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "경쟁" });
  fake.setBeforeGet(null);
  assert.equal(done.voided, 1);
  assert.deepEqual(
    done.blocked.map((x) => [x.entryId, x.reasons.map((r) => r.code)]).sort(),
    [
      [a, ["changed_since_check"]],
      [b, ["delivery_assignment"]],
    ].sort(),
  );
  assert.ok(!fake.db.upbo_item_events.some((e) => e.event_type === "void" && (e.upbo_entry_id === a || e.upbo_entry_id === b)));
  const plan = fake.writes.find((w) => w.table === "audit_logs" && (w.body as Row).action === REJUDGE_APPROX_REVERT_PLANNED_ACTION)!;
  assert.deepEqual(((plan.body as Row).payload as { entryIds: string[] }).entryIds, done.voidedEntryIds, "장부엔 실제로 되돌릴 것만");
});

test("실행 목록은 20개에서 자르지 않는다(계획 장부 기준 전부)", async () => {
  const p = await (async () => {
    fake.reset(SYNTH_TABLES);
    return lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  })();
  const insertable = p.rows.filter((r) => isInsertableApproxRow(r));
  const seen = approxCursorOf(insertable.at(-1)!);
  const runIds: string[] = [];
  for (const row of insertable) {
    const out = await lib.applyApproxRejudgeForStreamer(STREAMER, { fingerprint: p.planFingerprint, rawUntil: p.rawUntil!, seenThrough: seen, sourceKeys: [row.sourceKey] });
    runIds.push(out.runId);
  }
  // 장부 줄을 25개 넘게 쌓는다(넣은 게 없는 실행은 목록에서 빠지므로, 들어간 11개 실행 + 빈 계획 줄 20개)
  for (let i = 0; i < 20; i += 1) {
    fake.db.audit_logs.push({
      id: `5e1f0000-0000-4000-8000-0000000aa${String(i).padStart(3, "0")}`,
      streamer_id: SID,
      action: REJUDGE_APPROX_PLANNED_ACTION,
      created_at: `2026-11-11T09:00:${String(i).padStart(2, "0")}.000Z`,
      payload: { runId: `5e1f0000-0000-4000-8000-0000000bb${String(i).padStart(3, "0")}`, chunk: 0, at: "x", v: 1, entryIds: [] },
    });
  }
  const runs = await lib.approxRejudgeRuns(STREAMER);
  assert.equal(runs.length, insertable.length);
  assert.deepEqual(new Set(runs.map((r) => r.runId)), new Set(runIds));
  assert.ok(runs.every((r) => r.inserted === 1));
});

test("쓰기 직전 다시 읽은 배송 처리 수량으로 '처리 수량 초과'를 다시 판단한다", async () => {
  const { out } = await appliedGreens();
  const target = fake.db.upbo_entries.find((e) => e.source_key === "synth0101::0" && out.insertedEntryIds.includes(String(e.id)))!;
  const itemKey = `${target.item_name}@@${target.probability}@@${target.amount_range_label}`;
  let progressReads = 0;
  // 판정(팬 페이지 읽기) 뒤, 쓰기 직전 다시 읽기 사이에 배송관리에서 이 시청자 상품 1개를 처리 완료로 저장했다
  fake.setBeforeGet((table) => {
    if (table === "delivery_progress" && ++progressReads === 2) {
      fake.db.audit_logs.push({
        id: "5e1f0000-0000-4000-8000-0000000009f2",
        streamer_id: SID,
        action: "delivery_progress_updated",
        created_at: "2026-11-11T09:30:00.000Z",
        payload: { items: [{ fanId: target.fan_id, fanNickname: target.fan_nickname, itemKey, itemName: target.item_name, processedCount: 1 }] },
      });
    }
  });
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "처리 수량 경쟁" });
  fake.setBeforeGet(null);
  assert.equal(progressReads, 2, "판정 때 1번 + 쓰기 직전 1번");
  assert.equal(done.voided, 2);
  assert.deepEqual(
    done.blocked.map((x) => [x.entryId, x.reasons.map((r) => r.code)]),
    [[target.id, ["processed_over_holding"]]],
  );
  assert.ok(!fake.db.upbo_item_events.some((e) => e.upbo_entry_id === target.id));
});

test("쓰기 직전 재확인 조회는 한 번에 5개까지만 보낸다(700건 = 7조회)", async () => {
  const { normalizeCatalogCapture } = await import("../lib/upboCore");
  const groups = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "단컷", probability: 2 }, { name: "하트", probability: 98 }] }],
  }).groups;
  const rows = Array.from({ length: 700 }, (_, n) => ({
    sourceUid: `wave${String(n).padStart(5, "0")}`,
    donateTimeText: `2026-10-${String(2 + (n % 20)).padStart(2, "0")} ${String(n % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`,
    donationType: "별풍선",
    donationAmount: 33,
    fanNickname: `시청자${n}`,
    fanId: `viewer${n}`,
    results: [{ name: "단컷", probability: 2 }],
  }));
  fake.reset({
    streamers: [SYNTH_STREAMER],
    catalogs: [{ id: "5e1f0000-0000-4000-8000-0000000001a9", streamer_id: SID, version: 1, captured_at: "2026-10-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z", groups }],
    audit_logs: [],
    raw_imports: [{ id: "5e1f0000-0000-4000-8000-0000000004a9", streamer_id: SID, type: "results", batch_id: null, saved_at: "2026-10-23T00:00:00.000Z", raw: { rows } }],
    upbo_entries: [],
    upbo_item_events: [],
  });
  const p = await lib.previewDonationTimeRejudgeForStreamer(STREAMER);
  const insertable = p.rows.filter((r) => isInsertableApproxRow(r));
  const out = await lib.applyApproxRejudgeForStreamer(STREAMER, {
    fingerprint: p.planFingerprint,
    rawUntil: p.rawUntil!,
    seenThrough: approxCursorOf(insertable.at(-1)!),
    sourceKeys: insertable.map((r) => r.sourceKey),
  });
  assert.equal(out.inserted, 700);
  let inFlight = 0;
  let peak = 0;
  let recheckCalls = 0;
  fake.setBeforeGet(async (table, query) => {
    if (table !== "upbo_item_events" || !(query.get("upbo_entry_id") ?? "").startsWith("in.")) return;
    recheckCalls += 1;
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight -= 1;
  });
  const done = await lib.applyApproxRejudgeRevert(STREAMER, out.runId, { confirm: SYNTH_STREAMER.slug, reason: "동시 요청 상한" });
  fake.setBeforeGet(null);
  assert.equal(done.voided, 700);
  assert.equal(recheckCalls, 7);
  assert.ok(peak <= 5 && peak >= 2, `동시 조회 최대 ${peak}`);
});
