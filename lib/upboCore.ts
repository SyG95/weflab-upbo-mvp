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
  return catalogItems
    .filter((item) => item.enabled !== false)
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
): NormalizedCatalogItem | null {
  const activeCatalogItems = catalogItems.filter((item) => item.enabled !== false);
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

export function reconcileResults({
  catalogItems = [],
  results = [],
  thresholdPercent = 2,
  existingSourceKeys = new Set<string>(),
  specialItemRules = [],
  modifierState = {},
}: {
  catalogItems: NormalizedCatalogItem[];
  results: NormalizedResult[];
  thresholdPercent: number;
  existingSourceKeys?: Set<string>;
  specialItemRules?: SpecialItemRule[];
  modifierState?: ModifierState;
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
  };
  const decisions: ReconcileDecision[] = results.map((result) => {
    const sourceKey = result.sourceKey || createSourceKey(result);
    const catalogItem = findCatalogMatch(result, catalogItems);
    const ruleKey = catalogItem ? specialRuleKeyForItem(catalogItem) : "";
    const modifierRule = ruleKey ? confirmedRuleMap.get(ruleKey) || null : null;
    let decision: ReconcileDecision["decision"];
    let reason: string;
    if (existing.has(sourceKey)) {
      decision = "duplicate";
      reason = "source key already exists";
      summary.duplicateCount += 1;
    } else if (!catalogItem) {
      decision = "needs_review";
      reason = "no matching catalog item";
      summary.needsReviewCount += 1;
    } else if (modifierRule) {
      decision = "ignore";
      reason = `confirmed modifier ${modifierRule.ruleType}`;
      summary.ignoreCount += 1;
      summary.modifierCount += 1;
    } else if (catalogItem.probability <= threshold) {
      decision = "record";
      reason = `catalog probability ${catalogItem.probability}% <= threshold ${threshold}%`;
      summary.recordCount += 1;
    } else {
      decision = "ignore";
      reason = `catalog probability ${catalogItem.probability}% > threshold ${threshold}%`;
      summary.ignoreCount += 1;
    }
    return {
      sourceKey,
      decision,
      reason,
      result,
      catalogItem,
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
