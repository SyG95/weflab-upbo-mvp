// 후원 시점 근사 다시판정 — 합성 정답 사례 정확도(PHASE1-TEST-PLAN.md §3-5).
// 밍가연 10/24 모양(표 3버전, 170 표 예외 45→40%, 늦게 몰려 들어온 원본)을 지어낸 값으로 재현했다(실명·계정ID 0).
// 합격선: 🟢 로 분류된 건 중 오답 0, 반례는 전부 🟡 이상, 밍가연형 2건은 "새로 기록될 것", 기준 초과 6건은 ⚪.
import test from "node:test";
import assert from "node:assert/strict";
import { collectDonationTimeCandidates, collectRejudgeCandidates } from "../lib/rejudge";
import { buildJudgeHistory, fanUsageByVersionLikeState, type UsageEngine } from "../lib/judgeInputsAt";
import { applyCatalogUsage, computeEffectiveOverrides } from "../lib/upboSupabase";
import {
  SYNTH_AUDITS,
  SYNTH_BATCHES,
  SYNTH_CATALOGS,
  SYNTH_ENTRIES,
  SYNTH_EXPECTED_SUMMARY,
  SYNTH_RAW_IMPORTS,
  SYNTH_RESULTS,
  SYNTH_STREAMER,
} from "./fixtures/donationTimeSynthetic";
import type { NormalizedCatalogItem, ResultCapture } from "../lib/upboCore";

const engine: UsageEngine = { computeEffectiveOverrides, applyCatalogUsage };

function runSynthetic() {
  const history = buildJudgeHistory({
    catalogs: SYNTH_CATALOGS,
    audits: SYNTH_AUDITS,
    batches: SYNTH_BATCHES,
    currentThresholdPercent: SYNTH_STREAMER.threshold_percent,
  });
  const manual = SYNTH_ENTRIES.filter((e) => e.source_key.startsWith("manual:")).map((e) => ({
    id: e.id,
    fanId: e.fan_id,
    fanNickname: e.fan_nickname,
    itemName: e.item_name,
    donateTimeText: e.donate_time_text,
    remaining: 1,
  }));
  return collectDonationTimeCandidates({
    batches: SYNTH_RAW_IMPORTS.map((r) => ({ batchId: r.batch_id ?? "", capture: r.raw as ResultCapture, savedAt: r.saved_at })),
    history,
    engine,
    existingSourceKeys: new Set(SYNTH_ENTRIES.map((e) => e.source_key)),
    manualEntries: manual,
    aliases: { "33::하트뿅::1": { itemName: "하트뿅뿅", probability: 1 } },
    fanCatalogs: history.catalogs.map((c) => ({ version: c.version, groups: c.groups })),
    fanUsageByVersion: fanUsageByVersionLikeState(history, engine),
    fixedPriceConfig: [{ count: 330 }],
  });
}

test("합성 정답 사례: 요약 숫자가 정답과 같고 N = a + d + c + b", () => {
  const { summary } = runSynthetic();
  const picked = Object.fromEntries(Object.keys(SYNTH_EXPECTED_SUMMARY).map((k) => [k, summary[k as keyof typeof summary]]));
  assert.deepEqual(picked, SYNTH_EXPECTED_SUMMARY);
  assert.equal(summary.N, summary.a + summary.d + summary.c + summary.b);
  assert.equal(summary.excluded.over_threshold, 6, "기준 초과 6건은 ⚪");
});

test("합성 정답 사례: 결과마다 분류가 정답과 같다(🟢 오답 0, 반례는 전부 🟡)", () => {
  const { rows } = runSynthetic();
  const byKey = new Map(rows.map((r) => [r.sourceKey, r]));
  const firstExpect = new Map<string, (typeof SYNTH_RESULTS)[number]>();
  for (const r of SYNTH_RESULTS) if (!firstExpect.has(r.uid)) firstExpect.set(r.uid, r);
  for (const [uid, r] of firstExpect) {
    const row = byKey.get(`${uid}::0`);
    const label = `${uid} ${r.expect.label}`;
    if (r.expect.kind === "new") {
      assert.ok(row && row.kind === "new", `${label}: 새로 기록될 것이어야`);
      assert.equal(row.cls, r.expect.cls, `${label}: ${row.reasons.join(" / ")}`);
      if (r.expect.reasonIncludes) assert.ok(row.reasonText.includes(r.expect.reasonIncludes), `${label}: ${row.reasonText}`);
      assert.equal(row.tags.length > 0, r.expect.hiddenOnFan === true, `${label}: 팬 화면 숨김 꼬리표`);
    } else if (r.expect.kind === "suspected") {
      assert.equal(row?.kind, "suspected", label);
    } else {
      assert.equal(row, undefined, `${label}: 행으로 오면 안 된다(${row?.reasonText})`);
    }
  }
  // 🟢 는 전부 정답이 🟢 인 것뿐(오답 0)
  for (const row of rows.filter((r) => r.cls === "green")) {
    assert.equal(firstExpect.get(row.sourceKey.replace(/::0$/, ""))?.expect.cls, "green", row.sourceKey);
  }
});

test("밍가연형 2건: 그때 표(v2)로는 기록, '지금 표로' 다시판정으로는 0건 — 이번 모드로만 풀린다", () => {
  const { rows } = runSynthetic();
  for (const key of ["synth0101::0", "synth0102::0"]) {
    const row = rows.find((r) => r.sourceKey === key)!;
    assert.equal(row.judged.version, 2);
    assert.equal(row.nowDecision, "needs_review");
  }
  // 현행 다시판정(지금 표 v3)으로 같은 원본을 돌리면 이 두 건은 후보가 아니다
  const v3 = SYNTH_CATALOGS[2];
  const now = collectRejudgeCandidates({
    batches: SYNTH_RAW_IMPORTS.map((r) => ({ batchId: r.batch_id ?? "", capture: r.raw as ResultCapture })),
    catalogItems: v3.items as NormalizedCatalogItem[],
    thresholdPercent: 10,
    existingSourceKeys: new Set(SYNTH_ENTRIES.map((e) => e.source_key)),
  });
  assert.equal(now.candidates.some((c) => c.sourceKey === "synth0101::0" || c.sourceKey === "synth0102::0"), false);
});

test("170 표 예외 함정: 그때 예외 45% 로는 기록(🟢), 지금 예외 40% 로는 제외", () => {
  const row = runSynthetic().rows.find((r) => r.sourceKey === "synth0118::0")!;
  assert.equal(row.cls, "green");
  assert.equal(row.judged.threshold, 45);
  assert.equal(row.nowDecision, "ignore");
});

test("이름 연결 재료는 그때 표로도 못 찾은 결과만(그때 표로 풀리는 건 안 섞는다)", () => {
  const { aliasUnmatched } = runSynthetic();
  assert.deepEqual(aliasUnmatched.map((r) => r.sourceKey), ["synth0115::0"]);
});
