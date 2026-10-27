// 톤 생성기: 색 1~2개 + 톤(파스텔/선명/차분/어두운)만 고르면 테마 CSS 변수 한 세트를 채운다.
//
// 옛 직접 색상(v1)은 포인트색 하나가 글자·테두리·채움·표지를 다 맡아서, 글자 대비(4.5:1)를
// 맞추려고 검정을 섞다 보니 파스텔이 탁한 회색으로 바뀌었다(#ffb3d1 → #8d6575).
// 여기서는 색을 역할별로 나눈다.
//   채움(표지·옅은 강조·배경) = 고른 색의 밝은 톤 그대로
//   글자(포인트 글자·본문·보조) = 같은 색상각·채도를 유지한 채 명도만 내린(올린) 톤
// 색 계산은 OKLCH(사람 눈 기준 명도) 공간에서 하고, 화면에 못 그리는 색은 채도만 줄인다.

import type { NebulaPalette, ThemeVars } from "./themes";

export type ToneMode = "pastel" | "vivid" | "deep" | "dark";

export const TONE_MODES: { id: ToneMode; label: string; hint: string }[] = [
  { id: "pastel", label: "파스텔", hint: "밝은 바탕 · 옅은 표지" },
  { id: "vivid", label: "선명", hint: "밝은 바탕 · 진한 표지" },
  { id: "deep", label: "차분", hint: "무채 바탕 · 깊은 표지" },
  { id: "dark", label: "어두운", hint: "어두운 바탕" },
];

export type ToneInput = {
  mode: ToneMode;
  main: string; // 주색: 배경·표지 계열
  sub?: string | null; // 보조색(투톤): 포인트·옅은 강조 계열. 없으면 주색
  bg?: string; // 세부 조정(선택): 지정하면 자동 계산 대신 이 색을 쓴다
  card?: string;
  cover?: string;
  accent?: string;
};

export type ToneChecks = { ink: number; muted: number; accent: number; cover: number; onAccent: number; coverInk: number };

export type TonePalette = {
  vars: ThemeVars;
  nebula: NebulaPalette;
  checks: ToneChecks;
  minRatio: number;
  dark: boolean;
  // 포인트색을 글자용으로 진하게(밝게) 바꿨으면 그 색, 아니면 null
  accentText: string | null;
};

export const MIN_TEXT_RATIO = 4.5;

// ---------- 색 변환 ----------

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

type Rgb = [number, number, number]; // 0~1

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}
function rgbToHex(rgb: Rgb): string {
  return "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

type Lch = { L: number; C: number; H: number };

export function hexToOklch(hex: string): Lch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToLinear(L: number, C: number, H: number): Rgb {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// 화면(sRGB)에 없는 색이면 색상각·명도는 두고 채도만 줄여서 맞춘다.
export function oklchToHex(L: number, C: number, H: number): string {
  const l = Math.min(1, Math.max(0, L));
  let lo = 0;
  let hi = Math.max(0, C);
  if (!inGamut(oklchToLinear(l, hi, H))) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(l, mid, H))) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  return rgbToHex(oklchToLinear(l, hi, H).map(toGamma) as Rgb);
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v * (1 - t) + y[i] * t) as Rgb);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

// 같은 색상각·채도를 유지한 채 명도만 움직여 on 색들 모두와 min 대비를 넘는 첫 색을 찾는다.
// down=true 면 밝은 쪽에서 어두운 쪽으로(밝은 바탕용 글자), false 면 반대(어두운 바탕용 글자).
function readableShade(H: number, C: number, on: string[], min: number, down: boolean, start?: number): string {
  const from = start ?? (down ? 0.82 : 0.35);
  for (let i = 0; i <= 200; i++) {
    const L = down ? from - i * 0.005 : from + i * 0.005;
    if (L < 0 || L > 1) break;
    const hex = oklchToHex(L, C, H);
    if (on.every((o) => contrastRatio(hex, o) >= min)) return hex;
  }
  return down ? "#000000" : "#ffffff";
}

// 흐르는 배경(NebulaBackground 셰이더)이 실제로 칠할 수 있는 색들.
// 셰이더는 바탕 두 색 사이에 빛 색을 최대 22%·20%·12%만 섞는다(NebulaBackground.tsx mix 계수).
// 글자 대비는 이 색들 위에서 잰다(빛 색 원색 위에서 재면 화면에 나올 수 없는 조합까지 막게 된다).
export function nebulaBackdrops(p: NebulaPalette): string[] {
  const out: string[] = [];
  for (const b of p.base) {
    const a = mixHex(b, p.clouds[0], 0.22);
    const ab = mixHex(a, p.clouds[1], 0.2);
    out.push(b, a, mixHex(b, p.clouds[1], 0.2), mixHex(b, p.clouds[2], 0.12), mixHex(ab, p.clouds[2], 0.12));
  }
  return out;
}

// 반투명 카드(base 색, 불투명도 a)가 backdrops 위에 놓일 때 texts 가 모두 floor 이상 읽히는 가장 낮은 불투명도.
export function readableAlpha(base: string, want: number, backdrops: string[], texts: string[], floors: number[]): number {
  for (let a = want; a < 1; a += 0.02) {
    if (backdrops.every((b) => { const seen = mixHex(b, base, a); return texts.every((t, i) => contrastRatio(t, seen) >= floors[i]); })) return Number(a.toFixed(2));
  }
  return 1;
}

function minContrast(fg: string, bgs: string[]): number {
  return Math.min(...bgs.map((b) => contrastRatio(fg, b)));
}

// ---------- 톤별 목표값 (OKLCH 명도 L, 채도 C) ----------

type ModeSpec = {
  bg: [number, number];
  bg2: [number, number];
  card: [number, number];
  cover: [number, number];
  soft: [number, number];
  accentC: number;
  coverInk: "dark" | "white"; // 표지 글자 기본 방향
};

const MODE_SPECS: Record<ToneMode, ModeSpec> = {
  pastel: { bg: [0.962, 0.03], bg2: [0.958, 0.032], card: [0.995, 0.006], cover: [0.9, 0.06], soft: [0.945, 0.035], accentC: 0.12, coverInk: "dark" },
  vivid: { bg: [0.97, 0.02], bg2: [0.935, 0.04], card: [1, 0], cover: [0.55, 0.17], soft: [0.93, 0.06], accentC: 0.19, coverInk: "white" },
  deep: { bg: [0.955, 0.012], bg2: [0.925, 0.02], card: [0.995, 0.004], cover: [0.37, 0.085], soft: [0.92, 0.035], accentC: 0.12, coverInk: "white" },
  dark: { bg: [0.19, 0.03], bg2: [0.25, 0.05], card: [0.245, 0.032], cover: [0.33, 0.075], soft: [0.34, 0.06], accentC: 0.13, coverInk: "white" },
};

// 회색에 가까운 씨앗색은 결과도 회색에 가깝게(색상각이 의미 없어서 엉뚱한 색이 나오는 것 방지)
const chromaScale = (c: number) => Math.min(1, c / 0.09);

export function buildTone(input: ToneInput): TonePalette {
  const spec = MODE_SPECS[input.mode] ?? MODE_SPECS.pastel;
  const main = hexToOklch(input.main);
  const subSeed = hexToOklch(input.sub && isHex(input.sub) ? input.sub : input.main);
  const k1 = chromaScale(main.C);
  const k2 = chromaScale(subSeed.C);
  const H1 = main.H;
  const H2 = subSeed.H;

  const pastel = input.mode === "pastel";
  const bg = isHex(input.bg) ? input.bg.toLowerCase() : oklchToHex(spec.bg[0], spec.bg[1] * k1, H1);
  const bgL = hexToOklch(bg).L;
  const dark = relativeLuminance(bg) < 0.18;
  // 파스텔은 아이코 일정표 배경 문법: 주색 → 거의 흰색 → 보조색으로 흐르는 대각선 투톤(보조색이 없으면 주색 한 톤 진하게).
  const bg2 = isHex(input.bg) ? oklchToHex(bgL + (dark ? 0.04 : -0.025), hexToOklch(bg).C, hexToOklch(bg).H)
    : pastel && input.sub ? oklchToHex(spec.bg2[0], spec.bg2[1] * k2, H2)
    : oklchToHex(spec.bg2[0], spec.bg2[1] * k1, H1);
  const card = isHex(input.card) ? input.card.toLowerCase() : oklchToHex(spec.card[0], spec.card[1] * k1, H1);
  // 표지: 파스텔·선명은 고른 색의 밝기를 범위 안에서 그대로 살린다(노랑처럼 원래 밝은 색이 탁해지지 않게).
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const coverTarget: [number, number] =
    pastel ? [clamp(main.L, 0.88, 0.93), Math.min(main.C, 0.075)]
    : input.mode === "vivid" ? [clamp(main.L, 0.45, 0.62), Math.max(spec.cover[1] * k1, Math.min(main.C, 0.22))]
    : [spec.cover[0], spec.cover[1] * k1];
  let cover = isHex(input.cover) ? input.cover.toLowerCase() : oklchToHex(coverTarget[0], coverTarget[1], H1);
  // 선명·차분·어두운 표지는 흰 글자가 기본 — 흰 글자가 4.5:1 안 되면 같은 색을 조금씩 깊게 내린다.
  if (!isHex(input.cover) && spec.coverInk === "white") {
    for (let L = coverTarget[0]; contrastRatio("#ffffff", cover) < MIN_TEXT_RATIO && L > 0.2; L -= 0.01) cover = oklchToHex(L, coverTarget[1], H1);
  }

  const down = !dark; // 밝은 바탕 → 글자는 어둡게
  const line = oklchToHex(dark ? 0.37 : pastel ? 0.89 : 0.88, (pastel ? 0.04 : 0.035) * k1, H1);
  const mid = oklchToHex(0.985, 0.008 * k1, H1); // 대각선 투톤 가운데 거의 흰색
  const glow1 = oklchToHex(0.85, 0.09 * k1, H1);
  const glow2 = oklchToHex(0.86, 0.09 * k2, H2);
  const nebula: NebulaPalette = dark
    ? { base: [bg, bg2], clouds: [oklchToHex(0.45, 0.12 * k1, H1), oklchToHex(0.5, 0.13 * k2, H2), oklchToHex(0.38, 0.09 * k1, H1)] }
    : pastel ? { base: [bg, bg2], clouds: [oklchToHex(0.86, 0.08 * k1, H1), oklchToHex(0.87, 0.08 * k2, H2), mid] }
    : { base: [bg, bg2], clouds: [oklchToHex(0.84, 0.1 * k1, H1), oklchToHex(0.86, 0.1 * k2, H2), oklchToHex(0.9, 0.06 * k1, H1)] };

  // 포인트: 고른 색(또는 보조색)의 색상각·채도를 지킨 채 글자로 읽히는 명도만 찾는다.
  const accentSeed = isHex(input.accent) ? hexToOklch(input.accent) : null;
  const aH = accentSeed ? accentSeed.H : H2;
  const aC = accentSeed ? Math.max(accentSeed.C, 0.02) : spec.accentC * k2;
  const accentStart = accentSeed ? accentSeed.L : undefined;
  const aK = accentSeed ? chromaScale(accentSeed.C) : k2;
  // 옅은 강조 채움(탭·칩 바탕): 고른 색이 이미 충분히 밝으면 그대로, 아니면 같은 색상각의 옅은 톤
  const stampSoft = accentSeed && !dark && accentSeed.L >= 0.86 && !pastel
    ? (input.accent as string).toLowerCase()
    : oklchToHex(spec.soft[0], spec.soft[1] * aK, aH);
  // 파스텔의 버튼·선택 탭 바탕(--accent-fill): 진한 포인트색 덩어리 대신 옅은 채움 + 같은 계열 진한 글자(아이코 요일 머리 문법).
  // 다른 톤은 이 변수를 두지 않아 CSS 가 --stamp 로 채운다.
  const accentFill = !pastel ? null
    : accentSeed && accentSeed.L >= 0.8 ? (input.accent as string).toLowerCase()
    : oklchToHex(0.885, 0.075 * aK, aH);
  // 포인트 글자는 바탕·카드·옅은 강조 칸 위 모두에서 읽혀야 한다(선택된 탭 = 옅은 강조 바탕 + 포인트 글자).
  // 페이지에 바로 놓이는 글자의 바탕 후보: 정적 배경(--page-bg 의 옅은 강조 번짐 포함) + 흐르는 배경이 칠하는 색
  const softGlowAlpha = dark ? 0.32 : 0.6;
  const pageBacks = pastel
    ? [bg, bg2, mid, mixHex(bg, glow1, 0.45), mixHex(bg2, glow2, 0.38), ...nebulaBackdrops(nebula)]
    : [bg, bg2, mixHex(bg, stampSoft, softGlowAlpha), ...nebulaBackdrops(nebula)];
  // 본문·보조 글자: 바탕·카드·옅은 강조 칸·구분선 칸(배송완료 표시 등) 위 모두에서 읽혀야 한다.
  const textOn = [card, stampSoft, line, ...pageBacks];
  const ink = readableShade(H1, 0.035 * k1, [bg, card, stampSoft], 10, down, down ? 0.5 : 0.8);
  const muted = readableShade(H1, 0.03 * k1, textOn, 4.6, down);
  const stampOn = [card, stampSoft, ...pageBacks];
  const stamp = accentSeed && minContrast(input.accent as string, stampOn) >= MIN_TEXT_RATIO
    ? (input.accent as string).toLowerCase()
    : readableShade(aH, aC, stampOn, 4.6, down, down ? Math.min(accentStart ?? 0.82, 0.82) : Math.max(accentStart ?? 0.35, 0.35));
  const accentText = accentSeed && stamp !== (input.accent as string).toLowerCase() ? stamp : null;

  const white = "#ffffff";
  const fill = accentFill ?? stamp;
  // 파스텔 버튼·선택 탭 테두리(안쪽 1px): 같은 계열에서 버튼 채움·카드·바탕 모두와 3:1(글자 아닌 요소 기준)을 넘는 가장 옅은 톤.
  const accentEdge = accentFill ? readableShade(aH, Math.min(0.12, 0.09 * aK + 0.02), [accentFill, card, bg, bg2], 3, true, 0.75) : null;
  const onAccent = accentFill
    ? readableShade(aH, Math.min(0.12, 0.09 * aK + 0.02), [accentFill], MIN_TEXT_RATIO, true, 0.5)
    : contrastRatio(white, stamp) >= MIN_TEXT_RATIO ? white : readableShade(aH, 0.05, [stamp], MIN_TEXT_RATIO, true, 0.4);

  // 표지 글자: 흰색 / 표지와 같은 색상각의 진한 톤 / 밝은 톤 중 4.5:1 을 넘는 첫 후보(밝은 표지는 진한 톤 우선).
  const coverLch = hexToOklch(cover);
  const darkInk = readableShade(coverLch.H, Math.min(0.09, coverLch.C + 0.02), [cover], MIN_TEXT_RATIO, true, 0.45);
  const lightInk = readableShade(coverLch.H, 0.04, [cover], MIN_TEXT_RATIO, false, 0.85);
  const coverCandidates = relativeLuminance(cover) > 0.3 ? [darkInk, white, lightInk] : [white, lightInk, darkInk];
  const onCover = coverCandidates.find((c) => contrastRatio(c, cover) >= MIN_TEXT_RATIO)
    ?? coverCandidates.reduce((a, b) => (contrastRatio(a, cover) >= contrastRatio(b, cover) ? a : b));

  // 시트 CSS 일부는 표지색을 "글자"로 쓴다(관리자 탭=흰 바탕, 세트 칩=옅은 강조 바탕 등).
  // 파스텔 표지는 글자로 못 쓰니 같은 색상각의 읽히는 톤을 따로 준다. 기존 프리셋은 이 변수가 없어 그대로.
  const inkC = Math.min(0.12, coverLch.C + 0.02);
  const coverInk = readableShade(coverLch.H, inkC, [bg, card, stampSoft], MIN_TEXT_RATIO, down, down ? Math.min(coverLch.L, 0.62) : Math.max(coverLch.L, 0.6));
  // 관리자 탭은 흰 바탕, 마우스를 올리면 --tab-hover 바탕(어두운 톤에서도 밝게 유지).
  const tabHover = oklchToHex(0.93, 0.05 * (accentSeed ? chromaScale(accentSeed.C) : k2), aH);
  const coverOnWhite = readableShade(coverLch.H, inkC, [white, tabHover], MIN_TEXT_RATIO, true, Math.min(coverLch.L, 0.62));

  const checks: ToneChecks = {
    ink: minContrast(ink, textOn),
    muted: minContrast(muted, textOn),
    accent: minContrast(stamp, stampOn),
    cover: contrastRatio(onCover, cover),
    onAccent: contrastRatio(onAccent, fill),
    coverInk: Math.min(minContrast(coverInk, [bg, card, stampSoft]), minContrast(coverOnWhite, [white, tabHover])),
  };
  const minRatio = Math.min(...Object.values(checks));

  const softGlow = rgba(stampSoft, softGlowAlpha);
  const pageBg = pastel
    // 빛 덩어리는 2개·가장자리만(아이코 해부 규칙: 원을 여럿 겹치면 AI 메시 그라데이션 문법이 된다)
    ? `radial-gradient(60% 45% at 0% 0%, ${rgba(glow1, 0.45)}, transparent 70%), radial-gradient(55% 40% at 100% 0%, ${rgba(glow2, 0.38)}, transparent 70%), linear-gradient(135deg, ${bg} 0%, ${mid} 48%, ${bg2} 100%)`
    : `radial-gradient(120% 80% at 15% 0%, ${softGlow}, transparent 58%), linear-gradient(180deg, ${bg} 0%, ${bg2} 62%, ${bg} 100%)`;
  const vars: ThemeVars = {
    "--page-bg": pageBg,
    "--paper": bg,
    "--surface": card,
    "--ink": ink,
    "--muted": muted,
    "--paper-line": line,
    "--rule-line": rgba(ink, dark ? 0.06 : 0.07),
    "--stamp": stamp,
    "--stamp-soft": stampSoft,
    "--cover": cover,
    "--on-cover": onCover,
    "--cover-ink": coverInk,
    "--cover-on-white": coverOnWhite,
    "--tab-hover": tabHover,
    "--on-accent": onAccent,
    ...(accentFill ? { "--accent-fill": accentFill } : {}),
    ...(accentEdge ? { "--accent-edge": accentEdge } : {}),
    "--modal-bg": card,
    // 파스텔 카드 테두리는 흰 유리선 대신 주색의 옅은 선(아이코 판 1px 파란 테두리 .28~.48 문법)
    "--glass-border": dark ? "rgba(255, 255, 255, 0.14)" : pastel ? rgba(oklchToHex(0.7, 0.1 * k1, H1), 0.32) : "rgba(255, 255, 255, 0.72)",
    "--glass-shadow": dark ? "rgba(0, 0, 0, 0.42)" : rgba(mixHex(cover, ink, 0.4), pastel ? 0.12 : 0.16),
  };

  return { vars, nebula, checks, minRatio, dark, accentText };
}
