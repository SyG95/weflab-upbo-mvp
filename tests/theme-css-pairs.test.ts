// 시트 CSS 의 바탕-글자 짝 검사(10/27 독립 리뷰 HIGH 재발 방지).
// 파스텔은 --accent-fill(옅은 버튼 바탕) 위에 --on-accent(진한 글자)를 쓴다. 짝이 어긋나면 글자가 사라진다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../app/[streamerSlug]/", import.meta.url).pathname.replace(/%5B/g, "[").replace(/%5D/g, "]");
const SKIP = ["boardRequests.module.css"]; // 기간 끝난 실험 페이지

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return n.endsWith(".module.css") && !SKIP.includes(n) ? [p] : [];
  });
}
type Rule = { file: string; sel: string; body: string };
const rules: Rule[] = cssFiles(ROOT).flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ file: file.split("/").pop()!, sel: m[1].trim().split("\n").pop()!.trim(), body: m[2] })));
const bg = (b: string) => b.match(/background(?:-color)?\s*:\s*([^;]+)/)?.[1].trim();
const color = (b: string) => b.match(/(?<![-\w])color\s*:\s*([^;]+)/)?.[1].trim();

test("버튼 바탕(--accent-fill) 위 글자는 항상 --on-accent", () => {
  for (const r of rules) if (bg(r.body)?.includes("--accent-fill")) assert.equal(color(r.body), "var(--on-accent)", `${r.file} ${r.sel}`);
});

test("--on-accent 글자는 버튼 바탕(--accent-fill/--stamp) 위에서만", () => {
  for (const r of rules) {
    if (color(r.body) !== "var(--on-accent)") continue;
    const b = bg(r.body);
    if (b) assert.ok(b.includes("--accent-fill") || b === "var(--stamp)", `${r.file} ${r.sel}: ${b}`);
  }
});

test("버튼의 마우스 올림·비활성 상태가 바탕을 바꾸면 글자색도 같이 정한다", () => {
  const fills = new Set(rules.filter((r) => bg(r.body)?.includes("--accent-fill")).flatMap((r) => r.sel.split(",").map((s) => s.trim())));
  for (const r of rules) for (const s of r.sel.split(",").map((x) => x.trim())) {
    const base = s.replace(/(:hover|:active|:focus-visible|:focus|:disabled|\[aria-[^\]]+\])+$/, "");
    if (base === s || !fills.has(base)) continue;
    const b = bg(r.body);
    if (b && !b.includes("--accent-fill")) assert.ok(color(r.body), `${r.file} ${s}: 바탕 ${b} 인데 글자색 없음`);
  }
});

test("버튼 바탕(--accent-fill) 규칙은 안쪽 1px 테두리(--accent-edge, 없으면 투명)를 같이 그린다", () => {
  for (const r of rules) if (bg(r.body)?.includes("--accent-fill")) {
    assert.match(r.body, /box-shadow\s*:[^;]*inset 0 0 0 1px var\(--accent-edge, transparent\)/, `${r.file} ${r.sel}`);
  }
});
