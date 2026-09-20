// 수동기록 "후원 날짜"의 저장 형식(KST) — 폼(ManualEntryManager)과 API 검증(manual-entries route)이
// 같은 규칙을 쓰도록 한 곳에 둔다. 순수 모듈(클라이언트·서버 공용).
//  오늘        = 현재 KST "YYYY-MM-DD HH:MM"
//  어제·고른 날 = "YYYY-MM-DD 12:00"(정오 — parseDonateTimeMs 가 시각 없는 날짜를 거부하므로 반드시 시각 포함)
//  날짜 모름    = ""(옛 수동기록과 동일 — kind "manual", 배송 기간·월별에서 기타)
import { parseDonateTimeMs } from "./api";
import { isValidCutoffDate } from "./deliveryPeriod";

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export type ManualDateMode = "today" | "yesterday" | "pick" | "unknown";

// 저장 문자열 형식(시각 있는 날짜). 달력 유효성·시각 범위는 isManualDonateTimeText 에서 본다.
export const MANUAL_DONATE_TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

// epoch ms → KST 날짜 "YYYY-MM-DD".
export function kstDateOf(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 오늘·어제(KST) 날짜 문자열.
export function kstTodayOf(nowMs: number = Date.now()): string {
  return kstDateOf(nowMs);
}
export function kstYesterdayOf(nowMs: number = Date.now()): string {
  return kstDateOf(nowMs - DAY_MS);
}

// 현재 KST "YYYY-MM-DD HH:MM".
export function kstNowText(nowMs: number = Date.now()): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

// 폼 상태 → 저장 문자열. "pick" 인데 날짜가 비었거나 달력에 없으면 null(호출부가 안내).
export function manualDonateTimeText(
  mode: ManualDateMode,
  pickedDate: string,
  nowMs: number = Date.now(),
): string | null {
  if (mode === "unknown") return "";
  if (mode === "today") return kstNowText(nowMs);
  if (mode === "yesterday") return `${kstYesterdayOf(nowMs)} 12:00`;
  const date = pickedDate.trim();
  if (!isValidCutoffDate(date)) return null;
  return `${date} 12:00`;
}

// API 가 받아 주는 값인지: ""(날짜 모름) 또는 형식·달력·시각 범위가 전부 맞는 "YYYY-MM-DD HH:MM".
export function isManualDonateTimeText(text: string): boolean {
  if (text === "") return true;
  if (!MANUAL_DONATE_TIME_RE.test(text)) return false;
  if (!isValidCutoffDate(text.slice(0, 10))) return false;
  return parseDonateTimeMs(text) !== null;
}

// 목록 표시용: 시각이 있으면 "YYYY.MM.DD"(KST), 없거나 해석 불가면 "날짜 없음".
export function manualEntryDateLabel(donateTimeText: string | null | undefined): string {
  const ms = parseDonateTimeMs(donateTimeText);
  if (ms === null) return "날짜 없음";
  return kstDateOf(ms).replace(/-/g, ".");
}

// 목록 날짜 편집 input 의 초기값: 기존 시각의 KST 날짜(없으면 "").
export function manualEntryDateValue(donateTimeText: string | null | undefined): string {
  const ms = parseDonateTimeMs(donateTimeText);
  return ms === null ? "" : kstDateOf(ms);
}
