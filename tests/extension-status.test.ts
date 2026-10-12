// 확프 하트비트·신호등·원격 스위치(lib/extensionStatus) — 순수 함수 회귀 테스트(수집 레인 1단계, 2026-10-12).
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CONFIG_DEFAULT,
  clampKnownKeysDays,
  extensionConfigSummary,
  extensionScreenSummary,
  formatElapsed,
  knownKeysFromRawRows,
  mergeExtensionConfig,
  normalizeExtensionConfig,
  normalizeHeartbeat,
  trafficLight,
  type HeartbeatPayload,
} from "../lib/extensionStatus";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

// 정상 확프(초록) 본문. 각 테스트는 여기서 한 군데만 바꾼다.
function healthy(): Record<string, unknown> {
  return {
    clientVersion: "0.4.0",
    collectorSessionId: "sess-1",
    autoSyncEnabled: true,
    autoSyncMode: "apply",
    page: { onAlertList: true, loginOk: true, readyState: "complete" },
    screen: {
      rowCount: 100,
      newestRowTime: "2026-10-12 20:59:01",
      oldestRowTime: "2026-10-05 18:00:00",
      rangeText: "26-10-05 00:00 ~ 26-10-12 23:59",
      rangeEndIsToday: true,
      filter: { searchActive: false, minActive: false, typeValue: "all" },
      moreButtonVisible: false,
    },
    collector: {
      lastPostAt: minutesAgo(1),
      lastSuccessAt: minutesAgo(1),
      lastErrorAt: null,
      lastError: null,
      observedRows: 100,
      observedResults: 130,
      autoSeenKeyCount: 900,
    },
  };
}

function light(body: Record<string, unknown>, updatedMinutesAgo = 2) {
  return trafficLight({ status: { updatedAt: minutesAgo(updatedMinutesAgo), payload: normalizeHeartbeat(body) }, now: NOW });
}

function withScreen(patch: Record<string, unknown>) {
  const body = healthy();
  body.screen = { ...(body.screen as Record<string, unknown>), ...patch };
  return body;
}

function withFilter(patch: Record<string, unknown>) {
  const body = healthy();
  const screen = body.screen as Record<string, unknown>;
  body.screen = { ...screen, filter: { ...(screen.filter as Record<string, unknown>), ...patch } };
  return body;
}

test("상태 없음 → 회색(옛 확프)", () => {
  assert.deepEqual(trafficLight({ status: null, now: NOW }), { color: "gray", reasons: ["확프 상태 없음(옛 버전)"] });
});

test("정상 본문 + 2분 전 하트비트 → 초록, 사유 없음", () => {
  assert.deepEqual(light(healthy()), { color: "green", reasons: [] });
});

test("하트비트 30분 초과 → 빨강 'N분 무응답', 정확히 30분은 아직 아님", () => {
  assert.deepEqual(light(healthy(), 45), { color: "red", reasons: ["45분 무응답"] });
  assert.equal(light(healthy(), 30).color, "green");
  assert.deepEqual(light(healthy(), 60 * 5).reasons, ["5시간 무응답"]);
  assert.deepEqual(light(healthy(), 60 * 24 * 3).reasons, ["3일 무응답"]);
});

test("위플랩 로그인 풀림 → 빨강", () => {
  const body = healthy();
  body.page = { onAlertList: true, loginOk: false };
  assert.deepEqual(light(body), { color: "red", reasons: ["위플랩 로그인 풀림"] });
});

test("전송 오류는 최근 10분 안 + 그 뒤 성공이 없을 때만 빨강", () => {
  // healthy() 의 lastSuccessAt 은 1분 전 — 오류가 그보다 나중이어야 "지금 실패 중"
  const recent = healthy();
  recent.collector = { ...(recent.collector as object), lastErrorAt: minutesAgo(0.5), lastError: "HTTP 500" };
  assert.deepEqual(light(recent), { color: "red", reasons: ["전송 오류: HTTP 500"] });
  const neverOk = healthy();
  neverOk.collector = { ...(neverOk.collector as object), lastSuccessAt: null, lastErrorAt: minutesAgo(3), lastError: "HTTP 500" };
  assert.deepEqual(light(neverOk).reasons, ["전송 오류: HTTP 500"]);
  const old = healthy();
  old.collector = { ...(old.collector as object), lastSuccessAt: null, lastErrorAt: minutesAgo(15), lastError: "HTTP 500" };
  assert.equal(light(old).color, "green");
  // 확프 0.4.0: 다음 수집이 성공하면 lastError 만 비우고 lastErrorAt 은 남는다 → 회복으로 본다
  const recovered = healthy();
  recovered.collector = { ...(recovered.collector as object), lastErrorAt: minutesAgo(4), lastError: null, lastSuccessAt: minutesAgo(1) };
  assert.equal(light(recovered).color, "green");
  const noText = healthy();
  noText.collector = { ...(noText.collector as object), lastSuccessAt: minutesAgo(5), lastErrorAt: minutesAgo(1) };
  assert.deepEqual(light(noText).reasons, ["전송 오류: 원인 미상"]);
});

test("빨강이면 노랑 사유는 붙이지 않는다(빨강 사유만, 여러 개면 모두)", () => {
  const body = withFilter({ searchActive: true });
  body.page = { onAlertList: true, loginOk: false };
  assert.deepEqual(light(body, 40), { color: "red", reasons: ["40분 무응답", "위플랩 로그인 풀림"] });
});

test("검색어·최소 금액·종류 필터 → 노랑(각 사유)", () => {
  assert.deepEqual(light(withFilter({ searchActive: true })), { color: "yellow", reasons: ["검색어 걸림"] });
  assert.deepEqual(light(withFilter({ minActive: true })), { color: "yellow", reasons: ["최소 금액 필터"] });
  assert.deepEqual(light(withFilter({ typeValue: "star" })), { color: "yellow", reasons: ["종류 필터"] });
  // 종류 '전체'는 빈 값·all(대소문자 무관) 모두 정상
  assert.equal(light(withFilter({ typeValue: "" })).color, "green");
  assert.equal(light(withFilter({ typeValue: "ALL" })).color, "green");
});

test("기간 끝≠오늘·더보기 보임 → 노랑, 사유는 정해진 순서로 모두", () => {
  assert.deepEqual(light(withScreen({ rangeEndIsToday: false })), { color: "yellow", reasons: ["기간이 오늘까지 아님"] });
  assert.deepEqual(light(withScreen({ moreButtonVisible: true })), { color: "yellow", reasons: ["더보기 숨은 행 있음"] });
  const many = withScreen({ rangeEndIsToday: false, moreButtonVisible: true, filter: { searchActive: true, minActive: true, typeValue: "sub" } });
  assert.deepEqual(light(many).reasons, ["검색어 걸림", "최소 금액 필터", "종류 필터", "기간이 오늘까지 아님", "더보기 숨은 행 있음"]);
});

test("자동기록 꺼짐 → 노랑", () => {
  const body = healthy();
  body.autoSyncEnabled = false;
  assert.deepEqual(light(body), { color: "yellow", reasons: ["자동기록 꺼짐"] });
});

test("후원관리 화면이 아니면 화면 사유(필터·기간·더보기)는 빼고 '화면 아님'만", () => {
  const body = withScreen({ rangeEndIsToday: false, moreButtonVisible: true, filter: { searchActive: true, minActive: false, typeValue: "all" } });
  body.page = { onAlertList: false, loginOk: true };
  body.autoSyncEnabled = false;
  assert.deepEqual(light(body), { color: "yellow", reasons: ["후원관리 화면 아님", "자동기록 꺼짐"] });
});

test("serverNewestCaptureAt 은 색을 바꾸지 않는다(표시용 참고값)", () => {
  const status = { updatedAt: minutesAgo(2), payload: normalizeHeartbeat(healthy()) };
  assert.deepEqual(trafficLight({ status, now: NOW, serverNewestCaptureAt: "2026-10-12T11:59:00.000Z" }), { color: "green", reasons: [] });
  assert.deepEqual(trafficLight({ status, now: NOW, serverNewestCaptureAt: null }), { color: "green", reasons: [] });
});

test("쓰레기 입력도 throw 없이 기본값 — 모르면 초록이 아니다", () => {
  for (const garbage of [undefined, null, "abc", 42, [], [1, 2], { page: "x", screen: 3, collector: [] }]) {
    const payload = normalizeHeartbeat(garbage);
    assert.equal(payload.clientVersion, "");
    assert.equal(payload.page.loginOk, false);
    assert.equal(payload.screen.rowCount, 0);
    assert.equal(payload.screen.newestRowTime, null);
    assert.equal(payload.collector.lastError, null);
    assert.equal(payload.donations, undefined);
    assert.notEqual(trafficLight({ status: { updatedAt: minutesAgo(1), payload }, now: NOW }).color, "green");
  }
});

test("허용 목록만 남기고, 문자열 120자(코드포인트)·숫자 0 이상 정수로 정제", () => {
  const body = healthy() as Record<string, unknown>;
  body.fanNickname = "개인정보";
  body.rows = [{ fanId: "secret" }];
  (body.page as Record<string, unknown>).email = "a@b.c";
  body.clientVersion = `  ${"가".repeat(130)}  `;
  (body.collector as Record<string, unknown>).lastError = "😀".repeat(200);
  (body.collector as Record<string, unknown>).observedRows = -5;
  (body.collector as Record<string, unknown>).observedResults = "12";
  (body.collector as Record<string, unknown>).autoSeenKeyCount = 3.9;
  (body.screen as Record<string, unknown>).rowCount = Number.NaN;
  const payload = normalizeHeartbeat(body) as HeartbeatPayload & Record<string, unknown>;
  assert.equal(payload.fanNickname, undefined);
  assert.equal(payload.rows, undefined);
  assert.deepEqual(Object.keys(payload.page).sort(), ["loginOk", "onAlertList"]);
  assert.equal(Array.from(payload.clientVersion).length, 120);
  assert.equal(Array.from(payload.collector.lastError ?? "").length, 120);
  assert.equal(payload.collector.lastError, "😀".repeat(120));
  assert.equal(payload.collector.observedRows, 0);
  assert.equal(payload.collector.observedResults, 12);
  assert.equal(payload.collector.autoSeenKeyCount, 3);
  assert.equal(payload.screen.rowCount, 0);
  // 되읽기 값·후원집계 상태는 보낸 경우에만 남는다
  assert.equal("lastCatchupAt" in payload.collector, false);
  const withCatchup = normalizeHeartbeat({
    ...healthy(),
    collector: { lastCatchupAt: minutesAgo(5), lastCatchupRows: "7", lastCatchupReason: "more_visible", lastCatchupError: null, pageLoadedAt: minutesAgo(400) },
    donations: { enabled: true, observedRows: 50, lastError: 3 },
  });
  assert.equal(withCatchup.collector.lastCatchupRows, 7);
  assert.equal(withCatchup.collector.lastCatchupReason, "more_visible");
  assert.equal(withCatchup.collector.lastCatchupError, null);
  assert.equal(withCatchup.collector.pageLoadedAt, minutesAgo(400));
  assert.deepEqual(withCatchup.donations, { enabled: true, lastSuccessAt: null, lastErrorAt: null, lastError: "3", observedRows: 50 });
});

test("원격 스위치 정제: 기본값·범위 고정(되읽기 1~336시간, 페이지 1~50, 쿨다운 5~1440분)", () => {
  assert.deepEqual(normalizeExtensionConfig(null), EXTENSION_CONFIG_DEFAULT);
  assert.deepEqual(normalizeExtensionConfig("garbage"), EXTENSION_CONFIG_DEFAULT);
  assert.deepEqual(EXTENSION_CONFIG_DEFAULT, {
    catchupEnabled: false,
    catchupLookbackHours: 48,
    catchupMaxPages: 10,
    catchupCooldownMinutes: 30,
    paused: false,
    staleTabHours: 6,
    staleSweepHours: 3,
  });
  const low = normalizeExtensionConfig({ catchupLookbackHours: 0, catchupMaxPages: -3, catchupCooldownMinutes: 1 });
  assert.deepEqual([low.catchupLookbackHours, low.catchupMaxPages, low.catchupCooldownMinutes], [1, 1, 5]);
  const high = normalizeExtensionConfig({ catchupLookbackHours: 9999, catchupMaxPages: 99, catchupCooldownMinutes: 99999 });
  assert.deepEqual([high.catchupLookbackHours, high.catchupMaxPages, high.catchupCooldownMinutes], [336, 50, 1440]);
  assert.equal(normalizeExtensionConfig({ catchupLookbackHours: "72" }).catchupLookbackHours, 72);
  assert.equal(normalizeExtensionConfig({ catchupMaxPages: "x" }).catchupMaxPages, 10);
  // 불리언은 진짜 true 만
  assert.equal(normalizeExtensionConfig({ catchupEnabled: "true", paused: 1 }).catchupEnabled, false);
  assert.equal(normalizeExtensionConfig({ catchupEnabled: "true", paused: 1 }).paused, false);
  assert.equal(normalizeExtensionConfig({ catchupEnabled: true }).catchupEnabled, true);
});

test("오래 열린 탭 되읽기: staleTabHours 0~48(0=끔, 기본 6), staleSweepHours 1~24(기본 3)", () => {
  // 옛 이벤트(두 키 없음)는 기본값으로 읽힌다 — 확프 catchupDecision 의 기본과 같다
  const legacy = normalizeExtensionConfig({ catchupEnabled: true, catchupLookbackHours: 48, catchupMaxPages: 10, catchupCooldownMinutes: 30, paused: false });
  assert.equal(legacy.staleTabHours, 6);
  assert.equal(legacy.staleSweepHours, 3);
  assert.equal(normalizeExtensionConfig({ staleTabHours: 0 }).staleTabHours, 0, "0 은 '끔'이라 그대로 둔다");
  assert.equal(normalizeExtensionConfig({ staleTabHours: -3 }).staleTabHours, 0);
  assert.equal(normalizeExtensionConfig({ staleTabHours: 99 }).staleTabHours, 48);
  assert.equal(normalizeExtensionConfig({ staleTabHours: "12" }).staleTabHours, 12);
  assert.equal(normalizeExtensionConfig({ staleTabHours: "x" }).staleTabHours, 6);
  assert.equal(normalizeExtensionConfig({ staleSweepHours: 0 }).staleSweepHours, 1);
  assert.equal(normalizeExtensionConfig({ staleSweepHours: 99 }).staleSweepHours, 24);
  assert.equal(normalizeExtensionConfig({ staleSweepHours: 2.6 }).staleSweepHours, 3);
  // 원격으로 끄기: 다른 값은 그대로, staleTabHours 만 0
  const current = { ...EXTENSION_CONFIG_DEFAULT, catchupEnabled: true, staleSweepHours: 5 };
  assert.deepEqual(mergeExtensionConfig(current, { staleTabHours: 0 }), { ...current, staleTabHours: 0 });
  // 목록 표시 한 줄
  assert.equal(
    extensionConfigSummary(EXTENSION_CONFIG_DEFAULT),
    "최근 48시간 · 최대 10쪽 · 쿨다운 30분 · 오래 열린 탭 6시간↑ 3시간마다",
  );
  assert.equal(
    extensionConfigSummary({ ...EXTENSION_CONFIG_DEFAULT, staleTabHours: 0, paused: true }),
    "최근 48시간 · 최대 10쪽 · 쿨다운 30분 · 오래 열린 탭 끔 · 일시정지",
  );
});

test("원격 스위치 병합: 온 키만 바뀌고 undefined·모르는 키는 무시", () => {
  const current = { ...EXTENSION_CONFIG_DEFAULT, catchupMaxPages: 20, paused: true };
  assert.deepEqual(mergeExtensionConfig(current, { catchupEnabled: true }), { ...current, catchupEnabled: true });
  assert.deepEqual(mergeExtensionConfig(current, { catchupEnabled: undefined, hack: 1 }), current);
  assert.deepEqual(mergeExtensionConfig(current, { catchupLookbackHours: 1000 }).catchupLookbackHours, 336);
  assert.deepEqual(mergeExtensionConfig(current, null), current);
});

test("경과 표기와 화면 요약 한 줄", () => {
  assert.equal(formatElapsed(0), "방금");
  assert.equal(formatElapsed(59_000), "방금");
  assert.equal(formatElapsed(5 * 60_000), "5분");
  assert.equal(formatElapsed(3 * 3_600_000), "3시간");
  assert.equal(formatElapsed(3 * 86_400_000), "3일");
  assert.equal(formatElapsed(-5_000), "방금");
  assert.equal(formatElapsed(Number.NaN), "?");
  assert.equal(extensionScreenSummary(normalizeHeartbeat(healthy())), "100행 · 10-05~10-12");
  assert.equal(extensionScreenSummary(normalizeHeartbeat(withScreen({ moreButtonVisible: true }))), "100행 · 10-05~10-12 · 더보기 있음");
  assert.equal(
    extensionScreenSummary(normalizeHeartbeat(withScreen({ rowCount: 3, oldestRowTime: "2026-10-12 01:00:00" }))),
    "3행 · 10-12",
  );
  assert.equal(extensionScreenSummary(normalizeHeartbeat(withScreen({ rowCount: 0, newestRowTime: null, oldestRowTime: null }))), "0행");
  const notList = healthy();
  notList.page = { onAlertList: false, loginOk: true };
  assert.equal(extensionScreenSummary(normalizeHeartbeat(notList)), "후원관리 화면 아님");
});

test("본 키 시드: 확프 content.js 와 같은 결과 열쇠 + 금액 있는 모든 행의 후원 열쇠", () => {
  const capture1 = [
    // sourceKey 그대로
    { sourceUid: "u1", results: [{ index: 0, sourceKey: "u1::0" }, { index: 1, sourceKey: "u1::1" }], donationAmount: 10 },
    // sourceKey 없음 → uid::index, index 없으면 rouletteIndex, 그것도 없으면 0
    { sourceUid: "u2", results: [{ index: 2 }, { rouletteIndex: 5 }, {}] },
    // uid·sourceKey 둘 다 없음 → 열쇠 없음
    { sourceUid: "", fanId: "f3", results: [{ index: 0 }] },
    // 금액 있는 행 → don::{uid||fanId||닉네임}::{시각}::{금액} (결과 유무 무관 — 위 u1 행도)
    { sourceUid: "u4", results: [], donationAmount: 1000, donateTimeText: "2026-10-12 10:00:00" },
    { sourceUid: "", fanId: "f5", fanNickname: "닉5", results: [], donationAmount: 0, donateTimeText: "2026-10-12 10:01:00" },
    { fanNickname: "닉6", donationAmount: 50 },
    // 금액 없음·주인 없음 → 열쇠 없음
    { sourceUid: "u7", results: [], donationAmount: null },
    { sourceUid: "u8", results: [], donationAmount: "" },
    { results: [], donationAmount: 30, donateTimeText: "x" },
  ];
  const capture2 = [{ sourceUid: "u1", results: [{ index: 0, sourceKey: "u1::0" }] }, "garbage", null];
  const keys = knownKeysFromRawRows([capture1, capture2, "not-a-list", null]);
  assert.deepEqual(keys.resultKeys, ["u1::1", "u2::2", "u2::5", "u2::0", "u1::0"]);
  assert.deepEqual(keys.donationKeys, [
    "don::u1::::10",
    "don::u4::2026-10-12 10:00:00::1000",
    "don::f5::2026-10-12 10:01:00::0",
    "don::닉6::::50",
  ]);
  // 결과가 있고 금액도 있는 행: 결과 열쇠와 후원 열쇠를 둘 다 만든다
  const both = knownKeysFromRawRows([[{ sourceUid: "r9", donateTimeText: "2026-10-12 11:00:00", donationAmount: 175, results: [{ index: 0, sourceKey: "r9::0" }] }]]);
  assert.deepEqual(both, { resultKeys: ["r9::0"], donationKeys: ["don::r9::2026-10-12 11:00:00::175"] });
});

test("본 키 시드 상한: 넘치면 가장 최근 것만 남긴다 / days 는 1~14(기본 7)", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ sourceUid: `u${i}`, results: [{ index: 0 }] }));
  const capped = knownKeysFromRawRows([rows], 5);
  assert.deepEqual(capped.resultKeys, ["u7::0", "u8::0", "u9::0", "u10::0", "u11::0"]);
  assert.equal(clampKnownKeysDays(null), 7);
  assert.equal(clampKnownKeysDays("abc"), 7);
  assert.equal(clampKnownKeysDays("0"), 1);
  assert.equal(clampKnownKeysDays("3"), 3);
  assert.equal(clampKnownKeysDays("100"), 14);
});
