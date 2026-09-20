// 수동기록 날짜(2단계) — 기록 시각 출처 판정(entryRecordedAt)과 저장 형식 헬퍼(lib/manualEntryDate).
// 핵심 보장: ① 옛 수동기록(donateTimeText "")은 kind "manual"·createdAt 폴백 그대로(기존 767건 의미 불변)
//           ② 시각 있는 수동기록만 "manual_dated"  ③ 비-manual + 시각은 여전히 "donate"
//           ④ 저장 문자열: 오늘=현재 KST HH:MM, 어제·고른 날=12:00, 모름="" / API 검증은 형식·달력·시각 범위
import { entryRecordedAt } from "../lib/api";
import {
  isManualDonateTimeText,
  kstNowText,
  kstTodayOf,
  kstYesterdayOf,
  manualDonateTimeText,
  manualEntryDateLabel,
  manualEntryDateValue,
} from "../lib/manualEntryDate";

let passed = 0;

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  passed += 1;
}

const kst = (text: string) => Date.parse(`${text}+09:00`);

// ① 옛 수동기록: 시각 없음 → manual + createdAt 폴백
assertEq(
  entryRecordedAt({ sourceKey: "manual:abc", donateTimeText: "", createdAt: "2026-09-09T00:00:00Z" }),
  { ms: Date.parse("2026-09-09T00:00:00Z"), kind: "manual" },
  "manual + '' → manual/createdAt 폴백",
);
assertEq(
  entryRecordedAt({ sourceKey: "manual:abc", donateTimeText: "" }),
  { ms: null, kind: null },
  "manual + '' + createdAt 없음 → null/null(기존 동작)",
);

// ② 시각 있는 수동기록 → manual_dated(시각은 donateTimeText, KST)
assertEq(
  entryRecordedAt({ sourceKey: "manual:abc", donateTimeText: "2026-09-01 12:00", createdAt: "2026-09-20T03:00:00Z" }),
  { ms: kst("2026-09-01T12:00:00"), kind: "manual_dated" },
  "manual + '2026-09-01 12:00' → manual_dated",
);
assertEq(
  entryRecordedAt({ sourceKey: "manual:abc", donateTimeText: "2026-09-20 21:07" }).kind,
  "manual_dated",
  "manual + 오늘 시각(HH:MM) → manual_dated",
);

// ③ 비-manual + 시각 → donate 그대로(자동수집·교환 경로 불변)
assertEq(
  entryRecordedAt({ sourceKey: "weflab:1", donateTimeText: "2026-09-01 12:00:30" }),
  { ms: kst("2026-09-01T12:00:30"), kind: "donate" },
  "자동수집 + 시각 → donate",
);
assertEq(
  entryRecordedAt({ sourceKey: "exchange:g1:0", donateTimeText: "2026-09-01 12:00" }).kind,
  "donate",
  "exchange + 시각 → donate(기존 분기 불변)",
);
assertEq(
  entryRecordedAt({ sourceKey: "exchange:g1:0", donateTimeText: "", createdAt: "2026-09-09T00:00:00Z" }).kind,
  "exchange",
  "exchange + 시각 없음 → exchange(불변)",
);
assertEq(
  entryRecordedAt({ sourceKey: "weflab:1", donateTimeText: "이상한값", createdAt: "2026-09-09T00:00:00Z" }).kind,
  "created",
  "자동수집 + 해석 불가 → created(불변)",
);

// ④ 저장 형식 — 기준 시각: 2026-09-20 21:07 KST (= 2026-09-20T12:07:00Z)
const now = kst("2026-09-20T21:07:00");
assertEq(kstTodayOf(now), "2026-09-20", "오늘(KST)");
assertEq(kstYesterdayOf(now), "2026-09-19", "어제(KST)");
assertEq(kstNowText(now), "2026-09-20 21:07", "현재 KST HH:MM");
// UTC 로는 전날 밤이지만 KST 로는 다음 날 새벽 — 날짜가 KST 기준으로 잡혀야 한다.
const dawn = Date.parse("2026-09-20T16:30:00Z"); // = 2026-09-21 01:30 KST
assertEq(kstTodayOf(dawn), "2026-09-21", "KST 새벽 = 다음 날");
assertEq(kstNowText(dawn), "2026-09-21 01:30", "KST 새벽 시각 문자열");

assertEq(manualDonateTimeText("today", "", now), "2026-09-20 21:07", "오늘 → 현재 KST 시각");
assertEq(manualDonateTimeText("yesterday", "", now), "2026-09-19 12:00", "어제 → 정오");
assertEq(manualDonateTimeText("pick", "2026-08-05", now), "2026-08-05 12:00", "고른 날짜 → 정오");
assertEq(manualDonateTimeText("pick", " 2026-08-05 ", now), "2026-08-05 12:00", "고른 날짜 trim");
assertEq(manualDonateTimeText("pick", "", now), null, "고르기인데 날짜 없음 → null");
assertEq(manualDonateTimeText("pick", "2026-02-31", now), null, "달력에 없는 날짜 → null");
assertEq(manualDonateTimeText("unknown", "2026-08-05", now), "", "날짜 모름 → ''(옛 수동기록과 동일)");

// 저장된 문자열이 entryRecordedAt 을 통과해 manual_dated 가 되는지(형식 계약 왕복)
for (const mode of ["today", "yesterday", "pick"] as const) {
  const text = manualDonateTimeText(mode, "2026-08-05", now)!;
  assertEq(entryRecordedAt({ sourceKey: "manual:x", donateTimeText: text }).kind, "manual_dated", `${mode} 저장값 → manual_dated`);
}

// API 검증
assertEq(isManualDonateTimeText(""), true, "'' 허용(날짜 모름)");
assertEq(isManualDonateTimeText("2026-09-01 12:00"), true, "정상 형식 허용");
assertEq(isManualDonateTimeText("2026-09-01"), false, "시각 없는 날짜 거부");
assertEq(isManualDonateTimeText("2026-09-01 12:00:00"), false, "초 포함 거부(폼 형식 아님)");
assertEq(isManualDonateTimeText("2026-9-1 12:00"), false, "0 패딩 없음 거부");
assertEq(isManualDonateTimeText("2026-02-31 12:00"), false, "달력에 없는 날짜 거부");
assertEq(isManualDonateTimeText("2026-09-01 25:00"), false, "시 범위 초과 거부");
assertEq(isManualDonateTimeText("2026-09-01 12:60"), false, "분 범위 초과 거부");
assertEq(isManualDonateTimeText("2026-09-01T12:00"), false, "T 구분자 거부");

// 목록 표시·편집 초기값
assertEq(manualEntryDateLabel("2026-09-01 12:00"), "2026.09.01", "표시 YYYY.MM.DD");
assertEq(manualEntryDateLabel(""), "날짜 없음", "'' → 날짜 없음");
assertEq(manualEntryDateLabel(undefined), "날짜 없음", "undefined → 날짜 없음");
assertEq(manualEntryDateValue("2026-09-01 12:00"), "2026-09-01", "편집 초기값 = KST 날짜");
assertEq(manualEntryDateValue(""), "", "편집 초기값 없음");

console.log(`manual-entry-date: all ${passed} assertions passed`);
