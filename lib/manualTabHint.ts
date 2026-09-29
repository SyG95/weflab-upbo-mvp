// 수동기록 상품의 탭 힌트(2026-09-21 직접 입력만 → 2026-09-29 표 상품 포함, sy 승인) — 순수 모듈. DB·React 의존 0.
//
// 배경: 수동기록의 팬 탭은 상품이 정한다. 표에 있는 상품 → 그 룰렛 탭, 옛 표 상품 → 되짚기(fanPastTab),
// 표에 없는 상품(직접 입력, catalogVersion=null)은 무조건 "표에 없음"이었다. 9/21 엔 표에 없는 상품에만 힌트를 열었고,
// 9/29(루빗: 표 상품 수동기록 10건이 전부 "추석 한정" 탭) 부터는 정가 빼고 모든 수동기록이 힌트를 가질 수 있다.
// 이 모듈은 그 힌트의 형식(정제·키)만 정한다. 저장은 수동기록 admin_note JSON 의 tabHint 키(스키마 0),
// 팬 화면 적용은 page.tsx partitionHoldingsByRoulette → fanPastTab.resolveHoldingTabRid(힌트 → 상품 → 되짚기).
//
// 힌트는 수동기록(manual:*)에만 저장된다 — 자동수집 기록은 이 키가 없어 언제나 상품/되짚기 경로다.

export type ManualTabHint =
  // "힌트 없음"(기본). null 과 동치 — 저장 시 생략한다. 결과는 상품이 정한 탭(표에 없는 상품이면 "표에 없음").
  // 표 상품을 굳이 "표에 없음" 탭으로 보내는 수단은 없다(원하면 내가 만든 탭을 쓴다).
  | { kind: "other" }
  // 현재 표의 금액대 라벨 L 탭. rid 는 같은 라벨 룰렛이 둘 이상일 때 고르는 보조 열쇠(표가 바뀌면 라벨로만 찾는다).
  | { kind: "label"; label: string; rid?: string }
  // 스트리머가 지은 탭 이름(예: "이벤트"). 팬 화면에 그 이름 그대로 탭이 생긴다.
  | { kind: "custom"; name: string };

export const CUSTOM_TAB_PREFIX = "custom:";
// 탭 이름 상한 — 팬 탭 이름 오버레이(sanitizeFanTabLabels 값 30자)와 같은 자리수.
export const MANUAL_TAB_NAME_MAX = 30;
// 금액대 라벨 상한 — pastLabels 키 40자와 동일.
export const MANUAL_TAB_LABEL_MAX = 40;

// 보이지 않는 글자(제어·서식 문자: U+200B, U+200D,  …)를 걷어낸다 — 빈 이름·겉보기 중복 탭 방지.
const INVISIBLE_RE = /[\p{Cc}\p{Cf}]/gu;

// 스트리머가 짓는 탭 이름 정제: 보이지 않는 글자 제거 → trim → 코드포인트 단위 30자(이모지가 반쪽으로 잘리지 않게).
// 폼(hintOfTabPick)과 API(cleanManualTabHint)가 같은 함수를 써서 규칙이 한 곳에 있다.
export function cleanCustomTabName(raw: string): string {
  const text = raw.replace(INVISIBLE_RE, "").trim();
  return Array.from(text).slice(0, MANUAL_TAB_NAME_MAX).join("").trim();
}

// 저장·입력값 정제. 모양이 아니면 null.
//  - kind 가 other/label/custom 외 → null
//  - label: 보이지 않는 글자 제거·trim, 비었거나 40자 초과 → null. rid 는 비어 있지 않은 문자열일 때만 유지.
//  - custom: cleanCustomTabName(보이지 않는 글자 제거·trim·코드포인트 30자), 비면 → null.
export function cleanManualTabHint(raw: unknown): ManualTabHint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "other") return { kind: "other" };
  if (r.kind === "label") {
    if (typeof r.label !== "string") return null;
    const label = r.label.replace(INVISIBLE_RE, "").trim();
    if (!label || label.length > MANUAL_TAB_LABEL_MAX) return null;
    const rid = typeof r.rid === "string" ? r.rid.trim() : "";
    return rid ? { kind: "label", label, rid } : { kind: "label", label };
  }
  if (r.kind === "custom") {
    if (typeof r.name !== "string") return null;
    const name = cleanCustomTabName(r.name);
    if (!name) return null;
    return { kind: "custom", name };
  }
  return null;
}

// 저장할 값: other/null 은 "키 없음"과 같다(기존 767건·힌트 없는 직접 입력 = 표에 없음 그대로).
export function storableManualTabHint(hint: ManualTabHint | null | undefined): ManualTabHint | undefined {
  return hint && hint.kind !== "other" ? hint : undefined;
}

// 팬 탭 키. past:L(fanPastTab)·__other__·__fixed__·named:/auto: 와 절대 겹치지 않는 접두.
export function customTabKey(name: string): string {
  return CUSTOM_TAB_PREFIX + name;
}

export function isCustomTabKey(key: string): boolean {
  return key.startsWith(CUSTOM_TAB_PREFIX) && key.length > CUSTOM_TAB_PREFIX.length;
}

export function customNameOfKey(key: string): string {
  return isCustomTabKey(key) ? key.slice(CUSTOM_TAB_PREFIX.length) : "";
}

// 탭 이름 가나다순(팬 화면 custom 탭 순서·폼 "내가 만든 탭" 목록 공용, 중복 제거).
export function sortCustomTabNames(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}
