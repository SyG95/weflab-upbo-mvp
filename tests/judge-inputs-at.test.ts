// 후원 시점 근사 판정의 입력 고르기(1단계 묶음 3) — 순수 함수 시험(PHASE1-TEST-PLAN.md §3-1).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ambiguityWindows,
  buildJudgeHistory,
  catalogAt,
  fanUsageByVersionLikeState,
  looksLikeMultiplierName,
  parseDonateTimeMsStrict,
  parseWeflabModifiedAtIso,
  pickJudgeInputsAt,
  specialRulesAt,
  thresholdOverridesAt,
  thresholdPercentAtFast,
  usageAt,
  usageByVersionAt,
  type JudgeHistoryRaw,
  type UsageEngine,
} from "../lib/judgeInputsAt";
import { applyItemAliasesIfUnmatched } from "../lib/itemAlias";
import { thresholdPercentAt } from "../lib/thresholdHistory";
import { applyCatalogUsage, computeEffectiveOverrides } from "../lib/upboSupabase";
import { normalizeCatalogCapture, normalizeResultCapture, specialRuleKeyForItem, type NormalizedResult } from "../lib/upboCore";

const engine: UsageEngine = { computeEffectiveOverrides, applyCatalogUsage };
const kst = (text: string) => new Date(`${text}+09:00`).toISOString();
const t = (text: string) => Date.parse(`${text}+09:00`);

function groupsOf(tables: Array<{ amount: number; items: Array<[string, number]> }>) {
  return normalizeCatalogCapture({
    groups: tables.map((x) => ({
      amountMin: x.amount,
      amountMax: x.amount,
      items: x.items.map(([name, probability], idx) => ({ name, probability, sortOrder: idx })),
    })),
  }).groups;
}

function cat(version: number, capturedKst: string | null, tables: Array<{ amount: number; items: Array<[string, number]> }>) {
  return { id: `c${version}`, version, captured_at: capturedKst ? kst(capturedKst) : null, created_at: null, groups: groupsOf(tables) };
}

let auditSeq = 0;
function audit(action: string, atKst: string, payload: unknown) {
  auditSeq += 1;
  return { id: `a${String(auditSeq).padStart(5, "0")}`, action, created_at: kst(atKst), payload };
}

function history(raw: Partial<JudgeHistoryRaw>) {
  return buildJudgeHistory({ catalogs: [], audits: [], batches: [], currentThresholdPercent: 10, ...raw });
}

function result(item: string, prob: number | null, amount = 33, time = "2026-10-01 12:00:00"): NormalizedResult {
  return normalizeResultCapture({
    rows: [{ sourceUid: "u1", donateTimeText: time, donationAmount: amount, fanId: "f", results: [{ name: item, probability: prob }] }],
  }).results[0];
}

const T33a = { amount: 33, items: [["단컷", 2], ["하트", 98]] as Array<[string, number]> };
const T33b = { amount: 33, items: [["단컷", 3], ["하트", 97]] as Array<[string, number]> };

test("catalogAt: captured_at < t 인 버전 중 번호 최대 — 같은 시각은 이전 버전, 첫 표 이전은 가장 옛 버전+beforeFirst", () => {
  const h = history({ catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-05T00:00:00", [T33b])] });
  assert.deepEqual(catalogAt(t("2026-10-03T00:00:00"), h.catalogs)?.version, 1);
  assert.deepEqual(catalogAt(t("2026-10-05T00:00:00"), h.catalogs)?.version, 1, "같은 시각은 아직 바뀌기 전");
  assert.deepEqual(catalogAt(t("2026-10-05T00:00:01"), h.catalogs)?.version, 2);
  assert.deepEqual(catalogAt(t("2026-09-01T00:00:00"), h.catalogs), { version: 1, capturedAt: kst("2026-10-01T00:00:00"), beforeFirst: true });
  assert.equal(catalogAt(1, []), null);
});

test("catalogAt: A→B→A 는 새 버전(3) — 내용이 v1 과 같아도 번호로 고른다", () => {
  const h = history({
    catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-05T00:00:00", [T33b]), cat(3, "2026-10-09T00:00:00", [T33a])],
  });
  assert.equal(catalogAt(t("2026-10-10T00:00:00"), h.catalogs)?.version, 3);
  assert.equal(catalogAt(t("2026-10-06T00:00:00"), h.catalogs)?.version, 2);
});

test("usageByVersionAt: 빈 저장 {} 는 found(승계 안 함), 저장 없음은 맵에 없음(승계함), created_at < t 만", () => {
  const h = history({
    catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-05T00:00:00", [T33a])],
    audits: [
      audit("catalog_usage_updated", "2026-10-02T00:00:00", { catalogVersion: 1, overrides: { "g0-i0": false } }),
      audit("catalog_usage_updated", "2026-10-06T00:00:00", { catalogVersion: 2, overrides: {} }),
    ],
  });
  const at = usageByVersionAt(h.usage, t("2026-10-07T00:00:00"));
  assert.deepEqual(at.get(2)?.overrides, {});
  assert.equal(at.get(2)?.found, true);
  // 10/06 저장 전에는 v2 저장본이 없다 → 승계(v1 의 단컷 꺼짐)
  assert.equal(usageByVersionAt(h.usage, t("2026-10-06T00:00:00")).has(2), false, "같은 시각은 아직 저장 전");
  const before = usageAt(t("2026-10-05T12:00:00"), 2, h, engine);
  assert.deepEqual(before, { overrides: { "g0-i0": false }, source: "carry", eventId: h.usage[0].id, approximate: false });
  const after = usageAt(t("2026-10-07T00:00:00"), 2, h, engine);
  assert.deepEqual(after, { overrides: {}, source: "own", eventId: h.usage[1].id, approximate: false });
});

test("usageByVersionAt: 이력이 200건을 넘어도 그때 값이 정확하다(실시간 화면의 200건 한도와 무관)", () => {
  const audits = [];
  for (let i = 0; i < 250; i += 1) {
    const day = String(1 + Math.floor(i / 24)).padStart(2, "0");
    const hour = String(i % 24).padStart(2, "0");
    audits.push(audit("catalog_usage_updated", `2026-10-${day}T${hour}:00:00`, { catalogVersion: i === 3 ? 1 : 2, overrides: { [`g0-i${i % 2}`]: i % 3 === 0 } }));
  }
  const h = history({ catalogs: [cat(1, "2026-09-01T00:00:00", [T33a]), cat(2, "2026-09-02T00:00:00", [T33a])], audits });
  // v1 은 4번째(i=3, 10/01 03:00) 저장 1건뿐 — 최근 200건 밖이지만 그때 값으로는 정확히 나와야 한다
  const at = usageByVersionAt(h.usage, t("2026-10-20T00:00:00"));
  assert.deepEqual(at.get(1)?.overrides, { "g0-i1": true });
  // 팬 화면 규칙(최근 200건)으로는 v1 저장본이 안 보인다 — getStreamerState 와 같은 한계를 그대로 재현
  assert.equal(fanUsageByVersionLikeState(h, engine)[1], undefined);
});

test("usageAt: 실시간 computeEffectiveOverrides 와 같은 값(그때까지의 저장본으로 부른 결과), 배포 확인 전은 근사", () => {
  const h = history({
    catalogs: [cat(1, "2026-08-01T00:00:00", [T33a]), cat(2, "2026-08-20T00:00:00", [T33b])],
    audits: [audit("catalog_usage_updated", "2026-08-02T00:00:00", { catalogVersion: 1, overrides: { g0: false } })],
  });
  const direct = computeEffectiveOverrides(2, h.groupsByVersion[2], { 1: { g0: false } }, h.groupsByVersion);
  const got = usageAt(t("2026-08-25T00:00:00"), 2, h, engine);
  assert.deepEqual(got.overrides, direct);
  assert.equal(got.approximate, true, "승계 규칙 변경 배포 확인(9/17 09:23) 전");
  assert.equal(usageAt(t("2026-09-17T09:23:05"), 2, h, engine).approximate, true);
  assert.equal(usageAt(t("2026-09-17T09:23:06"), 2, h, engine).approximate, false);
});

test("thresholdOverridesAt: t 이전 최신 스냅샷, 8/14 신설 전은 예외 없음, 키는 금액대 라벨", () => {
  const h = history({
    audits: [
      audit("threshold_overrides_updated", "2026-08-10T00:00:00", { overrides: { "170": 45 } }),
      audit("threshold_overrides_updated", "2026-10-24T12:50:00", { overrides: { "170": 40 } }),
    ],
  });
  assert.deepEqual(thresholdOverridesAt(t("2026-08-12T00:00:00"), h.overrides).overrides, {}, "8/14 전은 정답이 '예외 없음'");
  assert.deepEqual(thresholdOverridesAt(t("2026-10-24T12:49:00"), h.overrides).overrides, { "170": 45 });
  assert.deepEqual(thresholdOverridesAt(t("2026-10-24T12:50:00"), h.overrides).overrides, { "170": 45 }, "같은 시각은 바뀌기 전");
  assert.deepEqual(thresholdOverridesAt(t("2026-10-25T00:00:00"), h.overrides).overrides, { "170": 40 });
});

test("specialRulesAt: 옛 버전 두배권 칸(확률만 다름)도 t 이전에 같은 금액대·이름이 확정이면 두배권, t 뒤 확정은 안 씀", () => {
  const v1 = groupsOf([{ amount: 33, items: [["다음 룰렛 2배", 3], ["하트", 97]] }]);
  const v2 = groupsOf([{ amount: 33, items: [["다음 룰렛 2배", 5], ["하트", 95]] }]);
  const v2Cell = v2[0].items[0];
  // 스트리머는 v2 때(10/10) 두배권을 확정했다 — v1 칸(3%)의 ruleKey 와 다르다
  const h = history({
    catalogs: [
      { id: "c1", version: 1, captured_at: kst("2026-10-01T00:00:00"), created_at: null, groups: v1 },
      { id: "c2", version: 2, captured_at: kst("2026-10-05T00:00:00"), created_at: null, groups: v2 },
    ],
    audits: [
      audit("special_item_rule", "2026-10-10T00:00:00", {
        rule: { ruleKey: specialRuleKeyForItem(v2Cell), ruleType: "next_result_multiplier", status: "confirmed", multiplier: 2, amountRangeLabel: "33", itemName: v2Cell.itemName, normalizedName: v2Cell.normalizedName, probability: 5 },
      }),
    ],
  });
  assert.equal(specialRulesAt(t("2026-10-03T00:00:00"), h.rules, h.catalogs[0].items)[0].status, "candidate", "확정(10/10)보다 앞선 후원엔 안 씀");
  const later = specialRulesAt(t("2026-10-11T00:00:00"), h.rules, h.catalogs[0].items);
  assert.equal(later[0].probability, 3);
  assert.equal(later[0].status, "confirmed", "확정 뒤 후원이면 옛 칸(3%)도 이름으로 두배권");
  const other = specialRulesAt(t("2026-10-11T00:00:00"), h.rules, groupsOf([{ amount: 330, items: [["다음 룰렛 2배", 3]] }])[0].items);
  assert.equal(other[0].status, "candidate", "다른 금액대는 확정 아님");
});

test("thresholdPercentAtFast: thresholdHistory.thresholdPercentAt 과 무작위 시각에서 같은 값", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const audits = [];
  let before = 2;
  for (let i = 0; i < 40; i += 1) {
    const after = [2, 3, 5, 10][Math.floor(rnd() * 4)];
    const gap = rnd() < 0.2; // 가끔 기록 없이 바뀐 흔적(before 가 직전 after 와 다름)
    audits.push(audit("threshold_percent_updated", `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00`, { before: gap ? 7 : before, after, source: "settings" }));
    before = after;
  }
  const batches = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}`, applied_at: kst(`2026-09-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:30:00`), threshold_percent: [2, 4, 6][i % 3] }));
  const h = history({ audits, batches, currentThresholdPercent: 5 });
  for (let i = 0; i < 500; i += 1) {
    const tMs = Date.parse("2026-08-25T00:00:00+09:00") + Math.floor(rnd() * 45 * 86_400_000);
    const want = thresholdPercentAt(tMs, h.thresholdHistory, h.thresholdBatches, 5);
    assert.deepEqual(thresholdPercentAtFast(tMs, h), want, new Date(tMs).toISOString());
  }
});

test("parseDonateTimeMsStrict: 달력에 없는 날짜는 굴리지 않고 null", () => {
  assert.equal(parseDonateTimeMsStrict("2026-10-21 19:12:40"), Date.parse("2026-10-21T19:12:40+09:00"));
  assert.equal(parseDonateTimeMsStrict("26-10-21 19:12"), Date.parse("2026-10-21T19:12:00+09:00"));
  for (const bad of ["2026-02-30 12:00:00", "2026-02-29 12:00:00", "2026-13-01 12:00", "2026-10-01 24:00", ""]) {
    assert.equal(parseDonateTimeMsStrict(bad), null, bad);
  }
  assert.ok(parseDonateTimeMsStrict("2028-02-29 12:00:00") !== null, "윤년");
});

test("looksLikeMultiplierName: 실시간 후보 탐지보다 넓게(🟡 로 올리는 데만 씀)", () => {
  for (const name of ["다음 룰렛 2배", "다음 룰렛 ×2", "다음룰렛 *2", "두배 찬스", "더블 찬스", "2x 보상", "Double"]) {
    assert.equal(looksLikeMultiplierName(name), true, name);
  }
  for (const name of ["단컷", "하트", "사진10장", "22개 세트", "x20 묶음"]) assert.equal(looksLikeMultiplierName(name), false, name);
});

test("parseWeflabModifiedAtIso: 위플랩 수정시간 글자 → KST ISO, 모양이 다르거나 없는 날짜면 null", () => {
  assert.equal(parseWeflabModifiedAtIso("2026년 09월 07일 04시 14분 28초"), "2026-09-07T04:14:28+09:00");
  assert.equal(parseWeflabModifiedAtIso("2026년 9월 7일 4시 14분"), "2026-09-07T04:14:00+09:00");
  assert.equal(parseWeflabModifiedAtIso("2026년 02월 30일 04시 14분 28초"), null, "없는 날짜");
  assert.equal(parseWeflabModifiedAtIso(""), null);
  assert.equal(parseWeflabModifiedAtIso("어제"), null);
});

test("ambiguityWindows: 수정 < 수집 구간, 같은 수정시간을 다시 가져온 건 새 구간이 아님", () => {
  const catalogs = history({ catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-24T12:41:30", [T33b])] }).catalogs;
  const link = (atKst: string, modified: string, fetchedKst = atKst) => ({
    id: atKst,
    atMs: t(atKst),
    fetchedMs: t(fetchedKst),
    modifiedText: modified,
    modifiedMs: Date.parse(parseWeflabModifiedAtIso(modified) ?? ""),
  });
  const windows = ambiguityWindows(catalogs, [
    link("2026-10-24T12:41:35", "2026년 10월 24일 12시 38분 05초"),
    link("2026-10-26T09:00:00", "2026년 10월 24일 12시 38분 05초"),
    link("2026-10-27T09:00:00", "2026년 10월 27일 10시 00분 00초"), // 수정 시각이 가져온 시각보다 뒤(시계 어긋남) → 구간 없음
  ]);
  assert.deepEqual(windows, [{ fromMs: t("2026-10-24T12:38:05"), toMs: t("2026-10-24T12:41:35"), version: 2, modifiedText: "2026년 10월 24일 12시 38분 05초" }]);
});

test("pickJudgeInputsAt: 애매 구간에서는 결과의 (상품, 확률)로 버전을 고르고 '애매' 표시", () => {
  const h = history({
    catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-24T12:41:30", [T33b])],
    audits: [
      audit("weflab_link_updated", "2026-10-24T12:41:35", { link: { lastFetchedAt: kst("2026-10-24T12:41:35"), lastModifiedText: "2026년 10월 24일 12시 38분 05초" } }),
    ],
  });
  const tIn = t("2026-10-24T12:40:00");
  assert.equal(pickJudgeInputsAt(tIn, h, engine, result("단컷", 3))?.version, 2, "새 표 확률(3%)이면 새 표");
  assert.equal(pickJudgeInputsAt(tIn, h, engine, result("단컷", 2))?.version, 1, "옛 표 확률(2%)이면 옛 표");
  assert.equal(pickJudgeInputsAt(tIn, h, engine, result("단컷", 2))?.ambiguity, "window");
  const outside = pickJudgeInputsAt(t("2026-10-20T00:00:00"), h, engine, result("단컷", 2));
  assert.equal(outside?.version, 1);
  assert.equal(outside?.tableAmbiguous, false);
});

test("pickJudgeInputsAt: 수정시간 모르는 표 교체 — 그때 표엔 없고 다음 표에만 맞으면 다음 표 + 애매", () => {
  const h = history({ catalogs: [cat(1, "2026-10-01T00:00:00", [T33a]), cat(2, "2026-10-05T00:00:00", [T33b])] });
  const picked = pickJudgeInputsAt(t("2026-10-03T00:00:00"), h, engine, result("단컷", 3));
  assert.equal(picked?.version, 2);
  assert.equal(picked?.ambiguity, "next_version");
  const none = pickJudgeInputsAt(t("2026-10-03T00:00:00"), h, engine, result("없는상품", 3));
  assert.equal(none?.version, 1, "어디에도 없으면 그때 표 그대로");
  assert.equal(none?.ambiguity, null);
});

test("pickJudgeInputsAt: 그때 재료를 지우는 초기화(룰렛·확률표·화면 설정·비밀번호/링크) 이전 후원은 preReset", () => {
  const h = history({
    catalogs: [cat(1, "2026-10-01T00:00:00", [T33a])],
    audits: [
      audit("data_reset", "2026-10-10T00:00:00", { scope: { roulette: true, catalogs: false } }),
      audit("data_reset", "2026-10-20T00:00:00", { scope: { screenState: true } }),
      audit("data_reset", "2026-10-25T00:00:00", { scope: { donations: true, coupons: true } }),
    ],
  });
  assert.equal(pickJudgeInputsAt(t("2026-10-09T00:00:00"), h, engine)?.preReset, true);
  assert.equal(pickJudgeInputsAt(t("2026-10-19T00:00:00"), h, engine)?.preReset, true, "화면 설정 리셋은 사용 설정·예외·두배권 이력을 지운다");
  assert.equal(pickJudgeInputsAt(t("2026-10-21T00:00:00"), h, engine)?.preReset, false, "후원집계·쿠폰 초기화는 무관");
});

test("applyItemAliasesIfUnmatched: 그 버전에서 원래 이름이 맞으면(꺼진 칸 포함) 연결하지 않고, 안 맞을 때만 쓴다", () => {
  const versionItems = normalizeCatalogCapture({
    groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "옛이름", probability: 1 }, { name: "새이름", probability: 1 }] }],
  }).items;
  const latestItems = normalizeCatalogCapture({ groups: [{ amountMin: 33, amountMax: 33, items: [{ name: "새이름", probability: 1 }] }] }).items;
  const aliases = { "33::옛이름::1": { itemName: "새이름", probability: 1 } };
  const same = applyItemAliasesIfUnmatched(result("옛이름", 1), versionItems, latestItems, aliases);
  assert.equal(same.aliasUsed, false, "그때 표에 옛이름이 있으면 그대로");
  const disabled = applyItemAliasesIfUnmatched(result("옛이름", 1), versionItems.map((i) => ({ ...i, enabled: false })), latestItems, aliases);
  assert.equal(disabled.aliasUsed, false, "꺼진 칸이어도 원래 이름이 맞으면 연결 안 함");
  const onlyNew = versionItems.filter((i) => i.itemName === "새이름");
  const used = applyItemAliasesIfUnmatched(result("옛이름", 1), onlyNew, latestItems, aliases);
  assert.equal(used.aliasUsed, true);
  assert.equal(used.result.itemName, "새이름");
  assert.equal(used.result.sourceKey, "u1::0", "sourceKey 는 그대로");
  const missing = applyItemAliasesIfUnmatched(result("옛이름", 1), [], latestItems, aliases);
  assert.deepEqual([missing.aliasUsed, missing.aliasTargetMissing], [false, true], "대상이 그 버전에 없으면 바꾸지 않고 알림");
  assert.equal(applyItemAliasesIfUnmatched(result("옛이름", 1), onlyNew, latestItems, {}).aliasUsed, false);
});
