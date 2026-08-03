// 위플랩 공개 공유 페이지(weflab.com/user/<hash>)에서 룰렛 확률표를 읽어온다.
// 이 페이지는 스트리머가 방송국(숲)에 상시 공유하는 고정 링크로, 서버렌더된 HTML에
// "지금 켜져 있는 룰렛표"만 담고 있다(로그인 불필요). 확프의 룰렛표 읽기(로그인 DOM)를
// 대체하는 링크 레인의 파서. 당첨 결과는 여기 없음 — 확프는 결과 전용으로 유지된다.
// 설계: AI-Sessions/wiki/design/weflab-public-link-catalog-ingestion-2026-07-08.md
//
// ★doubleEnabled(연차) 판정 불가: 공개 페이지엔 연차 여부를 나타내는 마커가 없다(정정 2026-07-09,
// 이전 "전원 일치" 기록은 오판이었음). doubleEnabled는 판정에 안 쓰이고 admin 배지 표시에만
// 쓰이므로(app/admin/[streamerSlug]/page.tsx:337) false 고정 — 매칭·업보 기록에 영향 없음.

import type { CatalogCapture } from "./upboCore";

export const WEFLAB_LINK_HOST_RE = /^https?:\/\/(www\.)?weflab\.com\/user\/[A-Za-z0-9]+\/?(\?.*)?$/;

export function isValidWeflabLink(url: string): boolean {
  return WEFLAB_LINK_HOST_RE.test(url.trim());
}

function normalizeWeflabLink(url: string): string {
  const trimmed = url.trim();
  return trimmed.replace(/^http:\/\//, "https://");
}

type Token =
  | { pos: number; kind: "min"; value: string; platform?: string }
  | { pos: number; kind: "max"; value: string; platform?: string }
  | { pos: number; kind: "name"; value: string }
  | { pos: number; kind: "percent"; value: string };

// 숲+치지직 동시송출 계정은 "후원 개수"를 플랫폼별로 나란히 렌더한다 —
// <p class="count platform_area platform_afreeca">(숲 별풍선)</p><p class="... platform_naver">(치즈)</p>.
// 값을 감싸는 이 블록을 찾아 min/max 토큰에 플랫폼을 달아준다. 라벨 없는 값(예전 형식)은 그대로 둔다.
function collectPlatformBlocks(html: string): Array<{ start: number; end: number; platform: string }> {
  const blocks: Array<{ start: number; end: number; platform: string }> = [];
  for (const m of html.matchAll(/<p class="count platform_area platform_([a-z0-9_]+)">/g)) {
    if (m.index === undefined) continue;
    const close = html.indexOf("</p>", m.index);
    blocks.push({ start: m.index, end: close === -1 ? m.index + m[0].length : close, platform: m[1] });
  }
  return blocks;
}

function collectTokens(html: string): Token[] {
  const platformBlocks = collectPlatformBlocks(html);
  const platformAt = (pos: number): string | undefined =>
    platformBlocks.find((b) => pos >= b.start && pos <= b.end)?.platform;
  const tokens: Token[] = [];
  const push = (re: RegExp, kind: Token["kind"]) => {
    for (const m of html.matchAll(re)) {
      if (m.index === undefined) continue;
      const token = { pos: m.index, kind, value: m[1] } as Token & { platform?: string };
      if (kind === "min" || kind === "max") {
        const platform = platformAt(m.index);
        if (platform) token.platform = platform;
      }
      tokens.push(token);
    }
  };
  // 1,000 이상 금액은 위플랩이 쉼표를 넣어 렌더한다("1,000") — 쉼표를 허용하지 않으면
  // 그 표의 min 토큰이 통째로 빠져 상품들이 앞 표에 합쳐지는 대형 오류가 난다.
  push(/class='value min'>([\d,]+)<\/span>/g, "min");
  push(/class='value max'>([\d,]+)<\/span>/g, "max");
  push(/value="([^"]*)" class="input_text input_roulette_name"/g, "name");
  push(/value="([^"]*)" class="input_text decimal right input_roulette_percent"/g, "percent");
  tokens.sort((a, b) => a.pos - b.pos);
  return tokens;
}

export type ParsedWeflabTable = {
  amountMin: number;
  amountMax: number | null;
  items: Array<{ name: string; probability: number }>;
};

// 문서 순서(토큰 위치)를 따라가며 min이 나오면 새 표를 열고, 그 다음 나오는 name/percent 쌍을
// 현재 표에 쌓는다. max는 min 직후(같은 표, 아직 아이템 없음)에만 그 표의 것으로 받는다.
// ★숲(afreeca) 외 플랫폼 기준값은 채택하지 않는다: 치지직(naver) 표기는 치즈 단위(별풍선의 100배)라
// 그대로 쓰면 기준이 100배로 뻥튀기된다(리루리 실사고 2026-08-03 — 표 8개 전부 치즈 단위로 저장됨).
// 치지직 후원을 어떻게 다룰지는 별도 결정 전까지 보류(sy 지시: 일단 숲만).
export function parseWeflabTables(html: string): ParsedWeflabTable[] {
  const tokens = collectTokens(html);
  const tables: ParsedWeflabTable[] = [];
  let current: ParsedWeflabTable | null = null;
  let pendingName: string | null = null;
  for (const t of tokens) {
    if ((t.kind === "min" || t.kind === "max") && t.platform && t.platform !== "afreeca") {
      // 아이템이 이미 붙은 표 뒤에 나온 타 플랫폼 min = 그 플랫폼 전용 새 표 시작.
      // 이후 아이템이 앞(숲) 표로 새지 않게 표를 닫는다. 숲 min 직후의 쌍 표기(아이템 0개)는 그냥 무시.
      if (t.kind === "min" && current && current.items.length > 0) {
        current = null;
        pendingName = null;
      }
      continue;
    }
    if (t.kind === "min") {
      current = { amountMin: Number(t.value.replace(/,/g, "")), amountMax: null, items: [] };
      tables.push(current);
      pendingName = null;
    } else if (t.kind === "max") {
      if (current && current.items.length === 0 && current.amountMax === null) {
        current.amountMax = Number(t.value.replace(/,/g, ""));
      }
    } else if (t.kind === "name") {
      pendingName = t.value;
    } else if (t.kind === "percent" && current && pendingName !== null) {
      const probability = Number(t.value);
      current.items.push({ name: pendingName, probability: Number.isFinite(probability) ? probability : 0 });
      pendingName = null;
    }
  }
  return tables.filter((t) => t.items.length > 0);
}

export function parseWeflabModifiedAt(html: string): string | null {
  const m = html.match(/수정시간은\s*<b[^>]*>([^<]+)<\/b>/);
  return m ? m[1].trim() : null;
}

export type WeflabPublicFetchResult = {
  capture: CatalogCapture;
  modifiedAtText: string | null;
  tableCount: number;
  itemCount: number;
};

export function buildCaptureFromHtml(html: string, sourceUrl: string): WeflabPublicFetchResult {
  const tables = parseWeflabTables(html);
  const modifiedAtText = parseWeflabModifiedAt(html);
  const groups = tables.map((t) => ({
    amountMin: t.amountMin,
    amountMax: t.amountMax ?? t.amountMin,
    enabled: true, // 공개 페이지엔 켜진 표만 존재 — 다시 나타난 표는 기본 켜짐(설계 확정).
    doubleEnabled: false, // 연차 마커 없음(정정) — 판정 무영향, 배지 표시만 못 켬.
    items: t.items.map((it, idx) => ({ name: it.name, probability: it.probability, sortOrder: idx })),
  }));
  const itemCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  return {
    capture: { sourceUrl, capturedAt: new Date().toISOString(), groups },
    modifiedAtText,
    tableCount: groups.length,
    itemCount,
  };
}

export class WeflabLinkFetchError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// 링크에서 직접 받아와 파싱한다. 실패해도 기존 카탈로그는 절대 건드리지 않는다(호출부에서
// 저장 전에만 이 함수를 쓰므로 실패 시 저장 자체가 안 일어남 — fail-safe).
export async function fetchWeflabPublicCatalog(rawUrl: string): Promise<WeflabPublicFetchResult> {
  const url = normalizeWeflabLink(rawUrl);
  if (!isValidWeflabLink(url)) {
    throw new WeflabLinkFetchError("weflab.com/user/ 형식의 공개 링크만 등록할 수 있어요.", 400);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; UpboLinkFetcher/1.0)" },
      redirect: "follow",
    });
  } catch {
    throw new WeflabLinkFetchError("위플랩 페이지에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
  if (!response.ok) {
    throw new WeflabLinkFetchError(`위플랩 페이지를 불러오지 못했어요 (HTTP ${response.status}).`, 502);
  }
  const html = await response.text();
  const result = buildCaptureFromHtml(html, url);
  if (result.tableCount === 0) {
    throw new WeflabLinkFetchError(
      "이 링크에서 룰렛표를 찾지 못했어요. 링크가 맞는지, 위플랩에 켜진 표가 있는지 확인해 주세요.",
      422,
    );
  }
  return result;
}

// 엉뚱한 링크 방지: 새로 받은 표의 상품 구성이 기존 표와 얼마나 겹치는지(자카드) 확인해
// 관리자에게 낮은 겹침을 경고할 수 있게 한다(저장을 막지는 않음 — 판단은 스트리머 몫).
export function overlapRatioWithExisting(
  newGroups: CatalogCapture["groups"],
  existingGroups: Array<{ items?: Array<{ itemName?: string }> }> | undefined,
): number {
  const existingNames = new Set<string>();
  for (const g of existingGroups ?? []) {
    for (const it of g.items ?? []) if (it.itemName) existingNames.add(it.itemName);
  }
  if (existingNames.size === 0) return 1; // 비교 대상 없으면 경고할 근거도 없음.
  const newNames = new Set<string>();
  for (const g of newGroups ?? []) {
    for (const it of (g.items as Array<{ name?: string }> | undefined) ?? []) {
      const name = it.name;
      if (name) newNames.add(String(name));
    }
  }
  if (newNames.size === 0) return 0;
  let inter = 0;
  for (const n of newNames) if (existingNames.has(n)) inter++;
  const union = new Set([...existingNames, ...newNames]).size;
  return union > 0 ? inter / union : 0;
}
