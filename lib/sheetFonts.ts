// 시트 전체 글씨체(디스플레이 폰트) 화이트리스트 — 스트리머가 1종을 골라 제목·탭·상품 칩에
// 통일 적용한다(2026-08-10 sy 확정: 슬러그·본문 고딕은 불변, 상품 칩까지 통일, 종류는 넉넉히).
// noticeFonts.ts(공지 전용)와 같은 화이트리스트 철학·키 체계를 공유한다: 서버(정규화)·
// 설정 피커·팬 화면 렌더가 같은 목록을 쓰고, 임의 폰트명/CSS 주입은 불가능하다.
// 전 폰트 구글 css2 한글 슬라이스 서빙 실측 확인(2026-08-10). 기본("") = 현행 개구체 그대로.

export type SheetFont = {
  key: string;
  label: string; // 설정 화면에 보여줄 한국어 이름
  blurb: string; // 한 줄 느낌 설명
  // CSS font-family 값(팬 화면에서 항상 --font-base 를 fallback 으로 붙인다).
  css: string;
  // 구글폰트 css2 family 파라미터(무로드 폰트는 없음).
  google?: string;
};

export const SHEET_FONTS: SheetFont[] = [
  { key: "", label: "개구체 (기본)", blurb: "지금 그대로, 삐뚤빼뚤 손글씨", css: '"Gaegu"' },
  { key: "pretendard", label: "프리텐다드", blurb: "군더더기 없는 깔끔 고딕", css: "var(--font-base)" },
  { key: "jua", label: "주아", blurb: "둥글둥글 또박또박", css: '"Jua"', google: "Jua" },
  { key: "dohyeon", label: "도현", blurb: "또렷하고 각진 제목용", css: '"Do Hyeon"', google: "Do+Hyeon" },
  { key: "blackhan", label: "검은고딕", blurb: "아주 두꺼운 임팩트", css: '"Black Han Sans"', google: "Black+Han+Sans" },
  { key: "notosanskr", label: "본고딕", blurb: "반듯한 표준 고딕", css: '"Noto Sans KR"', google: "Noto+Sans+KR" },
  { key: "gowundodum", label: "고운돋움", blurb: "단정하고 세련된 돋움", css: '"Gowun Dodum"', google: "Gowun+Dodum" },
  { key: "gowunbatang", label: "고운바탕", blurb: "책 같은 명조 느낌", css: '"Gowun Batang"', google: "Gowun+Batang" },
  { key: "songmyung", label: "송명", blurb: "옛 활자 명조", css: '"Song Myung"', google: "Song+Myung" },
  { key: "sunflower", label: "해바라기", blurb: "얇고 모던한 선", css: '"Sunflower"', google: "Sunflower:wght@500" },
  { key: "nanumpen", label: "나눔손글씨 펜", blurb: "가늘게 흘려 쓴 펜글씨", css: '"Nanum Pen Script"', google: "Nanum+Pen+Script" },
  { key: "himelody", label: "하이멜로디", blurb: "귀엽게 통통 튀는 손글씨", css: '"Hi Melody"', google: "Hi+Melody" },
  { key: "gamja", label: "감자꽃", blurb: "아기자기한 낙서체", css: '"Gamja Flower"', google: "Gamja+Flower" },
  { key: "poorstory", label: "푸어스토리", blurb: "만화 낙서 느낌", css: '"Poor Story"', google: "Poor+Story" },
  { key: "singleday", label: "싱글데이", blurb: "붓펜으로 눌러 쓴 제목", css: '"Single Day"', google: "Single+Day" },
  { key: "dongle", label: "동글", blurb: "말랑말랑 통통(작게 보임)", css: '"Dongle"', google: "Dongle" },
];

const BY_KEY = new Map(SHEET_FONTS.map((f) => [f.key, f]));

export function isSheetFontKey(value: unknown): value is string {
  return typeof value === "string" && BY_KEY.has(value);
}

// 저장/입력값을 화이트리스트 키로 정규화. 모르는 값·오염값은 기본 ""(현행 개구체) — 회귀 방지.
export function normalizeSheetFont(value: unknown): string {
  return isSheetFontKey(value) ? value : "";
}

// 팬 화면 --font-display 에 넣을 CSS font-family. 기본 키는 null(= CSS 기본값 그대로).
export function sheetFontCss(key: string): string | null {
  const f = BY_KEY.get(key);
  if (!f || f.key === "") return null;
  if (f.css === "var(--font-base)") return f.css;
  return `${f.css}, var(--font-base)`;
}

// 이 폰트를 위해 로드해야 할 구글폰트 css2 URL(기본·무로드 폰트는 null).
export function sheetFontHref(key: string): string | null {
  const f = BY_KEY.get(key);
  if (!f?.google) return null;
  return `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
}

// 설정 피커 미리보기용: 후보 전부를 한 번에, 단 text= 로 미리보기 문구 글자만 잘라 로드해
// 모바일에서도 가볍다(한글 폰트 통짜 로드 방지). text 는 라벨+샘플 문구의 고유 문자 집합.
export function sheetFontsPreviewHref(sampleText: string): string {
  const families = SHEET_FONTS.filter((f) => f.google).map((f) => `family=${f.google}`);
  const chars = Array.from(new Set(Array.from(sampleText + SHEET_FONTS.map((f) => f.label).join("")))).join("");
  return `https://fonts.googleapis.com/css2?${families.join("&")}&text=${encodeURIComponent(chars)}&display=swap`;
}
