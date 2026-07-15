// 공지(팬 화면 상단 공지문구) 전용 구글폰트 화이트리스트.
// 서버(정규화)·관리자 피커·팬 화면 렌더가 같은 목록을 공유한다.
// 화이트리스트로만 받으므로 임의 폰트명/CSS 주입이 불가능(사이트 리스크 차단).
// 기본("") = 사이트 기본 손글씨 폰트 그대로 = 안 고르면 지금과 100% 동일.

export type NoticeFont = {
  key: string;
  label: string; // 관리자에게 보여줄 한국어 이름
  // CSS font-family 값(항상 기본 폰트를 fallback 으로 붙인다).
  css: string;
  // 구글폰트 css2 API 의 family 파라미터(기본 폰트는 이미 전역 로드라 없음).
  google?: string;
};

export const NOTICE_FONTS: NoticeFont[] = [
  { key: "", label: "기본 (사이트 손글씨)", css: "var(--font-base)" },
  { key: "jua", label: "주아 (둥글둥글)", css: '"Jua"', google: "Jua" },
  { key: "dohyeon", label: "도현 (또렷·굵게)", css: '"Do Hyeon"', google: "Do+Hyeon" },
  { key: "blackhan", label: "검은고딕 (강한 강조)", css: '"Black Han Sans"', google: "Black+Han+Sans" },
  { key: "nanumpen", label: "나눔손글씨 펜", css: '"Nanum Pen Script"', google: "Nanum+Pen+Script" },
  { key: "gamja", label: "감자꽃 (아기자기)", css: '"Gamja Flower"', google: "Gamja+Flower" },
  { key: "gowundodum", label: "고운돋움 (단정)", css: '"Gowun Dodum"', google: "Gowun+Dodum" },
  { key: "notosanskr", label: "본고딕 (깔끔)", css: '"Noto Sans KR"', google: "Noto+Sans+KR" },
  { key: "dongle", label: "동글 (부드러움)", css: '"Dongle"', google: "Dongle" },
];

const BY_KEY = new Map(NOTICE_FONTS.map((f) => [f.key, f]));

export function isNoticeFontKey(value: unknown): value is string {
  return typeof value === "string" && BY_KEY.has(value);
}

// 저장/입력값을 화이트리스트 키로 정규화(모르는 값은 기본 "").
export function normalizeNoticeFont(value: unknown): string {
  return isNoticeFontKey(value) ? value : "";
}

// 팬 화면 공지에 적용할 CSS font-family. 기본 키는 기본 폰트 그대로.
export function noticeFontCss(key: string): string {
  const f = BY_KEY.get(key);
  if (!f || f.key === "") return "var(--font-base)";
  return `${f.css}, var(--font-base)`;
}

// 이 폰트를 위해 로드해야 할 구글폰트 css2 URL(기본/미로드 폰트는 null).
export function noticeFontHref(key: string): string | null {
  const f = BY_KEY.get(key);
  if (!f?.google) return null;
  return `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
}

// 관리자 피커에서 모든 후보 폰트를 한 번에 미리보기용으로 로드할 URL.
export function noticeFontsPreviewHref(): string {
  const families = NOTICE_FONTS.filter((f) => f.google).map((f) => `family=${f.google}`);
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
