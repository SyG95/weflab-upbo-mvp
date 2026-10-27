// 테마 톤 생성기(lib/toneTheme) · 질감(lib/materials) · 직접 색상 v1/v2(lib/customTheme).
// 핵심 약속: ① 어떤 조합이든 글자 대비 4.5:1 이상 ② 예전 방식(v1)으로 저장된 시트는 보던 그대로 ③ 저장값 1KB 안.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, resolveTheme } from "../lib/themes";
import { buildTone, contrastRatio, hexToOklch, mixHex, nebulaBackdrops, TONE_MODES } from "../lib/toneTheme";
import { MATERIALS, materialVars } from "../lib/materials";
import { parseCustomTheme, customThemeIsSafe, applyCustomTheme, type CustomTheme } from "../lib/customTheme";

const snapshot = JSON.parse(readFileSync(new URL("./theme-v1-snapshot.json", import.meta.url), "utf8"));

function parse(value: string): { hex: string; a: number } {
  if (value.startsWith("#")) return { hex: value.toLowerCase(), a: 1 };
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  assert.ok(m, `색 형식: ${value}`);
  return { hex: "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join(""), a: m[4] === undefined ? 1 : Number(m[4]) };
}
const flat = (value: string, under: string) => { const c = parse(value); return c.a >= 1 ? c.hex : mixHex(under, c.hex, c.a); };

const SEEDS = ["#ffb3d1", "#a7c7ff", "#9fe3c4", "#c9b5ff", "#ffe08a", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#888888", "#000000", "#ffffff", "#3b4f8f", "#ff8a3d", "#12a4b6"];

test("톤 생성기: 4톤 × 주색 15 × 보조색 16(없음 포함) 전 조합 글자 대비 4.5:1 이상", () => {
  let n = 0;
  for (const m of TONE_MODES) for (const main of SEEDS) for (const sub of [null, ...SEEDS]) {
    const p = buildTone({ mode: m.id, main, sub });
    assert.ok(p.minRatio >= 4.5, `${m.id} ${main} ${sub} ${JSON.stringify(p.checks)}`);
    n++;
  }
  assert.equal(n, 960);
});

test("톤 생성기: 파스텔은 고른 색을 탁하게 바꾸지 않는다(예전 #ffb3d1 → #8d6575 문제) — 같은 색상각의 옅은 채움", () => {
  const p = buildTone({ mode: "pastel", main: "#ffb3d1", sub: null });
  const seed = hexToOklch("#ffb3d1"), c = hexToOklch(p.vars["--cover"]);
  assert.ok(Math.abs(c.H - seed.H) < 8, "색상각 유지");
  assert.ok(c.L >= 0.875 && c.L <= 0.935 && c.C >= 0.05, `옅은 채움 L .88~.93(hex 반올림 오차 허용): ${c.L.toFixed(3)} C ${c.C.toFixed(3)}`);
  assert.ok(contrastRatio(p.vars["--on-cover"], p.vars["--cover"]) >= 4.5);
  // 버튼은 진한 덩어리가 아니라 옅은 채움 + 진한 글자
  assert.ok(hexToOklch(p.vars["--accent-fill"]).L >= 0.85, "버튼 바탕 옅게");
  assert.ok(contrastRatio(p.vars["--on-accent"], p.vars["--accent-fill"]) >= 4.5);
  assert.notEqual(p.vars["--muted"], p.vars["--ink"], "보조 글자와 본문 글자가 같은 색이면 위계가 사라진다");
});

test("톤 생성기: 세부 조정으로 배경·카드를 반대 밝기로 두면 안전하지 않다고 판정", () => {
  const p = buildTone({ mode: "pastel", main: "#ffb3d1", sub: null, bg: "#ffffff", card: "#111111" });
  assert.ok(p.minRatio < 4.5);
  assert.equal(customThemeIsSafe({ version: 2, tone: { mode: "pastel", main: "#ffb3d1", sub: null, motion: false, bg: "#ffffff", card: "#111111" } }), false);
  // 안전하지 않은 조합은 화면에 적용하지 않고 기본 테마를 유지한다
  const base = resolveTheme("paper");
  assert.deepEqual(applyCustomTheme(base, { version: 2, tone: { mode: "pastel", main: "#ffb3d1", sub: null, motion: false, bg: "#ffffff", card: "#111111" } }), base);
});

test("새 파스텔·투톤 프리셋 11종: 본문·보조·포인트 글자, 표지 글자, 버튼 글자 4.5:1 이상", () => {
  for (const t of THEMES.filter((x) => x.group === "pastel")) {
    const v = t.vars;
    const paper = v["--paper"];
    const surface = flat(v["--surface"], paper);
    for (const k of ["--ink", "--muted", "--stamp"]) for (const bg of [paper, surface]) {
      assert.ok(contrastRatio(v[k], bg) >= 4.5, `${t.id} ${k} on ${bg}`);
    }
    assert.ok(contrastRatio(v["--on-cover"], flat(v["--cover"], paper)) >= 4.5, `${t.id} on-cover`);
    assert.ok(contrastRatio(v["--on-accent"], v["--accent-fill"] ?? v["--stamp"]) >= 4.5, `${t.id} on-accent`);
    // 선택된 탭·칩 = 옅은 강조 바탕 위 포인트 글자
    assert.ok(contrastRatio(v["--stamp"], flat(v["--stamp-soft"], paper)) >= 4.5, `${t.id} stamp on stamp-soft`);
    // 표지색을 글자로 쓰는 곳(관리자 탭=흰 바탕, 세트 칩=옅은 강조 바탕)
    assert.ok(contrastRatio(v["--cover-on-white"], "#ffffff") >= 4.5, `${t.id} cover-on-white`);
    for (const bg of [paper, surface, flat(v["--stamp-soft"], paper)]) assert.ok(contrastRatio(v["--cover-ink"], bg) >= 4.5, `${t.id} cover-ink on ${bg}`);
  }
  assert.equal(THEMES.filter((x) => x.group === "pastel").length, 11);
});

test("질감: 전 테마 × 질감 전부 — 비치는 카드 뒤 어떤 배경색 위에서도 글자 4.5:1 이상", () => {
  let n = 0;
  for (const t of THEMES) for (const m of MATERIALS) {
    const mv = materialVars(t, m.id);
    const paper = t.vars["--paper"];
    const neb = t.fx?.background === "nebula" ? t.fx.nebulaPalette : undefined;
    const backdrops = [paper, ...(neb ? nebulaBackdrops(neb) : [])];
    for (const b of backdrops) {
      const seen = flat(mv["--mat-surface"], b);
      for (const k of ["--ink", "--muted", "--stamp"]) {
        assert.ok(contrastRatio(t.vars[k], seen) >= 4.5, `${t.id}/${m.id} ${k} over ${b}: ${contrastRatio(t.vars[k], seen).toFixed(2)}`);
      }
    }
    n++;
  }
  assert.equal(n, THEMES.length * MATERIALS.length);
});

test("새 프리셋과 직접 만든 색은 질감을 얹어도 예외 없이 4.5:1 이상", () => {
  const customs = TONE_MODES.flatMap((m) => ["#ffb3d1", "#3d7bff", "#ffe08a", "#2f6f5e"].map((main) =>
    resolveTheme("paper", { version: 2, tone: { mode: m.id, main, sub: "#ff8a3d", motion: true } })));
  for (const t of [...THEMES.filter((x) => x.group === "pastel"), ...customs]) for (const m of MATERIALS) {
    const mv = materialVars(t, m.id);
    const neb = t.fx?.nebulaPalette;
    for (const b of [t.vars["--paper"], ...(neb ? nebulaBackdrops(neb) : [])]) {
      const seen = flat(mv["--mat-surface"], b);
      for (const k of ["--ink", "--muted", "--stamp"]) assert.ok(contrastRatio(t.vars[k], seen) >= 4.5, `${t.id}/${m.id} ${k}`);
    }
  }
});

test("v1(예전 직접 색상)로 저장된 시트는 배포 전 코드와 똑같이 그린다", () => {
  for (const { input, theme } of snapshot.v1) {
    assert.deepEqual(resolveTheme("paper", input), theme);
  }
  // 정적 밝은 3종은 이름만 바뀌었고(10/27 sy "표준 색 이름") 색·효과는 그대로
  for (const old of snapshot.light) {
    const now = THEMES.find((t) => t.id === old.id);
    assert.deepEqual(now?.vars, old.vars, `${old.id} 색 변화 없음`);
    assert.deepEqual(now?.fx, old.fx, `${old.id} 효과 변화 없음`);
  }
});

test("저장값 검사: v2 형식만 통과, 모르는 키·질감·색 형식·버전은 거부", () => {
  const ok: CustomTheme = { version: 2, tone: { mode: "dark", main: "#3A4A8C", sub: "#FF7AA2", motion: true, bg: "#101010", card: "#202020", cover: "#303030", accent: "#ff00ff" }, material: "sticker" };
  const parsed = parseCustomTheme(ok);
  assert.equal(parsed?.version, 2);
  assert.equal(parsed?.version === 2 && parsed.tone?.main, "#3a4a8c", "소문자로 정규화");
  assert.ok(JSON.stringify(parsed).length <= 1024, "custom_theme 칸 1KB 제한");
  assert.deepEqual(parseCustomTheme({ version: 2, material: "bubble" }), { version: 2, material: "bubble" });
  for (const gone of ["frost", "stack", "stitch", "acrylic", "diary", "magazine"]) assert.throws(() => parseCustomTheme({ version: 2, material: gone }), `없앤·내장 질감 ${gone} 은 저장 거부`);
  assert.deepEqual(parseCustomTheme({ version: 2 }), { version: 2 });
  for (const bad of [
    { version: 3 },
    { version: 2, material: "neon" },
    { version: 2, extra: 1 },
    { version: 2, tone: { mode: "pastel", main: "red", sub: null, motion: false } },
    { version: 2, tone: { mode: "rainbow", main: "#ffffff", sub: null, motion: false } },
    { version: 2, tone: { mode: "pastel", main: "#ffffff", sub: null, motion: false, glow: "#ffffff" } },
    { version: 2, tone: { mode: "pastel", main: "#ffffff", motion: false } },
    { version: 2, tone: { mode: "pastel", main: "#ffffff", sub: null, motion: false, bg: "url(x)" } },
  ]) assert.throws(() => parseCustomTheme(bad), JSON.stringify(bad));
});

test("질감만 얹으면 색은 프리셋 그대로, 프리셋 기본 질감(아크릴) 값은 남지 않는다", () => {
  const base = resolveTheme("bluepink");
  assert.equal(base.fx?.material, "acrylic", "파스텔 프리셋 기본 질감");
  const withMat = resolveTheme("bluepink", { version: 2, material: "bubble" });
  for (const k of Object.keys(base.vars).filter((k) => !k.startsWith("--mat-"))) assert.equal(withMat.vars[k], base.vars[k]);
  assert.equal(withMat.fx?.material, "bubble");
  assert.equal(withMat.fx?.glass, true);
  assert.equal(withMat.fx?.background, base.fx?.background);
  assert.equal(withMat.vars["--mat-filter"], "none", "버블 값으로 덮임(아크릴 흐림 안 남음)");
  // 질감 없는 v2 는 프리셋(기본 질감 포함)과 같다
  assert.deepEqual(resolveTheme("bluepink", { version: 2 }), base);
  // 직접 만든 색을 파스텔 프리셋 위에 얹으면 프리셋의 옅은 버튼 바탕·질감 값이 새지 않는다
  const tone = resolveTheme("bluepink", { version: 2, tone: { mode: "vivid", main: "#3d7bff", sub: null, motion: false } });
  assert.equal(tone.vars["--accent-fill"], undefined);
  assert.ok(!Object.keys(tone.vars).some((k) => k.startsWith("--mat-")));
});

// ---------- 10/26 독립 리뷰 지적 재현 ----------

test("[리뷰 HIGH] 예전 방식(v1) 색을 어느 테마 위에 얹어도 바탕 표지색 기준 글자 변수가 새지 않는다", () => {
  const v1 = { version: 1, background: "#151025", surface: "#231830", accent: "#aaff99", motion: false };
  for (const t of THEMES) {
    const r = resolveTheme(t.id, v1);
    assert.equal(r.vars["--cover-ink"], undefined, `${t.id} --cover-ink 누출`);
    assert.equal(r.vars["--cover-on-white"], undefined, `${t.id} --cover-on-white 누출`);
    assert.equal(r.vars["--tab-hover"], undefined, `${t.id} --tab-hover 누출`);
  }
});

test("[리뷰 MEDIUM] 파스텔·투톤 프리셋의 반투명 카드: 흐르는 배경의 빛 색 위에서도 본문·보조·포인트 4.5:1", () => {
  for (const t of THEMES.filter((x) => x.group === "pastel")) {
    const neb = t.fx?.nebulaPalette;
    for (const b of [t.vars["--paper"], ...(neb ? nebulaBackdrops(neb) : [])]) {
      const seen = flat(t.vars["--surface"], b);
      for (const k of ["--ink", "--muted", "--stamp"]) assert.ok(contrastRatio(t.vars[k], seen) >= 4.5, `${t.id} ${k} over ${b}: ${contrastRatio(t.vars[k], seen).toFixed(2)}`);
    }
  }
});

test("[리뷰 MEDIUM] 관리자 탭: 평소(흰 바탕)·마우스 올림(--tab-hover) 둘 다 표지 글자 4.5:1", () => {
  const tones = TONE_MODES.flatMap((m) => SEEDS.map((main) => buildTone({ mode: m.id, main, sub: "#ff7aa2" }).vars));
  for (const v of [...THEMES.filter((x) => x.group === "pastel").map((t) => t.vars), ...tones]) {
    assert.ok(v["--tab-hover"], "탭 마우스 올림 바탕 변수");
    assert.ok(contrastRatio(v["--cover-on-white"], "#ffffff") >= 4.5);
    assert.ok(contrastRatio(v["--cover-on-white"], v["--tab-hover"]) >= 4.5, `hover ${v["--cover-on-white"]} on ${v["--tab-hover"]}`);
  }
});

test("[리뷰 LOW] 보조 글자는 옅은 강조 칸·구분선 바탕 위, 흐르는 배경 위에서도 4.5:1(새 톤만)", () => {
  for (const m of TONE_MODES) for (const main of SEEDS) {
    const p = buildTone({ mode: m.id, main, sub: "#9ccfff" });
    const v = p.vars;
    for (const bg of [v["--paper"], v["--surface"], v["--stamp-soft"], v["--paper-line"], ...nebulaBackdrops(p.nebula), p.vars["--paper"]]) {
      assert.ok(contrastRatio(v["--muted"], bg) >= 4.5, `${m.id} ${main} muted on ${bg}: ${contrastRatio(v["--muted"], bg).toFixed(2)}`);
    }
  }
});

test("[10/27 보정] 모든 테마(기존 17 + 새 11): 실제 CSS 조합 글자 대비 4.5:1 이상", () => {
  for (const t of THEMES) {
    const v = t.vars;
    const paper = v["--paper"];
    const backs = [paper, ...(t.fx?.background === "nebula" && t.fx.nebulaPalette ? nebulaBackdrops(t.fx.nebulaPalette) : [])];
    const card0 = flat(v["--surface"], paper);
    const soft = flat(v["--stamp-soft"], card0);
    const at = (fg: string, bg: string, what: string) => assert.ok(contrastRatio(fg, bg) >= 4.5, `${t.id} ${what}: ${fg} on ${bg} = ${contrastRatio(fg, bg).toFixed(2)}`);
    for (const b of backs) {
      const card = flat(v["--surface"], b);
      at(v["--ink"], card, "본문/카드");
      at(v["--muted"], card, "보조/카드");
      at(v["--stamp"], card, "포인트/카드");
      at(v["--on-cover"], flat(v["--cover"], b), "표지 글자/표지");
    }
    at(v["--stamp"], soft, "포인트/옅은 강조 칩(선택된 탭)");
    at(v["--on-accent"], v["--accent-fill"] ?? v["--stamp"], "버튼 글자/버튼 바탕");
    // 표지색을 글자로 쓰는 칩(.upboSet 등): --cover-ink, 없으면 표지색이 바탕 위에 비친 색
    for (const bg of [card0, soft]) at(v["--cover-ink"] ?? flat(v["--cover"], bg), bg, "표지색 글자/칩");
    // 관리자 탭: 흰 바탕, 마우스 올림 = --tab-hover(없으면 옅은 강조)
    // 마우스 올림 바탕이 반투명이면 뒤 표지가 비쳐 계산이 안 맞는다 → 반투명 옅은 강조색 테마는 --tab-hover 필수
    if (!v["--tab-hover"]) assert.ok(!/rgba/.test(v["--stamp-soft"]), `${t.id} 반투명 --stamp-soft 인데 --tab-hover 없음`);
    const hover = v["--tab-hover"] ?? v["--stamp-soft"];
    for (const bg of ["#ffffff", hover]) at(v["--cover-on-white"] ?? flat(v["--cover"], bg), bg, "관리자 탭 글자");
  }
});

test("[리뷰 LOW] 없앤 질감(frost 등)이 저장돼 있어도 화면은 색 설정을 살리고 질감만 무시", () => {
  const stored = { version: 2, tone: { mode: "pastel", main: "#bfe3ff", sub: "#ffc2df", motion: false }, material: "frost" };
  assert.throws(() => parseCustomTheme(stored), "저장 검사는 계속 거부");
  const r = resolveTheme("paper", stored);
  assert.equal(r.label, "내 색상", "톤은 적용");
  assert.notEqual(r.fx?.material, "frost", "없앤 질감은 무시(파스텔 톤 내장 모양만)");
});

test("파스텔 버튼·선택 탭 테두리: 버튼 채움·카드·바탕 모두와 3:1 이상(글자 아닌 요소 기준), 다른 톤엔 없음", () => {
  for (const m of TONE_MODES) for (const main of SEEDS) for (const sub of [null, "#ffc2df", "#9ccfff"]) {
    const v = buildTone({ mode: m.id, main, sub }).vars;
    if (m.id !== "pastel") { assert.equal(v["--accent-edge"], undefined); continue; }
    for (const bg of [v["--accent-fill"], v["--surface"], v["--paper"]]) {
      assert.ok(contrastRatio(v["--accent-edge"], bg) >= 3, `${main} ${sub} edge ${v["--accent-edge"]} on ${bg}: ${contrastRatio(v["--accent-edge"], bg).toFixed(2)}`);
    }
  }
  for (const t of THEMES.filter((x) => x.vars["--accent-fill"])) assert.ok(t.vars["--accent-edge"], `${t.id} 테두리 변수`);
  // 직접 만든 색·예전 방식 색을 파스텔 위에 얹으면 테두리 변수도 새지 않는다
  assert.equal(resolveTheme("bluepink", { version: 1, background: "#fff4f8", surface: "#ffffff", accent: "#cd477d", motion: false }).vars["--accent-edge"], undefined);
});

test("예시 테마와 '내 색상'은 같은 조립: 예시의 씨앗으로 직접 만들면 색·효과가 같다", () => {
  for (const t of THEMES.filter((x) => x.tone)) {
    const mine = resolveTheme("paper", { version: 2, tone: { ...t.tone!, motion: true } });
    assert.deepEqual(mine.vars, t.vars, `${t.id} vars`);
    assert.deepEqual(mine.fx, t.fx, `${t.id} fx`);
    assert.equal(mine.label, "내 색상");
  }
});

test("'이 테마에서 시작해 직접 수정': 모든 테마가 저장 가능한 조합으로 옮겨지고, 예시 테마는 모습이 그대로 이어진다", async () => {
  const { toneFromTheme } = await import("../lib/customTheme");
  for (const t of THEMES) {
    const tone = toneFromTheme(t);
    assert.ok(buildTone(tone).minRatio >= 4.5, `${t.id} 옮긴 톤이 기준 미달`);
    if (t.tone) {
      const mine = resolveTheme("paper", { version: 2, tone });
      assert.deepEqual(mine.vars, t.vars, `${t.id} 모습 이어짐`);
    }
  }
});
