import * as crypto from "node:crypto";

export type CatalogCapture = {
  sourceUrl?: string;
  page_url?: string;
  capturedAt?: string;
  captured_at?: string;
  groups?: Array<Record<string, unknown> & { items?: Array<Record<string, unknown>> }>;
};

export type ResultCapture = {
  sourceUrl?: string;
  page_url?: string;
  capturedAt?: string;
  captured_at?: string;
  rows?: Array<Record<string, unknown> & { results?: Array<Record<string, unknown>> }>;
};

export type NormalizedCatalogItem = {
  groupIndex: number;
  amountMin: number | null;
  amountMax: number | null;
  amountRangeLabel: string;
  enabled: boolean;
  doubleEnabled: boolean;
  itemName: string;
  normalizedName: string;
  probability: number;
  sortOrder: number;
  raw: unknown;
  // 룰렛표(금액대)별 기준확률 예외(applyThresholdOverrides)가 얹는 선택 필드.
  // 값이 없으면 전역 기준확률로 판정한다 — 오버레이 미사용 시 기존 판정과 100% 동일.
  thresholdOverridePercent?: number | null;
};

export type NormalizedCatalog = {
  type: "catalog";
  sourceUrl: string | null;
  capturedAt: string;
  groupCount: number;
  itemCount: number;
  groups: Array<{
    groupIndex: number;
    amountMin: number | null;
    amountMax: number | null;
    amountRangeLabel: string;
    enabled: boolean;
    doubleEnabled: boolean;
    items: NormalizedCatalogItem[];
  }>;
  items: NormalizedCatalogItem[];
  probabilitySums: Array<{ groupIndex: number; sum: number }>;
  warnings: string[];
  raw: CatalogCapture;
};

export type NormalizedResult = {
  sourceUid: string;
  rowIndex: number;
  donateTimeText: string;
  donationType: string;
  donationAmount: number | null;
  donationAmountText: string;
  fanNickname: string;
  fanId: string;
  itemName: string;
  normalizedName: string;
  probability: number | null;
  rawText: string;
  rouletteIndex: number;
  rouletteTotal: number;
  raw: unknown;
  sourceKey: string;
};

export type SpecialItemRule = {
  ruleKey: string;
  ruleType: "next_result_multiplier";
  status: "candidate" | "confirmed" | "rejected";
  multiplier: number;
  groupIndex?: number;
  amountRangeLabel?: string;
  itemName?: string;
  normalizedName?: string;
  probability?: number;
  // 현재 표에서 이 칸의 사용 여부(사용 안 함=false). 표시용 — 두배권 적용 여부는 status(두배권 맞음)만 본다.
  itemEnabled?: boolean;
};

export type ModifierState = {
  pendingByViewer?: Record<string, { multiplier: number; sourceKeys: string[] }>;
  processedSourceKeys?: string[];
};

export type ReconcileDecision = {
  sourceKey: string;
  decision: "record" | "duplicate" | "ignore" | "needs_review";
  reason: string;
  result: NormalizedResult;
  catalogItem: NormalizedCatalogItem | null;
  modifierRule?: SpecialItemRule | null;
  multiplier?: number;
  effectiveCount?: number;
  modifierSourceKeys?: string[];
  modifierAction?: "grant" | null;
};

export function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeName(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[\s_-]+/g, "");
}

// ---------- 미션 성공 정산 뭉치 판별(단일 소스) ----------
// 숲 "대결미션 별풍선 성공" / "도전미션 별풍선 성공" 정산 행 = 계정 없는 모금 정산(닉네임 칸=미션명).
// 정산 갯수가 룰렛표 금액과 맞으면 위플랩이 룰렛을 돌려 결과가 붙지만 귀속할 시청자가 없어
// 어느 상황에도 개인 업보가 될 수 없다(sy 확정 2026-08-24, 정가 제외와 같은 규칙; 룰렛 유령 실측
// 2026-09-09: 18건). 개인이 미션에 넣은 후원("성공" 없음)은 정당한 룰렛이라 그대로 판정한다.
// 후원집계(donationEvents.isMissionSuccess)·정가(buildFixedPriceCandidates)·룰렛 판정이 모두 이 함수를 쓴다.
export function isMissionSettlementType(type: unknown): boolean {
  const t = cleanText(type);
  return t.includes("미션") && t.includes("성공");
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // 위플랩은 1,000 이상 금액을 쉼표 천단위로 표기한다("1,487"). 쉼표를 소수점으로
  // 바꾸면 1,487 → 1.487 이 되어 정가·금액대 매칭이 통째로 빗나가므로, 천단위
  // 쉼표(뒤에 숫자 3개)는 먼저 제거하고 나머지 쉼표만 소수점으로 취급한다.
  const cleaned = String(value).replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
  const match = cleaned.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function nearlyEqual(a: unknown, b: unknown): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return false;
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}

function makeFallbackHash(parts: unknown[]): string {
  return crypto
    .createHash("sha1")
    .update(parts.map((part) => cleanText(part)).join("|"))
    .digest("hex")
    .slice(0, 16);
}

function amountRangeLabel(amountMin: number | null, amountMax: number | null): string {
  if (amountMin === null && amountMax === null) return "";
  if (amountMin !== null && amountMax !== null && amountMin === amountMax) return String(amountMin);
  return `${amountMin ?? ""}~${amountMax ?? ""}`;
}

function amountInRange(amount: number | null, item: NormalizedCatalogItem): boolean {
  if (amount === null) return false;
  if (item.amountMin !== null && amount < item.amountMin) return false;
  if (item.amountMax !== null && amount > item.amountMax) return false;
  return item.amountMin !== null || item.amountMax !== null;
}

export function specialRuleKeyForItem(item: Partial<NormalizedCatalogItem> & { name?: string }): string {
  const amount = item.amountRangeLabel || amountRangeLabel(toNumber(item.amountMin), toNumber(item.amountMax)) || "any";
  const name = item.normalizedName || normalizeName(item.itemName || item.name);
  const probability = toNumber(item.probability);
  return `${amount}::${name}::${probability ?? ""}`;
}

export function isMultiplierCandidateName(value: unknown): boolean {
  const raw = cleanText(value);
  if (!raw) return false;
  const compact = raw.replace(/[^0-9a-zA-Z가-힣]+/g, "").toLowerCase();
  const hasMultiplier = compact.includes("두배") || compact.includes("2배") || compact.includes("x2") || compact.includes("더블");
  const hasNext = compact.includes("다음") || compact.includes("next");
  const hasRewardWord = compact.includes("룰렛") || compact.includes("보상") || compact.includes("상품") || compact.includes("권");
  return hasMultiplier && (hasNext || hasRewardWord);
}

export function buildSpecialItemRuleCandidates(
  catalogItems: NormalizedCatalogItem[] = [],
  overrides: SpecialItemRule[] = [],
): SpecialItemRule[] {
  const overrideMap = new Map(overrides.map((rule) => [rule.ruleKey, rule]));
  // "사용 안 함"으로 꺼 둔 칸도 후보에 올린다 — 두배권 적용은 사용 여부가 아니라 "두배권 맞음" 확정만 본다
  // (sy 2026-10-01). 꺼진 칸을 빼면 확정도 못 하고 판정에서도 조용히 빠져 당첨이 검토함으로 사라진다.
  return catalogItems
    .filter((item) => isMultiplierCandidateName(item.itemName) || overrideMap.has(specialRuleKeyForItem(item)))
    .map((item) => {
      const ruleKey = specialRuleKeyForItem(item);
      const override = overrideMap.get(ruleKey);
      return {
        ruleKey,
        ruleType: "next_result_multiplier",
        status: override?.status || "candidate",
        multiplier: Number(override?.multiplier || 2),
        groupIndex: item.groupIndex,
        amountRangeLabel: item.amountRangeLabel,
        itemName: item.itemName,
        normalizedName: item.normalizedName,
        probability: item.probability,
        itemEnabled: item.enabled !== false,
      };
    });
}

function viewerKey(result: NormalizedResult): string {
  return cleanText(result.fanId);
}

function resultOrderKey(result: NormalizedResult): string {
  return [
    cleanText(result.donateTimeText),
    String(Number.isFinite(Number(result.rowIndex)) ? Number(result.rowIndex) : 0).padStart(6, "0"),
    String(Number.isFinite(Number(result.rouletteIndex)) ? Number(result.rouletteIndex) : 0).padStart(6, "0"),
    cleanText(result.sourceKey),
  ].join("|");
}

function valueOf(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

export function createSourceKey(result: Partial<NormalizedResult>): string {
  const sourceUid = cleanText(result.sourceUid);
  const rouletteIndex = Number.isFinite(Number(result.rouletteIndex)) ? Number(result.rouletteIndex) : 0;
  if (sourceUid) return `${sourceUid}::${rouletteIndex}`;
  return `fallback::${makeFallbackHash([
    result.donateTimeText,
    result.fanId,
    result.fanNickname,
    result.itemName,
    result.rawText,
    rouletteIndex,
  ])}`;
}

export function normalizeCatalogCapture(capture: CatalogCapture): NormalizedCatalog {
  if (!capture || typeof capture !== "object") throw new Error("catalog capture must be an object");
  const groups = Array.isArray(capture.groups) ? capture.groups : [];
  const normalizedGroups = groups.map((group, groupIndex) => {
    const actualGroupIndex = Number.isFinite(Number(group.groupIndex)) ? Number(group.groupIndex) : groupIndex;
    const amountMin = toNumber(valueOf(group, ["amountMin", "donation_amount_from"]));
    const amountMax = toNumber(valueOf(group, ["amountMax", "donation_amount_to"]));
    const items = (Array.isArray(group.items) ? group.items : [])
      .map((item, itemIndex) => {
        const itemName = cleanText(valueOf(item, ["name", "itemName", "rawProductName", "raw_product_name"]));
        const probability = toNumber(valueOf(item, ["probability", "probabilityPercent", "probability_percent"]));
        return {
          groupIndex: actualGroupIndex,
          amountMin,
          amountMax,
          amountRangeLabel: amountRangeLabel(amountMin, amountMax),
          enabled: Boolean(group.enabled ?? group.roulette_enabled ?? true),
          doubleEnabled: Boolean(group.doubleEnabled ?? group.annual_enabled ?? false),
          itemName,
          normalizedName: normalizeName(itemName),
          probability,
          sortOrder: Number.isFinite(Number(item.sortOrder ?? item.row_index))
            ? Number(item.sortOrder ?? item.row_index)
            : itemIndex,
          raw: item as unknown,
        };
      })
      .filter((item) => item.itemName.length > 0 && item.probability !== null)
      .map((item) => ({ ...item, probability: item.probability as number } satisfies NormalizedCatalogItem));
    return {
      groupIndex: actualGroupIndex,
      amountMin,
      amountMax,
      amountRangeLabel: amountRangeLabel(amountMin, amountMax),
      enabled: Boolean(group.enabled ?? group.roulette_enabled ?? true),
      doubleEnabled: Boolean(group.doubleEnabled ?? group.annual_enabled ?? false),
      items,
    };
  });
  const items = normalizedGroups.flatMap((group) => group.items);
  const probabilitySums = normalizedGroups.map((group) => ({
    groupIndex: group.groupIndex,
    sum: Number(group.items.reduce((sum, item) => sum + Number(item.probability || 0), 0).toFixed(6)),
  }));
  const warnings = probabilitySums
    .filter((entry) => Math.abs(entry.sum - 100) > 0.01)
    .map((entry) => `group ${entry.groupIndex} probability sum is ${entry.sum}%`);
  return {
    type: "catalog",
    sourceUrl: (capture.sourceUrl ?? capture.page_url ?? null) as string | null,
    capturedAt: (capture.capturedAt ?? capture.captured_at ?? new Date().toISOString()) as string,
    groupCount: normalizedGroups.length,
    itemCount: items.length,
    groups: normalizedGroups,
    items,
    probabilitySums,
    warnings,
    raw: capture,
  };
}

export function normalizeResultCapture(capture: ResultCapture): {
  type: "results";
  sourceUrl: string | null;
  capturedAt: string;
  rowCount: number;
  resultCount: number;
  results: NormalizedResult[];
  raw: ResultCapture;
} {
  if (!capture || typeof capture !== "object") throw new Error("result capture must be an object");
  const rows = Array.isArray(capture.rows) ? capture.rows : [];
  const results: NormalizedResult[] = [];
  rows.forEach((row, rowIndex) => {
    const rowResults = Array.isArray(row.results) ? row.results : [];
    rowResults.forEach((result, resultIndex) => {
      const itemName = cleanText(valueOf(result, ["name", "itemName", "resultName", "raw_product_name"]));
      const rouletteIndex = Number.isFinite(Number(result.index ?? result.rouletteIndex))
        ? Number(result.index ?? result.rouletteIndex)
        : resultIndex;
      const rouletteTotal = Number.isFinite(Number(result.total ?? result.rouletteTotal))
        ? Number(result.total ?? result.rouletteTotal)
        : rowResults.length;
      const normalized: NormalizedResult = {
        sourceUid: cleanText(valueOf(row, ["sourceUid", "uid", "source_uid"])),
        rowIndex,
        donateTimeText: cleanText(valueOf(row, ["donateTimeText", "donationTime", "donate_time_text"])),
        donationType: cleanText(valueOf(row, ["donationType", "type", "donation_type"])),
        donationAmount: toNumber(valueOf(row, ["donationAmount", "donation_amount", "amount", "donationCount", "donation_count", "giftCount", "gift_count"])),
        donationAmountText: cleanText(valueOf(row, ["donationAmountText", "donation_amount_text", "amountText", "amount_text", "giftText", "gift_text"])),
        fanNickname: cleanText(valueOf(row, ["fanNickname", "nickname", "fan_nickname"])),
        fanId: cleanText(valueOf(row, ["fanId", "accountId", "fan_id"])),
        itemName,
        normalizedName: normalizeName(itemName),
        probability: toNumber(valueOf(result, ["probability", "probabilityPercent", "probability_percent"])),
        rawText: cleanText(valueOf(result, ["rawText", "text", "raw_text"])),
        rouletteIndex,
        rouletteTotal,
        raw: { row, result },
        sourceKey: "",
      };
      normalized.sourceKey = createSourceKey(normalized);
      results.push(normalized);
    });
  });
  return {
    type: "results",
    sourceUrl: (capture.sourceUrl ?? capture.page_url ?? null) as string | null,
    capturedAt: (capture.capturedAt ?? capture.captured_at ?? new Date().toISOString()) as string,
    rowCount: rows.length,
    resultCount: results.length,
    results,
    raw: capture,
  };
}

export function findCatalogMatch(
  result: NormalizedResult,
  catalogItems: NormalizedCatalogItem[] = [],
  // includeDisabled: "사용 안 함" 칸까지 찾는다. 두배권 칸 식별 전용(reconcileResults) — 업보 기록 매칭은 기본(사용 중 칸만).
  options: { includeDisabled?: boolean } = {},
): NormalizedCatalogItem | null {
  const activeCatalogItems = options.includeDisabled ? catalogItems : catalogItems.filter((item) => item.enabled !== false);
  const normalizedName = result.normalizedName || normalizeName(result.itemName);
  const donationAmount = toNumber(result.donationAmount);
  const amountScoped = donationAmount === null
    ? []
    : activeCatalogItems.filter((item) => amountInRange(donationAmount, item));
  if (donationAmount !== null && amountScoped.length === 0) return null;
  const searchItems = donationAmount === null ? activeCatalogItems : amountScoped;
  const sameName = searchItems.filter((item) => item.normalizedName === normalizedName);
  if (sameName.length === 0) return null;
  if (result.probability !== null && result.probability !== undefined) {
    return sameName.find((item) => nearlyEqual(item.probability, result.probability)) || null;
  }
  return sameName[0];
}

// ---------- 룰렛표(금액대)별 기준확률 오버레이 — 순수 계산 ----------
// "이 금액대 룰렛표는 기준 몇 %" 예외만 확률표 상품에 얹는다. 키 = 금액대 라벨
// (amountRangeLabel, 예: "33", "330"). 룰렛 묶기(roulette_config, 팬 표시용)와는
// 완전히 별개인 판정 전용 설정이다 — 팬 화면 정리가 장부 판정을 건드리지 못하게 분리.
// 오버라이드가 비어 있으면 원본 배열을 그대로 반환한다(=기존 판정과 100% 동일 보장).

export type ThresholdOverrides = Record<string, number>;

export function cleanThresholdOverrides(raw: unknown): ThresholdOverrides {
  const cleaned: ThresholdOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return cleaned;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const label = cleanText(key);
    const pct = Number(value);
    if (!label || label.length > 40) continue;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    cleaned[label] = pct;
  }
  return cleaned;
}

export function applyThresholdOverrides(
  items: NormalizedCatalogItem[],
  overrides: ThresholdOverrides,
): NormalizedCatalogItem[] {
  if (Object.keys(overrides).length === 0) return items;
  return items.map((item) => {
    const pct = overrides[item.amountRangeLabel];
    return pct === undefined ? item : { ...item, thresholdOverridePercent: pct };
  });
}

// 표시·후보 계산용: 이 금액대 룰렛표의 유효 기준 확률. 판정(reconcileResults 의
// thresholdOverridePercent ?? threshold)과 같은 값을 내는 단일 소스 — 화면 배지·팬 확률표·
// 교환/수동 후보·별칭 힌트가 판정과 어긋나지 않게 여기만 쓴다.
export function effectiveThresholdForLabel(
  overrides: ThresholdOverrides,
  amountRangeLabel: string | null | undefined,
  globalThreshold: number,
): number {
  if (!amountRangeLabel) return globalThreshold;
  const pct = overrides[amountRangeLabel];
  return pct === undefined ? globalThreshold : pct;
}

// ---------- 배치 판정 규칙 스냅샷(judgeRules) — 순수 ----------
export type JudgeRules = {
  missionSettlementIgnore: boolean;
  // 두배권 칸은 "사용 안 함"으로 꺼 두었어도 "두배권 맞음" 확정이면 적용한다(sy 2026-10-01).
  // 꾸야 2026-09-03~09-30 사고: 사용 안 함 칸은 판정에서 "모르는 칸"이 되어 두배권 당첨 36건이 검토함으로 빠졌다.
  modifierIgnoresUsage: boolean;
};

// 저장된 배치 summary 에서 판정 규칙 스냅샷을 읽는다. 스냅샷이 없거나 깨진 옛 배치는 "규칙 없음"(false)으로
// 읽어 도입 전 판정을 그대로 재현한다(엄격 === true — 문자열 "true" 도 규칙 없음으로 본다 = 안전한 쪽으로 낙하).
export function readJudgeRules(summary: unknown): JudgeRules {
  const raw = summary && typeof summary === "object" ? (summary as { judgeRules?: unknown }).judgeRules : undefined;
  const rules =
    raw && typeof raw === "object" ? (raw as { missionSettlementIgnore?: unknown; modifierIgnoresUsage?: unknown }) : {};
  return {
    missionSettlementIgnore: rules.missionSettlementIgnore === true,
    modifierIgnoresUsage: rules.modifierIgnoresUsage === true,
  };
}

// 배치에 저장할 summary 조립: 판정 summary + 실제로 판정에 쓴 예외/규칙 스냅샷. 기준확률 예외가 없으면 키를
// 넣지 않아 옛 배치와 같은 모양을 유지하고, judgeRules 는 항상 넣는다(검증실이 이 값으로 재현 규칙을 정한다).
export function buildBatchSummary<T extends object>(
  summary: T,
  thresholdOverrides: ThresholdOverrides,
  judgeRules: JudgeRules,
): T & { thresholdOverrides?: ThresholdOverrides; judgeRules: JudgeRules } {
  return {
    ...summary,
    ...(Object.keys(thresholdOverrides).length > 0 ? { thresholdOverrides } : {}),
    judgeRules,
  };
}

export function reconcileResults({
  catalogItems = [],
  results = [],
  thresholdPercent = 2,
  existingSourceKeys = new Set<string>(),
  specialItemRules = [],
  modifierState = {},
  missionSettlementIgnore = true,
  modifierIgnoresUsage = true,
}: {
  catalogItems: NormalizedCatalogItem[];
  results: NormalizedResult[];
  thresholdPercent: number;
  existingSourceKeys?: Set<string>;
  specialItemRules?: SpecialItemRule[];
  modifierState?: ModifierState;
  // 미션 성공 정산 뭉치 결과를 무시하는 규칙(기본 켬). 검증실이 규칙 도입 전 배치를 저장 summary 와
  // 같게 재현할 때만 끈다(배치 summary.judgeRules 스냅샷 기준).
  missionSettlementIgnore?: boolean;
  // 두배권 칸을 "사용 안 함"으로 꺼 두어도 두배권 맞음 확정이면 부여하는 규칙(기본 켬, sy 2026-10-01).
  // 검증실이 규칙 도입 전 배치를 저장 summary 와 같게 재현할 때만 끈다(배치 summary.judgeRules 스냅샷 기준).
  modifierIgnoresUsage?: boolean;
}) {
  const processed = new Set<string>(modifierState.processedSourceKeys || []);
  const existing = new Set<string>(existingSourceKeys || []);
  for (const key of processed) existing.add(key);
  const confirmedRuleMap = new Map<string, SpecialItemRule>(
    specialItemRules
      .filter((rule) => rule.status === "confirmed" && rule.ruleType === "next_result_multiplier")
      .map((rule) => [rule.ruleKey, rule]),
  );
  const threshold = Number(thresholdPercent);
  const summary = {
    totalResults: results.length,
    recordCount: 0,
    effectiveRecordCount: 0,
    ignoreCount: 0,
    duplicateCount: 0,
    needsReviewCount: 0,
    modifierCount: 0,
    multiplierAppliedCount: 0,
    // 미션 정산 뭉치라서 무시한 결과 수(ignoreCount 에 포함). 미리보기·검증실 표시용.
    missionSettlementCount: 0,
  };
  const settlementKeys = new Set<string>();
  const decisions: ReconcileDecision[] = results.map((result) => {
    const sourceKey = result.sourceKey || createSourceKey(result);
    const catalogItem = findCatalogMatch(result, catalogItems);
    // 상품이 속한 룰렛표에 기준확률 예외가 얹혀 있으면 그 값으로, 없으면 전역 기준으로 판정.
    const itemThreshold = toNumber(catalogItem?.thresholdOverridePercent) ?? threshold;
    // 두배권 칸은 "사용 안 함"이어도 찾는다(modifierIgnoresUsage). 업보 기록 매칭(catalogItem)은 그대로 사용 중 칸만 본다.
    const modifierItem =
      catalogItem ?? (modifierIgnoresUsage ? findCatalogMatch(result, catalogItems, { includeDisabled: true }) : null);
    const ruleKey = modifierItem ? specialRuleKeyForItem(modifierItem) : "";
    // 미션 성공 정산 뭉치의 룰렛 결과는 귀속할 시청자가 없다 — 기록·검토함·두배권 부여 없이 무시한다
    // (isMissionSettlementType 주석 참고). 중복 검사 뒤에 두어 이미 기록된 옛 건은 duplicate 로 남는다
    // (재판정·검증실 재현의 멱등성 유지).
    const settlement = missionSettlementIgnore && isMissionSettlementType(result.donationType);
    const modifierRule = !settlement && ruleKey ? confirmedRuleMap.get(ruleKey) || null : null;
    let decision: ReconcileDecision["decision"];
    let reason: string;
    if (existing.has(sourceKey)) {
      decision = "duplicate";
      reason = "source key already exists";
      summary.duplicateCount += 1;
    } else if (settlement) {
      decision = "ignore";
      reason = "mission settlement bundle (no viewer account to attribute)";
      summary.ignoreCount += 1;
      summary.missionSettlementCount += 1;
      settlementKeys.add(sourceKey);
    } else if (modifierRule) {
      // 확정 두배권은 상품 매칭(사용 여부)보다 먼저 본다 — 꺼진 칸이어도 부여. 사용 중 칸이면 순서를 바꿔도 결과가 같다.
      decision = "ignore";
      reason = `confirmed modifier ${modifierRule.ruleType}`;
      summary.ignoreCount += 1;
      summary.modifierCount += 1;
    } else if (!catalogItem) {
      decision = "needs_review";
      reason = "no matching catalog item";
      summary.needsReviewCount += 1;
    } else if (catalogItem.probability <= itemThreshold) {
      decision = "record";
      reason = `catalog probability ${catalogItem.probability}% <= threshold ${itemThreshold}%`;
      summary.recordCount += 1;
    } else {
      decision = "ignore";
      reason = `catalog probability ${catalogItem.probability}% > threshold ${itemThreshold}%`;
      summary.ignoreCount += 1;
    }
    return {
      sourceKey,
      decision,
      reason,
      result,
      // 꺼진 두배권 칸으로 판정된 건은 그 칸을 남겨 검증실·미리보기에서 어느 표의 두배권인지 보이게 한다.
      catalogItem: catalogItem ?? (modifierRule ? modifierItem : null),
      modifierRule,
      multiplier: 1,
      effectiveCount: decision === "record" ? 1 : 0,
      modifierSourceKeys: [],
      modifierAction: modifierRule ? "grant" : null,
    };
  });

  const pendingByViewer = new Map<string, { multiplier: number; sourceKeys: string[] }>(
    Object.entries(modifierState.pendingByViewer || {}).map(([key, value]) => [
      key,
      {
        multiplier: Number(value?.multiplier || 1),
        sourceKeys: Array.isArray(value?.sourceKeys) ? value.sourceKeys : [],
      },
    ]),
  );
  const sorted = [...decisions].sort((a, b) => resultOrderKey(a.result).localeCompare(resultOrderKey(b.result)));
  for (const decision of sorted) {
    if (decision.decision === "duplicate") continue;
    // 정산 뭉치 결과는 시청자의 룰렛이 아니다 — 대기 두배권을 소모하지 않고 processed 에도 넣지 않는다
    // (재캡처마다 같은 규칙으로 다시 무시될 뿐이라 남길 상태가 없고, 오탐이면 규칙 수정 후 재판정으로 복구 가능).
    if (settlementKeys.has(decision.sourceKey)) continue;
    processed.add(decision.sourceKey);
    const key = viewerKey(decision.result);
    if (!key) continue;
    const pending = pendingByViewer.get(key);
    const appliedMultiplier = pending?.multiplier && pending.multiplier > 1 ? pending.multiplier : 1;
    const appliedSourceKeys = pending?.sourceKeys || [];
    if (pending) pendingByViewer.delete(key);

    if (decision.decision === "record") {
      decision.multiplier = appliedMultiplier;
      decision.effectiveCount = appliedMultiplier;
      decision.modifierSourceKeys = appliedSourceKeys;
      summary.effectiveRecordCount += appliedMultiplier;
      if (appliedMultiplier > 1) summary.multiplierAppliedCount += 1;
    }

    if (decision.modifierRule) {
      const gainedMultiplier = Math.max(2, Number(decision.modifierRule.multiplier || 2));
      pendingByViewer.set(key, {
        multiplier: appliedMultiplier * gainedMultiplier,
        sourceKeys: [...appliedSourceKeys, decision.sourceKey],
      });
    }
  }
  for (const decision of decisions) {
    if (decision.decision === "record" && !decision.effectiveCount) {
      decision.effectiveCount = 1;
      summary.effectiveRecordCount += 1;
    }
  }
  const nextModifierState: ModifierState = {
    pendingByViewer: Object.fromEntries([...pendingByViewer.entries()].filter(([, value]) => value.multiplier > 1)),
    processedSourceKeys: [...processed].slice(-5000),
  };
  return { summary, decisions, modifierState: nextModifierState };
}

export function buildUpboEntry({
  decision,
  streamerSlug,
  batchId,
  catalogVersion = null,
  now = new Date().toISOString(),
}: {
  decision: ReconcileDecision;
  streamerSlug: string;
  batchId: string;
  catalogVersion?: number | null;
  now?: string;
}) {
  if (decision.decision !== "record") return null;
  const result = decision.result;
  return {
    id: `upbo_${makeFallbackHash([streamerSlug, decision.sourceKey, batchId])}`,
    streamerSlug,
    sourceKey: decision.sourceKey,
    batchId,
    catalogVersion,
    status: "pending",
    fanNickname: result.fanNickname,
    fanId: result.fanId,
    itemName: result.itemName,
    probability: decision.catalogItem?.probability ?? result.probability,
    donateTimeText: result.donateTimeText,
    donationType: result.donationType,
    donationAmount: result.donationAmount,
    donationAmountText: result.donationAmountText,
    catalogGroupIndex: decision.catalogItem?.groupIndex ?? null,
    amountRangeLabel: decision.catalogItem?.amountRangeLabel ?? "",
    rouletteIndex: result.rouletteIndex,
    rouletteTotal: result.rouletteTotal,
    rawText: result.rawText,
    multiplier: decision.multiplier ?? 1,
    effectiveCount: decision.effectiveCount ?? 1,
    modifierSourceKeys: decision.modifierSourceKeys ?? [],
    createdAt: now,
    updatedAt: now,
    publicNote: "",
    adminNote: decision.effectiveCount && decision.effectiveCount > 1
      ? JSON.stringify({
          multiplier: decision.multiplier,
          effectiveCount: decision.effectiveCount,
          modifierSourceKeys: decision.modifierSourceKeys,
        })
      : "",
  };
}

// ---------- 팬 대문 제목(스트리머별, 표시 전용) — 순수 정리 ----------
// 대문 h1 "{이름} 업보시트" 를 스트리머가 직접 바꿔 부를 수 있게 한다(이모지·특수문자 자유).
// ""(빈 값) = 기본 "{이름} 업보시트" 그대로. 줄바꿈·탭은 공백으로 접고, 길이 상한은
// **코드포인트** 기준으로 자른다 — UTF-16 단위(slice)로 자르면 이모지 서로게이트 쌍이
// 반토막 나서 깨진 문자(�)가 대문에 박히기 때문. ZWJ 조합 이모지는 쪼개져도 낱개 이모지로
// 보일 뿐 깨지지 않는다. 상한 24 = 30px 대문 폰트에서 모바일 두 줄 안에 드는 길이.
export const SHEET_TITLE_MAX = 24;

export function cleanSheetTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\r\n\t\u3000\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
  return Array.from(flat).slice(0, SHEET_TITLE_MAX).join("").trim();
}
