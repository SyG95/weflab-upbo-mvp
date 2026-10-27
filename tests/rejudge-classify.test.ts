// 후원 시점 근사 판정 분류(1단계 묶음 3) — 🟢 엄격 조건 G1~G12 반례(PHASE1-TEST-PLAN.md §3-2).
// 원칙: 깨끗한 기본 장면은 🟢, 조건을 하나만 깨면 🟡 + 그 이유. 제외(⚪)·오기록 의심·팬 화면 숨김 꼬리표도 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { classifyDonationTimeRow, HIDDEN_ON_FAN_TAG, type DonationTimeFacts } from "../lib/rejudgeClassify";
import { collectDonationTimeCandidates, type RejudgeSourceBatch } from "../lib/rejudge";
import { buildJudgeHistory, fanUsageByVersionLikeState, type JudgeHistoryRaw, type UsageEngine } from "../lib/judgeInputsAt";
import { applyCatalogUsage, computeEffectiveOverrides } from "../lib/upboSupabase";
import { normalizeCatalogCapture, specialRuleKeyForItem } from "../lib/upboCore";
import { filterEntriesByCatalogUsage, type UpboEntry } from "../lib/api";
import type { ManualOverlapEntry } from "../lib/manualOverlap";

const engine: UsageEngine = { computeEffectiveOverrides, applyCatalogUsage };
const kst = (text: string) => new Date(`${text}+09:00`).toISOString();

// ── 순수 분류 ──────────────────────────────────────────────────────────────
const CLEAN: DonationTimeFacts = {
  decision: "record",
  excludeKind: null,
  exactName: true,
  probabilityKnown: true,
  amountKnown: true,
  tableAmbiguity: null,
  usageApproximate: false,
  thresholdSafe: true,
  multiplierRisk: false,
  fixedPriceCandidate: false,
  timeKnown: true,
  preReset: false,
  keyUnstable: false,
  fallbackKey: false,
  manualOverlapSummary: null,
  aliasUsed: false,
  hiddenOnFan: false,
};

test("classifyDonationTimeRow: 전부 참이면 🟢, 하나만 거짓이어도 🟡 + 그 이유", () => {
  assert.equal(classifyDonationTimeRow(CLEAN).cls, "green");
  const cases: Array<[string, Partial<DonationTimeFacts>, string]> = [
    ["G1", { exactName: false }, "표기가 표와 조금 달라요"],
    ["G2", { probabilityKnown: false }, "확률이 표와 달라요"],
    ["G3", { amountKnown: false }, "후원 금액"],
    ["G4 구간", { tableAmbiguity: "window" }, "바뀌는 중이었어요"],
    ["G4 다음 표", { tableAmbiguity: "next_version" }, "다음 표와 맞아요"],
    ["G4 첫 표 전", { tableAmbiguity: "before_first" }, "아직 저장돼 있지 않았어요"],
    ["G4 다음 표 판정 다름", { tableAmbiguity: "next_conflict" }, "다음 표로 판정하면 결과가 달라요"],
    ["G5", { usageApproximate: true }, "사용 설정을 정확히 알 수 없어요"],
    ["G6", { thresholdSafe: false }, "기준확률이 확실하지 않아요"],
    ["G7", { multiplierRisk: true }, "두배권"],
    ["G8", { fixedPriceCandidate: true }, "정가 금액과 같아요"],
    ["G9 시각", { timeKnown: false }, "후원 시각을 읽지 못했어요"],
    ["G9 리셋", { preReset: true }, "데이터 초기화 전"],
    ["G10", { keyUnstable: true }, "다른 상품으로 잡힌 적"],
    ["G10 고유번호 없음", { fallbackKey: true }, "원본 고유번호가 없는"],
    ["G11", { manualOverlapSummary: "10/20 수동기록(사진10장 ×1)" }, "10/20 수동기록(사진10장 ×1)"],
    ["G12", { aliasUsed: true, exactName: false }, "이름 연결로 맞춘"],
  ];
  for (const [label, patch, text] of cases) {
    const out = classifyDonationTimeRow({ ...CLEAN, ...patch });
    assert.equal(out.cls, "yellow", label);
    assert.equal(out.reasons.length, 1, `${label}: 이유는 하나만(${out.reasons.join(" / ")})`);
    assert.ok(out.reasonText.includes(text), `${label}: ${out.reasonText}`);
  }
});

test("classifyDonationTimeRow: 제외는 ⚪, 팬 화면 숨김은 꼬리표만(분류 불변)", () => {
  assert.equal(classifyDonationTimeRow({ ...CLEAN, decision: "ignore", excludeKind: "over_threshold" }).cls, "grey");
  assert.ok(classifyDonationTimeRow({ ...CLEAN, decision: "needs_review", excludeKind: "disabled_then" }).reasonText.includes("사용 안 함"));
  const hidden = classifyDonationTimeRow({ ...CLEAN, hiddenOnFan: true });
  assert.equal(hidden.cls, "green");
  assert.deepEqual(hidden.tags, [HIDDEN_ON_FAN_TAG]);
});

// ── 엔진까지 돌린 반례(collectDonationTimeCandidates) ─────────────────────────
type Tbl = { amount: number; items: Array<[string, number]> };
function catRow(version: number, capturedKst: string, tables: Tbl[]) {
  const groups = normalizeCatalogCapture({
    groups: tables.map((x) => ({
      amountMin: x.amount,
      amountMax: x.amount,
      items: x.items.map(([name, probability], idx) => ({ name, probability, sortOrder: idx })),
    })),
  }).groups;
  return { id: `c${version}`, version, captured_at: kst(capturedKst), created_at: null, groups };
}
let seq = 0;
const audit = (action: string, atKst: string, payload: unknown) => ({ id: `a${String(++seq).padStart(5, "0")}`, action, created_at: kst(atKst), payload });

const BASE_TABLES: Tbl[] = [
  { amount: 33, items: [["단컷", 2], ["반컷", 7], ["하트", 91]] },
  { amount: 330, items: [["네컷", 5], ["응원", 95]] },
];

type Res = { uid?: string | null; time?: string; item?: string; prob?: number | null; amount?: number | null; type?: string; fan?: string };
function capture(rows: Res[]): RejudgeSourceBatch["capture"] {
  return {
    capturedAt: kst("2026-10-15T00:00:00"),
    rows: rows.map((r) => ({
      sourceUid: r.uid === null ? undefined : r.uid ?? "x1",
      donateTimeText: r.time ?? "2026-10-10 12:00:00",
      donationType: r.type ?? "별풍선",
      donationAmount: r.amount === undefined ? 33 : r.amount,
      fanNickname: "시청자",
      fanId: r.fan ?? "viewer01",
      results: [{ name: r.item ?? "단컷", probability: r.prob === undefined ? 2 : r.prob }],
    })),
  };
}

function run(opts: {
  rows?: Res[];
  batches?: RejudgeSourceBatch[];
  catalogs?: JudgeHistoryRaw["catalogs"];
  audits?: JudgeHistoryRaw["audits"];
  batchSnapshots?: JudgeHistoryRaw["batches"];
  existing?: string[];
  manual?: ManualOverlapEntry[];
  aliases?: Record<string, { itemName: string; probability: number }>;
  current?: number;
}) {
  const history = buildJudgeHistory({
    catalogs: opts.catalogs ?? [catRow(1, "2026-10-01T00:00:00", BASE_TABLES)],
    audits: opts.audits ?? [audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" })],
    batches: opts.batchSnapshots ?? [],
    currentThresholdPercent: opts.current ?? 10,
  });
  return collectDonationTimeCandidates({
    batches: opts.batches ?? [{ batchId: "b1", capture: capture(opts.rows ?? [{}]), savedAt: kst("2026-10-15T00:00:00") }],
    history,
    engine,
    existingSourceKeys: new Set(opts.existing ?? []),
    manualEntries: opts.manual ?? [],
    aliases: opts.aliases ?? {},
    fanCatalogs: history.catalogs.map((c) => ({ version: c.version, groups: c.groups })),
    fanUsageByVersion: fanUsageByVersionLikeState(history, engine),
  });
}

function only(out: ReturnType<typeof run>) {
  assert.equal(out.rows.length, 1, JSON.stringify(out.summary));
  return out.rows[0];
}

test("기본 장면은 🟢(그때 표·정확한 기준·겹침 없음)", () => {
  const row = only(run({}));
  assert.equal(row.cls, "green", row.reasons.join(" / "));
  assert.deepEqual([row.judged.version, row.judged.itemName, row.judged.threshold], [1, "단컷", 10]);
});

test("G1: 띄어쓰기만 다른 이름 — 엔진은 기록이지만 🟡", () => {
  const row = only(run({ rows: [{ item: "단 컷" }] }));
  assert.equal(row.cls, "yellow");
  assert.ok(row.reasonText.includes("표기"));
});

test("G2·G3: 원본에 확률·금액이 없으면 엔진이 덜 엄격하게 맞춘다 → 🟡", () => {
  assert.ok(only(run({ rows: [{ prob: null }] })).reasons.some((r) => r.includes("확률")));
  assert.ok(only(run({ rows: [{ amount: null }] })).reasons.some((r) => r.includes("후원 금액")));
});

test("G4: 그때 표엔 없고 다음 표에만 맞으면 다음 표로 기록 후보 + 🟡", () => {
  const out = run({
    catalogs: [catRow(1, "2026-10-01T00:00:00", BASE_TABLES), catRow(2, "2026-10-12T00:00:00", [{ amount: 33, items: [["단컷", 3], ["하트", 97]] }])],
    rows: [{ prob: 3 }],
  });
  const row = only(out);
  assert.equal(row.judged.version, 2);
  assert.equal(row.cls, "yellow");
});

test("G5: 8/30 승계 규칙 변경 전 후원은 🟡", () => {
  const row = only(
    run({
      catalogs: [catRow(1, "2026-08-01T00:00:00", BASE_TABLES)],
      audits: [audit("threshold_percent_updated", "2026-08-01T00:00:00", { before: 10, after: 10, source: "baseline" })],
      rows: [{ time: "2026-08-20 12:00:00" }],
    }),
  );
  assert.equal(row.cls, "yellow");
  assert.ok(row.reasonText.includes("사용 설정"));
});

test("G6: 기준% 근사일 때 판정이 뒤집힐 수 있으면 🟡, 안 뒤집히면 🟢", () => {
  // 기준 이력이 10/20 에 처음 생김(5 → 10). 10/10 후원은 이력 전·배치 없음 → 지금 값 10(근사), 후보 {5, 10}
  const audits = [audit("threshold_percent_updated", "2026-10-20T00:00:00", { before: 5, after: 10, source: "settings" })];
  const flip = only(run({ audits, rows: [{ item: "반컷", prob: 7 }] }));
  assert.equal(flip.cls, "yellow", "7% 는 기준 5 면 제외, 10 이면 기록");
  assert.ok(flip.reasonText.includes("기준확률"));
  assert.equal(only(run({ audits, rows: [{ item: "단컷", prob: 2 }] })).cls, "green", "2% 는 어느 후보로도 기록");
});

test("G7: 두배권 칸이 있는 룰렛은 기록 후보 전부 🟡, 확정된 두배권 칸 자체는 ⚪", () => {
  const tables: Tbl[] = [{ amount: 33, items: [["단컷", 2], ["다음 룰렛 2배", 3], ["하트", 95]] }];
  const yellow = only(run({ catalogs: [catRow(1, "2026-10-01T00:00:00", tables)] }));
  assert.equal(yellow.cls, "yellow");
  assert.ok(yellow.reasonText.includes("두배권"));
  const cell = normalizeCatalogCapture({ groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "다음 룰렛 2배", probability: 3, sortOrder: 1 }] }] }).items[0];
  const out = run({
    catalogs: [catRow(1, "2026-10-01T00:00:00", tables)],
    audits: [
      audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" }),
      audit("special_item_rule", "2026-10-02T00:00:00", { rule: { ruleKey: specialRuleKeyForItem(cell), ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2, amountRangeLabel: "33", itemName: cell.itemName, normalizedName: cell.normalizedName, probability: 3 } }),
    ],
    rows: [{ item: "다음 룰렛 2배", prob: 3 }],
  });
  assert.equal(out.rows.length, 0);
  assert.equal(out.summary.excluded.modifier, 1);
});

const BASELINE = () => audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" });

test("G8: 정가 금액과 같은 후원은 🟡 — 지금은 정가에서 뺐어도 그때(또는 언젠가) 정가였으면", () => {
  assert.ok(only(run({ audits: [BASELINE(), audit("signature_counts_updated", "2026-10-02T00:00:00", { counts: [33] })] })).reasonText.includes("정가"));
  const changed = only(
    run({
      audits: [
        BASELINE(),
        audit("signature_counts_updated", "2026-09-20T00:00:00", { counts: [33] }),
        audit("signature_counts_updated", "2026-10-12T00:00:00", { counts: [] }), // 정가 → 룰렛 전환
      ],
    }),
  );
  assert.equal(changed.cls, "yellow");
  assert.ok(changed.reasonText.includes("정가"));
});

test("G9: 리셋 전 후원·시각을 못 읽는 후원은 🟡", () => {
  const reset = only(
    run({
      audits: [
        audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" }),
        audit("data_reset", "2026-10-11T00:00:00", { scope: { roulette: true } }),
      ],
    }),
  );
  assert.ok(reset.reasonText.includes("데이터 초기화 전"));
  const unknown = only(run({ rows: [{ time: "어제 저녁" }] }));
  assert.ok(unknown.reasons.some((r) => r.includes("후원 시각")));
  assert.equal(unknown.timeMs, null);
});

test("G10: 같은 결과 키가 원본 묶음마다 다른 상품이면 🟡, 결과 키당 한 번만 센다", () => {
  const out = run({
    batches: [
      { batchId: "b1", capture: capture([{ uid: "k1" }]) },
      { batchId: "b2", capture: capture([{ uid: "k1" }]) },
      { batchId: "b3", capture: capture([{ uid: "k1", item: "하트", prob: 91 }]) },
    ],
  });
  assert.equal(out.summary.N, 1, "세 번 담겼어도 1건");
  assert.equal(out.summary.scannedResults, 3);
  assert.ok(only(out).reasonText.includes("다른 상품"));
  const stable = run({ batches: [{ batchId: "b1", capture: capture([{ uid: "k1" }]) }, { batchId: "b2", capture: capture([{ uid: "k1" }]) }] });
  assert.equal(only(stable).cls, "green");
});

test("G11: 수동기록 겹침 의심(강·약)은 🟡", () => {
  const manual: ManualOverlapEntry[] = [{ id: "m1", fanId: "viewer01", fanNickname: "시청자", itemName: "💙단컷", donateTimeText: "2026-10-11 12:00", remaining: 1 }];
  const row = only(run({ manual }));
  assert.equal(row.cls, "yellow");
  assert.equal(row.manualOverlap?.level, "strong");
  assert.equal(only(run({ manual: [{ ...manual[0], remaining: 0 }] })).cls, "green", "취소로 남은 개수 0 이면 제외");
});

test("G12: 이름 연결로 맞춘 건 🟡(그때 표에 원래 이름이 없을 때만 연결)", () => {
  const out = run({ rows: [{ item: "옛단컷", prob: 2 }], aliases: { "33::옛단컷::2": { itemName: "단컷", probability: 2 } } });
  const row = only(out);
  assert.equal(row.cls, "yellow");
  assert.equal(row.judged.storeItemName, "단컷");
  assert.ok(row.reasonText.includes("이름 연결"));
});

test("⚪ 제외: 그때 기준 초과·그때 꺼진 칸·미션 정산 / 검토: 어느 칸에도 없음", () => {
  const audits = [
    audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" }),
    audit("catalog_usage_updated", "2026-10-02T00:00:00", { catalogVersion: 1, overrides: { "g1-i0": false } }), // 330 네컷 꺼짐
  ];
  const out = run({
    audits,
    rows: [
      { uid: "o1", item: "하트", prob: 91 },
      { uid: "o2", item: "네컷", prob: 5, amount: 330 },
      { uid: "o3", type: "도전미션 별풍선 성공" },
      { uid: "o4", item: "없는상품", prob: 1 },
    ],
  });
  assert.deepEqual(out.summary.excluded, { over_threshold: 1, disabled_then: 1, modifier: 0, mission: 1 });
  assert.equal(out.summary.c, 1);
  assert.equal(out.rows.length, 0, "제외·검토는 행으로 안 보낸다(개수만)");
  assert.equal(out.summary.N, out.summary.a + out.summary.d + out.summary.c + out.summary.b);
});

test("오기록 의심: 이미 기록됐는데 근사로는 제외(그때 꺼짐·기준 초과)면 표시만", () => {
  const audits = [
    audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" }),
    audit("catalog_usage_updated", "2026-10-02T00:00:00", { catalogVersion: 1, overrides: { "g0-i0": false } }), // 33 단컷 꺼짐
  ];
  const out = run({ audits, existing: ["x1::0"] });
  assert.equal(out.summary.a, 1);
  assert.equal(out.summary.suspectedOver, 1);
  const row = only(out);
  assert.equal(row.kind, "suspected");
  assert.equal(row.judged.itemName, "단컷", "꺼진 칸을 근거로 보여 준다");
  // 근사로도 기록이면 의심 아님
  assert.equal(run({ existing: ["x1::0"] }).summary.suspectedOver, 0);
});

test("팬 화면 숨김 꼬리표 = 팬 화면 필터(filterEntriesByCatalogUsage)를 같은 맵으로 돌린 결과", () => {
  // 10/10 후원 땐 켜져 있었는데 10/20 에 v1 저장본으로 단컷을 끔 → 넣어도 팬 화면에선 숨김
  const audits = [
    audit("threshold_percent_updated", "2026-10-01T00:00:00", { before: 10, after: 10, source: "baseline" }),
    audit("catalog_usage_updated", "2026-10-20T00:00:00", { catalogVersion: 1, overrides: { "g0-i0": false } }),
  ];
  const out = run({ audits });
  const row = only(out);
  assert.equal(row.cls, "green", "분류는 그대로");
  assert.deepEqual(row.tags, [HIDDEN_ON_FAN_TAG]);
  assert.equal(out.summary.hiddenOnFan, 1);
  const history = buildJudgeHistory({ catalogs: [catRow(1, "2026-10-01T00:00:00", BASE_TABLES)], audits, batches: [], currentThresholdPercent: 10 });
  const direct = filterEntriesByCatalogUsage(
    [{ sourceKey: "x1::0", catalogVersion: 1, catalogGroupIndex: 0, itemName: "단컷" } as UpboEntry],
    history.catalogs.map((c) => ({ version: c.version, groups: c.groups })),
    fanUsageByVersionLikeState(history, engine),
  );
  assert.equal(direct.length, 0, "팬 화면 필터도 숨김");
  assert.deepEqual(only(run({})).tags, [], "켜져 있으면 꼬리표 없음");
});

// ── 리뷰(2026-10-27) 반례: 틀렸는데 🟢 로 나오던 경로들 ──────────────────────────
test("리뷰 HIGH: 화면 설정 리셋·비밀번호/링크 리셋 전 후원은 그때 재료가 지워졌으니 🟡", () => {
  for (const scope of [{ screenState: true }, { pins: true }]) {
    const row = only(run({ audits: [BASELINE(), audit("data_reset", "2026-10-11T00:00:00", { scope })] }));
    assert.equal(row.cls, "yellow", JSON.stringify(scope));
    assert.ok(row.reasonText.includes("데이터 초기화 전"));
  }
  assert.equal(only(run({ audits: [BASELINE(), audit("data_reset", "2026-10-11T00:00:00", { scope: { donations: true, coupons: true } })] })).cls, "green", "후원집계·쿠폰만 지운 초기화는 무관");
});

test("헤르메스: 달력에 없는 날짜(2026-02-30)는 굴리지 않고 '시각을 못 읽음'", () => {
  const row = only(run({ rows: [{ time: "2026-02-30 12:00:00" }] }));
  assert.equal(row.timeMs, null);
  assert.ok(row.reasons.some((r) => r.includes("후원 시각")));
});

test("헤르메스: '×2'·'*2'·'두배 찬스' 같은 두배권 이름도 G7(🟡)로 잡는다 — 칸이 표에 있을 때와 결과 자체일 때", () => {
  for (const name of ["다음 룰렛 ×2", "다음 룰렛 *2", "두배 찬스", "더블 찬스"]) {
    const tables: Tbl[] = [{ amount: 33, items: [["단컷", 2], [name, 3], ["하트", 95]] }];
    const plain = only(run({ catalogs: [catRow(1, "2026-10-01T00:00:00", tables)] }));
    assert.equal(plain.cls, "yellow", `${name}: 같은 표의 일반 상품`);
    const self = only(run({ catalogs: [catRow(1, "2026-10-01T00:00:00", tables)], rows: [{ item: name, prob: 3 }] }));
    assert.equal(self.cls, "yellow", `${name}: 두배권 칸 자체`);
  }
});

test("두배권 확정이 후원 뒤에 있었으면 그때 칸을 ⚪ 로 빼지 않는다(t 이전 규칙만) — 대신 🟡", () => {
  const tables: Tbl[] = [{ amount: 33, items: [["다음 룰렛 2배", 3], ["하트", 97]] }];
  const cell = normalizeCatalogCapture({ groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "다음 룰렛 2배", probability: 3, sortOrder: 0 }] }] }).items[0];
  const rule = { rule: { ruleKey: specialRuleKeyForItem(cell), ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2, amountRangeLabel: "33", itemName: cell.itemName, normalizedName: cell.normalizedName, probability: 3 } };
  const after = run({ catalogs: [catRow(1, "2026-10-01T00:00:00", tables)], audits: [BASELINE(), audit("special_item_rule", "2026-10-12T00:00:00", rule)], rows: [{ item: "다음 룰렛 2배", prob: 3 }] });
  assert.equal(after.summary.excluded.modifier, 0);
  assert.equal(only(after).cls, "yellow");
  const before = run({ catalogs: [catRow(1, "2026-10-01T00:00:00", tables)], audits: [BASELINE(), audit("special_item_rule", "2026-10-05T00:00:00", rule)], rows: [{ item: "다음 룰렛 2배", prob: 3 }] });
  assert.equal(before.summary.excluded.modifier, 1, "그때 이미 확정이면 ⚪");
});

test("헤르메스: 원본 고유번호(sourceUid)가 없는 결과는 같은 초 같은 후원이 합쳐졌을 수 있어 🟡", () => {
  const out = run({ rows: [{ uid: null }, { uid: null }] });
  assert.equal(out.summary.N, 1, "같은 모양 2줄이 열쇠 1개로 합쳐진다(실시간과 같은 열쇠 규칙)");
  assert.ok(only(out).reasonText.includes("고유번호"));
});

test("헤르메스: 그때 표엔 옛 이름이 맞아도, 수동기록을 새 이름(이름 연결 대상)으로 적었으면 겹침 의심", () => {
  const out = run({
    rows: [{ item: "옛사진", prob: 2 }],
    catalogs: [catRow(1, "2026-10-01T00:00:00", [{ amount: 33, items: [["옛사진", 2], ["하트", 98]] }]), catRow(2, "2026-10-20T00:00:00", [{ amount: 33, items: [["새사진", 2], ["하트", 98]] }])],
    aliases: { "33::옛사진::2": { itemName: "새사진", probability: 2 } },
    manual: [{ id: "m1", fanId: "viewer01", fanNickname: "시청자", itemName: "새사진", donateTimeText: "2026-10-10 12:00", remaining: 1 }],
  });
  const row = only(out);
  assert.equal(row.judged.version, 1);
  assert.equal(row.manualOverlap?.level, "strong");
  assert.equal(row.cls, "yellow");
});

test("리뷰: 늦게 적은 수동기록(후원 3일 뒤 날짜)도 겹침 의심", () => {
  const row = only(run({ manual: [{ id: "m1", fanId: "viewer01", fanNickname: "시청자", itemName: "단컷", donateTimeText: "2026-10-13 12:00", remaining: 1 }] }));
  assert.equal(row.manualOverlap?.level, "weak");
  assert.equal(row.cls, "yellow");
});

test("리뷰: 위플랩 수정시간을 모르는 표 교체 — 다음 표로 판정하면 결과가 달라지면 🟡(next_conflict)", () => {
  // v1 에서 단컷 끔 → v2 저장본 {}(전부 켬) → v3(같은 칸) 는 저장본이 없어 v1 의 "끔"을 승계한다(설정 있는 직전 버전).
  const t3: Tbl[] = [{ amount: 33, items: [["단컷", 2], ["하트", 98]] }];
  const out = run({
    catalogs: [catRow(1, "2026-10-01T00:00:00", t3), catRow(2, "2026-10-05T00:00:00", t3), catRow(3, "2026-10-12T00:00:00", t3)],
    audits: [
      BASELINE(),
      audit("catalog_usage_updated", "2026-10-02T00:00:00", { catalogVersion: 1, overrides: { "g0-i0": false } }),
      audit("catalog_usage_updated", "2026-10-06T00:00:00", { catalogVersion: 2, overrides: {} }),
    ],
  });
  const row = only(out);
  assert.equal(row.judged.version, 2);
  assert.equal(row.ambiguity, "next_conflict");
  assert.equal(row.cls, "yellow");
});

test("헤르메스 재검토: 같은 결과 키인데 원본 묶음마다 후원 시각·종류가 다르면 🟡(G10)", () => {
  const timeDiff = run({
    batches: [
      { batchId: "b1", capture: capture([{ uid: "k1", time: "2026-10-10 12:00:00" }]) },
      { batchId: "b2", capture: capture([{ uid: "k1", time: "2026-10-20 12:00:00" }]) },
    ],
  });
  assert.ok(only(timeDiff).reasonText.includes("다른 상품으로 잡힌 적"));
  const typeDiff = run({
    batches: [
      { batchId: "b1", capture: capture([{ uid: "k1" }]) },
      { batchId: "b2", capture: capture([{ uid: "k1", type: "도전미션 별풍선 성공" }]) },
    ],
  });
  assert.equal(only(typeDiff).cls, "yellow");
});

test("헤르메스 재검토: 실시간 탐지가 못 알아보는 이름의 두배권도 t 이전 확정이면 옛·새 버전 칸 모두 ⚪", () => {
  const v1: Tbl[] = [{ amount: 33, items: [["행운권", 3], ["하트", 97]] }];
  const v2: Tbl[] = [{ amount: 33, items: [["행운권", 5], ["하트", 95]] }];
  const cell = normalizeCatalogCapture({ groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "행운권", probability: 3, sortOrder: 0 }] }] }).items[0];
  const out = run({
    catalogs: [catRow(1, "2026-10-01T00:00:00", v1), catRow(2, "2026-10-10T00:00:00", v2)],
    audits: [
      BASELINE(),
      audit("special_item_rule", "2026-10-02T00:00:00", { rule: { ruleKey: specialRuleKeyForItem(cell), ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2, amountRangeLabel: "33", itemName: cell.itemName, normalizedName: cell.normalizedName, probability: 3 } }),
    ],
    rows: [{ item: "행운권", prob: 5, time: "2026-10-12 12:00:00" }],
  });
  assert.equal(out.summary.excluded.modifier, 1, "v2 칸(5%)은 ruleKey 가 달라도 이름으로 두배권");
  assert.equal(out.rows.length, 0);
});
