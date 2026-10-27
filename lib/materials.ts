// 질감 프리셋: 색 테마와 따로 골라 얹는 모양.
//   표면 질감(광택·입체·스티커) = 표지·검색·장부·쇼케이스 카드의 표면만 바꾼다.
//   디자인 질감(버블) = 표면 + 표지·탭·칩·버튼·장부 모양까지 바꾼다(page.module.css "디자인 질감" 블록).
//
// 색은 테마(themes.ts)가 정한다.
// 페이지 CSS 의 유리 규칙(.page[data-glass] ...)이 아래 변수를 읽는다.
//   --mat-surface : 카드 바탕(투명도 포함)      --mat-cover : 표지 바탕
//   --mat-filter  : 뒤 배경 흐림               --mat-border / --mat-shadow : 테두리·그림자
// 변수가 없으면 CSS 가 기존 유리 값으로 대체하므로, 질감을 안 고른 시트는 지금과 똑같다.
//
// 규칙: 무늬·결(도트, 종이 섬유, 노이즈)을 코드로 그리지 않는다(10/16 sy 규칙 — 장식·질감 그림은
// 래스터 자산 슬롯). 여기 있는 건 투명도·흐림·테두리·그림자 같은 표면 처리뿐이다.
// 10/27 sy 판정: 서리 유리·맑은 유리·매트 종이 제거(차이 미미) → 아크릴·겹침·점선 제거 → 다이어리·매거진 제거, 버블만 유지.
// "acrylic" 은 고르는 질감이 아니라 파스텔 예시 테마에 내장된 기본 모양(옅은 색 테두리·색 바닥판)으로만 쓴다.

import type { Theme, ThemeVars } from "./themes";
import { contrastRatio, mixHex, nebulaBackdrops, readableAlpha, relativeLuminance, rgba } from "./toneTheme";

export type MaterialId = "jelly" | "clay" | "sticker" | "bubble";
// 테마 내장 모양(고를 수 없음, 저장값으로 받지 않음)
export type BuiltinMaterialId = MaterialId | "acrylic";

export type Material = { id: MaterialId; label: string; blurb: string; kind: "surface" | "design" };

export const MATERIALS: Material[] = [
  { id: "jelly", label: "광택", blurb: "포인트색이 비치는 반질한 표면", kind: "surface" },
  { id: "clay", label: "입체", blurb: "도톰하게 튀어나온 표면", kind: "surface" },
  { id: "sticker", label: "스티커", blurb: "굵은 외곽선과 어긋난 그림자", kind: "surface" },
  { id: "bubble", label: "버블", blurb: "둥근 알약 모양 · 반짝이는 칩", kind: "design" },
];

export const MATERIAL_IDS: string[] = MATERIALS.map((m) => m.id);

export function isMaterialId(v: unknown): v is MaterialId {
  return typeof v === "string" && MATERIAL_IDS.includes(v);
}

// 테마 값은 "#rrggbb" 또는 "rgba(r, g, b, a)" 뿐이다. 못 읽으면 null.
type Rgba = { hex: string; a: number };
function parseColor(value: string | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return { hex: v.toLowerCase(), a: 1 };
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) return null;
  const hex = "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  return { hex, a: m[4] === undefined ? 1 : Math.min(1, Number(m[4])) };
}

// 반투명 색을 바탕색 위에 올렸을 때 실제로 보이는 불투명 색
function flatten(value: string | undefined, under: string): string | null {
  const c = parseColor(value);
  if (!c) return null;
  return c.a >= 1 ? c.hex : mixHex(under, c.hex, c.a);
}

// 카드를 비치게 할 때 글자(본문·보조·포인트)가 4.5:1 아래로 떨어지지 않는 가장 낮은 불투명도.
// 카드 뒤에 올 수 있는 색(바탕·흐르는 배경이 칠하는 색) 중 어느 것 위에서도 버텨야 한다. 못 버티면 불투명.
function safeAlpha(base: string, want: number, backdrops: string[], texts: string[]): number {
  return readableAlpha(base, want, backdrops, texts, texts.map(() => 4.5));
}

export function materialVars(theme: Theme, id: BuiltinMaterialId): ThemeVars {
  const v = theme.vars;
  const paper = parseColor(v["--paper"])?.hex ?? "#ffffff";
  const ink = parseColor(v["--ink"])?.hex ?? "#222222";
  const muted = parseColor(v["--muted"])?.hex ?? ink;
  const stamp = parseColor(v["--stamp"])?.hex ?? ink;
  const surface = flatten(v["--surface"], paper) ?? paper;
  const cover = flatten(v["--cover"], paper);
  const soft = flatten(v["--stamp-soft"], paper) ?? surface;
  const dark = relativeLuminance(ink) > relativeLuminance(paper);
  const line = flatten(v["--paper-line"], surface) ?? mixHex(surface, ink, 0.2);
  const opaqueCover = cover ?? "var(--cover)";
  const neb = theme.fx?.background === "nebula" ? theme.fx.nebulaPalette : undefined;
  const backdrops = [paper, ...(neb ? nebulaBackdrops(neb) : [])];
  const texts = [ink, muted, stamp];
  const see = (base: string, want: number) => rgba(base, safeAlpha(base, want, backdrops, texts));

  switch (id) {
    case "jelly": {
      // 카드에 포인트의 옅은 색을 비치게 섞고, 위쪽 반사광 + 아래쪽 포인트색 고임.
      // 섞는 양은 글자 대비가 버티는 만큼만(밝은 테마에서 색을 섞으면 카드가 어두워져 보조 글자가 흐려진다).
      let tint = dark ? 0.45 : 0.4;
      while (tint > 0 && !texts.every((t) => contrastRatio(t, mixHex(surface, soft, tint)) >= 4.5)) tint = Math.max(0, tint - 0.05);
      const base = mixHex(surface, soft, tint);
      return {
        "--mat-surface": see(base, dark ? 0.74 : 0.66),
        "--mat-filter": "blur(14px) saturate(1.5)",
        "--mat-border": `1px solid ${rgba(stamp, dark ? 0.35 : 0.22)}`,
        "--mat-shadow": `inset 0 2px 0 ${dark ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.9)"}, inset 0 -16px 26px -18px ${rgba(stamp, dark ? 0.55 : 0.42)}, 0 14px 30px -12px ${rgba(stamp, dark ? 0.5 : 0.38)}`,
      };
    }
    case "clay":
      return {
        "--mat-surface": surface,
        "--mat-cover": opaqueCover,
        "--mat-filter": "none",
        "--mat-border": "1px solid transparent",
        "--mat-shadow": dark
          ? "0 18px 30px -14px rgba(0, 0, 0, 0.6), inset 0 3px 2px rgba(255, 255, 255, 0.08), inset 0 -5px 8px rgba(0, 0, 0, 0.35)"
          : `0 18px 30px -14px ${rgba(stamp, 0.32)}, 0 4px 10px -4px ${rgba(ink, 0.10)}, inset 0 3px 2px rgba(255, 255, 255, 0.9), inset 0 -5px 8px ${rgba(ink, 0.08)}`,
      };
    case "sticker": {
      // 어긋난 그림자는 포인트색. 바탕과 거의 같은 색이면 본문색으로 바꿔 윤곽이 보이게 한다.
      const offset = contrastRatio(stamp, paper) >= 1.6 ? stamp : ink;
      return {
        "--mat-surface": surface,
        "--mat-cover": opaqueCover,
        "--mat-filter": "none",
        "--mat-border": `2px solid ${rgba(ink, 0.88)}`,
        "--mat-shadow": `4px 4px 0 ${rgba(offset, 0.85)}`,
      };
    }
    case "acrylic": {
      // 아이코 일정표 판 문법: 옅은 색 테두리 + 흐림 없는 색 바닥판(한 장 더 깔린 아크릴) + 큰 부드러운 그림자 + 안쪽 흰 1px.
      const edge = mixHex(cover ?? stamp, ink, 0.3);
      const plate = mixHex(soft, stamp, 0.25);
      return {
        "--mat-surface": see(surface, 0.9),
        "--mat-filter": "blur(12px) saturate(1.2)",
        "--mat-border": dark ? "1.5px solid rgba(255, 255, 255, 0.18)" : `1.5px solid ${rgba(edge, 0.42)}`,
        "--mat-shadow": dark
          ? `0 10px 0 ${rgba(stamp, 0.22)}, 0 22px 48px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.06)`
          : `0 10px 0 ${rgba(plate, 0.55)}, 0 22px 48px ${rgba(ink, 0.1)}, inset 0 0 0 1px rgba(255, 255, 255, 0.9)`,
      };
    }
    case "bubble": {
      // 둥근 알약: 큰 둥근 모서리 + 부드러운 색 그림자 + 위쪽 하이라이트.
      const tint = mixHex(soft, stamp, 0.3);
      return {
        "--mat-surface": surface,
        "--mat-cover": opaqueCover,
        "--mat-filter": "none",
        "--mat-border": `1.5px solid ${rgba(tint, dark ? 0.6 : 0.55)}`,
        "--mat-shadow": dark
          ? `0 16px 32px -14px rgba(0, 0, 0, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.1)`
          : `0 16px 32px -14px ${rgba(stamp, 0.32)}, inset 0 2px 0 rgba(255, 255, 255, 0.85)`,
        "--mat-edge": rgba(tint, dark ? 0.7 : 0.6),
        "--mat-gloss": dark ? "inset 0 1px 0 rgba(255, 255, 255, 0.14)" : "inset 0 1px 0 rgba(255, 255, 255, 0.85)",
      };
    }
  }
}

// 테마에 질감을 얹는다. 유리 규칙 선택자를 타야 하므로 glass 를 켠다.
export function applyMaterial(theme: Theme, id: BuiltinMaterialId | null | undefined): Theme {
  if (!id || !(isMaterialId(id) || id === "acrylic")) return theme;
  const vars = withoutMaterialVars(theme.vars);
  return { ...theme, vars: { ...vars, ...materialVars({ ...theme, vars }, id) }, fx: { ...theme.fx, glass: true, material: id } };
}

export function withoutMaterialVars(vars: ThemeVars): ThemeVars {
  return Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith("--mat-")));
}
