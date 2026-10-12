// 확프 하트비트·신호등·원격 스위치(수집 레인 1단계, 2026-10-12) — 순수 함수만(I/O 없음).
//
// 확프 0.4.0 이 5분마다(+시작·탭 복귀 때) 보내는 "생사·위플랩 화면 상태"를 정제하고, 관리자 화면의
// 신호등 색·사유를 계산한다. 저장·조회는 lib/upboSupabase.ts, 수신 라우트는 app/api/extension/heartbeat.
// 설계: meetings/2026-10-12-upbo-structure-review/stage1-collection-design.md §2~3·§9·§12
//
// 원칙
// - 개인정보 없음: 아래 타입에 있는 필드만 남기고 나머지는 버린다(허용 목록). 문자열 120자, 숫자는 0 이상 정수.
// - 쓰레기 입력에도 throw 하지 않는다(기본값). 불리언 기본값은 false → 모르면 초록이 되지 않는다.
// - 색은 서버가 계산하고 화면은 색·사유만 그린다(목록·스트리머 관리자 화면이 같은 규칙).

export type HeartbeatPayload = {
  clientVersion: string;
  collectorSessionId: string;
  autoSyncEnabled: boolean;
  autoSyncMode: string;
  page: { onAlertList: boolean; loginOk: boolean };
  screen: {
    rowCount: number;
    newestRowTime: string | null;
    oldestRowTime: string | null;
    rangeText: string;
    rangeEndIsToday: boolean;
    filter: { searchActive: boolean; minActive: boolean; typeValue: string };
    moreButtonVisible: boolean;
  };
  collector: {
    lastPostAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    observedRows: number;
    observedResults: number;
    autoSeenKeyCount: number;
    lastCatchupAt?: string | null;
    lastCatchupRows?: number;
    lastCatchupReason?: string | null;
    // 확프 0.4.0(~/upbo-beta/extension-v2-next) 이 실제로 보내는 진단값 — 되읽기 실패 사유·탭을 연 시각.
    lastCatchupError?: string | null;
    pageLoadedAt?: string | null;
  };
  donations?: {
    enabled: boolean;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
    observedRows: number;
  };
};

// DB 한 행(스트리머당 1행)을 화면·신호등이 쓰는 모양으로.
export type ExtensionStatus = { updatedAt: string; clientVersion: string; payload: HeartbeatPayload };

const TEXT_MAX = 120;

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// 코드포인트 단위로 자른다(이모지 반쪽 방지).
function text(value: unknown): string {
  let raw = "";
  if (typeof value === "string") raw = value;
  else if (typeof value === "number" && Number.isFinite(value)) raw = String(value);
  else if (typeof value === "boolean") raw = String(value);
  const trimmed = raw.trim();
  return trimmed.length > TEXT_MAX ? Array.from(trimmed).slice(0, TEXT_MAX).join("") : trimmed;
}

function textOrNull(value: unknown): string | null {
  return text(value) || null;
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

function numberOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function count(value: unknown): number {
  const n = numberOf(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1_000_000_000) : 0;
}

export function normalizeHeartbeat(input: unknown): HeartbeatPayload {
  const root = objectOf(input);
  const page = objectOf(root.page);
  const screen = objectOf(root.screen);
  const filter = objectOf(screen.filter);
  const collector = objectOf(root.collector);
  const out: HeartbeatPayload = {
    clientVersion: text(root.clientVersion),
    collectorSessionId: text(root.collectorSessionId),
    autoSyncEnabled: flag(root.autoSyncEnabled),
    autoSyncMode: text(root.autoSyncMode),
    page: { onAlertList: flag(page.onAlertList), loginOk: flag(page.loginOk) },
    screen: {
      rowCount: count(screen.rowCount),
      newestRowTime: textOrNull(screen.newestRowTime),
      oldestRowTime: textOrNull(screen.oldestRowTime),
      rangeText: text(screen.rangeText),
      rangeEndIsToday: flag(screen.rangeEndIsToday),
      filter: {
        searchActive: flag(filter.searchActive),
        minActive: flag(filter.minActive),
        typeValue: text(filter.typeValue),
      },
      moreButtonVisible: flag(screen.moreButtonVisible),
    },
    collector: {
      lastPostAt: textOrNull(collector.lastPostAt),
      lastSuccessAt: textOrNull(collector.lastSuccessAt),
      lastErrorAt: textOrNull(collector.lastErrorAt),
      lastError: textOrNull(collector.lastError),
      observedRows: count(collector.observedRows),
      observedResults: count(collector.observedResults),
      autoSeenKeyCount: count(collector.autoSeenKeyCount),
    },
  };
  // 되읽기(2단계) 관련 값은 보낸 경우에만 남긴다(안 보내는 빌드와 "0"을 구분).
  if (collector.lastCatchupAt !== undefined) out.collector.lastCatchupAt = textOrNull(collector.lastCatchupAt);
  if (collector.lastCatchupRows !== undefined) out.collector.lastCatchupRows = count(collector.lastCatchupRows);
  if (collector.lastCatchupReason !== undefined) out.collector.lastCatchupReason = textOrNull(collector.lastCatchupReason);
  if (collector.lastCatchupError !== undefined) out.collector.lastCatchupError = textOrNull(collector.lastCatchupError);
  if (collector.pageLoadedAt !== undefined) out.collector.pageLoadedAt = textOrNull(collector.pageLoadedAt);
  if (root.donations && typeof root.donations === "object" && !Array.isArray(root.donations)) {
    const donations = objectOf(root.donations);
    out.donations = {
      enabled: flag(donations.enabled),
      lastSuccessAt: textOrNull(donations.lastSuccessAt),
      lastErrorAt: textOrNull(donations.lastErrorAt),
      lastError: textOrNull(donations.lastError),
      observedRows: count(donations.observedRows),
    };
  }
  return out;
}

// ---------- 원격 스위치(서버 설정) ----------
// 저장은 audit_logs(action=extension_config_updated) 최신 1건, 확프는 하트비트 응답으로 받아 그대로 따른다.
// "룰렛 자동기록" 본 스위치는 스트리머 것이라 여기 없다(서버는 paused 로 긴급 정지만, 대신 켜주지 않음).
// 오래 열린 탭 되읽기(확프 0.4.0 catchup-lib catchupDecision): 탭이 staleTabHours 이상 열려 있으면
// staleSweepHours 마다 1회 되읽는다. staleTabHours=0 이면 이 사유를 끈다(서버가 값을 버리면 원격으로 못 끈다).
export type ExtensionConfig = {
  catchupEnabled: boolean;
  catchupLookbackHours: number;
  catchupMaxPages: number;
  catchupCooldownMinutes: number;
  paused: boolean;
  staleTabHours: number;
  staleSweepHours: number;
};

export const EXTENSION_CONFIG_DEFAULT: ExtensionConfig = {
  catchupEnabled: false,
  catchupLookbackHours: 48,
  catchupMaxPages: 10,
  catchupCooldownMinutes: 30,
  paused: false,
  staleTabHours: 6,
  staleSweepHours: 3,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = numberOf(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeExtensionConfig(input: unknown): ExtensionConfig {
  const raw = objectOf(input);
  return {
    catchupEnabled: raw.catchupEnabled === true,
    catchupLookbackHours: clampInt(raw.catchupLookbackHours, 1, 336, EXTENSION_CONFIG_DEFAULT.catchupLookbackHours),
    catchupMaxPages: clampInt(raw.catchupMaxPages, 1, 50, EXTENSION_CONFIG_DEFAULT.catchupMaxPages),
    catchupCooldownMinutes: clampInt(raw.catchupCooldownMinutes, 5, 1440, EXTENSION_CONFIG_DEFAULT.catchupCooldownMinutes),
    paused: raw.paused === true,
    staleTabHours: clampInt(raw.staleTabHours, 0, 48, EXTENSION_CONFIG_DEFAULT.staleTabHours),
    staleSweepHours: clampInt(raw.staleSweepHours, 1, 24, EXTENSION_CONFIG_DEFAULT.staleSweepHours),
  };
}

// 목록 표시용 한 줄: "최근 48시간 · 최대 10쪽 · 쿨다운 30분 · 오래 열린 탭 6시간↑ 3시간마다"(0이면 "오래 열린 탭 끔").
export function extensionConfigSummary(config: ExtensionConfig): string {
  const parts = [
    `최근 ${config.catchupLookbackHours}시간`,
    `최대 ${config.catchupMaxPages}쪽`,
    `쿨다운 ${config.catchupCooldownMinutes}분`,
    config.staleTabHours > 0
      ? `오래 열린 탭 ${config.staleTabHours}시간↑ ${config.staleSweepHours}시간마다`
      : "오래 열린 탭 끔",
  ];
  if (config.paused) parts.push("일시정지");
  return parts.join(" · ");
}

// 온 키만 바꾸고 나머지는 현재 값 유지(모르는 키·undefined 는 무시) → 정제.
export function mergeExtensionConfig(current: ExtensionConfig, patch: unknown): ExtensionConfig {
  const changes = objectOf(patch);
  const next: Record<string, unknown> = { ...current };
  for (const key of Object.keys(EXTENSION_CONFIG_DEFAULT)) {
    if (changes[key] !== undefined) next[key] = changes[key];
  }
  return normalizeExtensionConfig(next);
}

// ---------- 신호등 ----------
export type ExtensionLightColor = "gray" | "red" | "yellow" | "green";
export type ExtensionLight = { color: ExtensionLightColor; reasons: string[] };

export const HEARTBEAT_STALE_MINUTES = 30;
export const HEARTBEAT_ERROR_WINDOW_MINUTES = 10;

// 경과 시간 짧은 표기: 방금 / N분 / N시간 / N일 (뒤에 "전"·"무응답"을 붙여 쓴다).
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms)) return "?";
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일`;
}

// 규칙(서버 계산, 화면은 색만):
//   회색  하트비트 기록 없음(0.4.0 이전 확프)
//   빨강  마지막 하트비트 30분 초과 | 위플랩 로그인 풀림 | 전송 오류가 최근 10분 안(그 뒤 성공이 없을 때)
//   노랑  (빨강 아님) 후원관리 화면 아님 | 검색어 | 최소 금액 | 종류 필터 | 기간 끝≠오늘 | 더보기 | 자동기록 꺼짐
//   초록  그 외
// 후원관리 화면이 아니면 화면(필터·기간·더보기) 값이 의미가 없어 그 사유는 붙이지 않는다.
// 전송 오류 뒤에 성공(lastSuccessAt)이 이미 있으면 회복된 것으로 본다 — 확프 0.4.0 은 다음 수집 때 lastError 만
// 비우고 lastErrorAt 은 남기므로, 이 조건이 없으면 일시 오류 뒤 10분간 "원인 미상" 빨강이 뜬다.
// serverNewestCaptureAt(서버가 가진 최신 원본 수집 시각)은 표시용 참고값으로만 받고 색에는 쓰지 않는다:
// raw_imports 는 "새 기록이 생긴 수집"만 저장돼(평범한 당첨·빈 재스캔은 저장 안 됨) 화면 최신 행 시각과
// 견주면 정상인데도 노랑이 자주 뜬다(공백 뒤 되받기 직후 등). 공백 판단은 2단계 되읽기에서 다룬다.
export function trafficLight(args: {
  status: { updatedAt: string; payload: HeartbeatPayload } | null;
  now: Date;
  serverNewestCaptureAt?: string | null;
}): ExtensionLight {
  const { status, now } = args;
  if (!status) return { color: "gray", reasons: ["확프 상태 없음(옛 버전)"] };
  const payload = status.payload;
  const nowMs = now.getTime();

  const red: string[] = [];
  const updatedMs = Date.parse(status.updatedAt);
  const silentMs = Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : Number.POSITIVE_INFINITY;
  if (silentMs > HEARTBEAT_STALE_MINUTES * 60_000) {
    red.push(Number.isFinite(silentMs) ? `${formatElapsed(silentMs)} 무응답` : "응답 시각 알 수 없음");
  }
  if (!payload.page.loginOk) red.push("위플랩 로그인 풀림");
  const errorMs = payload.collector.lastErrorAt ? Date.parse(payload.collector.lastErrorAt) : Number.NaN;
  const successMs = payload.collector.lastSuccessAt ? Date.parse(payload.collector.lastSuccessAt) : Number.NaN;
  const recovered = Number.isFinite(successMs) && successMs > errorMs;
  if (Number.isFinite(errorMs) && nowMs - errorMs <= HEARTBEAT_ERROR_WINDOW_MINUTES * 60_000 && !recovered) {
    red.push(`전송 오류: ${payload.collector.lastError || "원인 미상"}`);
  }
  if (red.length > 0) return { color: "red", reasons: red };

  const yellow: string[] = [];
  if (!payload.page.onAlertList) {
    yellow.push("후원관리 화면 아님");
  } else {
    const { filter } = payload.screen;
    if (filter.searchActive) yellow.push("검색어 걸림");
    if (filter.minActive) yellow.push("최소 금액 필터");
    if (!["", "all"].includes(filter.typeValue.trim().toLowerCase())) yellow.push("종류 필터");
    if (!payload.screen.rangeEndIsToday) yellow.push("기간이 오늘까지 아님");
    if (payload.screen.moreButtonVisible) yellow.push("더보기 숨은 행 있음");
  }
  if (!payload.autoSyncEnabled) yellow.push("자동기록 꺼짐");
  return yellow.length > 0 ? { color: "yellow", reasons: yellow } : { color: "green", reasons: [] };
}

// ---------- 화면 요약 ----------
// "YYYY-MM-DD HH:MM:SS"(위플랩 원문) 또는 "YY-MM-DD ..." 에서 월-일만.
function monthDay(value: string | null): string {
  const match = String(value ?? "").match(/(\d{2,4})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

// 화면에 보이는 행의 날짜 폭: "10-05~10-12" / 하루면 "10-12" / 없으면 "".
export function screenRangeLabel(screen: Pick<HeartbeatPayload["screen"], "newestRowTime" | "oldestRowTime">): string {
  const oldest = monthDay(screen.oldestRowTime);
  const newest = monthDay(screen.newestRowTime);
  if (oldest && newest) return oldest === newest ? newest : `${oldest}~${newest}`;
  return newest || oldest;
}

// 목록용 한 줄: "100행 · 10-05~10-12 · 더보기 있음".
export function extensionScreenSummary(payload: HeartbeatPayload): string {
  if (!payload.page.onAlertList) return "후원관리 화면 아님";
  const parts = [`${payload.screen.rowCount}행`];
  const range = screenRangeLabel(payload.screen);
  if (range) parts.push(range);
  if (payload.screen.moreButtonVisible) parts.push("더보기 있음");
  return parts.join(" · ");
}

// ---------- 본 키 시드(재설치 직후 캐시 채우기) ----------
// 확프 content.js 와 "같은 열쇠"를 raw_imports.raw.rows 에서 다시 만든다.
//   결과 열쇠: result.sourceKey || (sourceUid ? `${sourceUid}::${index ?? rouletteIndex ?? 0}` : "")
//   후원 열쇠: 금액이 있는 모든 행(결과 유무 무관) — don::{sourceUid||fanId||fanNickname}::{donateTimeText||""}::{donationAmount}
//   (결과 있던 행도 넣는다: 확프가 그 행을 "순수 후원" 모양으로 다시 보내지 않게, 2026-10-12 코디네이터 요청)
// rowLists 는 수집 시각 오름차순 — 상한을 넘으면 최근 것만 남긴다.
export const KNOWN_KEYS_CAP = 5000;
export const KNOWN_KEYS_DAYS_DEFAULT = 7;
export const KNOWN_KEYS_DAYS_MAX = 14;

export function clampKnownKeysDays(value: unknown): number {
  return clampInt(value, 1, KNOWN_KEYS_DAYS_MAX, KNOWN_KEYS_DAYS_DEFAULT);
}

function keyPart(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function pushRecent(set: Set<string>, key: string) {
  if (!key) return;
  set.delete(key);
  set.add(key);
}

export function knownKeysFromRawRows(
  rowLists: unknown[],
  cap = KNOWN_KEYS_CAP,
): { resultKeys: string[]; donationKeys: string[] } {
  const resultKeys = new Set<string>();
  const donationKeys = new Set<string>();
  for (const list of rowLists) {
    if (!Array.isArray(list)) continue;
    for (const rawRow of list) {
      const row = objectOf(rawRow);
      const uid = keyPart(row.sourceUid);
      const results = Array.isArray(row.results) ? row.results : [];
      for (const rawResult of results) {
        const result = objectOf(rawResult);
        const sourceKey = keyPart(result.sourceKey);
        const index = keyPart(result.index ?? result.rouletteIndex ?? 0);
        pushRecent(resultKeys, sourceKey || (uid ? `${uid}::${index}` : ""));
      }
      const amount = keyPart(row.donationAmount);
      if (!amount) continue;
      const who = uid || keyPart(row.fanId) || keyPart(row.fanNickname);
      if (!who) continue;
      pushRecent(donationKeys, `don::${who}::${keyPart(row.donateTimeText)}::${amount}`);
    }
  }
  return {
    resultKeys: [...resultKeys].slice(-cap),
    donationKeys: [...donationKeys].slice(-cap),
  };
}
