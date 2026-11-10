// 관문 1 "놓쳤을 수 있는 기록" 순수 로직: 의심 수·표 밖 종류 정책·금액대 기준.
import test from "node:test";
import assert from "node:assert/strict";
import {
  countSuspects,
  foldMissingCandidatePolicies,
  kindKeyOfResult,
  missingKindKey,
  sumSuspectCounts,
  thresholdForAmount,
  withSuspectCount,
} from "../lib/missingCandidate";
import { normalizeCatalogCapture, type NormalizedResult, type ReconcileDecision } from "../lib/upboCore";

const items = normalizeCatalogCapture({
  groups: [
    {
      amountMin: 33,
      amountMax: 33,
      items: [
        { name: "단컷", probability: 2, sortOrder: 0 },
        { name: "꺼둔칸", probability: 1, sortOrder: 1 },
      ],
    },
  ],
}).items.map((item) => (item.itemName === "꺼둔칸" ? { ...item, enabled: false } : item));

const review = (patch: Partial<NormalizedResult>): Pick<ReconcileDecision, "decision" | "result"> => ({
  decision: "needs_review",
  result: { itemName: "새상품", probability: 1, donationAmount: 33, donateTimeText: "2026-11-01 12:00:00", ...patch } as NormalizedResult,
});
const base = { catalogItems: items, thresholdPercent: 3, thresholdOverrides: {}, lastUsageSavedMs: null, policies: new Map<string, "exclude">() };

test("countSuspects: 검토함행 + 기준 이하만 센다", () => {
  assert.equal(countSuspects({ ...base, decisions: [review({})] }), 1);
  assert.equal(countSuspects({ ...base, decisions: [review({ probability: 50 })] }), 0, "기준 초과");
  assert.equal(countSuspects({ ...base, decisions: [{ ...review({}), decision: "record" }] }), 0, "기록된 줄");
  assert.equal(countSuspects({ ...base, decisions: [{ ...review({}), decision: "ignore" }] }), 0, "제외된 줄");
});

test("countSuspects: 확률을 못 읽은 줄은 숨기지 않는다", () => {
  assert.equal(countSuspects({ ...base, decisions: [review({ probability: null })] }), 1);
});

test("countSuspects: 지금 꺼 둔 칸은 후원 뒤로 설정이 안 바뀌었을 때만 뺀다", () => {
  const off = review({ itemName: "꺼둔칸", normalizedName: "꺼둔칸" });
  const donated = Date.parse("2026-11-01T12:00:00+09:00");
  assert.equal(countSuspects({ ...base, decisions: [off], lastUsageSavedMs: donated - 3_600_000 }), 0, "그때도 꺼져 있었다");
  assert.equal(countSuspects({ ...base, decisions: [off], lastUsageSavedMs: null }), 0, "설정 이력 없음");
  assert.equal(countSuspects({ ...base, decisions: [off], lastUsageSavedMs: donated + 3_600_000 }), 1, "후원 뒤에 설정이 바뀌어 그때는 켜졌을 수 있다");
});

test("countSuspects: 제외로 정한 종류와 금액대 예외를 반영한다", () => {
  const key = kindKeyOfResult({ donationAmount: 33, itemName: "새상품" });
  assert.equal(countSuspects({ ...base, decisions: [review({})], policies: new Map([[key, "exclude" as const]]) }), 0);
  assert.equal(countSuspects({ ...base, decisions: [review({})], thresholdOverrides: { "33": 0.5 } }), 0);
  assert.equal(countSuspects({ ...base, decisions: [review({ donationAmount: 100 })], thresholdOverrides: { "33": 0.5 } }), 1, "다른 금액대는 전역 기준");
});

test("countSuspects: 표에 같은 이름이 있으면 종류 제외를 적용하지 않는다", () => {
  const key = kindKeyOfResult({ donationAmount: 33, itemName: "단컷" });
  assert.equal(countSuspects({ ...base, decisions: [review({ itemName: "단컷", normalizedName: "단컷", probability: 1.5 })], policies: new Map([[key, "exclude" as const]]) }), 1);
});

test("thresholdForAmount: 단일·구간·콤마 라벨", () => {
  assert.equal(thresholdForAmount({ "33": 1 }, 33, 5), 1);
  assert.equal(thresholdForAmount({ "33~50": 1 }, 40, 5), 1);
  assert.equal(thresholdForAmount({ "1,000": 2 }, 1000, 5), 2);
  assert.equal(thresholdForAmount({ "1000~": 45 }, 2000, 3), 45, "끝이 열린 금액대");
  assert.equal(thresholdForAmount({ "~50": 45 }, 40, 3), 45, "시작이 열린 금액대");
  assert.equal(thresholdForAmount({ "1000~": 45 }, 999, 3), 3);
  assert.equal(thresholdForAmount({ "33": 1 }, 34, 5), 5);
  assert.equal(thresholdForAmount({ "33": 1 }, null, 5), 5);
  assert.equal(thresholdForAmount({ 아무말: 1 }, 33, 5), 5);
});

test("foldMissingCandidatePolicies: 시각순으로 접고 취소하면 사라진다", () => {
  const key = missingKindKey(33, "5킬");
  const map = foldMissingCandidatePolicies([{ payload: { key, decision: "exclude" } }]);
  assert.equal(map.get(key), "exclude");
  assert.equal(foldMissingCandidatePolicies([{ payload: { key, decision: "exclude" } }, { payload: { key, decision: "include" } }]).size, 0);
  assert.equal(foldMissingCandidatePolicies([{ payload: null }, { payload: { decision: "exclude" } }]).size, 0, "깨진 행 무시");
});

test("withSuspectCount: 0·실패면 옛 배치와 같은 모양", () => {
  const summary = { recordCount: 1 };
  assert.deepEqual(withSuspectCount(summary, 0), summary);
  assert.deepEqual(withSuspectCount(summary, undefined), summary);
  assert.deepEqual(withSuspectCount(summary, 2), { recordCount: 1, suspectCount: 2 });
});

test("sumSuspectCounts: 없는 값·깨진 값은 0", () => {
  assert.equal(sumSuspectCounts([{ summary: { suspectCount: 2 } }, { summary: {} }, { summary: null }, { summary: { suspectCount: "x" } }, { summary: { suspectCount: 3 } }]), 5);
});
