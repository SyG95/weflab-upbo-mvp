import { applyCustomTheme, themeFromTone } from "./customTheme";
import type { ToneMode } from "./toneTheme";
import type { BuiltinMaterialId } from "./materials";
// 팬 업보시트(/[streamerSlug]) 테마 프리셋.
//
// 각 프리셋은 globals.css 의 CSS 변수 한 세트를 갈아끼운다(색/배경/포인트/글꼴 느낌만).
// 표·기능·레이아웃은 그대로다. 저장은 기존 streamers.accent_color 칸에 프리셋 id 만 넣는다
// (스키마 변경 없음). 새 프리셋은 여기 배열에 한 줄 추가하면 끝.
//
// v3 라인업: 아이코 업보시트(/s/aiko)의 디자인 언어를 레퍼런스화해 전 테마에 적용.
// 모든 테마 = "살아 움직이는 배경(WebGL, 테마별 팔레트) + 유리 카드" 풀 스킨.
// WebGL 미지원/실패 시 --page-bg 그라데이션으로 자동 대체된다.

export type ThemeVars = Record<string, string>;

// 살아있는 배경 팔레트. base=[아래쪽 톤, 위쪽 톤], clouds=흘러다니는 빛 3개.
export type NebulaPalette = {
  base: [string, string];
  clouds: [string, string, string];
};

// 테마 부가 효과(아이코 /s/aiko 디자인의 레퍼런스 부품).
// background: 살아있는 배경(WebGL). nebulaPalette 로 테마별 색을 입힌다.
// glass: 카드 유리 질감(반투명 + 뒤 배경 블러).
// material: 질감 프리셋(materials.ts). 고르면 glass 규칙 위에 --mat-* 변수로 표면을 바꾼다.
export type ThemeFx = {
  background?: "nebula";
  nebulaPalette?: NebulaPalette;
  glass?: boolean;
  material?: BuiltinMaterialId;
};

export type Theme = {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  vars: ThemeVars;
  fx?: ThemeFx;
  // 설정 화면 묶음. 없으면 "기본 테마".
  group?: "pastel";
  // 톤 생성기로 만든 예시 테마의 씨앗 — "이 테마에서 시작해 직접 수정" 이 그대로 이어받는다.
  tone?: { mode: ToneMode; main: string; sub: string | null };
};

// vars 키 = CSS 커스텀 프로퍼티.
// --paper(페이지 기본색) --surface(카드/종이) --ink(본문) --muted(보조) --paper-line(선/테두리)
// --stamp(포인트) --stamp-soft(포인트 옅은 배경) --cover(표지/제목) --on-cover(표지 위 글자)
// --on-accent(포인트 버튼 위 글자) [--font-display 선택]
// [--page-bg: 정적 배경(그라데이션). 미리보기·WebGL 실패 대체용]
// [--rule-line: 노트 줄무늬 색. 없으면 --paper-line]
// [--glass-border/--glass-shadow: 유리 카드 테두리/그림자. 없으면 다크용 기본값]
// [--modal-bg: 팝업 배경. 없으면 흰색 — 다크 테마는 필수 지정]
// [--cover-ink: 표지색을 "글자"로 쓰는 칩(.upboSet 등)용. 없으면 --cover]
// [--cover-on-white: 관리자 탭(흰 바탕·마우스 올림 옅은 강조) 글자. 없으면 --cover]
// [--tab-hover: 관리자 탭 마우스 올림 바탕(불투명). 없으면 --stamp-soft — 반투명이면 뒤 표지가 비쳐 글자가 묻힌다]
// [--accent-fill: 글자가 올라가는 버튼·선택 탭 바탕. 없으면 --stamp. 파스텔은 옅은 채움 + 진한 --on-accent]
// [--accent-edge: 버튼·선택 탭 안쪽 1px 테두리. 없으면 투명. 파스텔은 옅은 채움이라 선택 상태를 선으로도 구분]
// 2026-10-27 글자 대비 4.5:1 보정: 밝은 7종(paper·sky·lavender·spring·mintsoda·honey·sunset)의 --stamp·--cover 를
// 같은 색상각에서 명도만 내렸고, 표지색을 글자로 쓰는 곳은 위 두 변수로 따로 맞췄다(값 계산=흐르는 배경 실색 기준).
export const THEMES: Theme[] = [
  {
    id: "paper",
    label: "핑크",
    emoji: "🧾",
    blurb: "핑크 종이 위로 아침빛이 흐르는 아날로그 장부 (기본)",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#fff5fa", "#ffe9f2"], clouds: ["#ffd3e5", "#ffe3c9", "#f8c8dc"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 20% 0%, rgba(232, 64, 126, 0.14), transparent 55%), linear-gradient(180deg, #fff3f9 0%, #ffeaf3 55%, #fff6f0 100%)",
      "--paper": "#fff5fa",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#4a2440",
      "--muted": "#87687f",
      "--paper-line": "#f3c9dc",
      "--rule-line": "rgba(232, 64, 126, 0.10)",
      "--stamp": "#c41161",
      "--stamp-soft": "#fbdce8",
      "--cover": "rgba(190, 48, 111, 0.88)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.72)",
      "--glass-shadow": "rgba(194, 52, 114, 0.16)",
      "--cover-ink": "#b1356e",
      "--cover-on-white": "#b1356e",
    },
  },
  {
    id: "nebula",
    label: "네이비",
    emoji: "🌌",
    blurb: "살아 움직이는 딥블루→보라 성운 + 유리 카드, 밤하늘 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#0c1130", "#131a45"], clouds: ["#4d6bf2", "#8c61f2", "#59a6f2"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 90% at 15% 0%, rgba(124, 155, 255, 0.22), transparent 55%), radial-gradient(110% 80% at 85% 100%, rgba(168, 108, 255, 0.20), transparent 60%), linear-gradient(165deg, #070b1f 0%, #131a45 34%, #2a1c56 62%, #0c1130 100%)",
      "--paper": "#0c1130",
      "--surface": "rgba(21, 28, 66, 0.78)",
      "--ink": "#e6ebff",
      "--muted": "#a4aedb",
      "--paper-line": "rgba(136, 156, 255, 0.30)",
      "--rule-line": "rgba(136, 156, 255, 0.07)",
      "--stamp": "#7c9bff",
      "--stamp-soft": "rgba(124, 155, 255, 0.18)",
      "--cover": "rgba(21, 29, 78, 0.62)",
      "--on-cover": "#cfe0ff",
      "--on-accent": "#0a1030",
      "--modal-bg": "#141b47",
      "--cover-ink": "#8b9bd2",
      "--cover-on-white": "#656a88",
      "--tab-hover": "#e7edff",
    },
  },
  {
    id: "aurora",
    label: "다크 민트",
    emoji: "🌠",
    blurb: "청록→연두→보라가 흐르는 극광 + 유리 카드, 자유로운 다크 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#081821", "#0a2b33"], clouds: ["#2dd4a0", "#7c5cf6", "#34d399"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(130% 80% at 80% 0%, rgba(94, 234, 178, 0.16), transparent 55%), radial-gradient(120% 90% at 10% 100%, rgba(139, 92, 246, 0.18), transparent 60%), linear-gradient(170deg, #05141f 0%, #0a2b33 38%, #113629 68%, #1d1b45 100%)",
      "--paper": "#081821",
      "--surface": "rgba(13, 38, 43, 0.78)",
      "--ink": "#ddf7ec",
      "--muted": "#9dc2b2",
      "--paper-line": "rgba(94, 234, 178, 0.26)",
      "--rule-line": "rgba(94, 234, 178, 0.06)",
      "--stamp": "#43d69a",
      "--stamp-soft": "rgba(67, 214, 154, 0.16)",
      "--cover": "rgba(13, 47, 51, 0.62)",
      "--on-cover": "#a7f3d0",
      "--on-accent": "#04120c",
      "--modal-bg": "#0c2a30",
      "--cover-ink": "#89a8ae",
      "--cover-on-white": "#5e7275",
      "--tab-hover": "#e1f8ef",
    },
  },
  {
    id: "berry",
    label: "다크 퍼플",
    emoji: "🫐",
    blurb: "다크 퍼플 위로 번지는 핑크 네온, 달콤한 밤 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#1a081c", "#2d0f33"], clouds: ["#f472b6", "#a855f7", "#fb7185"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 90% at 20% 0%, rgba(244, 114, 182, 0.20), transparent 55%), radial-gradient(110% 80% at 85% 100%, rgba(168, 85, 247, 0.18), transparent 60%), linear-gradient(165deg, #170718 0%, #2d0f33 40%, #3b1030 70%, #1a081c 100%)",
      "--paper": "#1a081c",
      "--surface": "rgba(50, 18, 54, 0.75)",
      "--ink": "#fbe7f7",
      "--muted": "#cba4c0",
      "--paper-line": "rgba(244, 114, 182, 0.30)",
      "--rule-line": "rgba(244, 114, 182, 0.07)",
      "--stamp": "#f472b6",
      "--stamp-soft": "rgba(244, 114, 182, 0.18)",
      "--cover": "rgba(60, 20, 62, 0.62)",
      "--on-cover": "#fbcfe8",
      "--on-accent": "#2a0a25",
      "--modal-bg": "#2b1030",
      "--cover-ink": "#b88cba",
      "--cover-on-white": "#7c637d",
      "--tab-hover": "#fde6f2",
    },
  },
  {
    id: "deepforest",
    label: "다크 그린",
    emoji: "🌲",
    blurb: "깊은 숲의 어둠 사이로 흐르는 초록빛, 차분한 다크 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#081710", "#0d2818"], clouds: ["#4ade80", "#10b981", "#a3e635"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 85% at 80% 0%, rgba(74, 222, 128, 0.14), transparent 55%), radial-gradient(100% 80% at 15% 100%, rgba(16, 185, 129, 0.12), transparent 60%), linear-gradient(170deg, #06130b 0%, #0d2818 45%, #123524 75%, #081710 100%)",
      "--paper": "#081710",
      "--surface": "rgba(16, 44, 30, 0.75)",
      "--ink": "#e3f5e9",
      "--muted": "#9dc1aa",
      "--paper-line": "rgba(110, 231, 168, 0.25)",
      "--rule-line": "rgba(110, 231, 168, 0.06)",
      "--stamp": "#4ade80",
      "--stamp-soft": "rgba(74, 222, 128, 0.16)",
      "--cover": "rgba(18, 48, 32, 0.62)",
      "--on-cover": "#bbf7d0",
      "--on-accent": "#06130b",
      "--modal-bg": "#0e2b1c",
      "--cover-ink": "#8dae9a",
      "--cover-on-white": "#617369",
      "--tab-hover": "#e2faeb",
    },
  },
  {
    id: "midnight",
    label: "블랙",
    emoji: "🖤",
    blurb: "블랙 위로 금빛이 은은하게 흐르는 고급 다크 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#0d0d13", "#15151e"], clouds: ["#d4b46e", "#8a7440", "#6b7280"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 50% 0%, rgba(212, 180, 110, 0.10), transparent 55%), linear-gradient(180deg, #0a0a0f 0%, #15151e 52%, #0b0b10 100%)",
      "--paper": "#0d0d13",
      "--surface": "rgba(23, 23, 31, 0.78)",
      "--ink": "#ece8db",
      "--muted": "#aeaa97",
      "--paper-line": "#2c2c38",
      "--rule-line": "rgba(212, 180, 110, 0.06)",
      "--stamp": "#d4b46e",
      "--stamp-soft": "rgba(212, 180, 110, 0.14)",
      "--cover": "rgba(26, 26, 36, 0.65)",
      "--on-cover": "#e6cf96",
      "--on-accent": "#171204",
      "--modal-bg": "#1a1a24",
      "--cover-ink": "#92929e",
      "--tab-hover": "#f9f5eb",
      "--cover-on-white": "#6a6a71",
    },
  },
  {
    id: "sky",
    label: "블루",
    emoji: "☁️",
    blurb: "맑은 하늘색 구름이 흐르는 청량한 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#eaf5ff", "#d6ecff"], clouds: ["#6bb6f7", "#93c5fd", "#38bdf8"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 75% 0%, rgba(56, 189, 248, 0.22), transparent 55%), linear-gradient(180deg, #e9f4ff 0%, #d9ecff 45%, #f2f9ff 100%)",
      "--paper": "#e9f4ff",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#1f3a56",
      "--muted": "#50718a",
      "--paper-line": "#c6e0f5",
      "--rule-line": "rgba(29, 138, 224, 0.10)",
      "--stamp": "#006db8",
      "--stamp-soft": "#dcedfe",
      "--cover": "rgba(0, 101, 180, 0.85)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(24, 115, 196, 0.18)",
      "--cover-ink": "#126eb0",
      "--cover-on-white": "#126eb0",
    },
  },
  {
    id: "lavender",
    label: "퍼플",
    emoji: "💜",
    blurb: "연보라 빛무리가 부드럽게 흐르는 차분한 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#f4efff", "#e9dfff"], clouds: ["#a78bfa", "#c4b5fd", "#8b5cf6"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 20% 0%, rgba(139, 92, 246, 0.20), transparent 55%), linear-gradient(180deg, #f4efff 0%, #ebe2ff 50%, #f8f4ff 100%)",
      "--paper": "#f4efff",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#3f3358",
      "--muted": "#73678e",
      "--paper-line": "#ded1f2",
      "--rule-line": "rgba(139, 92, 246, 0.10)",
      "--stamp": "#7744de",
      "--stamp-soft": "#ecdffd",
      "--cover": "rgba(108, 77, 194, 0.85)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(109, 79, 196, 0.18)",
      "--cover-ink": "#6f53b5",
      "--cover-on-white": "#6f54b6",
    },
  },
  {
    id: "spring",
    label: "그린",
    emoji: "🌿",
    blurb: "연둣빛 봄기운이 흐르는 산뜻한 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#f3fbe6", "#e6f5d4"], clouds: ["#a3e635", "#4ade80", "#bef264"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 80% 0%, rgba(132, 204, 22, 0.18), transparent 55%), linear-gradient(180deg, #f3fbe6 0%, #e7f5d6 48%, #f6fcee 100%)",
      "--paper": "#f3fbe6",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#324222",
      "--muted": "#657753",
      "--paper-line": "#d8ecc0",
      "--rule-line": "rgba(101, 163, 13, 0.10)",
      "--stamp": "#497a00",
      "--stamp-soft": "#e9f6cf",
      "--cover": "rgba(63, 105, 0, 0.85)",
      "--on-cover": "#f7ffe8",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(77, 124, 15, 0.15)",
      "--cover-ink": "#55781d",
      "--cover-on-white": "#54771b",
    },
  },
  {
    id: "mintsoda",
    label: "민트",
    emoji: "🧊",
    blurb: "톡 쏘는 민트·청록 빛이 흐르는 시원한 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#ecfdf8", "#d8f7ef"], clouds: ["#2dd4bf", "#67e8f9", "#5eead4"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 80% 0%, rgba(45, 212, 191, 0.20), transparent 55%), linear-gradient(180deg, #ecfdf8 0%, #d8f7ef 50%, #f0fdfa 100%)",
      "--paper": "#ecfdf8",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#123f3c",
      "--muted": "#4f7972",
      "--paper-line": "#bfe9de",
      "--rule-line": "rgba(20, 184, 166, 0.10)",
      "--stamp": "#00786e",
      "--stamp-soft": "#d3f5ec",
      "--cover": "rgba(0, 104, 97, 0.82)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(13, 148, 136, 0.16)",
      "--cover-ink": "#1d7771",
      "--cover-on-white": "#1e7771",
    },
  },
  {
    id: "honey",
    label: "옐로",
    emoji: "🍯",
    blurb: "꿀빛·금빛이 따뜻하게 흐르는 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#fffbea", "#fdf1c7"], clouds: ["#fbbf24", "#fb923c", "#fde047"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 20% 0%, rgba(250, 204, 21, 0.25), transparent 55%), linear-gradient(180deg, #fffbea 0%, #fdf1c7 55%, #fff8e6 100%)",
      "--paper": "#fffbea",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#5a4410",
      "--muted": "#827049",
      "--paper-line": "#f3e3ae",
      "--rule-line": "rgba(202, 138, 4, 0.10)",
      "--stamp": "#946400",
      "--stamp-soft": "#fdf0c4",
      "--cover": "rgba(136, 81, 0, 0.85)",
      "--on-cover": "#fffbeb",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(161, 98, 7, 0.15)",
      "--cover-ink": "#92641d",
      "--cover-on-white": "#92641d",
    },
  },
  {
    id: "sunset",
    label: "오렌지",
    emoji: "🌇",
    blurb: "오렌지→핑크 노을빛이 흐르는 따뜻한 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#fff1e2", "#ffe0cc"], clouds: ["#fb923c", "#f472b6", "#fda4af"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 25% 0%, rgba(251, 146, 60, 0.28), transparent 55%), linear-gradient(160deg, #fff3e2 0%, #ffe2cd 42%, #ffd7e0 100%)",
      "--paper": "#fff1e0",
      "--surface": "rgba(255, 255, 255, 0.86)",
      "--ink": "#5a3040",
      "--muted": "#90635e",
      "--paper-line": "#f6d2c1",
      "--rule-line": "rgba(216, 79, 99, 0.09)",
      "--stamp": "#c03422",
      "--stamp-soft": "#ffe1d6",
      "--cover": "rgba(190, 54, 78, 0.88)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(216, 79, 99, 0.16)",
      "--cover-ink": "#b33d54",
      "--cover-on-white": "#b33d54",
    },
  },
  {
    id: "crimson",
    label: "레드",
    emoji: "🌹",
    blurb: "크림 바탕에 딥레드 빛이 스미는 클래식 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#fff6ec", "#fdeadf"], clouds: ["#f87171", "#e11d48", "#fca5a5"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 80% 0%, rgba(225, 29, 72, 0.12), transparent 55%), linear-gradient(165deg, #fff7ee 0%, #fdeadf 55%, #fadfd2 100%)",
      "--paper": "#fff6ec",
      "--surface": "rgba(255, 255, 255, 0.88)",
      "--ink": "#4a2020",
      "--muted": "#8e6760",
      "--paper-line": "#efd3c4",
      "--rule-line": "rgba(194, 32, 48, 0.09)",
      "--stamp": "#c22030",
      "--stamp-soft": "#fadcd7",
      "--cover": "rgba(159, 28, 46, 0.88)",
      "--on-cover": "#ffe9dc",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.70)",
      "--glass-shadow": "rgba(159, 28, 46, 0.15)",
    },
  },
  {
    id: "mono",
    label: "화이트",
    emoji: "🤍",
    blurb: "은빛 안개가 옅게 흐르는 깔끔한 무채색 무드",
    fx: {
      background: "nebula",
      nebulaPalette: { base: ["#fcfcfd", "#f1f2f4"], clouds: ["#cbd5e1", "#e2e8f0", "#94a3b8"] },
      glass: true,
    },
    vars: {
      "--page-bg":
        "radial-gradient(120% 80% at 50% 0%, rgba(148, 163, 184, 0.14), transparent 55%), linear-gradient(180deg, #ffffff 0%, #f6f7f8 100%)",
      "--paper": "#fcfcfd",
      "--surface": "rgba(255, 255, 255, 0.85)",
      "--ink": "#26282c",
      "--muted": "#70747c",
      "--paper-line": "#e5e7ea",
      "--rule-line": "rgba(38, 40, 44, 0.05)",
      "--stamp": "#3a3d43",
      "--stamp-soft": "#ededf0",
      "--cover": "rgba(38, 40, 44, 0.88)",
      "--on-cover": "#ffffff",
      "--on-accent": "#ffffff",
      "--glass-border": "rgba(255, 255, 255, 0.85)",
      "--glass-shadow": "rgba(38, 40, 44, 0.10)",
    },
  },
];

export const DEFAULT_THEME_ID = "paper";

export const THEME_IDS: string[] = THEMES.map((t) => t.id);

for (const [id,label,background,accent] of [['peachlight','피치','#fff4eb','#ac4933'],['mintlight','라이트 그린','#effcf5','#24674b'],['lilaclight','라이트 퍼플','#f7f0ff','#754395']]) {
 const theme=applyCustomTheme(THEMES[0],{version:1,background,surface:'#ffffff',accent,motion:false});
 THEMES.push({...theme,id,label,emoji:'🌷',blurb:'밝고 부드러운 색상 · 정적 배경'});
 THEME_IDS.push(id);
}

// 파스텔·투톤 라인업: 톤 생성기(toneTheme.ts)로 만든 색 + 흐르는 배경 + 기본 질감 "아크릴".
// 파스텔은 아이코 일정표 실측 문법(옅은 채움 L .88~.93 + 같은 계열 진한 글자, 대각선 투톤 배경, 색 바닥판 판)을 따른다.
// 주색=배경·표지·선 계열, 보조색=버튼·칩·포인트 글자 계열. 글자 대비 4.5:1 이상은 생성기가 보장한다(테스트로 확인).
const PASTEL_TONES: [id: string, label: string, mode: ToneMode, main: string, sub: string | null][] = [
  ["pastelpink", "파스텔 핑크", "pastel", "#ffc7dc", null],
  ["pastelblue", "파스텔 블루", "pastel", "#bcdcff", null],
  ["pastelpurple", "파스텔 퍼플", "pastel", "#d9ccff", null],
  ["pastelyellow", "파스텔 옐로", "pastel", "#ffeaa6", null],
  ["pastelmint", "파스텔 민트", "pastel", "#bdeedd", null],
  ["bluepink", "블루 + 핑크", "pastel", "#bfe3ff", "#ffc2df"],
  ["pinkpurple", "핑크 + 퍼플", "pastel", "#ffc9df", "#d6c8ff"],
  ["peachmint", "피치 + 민트", "pastel", "#ffd2bf", "#bdebd9"],
  ["purpleyellow", "퍼플 + 옐로", "pastel", "#d8ccff", "#ffe39a"],
  ["vividblueorange", "선명 블루 + 오렌지", "vivid", "#3d7bff", "#ff8a3d"],
  ["darknavypink", "다크 네이비 + 핑크", "dark", "#3a4a8c", "#ff7aa2"],
];

for (const [id, label, mode, main, sub] of PASTEL_TONES) {
  const tone = { mode, main, sub };
  THEMES.push(themeFromTone({ id, label, emoji: "", blurb: label, group: "pastel", tone, vars: {} }, { ...tone, motion: true }));
  THEME_IDS.push(id);
}

// v1(20개) → v2/v3 이행 매핑. DB accent_color 에 남아 있는 옛 id 를
// 가장 가까운 새 테마로 이어준다. 스트리머가 고른 분위기가 초기화되지 않게 하는 안전망.
const LEGACY_THEME_ALIASES: Record<string, string> = {
  darkneon: "nebula",
  cyberpunk: "berry",
  pastel: "paper",
  bubblegum: "paper",
  rosegold: "paper",
  forest: "deepforest",
  mint: "mintsoda",
  ocean: "sky",
  grape: "lavender",
  midnightgold: "midnight",
  slate: "midnight",
  cherry: "crimson",
  lemon: "honey",
  mocha: "honey",
  vintage: "sunset",
};

export function resolveTheme(id?: string | null, custom?: unknown): Theme {
  const wanted = id ? LEGACY_THEME_ALIASES[id] ?? id : undefined;
  const found = wanted ? THEMES.find((t) => t.id === wanted) : undefined;
  return applyCustomTheme(found ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID) ?? THEMES[0], custom);
}

export function isThemeId(id: string): boolean {
  return THEME_IDS.includes(id);
}
