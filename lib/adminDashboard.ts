// 검증 대시보드(/admin/[streamerSlug]) 읽기 전용 어댑터.
//
// 원칙(요청 조건 반영):
// - 새로운 판정 로직을 만들지 않는다. core의 reconcileResults()를 "그대로" 재실행한다.
// - import_batches.summary 와 upbo_entries 는 "저장된 공식 기록"이다.
// - raw_imports 를 다시 돌린 decisions 는 "원본을 현재 로직으로 재현한 검증용 판단"이다(공식 기록 아님).
// - results 타입 raw_imports 에는 catalog_version 이 없을 수 있어, batch_id 로 import_batches 를
//   매칭해 catalog_version / threshold_percent 를 가져온다.
// - 쓰기/재판정/규칙 확정은 하지 않는다(읽기 전용).

import {
  getAdminDashboardSource,
  getAdminStreamerIndex,
  getOperatorState,
  isSupabaseConfigured,
  type AdminDashboardRawResult,
  type AdminStreamerIndexRow,
} from "@/lib/upboSupabase";
import {
  normalizeResultCapture,
  reconcileResults,
  type ModifierState,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type ReconcileDecision,
  type ResultCapture,
} from "@/lib/upboCore";
import type { DeliveryProgressItem } from "@/lib/api";

export type DecisionKind = "record" | "ignore" | "duplicate" | "needs_review";

export type DecisionRow = {
  sourceKey: string;
  batchId: string;
  catalogVersion: number | null;
  decision: DecisionKind;
  reason: string;
  fanNickname: string;
  fanId: string;
  itemName: string;
  probability: number | null;
  donationAmount: number | null;
  amountRangeLabel: string;
  donateTimeText: string;
  rouletteIndex: number;
  rouletteTotal: number;
  multiplier: number;
  effectiveCount: number;
};

export type RawResultRow = {
  sourceKey: string;
  batchId: string;
  fanNickname: string;
  fanId: string;
  itemName: string;
  donationType: string;
  donationAmount: number | null;
  donationAmountText: string;
  donateTimeText: string;
  rouletteIndex: number;
  rouletteTotal: number;
  probability: number | null;
  rawText: string;
};

export type ReconciledSummary = {
  totalResults: number;
  recordCount: number;
  ignoreCount: number;
  duplicateCount: number;
  needsReviewCount: number;
};

export type OfficialSummary = ReconciledSummary & { effectiveRecordCount?: number };

export type BatchView = {
  id: string;
  catalogVersion: number;
  thresholdPercent: number;
  capturedAt?: string;
  appliedAt?: string;
  entryCount: number;
  officialSummary: OfficialSummary;
  rawAvailable: boolean;
  // 이 배치를 보낸 확프 버전(raw_imports.raw.clientVersion). raw 없으면 undefined.
  clientVersion?: string;
  rederivedSummary?: ReconciledSummary;
  summaryMatches?: boolean;
};

export type CatalogView = {
  version: number;
  isCurrent: boolean;
  displayName?: string;
  sourceUrl?: string;
  capturedAt?: string;
  groupCount: number;
  itemCount: number;
  warnings: string[];
  probabilitySums: { groupIndex: number; sum: number }[];
  groups: {
    groupIndex: number;
    amountRangeLabel: string;
    enabled: boolean;
    doubleEnabled: boolean;
    items: { itemName: string; probability: number; enabled: boolean }[];
  }[];
};

export type ReflectionRow = {
  sourceKey: string;
  batchId: string;
  catalogVersion: number | null;
  status: string;
  fanNickname: string;
  fanId: string;
  itemName: string;
  probability: number;
  amountRangeLabel: string;
  multiplier: number;
  effectiveCount: number;
  donateTimeText: string;
};

export type AdminDashboardData = {
  source: "live" | "mock";
  slug: string;
  displayName: string;
  thresholdPercent: number;
  currentCatalogVersion: number | null;
  // raw_imports(results) 가 하나도 없으면 원본/판단/검토 탭은 재현 불가 → placeholder.
  rederiveAvailable: boolean;
  batches: BatchView[];
  catalogs: CatalogView[];
  rawResults: RawResultRow[];
  decisions: DecisionRow[];
  needsReview: DecisionRow[];
  reflections: ReflectionRow[];
  deliveryProgress: DeliveryProgressItem[];
  counts: {
    batches: number;
    catalogs: number;
    rawResults: number;
    record: number;
    ignore: number;
    duplicate: number;
    needsReview: number;
    reflections: number;
  };
};

export type AdminDashboardResult =
  | { ok: true; data: AdminDashboardData }
  | { ok: false; reason: "needs_env" | "notfound" | "error"; message?: string };

type Source = Awaited<ReturnType<typeof getAdminDashboardSource>>;
type SourceBatch = Source["batches"][number];

export async function getAdminDashboardData(slug: string): Promise<AdminDashboardResult> {
  // 자동 mock fallback 금지: 환경 미설정은 "환경 설정 필요"로 명확히 구분한다.
  if (!isSupabaseConfigured()) return { ok: false, reason: "needs_env" };
  try {
    const source = await getAdminDashboardSource(slug);
    let deliveryProgress: DeliveryProgressItem[] = [];
    try {
      const ops = await getOperatorState(slug);
      deliveryProgress = (ops.deliveryProgress as DeliveryProgressItem[]) ?? [];
    } catch {
      deliveryProgress = [];
    }
    return { ok: true, data: buildLiveDashboard(slug, source, deliveryProgress) };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) return { ok: false, reason: "notfound" };
    return { ok: false, reason: "error", message: (error as Error).message };
  }
}

export type AdminStreamerSummary = AdminStreamerIndexRow;

export type AdminIndexResult =
  | { ok: true; streamers: AdminStreamerSummary[] }
  | { ok: false; reason: "needs_env" | "error"; message?: string };

// 운영자 목록 화면(/admin)용. 검토 필요 많은 순 → 최근 수집 순으로 정렬.
export async function getAdminIndex(): Promise<AdminIndexResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "needs_env" };
  try {
    const streamers = await getAdminStreamerIndex();
    streamers.sort(
      (a, b) =>
        b.needsReviewSum - a.needsReviewSum ||
        String(b.lastAppliedAt ?? "").localeCompare(String(a.lastAppliedAt ?? "")) ||
        a.slug.localeCompare(b.slug),
    );
    return { ok: true, streamers };
  } catch (error) {
    return { ok: false, reason: "error", message: (error as Error).message };
  }
}

function buildLiveDashboard(
  slug: string,
  source: Source,
  deliveryProgress: DeliveryProgressItem[],
): AdminDashboardData {
  const catalogByVersion = new Map<number, Source["catalogs"][number]>();
  for (const c of source.catalogs) catalogByVersion.set(c.version, c);

  const rawByBatchId = new Map<string, ResultCapture>();
  for (const r of source.rawResults) {
    if (r.batchId) rawByBatchId.set(r.batchId, asResultCapture(r));
  }

  // 적용 순서대로 재실행해 batch 간 중복/두배권 상태를 누적 재현한다(공식 apply 순서와 동일).
  const batchesByAppliedAt = [...source.batches].sort((a, b) =>
    String(a.appliedAt ?? "").localeCompare(String(b.appliedAt ?? "")),
  );

  let modifierState: ModifierState = {};
  const seenSourceKeys = new Set<string>();
  const decisions: DecisionRow[] = [];
  const rawResults: RawResultRow[] = [];
  const batchViews: BatchView[] = [];

  for (const batch of batchesByAppliedAt) {
    const official = readOfficialSummary(batch);
    const raw = rawByBatchId.get(batch.id);
    if (!raw) {
      batchViews.push({ ...batchBase(batch), officialSummary: official, rawAvailable: false });
      continue;
    }
    const catalog = catalogByVersion.get(batch.catalogVersion);
    const catalogItems = ((catalog?.items ?? []) as NormalizedCatalogItem[]) || [];
    const normalized = normalizeResultCapture(raw);
    const recon = reconcileResults({
      catalogItems,
      results: normalized.results,
      thresholdPercent: batch.thresholdPercent,
      existingSourceKeys: seenSourceKeys,
      specialItemRules: source.specialItemRules,
      modifierState,
    });
    modifierState = recon.modifierState;
    for (const d of recon.decisions) {
      if (d.decision === "record") seenSourceKeys.add(d.sourceKey);
      decisions.push(toDecisionRow(d, batch));
    }
    for (const r of normalized.results) rawResults.push(toRawResultRow(r, batch.id));
    const rederived = summarizeDecisions(recon.decisions);
    batchViews.push({
      ...batchBase(batch),
      officialSummary: official,
      rawAvailable: true,
      clientVersion: readClientVersion(raw),
      rederivedSummary: rederived,
      summaryMatches:
        rederived.recordCount === official.recordCount &&
        rederived.ignoreCount === official.ignoreCount &&
        rederived.duplicateCount === official.duplicateCount &&
        rederived.needsReviewCount === official.needsReviewCount,
    });
  }

  const reflections = source.entries.map(entryToReflection);
  const needsReview = decisions.filter((d) => d.decision === "needs_review");

  return {
    source: "live",
    slug,
    displayName: source.streamer.displayName,
    thresholdPercent: source.streamer.settings.thresholdPercent,
    currentCatalogVersion: source.currentCatalogVersion,
    rederiveAvailable: rawResults.length > 0,
    batches: batchViews.reverse(), // 최신 배치 먼저
    catalogs: source.catalogs
      .map((c) => catalogToView(c, source.currentCatalogVersion))
      .reverse(),
    rawResults,
    decisions,
    needsReview,
    reflections,
    deliveryProgress,
    counts: {
      batches: batchViews.length,
      catalogs: source.catalogs.length,
      rawResults: rawResults.length,
      record: decisions.filter((d) => d.decision === "record").length,
      ignore: decisions.filter((d) => d.decision === "ignore").length,
      duplicate: decisions.filter((d) => d.decision === "duplicate").length,
      needsReview: needsReview.length,
      reflections: reflections.length,
    },
  };
}

function asResultCapture(r: AdminDashboardRawResult): ResultCapture {
  return (r.raw && typeof r.raw === "object" ? r.raw : {}) as ResultCapture;
}

// 확프가 payload 에 담아 보낸 버전(예 "0.2.3"). raw_imports.raw 에 통째 저장돼 있어 그대로 읽는다.
function readClientVersion(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as { clientVersion?: unknown }).clientVersion;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function batchBase(batch: SourceBatch) {
  return {
    id: batch.id,
    catalogVersion: batch.catalogVersion,
    thresholdPercent: batch.thresholdPercent,
    capturedAt: batch.capturedAt,
    appliedAt: batch.appliedAt,
    entryCount: batch.entryCount,
  };
}

function readOfficialSummary(batch: SourceBatch): OfficialSummary {
  const s = (batch.summary ?? {}) as Record<string, unknown>;
  const num = (key: string) => {
    const value = Number(s[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    totalResults: num("totalResults"),
    recordCount: num("recordCount"),
    ignoreCount: num("ignoreCount"),
    duplicateCount: num("duplicateCount"),
    needsReviewCount: num("needsReviewCount"),
    effectiveRecordCount: s.effectiveRecordCount !== undefined ? num("effectiveRecordCount") : undefined,
  };
}

function summarizeDecisions(items: ReconcileDecision[]): ReconciledSummary {
  const out: ReconciledSummary = {
    totalResults: items.length,
    recordCount: 0,
    ignoreCount: 0,
    duplicateCount: 0,
    needsReviewCount: 0,
  };
  for (const d of items) {
    if (d.decision === "record") out.recordCount += 1;
    else if (d.decision === "ignore") out.ignoreCount += 1;
    else if (d.decision === "duplicate") out.duplicateCount += 1;
    else out.needsReviewCount += 1;
  }
  return out;
}

function toDecisionRow(d: ReconcileDecision, batch: SourceBatch): DecisionRow {
  return {
    sourceKey: d.sourceKey,
    batchId: batch.id,
    catalogVersion: batch.catalogVersion,
    decision: d.decision,
    reason: d.reason,
    fanNickname: d.result.fanNickname,
    fanId: d.result.fanId,
    itemName: d.result.itemName,
    probability: d.catalogItem?.probability ?? d.result.probability ?? null,
    donationAmount: d.result.donationAmount,
    amountRangeLabel: d.catalogItem?.amountRangeLabel ?? "",
    donateTimeText: d.result.donateTimeText,
    rouletteIndex: d.result.rouletteIndex,
    rouletteTotal: d.result.rouletteTotal,
    multiplier: d.multiplier ?? 1,
    effectiveCount: d.effectiveCount ?? 0,
  };
}

function toRawResultRow(r: NormalizedResult, batchId: string): RawResultRow {
  return {
    sourceKey: r.sourceKey,
    batchId,
    fanNickname: r.fanNickname,
    fanId: r.fanId,
    itemName: r.itemName,
    donationType: r.donationType,
    donationAmount: r.donationAmount,
    donationAmountText: r.donationAmountText,
    donateTimeText: r.donateTimeText,
    rouletteIndex: r.rouletteIndex,
    rouletteTotal: r.rouletteTotal,
    probability: r.probability,
    rawText: r.rawText,
  };
}

function entryToReflection(e: Source["entries"][number]): ReflectionRow {
  return {
    sourceKey: e.sourceKey,
    batchId: e.batchId,
    catalogVersion: e.catalogVersion ?? null,
    status: e.status,
    fanNickname: e.fanNickname,
    fanId: e.fanId,
    itemName: e.itemName,
    probability: e.probability,
    amountRangeLabel: e.amountRangeLabel ?? "",
    multiplier: e.multiplier ?? 1,
    effectiveCount: e.effectiveCount ?? 1,
    donateTimeText: e.donateTimeText,
  };
}

function catalogToView(c: Source["catalogs"][number], currentVersion: number | null): CatalogView {
  const groups = (Array.isArray(c.groups) ? c.groups : []) as Array<Record<string, unknown>>;
  const itemCount =
    typeof c.itemCount === "number"
      ? c.itemCount
      : groups.reduce(
          (n, g) => n + (Array.isArray((g as { items?: unknown[] }).items) ? (g as { items: unknown[] }).items.length : 0),
          0,
        );
  return {
    version: c.version,
    isCurrent: c.version === currentVersion,
    displayName: c.displayName,
    sourceUrl: c.sourceUrl,
    capturedAt: c.capturedAt,
    groupCount: typeof c.groupCount === "number" ? c.groupCount : groups.length,
    itemCount,
    warnings: (Array.isArray(c.warnings) ? c.warnings : []) as string[],
    probabilitySums: (Array.isArray(c.probabilitySums) ? c.probabilitySums : []) as {
      groupIndex: number;
      sum: number;
    }[],
    groups: groups.map((g) => {
      const gg = g as Record<string, unknown>;
      const items = Array.isArray(gg.items) ? (gg.items as Array<Record<string, unknown>>) : [];
      return {
        groupIndex: Number(gg.groupIndex ?? 0),
        amountRangeLabel: String(gg.amountRangeLabel ?? ""),
        enabled: gg.enabled !== false,
        doubleEnabled: Boolean(gg.doubleEnabled),
        items: items.map((it) => ({
          itemName: String(it.itemName ?? ""),
          probability: Number(it.probability ?? 0),
          enabled: it.enabled !== false,
        })),
      };
    }),
  };
}
