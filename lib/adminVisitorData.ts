// 방문자 관제 화면에 필요한 집계만 새 객체로 만든다.
// 운영자 데이터나 오류 객체를 클라이언트에 그대로 전달하지 않는다.
import type { AdminDashboardData, AdminStreamerSummary, OfficialSummary } from "./adminDashboard";

export type VisitorStreamerSummary = {
  slug: string;
  displayName: string;
  recordSum: number;
  needsReviewSum: number;
  lastAppliedAt?: string;
};

export type VisitorOfficialSummary = {
  totalResults: number;
  recordCount: number;
  effectiveRecordCount?: number;
  ignoreCount: number;
  duplicateCount: number;
  needsReviewCount: number;
};

export type VisitorBatch = {
  catalogVersion: number;
  appliedAt?: string;
  entryCount: number;
  officialSummary: VisitorOfficialSummary;
};

export type VisitorCatalog = {
  version: number;
  isCurrent: boolean;
  capturedAt?: string;
  groupCount: number;
  itemCount: number;
};

export type VisitorDashboardData = {
  slug: string;
  displayName: string;
  thresholdPercent: number;
  currentCatalogVersion: number | null;
  counts: {
    batches: number;
    catalogs: number;
    // 현재 판단 로직의 검증용 재현 집계. 당시 공식 판단은 recentBatches의 공식 요약이다.
    record: number;
    ignore: number;
    duplicate: number;
    needsReview: number;
    recordedEntries: number;
  };
  recentBatches: VisitorBatch[];
  catalogs: VisitorCatalog[];
};

export type VisitorIndexResult =
  | { ok: true; streamers: VisitorStreamerSummary[] }
  | { ok: false; message: string };

export type VisitorDashboardResult =
  | { ok: true; data: VisitorDashboardData }
  | { ok: false; message: string };

const UNAVAILABLE_MESSAGE = "관제 현황을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.";
const RECENT_LIMIT = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function displayName(value: unknown, slug: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : slug;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !TIMESTAMP_RE.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function streamerSummary(row: AdminStreamerSummary): VisitorStreamerSummary {
  const summary: VisitorStreamerSummary = {
    slug: row.slug,
    displayName: displayName(row.displayName, row.slug),
    recordSum: count(row.recordSum),
    needsReviewSum: count(row.needsReviewSum),
  };
  const lastAppliedAt = timestamp(row.lastAppliedAt);
  if (lastAppliedAt) summary.lastAppliedAt = lastAppliedAt;
  return summary;
}

function officialSummary(source: OfficialSummary): VisitorOfficialSummary {
  const summary: VisitorOfficialSummary = {
    totalResults: count(source.totalResults),
    recordCount: count(source.recordCount),
    ignoreCount: count(source.ignoreCount),
    duplicateCount: count(source.duplicateCount),
    needsReviewCount: count(source.needsReviewCount),
  };
  if (typeof source.effectiveRecordCount === "number" && Number.isFinite(source.effectiveRecordCount)) {
    summary.effectiveRecordCount = count(source.effectiveRecordCount);
  }
  return summary;
}

function dashboardData(source: AdminDashboardData): VisitorDashboardData {
  return {
    slug: source.slug,
    displayName: displayName(source.displayName, source.slug),
    thresholdPercent: count(source.thresholdPercent),
    currentCatalogVersion: source.currentCatalogVersion === null ? null : count(source.currentCatalogVersion),
    counts: {
      batches: count(source.counts.batches),
      catalogs: count(source.counts.catalogs),
      record: count(source.counts.record),
      ignore: count(source.counts.ignore),
      duplicate: count(source.counts.duplicate),
      needsReview: count(source.counts.needsReview),
      recordedEntries: count(source.counts.reflections),
    },
    // 기존 읽기 어댑터가 최신 순서로 제공한다. 내부 배치 ID와 원본/재현 결과는 전달하지 않는다.
    recentBatches: source.batches.slice(0, RECENT_LIMIT).map((batch) => {
      const visible: VisitorBatch = {
        catalogVersion: count(batch.catalogVersion),
        entryCount: count(batch.entryCount),
        officialSummary: officialSummary(batch.officialSummary),
      };
      const appliedAt = timestamp(batch.appliedAt);
      if (appliedAt) visible.appliedAt = appliedAt;
      return visible;
    }),
    catalogs: source.catalogs.slice(0, RECENT_LIMIT).map((catalog) => {
      const visible: VisitorCatalog = {
        version: count(catalog.version),
        isCurrent: catalog.isCurrent === true,
        groupCount: count(catalog.groupCount),
        itemCount: count(catalog.itemCount),
      };
      const capturedAt = timestamp(catalog.capturedAt);
      if (capturedAt) visible.capturedAt = capturedAt;
      return visible;
    }),
  };
}

export async function getVisitorIndex(): Promise<VisitorIndexResult> {
  try {
    const { getAdminIndex } = await import("./adminDashboard");
    const result = await getAdminIndex();
    if (!result.ok) return { ok: false, message: UNAVAILABLE_MESSAGE };
    return {
      ok: true,
      streamers: result.streamers
        .filter((row) => typeof row.slug === "string" && SLUG_RE.test(row.slug))
        .map(streamerSummary),
    };
  } catch {
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
}

export async function getVisitorDashboardData(slug: string): Promise<VisitorDashboardResult> {
  if (!SLUG_RE.test(slug)) return { ok: false, message: UNAVAILABLE_MESSAGE };
  try {
    const { getAdminDashboardData } = await import("./adminDashboard");
    const result = await getAdminDashboardData(slug);
    if (!result.ok || result.data.slug !== slug) return { ok: false, message: UNAVAILABLE_MESSAGE };
    return { ok: true, data: dashboardData(result.data) };
  } catch {
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
}
