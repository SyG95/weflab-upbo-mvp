import {
  donationDedupKey,
  ingestDonationCapture,
  isMissionPersonal,
  isMissionSuccess,
  isSubscription,
  missionKind,
  normalizeAmounts,
  parseDonateTime,
} from "../lib/donationEvents";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ---------- parseDonateTime: 위플랩 표시 시각(KST) → ISO(+09:00) ----------

// 실수집 데이터의 표준 포맷(초 포함)
assertEq(parseDonateTime("2026-06-01 13:10:02"), "2026-06-01T13:10:02+09:00", "초 포함 풀 포맷");
// 초 없는 포맷은 :00 으로 보정
assertEq(parseDonateTime("2026-07-07 21:05"), "2026-07-07T21:05:00+09:00", "초 없는 포맷");
// 2자리 연도는 20xx 로 해석
assertEq(parseDonateTime("26-07-07 9:05"), "2026-07-07T09:05:00+09:00", "2자리 연도 + 1자리 시");
// 연도 없는 "MM-DD HH:mm"은 추측하지 않는다(연도 잘못 붙이면 기간 합계가 조용히 틀어짐).
// null 로 남겨 기간 필터에서 제외 + unknownTimeCount 경고로 노출하는 것이 정책.
assertEq(parseDonateTime("07-06 12:00"), null, "연도 없는 포맷은 null");
assertEq(parseDonateTime(""), null, "빈 문자열");
assertEq(parseDonateTime("어제"), null, "비정형 문자열");

// ---------- donationDedupKey: uid 우선, 폴백은 사람+시간+수량 ----------

assertEq(
  donationDedupKey({ sourceUid: "u123", fanId: "aaa", donateTimeText: "2026-07-07 21:00:00", donationAmount: 330 }),
  "uid::u123",
  "uid 있으면 uid 키",
);
assertEq(
  donationDedupKey({ fanId: "aaa", donateTimeText: "2026-07-07 21:00:00", donationAmount: 330 }),
  "don::aaa::2026-07-07 21:00:00::330",
  "uid 없으면 사람+시간+수량",
);
assertEq(
  donationDedupKey({ fanNickname: "팬A", donateTimeText: "2026-07-07 21:00:00", donationAmount: null, donationType: "구독" }),
  "don::팬A::2026-07-07 21:00:00::구독",
  "수량 없으면 타입 폴백, 계정ID 없으면 닉네임",
);
assertEq(donationDedupKey({ fanId: "aaa", donationAmount: 330 }), "", "시간 없으면 키 없음(저장 제외)");
assertEq(donationDedupKey({}), "", "빈 행은 키 없음");

// ---------- isSubscription: 구독 판별(개월 단위라 별풍선 순위에서 분리) ----------

assertEq(isSubscription("구독"), true, "구독 타입");
assertEq(isSubscription("구독 3개월"), true, "구독 개월 포함 문자열");
assertEq(isSubscription("별풍선"), false, "별풍선은 구독 아님");
assertEq(isSubscription(null), false, "타입 없으면 구독 아님");

// ---------- isMissionSuccess: 미션 성공 정산 뭉치 판정(첫 후원 계정 합산=이중 기록) ----------

assertEq(isMissionSuccess("대결미션 별풍선 성공"), true, "대결미션 정산(실물 표기)");
assertEq(isMissionSuccess("도전미션 별풍선 성공"), true, "도전미션 정산(실물 표기)");
assertEq(isMissionSuccess("도전미션"), false, "개인 미션 후원은 집계 유지");
assertEq(isMissionSuccess("별풍선"), false, "일반 별풍선");
assertEq(isMissionSuccess(null), false, "타입 없음");

// ---------- isMissionPersonal / missionKind: 미션 개인 후원 + 도전/대결 구분 ----------
// 미션 개인은 룰렛이 돌아 순위/갯수엔 포함되지만 수령 총계에선 뭉치와 이중 카운트 방지로 제외.

assertEq(isMissionPersonal("대결미션 별풍선"), true, "대결미션 개인 후원");
assertEq(isMissionPersonal("도전미션 별풍선"), true, "도전미션 개인 후원");
assertEq(isMissionPersonal("대결미션 별풍선 성공"), false, "정산 뭉치는 개인 아님");
assertEq(isMissionPersonal("별풍선"), false, "일반 후원은 미션 아님");
assertEq(missionKind("대결미션 별풍선 성공"), "대결", "대결 구분");
assertEq(missionKind("도전미션 별풍선 성공"), "도전", "도전 구분");
assertEq(missionKind("별풍선"), "미션", "미션 키워드 없으면 기본값");

// ---------- normalizeAmounts: 룰렛 갯수 조건 정규화 ----------

assertEq(normalizeAmounts("33,330"), [33, 330], "쉼표 목록");
assertEq(normalizeAmounts(" 50 , 500 "), [50, 500], "공백 허용");
assertEq(normalizeAmounts([33, 33, 330]), [33, 330], "중복 제거");
assertEq(normalizeAmounts("abc, -5, 0, 33"), [33], "잘못된 값은 버림");
assertEq(normalizeAmounts(""), [], "빈 입력은 빈 목록(=조건 없음)");

// ---------- ingestDonationCapture: 빈 캡처는 네트워크 없이 0 요약 ----------

async function main() {
  const emptySummary = await ingestDonationCapture({ id: "s1" }, { rows: [] });
  assertEq(emptySummary, { received: 0, accepted: 0, inserted: 0, duplicates: 0, skipped: 0 }, "빈 캡처 요약");

  const skippedSummary = await ingestDonationCapture({ id: "s1" }, {
    rows: [{ fanNickname: "키없는행" }],
  });
  assertEq(
    skippedSummary,
    { received: 1, accepted: 0, inserted: 0, duplicates: 0, skipped: 1 },
    "dedup 키를 만들 수 없는 행은 skipped 로 집계",
  );

  console.log("donation-events tests OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
