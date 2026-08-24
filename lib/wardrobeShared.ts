// 옷장(의상) 탭 공용 타입·상수.
// 클라이언트(WardrobeManager/WardrobeFanView)에서도 쓰므로 이 파일은 Node 전용 의존성
// (node:crypto·supabaseFetch 등)을 절대 import 하지 않는다. upboSupabase.ts 를 클라이언트
// 번들에 끌고 오지 않기 위한 분리 — lib/couponAggregate.ts 와 같은 이유·같은 선례.

// 파츠 목록·이름표의 단일 출처 — 관리 화면 select, 팬 필터 칩, 서버 검증이 전부 이걸 쓴다.
// 새 파츠는 여기에만 추가하면 된다(눈색·악세서리=8/11 sy 지시로 추가).
export const WARDROBE_PARTS = ["outfit", "hair", "eyes", "accessory"] as const;
export type WardrobePart = (typeof WARDROBE_PARTS)[number];
export const WARDROBE_PART_LABEL: Record<WardrobePart, string> = {
  outfit: "의상",
  hair: "헤어",
  eyes: "눈색",
  accessory: "악세서리",
};
export type WardrobeTheme = { id: string; name: string };
export type WardrobeItem = {
  id: string;
  url: string;
  name: string;
  themeId: string;
  part: WardrobePart;
  month: string; // "YYYY-MM" — 팬에게 보여줄 기준 월(1개, 여러 달 재노출 없음)
  memo: string;
  hidden: boolean;
  // NEW 배지 기준: 처음 공개된 시각(+2주). 숨김 해제 시 최초 1회만 채워지고 이후 유지 —
  // 지난 의상을 다시 켜도 NEW 로 둔갑하지 않는다.
  publishedAt: string | null;
  order: number; // 테마 안 수동 순서(테마별 보기 전용, 월별 보기는 최신 등록순 고정)
  // 색상 세트(8/12 sy 지시): 같은 setId = 같은 의상의 색상 변형 묶음("" = 세트 없음).
  // 팬 화면에서 한 카드로 접히고 variant 가 색상 칩 라벨이 된다(예: "화이트").
  // 세트는 같은 테마·같은 파츠 안에서만 성립(서버가 검증), 2장 미만이 되면 자동 해체.
  setId: string;
  variant: string;
  // 메인 고정(8/12 sy 지시): 스트리머가 체크한 컷은 팬 옷장의 "메인" 탭에 오르고,
  // 고정 컷이 1장 이상이면 옷장 첫 진입이 메인 탭이 된다(0장=메인 탭 자체가 없음).
  featured: boolean;
  // 목록용 썸네일(썸네일 분리 라운드, sy 승인): 업로드 시 ~320px 파생본을 함께 저장하고
  // 목록·메인·관리 표는 이걸, 피팅룸(크게보기)만 원본(url)을 내려받는다 — 전송량 ~1/10.
  // "" = 썸네일 없음(구버전 컷) → 화면은 원본으로 폴백(깨짐 없음, 마이그레이션으로 채움).
  thumbUrl: string;
};
export type WardrobeState = { themes: WardrobeTheme[]; items: WardrobeItem[] };

// 숨김 포함 총 보관 상한. 100→500 상향(8/14 sy 확정 — 꾸야 이틀 만에 100 도달 실측).
// 500장 실측 추정 ~350MB/스트리머(1200px webp 평균 722KB). 다음 대비=목록용 썸네일 분리(전송량 1/10).
export const WARDROBE_MAX_ITEMS = 500;

// 기본 테마는 제공하지 않는다(sy 확정 8/4: 예시 전부 제외) — 판만 주고,
// 테마 이름·구성은 스트리머가 처음부터 직접 만든다.

// "YYYY-MM" 형식 검사(서버 검증·클라이언트 blur 저장이 같은 규칙을 쓴다).
export const WARDROBE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// 한국 시간 기준 이번 달("YYYY-MM"). toISOString 은 UTC 라 한국 매월 1일 0~9시에
// 지난 달로 잡히므로 +9h 보정한다(레포의 KST 표시 관례와 동일한 기준).
export function currentMonthKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
