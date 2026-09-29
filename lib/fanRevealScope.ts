// 팬 화면 룰렛 확률표 "공개 범위"(2026-09-29, sy 승인) — 순수 모듈. DB·React 의존 0.
//
// 배경: 확률표 카드는 지금까지 "업보로 기록되는 상품"(기준 확률 이하 + 기록 on)만 보여줬다. 스트리머가 원하면
// 룰렛표 전체(기준 확률 위·기록 off 상품 포함)를 그대로 공개할 수 있게 범위를 고른다.
//  - target(기본): 업보 대상 품목만 — 지금까지와 동일.
//  - all: 전체 확률표 — 모든 상품을 확률 높은 순으로, 업보 대상 행만 진하게 표시(비대상은 흐림).
// 저장은 기존 fan_reveal_updated 오버레이 payload 에 scope 키를 얹는다(스키마 0). 키가 없으면 target.

export type FanRevealScope = "target" | "all";

export const FAN_REVEAL_SCOPE_DEFAULT: FanRevealScope = "target";

export function normalizeFanRevealScope(raw: unknown): FanRevealScope {
  return raw === "all" ? "all" : "target";
}

export const FAN_REVEAL_SCOPE_LABEL: Record<FanRevealScope, string> = {
  target: "업보 대상 품목만",
  all: "전체 확률표",
};
