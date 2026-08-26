// 배송관리 시각 표시 + 시트 보기(B뷰) 재료 고정 테스트.
//  ① parseDonateTimeMs — 위플랩 원문 시각 해석(+09:00). 이형 포맷("MM-DD HH:MM")은 실패=null 이어야
//     경과일·정렬이 엉뚱한 값으로 굳지 않는다.
//  ② entryRecordedAt — 기록 시각의 출처 규칙(원문 우선, 수동/교환은 createdAt 폴백).
//  ③ allocateDeliveryToRefs — "수량이 진실, 배정은 힌트, 남으면 오래된 것부터(FIFO)" 배분 규칙.
import { allocateDeliveryToRefs, entryRecordedAt, parseDonateTimeMs } from "../lib/api";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ── ① parseDonateTimeMs ──────────────────────────────────────────────────────
assertEq(parseDonateTimeMs("2026-06-10 20:45:53"), Date.parse("2026-06-10T20:45:53+09:00"), "초 포함 원문");
assertEq(parseDonateTimeMs("2026-06-10 20:45"), Date.parse("2026-06-10T20:45:00+09:00"), "초 없음");
assertEq(parseDonateTimeMs("26-06-10 20:45"), Date.parse("2026-06-10T20:45:00+09:00"), "2자리 연도");
assertEq(parseDonateTimeMs("  2026-06-10   20:45  "), Date.parse("2026-06-10T20:45:00+09:00"), "공백 정리");
assertEq(parseDonateTimeMs("07-18 21:00"), null, "연도 없는 이형 포맷은 실패(월 18 불가)");
assertEq(parseDonateTimeMs(""), null, "빈 값");
assertEq(parseDonateTimeMs(undefined), null, "undefined");
assertEq(parseDonateTimeMs("별풍선 100개"), null, "시각 아님");

// ── ② entryRecordedAt ────────────────────────────────────────────────────────
const CREATED = "2026-08-01T03:00:00.000Z";
assertEq(
  entryRecordedAt({ sourceKey: "abc", donateTimeText: "2026-06-10 20:45", createdAt: CREATED }),
  { ms: Date.parse("2026-06-10T20:45:00+09:00"), kind: "donate" },
  "원문 시각 우선",
);
assertEq(
  entryRecordedAt({ sourceKey: "manual:x", donateTimeText: "", createdAt: CREATED }),
  { ms: Date.parse(CREATED), kind: "manual" },
  "수동기록 → createdAt 폴백",
);
assertEq(
  entryRecordedAt({ sourceKey: "exchange:g1", donateTimeText: "", createdAt: CREATED }),
  { ms: Date.parse(CREATED), kind: "exchange" },
  "교환 유입 → createdAt(교환 시각)",
);
assertEq(
  entryRecordedAt({ sourceKey: "wf:1", donateTimeText: "", createdAt: CREATED }),
  { ms: Date.parse(CREATED), kind: "created" },
  "자동수집인데 원문 없음 → 반영 시각",
);
assertEq(
  entryRecordedAt({ sourceKey: "manual:x", donateTimeText: "" }),
  { ms: null, kind: null },
  "시각이 아예 없으면 null",
);
assertEq(
  entryRecordedAt({ sourceKey: "fixed:a:2026-07-15 21:00:00:7777", donateTimeText: "2026-07-15 21:00:00", createdAt: CREATED }),
  { ms: Date.parse("2026-07-15T21:00:00+09:00"), kind: "donate" },
  "정가 기록도 원문 우선",
);

// ── ③ allocateDeliveryToRefs ─────────────────────────────────────────────────
const D1 = Date.parse("2026-06-10T20:00:00+09:00");
const D2 = Date.parse("2026-06-12T20:00:00+09:00");
const D3 = Date.parse("2026-06-14T20:00:00+09:00");

// FIFO: 배정 없으면 오래된 것부터 채운다. 입력 순서가 뒤섞여도(확률·수량 정렬) 시각 기준.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "b", quantity: 1, recordedAtMs: D2 },
      { entryId: "a", quantity: 1, recordedAtMs: D1 },
      { entryId: "c", quantity: 1, recordedAtMs: D3 },
    ],
    2,
    {},
  ),
  [
    { allocated: 1, state: "done", doneAt: null },
    { allocated: 1, state: "done", doneAt: null },
    { allocated: 0, state: "pending", doneAt: null },
  ],
  "FIFO 오래된 순(2건 처리 → D2·D1 완료, D3 대기)",
);

// 시각 없는 조각은 맨 뒤.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "x", quantity: 1, recordedAtMs: null },
      { entryId: "y", quantity: 1, recordedAtMs: D1 },
    ],
    1,
    {},
  ),
  [
    { allocated: 0, state: "pending", doneAt: null },
    { allocated: 1, state: "done", doneAt: null },
  ],
  "시각 없음은 FIFO 맨 뒤",
);

// 배정 힌트가 FIFO 보다 우선 — 스트리머가 콕 집은 줄이 완료로 남는다.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "old", quantity: 1, recordedAtMs: D1 },
      { entryId: "new", quantity: 1, recordedAtMs: D3 },
    ],
    1,
    { new: { doneCount: 1, doneAt: "2026-08-25T11:45:00.000Z" } },
  ),
  [
    { allocated: 0, state: "pending", doneAt: null },
    { allocated: 1, state: "done", doneAt: "2026-08-25T11:45:00.000Z" },
  ],
  "배정 힌트 우선(새 줄을 콕 집어 완료)",
);

// 수량이 진실: 배정이 있어도 처리수량이 모자라면 배정 초과분은 완료가 못 된다.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "a", quantity: 2, recordedAtMs: D1 },
      { entryId: "b", quantity: 2, recordedAtMs: D2 },
    ],
    3,
    { b: { doneCount: 2, doneAt: "2026-08-25T11:45:00.000Z" } },
  ),
  [
    { allocated: 1, state: "part", doneAt: null },
    { allocated: 2, state: "done", doneAt: "2026-08-25T11:45:00.000Z" },
  ],
  "배정 2 + FIFO 1 = 처리 3 (부분 조각 표시)",
);

// 배정 doneCount 가 조각 수량보다 작으면 전량 완료가 아니라 부분 — doneAt 은 안 싣는다.
assertEq(
  allocateDeliveryToRefs(
    [{ entryId: "a", quantity: 2, recordedAtMs: D1 }],
    1,
    { a: { doneCount: 1, doneAt: "2026-08-25T11:45:00.000Z" } },
  ),
  [{ allocated: 1, state: "part", doneAt: null }],
  "부분 배정은 doneAt 미표시(수량 기준 보정 대상)",
);

// 처리수량 0 → 전부 대기. 배정이 남아 있어도 수량이 진실.
assertEq(
  allocateDeliveryToRefs(
    [{ entryId: "a", quantity: 1, recordedAtMs: D1 }],
    0,
    { a: { doneCount: 1, doneAt: "2026-08-25T11:45:00.000Z" } },
  ),
  [{ allocated: 0, state: "pending", doneAt: null }],
  "수량 0 이면 배정 무시(FIFO 보정 규칙의 극단)",
);

// 처리수량이 전체 초과여도 조각 수량 이상은 못 채운다(안전 클램프).
assertEq(
  allocateDeliveryToRefs(
    [{ entryId: "a", quantity: 2, recordedAtMs: D1 }],
    99,
    {},
  ),
  [{ allocated: 2, state: "done", doneAt: null }],
  "초과 수량 클램프",
);

// pin(doneAt="") = 시각 미상의 기존 완료 고정 — 시각 있는 배정보다 먼저 채워져 FIFO 재배치를 막는다.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "pinned", quantity: 1, recordedAtMs: D3 },
      { entryId: "timed", quantity: 1, recordedAtMs: D1 },
    ],
    1,
    {
      pinned: { doneCount: 1, doneAt: "" },
      timed: { doneCount: 1, doneAt: "2026-08-25T11:45:00.000Z" },
    },
  ),
  [
    { allocated: 1, state: "done", doneAt: null },
    { allocated: 0, state: "pending", doneAt: null },
  ],
  "pin 이 시각 있는 배정보다 먼저(완료 고정), doneAt 은 미표시(수량 기준)",
);

// 힌트 순서는 doneAt 원문 문자열이 아니라 해석된 시각(ms) 기준 — 시간대 표기가 섞여도 안 틀어진다.
assertEq(
  allocateDeliveryToRefs(
    [
      { entryId: "kst", quantity: 1, recordedAtMs: D1 },
      { entryId: "utc", quantity: 1, recordedAtMs: D2 },
    ],
    1,
    {
      // KST 20:00(+09:00) = UTC 11:00 → UTC 12:00Z 보다 이르다. 문자열 비교면 "2026-08-25T12" < "2026-08-25T20" 로 반대.
      kst: { doneCount: 1, doneAt: "2026-08-25T20:00:00+09:00" },
      utc: { doneCount: 1, doneAt: "2026-08-25T12:00:00.000Z" },
    },
  ),
  [
    { allocated: 1, state: "done", doneAt: "2026-08-25T20:00:00+09:00" },
    { allocated: 0, state: "pending", doneAt: null },
  ],
  "힌트 순서 = 해석된 ms (시간대 혼합 안전)",
);

console.log("delivery-time-sheet: all assertions passed");
