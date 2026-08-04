import crypto from "node:crypto";

import type { WardrobeItem, WardrobeState, WardrobeTheme } from "./wardrobeShared";
import {
  jaccardStrings,
  normalizeAccountId,
  normalizeFanDeliveryReflect,
  normalizeFanLayout,
  type CatalogGroup,
  type FanDeliveryReflect,
  type FanLayout,
  type RouletteConfigEntry,
  type FanTabLabelEntry,
  type FanTabLabels,
  type WeflabLinkInfo,
  type ViewerHolding,
} from "./api";
import {
  buildSpecialItemRuleCandidates,
  buildUpboEntry,
  cleanText,
  normalizeCatalogCapture,
  normalizeName,
  normalizeResultCapture,
  reconcileResults,
  toNumber,
  type CatalogCapture,
  type ModifierState,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type ReconcileDecision,
  type ResultCapture,
  type SpecialItemRule,
} from "./upboCore";
import { collectRejudgeCandidates, type RejudgeSourceBatch } from "./rejudge";
import { buildAliasCandidates, cleanAliasMap, type ItemAliasMap } from "./itemAlias";
import { isThemeId } from "./themes";
import { normalizeNoticeFont } from "./noticeFonts";
import { parseDonateTime } from "./donationEvents";

type Json = unknown;

type StreamerRow = {
  id: string;
  slug: string;
  display_name: string;
  threshold_percent: number;
  site_title?: string | null;
  sheet_name?: string | null;
  poster_image_url?: string | null;
  accent_color?: string | null;
  created_at?: string;
  updated_at?: string;
};

type CatalogRow = {
  id: string;
  streamer_id: string;
  version: number;
  display_name?: string | null;
  amount_set_label?: string | null;
  source_url?: string | null;
  captured_at?: string | null;
  group_count?: number | null;
  item_count?: number | null;
  probability_sums?: Json;
  warnings?: Json;
  groups: Json;
  items: Json;
  raw?: Json;
  created_at?: string;
};

type BatchRow = {
  id: string;
  streamer_id: string;
  catalog_version: number;
  threshold_percent: number;
  source_url?: string | null;
  captured_at?: string | null;
  applied_at?: string;
  summary: Json;
  entry_count: number;
};

type UpboEntryRow = {
  id: string;
  streamer_id: string;
  source_key: string;
  batch_id?: string | null;
  catalog_version?: number | null;
  status: string;
  fan_nickname?: string | null;
  fan_id?: string | null;
  item_name: string;
  probability?: number | null;
  donate_time_text?: string | null;
  donation_type?: string | null;
  donation_amount?: number | null;
  donation_amount_text?: string | null;
  catalog_group_index?: number | null;
  amount_range_label?: string | null;
  roulette_index?: number | null;
  roulette_total?: number | null;
  raw_text?: string | null;
  public_note?: string;
  admin_note?: string;
  created_at?: string;
  updated_at?: string;
  raw_import_id?: string | null;
  current_owner_name?: string | null;
  current_owner_id?: string | null;
  current_item_name?: string | null;
  quantity_original?: number | null;
  quantity_current?: number | null;
};

type ViewerNoteRow = {
  id?: string;
  streamer_id?: string;
  fan_id: string;
  fan_nickname_snapshot?: string | null;
  note_text: string;
  created_at?: string;
  updated_at?: string;
};

type DeliveryProgressRow = {
  id?: string;
  streamer_id?: string;
  fan_id: string;
  fan_nickname_snapshot?: string | null;
  item_key: string;
  item_name: string;
  probability?: number | null;
  amount_range_label?: string | null;
  processed_count: number;
  created_at?: string;
  updated_at?: string;
};

type RawImportRow = {
  id?: string;
  streamer_id?: string;
  type?: string;
  batch_id?: string | null;
  catalog_version?: number | null;
  captured_at?: string | null;
  saved_at?: string | null;
  raw: Json;
};

type ItemEventRow = {
  id?: string;
  upbo_entry_id: string;
  streamer_id: string;
  event_type: string;
  actor_type: string;
  actor_id?: string | null;
  before_json?: unknown;
  after_json?: unknown;
  quantity_delta?: number | null;
  reason?: string | null;
  memo?: string | null;
  approval_status?: string;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_PREFIX = process.env.UPBO_TABLE_PREFIX || "";

function tableName(name: string): string {
  return `${TABLE_PREFIX}${name}`;
}

function assertSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
}

// 검증 대시보드가 "환경 설정 필요" 상태를 구분하기 위한 읽기 전용 헬퍼.
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

type ApplyPersistenceSummary = {
  totalResults?: number;
  recordCount?: number;
  effectiveRecordCount?: number;
  ignoreCount?: number;
  duplicateCount?: number;
  needsReviewCount?: number;
  modifierCount?: number;
  multiplierAppliedCount?: number;
};

function positiveCount(value: unknown): boolean {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0;
}

// "공식 반영 이력"으로 남길 필요가 있는 apply인지 판단한다.
// 전부 duplicate/ignore인 재스캔은 upbo_entries에는 변화가 없고, raw_imports/import_batches만
// 불필요하게 커지므로 no-op으로 처리한다. 단 needs_review / modifier / multiplier는
// 운영 검증 또는 미래 상태에 의미가 있으므로 반드시 보존한다.
export function shouldPersistApplyResult(summary: ApplyPersistenceSummary): boolean {
  return (
    positiveCount(summary.recordCount) ||
    positiveCount(summary.needsReviewCount) ||
    positiveCount(summary.modifierCount) ||
    positiveCount(summary.multiplierAppliedCount)
  );
}

function normalizeModifierStateForCompare(state: ModifierState) {
  const pendingEntries = Object.entries(state.pendingByViewer || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [
      key,
      {
        multiplier: Number(value?.multiplier || 1),
        sourceKeys: Array.isArray(value?.sourceKeys) ? value.sourceKeys : [],
      },
    ]);
  return {
    pendingByViewer: pendingEntries,
    processedSourceKeys: Array.isArray(state.processedSourceKeys) ? state.processedSourceKeys : [],
  };
}

function modifierStateChanged(before: ModifierState, after: ModifierState): boolean {
  return JSON.stringify(normalizeModifierStateForCompare(before)) !== JSON.stringify(normalizeModifierStateForCompare(after));
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value).replace(/%2C/g, ",");
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertSupabaseEnv();
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY!);
  headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text || res.statusText}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

// 행 개수만 필요할 때(HEAD + count=exact, 본문 전송 없음). 데이터 리셋 미리보기용.
async function supabaseCount(path: string): Promise<number> {
  assertSupabaseEnv();
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${res.statusText}`);
  }
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeExtensionToken(): string {
  return `upbo_ext_${crypto.randomBytes(24).toString("base64url")}`;
}

export function assertAdminToken(authHeader: string | null) {
  const expected = process.env.UPBO_ADMIN_TOKEN;
  if (!expected) return;
  const actual = bearerToken(authHeader);
  if (actual !== expected) {
    const error = new Error("invalid admin token");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
}

export function bearerToken(authHeader: string | null): string {
  const match = String(authHeader || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function toSlug(value: string): string {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(slug)) {
    throw new Error("slug must be 2-63 chars: lowercase letters, numbers, underscore or hyphen");
  }
  return slug;
}

function mapStreamer(row: StreamerRow) {
  return {
    slug: row.slug,
    displayName: row.display_name,
    settings: {
      thresholdPercent: Number(row.threshold_percent ?? 2),
      siteTitle: row.site_title ?? undefined,
      sheetName: row.sheet_name ?? undefined,
      posterImageUrl: row.poster_image_url ?? undefined,
      accentColor: row.accent_color ?? undefined,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCatalog(row: CatalogRow) {
  return {
    version: row.version,
    displayName: row.display_name ?? undefined,
    amountSetLabel: row.amount_set_label ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    groupCount: row.group_count ?? undefined,
    itemCount: row.item_count ?? undefined,
    probabilitySums: row.probability_sums ?? [],
    warnings: row.warnings ?? [],
    groups: row.groups ?? [],
    items: row.items ?? [],
  };
}

function mapBatch(row: BatchRow) {
  return {
    id: row.id,
    catalogVersion: row.catalog_version,
    thresholdPercent: Number(row.threshold_percent),
    sourceUrl: row.source_url ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    appliedAt: row.applied_at,
    summary: row.summary,
    entryCount: row.entry_count,
  };
}

function mapEntry(row: UpboEntryRow, streamerSlug: string) {
  let metadata: { multiplier?: number; effectiveCount?: number; modifierSourceKeys?: string[] } = {};
  try {
    metadata = row.admin_note ? JSON.parse(row.admin_note) : {};
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    streamerSlug,
    sourceKey: row.source_key,
    batchId: row.batch_id ?? "",
    catalogVersion: row.catalog_version ?? undefined,
    status: row.status,
    fanNickname: row.fan_nickname ?? "",
    // 2026-06-28 초기 수집분의 "(id)" 형태를 겉 괄호 제거로 통일(원본 row는 불변).
    fanId: normalizeAccountId(row.fan_id),
    itemName: row.item_name,
    probability: Number(row.probability ?? 0),
    donateTimeText: row.donate_time_text ?? "",
    donationType: row.donation_type ?? "",
    donationAmount: row.donation_amount ?? undefined,
    donationAmountText: row.donation_amount_text ?? "",
    catalogGroupIndex: row.catalog_group_index ?? undefined,
    amountRangeLabel: row.amount_range_label ?? "",
    rouletteIndex: Number(row.roulette_index ?? 0),
    rouletteTotal: Number(row.roulette_total ?? 0),
    rawText: row.raw_text ?? "",
    multiplier: Number(metadata.multiplier ?? 1),
    effectiveCount: Number(metadata.effectiveCount ?? 1),
    modifierSourceKeys: Array.isArray(metadata.modifierSourceKeys) ? metadata.modifierSourceKeys : [],
    publicNote: row.public_note ?? "",
    adminNote: row.admin_note ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentOwnerName: row.current_owner_name ?? null,
    currentOwnerId: row.current_owner_id ?? null,
    currentItemName: row.current_item_name ?? null,
    quantityOriginal: row.quantity_original ?? null,
    quantityCurrent: row.quantity_current ?? null,
  };
}

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("PGRST205") ||
    message.includes("42P01") ||
    message.includes("Could not find the table") ||
    message.includes("schema cache")
  );
}

// upbo_item_events row → lib/api.ts 의 ItemEvent 형태로 매핑.
// beforeJson/afterJson 은 객체일 때만 통과시키고 그 외엔 null 로 정규화한다.
function jsonObjectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapItemEvent(row: ItemEventRow) {
  return {
    id: row.id ?? "",
    upboEntryId: row.upbo_entry_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id ?? null,
    beforeJson: jsonObjectOrNull(row.before_json),
    afterJson: jsonObjectOrNull(row.after_json),
    quantityDelta: row.quantity_delta ?? null,
    reason: row.reason ?? null,
    memo: row.memo ?? null,
    approvalStatus: row.approval_status ?? "not_required",
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    createdAt: row.created_at,
  };
}

function mapViewerNote(row: ViewerNoteRow) {
  return {
    fanId: normalizeAccountId(row.fan_id),
    fanNickname: row.fan_nickname_snapshot ?? "",
    noteText: row.note_text ?? "",
    updatedAt: row.updated_at,
  };
}

function mapDeliveryProgress(row: DeliveryProgressRow) {
  return {
    fanId: normalizeAccountId(row.fan_id),
    fanNickname: row.fan_nickname_snapshot ?? "",
    itemKey: row.item_key,
    itemName: row.item_name,
    probability: row.probability === null || row.probability === undefined ? undefined : Number(row.probability),
    amountRangeLabel: row.amount_range_label ?? "",
    processedCount: Number(row.processed_count ?? 0),
    updatedAt: row.updated_at,
  };
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isNewer(candidate?: string, current?: string): boolean {
  if (!current) return true;
  if (!candidate) return false;
  return Date.parse(candidate) >= Date.parse(current);
}

function mergeViewerNotes(
  base: ReturnType<typeof mapViewerNote>[],
  extra: ReturnType<typeof mapViewerNote>[],
) {
  const merged = new Map<string, ReturnType<typeof mapViewerNote>>();
  for (const note of [...base, ...extra]) {
    const current = merged.get(note.fanId);
    if (!current || isNewer(note.updatedAt, current.updatedAt)) merged.set(note.fanId, note);
  }
  return Array.from(merged.values());
}

function mergeDeliveryProgress(
  base: ReturnType<typeof mapDeliveryProgress>[],
  extra: ReturnType<typeof mapDeliveryProgress>[],
) {
  const merged = new Map<string, ReturnType<typeof mapDeliveryProgress>>();
  for (const item of [...base, ...extra]) {
    const key = `${item.fanId}@@${item.itemKey}`;
    const current = merged.get(key);
    if (!current || isNewer(item.updatedAt, current.updatedAt)) merged.set(key, item);
  }
  return Array.from(merged.values()).filter((item) => item.processedCount > 0);
}

async function getStreamerRow(slug: string): Promise<StreamerRow | null> {
  const safeSlug = toSlug(slug);
  const rows = await supabaseFetch<StreamerRow[]>(
    `/${tableName("streamers")}?slug=eq.${encodeQuery(safeSlug)}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

async function requireStreamer(slug: string): Promise<StreamerRow> {
  const row = await getStreamerRow(slug);
  if (!row) {
    const error = new Error("streamer not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
  return row;
}

export async function upsertStreamer(input: {
  slug: string;
  displayName?: string;
  thresholdPercent?: number;
}) {
  const slug = toSlug(input.slug);
  const threshold = input.thresholdPercent === undefined ? 2 : Number(input.thresholdPercent);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("thresholdPercent must be a number between 0 and 100");
  }
  const rows = await supabaseFetch<StreamerRow[]>(`/${tableName("streamers")}?on_conflict=slug`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      slug,
      display_name: input.displayName || slug,
      threshold_percent: threshold,
      updated_at: new Date().toISOString(),
    }),
  });
  return mapStreamer(rows[0]);
}

// 스트리머 완전 삭제(온보딩 콘솔 전용, 되돌릴 수 없음). streamers row 하나를 지우면
// FK on delete cascade 로 tokens/catalogs/import_batches/upbo_entries/raw_imports/audit_logs/
// viewer_notes/delivery_progress/item_events 가 전부 함께 삭제된다(2026-06-28/29 마이그레이션 기준).
// Storage 의 쇼케이스 이미지 파일은 남는다(참조만 끊김, 무해).
export async function deleteStreamer(slug: string): Promise<void> {
  const streamer = await requireStreamer(slug);
  await supabaseFetch(`/${tableName("streamers")}?id=eq.${streamer.id}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
}

// ── 스트리머 데이터 리셋(범위 선택, 온보딩 콘솔 전용) ──────────────────────
// deleteStreamer(계정 통삭제)와 달리 계정·테마(streamers.accent_color)·확장 토큰은
// 남기고 데이터만 비운다. 2026-07-17 리루리 수동 리셋(런북)을 기능화한 것.
// ★audit_logs 는 감사 이력이 아니라 설정 저장소를 겸하므로(비번 2종·위플랩 링크·화면 설정)
//   streamer_id 통삭제 금지 — "남길 action 화이트리스트" 방식으로만 지운다.
// ★REST 순차 호출이라 트랜잭션이 아님: 중간 실패 시 일부만 지워질 수 있다.
//   모든 삭제가 멱등이라 같은 범위로 재실행하면 나머지가 마저 지워진다.
export type ResetScope = {
  roulette: boolean; // 룰렛결과: item_events+entries+raw_imports(results)+batches+배수 대기
  donations: boolean; // 후원집계: donation_events
  catalogs: boolean; // 확률표: catalogs+raw_imports(catalog)+사용 설정
  coupons: boolean; // 쿠폰 장부: balances+events (쿠폰 "종류" 정의는 화면 설정·상태 쪽)
  screenState: boolean; // 화면 설정·상태: audit_logs 에서 화이트리스트 밖 전부
  pins: boolean; // 비밀번호 2종+위플랩 링크까지(지우면 마스터/전역 기본값으로 폴백)
};

export type ResetCount = { key: string; label: string; count: number };

// 리셋 후에도 남아야 하는 "열쇠·연결선"과 리셋 이력 자체.
const RESET_KEEP_ACTIONS = [
  "sheet_admin_pin_updated",
  "donation_admin_pin_updated",
  "weflab_link_updated",
  "data_reset",
];
const RESET_PIN_ACTIONS = ["sheet_admin_pin_updated", "donation_admin_pin_updated", "weflab_link_updated"];

export function hasResetScope(scope: ResetScope): boolean {
  return (
    scope.roulette || scope.donations || scope.catalogs || scope.coupons || scope.screenState || scope.pins
  );
}

type ResetTarget = { key: string; label: string; query: (streamerId: string) => string };

// 삭제 순서 고정: upbo_entries 가 raw_imports(raw_import_id)를 참조하므로
// item_events → entries → raw_imports → batches 순이어야 FK 오류가 없다.
function resetTargets(scope: ResetScope): ResetTarget[] {
  const targets: ResetTarget[] = [];
  if (scope.roulette) {
    targets.push(
      {
        key: "item_events",
        label: "운영 이벤트(양도·교환 등)",
        query: (sid) => `/${tableName("upbo_item_events")}?streamer_id=eq.${sid}`,
      },
      {
        key: "entries",
        label: "룰렛결과(업보 기록)",
        query: (sid) => `/${tableName("upbo_entries")}?streamer_id=eq.${sid}`,
      },
    );
  }
  // 원본 백업은 룰렛(results)/확률표(catalog) 타입이 섞여 있어 범위에 맞춰 나눠 지운다.
  const rawFilter =
    scope.roulette && scope.catalogs ? "" : scope.roulette ? "&type=eq.results" : scope.catalogs ? "&type=eq.catalog" : null;
  if (rawFilter !== null) {
    targets.push({
      key: "raw_imports",
      label: "원본 백업",
      query: (sid) => `/${tableName("raw_imports")}?streamer_id=eq.${sid}${rawFilter}`,
    });
  }
  if (scope.roulette) {
    targets.push({
      key: "batches",
      label: "반영 이력",
      query: (sid) => `/${tableName("import_batches")}?streamer_id=eq.${sid}`,
    });
  }
  if (scope.catalogs) {
    targets.push({
      key: "catalogs",
      label: "확률표",
      query: (sid) => `/${tableName("catalogs")}?streamer_id=eq.${sid}`,
    });
  }
  if (scope.donations) {
    targets.push({
      key: "donations",
      label: "후원집계",
      query: (sid) => `/${tableName("donation_events")}?streamer_id=eq.${sid}`,
    });
  }
  if (scope.coupons) {
    targets.push(
      {
        key: "coupon_events",
        label: "쿠폰 이력",
        query: (sid) => `/${tableName("coupon_events")}?streamer_id=eq.${sid}`,
      },
      {
        key: "coupon_balances",
        label: "쿠폰 잔액",
        query: (sid) => `/${tableName("coupon_balances")}?streamer_id=eq.${sid}`,
      },
    );
  }
  if (scope.screenState) {
    targets.push({
      key: "screen_state",
      label: "화면 설정·상태(배너·레이아웃·특수룰 등)",
      query: (sid) =>
        `/${tableName("audit_logs")}?streamer_id=eq.${sid}&action=not.in.(${RESET_KEEP_ACTIONS.join(",")})`,
    });
  } else {
    // 화면 설정은 남기더라도, 지운 데이터에서 파생된 상태는 같이 비워야 화면이 안 꼬인다.
    const laneActions = [
      ...(scope.roulette ? ["modifier_state"] : []),
      ...(scope.catalogs ? ["catalog_usage_updated"] : []),
    ];
    if (laneActions.length) {
      targets.push({
        key: "lane_state",
        label: "관련 파생 상태(배수 대기 등)",
        query: (sid) => `/${tableName("audit_logs")}?streamer_id=eq.${sid}&action=in.(${laneActions.join(",")})`,
      });
    }
  }
  if (scope.pins) {
    targets.push({
      key: "pins",
      label: "비밀번호·위플랩 링크",
      query: (sid) => `/${tableName("audit_logs")}?streamer_id=eq.${sid}&action=in.(${RESET_PIN_ACTIONS.join(",")})`,
    });
  }
  return targets;
}

// 삭제될 건수만 조회(아무것도 지우지 않음). 실행 전 확인 단계용.
export async function previewStreamerReset(
  slug: string,
  scope: ResetScope,
): Promise<{ slug: string; items: ResetCount[]; total: number }> {
  const streamer = await requireStreamer(slug);
  const items: ResetCount[] = [];
  for (const target of resetTargets(scope)) {
    const count = await supabaseCount(`${target.query(streamer.id)}&select=id`);
    items.push({ key: target.key, label: target.label, count });
  }
  return { slug: streamer.slug, items, total: items.reduce((sum, item) => sum + item.count, 0) };
}

export async function executeStreamerReset(
  slug: string,
  scope: ResetScope,
): Promise<{ slug: string; items: ResetCount[]; total: number }> {
  const streamer = await requireStreamer(slug);
  const items: ResetCount[] = [];
  for (const target of resetTargets(scope)) {
    const count = await supabaseCount(`${target.query(streamer.id)}&select=id`);
    await supabaseFetch(target.query(streamer.id), {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
    items.push({ key: target.key, label: target.label, count });
  }
  const total = items.reduce((sum, item) => sum + item.count, 0);
  // 리셋 이력은 화이트리스트에 포함돼 있어 다음 리셋에도 남는다(무엇을 언제 지웠는지 추적).
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "data_reset",
      actor: "admin_console",
      payload: { scope, items, total },
    }),
  });
  return { slug: streamer.slug, items, total };
}

export async function createExtensionToken(slug: string, label = "") {
  const streamer = await requireStreamer(slug);
  const value = makeExtensionToken();
  const rows = await supabaseFetch<Array<{ id: string; role: string; label?: string; created_at: string }>>(
    `/${tableName("streamer_tokens")}`,
    {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        streamer_id: streamer.id,
        token_hash: tokenHash(value),
        role: "extension_write",
        label,
      }),
    },
  );
  const token = rows[0];
  return {
    streamerSlug: streamer.slug,
    token: {
      id: token.id,
      role: token.role,
      label: token.label,
      createdAt: token.created_at,
      value,
    },
  };
}

export async function resolveExtensionToken(rawToken: string): Promise<StreamerRow> {
  if (!rawToken) {
    const error = new Error("extension token required");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const rows = await supabaseFetch<Array<{ streamer_id: string }>>(
    `/${tableName("streamer_tokens")}?token_hash=eq.${tokenHash(rawToken)}&role=eq.extension_write&revoked_at=is.null&select=streamer_id&limit=1`,
  );
  const token = rows[0];
  if (!token) {
    const error = new Error("invalid extension token");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const streamers = await supabaseFetch<StreamerRow[]>(`/${tableName("streamers")}?id=eq.${token.streamer_id}&select=*&limit=1`);
  if (!streamers[0]) throw new Error("token streamer not found");
  return streamers[0];
}

// 스트리머 전체 운영 이벤트(양도/교환/취소/완료 등) 읽기. 보유 현황 계산용.
// item_events 테이블이 아직 없으면 빈 배열로 안전하게 폴백한다.
async function getAllItemEvents(streamerId: string): Promise<ReturnType<typeof mapItemEvent>[]> {
  try {
    const rows = await supabaseFetch<ItemEventRow[]>(
      `/${tableName("upbo_item_events")}?streamer_id=eq.${streamerId}&select=*&order=created_at.asc&limit=20000`,
    );
    return rows.map(mapItemEvent);
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

// getStreamerState 팬 설정 오버레이 병합용 프리페치 형태. 각 설정 헬퍼는 이 배열을 받으면
// 개별 audit_logs 왕복을 건너뛰고 rows[0].payload 를 기존과 동일하게 파싱한다.
type OverlayPrefetch = Array<{ payload: Record<string, unknown> | null; created_at?: string }>;

// 개별 "action별 최신 1건"(select=payload&order=created_at.desc&limit=1) 조회를 한 번의
// audit_logs 쿼리로 병합할 대상 action 목록. 전부 스트리머가 수동 편집하는 저빈도 설정이라
// 히스토리가 얕고, in.(...)&order=created_at.desc(무제한)로 받아 action별 첫 행(=최신)을 뽑아도
// 개별 limit=1 조회와 동일한 행을 준다. modifier_state 는 apply 마다 append 되는 고빈도라 제외.
const OVERLAY_LATEST_ACTIONS = [
  "signature_counts_updated",
  "roulette_config_updated",
  "fan_display_updated",
  "product_colors_updated",
  "fan_reveal_updated",
  "fan_layout_updated",
  "admin_ui_prefs_updated",
  "fan_tab_labels_updated",
  "weflab_link_updated",
] as const;

type OverlayLatestRow = { action: string; payload: Record<string, unknown> | null; created_at: string };

export async function getStreamerState(slug: string) {
  const streamer = await requireStreamer(slug);
  // 싱가포르 Supabase ↔ 미국 Vercel 왕복 지연이 크므로 streamer.id 만 있으면 되는 쿼리는
  // 전부 한 번에 병렬로 묶는다. specialRuleOverrides/modifierState 는 catalog 가 필요 없어
  // 앞 병렬 묶음에 합쳐 순차 왕복을 줄인다(buildSpecialItemRuleCandidates 는 동기 계산).
  // 팬 설정 오버레이(OVERLAY_LATEST_ACTIONS)는 개별 limit=1 조회 9회를 한 번의 in.(...) 쿼리로
  // 합쳐 받아, 아래에서 action별 최신 1건으로 갈라 각 헬퍼에 주입한다(파싱은 기존과 동일).
  const [catalogs, batches, entries, itemEvents, ruleOverrides, modifierState, usageByVersion, fixedPriceNotes, archivedFanAt, deliveryProgress, overlayRows] = await Promise.all([
    supabaseFetch<CatalogRow[]>(
      `/${tableName("catalogs")}?streamer_id=eq.${streamer.id}&select=*&order=version.asc`,
    ),
    supabaseFetch<BatchRow[]>(
      `/${tableName("import_batches")}?streamer_id=eq.${streamer.id}&select=*&order=applied_at.asc`,
    ),
    supabaseFetch<UpboEntryRow[]>(
      `/${tableName("upbo_entries")}?streamer_id=eq.${streamer.id}&select=*&order=created_at.desc&limit=5000`,
    ),
    getAllItemEvents(streamer.id),
    specialRuleOverrides(streamer.id),
    latestModifierState(streamer.id),
    catalogUsageByVersion(streamer.id),
    fixedPriceNotesForStreamer(streamer.id),
    archivedFanAtForStreamer(streamer.id),
    getDeliveryProgress(streamer.id),
    supabaseFetch<OverlayLatestRow[]>(
      `/${tableName("audit_logs")}?streamer_id=eq.${streamer.id}&action=in.(${OVERLAY_LATEST_ACTIONS.join(",")})&select=action,payload,created_at&order=created_at.desc`,
    ),
  ]);
  // desc 정렬이므로 action별 처음 만난 행 = 최신 1건. 개별 limit=1 조회와 동일.
  const overlayLatest = new Map<string, OverlayLatestRow>();
  for (const row of overlayRows) {
    if (!overlayLatest.has(row.action)) overlayLatest.set(row.action, row);
  }
  const overlayPick = (action: string): OverlayPrefetch => {
    const r = overlayLatest.get(action);
    return r ? [{ payload: r.payload, created_at: r.created_at }] : [];
  };
  const [signatureCounts, rouletteConfig, fanDeliveryReflect, productColors, fanRevealEnabled, fanLayout, adminUiPrefs, fanTabLabels, weflabLink] = await Promise.all([
    latestSignatureCounts(streamer.id, overlayPick("signature_counts_updated")),
    rouletteConfigForStreamer(streamer.id, overlayPick("roulette_config_updated")),
    fanDeliveryReflectForStreamer(streamer.id, overlayPick("fan_display_updated")),
    productColorsForStreamer(streamer.id, overlayPick("product_colors_updated")),
    fanRevealEnabledForStreamer(streamer.id, overlayPick("fan_reveal_updated")),
    fanLayoutForStreamer(streamer.id, overlayPick("fan_layout_updated")),
    adminUiPrefsForStreamer(streamer.id, overlayPick("admin_ui_prefs_updated")),
    fanTabLabelsForStreamer(streamer.id, overlayPick("fan_tab_labels_updated")),
    weflabLinkForStreamer(streamer.id, overlayPick("weflab_link_updated")),
  ]);
  const currentCatalogVersion = catalogs.reduce((max, row) => Math.max(max, row.version), 0) || null;
  const currentCatalog = catalogs.find((row) => row.version === currentCatalogVersion) ?? catalogs.at(-1);
  // 현재 버전의 유효 사용설정을 "직전 버전 → 내용 기준 승계"까지 반영해 덮어쓴다.
  // 화면 표시·교환후보 계산이 판정과 같은 값을 쓰도록 단일 소스로 맞춘다.
  if (currentCatalogVersion != null) {
    const groupsByVersion: Record<number, CatalogGroup[]> = {};
    for (const c of catalogs) groupsByVersion[c.version] = (c.groups as CatalogGroup[]) ?? [];
    usageByVersion[currentCatalogVersion] = computeEffectiveOverrides(
      currentCatalogVersion,
      groupsByVersion[currentCatalogVersion] ?? [],
      usageByVersion,
      groupsByVersion,
    );
  }
  const specialItemRules = currentCatalog
    ? buildSpecialItemRuleCandidates((currentCatalog.items as NormalizedCatalogItem[]) || [], ruleOverrides)
    : [];
  return {
    ...mapStreamer(streamer),
    catalogs: catalogs.map(mapCatalog),
    currentCatalogVersion,
    specialItemRules,
    modifierState,
    importBatches: batches.map(mapBatch),
    upboEntries: entries.map((entry) => mapEntry(entry, streamer.slug)),
    itemEvents,
    catalogUsageByVersion: usageByVersion,
    signatureCounts,
    fixedPriceNotes,
    archivedFanIds: Object.keys(archivedFanAt),
    archivedFanAt,
    rouletteConfig,
    deliveryProgress,
    fanDeliveryReflect,
    productColors,
    fanRevealEnabled,
    fanLayout,
    adminUiPrefs,
    fanTabLabels,
    weflabLink,
  };
}

export type AdminDashboardRawResult = {
  batchId: string | null;
  capturedAt?: string | null;
  savedAt?: string | null;
  raw: Json;
};

// 검증 대시보드 전용 읽기 소스. SELECT만 수행한다(쓰기/재판정 없음).
// raw_imports(results) 원본을 batch_id와 함께 돌려준다 — catalog_version은 batch에서 매칭해야 한다.
export async function getAdminDashboardSource(slug: string) {
  const streamer = await requireStreamer(slug);
  const [catalogs, batches, entries, rawResultRows] = await Promise.all([
    supabaseFetch<CatalogRow[]>(
      `/${tableName("catalogs")}?streamer_id=eq.${streamer.id}&select=*&order=version.asc`,
    ),
    supabaseFetch<BatchRow[]>(
      `/${tableName("import_batches")}?streamer_id=eq.${streamer.id}&select=*&order=applied_at.asc`,
    ),
    supabaseFetch<UpboEntryRow[]>(
      `/${tableName("upbo_entries")}?streamer_id=eq.${streamer.id}&select=*&order=created_at.desc&limit=5000`,
    ),
    supabaseFetch<RawImportRow[]>(
      `/${tableName("raw_imports")}?streamer_id=eq.${streamer.id}&type=eq.results&select=batch_id,captured_at,saved_at,raw&order=saved_at.asc&limit=2000`,
    ),
  ]);
  const currentCatalogVersion = catalogs.reduce((max, row) => Math.max(max, row.version), 0) || null;
  const currentCatalog = catalogs.find((row) => row.version === currentCatalogVersion) ?? catalogs.at(-1);
  const specialItemRules = currentCatalog
    ? await specialRulesForCatalog(streamer.id, (currentCatalog.items as NormalizedCatalogItem[]) || [])
    : [];
  return {
    streamer: mapStreamer(streamer),
    currentCatalogVersion,
    catalogs: catalogs.map(mapCatalog),
    batches: batches.map(mapBatch),
    entries: entries.map((entry) => mapEntry(entry, streamer.slug)),
    specialItemRules,
    rawResults: rawResultRows.map((row): AdminDashboardRawResult => ({
      batchId: row.batch_id ?? null,
      capturedAt: row.captured_at,
      savedAt: row.saved_at,
      raw: row.raw ?? {},
    })),
  };
}

export type AdminStreamerIndexRow = {
  slug: string;
  displayName: string;
  thresholdPercent: number;
  updatedAt?: string;
  batchCount: number;
  lastAppliedAt?: string;
  recordSum: number;
  needsReviewSum: number;
};

// 운영자 목록 화면용 읽기 전용 집계. streamers 1쿼리 + import_batches 1쿼리를 JS에서 합친다.
export async function getAdminStreamerIndex(): Promise<AdminStreamerIndexRow[]> {
  const [streamers, batches] = await Promise.all([
    supabaseFetch<StreamerRow[]>(
      `/${tableName("streamers")}?select=id,slug,display_name,threshold_percent,updated_at&order=updated_at.desc&limit=1000`,
    ),
    supabaseFetch<Array<{ streamer_id: string; applied_at?: string; summary: Json }>>(
      `/${tableName("import_batches")}?select=streamer_id,applied_at,summary&order=applied_at.asc&limit=10000`,
    ),
  ]);
  const agg = new Map<string, { batchCount: number; lastAppliedAt?: string; recordSum: number; needsReviewSum: number }>();
  for (const b of batches) {
    const cur = agg.get(b.streamer_id) ?? { batchCount: 0, lastAppliedAt: undefined, recordSum: 0, needsReviewSum: 0 };
    cur.batchCount += 1;
    if (b.applied_at && (!cur.lastAppliedAt || b.applied_at > cur.lastAppliedAt)) cur.lastAppliedAt = b.applied_at;
    const s = (b.summary ?? {}) as Record<string, unknown>;
    cur.recordSum += Number(s.recordCount ?? 0) || 0;
    cur.needsReviewSum += Number(s.needsReviewCount ?? 0) || 0;
    agg.set(b.streamer_id, cur);
  }
  return streamers.map((r) => {
    const a = agg.get(r.id);
    return {
      slug: r.slug,
      displayName: r.display_name,
      thresholdPercent: Number(r.threshold_percent ?? 2),
      updatedAt: r.updated_at,
      batchCount: a?.batchCount ?? 0,
      lastAppliedAt: a?.lastAppliedAt,
      recordSum: a?.recordSum ?? 0,
      needsReviewSum: a?.needsReviewSum ?? 0,
    };
  });
}

export async function setStreamerSettings(slug: string, settings: { thresholdPercent?: number }) {
  const streamer = await requireStreamer(slug);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (settings.thresholdPercent !== undefined) {
    const threshold = Number(settings.thresholdPercent);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      throw new Error("thresholdPercent must be a number between 0 and 100");
    }
    patch.threshold_percent = threshold;
  }
  const rows = await supabaseFetch<StreamerRow[]>(`/${tableName("streamers")}?id=eq.${streamer.id}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return mapStreamer(rows[0]).settings;
}

// 스트리머 테마 프리셋 저장. 기존 extension 토큰으로 인증된 streamer 에 한해 호출된다.
// accent_color 칸을 프리셋 id 저장용으로 재사용한다(스키마 변경 없음).
export async function setStreamerTheme(streamer: StreamerRow, theme: string) {
  const value = String(theme || "").trim();
  if (value && !isThemeId(value)) {
    throw new Error("unknown theme preset");
  }
  const rows = await supabaseFetch<StreamerRow[]>(`/${tableName("streamers")}?id=eq.${streamer.id}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ accent_color: value || null, updated_at: new Date().toISOString() }),
  });
  return mapStreamer(rows[0]).settings;
}

// 팬 업보시트 "쇼케이스(홍보)" 상태. 배너/포스터 2장/공지문구를 audit_logs 에 스냅샷으로 저장한다.
// DB 스키마를 새로 만들지 않고 modifier_state 와 같은 "최신 1건 조회" 패턴을 재사용한다.
export type ShowcaseState = {
  bannerUrl: string | null;
  posterUrls: [string | null, string | null, string | null];
  // 배너/포스터 클릭 시 이동할 링크(http/https 만). 없으면 null(클릭 안 됨).
  bannerLink: string | null;
  posterLinks: [string | null, string | null, string | null];
  noticeText: string;
  // 공지 전용 폰트 키(빈값=기본). noticeFonts 화이트리스트로만 정규화됨.
  noticeFont: string;
  updatedAt?: string;
};

// 링크 정규화: 빈값은 null. http/https 붙어 있으면 그대로, 스킴 없으면 https:// 자동으로 붙인다.
// (팬 화면에서 새 탭으로 열리므로 http/https 로만 강제)
export function cleanShowcaseLink(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  return s.slice(0, 500);
}

// slug 로 스트리머를 찾은 뒤 audit_logs 에서 showcase_updated 최신 1건을 읽어 반환한다.
// 저장된 적이 없으면 null.
export async function getShowcaseBySlug(slug: string): Promise<ShowcaseState | null> {
  const streamer = await getStreamerRow(slug);
  if (!streamer) return null;
  const rows = await supabaseFetch<Array<{ payload: { showcase?: ShowcaseState } | null; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamer.id}&action=eq.showcase_updated&select=payload,created_at&order=created_at.desc&limit=1`,
  );
  const showcase = rows[0]?.payload?.showcase;
  if (!showcase) return null;
  return {
    bannerUrl: showcase.bannerUrl ?? null,
    // 과거(포스터 2칸 시절) 저장분도 안전하게 읽히도록 세 번째 칸은 null 로 채운다.
    posterUrls: [
      showcase.posterUrls?.[0] ?? null,
      showcase.posterUrls?.[1] ?? null,
      showcase.posterUrls?.[2] ?? null,
    ],
    bannerLink: cleanShowcaseLink(showcase.bannerLink),
    posterLinks: [
      cleanShowcaseLink(showcase.posterLinks?.[0]),
      cleanShowcaseLink(showcase.posterLinks?.[1]),
      cleanShowcaseLink(showcase.posterLinks?.[2]),
    ],
    noticeText: showcase.noticeText ?? "",
    noticeFont: normalizeNoticeFont(showcase.noticeFont),
    updatedAt: rows[0]?.created_at,
  };
}

// 쇼케이스 상태를 audit_logs 에 새 스냅샷으로 남긴다(append-only, 최신 1건이 현재 상태).
export async function setShowcase(streamer: StreamerRow, state: ShowcaseState): Promise<ShowcaseState> {
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "showcase_updated",
      actor: "extension",
      payload: { showcase: state },
    }),
  });
  return state;
}

let showcaseBucketEnsured = false;

// storage REST API 는 /rest/v1 이 아니라 /storage/v1 을 쓰므로 supabaseFetch 를 재사용하지 않고
// 별도 fetch 헬퍼로 작성한다(같은 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 사용).
async function storageFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertSupabaseEnv();
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_SERVICE_ROLE_KEY!);
  headers.set("authorization", `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`);
  return fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

function showcaseBucketName(): string {
  return process.env.UPBO_ASSET_BUCKET || "upbo-alpha-assets";
}

// 쇼케이스 이미지용 스토리지 버킷이 없으면 만든다. 요청당 1회만 시도하고,
// 이미 존재하는 경우(409 또는 "already exists"/"Duplicate" 응답)는 성공으로 간주한다.
async function ensureShowcaseBucket(): Promise<void> {
  if (showcaseBucketEnsured) return;
  showcaseBucketEnsured = true;
  const bucket = showcaseBucketName();
  const res = await storageFetch("/bucket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });
  if (res.ok || res.status === 409) return;
  const text = await res.text();
  if (text.includes("already exists") || text.includes("Duplicate")) return;
  throw new Error(`Supabase storage bucket ${res.status}: ${text || res.statusText}`);
}

const SHOWCASE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 쇼케이스 이미지(배너/포스터 2장)를 Supabase Storage 에 업로드하고 공개 URL을 반환한다.
export async function uploadShowcaseImage(
  slug: string,
  slot: "banner" | "poster0" | "poster1" | "poster2",
  file: { bytes: ArrayBuffer; contentType: string },
): Promise<string> {
  const ext = SHOWCASE_IMAGE_EXTENSIONS[file.contentType];
  if (!ext) {
    throw new Error("unsupported image content type");
  }
  await ensureShowcaseBucket();
  const bucket = showcaseBucketName();
  const path = `showcase/${slug}/${slot}-${Date.now()}.${ext}`;
  const res = await storageFetch(`/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      "content-type": file.contentType,
      "x-upsert": "true",
    },
    body: file.bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase storage upload ${res.status}: ${text || res.statusText}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 메모(시청자/정가) 첨부 이미지 업로드. 쇼케이스와 같은 공개 버킷을 재사용한다(관리자 전용 경로).
export async function uploadMemoImage(
  slug: string,
  file: { bytes: ArrayBuffer; contentType: string },
): Promise<string> {
  const ext = SHOWCASE_IMAGE_EXTENSIONS[file.contentType];
  if (!ext) {
    throw new Error("unsupported image content type");
  }
  await ensureShowcaseBucket();
  const bucket = showcaseBucketName();
  const path = `memo/${slug}/${crypto.randomBytes(8).toString("hex")}-${Date.now()}.${ext}`;
  const res = await storageFetch(`/object/${bucket}/${path}`, {
    method: "POST",
    headers: { "content-type": file.contentType, "x-upsert": "true" },
    body: file.bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase storage upload ${res.status}: ${text || res.statusText}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// ── 옷장(의상) 탭 ──────────────────────────────────────────────────────────────
// 판만 제공, 업로드·운영은 스트리머 몫(sy 확정 2026-08-04). 상태는 쇼케이스와 동일하게
// audit_logs 이벤트(action=wardrobe_updated, 최신 1건=현재 상태)로 저장 — 새 테이블 없음.
// 이미지는 쇼케이스 공개 버킷의 wardrobe/{slug}/ 경로를 쓴다.
// 타입·상수는 클라이언트도 쓰므로 lib/wardrobeShared.ts 에 분리(couponAggregate 선례) —
// 기존 import 호환을 위해 여기서 재수출한다(타입 import 는 파일 상단).

export { WARDROBE_MAX_ITEMS } from "./wardrobeShared";
export type { WardrobeItem, WardrobePart, WardrobeState, WardrobeTheme } from "./wardrobeShared";

function normalizeWardrobeItem(raw: Partial<WardrobeItem> | undefined): WardrobeItem | null {
  if (!raw?.id || !raw.url) return null;
  return {
    id: String(raw.id),
    url: String(raw.url),
    name: typeof raw.name === "string" ? raw.name : "",
    themeId: typeof raw.themeId === "string" ? raw.themeId : "",
    part: raw.part === "hair" ? "hair" : "outfit",
    month: typeof raw.month === "string" ? raw.month : "",
    memo: typeof raw.memo === "string" ? raw.memo : "",
    hidden: raw.hidden === true,
    publishedAt: typeof raw.publishedAt === "string" ? raw.publishedAt : null,
    order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
  };
}

// slug 로 스트리머를 찾은 뒤 audit_logs 에서 wardrobe_updated 최신 1건을 읽어 반환한다.
// 저장된 적이 없으면 null. 과거 저장분 필드 누락은 기본값으로 안전하게 채운다.
export async function getWardrobeBySlug(slug: string): Promise<WardrobeState | null> {
  const streamer = await getStreamerRow(slug);
  if (!streamer) return null;
  const rows = await supabaseFetch<Array<{ payload: { wardrobe?: WardrobeState } | null; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamer.id}&action=eq.wardrobe_updated&select=payload,created_at&order=created_at.desc&limit=1`,
  );
  const wardrobe = rows[0]?.payload?.wardrobe;
  if (!wardrobe) return null;
  const themes = (wardrobe.themes ?? [])
    .filter((t): t is WardrobeTheme => Boolean(t?.id && typeof t.name === "string"))
    .map((t) => ({ id: String(t.id), name: String(t.name) }));
  const items = (wardrobe.items ?? [])
    .map(normalizeWardrobeItem)
    .filter((i): i is WardrobeItem => i !== null);
  return { themes, items };
}

// 옷장 상태를 audit_logs 에 새 스냅샷으로 남긴다(append-only, 최신 1건이 현재 상태).
export async function setWardrobe(streamer: StreamerRow, state: WardrobeState): Promise<WardrobeState> {
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "wardrobe_updated",
      actor: "extension",
      payload: { wardrobe: state },
    }),
  });
  return state;
}

// 옷장 이미지 업로드. 쇼케이스와 같은 공개 버킷의 wardrobe/ 경로를 쓴다(관리자 전용 경로).
export async function uploadWardrobeImage(
  slug: string,
  file: { bytes: ArrayBuffer; contentType: string },
): Promise<string> {
  const ext = SHOWCASE_IMAGE_EXTENSIONS[file.contentType];
  if (!ext) {
    throw new Error("unsupported image content type");
  }
  await ensureShowcaseBucket();
  const bucket = showcaseBucketName();
  const path = `wardrobe/${slug}/${crypto.randomBytes(8).toString("hex")}-${Date.now()}.${ext}`;
  const res = await storageFetch(`/object/${bucket}/${path}`, {
    method: "POST",
    headers: { "content-type": file.contentType, "x-upsert": "true" },
    body: file.bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase storage upload ${res.status}: ${text || res.statusText}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 옷장 항목 삭제 시 스토리지 파일도 함께 정리(모범 노력 — 실패해도 항목 삭제는 진행).
// 우리 버킷의 wardrobe/ 공개 URL만 지운다(다른 경로/외부 URL 은 건드리지 않음).
export async function deleteWardrobeImages(urls: string[]): Promise<number> {
  const bucket = showcaseBucketName();
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/`;
  let deleted = 0;
  for (const url of urls) {
    if (!url.startsWith(prefix)) continue;
    const path = url.slice(prefix.length);
    if (!path.startsWith("wardrobe/")) continue;
    try {
      const res = await storageFetch(`/object/${bucket}/${path}`, { method: "DELETE" });
      if (res.ok) deleted += 1;
    } catch {
      // 파일 정리는 부가 작업 — 상태 저장을 막지 않는다.
    }
  }
  return deleted;
}

async function viewerNotesFromAuditLogs(streamerId: string) {
  const rows = await supabaseFetch<Array<{ payload: unknown; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.viewer_note_updated&select=payload,created_at&order=created_at.asc&limit=5000`,
  );
  const latest = new Map<string, ReturnType<typeof mapViewerNote>>();
  for (const row of rows) {
    const payload = payloadObject(row.payload);
    const fanId = payloadString(payload, "fanId");
    if (!fanId) continue;
    latest.set(fanId, {
      fanId,
      fanNickname: payloadString(payload, "fanNickname"),
      noteText: payloadString(payload, "noteText"),
      updatedAt: row.created_at,
    });
  }
  return Array.from(latest.values());
}

async function deliveryProgressFromAuditLogs(streamerId: string) {
  const rows = await supabaseFetch<Array<{ payload: unknown; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.delivery_progress_updated&select=payload,created_at&order=created_at.asc&limit=5000`,
  );
  const latest = new Map<string, ReturnType<typeof mapDeliveryProgress>>();
  for (const row of rows) {
    const payload = payloadObject(row.payload);
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    for (const rawItem of rawItems) {
      const item = payloadObject(rawItem);
      const fanId = normalizeAccountId(payloadString(item, "fanId"));
      const itemKey = payloadString(item, "itemKey");
      if (!fanId || !itemKey) continue;
      latest.set(`${fanId}@@${itemKey}`, {
        fanId,
        fanNickname: payloadString(item, "fanNickname"),
        itemKey,
        itemName: payloadString(item, "itemName"),
        probability: payloadNumber(item, "probability"),
        amountRangeLabel: payloadString(item, "amountRangeLabel"),
        processedCount: Math.max(0, Math.floor(payloadNumber(item, "processedCount"))),
        updatedAt: row.created_at,
      });
    }
  }
  return Array.from(latest.values()).filter((item) => item.processedCount > 0);
}

export async function getOperatorState(slug: string) {
  const streamer = await requireStreamer(slug);
  const [viewerNotes, deliveryProgress] = await Promise.all([
    getViewerNotes(streamer.id),
    getDeliveryProgress(streamer.id),
  ]);
  return { viewerNotes, deliveryProgress };
}

// 시청자 메모 첨부 이미지(fanId별 최신 1건). 텍스트 메모(viewer_notes 테이블)와는 별도 오버레이.
async function viewerNoteImagesForStreamer(streamerId: string): Promise<Map<string, string[]>> {
  const rows = await supabaseFetch<Array<{ payload: { fanId?: unknown; images?: unknown } | null; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.viewer_note_images_updated&select=payload,created_at&order=created_at.desc&limit=5000`,
  );
  const latest = new Map<string, string[]>();
  for (const row of rows) {
    const fanId = normalizeAccountId(typeof row.payload?.fanId === "string" ? row.payload.fanId : "");
    if (!fanId || latest.has(fanId)) continue; // desc → 처음 만난 것이 최신
    latest.set(fanId, cleanMemoImages(row.payload?.images));
  }
  return latest;
}

export async function setViewerNoteImages(
  streamer: StreamerRow,
  fanId: string,
  images: string[],
): Promise<string[]> {
  const clean = cleanMemoImages(images);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "viewer_note_images_updated",
      actor: "operator",
      payload: { fanId: normalizeAccountId(fanId), images: clean },
    }),
  });
  return clean;
}

async function getViewerNotes(streamerId: string) {
  const imagesByFan = await viewerNoteImagesForStreamer(streamerId).catch(() => new Map<string, string[]>());
  let notes: ReturnType<typeof mapViewerNote>[];
  try {
    const rows = await supabaseFetch<ViewerNoteRow[]>(
      `/${tableName("viewer_notes")}?streamer_id=eq.${streamerId}&select=*&order=updated_at.desc&limit=5000`,
    );
    notes = mergeViewerNotes(rows.map(mapViewerNote), await viewerNotesFromAuditLogs(streamerId));
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    notes = await viewerNotesFromAuditLogs(streamerId);
  }
  // 텍스트 메모에 이미지 배열을 붙이고, 이미지만 있는 시청자도 항목으로 추가한다.
  const byFan = new Map<string, ReturnType<typeof mapViewerNote> & { noteImages: string[] }>();
  for (const n of notes) byFan.set(n.fanId, { ...n, noteImages: imagesByFan.get(n.fanId) ?? [] });
  for (const [fanId, images] of imagesByFan) {
    if (images.length && !byFan.has(fanId)) {
      byFan.set(fanId, { fanId, fanNickname: "", noteText: "", updatedAt: undefined, noteImages: images });
    }
  }
  return [...byFan.values()];
}

async function getDeliveryProgress(streamerId: string) {
  try {
    const rows = await supabaseFetch<DeliveryProgressRow[]>(
      `/${tableName("delivery_progress")}?streamer_id=eq.${streamerId}&select=*&order=updated_at.desc&limit=5000`,
    );
    return mergeDeliveryProgress(rows.map(mapDeliveryProgress), await deliveryProgressFromAuditLogs(streamerId));
  } catch (error) {
    if (isMissingTableError(error)) return deliveryProgressFromAuditLogs(streamerId);
    throw error;
  }
}

export async function saveViewerNote(
  slug: string,
  input: { fanId: string; fanNickname?: string; noteText?: string },
) {
  const streamer = await requireStreamer(slug);
  const fanId = String(input.fanId || "").trim();
  if (!fanId) throw new Error("fanId is required");
  const now = new Date().toISOString();
  const row: ViewerNoteRow = {
    streamer_id: streamer.id,
    fan_id: fanId,
    fan_nickname_snapshot: String(input.fanNickname || ""),
    note_text: String(input.noteText || ""),
    updated_at: now,
  };
  try {
    const rows = await supabaseFetch<ViewerNoteRow[]>(`/${tableName("viewer_notes")}?on_conflict=streamer_id,fan_id`, {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    return mapViewerNote(rows[0]);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    await supabaseFetch(`/${tableName("audit_logs")}`, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        streamer_id: streamer.id,
        action: "viewer_note_updated",
        actor: "operator",
        payload: {
          fanId,
          fanNickname: row.fan_nickname_snapshot,
          noteText: row.note_text,
        },
      }),
    });
    return {
      fanId,
      fanNickname: row.fan_nickname_snapshot ?? "",
      noteText: row.note_text,
      updatedAt: now,
    };
  }
}

export async function saveDeliveryProgress(
  slug: string,
  input: {
    items: Array<{
      fanId: string;
      fanNickname?: string;
      itemKey: string;
      itemName: string;
      probability?: number;
      amountRangeLabel?: string;
      processedCount: number;
    }>;
  },
) {
  const streamer = await requireStreamer(slug);
  const now = new Date().toISOString();
  const rows: DeliveryProgressRow[] = (input.items || [])
    .map((item) => ({
      streamer_id: streamer.id,
      fan_id: String(item.fanId || "").trim(),
      fan_nickname_snapshot: String(item.fanNickname || ""),
      item_key: String(item.itemKey || ""),
      item_name: String(item.itemName || ""),
      probability: item.probability === undefined ? null : Number(item.probability),
      amount_range_label: String(item.amountRangeLabel || ""),
      processed_count: Math.max(0, Math.floor(Number(item.processedCount || 0))),
      updated_at: now,
    }))
    .filter((item) => item.fan_id && item.item_key && item.item_name);

  if (rows.length === 0) return { saved: 0 };

  try {
    await supabaseFetch(`/${tableName("delivery_progress")}?on_conflict=streamer_id,fan_id,item_key`, {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    await supabaseFetch(`/${tableName("audit_logs")}`, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        streamer_id: streamer.id,
        action: "delivery_progress_updated",
        actor: "operator",
        payload: {
          items: rows.map((row) => ({
            fanId: row.fan_id,
            fanNickname: row.fan_nickname_snapshot ?? "",
            itemKey: row.item_key,
            itemName: row.item_name,
            probability: row.probability,
            amountRangeLabel: row.amount_range_label ?? "",
            processedCount: row.processed_count,
          })),
        },
      }),
    });
  }
  return { saved: rows.length };
}

async function latestCatalog(streamerId: string): Promise<CatalogRow> {
  const row = await latestCatalogOrNull(streamerId);
  if (!row) throw new Error("catalog is required before importing results");
  return row;
}

// 링크로 처음 등록하는 스트리머는 기존 캡처가 아직 없을 수 있다(정상) — 그 경우 null.
export async function latestCatalogOrNull(streamerId: string): Promise<CatalogRow | null> {
  const rows = await supabaseFetch<CatalogRow[]>(
    `/${tableName("catalogs")}?streamer_id=eq.${streamerId}&select=*&order=version.desc&limit=1`,
  );
  return rows[0] ?? null;
}

// 룰렛표 "내용 지문" — 금액대 + 상품명 + 확률만 본다. 위플랩 on/off 상태는 제외한다
// (우리 오버레이가 on/off를 소유하므로 위플랩에서 껐다 켰다 해도 같은 표로 취급).
// 그룹·상품 순서에 무관하도록 정렬해서 합친다.
export function catalogContentFingerprint(
  groups:
    | ReadonlyArray<{
        amountRangeLabel?: string | null;
        items?: ReadonlyArray<{ itemName?: string; probability?: number | string | null }>;
      }>
    | undefined,
): string {
  return (groups ?? [])
    .map((g) => {
      const items = (g.items ?? [])
        .map((it) => `${String(it.itemName ?? "")}::${String(it.probability ?? "")}`)
        .sort();
      return `${String(g.amountRangeLabel ?? "")}||${items.join("|")}`;
    })
    .sort()
    .join("##");
}

export async function saveCatalogForStreamer(streamer: StreamerRow, capture: CatalogCapture) {
  const catalog = normalizeCatalogCapture(capture);
  // 직전(최신) 버전과 내용 지문이 같으면 새 버전을 만들지 않고 재사용한다(중복 캡처 차단).
  // 내용이 실제로 바뀐 경우에만 새 버전이 생기고, on/off 설정은 내용 기준으로 자동 승계된다(Phase 1).
  const latestRows = await supabaseFetch<CatalogRow[]>(
    `/${tableName("catalogs")}?streamer_id=eq.${streamer.id}&select=*&order=version.desc&limit=1`,
  );
  const latest = latestRows[0] ?? null;
  const reuse =
    latest != null &&
    catalogContentFingerprint((latest.groups as CatalogGroup[]) ?? []) ===
      catalogContentFingerprint(catalog.groups);
  const version = reuse ? latest!.version : (latest?.version ?? 0) + 1;

  let saved: CatalogRow;
  if (reuse) {
    saved = latest!;
  } else {
    const rows = await supabaseFetch<CatalogRow[]>(`/${tableName("catalogs")}`, {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        streamer_id: streamer.id,
        version,
        source_url: catalog.sourceUrl,
        captured_at: catalog.capturedAt,
        group_count: catalog.groupCount,
        item_count: catalog.itemCount,
        probability_sums: catalog.probabilitySums,
        warnings: catalog.warnings,
        groups: catalog.groups,
        items: catalog.items,
        raw: catalog.raw,
      }),
    });
    saved = rows[0];
  }

  // 원본 증거(raw_imports)는 재사용이든 새 버전이든 항상 남긴다 — 수집 이력은 증거로 보존.
  await supabaseFetch(`/${tableName("raw_imports")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      type: "catalog",
      catalog_version: version,
      captured_at: catalog.capturedAt,
      raw: capture,
    }),
  });
  return mapCatalog(saved);
}

async function existingSourceKeys(streamerId: string): Promise<Set<string>> {
  const rows = await supabaseFetch<Array<{ source_key: string }>>(
    `/${tableName("upbo_entries")}?streamer_id=eq.${streamerId}&select=source_key&limit=10000`,
  );
  return new Set(rows.map((row) => row.source_key));
}

async function specialRuleOverrides(streamerId: string): Promise<SpecialItemRule[]> {
  const rows = await supabaseFetch<Array<{ payload: { rule?: SpecialItemRule } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.special_item_rule&select=payload,created_at&order=created_at.asc&limit=1000`,
  );
  const latest = new Map<string, SpecialItemRule>();
  for (const row of rows) {
    const rule = row.payload?.rule;
    if (rule?.ruleKey) latest.set(rule.ruleKey, rule);
  }
  return [...latest.values()];
}

async function specialRulesForCatalog(streamerId: string, catalogItems: NormalizedCatalogItem[]): Promise<SpecialItemRule[]> {
  return buildSpecialItemRuleCandidates(catalogItems, await specialRuleOverrides(streamerId));
}

async function latestModifierState(streamerId: string): Promise<ModifierState> {
  const rows = await supabaseFetch<Array<{ payload: { modifierState?: ModifierState } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.modifier_state&select=payload,created_at&order=created_at.desc&limit=1`,
  );
  return rows[0]?.payload?.modifierState || { pendingByViewer: {}, processedSourceKeys: [] };
}

async function saveModifierState(streamerId: string, modifierState: ModifierState) {
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action: "modifier_state",
      actor: "system",
      payload: { modifierState },
    }),
  });
}

export async function setSpecialItemRule(
  slug: string,
  input: { ruleKey: string; status: "confirmed" | "rejected" | "candidate"; multiplier?: number },
) {
  const streamer = await requireStreamer(slug);
  const catalog = await latestCatalog(streamer.id);
  const items = ((catalog.items as NormalizedCatalogItem[]) || []);
  const existingRules = await specialRulesForCatalog(streamer.id, items);
  const current = existingRules.find((rule) => rule.ruleKey === input.ruleKey);
  if (!current) throw new Error("special rule candidate not found in current catalog");
  const rule: SpecialItemRule = {
    ...current,
    status: input.status,
    multiplier: Math.max(2, Number(input.multiplier || current.multiplier || 2)),
  };
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "special_item_rule",
      actor: "admin",
      payload: { rule },
    }),
  });
  return rule;
}

// ---------- 룰렛확률표 사용여부(on/off) 오버레이 ----------
// 캡처(원본)는 불변으로 두고 "우리 사이트가 이 룰렛/상품을 쓸지"만 audit_logs 에 얹는다.
// 키: "g{groupIndex}" = 룰렛(그룹) 단위, "g{groupIndex}-i{sortOrder}" = 상품 단위.
// 설정은 특정 catalogVersion 에 고정된다(내용이 다르면 별개 룰렛 — 2026-07-02 설계 결정,
// docs/roulette-usage-overlay-design.md). 자동 승계 없음, 가져오기는 관리 화면의 명시적 버튼.

export type CatalogUsageOverrides = Record<string, boolean>;

const CATALOG_USAGE_KEY_RE = /^g\d+(-i\d+)?$/;

export function isValidCatalogUsageKey(key: string): boolean {
  return CATALOG_USAGE_KEY_RE.test(key);
}

function cleanCatalogUsageOverrides(raw: unknown): CatalogUsageOverrides {
  const cleaned: CatalogUsageOverrides = {};
  if (!raw || typeof raw !== "object") return cleaned;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidCatalogUsageKey(key) && typeof value === "boolean") cleaned[key] = value;
  }
  return cleaned;
}

// 특정 카탈로그 버전의 최신 사용여부 오버라이드. 없으면 빈 객체(=전부 위플랩 캡처 값 따름).
export async function latestCatalogUsage(streamerId: string, catalogVersion: number): Promise<CatalogUsageOverrides> {
  const rows = await supabaseFetch<Array<{ payload: { overrides?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.catalog_usage_updated&payload->>catalogVersion=eq.${catalogVersion}&select=payload&order=created_at.desc&limit=1`,
  );
  return cleanCatalogUsageOverrides(rows[0]?.payload?.overrides);
}

// 버전별 최신 오버라이드 묶음(관리 화면용 — 현재 표 표시 + "이전 표에서 가져오기" 매칭).
export async function catalogUsageByVersion(streamerId: string): Promise<Record<number, CatalogUsageOverrides>> {
  const rows = await supabaseFetch<
    Array<{ payload: { catalogVersion?: unknown; overrides?: unknown } | null; created_at: string }>
  >(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.catalog_usage_updated&select=payload,created_at&order=created_at.desc&limit=200`,
  );
  const byVersion: Record<number, CatalogUsageOverrides> = {};
  for (const row of rows) {
    const version = Number(row.payload?.catalogVersion);
    if (!Number.isFinite(version) || byVersion[version] !== undefined) continue; // 버전당 최신 1건
    byVersion[version] = cleanCatalogUsageOverrides(row.payload?.overrides);
  }
  return byVersion;
}

// 사용여부 오버라이드 저장(append-only 새 스냅샷, 전체 교체 방식).
export async function setCatalogUsage(
  streamer: StreamerRow,
  catalogVersion: number,
  overrides: CatalogUsageOverrides,
): Promise<{ catalogVersion: number; overrides: CatalogUsageOverrides }> {
  const cleaned = cleanCatalogUsageOverrides(overrides);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "catalog_usage_updated",
      actor: "extension",
      payload: { catalogVersion, overrides: cleaned },
    }),
  });
  return { catalogVersion, overrides: cleaned };
}

// 오버라이드를 캡처 상품 목록에 적용해 "효과적 enabled"를 계산한다.
// 우선순위: 상품 키 > 그룹 키 > 위플랩 캡처 값. 오버라이드가 없으면 원본 배열을 그대로
// 반환한다(=기존 판정과 100% 동일 보장, 회귀 기준). reconcileResults 자체는 수정하지 않는다.
export function applyCatalogUsage(
  items: NormalizedCatalogItem[],
  overrides: CatalogUsageOverrides,
): NormalizedCatalogItem[] {
  if (Object.keys(overrides).length === 0) return items;
  return items.map((item) => {
    const itemValue = overrides[`g${item.groupIndex}-i${item.sortOrder}`];
    const groupValue = overrides[`g${item.groupIndex}`];
    const effective = itemValue ?? groupValue ?? item.enabled;
    return effective === item.enabled ? item : { ...item, enabled: effective };
  });
}

// ---------- 사용여부 오버라이드: 버전 → "룰렛 내용" 승계 ----------
// 위플랩표가 새 버전으로 들어와도 sy가 정한 on/off가 "같은 룰렛"이면 자동으로 따라오게 한다.
// 저장 키는 그대로(g{groupIndex} / g{groupIndex}-i{sortOrder})지만, 버전이 갈릴 때 직전 버전의
// 설정을 상품 지문(내용) 기준으로 현재 버전 키로 번역해 이어붙인다. 판정 엔진·스키마·수집 경로는
// 건드리지 않는다(오버레이 층만). 승계할 이전 설정이 없으면 빈 객체라 기존 판정과 100% 동일.

function cuGroupItemNames(g: CatalogGroup): string[] {
  return [...new Set((g.items ?? []).map((it) => it.itemName).filter(Boolean))];
}
function cuGroupLabel(g: CatalogGroup): string {
  if (g.amountRangeLabel) return g.amountRangeLabel;
  return g.amountMin === g.amountMax ? `${g.amountMin}` : `${g.amountMin}~${g.amountMax}`;
}

// source 버전의 인덱스 키 오버라이드를 target 버전의 인덱스 키로 "내용 기준" 번역한다.
// 규칙은 앱의 기존 매칭과 동일: 그룹=상품 지문 자카드 ≥ 0.5, 상품=(금액대라벨::상품명) 정확 일치.
export function carryOverridesByContent(
  sourceGroups: CatalogGroup[],
  sourceOverrides: CatalogUsageOverrides,
  targetGroups: CatalogGroup[],
): CatalogUsageOverrides {
  const out: CatalogUsageOverrides = {};
  const srcByIndex = new Map<number, CatalogGroup>();
  sourceGroups.forEach((g) => srcByIndex.set(g.groupIndex, g));
  const targetItemKey = new Map<string, string>();
  targetGroups.forEach((g) => {
    (g.items ?? []).forEach((it, idx) => {
      targetItemKey.set(`${cuGroupLabel(g)}::${it.itemName}`, `g${g.groupIndex}-i${it.sortOrder ?? idx}`);
    });
  });
  for (const [key, value] of Object.entries(sourceOverrides)) {
    const m = key.match(/^g(\d+)(?:-i(\d+))?$/);
    if (!m) continue;
    const srcGroup = srcByIndex.get(Number(m[1]));
    if (!srcGroup) continue;
    if (m[2] === undefined) {
      // 그룹(룰렛) 단위: 상품 지문 유사매칭(같은 금액대가 여러 개여도 지문으로 구분).
      const srcNames = cuGroupItemNames(srcGroup);
      let best = -1;
      let bestScore = 0.5;
      targetGroups.forEach((tg) => {
        const s = jaccardStrings(srcNames, cuGroupItemNames(tg));
        if (s >= bestScore) {
          bestScore = s;
          best = tg.groupIndex;
        }
      });
      if (best >= 0) out[`g${best}`] = value;
      continue;
    }
    // 상품 단위: sortOrder(없으면 인덱스)로 source 상품을 찾고 (라벨::이름)으로 target 키를 찾는다.
    const iOrder = Number(m[2]);
    const items = srcGroup.items ?? [];
    const found = items.map((it, idx) => ({ it, idx })).find(({ it, idx }) => (it.sortOrder ?? idx) === iOrder);
    if (!found) continue;
    const tk = targetItemKey.get(`${cuGroupLabel(srcGroup)}::${found.it.itemName}`);
    if (tk) out[tk] = value;
  }
  return out;
}

// target 버전의 유효 오버라이드 = (직전 최신 버전에서 내용 기준 승계) 위에 (그 버전 직접 저장분) 덮어쓰기.
// 승계 대상이 없거나 설정 자체가 없으면 빈 객체 → 기존 판정과 동일(회귀 없음).
export function computeEffectiveOverrides(
  targetVersion: number,
  targetGroups: CatalogGroup[],
  usageByVersion: Record<number, CatalogUsageOverrides>,
  groupsByVersion: Record<number, CatalogGroup[]>,
): CatalogUsageOverrides {
  const own = usageByVersion[targetVersion] ?? {};
  const priorVersions = Object.keys(usageByVersion)
    .map(Number)
    .filter((v) => Number.isFinite(v) && v < targetVersion && Object.keys(usageByVersion[v] ?? {}).length > 0)
    .sort((a, b) => b - a);
  let inherited: CatalogUsageOverrides = {};
  for (const pv of priorVersions) {
    const sourceGroups = groupsByVersion[pv];
    if (!sourceGroups) continue;
    inherited = carryOverridesByContent(sourceGroups, usageByVersion[pv], targetGroups);
    break; // 가장 최신 직전 버전 1개에서만 승계.
  }
  return { ...inherited, ...own };
}

// 판정용: 특정 카탈로그의 유효 오버라이드를 DB에서 조합한다(내용 기준 승계 포함).
async function resolveCatalogUsageForCatalog(
  streamerId: string,
  targetCatalog: CatalogRow,
): Promise<CatalogUsageOverrides> {
  const usageByVersion = await catalogUsageByVersion(streamerId);
  // 승계 대상(현재보다 낮은, 설정 있는 버전)이 없으면 기존 경로와 동일 — 이전 카탈로그 로드 생략.
  const hasPrior = Object.keys(usageByVersion)
    .map(Number)
    .some((v) => Number.isFinite(v) && v < targetCatalog.version && Object.keys(usageByVersion[v] ?? {}).length > 0);
  if (!hasPrior) return usageByVersion[targetCatalog.version] ?? {};
  const rows = await supabaseFetch<Array<{ version: number; groups: Json }>>(
    `/${tableName("catalogs")}?streamer_id=eq.${streamerId}&select=version,groups&order=version.asc`,
  );
  const groupsByVersion: Record<number, CatalogGroup[]> = {};
  for (const r of rows) groupsByVersion[r.version] = (r.groups as CatalogGroup[]) ?? [];
  return computeEffectiveOverrides(
    targetCatalog.version,
    (targetCatalog.groups as CatalogGroup[]) ?? [],
    usageByVersion,
    groupsByVersion,
  );
}

// ---------- 시트 관리자 비밀번호(스트리머별) ----------
// 전역 env PIN(UPBO_SHEET_ADMIN_PIN) 대신 스트리머별 비밀번호를 쓴다. 스키마 변경 없이
// audit_logs 오버레이(action=sheet_admin_pin_updated)에 "비밀번호 해시"만 최신 1건으로 저장한다.
// 원문 비밀번호는 어디에도 저장하지 않는다. (해시 계산/검증은 lib/sheetAdminAuth.ts 담당)

// 이 스트리머에 저장된 관리자 비밀번호 해시. 없으면 null(=아직 개별 비번 미설정).
export async function getSheetAdminPinHash(slug: string): Promise<string | null> {
  const streamer = await getStreamerRow(slug);
  if (!streamer) return null;
  const rows = await supabaseFetch<Array<{ payload: { pinHash?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamer.id}&action=eq.sheet_admin_pin_updated&select=payload&order=created_at.desc&limit=1`,
  );
  const hash = rows[0]?.payload?.pinHash;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

// 스트리머별 관리자 비밀번호 해시 저장(append-only 새 스냅샷, 최신 1건이 현재 값).
export async function setSheetAdminPinHash(slug: string, pinHash: string): Promise<void> {
  const streamer = await requireStreamer(slug);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "sheet_admin_pin_updated",
      actor: "operator",
      payload: { pinHash },
    }),
  });
}

// 세션 인증(requireSheetAdmin) 통과 후 대상 스트리머 row 를 얻는 용도. 없으면 404.
export async function getStreamerRowBySlug(slug: string): Promise<StreamerRow> {
  return requireStreamer(slug);
}

// ---------- 확프 페어링(비밀번호 교환) 시도 기록 ----------
// 스키마 변경 없이 audit_logs 를 재사용한다(sheet_admin_pin_updated 등과 동일 패턴).
// 성공/실패 "여부"만 남기고 비밀번호 원문·해시는 payload 에 절대 넣지 않는다.
// 시도제한(무차별 대입 방어)은 인메모리 카운터가 불가능한 서버리스 환경이라
// 이 append-only 기록을 슬러그별로 세어 판정한다(정책/상수는 lib/extensionPairing.ts).

// 페어링 시도 1건 기록. outcome 만 action 으로 구분하고 payload 는 {slug, at} 뿐이다.
export async function recordExtensionPairAttempt(
  streamerId: string,
  outcome: "ok" | "failed",
  slug: string,
): Promise<void> {
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action: outcome === "ok" ? "extension_pair_ok" : "extension_pair_failed",
      actor: "extension",
      payload: { slug, at: new Date().toISOString() },
    }),
  });
}

// 시도제한 판정용 조회. sinceIso 이후의 성공/실패 audit 를 시간순(asc)으로 반환한다.
// (판정 로직은 lib/extensionPairing.ts 가 담당 — 여기선 순수 읽기만.)
export async function getRecentExtensionPairAudits(
  streamerId: string,
  sinceIso: string,
): Promise<Array<{ action: string; created_at: string }>> {
  return supabaseFetch<Array<{ action: string; created_at: string }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=in.(extension_pair_failed,extension_pair_ok)&created_at=gte.${encodeQuery(sinceIso)}&select=action,created_at&order=created_at.asc&limit=200`,
  );
}

// ---------- 수동기록(manual entry) ----------
// 위플랩 자동수집과 무관하게, 스트리머가 룰렛확률표+시청자계정으로 직접 넣는 업보 기록.
// 정가기록과 동일하게 upbo_entries 에 직접 insert 하되 source_key 를 "manual:..."로 둔다.
// - 고유 source_key라 확장 재수집(upsert)에도 안 지워진다.
// - 팬 화면/배송/양도·교환은 전부 이 entry를 자동수집분과 "동등하게" 다룬다.
// - 진짜 삭제(행 제거)는 source_key가 manual:* 인 것만 허용(원본/raw 기록 보호).
export type ManualEntryInput = {
  fanId: string;
  fanNickname: string;
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  catalogGroupIndex?: number | null;
  catalogVersion?: number | null;
  count: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function clampCount(n: unknown): number {
  return Math.max(1, Math.min(9999, Math.floor(Number(n) || 1)));
}

export async function createManualEntry(streamer: StreamerRow, input: ManualEntryInput): Promise<void> {
  const now = new Date().toISOString();
  const count = clampCount(input.count);
  await supabaseFetch(`/${tableName("upbo_entries")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      streamer_id: streamer.id,
      source_key: `manual:${crypto.randomUUID()}`,
      batch_id: null,
      catalog_version: input.catalogVersion ?? null,
      status: "pending",
      fan_nickname: input.fanNickname ?? "",
      fan_id: normalizeAccountId(input.fanId),
      item_name: input.itemName,
      probability: Number(input.probability) || 0,
      donate_time_text: "",
      donation_type: "manual",
      catalog_group_index: input.catalogGroupIndex ?? null,
      amount_range_label: input.amountRangeLabel ?? "",
      roulette_index: 0,
      roulette_total: 0,
      raw_text: "",
      public_note: "",
      // effectiveCount 는 admin_note JSON 에서 읽는다(mapEntry 규칙과 동일).
      admin_note: JSON.stringify({ effectiveCount: count }),
      raw_import_id: null,
      created_at: now,
      updated_at: now,
    }),
  });
}

// 수동기록 개수 수정. source_key manual:* 만 대상(자동/원본 기록은 절대 안 건드림).
export async function updateManualEntryCount(streamer: StreamerRow, entryId: string, count: number): Promise<void> {
  if (!UUID_RE.test(entryId)) throw new Error("invalid entry id");
  await supabaseFetch(
    `/${tableName("upbo_entries")}?id=eq.${entryId}&streamer_id=eq.${streamer.id}&source_key=like.manual:*`,
    {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        admin_note: JSON.stringify({ effectiveCount: clampCount(count) }),
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

// 수동기록 삭제(행 제거). source_key manual:* 만 대상 — 자동수집/원본은 물리삭제 금지.
export async function deleteManualEntry(streamer: StreamerRow, entryId: string): Promise<void> {
  if (!UUID_RE.test(entryId)) throw new Error("invalid entry id");
  await supabaseFetch(
    `/${tableName("upbo_entries")}?id=eq.${entryId}&streamer_id=eq.${streamer.id}&source_key=like.manual:*`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
  );
}

// ---------- N:M 번들 교환 ----------
// "움짤프사 2 + 프릴로미 1 → 방셀 2 + 움짤수제 1"처럼 주는 묶음과 받는 묶음의
// 상품 종류·수량을 자유롭게 지정하는 교환(스트리머별 활용 방식이 달라 비율을 못 박지 않음).
// - 주는 쪽: 기존 exchange 이벤트를 재사용하되 after_json 에 exchangeOut 표시(스키마 무변경).
//   보유 계산(computeHoldings)은 이 표시가 있으면 "변신" 대신 "나감"으로 접는다(레거시 교환은 기존 동작).
// - 받는 쪽: 수동기록 선례대로 upbo_entries 신규 행(source_key "exchange:<groupId>:<n>") —
//   팬 화면/배송/재교환에 자동수집분과 동등 참여. 원본 당첨 기록은 불변.
// - 이벤트마다 gave/received 요약을 중복 저장해 이력에서 그룹ID로 묶어 한 건으로 보여준다.

export type ExchangeBundleInput = {
  viewer: { fanId: string; fanNickname: string };
  gives: Array<{ entryId: string; quantity: number; itemName: string }>;
  receives: Array<{
    itemName: string;
    probability?: number;
    amountRangeLabel?: string;
    catalogGroupIndex?: number | null;
    quantity: number;
  }>;
  catalogVersion?: number | null;
  reason?: string;
};

// 교환 저장/되돌리기 응답에 실어 보내는 쿠폰 자동 처리 결과.
// null = 매핑 미설정 등으로 패스 자체를 건너뜀. error = 교환은 성공했지만 쿠폰 처리만 실패.
export type ExchangeCouponResult =
  | { accrued: number; totalDelta: number }
  | { revoked: number; totalDelta: number }
  | { error: string }
  | null;

export async function recordExchangeBundle(
  slug: string,
  input: ExchangeBundleInput,
): Promise<{ exchangeGroupId: string; coupon: ExchangeCouponResult }> {
  const streamer = await requireStreamer(slug);
  const bad = (message: string) => {
    const error = new Error(message);
    (error as Error & { status?: number }).status = 400;
    return error;
  };
  if (!Array.isArray(input.gives) || input.gives.length === 0 || input.gives.length > 100) {
    throw bad("주는 상품이 비어 있거나 너무 많아요(최대 100건).");
  }
  if (!Array.isArray(input.receives) || input.receives.length === 0 || input.receives.length > 50) {
    throw bad("받을 상품을 1개 이상 골라 주세요(최대 50종).");
  }
  for (const g of input.gives) {
    if (!UUID_RE.test(String(g.entryId))) throw bad("주는 기록 id가 올바르지 않아요.");
    const n = Number(g.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw bad("주는 수량이 올바르지 않아요.");
  }
  for (const r of input.receives) {
    if (!String(r.itemName ?? "").trim()) throw bad("받을 상품 이름이 비어 있어요.");
    const n = Number(r.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw bad("받을 수량이 올바르지 않아요.");
  }

  // 주는 기록이 전부 이 스트리머 것인지 한 번에 확인(남의 시트 기록 조작 방지).
  const giveIds = [...new Set(input.gives.map((g) => g.entryId))];
  const owned = await supabaseFetch<Array<{ id: string }>>(
    `/${tableName("upbo_entries")}?streamer_id=eq.${streamer.id}&id=in.(${giveIds.join(",")})&select=id`,
  );
  if (owned.length !== giveIds.length) throw bad("주는 기록을 찾지 못했어요. 화면을 새로고침해 주세요.");

  const exchangeGroupId = crypto.randomUUID();
  const now = new Date().toISOString();
  const reason = String(input.reason ?? "").trim() || null;

  // 이력 표기용 요약(상품명 기준 합산).
  const gaveSummary = (() => {
    const m = new Map<string, number>();
    for (const g of input.gives) {
      const name = String(g.itemName ?? "").trim() || "(상품)";
      m.set(name, (m.get(name) ?? 0) + Number(g.quantity));
    }
    return [...m.entries()].map(([itemName, quantity]) => ({ itemName, quantity }));
  })();
  const receivedSummary = input.receives.map((r) => ({
    itemName: String(r.itemName).trim(),
    quantity: Number(r.quantity),
  }));

  // 1) 주는 쪽: exchange 이벤트 배치 insert (조각이 장부에서 나감).
  await supabaseFetch(`/${tableName("upbo_item_events")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(
      input.gives.map((g) => ({
        upbo_entry_id: g.entryId,
        streamer_id: streamer.id,
        event_type: "exchange",
        actor_type: "operator",
        before_json: { currentItemName: String(g.itemName ?? "").trim() || null },
        after_json: {
          exchangeOut: true,
          exchangeGroupId,
          gave: gaveSummary,
          received: receivedSummary,
          // 이력 표시용: 교환 당사자(현재 보유자). 원본 당첨자와 다를 수 있다(양도받은 조각).
          viewerId: normalizeAccountId(input.viewer.fanId),
          viewerName: String(input.viewer.fanNickname ?? "").trim(),
        },
        quantity_delta: Number(g.quantity),
        reason,
        approval_status: "not_required",
        created_at: now,
      })),
    ),
  });

  // 2) 받는 쪽: 신규 entries 배치 insert (수동기록과 같은 형태, source_key만 exchange:).
  await supabaseFetch(`/${tableName("upbo_entries")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(
      input.receives.map((r, i) => ({
        id: crypto.randomUUID(),
        streamer_id: streamer.id,
        source_key: `exchange:${exchangeGroupId}:${i}`,
        batch_id: null,
        catalog_version: input.catalogVersion ?? null,
        status: "pending",
        fan_nickname: String(input.viewer.fanNickname ?? "").trim(),
        fan_id: normalizeAccountId(input.viewer.fanId),
        item_name: String(r.itemName).trim(),
        probability: Number(r.probability) || 0,
        donate_time_text: "",
        donation_type: "exchange",
        catalog_group_index: typeof r.catalogGroupIndex === "number" ? r.catalogGroupIndex : null,
        amount_range_label: r.amountRangeLabel ?? "",
        roulette_index: 0,
        roulette_total: 0,
        raw_text: "",
        public_note: "",
        // effectiveCount 는 admin_note JSON 에서 읽는다(mapEntry 규칙과 동일).
        admin_note: JSON.stringify({ effectiveCount: clampCount(r.quantity), exchangeGroupId }),
        raw_import_id: null,
        created_at: now,
        updated_at: now,
      })),
    ),
  });

  // 쿠폰 자동 적립(교환 유입분) — 룰렛 수집 반영(applyResults)의 조각 2와 같은 격리 패스.
  // 받은 상품이 쿠폰 연결 상품이면 당첨과 동일하게 적립한다(created_by="auto",
  // note 참조키 = 받은 entry 의 source_key). ★안전: 여기서 무슨 일이 나도 위의 교환 저장은
  // 영향받지 않는다 — 실패는 coupon:{ error } 로 표기만 하고 절대 throw 하지 않는다.
  // sourceKey 가 방금 만든 UUID 기반이라 과거 적립과 겹칠 수 없어 2차 방어(autoAccruedSourceKeys)는 생략.
  let coupon: ExchangeCouponResult = null;
  try {
    const sourceMap = await couponSourceMapForStreamer(streamer.id);
    if (sourceMap.length > 0) {
      const couponItems = await couponItemsForStreamer(streamer.id);
      const decisions = input.receives.map((r, i) =>
        exchangeReceiveToDecision({
          itemName: String(r.itemName).trim(),
          quantity: Number(r.quantity),
          fanId: input.viewer.fanId,
          fanNickname: input.viewer.fanNickname,
          sourceKey: `exchange:${exchangeGroupId}:${i}`,
        }),
      );
      const accruals = computeCouponAccruals(decisions, sourceMap, couponItems);
      coupon =
        accruals.length > 0
          ? await accrueCouponsForRecords(streamer, accruals)
          : { accrued: 0, totalDelta: 0 };
    }
  } catch (err) {
    coupon = { error: err instanceof Error ? err.message : String(err) };
  }

  return { exchangeGroupId, coupon };
}

// 번들 교환 되돌리기: 준 조각의 수량을 복구(보상 이벤트)하고, 받은 exchange:<groupId> 기록을 삭제한다.
// - 준 쪽 복구 = admin_adjustment + after_json.revertOf(kind restore) — 원본·기존 이벤트는 불변(append-only).
// - 받은 쪽 삭제 = 운영자 생성분(exchange:*)만 물리 삭제(수동기록 manual:* 삭제와 같은 선례). 원본은 못 지움.
// - 같은 묶음 이중 되돌리기는 revertOfGroupId 존재 검사로 차단.
export async function revertExchangeBundle(
  slug: string,
  exchangeGroupId: string,
): Promise<{ revertedCount: number; coupon: ExchangeCouponResult }> {
  const streamer = await requireStreamer(slug);
  if (!UUID_RE.test(exchangeGroupId)) {
    const error = new Error("교환 묶음 id가 올바르지 않아요.");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const gives = await supabaseFetch<
    Array<{ id: string; upbo_entry_id: string; quantity_delta: number | null }>
  >(
    `/${tableName("upbo_item_events")}?streamer_id=eq.${streamer.id}&event_type=eq.exchange&after_json->>exchangeGroupId=eq.${exchangeGroupId}&select=id,upbo_entry_id,quantity_delta`,
  );
  if (gives.length === 0) {
    const error = new Error("교환 기록을 찾지 못했어요.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  const already = await supabaseFetch<Array<{ id: string }>>(
    `/${tableName("upbo_item_events")}?streamer_id=eq.${streamer.id}&event_type=eq.admin_adjustment&after_json->>revertOfGroupId=eq.${exchangeGroupId}&select=id&limit=1`,
  );
  if (already.length > 0) {
    const error = new Error("이미 되돌린 교환이에요.");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  await supabaseFetch(`/${tableName("upbo_item_events")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(
      gives.map((g) => ({
        upbo_entry_id: g.upbo_entry_id,
        streamer_id: streamer.id,
        event_type: "admin_adjustment",
        actor_type: "operator",
        after_json: {
          revertOf: {
            kind: "restore",
            ...(g.quantity_delta != null ? { quantity: g.quantity_delta } : {}),
          },
          revertOfEventId: g.id,
          revertOfGroupId: exchangeGroupId,
        },
        quantity_delta: g.quantity_delta,
        reason: "번들 교환 되돌리기",
        approval_status: "not_required",
        created_at: now,
      })),
    ),
  });

  await supabaseFetch(
    `/${tableName("upbo_entries")}?streamer_id=eq.${streamer.id}&source_key=like.exchange:${exchangeGroupId}:*`,
    { method: "DELETE", headers: { prefer: "return=minimal" } },
  );

  // 자동 적립 회수 — 이 묶음으로 쌓인 쿠폰을 도로 뺀다(잔액 0 밑으로는 안 내려감).
  // 이중 실행은 위 revertOfGroupId 가드가 이미 막는다. ★안전: 실패해도 위의 수량 복구·기록
  // 삭제는 유효하며 coupon:{ error } 로 표기만 한다(교환 저장 때의 적립 패스와 같은 격리 규칙).
  let coupon: ExchangeCouponResult = null;
  try {
    coupon = await revokeCouponAccrualsForExchange(streamer, exchangeGroupId);
  } catch (err) {
    coupon = { error: err instanceof Error ? err.message : String(err) };
  }

  return { revertedCount: gives.length, coupon };
}

// ---------- 양도 기록 계정ID 보정 ----------
// 닉네임만 적고 계정ID를 안 넣어 같은 사람이 두 줄로 갈라진 옛 양도 기록을 고친다.
// 이벤트의 afterJson.currentOwnerId 만 채우면 보유 계산이 그 ID로 다시 묶어 자동 통합된다.
// (transfer 이벤트만 대상, 원본 upbo_entries·수량엔 영향 없음)
export async function setTransferOwnerId(
  streamer: StreamerRow,
  eventId: string,
  ownerId: string,
): Promise<void> {
  if (!UUID_RE.test(eventId)) throw new Error("invalid event id");
  const rows = await supabaseFetch<Array<{ after_json: unknown }>>(
    `/${tableName("upbo_item_events")}?id=eq.${eventId}&streamer_id=eq.${streamer.id}&event_type=eq.transfer&select=after_json&limit=1`,
  );
  const row = rows[0];
  if (!row) throw new Error("양도 기록을 찾지 못했어요.");
  const after =
    row.after_json && typeof row.after_json === "object" && !Array.isArray(row.after_json)
      ? { ...(row.after_json as Record<string, unknown>) }
      : {};
  after.currentOwnerId = normalizeAccountId(ownerId);
  await supabaseFetch(
    `/${tableName("upbo_item_events")}?id=eq.${eventId}&streamer_id=eq.${streamer.id}`,
    { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ after_json: after }) },
  );
}

// ---------- 정가기록(시그니처 후원) ----------
// 스트리머가 지정한 "시그니처 후원 갯수"와 일치하는 후원을 정가 업보로 기록한다.
// 룰렛 판정(reconcileResults)과 완전히 별개의 패스이며, 시그니처 갯수가 비어 있으면
// 아무것도 하지 않는다(기존 동작과 100% 동일). 설계: docs/fixed-price-records-design.md

const SIGNATURE_MAX_COUNTS = 100;

// 시그니처 갯수 설정(스트리머별 최신 1건). audit_logs 재활용 — 스키마 변경 없음.
export async function latestSignatureCounts(streamerId: string, prefetched?: OverlayPrefetch): Promise<number[]> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { counts?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.signature_counts_updated&select=payload&order=created_at.desc&limit=1`,
  );
  const raw = rows[0]?.payload?.counts;
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0)
    .slice(0, SIGNATURE_MAX_COUNTS);
  return [...new Set(cleaned)].sort((a, b) => a - b);
}

export async function setSignatureCounts(streamer: StreamerRow, counts: number[]): Promise<number[]> {
  const cleaned = [
    ...new Set(counts.filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0)),
  ].sort((a, b) => a - b).slice(0, SIGNATURE_MAX_COUNTS);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "signature_counts_updated",
      actor: "extension",
      payload: { counts: cleaned },
    }),
  });
  return cleaned;
}

// 메모(시청자/정가) 첨부 이미지 최대 개수. 문자열 URL 배열만 저장한다.
export const MAX_MEMO_IMAGES = 5;

export function cleanMemoImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, MAX_MEMO_IMAGES);
}

// 정가기록 전용 메모(배송관리에서 상품목록 수기 작성). 기록(entrySourceKey)별 최신 1건.
export type FixedPriceNote = { entrySourceKey: string; noteText: string; images?: string[]; updatedAt?: string };

export async function fixedPriceNotesForStreamer(streamerId: string): Promise<FixedPriceNote[]> {
  const rows = await supabaseFetch<
    Array<{ payload: { entrySourceKey?: unknown; noteText?: unknown; images?: unknown } | null; created_at: string }>
  >(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.fixed_price_note_updated&select=payload,created_at&order=created_at.desc&limit=2000`,
  );
  const latest = new Map<string, FixedPriceNote>();
  for (const row of rows) {
    const key = typeof row.payload?.entrySourceKey === "string" ? row.payload.entrySourceKey : "";
    if (!key || latest.has(key)) continue; // desc 정렬이라 처음 만난 것이 최신
    latest.set(key, {
      entrySourceKey: key,
      noteText: typeof row.payload?.noteText === "string" ? row.payload.noteText : "",
      images: cleanMemoImages(row.payload?.images),
      updatedAt: row.created_at,
    });
  }
  return [...latest.values()];
}

export async function setFixedPriceNote(
  streamer: StreamerRow,
  entrySourceKey: string,
  noteText: string,
  images: string[] = [],
): Promise<FixedPriceNote> {
  const cleanImages = cleanMemoImages(images);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "fixed_price_note_updated",
      actor: "operator",
      payload: { entrySourceKey, noteText, images: cleanImages },
    }),
  });
  return { entrySourceKey, noteText, images: cleanImages };
}

// ---------- 배송완료 시청자 보관(숨김) ----------
// "일괄삭제"는 물리 삭제가 아니라 보관 처리다: 원본 upbo_entries 는 불변(검증 재현의 근거),
// 관리자·팬 화면에서만 숨긴다. audit_logs 재활용 — 스키마 변경 없음, archived:false 로 복구 가능.

// 보관 처리된 시청자 fanId → 마지막으로 보관된 시각(ISO) 맵. 복구(archived:false)되면 제거된다.
// 이벤트를 시간순(asc)으로 재생하며 archived:true 는 시각을 갱신, false 는 삭제한다.
export async function archivedFanAtForStreamer(streamerId: string): Promise<Record<string, string>> {
  const rows = await supabaseFetch<
    Array<{ payload: { fanIds?: unknown; archived?: unknown } | null; created_at?: string }>
  >(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.viewer_archive_updated&select=payload,created_at&order=created_at.asc&limit=2000`,
  );
  const at: Record<string, string> = {};
  for (const row of rows) {
    const fanIds = Array.isArray(row.payload?.fanIds) ? row.payload.fanIds : [];
    const flag = row.payload?.archived === true;
    const ts = row.created_at ?? new Date().toISOString();
    for (const fanId of fanIds) {
      if (typeof fanId !== "string" || !fanId) continue;
      if (flag) at[fanId] = ts;
      else delete at[fanId];
    }
  }
  return at;
}

export async function archivedFanIdsForStreamer(streamerId: string): Promise<string[]> {
  return Object.keys(await archivedFanAtForStreamer(streamerId));
}

export async function setViewerArchived(
  streamer: StreamerRow,
  fanIds: string[],
  archived: boolean,
): Promise<{ fanIds: string[]; archived: boolean }> {
  const cleaned = [...new Set(fanIds.filter((f) => typeof f === "string" && f.trim()))].slice(0, 500);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "viewer_archive_updated",
      actor: "extension",
      payload: { fanIds: cleaned, archived },
    }),
  });
  return { fanIds: cleaned, archived };
}

// ---------- 룰렛 관리(이름·사용/보관) ----------
// 스트리머가 룰렛에 붙인 이름과 보관(숨김) 상태를 audit_logs 오버레이에 최신 1건(entries 배열)으로
// 저장한다. 캡처(버전)가 아니라 "룰렛 내용(상품명 집합)"에 매다는 방식이라, 새 캡처가 들어와도
// 상품이 겹치는 같은 룰렛이면 이름·보관이 자동으로 상속된다(matchRouletteEntry). 스키마 변경 없음.

const ROULETTE_CONFIG_MAX = 200;
const ROULETTE_ITEMS_MAX = 200;

export async function rouletteConfigForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<RouletteConfigEntry[]> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { entries?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.roulette_config_updated&select=payload&order=created_at.desc&limit=1`,
  );
  const raw = rows[0]?.payload?.entries;
  if (!Array.isArray(raw)) return [];
  return sanitizeRouletteConfig(raw);
}

const ROULETTE_MEMBER_MAX = 50; // 한 룰렛에 담을 수 있는 멤버 그룹 상한

function cleanItemNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((s): s is string => typeof s === "string" && s.length > 0))].slice(
    0,
    ROULETTE_ITEMS_MAX,
  );
}

function sanitizeRouletteConfig(raw: unknown): RouletteConfigEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RouletteConfigEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const rec = e as Record<string, unknown>;
    // 새 구조 groups: string[][] (멤버 그룹들). 구버전 items: string[] → [items] 로 하위호환.
    let groups: string[][] = [];
    if (Array.isArray(rec.groups)) {
      groups = rec.groups
        .map((g) => cleanItemNames(g))
        .filter((g) => g.length > 0)
        .slice(0, ROULETTE_MEMBER_MAX);
    } else if (Array.isArray(rec.items)) {
      const items = cleanItemNames(rec.items);
      if (items.length > 0) groups = [items];
    }
    if (groups.length === 0) continue;
    const nameRaw = typeof rec.name === "string" ? rec.name.trim().slice(0, 60) : "";
    const archived = rec.archived === true;
    const revealed = rec.revealed === true;
    // 이름·보관·공개도 없고 멤버 그룹이 1개뿐이면 저장 의미 없음(미분류와 동일) — 건너뛴다.
    if (!nameRaw && !archived && !revealed && groups.length < 2) continue;
    out.push({ groups, name: nameRaw || undefined, archived, revealed });
    if (out.length >= ROULETTE_CONFIG_MAX) break;
  }
  return out;
}

export async function setRouletteConfig(
  streamer: StreamerRow,
  entries: RouletteConfigEntry[],
): Promise<RouletteConfigEntry[]> {
  const cleaned = sanitizeRouletteConfig(entries);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "roulette_config_updated",
      actor: "operator",
      payload: { entries: cleaned },
    }),
  });
  return cleaned;
}

// ---------- 팬 탭 이름(팬 화면 룰렛 탭 표시 이름) ----------
// 이름을 묶음(rouletteConfig)이 아니라 "탭의 상품 지문"에 매단다(sy 확정 2026-07-08 — 묶기와 완전 분리).
// 묶음을 해제해도 이름은 남고, 같은 상품 구성의 탭이 다시 생기면 이름이 되살아난다.
// audit_logs 오버레이 최신 1건(action=fan_tab_labels_updated). 스키마 변경 없음.
const FAN_TAB_LABELS_MAX = 100;
const FAN_TAB_NAME_MAX = 30;

function sanitizeFanTabLabels(raw: unknown): FanTabLabels {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const entries: FanTabLabelEntry[] = [];
  if (Array.isArray(obj.entries)) {
    for (const e of obj.entries) {
      if (!e || typeof e !== "object") continue;
      const rec = e as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim().slice(0, FAN_TAB_NAME_MAX) : "";
      if (!name) continue;
      const groups = Array.isArray(rec.groups)
        ? rec.groups
            .map((g) => cleanItemNames(g))
            .filter((g) => g.length > 0)
            .slice(0, ROULETTE_MEMBER_MAX)
        : [];
      if (groups.length === 0) continue;
      entries.push({ name, groups });
      if (entries.length >= FAN_TAB_LABELS_MAX) break;
    }
  }
  const fixedLabel =
    typeof obj.fixedLabel === "string" ? obj.fixedLabel.trim().slice(0, FAN_TAB_NAME_MAX) : "";
  const otherLabel =
    typeof obj.otherLabel === "string" ? obj.otherLabel.trim().slice(0, FAN_TAB_NAME_MAX) : "";
  return { entries, fixedLabel: fixedLabel || undefined, otherLabel: otherLabel || undefined };
}

export async function fanTabLabelsForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<FanTabLabels> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { labels?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.fan_tab_labels_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return sanitizeFanTabLabels(rows[0]?.payload?.labels);
}

export async function setFanTabLabels(streamer: StreamerRow, raw: unknown): Promise<FanTabLabels> {
  const clean = sanitizeFanTabLabels(raw);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "fan_tab_labels_updated",
      actor: "operator",
      payload: { labels: clean },
    }),
  });
  return clean;
}

// ---------- 위플랩 공개 링크(스트리머별 룰렛표 수집 소스) ----------
// url 등록 + "지금 가져오기" 결과 메타(lastFetch*)를 audit_logs 오버레이 최신 1건에 저장한다.
// 부분 병합(url만 저장해도 lastFetch* 보존, 그 반대도 성립) — adminUiPrefs와 같은 안전장치.
const WEFLAB_LINK_URL_MAX = 300;

function sanitizeWeflabLinkInfo(raw: unknown): WeflabLinkInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url.trim().slice(0, WEFLAB_LINK_URL_MAX) : undefined;
  const lastFetchedAt = typeof obj.lastFetchedAt === "string" ? obj.lastFetchedAt : undefined;
  const lastModifiedText = typeof obj.lastModifiedText === "string" ? obj.lastModifiedText.slice(0, 60) : undefined;
  const lastTableCount = Number.isFinite(Number(obj.lastTableCount)) ? Number(obj.lastTableCount) : undefined;
  const lastItemCount = Number.isFinite(Number(obj.lastItemCount)) ? Number(obj.lastItemCount) : undefined;
  const lastOverlapWarning = obj.lastOverlapWarning === true ? true : undefined;
  return {
    ...(url ? { url } : {}),
    ...(lastFetchedAt ? { lastFetchedAt } : {}),
    ...(lastModifiedText ? { lastModifiedText } : {}),
    ...(lastTableCount !== undefined ? { lastTableCount } : {}),
    ...(lastItemCount !== undefined ? { lastItemCount } : {}),
    ...(lastOverlapWarning ? { lastOverlapWarning } : {}),
  };
}

export async function weflabLinkForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<WeflabLinkInfo> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { link?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.weflab_link_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return sanitizeWeflabLinkInfo(rows[0]?.payload?.link);
}

export async function setWeflabLinkInfo(streamer: StreamerRow, partial: unknown): Promise<WeflabLinkInfo> {
  const existing = await weflabLinkForStreamer(streamer.id);
  const p = (partial ?? {}) as Record<string, unknown>;
  const merged = sanitizeWeflabLinkInfo({
    url: p.url !== undefined ? p.url : existing.url,
    lastFetchedAt: p.lastFetchedAt !== undefined ? p.lastFetchedAt : existing.lastFetchedAt,
    lastModifiedText: p.lastModifiedText !== undefined ? p.lastModifiedText : existing.lastModifiedText,
    lastTableCount: p.lastTableCount !== undefined ? p.lastTableCount : existing.lastTableCount,
    lastItemCount: p.lastItemCount !== undefined ? p.lastItemCount : existing.lastItemCount,
    lastOverlapWarning: p.lastOverlapWarning !== undefined ? p.lastOverlapWarning : existing.lastOverlapWarning,
  });
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "weflab_link_updated",
      actor: "operator",
      payload: { link: merged },
    }),
  });
  return merged;
}

// ---------- 팬 화면 배송 반영 설정(스트리머별) ----------
// 배송관리에서 처리한 수량(delivery_progress)을 팬 화면에 어떻게 반영할지 스트리머별로 정한다.
// audit_logs 오버레이 최신 1건. 기본 off(반영 안 함) — 기존 동작과 100% 동일. 스키마 변경 없음.

export async function fanDeliveryReflectForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<FanDeliveryReflect> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { deliveryReflect?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.fan_display_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return normalizeFanDeliveryReflect(rows[0]?.payload?.deliveryReflect);
}

export async function setFanDeliveryReflect(
  streamer: StreamerRow,
  mode: FanDeliveryReflect,
): Promise<FanDeliveryReflect> {
  const clean = normalizeFanDeliveryReflect(mode);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "fan_display_updated",
      actor: "operator",
      payload: { deliveryReflect: clean },
    }),
  });
  return clean;
}

// ---------- 상품 색상(팬 화면 하이라이트) ----------
// 상품명 → 팔레트 id("c1"~"c20") 맵을 audit_logs 오버레이 최신 1건으로 저장한다. 스키마 변경 없음.
const PRODUCT_COLORS_MAX = 500;
const PRODUCT_COLOR_ID_RE = /^c([1-9]|1[0-9]|20)$/;

export async function productColorsForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<Record<string, string>> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { colors?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.product_colors_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return sanitizeProductColors(rows[0]?.payload?.colors);
}

function sanitizeProductColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const [name, id] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= PRODUCT_COLORS_MAX) break;
    if (typeof name !== "string" || !name) continue;
    if (typeof id !== "string" || !PRODUCT_COLOR_ID_RE.test(id)) continue;
    out[name.slice(0, 200)] = id;
    n++;
  }
  return out;
}

export async function setProductColors(
  streamer: StreamerRow,
  colors: Record<string, string>,
): Promise<Record<string, string>> {
  const clean = sanitizeProductColors(colors);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "product_colors_updated",
      actor: "operator",
      payload: { colors: clean },
    }),
  });
  return clean;
}

// ---------- 팬 화면 룰렛 확률표 공개 마스터 스위치 ----------
// 개별 룰렛 공개 여부는 roulette_config 의 revealed 플래그. 이건 전체 on/off 마스터다.
export async function fanRevealEnabledForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<boolean> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { enabled?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.fan_reveal_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return rows[0]?.payload?.enabled === true;
}

export async function setFanRevealEnabled(streamer: StreamerRow, enabled: boolean): Promise<boolean> {
  const clean = enabled === true;
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "fan_reveal_updated",
      actor: "operator",
      payload: { enabled: clean },
    }),
  });
  return clean;
}

// ---------- 팬 화면 블록 배치(포스터/확률표/공지 × 슬롯) ----------
// audit_logs 오버레이 최신 1건. 없으면 DEFAULT_FAN_LAYOUT(기존 배치)과 동일. 스키마 변경 없음.
export async function fanLayoutForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<FanLayout> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { layout?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.fan_layout_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return normalizeFanLayout(rows[0]?.payload?.layout);
}

export async function setFanLayout(streamer: StreamerRow, layout: unknown): Promise<FanLayout> {
  const clean = normalizeFanLayout(layout);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "fan_layout_updated",
      actor: "operator",
      payload: { layout: clean },
    }),
  });
  return clean;
}

// ---------- 관리자 화면 UI 오버레이(스트리머별) ----------
// 상위탭 순서(tabOrder)와 이름(tabLabels)을 스트리머가 직접 커스텀한다. audit_logs 오버레이라
// 스키마 변경 없음. 기본값 = 빈 오버레이 = 코드 기본 순서/이름 그대로(안 만지면 100% 무변화).
// 잘못된 값(문자열 아님/과다)은 정규화 단계에서 버려 사이트에 리스크가 새지 않게 막는다.
// collapsed = 스트리머가 접어둔 섹션 key 집합(접힌 것만 true 저장, 펼침이 기본).
// sectionOrder = 탭 안 섹션 순서(탭 id → 섹션 key 배열). 없으면 코드 기본 순서 그대로.
export type AdminUiPrefs = {
  tabOrder: string[];
  tabLabels: Record<string, string>;
  collapsed: Record<string, boolean>;
  sectionOrder: Record<string, string[]>;
};

function normalizeAdminUiPrefs(raw: unknown): AdminUiPrefs {
  const obj = (raw ?? {}) as { tabOrder?: unknown; tabLabels?: unknown; collapsed?: unknown; sectionOrder?: unknown };
  const tabOrder = Array.isArray(obj.tabOrder)
    ? [...new Set(obj.tabOrder.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 40))].slice(0, 40)
    : [];
  const tabLabels: Record<string, string> = {};
  if (obj.tabLabels && typeof obj.tabLabels === "object") {
    let count = 0;
    for (const [key, value] of Object.entries(obj.tabLabels as Record<string, unknown>)) {
      if (count >= 40) break;
      if (typeof key !== "string" || key.length > 40) continue;
      if (typeof value !== "string") continue;
      const label = value.trim().slice(0, 24);
      if (label) {
        tabLabels[key] = label;
        count += 1;
      }
    }
  }
  const collapsed: Record<string, boolean> = {};
  if (obj.collapsed && typeof obj.collapsed === "object") {
    let count = 0;
    for (const [key, value] of Object.entries(obj.collapsed as Record<string, unknown>)) {
      if (count >= 60) break;
      if (typeof key !== "string" || key.length === 0 || key.length > 60) continue;
      if (value === true) {
        collapsed[key] = true;
        count += 1;
      }
    }
  }
  const sectionOrder: Record<string, string[]> = {};
  if (obj.sectionOrder && typeof obj.sectionOrder === "object") {
    let count = 0;
    for (const [key, value] of Object.entries(obj.sectionOrder as Record<string, unknown>)) {
      if (count >= 20) break;
      if (typeof key !== "string" || key.length === 0 || key.length > 40) continue;
      if (!Array.isArray(value)) continue;
      const list = [
        ...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 60)),
      ].slice(0, 40);
      if (list.length > 0) {
        sectionOrder[key] = list;
        count += 1;
      }
    }
  }
  return { tabOrder, tabLabels, collapsed, sectionOrder };
}

export async function adminUiPrefsForStreamer(streamerId: string, prefetched?: OverlayPrefetch): Promise<AdminUiPrefs> {
  const rows = prefetched ?? await supabaseFetch<Array<{ payload: { prefs?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.admin_ui_prefs_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return normalizeAdminUiPrefs(rows[0]?.payload?.prefs);
}

// 부분 병합 저장: 넘어온 필드만 갱신하고 나머지는 기존값 유지.
// 탭 순서/이름 편집기와 접기/펴기가 서로의 저장을 덮지 않게 하는 핵심 안전장치.
export async function setAdminUiPrefs(streamer: StreamerRow, partial: unknown): Promise<AdminUiPrefs> {
  const existing = await adminUiPrefsForStreamer(streamer.id);
  const p = (partial ?? {}) as { tabOrder?: unknown; tabLabels?: unknown; collapsed?: unknown; sectionOrder?: unknown };
  const clean = normalizeAdminUiPrefs({
    tabOrder: p.tabOrder !== undefined ? p.tabOrder : existing.tabOrder,
    tabLabels: p.tabLabels !== undefined ? p.tabLabels : existing.tabLabels,
    collapsed: p.collapsed !== undefined ? p.collapsed : existing.collapsed,
    sectionOrder: p.sectionOrder !== undefined ? p.sectionOrder : existing.sectionOrder,
  });
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "admin_ui_prefs_updated",
      actor: "operator",
      payload: { prefs: clean },
    }),
  });
  return clean;
}

// 시그니처 갯수와 일치하는 후원(구독 제외)을 "후원 1건" 단위로 묶어 정가 후보를 만든다.
// 11연차처럼 한 후원이 여러 행으로 캡처돼도 후보는 1개만 나온다.
export type FixedPriceCandidate = {
  sourceKey: string;
  fanId: string;
  fanNickname: string;
  donateTimeText: string;
  donationType: string;
  donationAmount: number;
  donationAmountText: string;
  rawText: string;
};

// 정가 매칭에 필요한 후원 행의 최소 형태(룰렛 결과와 무관 — 순수 후원도 포함).
export type FixedPriceSourceRow = {
  fanId: string;
  fanNickname: string;
  donateTimeText: string;
  donationType: string;
  donationAmount: number | null;
  donationAmountText: string;
  rawText: string;
};

// 캡처의 "후원 행" 전부에서 정가 매칭용 행을 뽑는다(룰렛 결과 유무와 무관).
// 원본(아이코)의 PRICED_DONATION_CANDIDATE에 해당 — 룰렛을 안 돌린 순수 대형 후원을 여기서 잡는다.
// (기존엔 normalizeResultCapture의 results[]만 봐서 순수 후원이 통째로 누락됐다.)
export function donationRowsFromCapture(capture: ResultCapture): FixedPriceSourceRow[] {
  const rows = Array.isArray(capture?.rows) ? capture.rows : [];
  const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
    for (const k of keys) if (obj?.[k] !== undefined) return obj[k];
    return undefined;
  };
  const out: FixedPriceSourceRow[] = [];
  for (const row of rows) {
    const donationAmount = toNumber(
      pick(row, ["donationAmount", "donation_amount", "amount", "donationCount", "donation_count", "giftCount", "gift_count"]),
    );
    if (donationAmount === null) continue;
    out.push({
      fanId: cleanText(pick(row, ["fanId", "accountId", "fan_id"])),
      fanNickname: cleanText(pick(row, ["fanNickname", "nickname", "fan_nickname"])),
      donateTimeText: cleanText(pick(row, ["donateTimeText", "donationTime", "donate_time_text"])),
      donationType: cleanText(pick(row, ["donationType", "type", "donation_type"])),
      donationAmount,
      donationAmountText: cleanText(pick(row, ["donationAmountText", "donation_amount_text", "amountText", "amount_text", "giftText", "gift_text"])),
      rawText: cleanText(pick(row, ["rawText", "chatText", "text", "raw_text"])),
    });
  }
  return out;
}

export function buildFixedPriceCandidates(
  rows: FixedPriceSourceRow[],
  counts: number[],
): FixedPriceCandidate[] {
  if (counts.length === 0) return [];
  const countSet = new Set(counts);
  const byDonation = new Map<string, FixedPriceCandidate>();
  for (const row of rows) {
    const amount = row.donationAmount;
    if (amount === null || !countSet.has(amount)) continue;
    // 구독은 갯수 단위가 풍선이 아니라 개월이라 정가 매칭에서 제외한다.
    if ((row.donationType || "").includes("구독")) continue;
    const fan = row.fanId || row.fanNickname;
    if (!fan) continue;
    const sourceKey = `fixed:${fan}:${row.donateTimeText}:${amount}`;
    if (byDonation.has(sourceKey)) continue;
    byDonation.set(sourceKey, {
      sourceKey,
      fanId: row.fanId,
      fanNickname: row.fanNickname,
      donateTimeText: row.donateTimeText,
      donationType: row.donationType,
      donationAmount: amount,
      donationAmountText: row.donationAmountText,
      rawText: row.rawText,
    });
  }
  return [...byDonation.values()];
}

// 정가 후보 중 아직 없는 것만 upbo_entries 에 기록한다. 반환값은 요약 카운트.
async function recordFixedPriceEntries(
  streamer: StreamerRow,
  candidates: FixedPriceCandidate[],
  knownSourceKeys: Set<string>,
): Promise<{ matched: number; recorded: number; duplicates: number }> {
  const fresh = candidates.filter((c) => !knownSourceKeys.has(c.sourceKey));
  if (fresh.length > 0) {
    const now = new Date().toISOString();
    // 룰렛 결과 insert(applyResultsForStreamer)와 동일한 충돌 방어를 복제한다:
    // knownSourceKeys 는 select limit(10000)에 걸려 upbo_entries 가 그 이상이면
    // 이미 있는 정가 행을 fresh 로 오인할 수 있고, unique(streamer_id, source_key)
    // 위반 1건이 배치 전체를 409로 실패시켜 확프가 무한 재전송(포이즌)하게 된다.
    // on_conflict 를 명시해 PK 외 unique 제약도 ignore-duplicates 로 흡수한다.
    await supabaseFetch(`/${tableName("upbo_entries")}?on_conflict=streamer_id,source_key`, {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        fresh.map((c) => ({
          id: crypto.randomUUID(),
          streamer_id: streamer.id,
          source_key: c.sourceKey,
          batch_id: null,
          catalog_version: null,
          status: "pending",
          fan_nickname: c.fanNickname,
          fan_id: c.fanId,
          item_name: `정가 ${c.donationAmount}개`,
          probability: 0,
          donate_time_text: c.donateTimeText,
          donation_type: c.donationType,
          donation_amount: c.donationAmount,
          donation_amount_text: c.donationAmountText,
          catalog_group_index: null,
          amount_range_label: "정가",
          roulette_index: 0,
          roulette_total: 0,
          raw_text: c.rawText,
          public_note: "",
          admin_note: "",
          raw_import_id: null,
          created_at: now,
          updated_at: now,
        })),
      ),
    });
  }
  return {
    matched: candidates.length,
    recorded: fresh.length,
    duplicates: candidates.length - fresh.length,
  };
}

// ---------- 재판정(rejudge) ----------
// 저장된 원본(raw_imports)을 "현재 확률표"로 다시 돌려, 기록됐어야 할 결과만 새로 넣는다.
// 순수 판정은 lib/rejudge.ts(collectRejudgeCandidates)가 하고, 여기서는 읽기/쓰기만 한다.
// 안전: 기존 upbo_entries 는 읽기만 한다(수정·삭제 없음). raw_imports/import_batches/
//       modifierState 는 전혀 건드리지 않는다. 새 원본을 만들지도 않는다.

// "예전 이름 = 지금 표의 이 상품" 연결표. catalog_usage 와 같은 방식으로
// audit_logs 최신 1건을 통째로 쓴다(스키마 변경 없음, 전체 교체 저장).
export async function itemAliasesForStreamer(streamerId: string): Promise<ItemAliasMap> {
  const rows = await supabaseFetch<Array<{ payload: { aliases?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.item_alias_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return cleanAliasMap(rows[0]?.payload?.aliases);
}

export async function setItemAliases(streamer: StreamerRow, aliases: ItemAliasMap): Promise<ItemAliasMap> {
  const cleaned = cleanAliasMap(aliases);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "item_alias_updated",
      actor: "sheet_admin",
      payload: { aliases: cleaned },
    }),
  });
  return cleaned;
}

async function rejudgeContextForStreamer(streamer: StreamerRow) {
  const catalog = await latestCatalog(streamer.id);
  const catalogUsage = await resolveCatalogUsageForCatalog(streamer.id, catalog);
  const catalogItems = applyCatalogUsage((catalog.items as NormalizedCatalogItem[]) || [], catalogUsage);
  const aliases = await itemAliasesForStreamer(streamer.id);
  const [rawRows, knownSourceKeys, specialItemRules] = await Promise.all([
    supabaseFetch<Array<{ batch_id: string | null; raw: Json }>>(
      `/${tableName("raw_imports")}?streamer_id=eq.${streamer.id}&type=eq.results&select=batch_id,saved_at,raw&order=saved_at.asc&limit=2000`,
    ),
    existingSourceKeys(streamer.id),
    specialRulesForCatalog(streamer.id, catalogItems),
  ]);
  // 저장 순서대로 하나씩 재실행한다(같은 결과가 여러 배치에 중복 캡처돼 있기 때문).
  const batches: RejudgeSourceBatch[] = rawRows.map((row) => ({
    batchId: row.batch_id ?? "",
    capture: (row.raw ?? {}) as ResultCapture,
  }));
  const { summary, candidates, unmatched } = collectRejudgeCandidates({
    batches,
    catalogItems,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    existingSourceKeys: knownSourceKeys,
    specialItemRules,
    aliases,
  });
  // 아직 못 찾은 결과를 "이름 묶음"으로 정리해 연결 화면 재료로 넘긴다.
  const aliasCandidates = buildAliasCandidates({
    results: unmatched,
    catalogItems,
    aliases,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
  }).map((group) => ({ ...group, options: group.options.slice(0, 5) }));
  return { catalog, summary, candidates, aliasCandidates, aliases };
}

export async function previewRejudgeForStreamer(streamer: StreamerRow) {
  const { catalog, summary, candidates, aliasCandidates, aliases } = await rejudgeContextForStreamer(streamer);
  return {
    applied: false,
    streamerSlug: streamer.slug,
    catalogVersion: catalog.version,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    summary,
    candidates,
    aliasCandidates,
    aliases,
  };
}

export async function applyRejudgeForStreamer(streamer: StreamerRow) {
  const { catalog, summary, candidates } = await rejudgeContextForStreamer(streamer);
  const now = new Date().toISOString();
  if (candidates.length > 0) {
    // source_key 는 원본 그대로 쓴다 → unique(streamer_id, source_key)가 중복을 막아
    // 두 번 눌러도 같은 결과가 두 번 들어가지 않는다(멱등).
    // batch_id 는 null(수동기록·정가기록 선례) — 새 수집 배치를 만들지 않기 위해서다.
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      await supabaseFetch(`/${tableName("upbo_entries")}?on_conflict=streamer_id,source_key`, {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(
          chunk.map((candidate) => ({
            id: crypto.randomUUID(),
            streamer_id: streamer.id,
            source_key: candidate.sourceKey,
            batch_id: null,
            catalog_version: catalog.version,
            status: "pending",
            fan_nickname: candidate.fanNickname,
            fan_id: candidate.fanId,
            item_name: candidate.itemName,
            probability: candidate.probability,
            donate_time_text: candidate.donateTimeText,
            donation_type: candidate.donationType,
            donation_amount: candidate.donationAmount,
            donation_amount_text: candidate.donationAmountText,
            catalog_group_index: candidate.catalogGroupIndex,
            amount_range_label: candidate.amountRangeLabel,
            roulette_index: candidate.rouletteIndex,
            roulette_total: candidate.rouletteTotal,
            raw_text: candidate.rawText,
            public_note: "",
            // 두배권 미적용이라 effectiveCount 는 항상 1 → admin_note 는 비운다(자동수집분과 동일 규칙).
            admin_note: "",
            raw_import_id: null,
            created_at: now,
            updated_at: now,
          })),
        ),
      });
    }
  }
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "rejudge_applied",
      actor: "sheet_admin",
      payload: {
        catalogVersion: catalog.version,
        thresholdPercent: Number(streamer.threshold_percent ?? 2),
        summary,
        sourceKeys: candidates.map((candidate) => candidate.sourceKey).slice(0, 1000),
      },
    }),
  });
  return {
    applied: true,
    streamerSlug: streamer.slug,
    catalogVersion: catalog.version,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    recorded: candidates.length,
    summary,
    candidates,
  };
}

export async function previewResultsForStreamer(streamer: StreamerRow, capture: ResultCapture) {
  const catalog = await latestCatalog(streamer.id);
  const normalized = normalizeResultCapture(capture);
  // 사용여부 오버레이 적용(오버라이드 없으면 원본 그대로 = 기존 판정과 동일).
  const catalogUsage = await resolveCatalogUsageForCatalog(streamer.id, catalog);
  const catalogItems = applyCatalogUsage((catalog.items as NormalizedCatalogItem[]) || [], catalogUsage);
  const knownSourceKeys = await existingSourceKeys(streamer.id);
  const preview = reconcileResults({
    catalogItems,
    results: normalized.results,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    existingSourceKeys: knownSourceKeys,
    specialItemRules: await specialRulesForCatalog(streamer.id, catalogItems),
    modifierState: await latestModifierState(streamer.id),
  });
  // 정가(시그니처) 미리보기 — 기록하지 않고 요약만 계산한다.
  const signatureCounts = await latestSignatureCounts(streamer.id);
  const fixedCandidates = buildFixedPriceCandidates(donationRowsFromCapture(capture), signatureCounts);
  const fixedPrice = {
    matched: fixedCandidates.length,
    recorded: 0,
    wouldRecord: fixedCandidates.filter((c) => !knownSourceKeys.has(c.sourceKey)).length,
    duplicates: fixedCandidates.filter((c) => knownSourceKeys.has(c.sourceKey)).length,
  };
  return {
    applied: false,
    streamerSlug: streamer.slug,
    catalogVersion: catalog.version,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    sourceUrl: normalized.sourceUrl,
    capturedAt: normalized.capturedAt,
    fixedPrice,
    summary: preview.summary,
    decisions: preview.decisions,
  };
}

export async function applyResultsForStreamer(streamer: StreamerRow, capture: ResultCapture) {
  const catalog = await latestCatalog(streamer.id);
  const normalized = normalizeResultCapture(capture);
  // 사용여부 오버레이 적용(오버라이드 없으면 원본 그대로 = 기존 판정과 동일).
  const catalogUsage = await resolveCatalogUsageForCatalog(streamer.id, catalog);
  const catalogItems = applyCatalogUsage((catalog.items as NormalizedCatalogItem[]) || [], catalogUsage);
  const currentModifierState = await latestModifierState(streamer.id);
  const knownSourceKeys = await existingSourceKeys(streamer.id);
  const preview = reconcileResults({
    catalogItems,
    results: normalized.results,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    existingSourceKeys: knownSourceKeys,
    specialItemRules: await specialRulesForCatalog(streamer.id, catalogItems),
    modifierState: currentModifierState,
  });
  // 정가(시그니처) 패스: 룰렛 판정과 별개로, 시그니처 갯수와 일치하는 후원을 기록한다.
  // 시그니처 미설정이면 후보가 0개라 아무것도 하지 않는다(기존 동작과 동일).
  const signatureCounts = await latestSignatureCounts(streamer.id);
  const fixedPrice = await recordFixedPriceEntries(
    streamer,
    buildFixedPriceCandidates(donationRowsFromCapture(capture), signatureCounts),
    knownSourceKeys,
  );
  const shouldPersist = shouldPersistApplyResult(preview.summary);
  const shouldSaveModifierState = modifierStateChanged(currentModifierState, preview.modifierState);

  if (!shouldPersist) {
    if (shouldSaveModifierState) await saveModifierState(streamer.id, preview.modifierState);
    return {
      applied: false,
      noChange: fixedPrice.recorded === 0,
      fixedPrice,
      reason: "no new record/review/modifier results",
      streamerSlug: streamer.slug,
      catalogVersion: catalog.version,
      thresholdPercent: Number(streamer.threshold_percent ?? 2),
      sourceUrl: normalized.sourceUrl,
      capturedAt: normalized.capturedAt,
      modifierStateSaved: shouldSaveModifierState,
      summary: preview.summary,
      decisions: preview.decisions,
    };
  }
  const recordDecisions = preview.decisions.filter((decision) => decision.decision === "record");
  const batchRows = await supabaseFetch<BatchRow[]>(`/${tableName("import_batches")}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      catalog_version: catalog.version,
      threshold_percent: Number(streamer.threshold_percent ?? 2),
      source_url: normalized.sourceUrl,
      captured_at: normalized.capturedAt,
      summary: preview.summary,
      entry_count: recordDecisions.length,
    }),
  });
  const batch = batchRows[0];
  const now = new Date().toISOString();
  const entries = recordDecisions
    .map((decision) => buildUpboEntry({ decision, streamerSlug: streamer.slug, batchId: batch.id, catalogVersion: catalog.version, now }))
    .filter(Boolean);
  // raw_imports를 먼저 저장해 ID를 entries에 연결한다 (원본 추적용).
  const rawImportRows = await supabaseFetch<Array<{ id: string }>>(`/${tableName("raw_imports")}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      type: "results",
      batch_id: batch.id,
      captured_at: normalized.capturedAt,
      raw: capture,
    }),
  });
  const rawImportId = rawImportRows[0]?.id ?? null;
  if (entries.length > 0) {
    await supabaseFetch(`/${tableName("upbo_entries")}?on_conflict=streamer_id,source_key`, {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        entries.map((entry) => ({
          id: crypto.randomUUID(),
          streamer_id: streamer.id,
          source_key: entry!.sourceKey,
          batch_id: batch.id,
          catalog_version: entry!.catalogVersion,
          status: entry!.status,
          fan_nickname: entry!.fanNickname,
          fan_id: entry!.fanId,
          item_name: entry!.itemName,
          probability: entry!.probability,
          donate_time_text: entry!.donateTimeText,
          donation_type: entry!.donationType,
          donation_amount: entry!.donationAmount,
          donation_amount_text: entry!.donationAmountText,
          catalog_group_index: entry!.catalogGroupIndex,
          amount_range_label: entry!.amountRangeLabel,
          roulette_index: entry!.rouletteIndex,
          roulette_total: entry!.rouletteTotal,
          raw_text: entry!.rawText,
          public_note: "",
          admin_note: entry!.adminNote,
          raw_import_id: rawImportId,
          created_at: now,
          updated_at: now,
        })),
      ),
    });
  }
  await saveModifierState(streamer.id, preview.modifierState);
  // 쿠폰 자동 적립(2단계 조각 2) — 판정/entry/정가/반환과 완전히 격리된 별도 패스.
  // ★안전: 여기서 무슨 일이 나도(쿼리 실패·적립 예외) 위의 저장·아래 반환은 전혀 영향받지 않는다.
  //   실패는 삼키지 않고 coupon:{ error } 로 표기만 하고 절대 throw 하지 않는다.
  //   매핑 미설정 스트리머는 sourceMap 0개 → 즉시 skip 이라 기존 동작과 100% 동일하다.
  let coupon: { accrued: number; totalDelta: number } | { error: string } | null = null;
  try {
    const sourceMap = await couponSourceMapForStreamer(streamer.id);
    if (sourceMap.length > 0) {
      // 1차 방어: recordDecisions 는 이미 "이번에 처음 기록되는 새 당첨"뿐이다(reconcile 이 기존건을 duplicate 로 뺌).
      // 2차 방어: 그래도 이미 자동 적립된 sourceKey 는 제외한다(grant 저장 실패 후 재시도 대비).
      const alreadyAccrued = await autoAccruedSourceKeys(streamer.id);
      const freshRecords = alreadyAccrued.size
        ? recordDecisions.filter((decision) => !alreadyAccrued.has(cleanText(decision.sourceKey)))
        : recordDecisions;
      const couponItems = await couponItemsForStreamer(streamer.id);
      const accruals = computeCouponAccruals(freshRecords, sourceMap, couponItems);
      coupon =
        accruals.length > 0
          ? await accrueCouponsForRecords(streamer, accruals)
          : { accrued: 0, totalDelta: 0 };
    }
  } catch (err) {
    coupon = { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    applied: true,
    streamerSlug: streamer.slug,
    catalogVersion: catalog.version,
    thresholdPercent: Number(streamer.threshold_percent ?? 2),
    sourceUrl: normalized.sourceUrl,
    capturedAt: normalized.capturedAt,
    batch: mapBatch(batch),
    fixedPrice,
    coupon,
    summary: preview.summary,
    decisions: preview.decisions,
    createdEntries: entries,
  };
}

export type RecordItemEventInput = {
  eventType: "transfer" | "exchange" | "cancel" | "void" | "complete" | "memo" | "quantity_adjust" | "admin_adjustment";
  actorType?: "streamer" | "operator" | "system";
  actorId?: string;
  reason?: string;
  memo?: string;
  // transfer: 양도 대상. quantityDelta 만큼(없으면 전량) 보유자가 newOwner 로 바뀐다.
  newOwnerName?: string;
  newOwnerId?: string;
  // exchange: 교환 후 상품 정보. quantityDelta 만큼(없으면 전량) 아이템이 바뀐다.
  // newItemProbability/newAmountRangeLabel 은 룰렛표 값 기준으로 반드시 전달해야
  // computeHoldings 가 교환된 조각의 확률을 올바르게 표시한다.
  newItemName?: string;
  newItemProbability?: number;
  newAmountRangeLabel?: string;
  // 부분 처리 수량. transfer/exchange/cancel/void/complete 에서 일부만 처리할 때 사용.
  // quantity_adjust 에서는 증감(+/-) 값. 생략 시 해당 엔트리 전량을 대상으로 본다.
  quantityDelta?: number;
  // admin_adjustment(되돌리기) 전용: 원 처리의 역연산 재료. 이게 있어야 보유 계산이
  // 수량을 실제로 복구한다(foldEntryHoldings 참고). 없으면 옛 방식(표시용 기록만).
  revertOf?: {
    eventId?: string; // 되돌리는 원 이벤트 id — 같은 이벤트 이중 되돌리기 차단에 사용.
    kind: "restore" | "transfer_back" | "exchange_back";
    quantity?: number;
    toOwnerId?: string;
    toOwnerName?: string;
    newItemName?: string;
  };
};

// 원본을 변경하지 않는 추가전용(append-only) 운영 이벤트 기록.
// upbo_entries 는 PATCH 하지 않고 upbo_item_events 에만 1건을 추가한다.
// 현재 보유 현황은 computeHoldings(entries, itemEvents) 로 계산한다.
export async function recordItemEvent(
  slug: string,
  upboEntryId: string,
  input: RecordItemEventInput,
) {
  const streamer = await requireStreamer(slug);
  const entries = await supabaseFetch<UpboEntryRow[]>(
    `/${tableName("upbo_entries")}?id=eq.${upboEntryId}&streamer_id=eq.${streamer.id}&select=*&limit=1`,
  );
  const entry = entries[0];
  if (!entry) {
    const error = new Error("upbo entry not found");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  // 같은 이벤트를 두 번 되돌리면 수량이 이중 복구되므로 서버에서 차단한다.
  if (input.eventType === "admin_adjustment" && input.revertOf?.eventId) {
    const dupes = await supabaseFetch<Array<{ id: string }>>(
      `/${tableName("upbo_item_events")}?streamer_id=eq.${streamer.id}&event_type=eq.admin_adjustment&after_json->>revertOfEventId=eq.${input.revertOf.eventId}&select=id&limit=1`,
    );
    if (dupes.length > 0) {
      const error = new Error("이미 되돌린 처리예요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
  }

  const now = new Date().toISOString();
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (input.eventType === "transfer") {
    before.currentOwnerName = entry.fan_nickname ?? "";
    before.currentOwnerId = normalizeAccountId(entry.fan_id);
    after.currentOwnerName = input.newOwnerName ?? null;
    // 받는 사람 ID도 "(id)" 형태로 입력될 수 있어 저장 전에 통일한다.
    after.currentOwnerId = normalizeAccountId(input.newOwnerId) || null;
  } else if (input.eventType === "exchange") {
    before.currentItemName = entry.item_name;
    before.currentItemProbability = entry.probability;
    before.currentAmountRangeLabel = entry.amount_range_label ?? null;
    after.currentItemName = input.newItemName ?? null;
    after.currentItemProbability = input.newItemProbability ?? null;
    after.currentAmountRangeLabel = input.newAmountRangeLabel ?? null;
  } else if (input.eventType === "cancel" || input.eventType === "void") {
    before.status = entry.status;
    after.status = "cancelled";
  } else if (input.eventType === "complete") {
    before.status = entry.status;
    after.status = "completed";
  } else if (input.eventType === "admin_adjustment") {
    // 되돌리기: 직전 운영 처리를 취소했음을 기록(원본은 그대로, 이벤트만 추가).
    before.status = entry.status;
    after.status = "pending";
    if (input.revertOf) {
      // 역연산 재료(보유 계산이 이걸 읽어 수량을 복구한다).
      const r = input.revertOf;
      after.revertOf = {
        kind: r.kind,
        ...(Number.isFinite(Number(r.quantity)) && Number(r.quantity) > 0
          ? { quantity: Number(r.quantity) }
          : {}),
        ...(r.toOwnerId ? { toOwnerId: normalizeAccountId(r.toOwnerId) } : {}),
        ...(r.toOwnerName ? { toOwnerName: String(r.toOwnerName) } : {}),
        ...(r.newItemName ? { newItemName: String(r.newItemName) } : {}),
      };
      if (r.eventId) after.revertOfEventId = r.eventId;
    }
  }

  await supabaseFetch(`/${tableName("upbo_item_events")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      upbo_entry_id: upboEntryId,
      streamer_id: streamer.id,
      event_type: input.eventType,
      actor_type: input.actorType ?? "operator",
      actor_id: input.actorId ?? null,
      before_json: Object.keys(before).length > 0 ? before : null,
      after_json: Object.keys(after).length > 0 ? after : null,
      quantity_delta: input.quantityDelta ?? null,
      reason: input.reason ?? null,
      memo: input.memo ?? null,
      approval_status: "not_required",
      created_at: now,
    }),
  });

  // 원본은 그대로. 갱신된 이벤트 목록을 함께 돌려줘 UI 가 보유 현황을 재계산할 수 있게 한다.
  const itemEvents = await getItemEvents(slug, upboEntryId);
  return { entry: mapEntry(entry, streamer.slug), itemEvents };
}

export async function getItemEvents(slug: string, upboEntryId: string) {
  const streamer = await requireStreamer(slug);
  const rows = await supabaseFetch<ItemEventRow[]>(
    `/${tableName("upbo_item_events")}?upbo_entry_id=eq.${upboEntryId}&streamer_id=eq.${streamer.id}&select=*&order=created_at.asc`,
  );
  return rows.map(mapItemEvent);
}

// ---------- 쿠폰 장부 (1단계 수동 MVP) ----------
// 업보(배송 대상 상품)와 별개로 시청자별로 쌓이는 지불 수단(마일리지/코인 개념).
// 잔액(coupon_balances) + 변경이력(coupon_events, append-only). 월 개념 없음.
// 쿠폰 "종류"는 스트리머마다 다르므로(커스텀) audit_logs(coupon_items_updated) 최신 1건에 저장.
// 획득/사용 자동화(룰렛 연동, 가격표)는 2·3단계 — 지금은 스트리머 수동 기입만.
// 스키마: supabase/migrations/20260707_coupon_ledger.sql

const COUPON_MAX_ITEM_DEFS = 30;
const COUPON_MAX_BALANCE = 1_000_000;
const COUPON_MAX_CHANGES = 200;
const COUPON_EVENTS_LIMIT = 300;
const COUPON_ITEM_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export type CouponItemDef = { key: string; name: string };

export type CouponBalance = {
  id: string;
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string;
  balance: number;
  updatedAt: string;
};

export type CouponEvent = {
  id: string;
  viewerKey: string;
  nickname: string;
  itemKey: string;
  itemName: string;
  delta: number;
  actionType: "grant" | "use" | "adjust" | "set";
  previousCount: number;
  nextCount: number;
  note: string;
  // 누가 만든 이벤트인지: "auto"(룰렛 자동 적립)·"streamer_admin"(수동 기입) 등.
  // 수동/자동 분리 표시에 쓴다. 스키마 변경 없음 — 기존 coupon_events.created_by 컬럼을 노출만 함.
  createdBy: string;
  createdAt: string;
};

export type CouponState = {
  items: CouponItemDef[];
  balances: CouponBalance[];
  events: CouponEvent[];
  sourceMap: CouponSourceMap[];
};

export type CouponChangeInput = {
  nickname?: string;
  accountId?: string;
  itemKey: string;
  itemName?: string;
  mode: "delta" | "set";
  value: number;
  actionType?: CouponEvent["actionType"];
  note?: string;
};

type CouponBalanceRow = {
  id: string;
  viewer_key: string;
  nickname: string | null;
  account_id: string | null;
  item_key: string;
  item_name: string;
  balance: number;
  updated_at: string;
};

type CouponEventRow = {
  id: string;
  viewer_key: string;
  nickname: string | null;
  item_key: string;
  item_name: string;
  delta: number;
  action_type: string;
  previous_count: number;
  next_count: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

function mapCouponBalance(row: CouponBalanceRow): CouponBalance {
  return {
    id: row.id,
    viewerKey: row.viewer_key,
    nickname: row.nickname ?? "",
    accountId: normalizeAccountId(row.account_id),
    itemKey: row.item_key,
    itemName: row.item_name,
    balance: row.balance,
    updatedAt: row.updated_at,
  };
}

function mapCouponEvent(row: CouponEventRow): CouponEvent {
  return {
    id: row.id,
    viewerKey: row.viewer_key,
    nickname: row.nickname ?? "",
    itemKey: row.item_key,
    itemName: row.item_name,
    delta: row.delta,
    actionType: (["grant", "use", "adjust", "set"].includes(row.action_type)
      ? row.action_type
      : "adjust") as CouponEvent["actionType"],
    previousCount: row.previous_count,
    nextCount: row.next_count,
    note: row.note ?? "",
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
  };
}

// 쿠폰 종류 목록 정리: 키 형식/이름 길이/중복을 걸러 최대 30개.
export function cleanCouponItems(raw: unknown): CouponItemDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CouponItemDef[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const rec = it as { key?: unknown; name?: unknown };
    const key = typeof rec.key === "string" ? rec.key.trim().toLowerCase() : "";
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!COUPON_ITEM_KEY_RE.test(key) || !name || name.length > 40 || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name });
    if (out.length >= COUPON_MAX_ITEM_DEFS) break;
  }
  return out;
}

// 쿠폰 종류 정의(스트리머별 최신 1건). audit_logs 재활용 — 스키마 변경 없음.
export async function couponItemsForStreamer(streamerId: string): Promise<CouponItemDef[]> {
  const rows = await supabaseFetch<Array<{ payload: { items?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.coupon_items_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return cleanCouponItems(rows[0]?.payload?.items);
}

export async function setCouponItems(streamer: StreamerRow, items: unknown): Promise<CouponItemDef[]> {
  const cleaned = cleanCouponItems(items);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "coupon_items_updated",
      actor: "operator",
      payload: { items: cleaned },
    }),
  });
  return cleaned;
}

async function couponLedgerForStreamer(streamerId: string): Promise<{
  balances: CouponBalance[];
  events: CouponEvent[];
}> {
  const [balanceRows, eventRows] = await Promise.all([
    supabaseFetch<CouponBalanceRow[]>(
      `/${tableName("coupon_balances")}?streamer_id=eq.${streamerId}&select=*&order=updated_at.desc&limit=5000`,
    ),
    supabaseFetch<CouponEventRow[]>(
      `/${tableName("coupon_events")}?streamer_id=eq.${streamerId}&select=*&order=created_at.desc&limit=${COUPON_EVENTS_LIMIT}`,
    ),
  ]);
  return { balances: balanceRows.map(mapCouponBalance), events: eventRows.map(mapCouponEvent) };
}

export async function getCouponStateBySlug(slug: string): Promise<CouponState> {
  const streamer = await requireStreamer(slug);
  const [items, ledger, sourceMap] = await Promise.all([
    couponItemsForStreamer(streamer.id),
    couponLedgerForStreamer(streamer.id),
    couponSourceMapForStreamer(streamer.id),
  ]);
  return { items, ...ledger, sourceMap };
}

// 쿠폰 잔액 변경(배치). 원장 규칙:
// - 잔액은 0 밑으로 내려가지 않는다(클램프 — 기존 paid_quantity/스택 원장과 동일 사고).
// - 모든 실제 변화는 event 1건으로 남는다(잔액 = 이벤트의 결과 총량). 변화 0이면 기록도 없음.
// - 저장은 배치 upsert + 배치 insert (N+1 금지 — P0 저장 배치화 교훈).
export async function saveCouponChanges(
  slug: string,
  changes: CouponChangeInput[],
): Promise<Omit<CouponState, "sourceMap"> & { appliedCount: number }> {
  const streamer = await requireStreamer(slug);
  if (changes.length > COUPON_MAX_CHANGES) {
    const error = new Error(`한 번에 ${COUPON_MAX_CHANGES}건까지만 저장할 수 있어요.`);
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  // 현재 잔액을 한 번에 읽고 메모리에서 순서대로 접는다(같은 시청자·쿠폰에 여러 변경도 안전).
  const existing = await supabaseFetch<CouponBalanceRow[]>(
    `/${tableName("coupon_balances")}?streamer_id=eq.${streamer.id}&select=*&limit=5000`,
  );
  type Working = {
    viewer_key: string;
    nickname: string | null;
    account_id: string | null;
    item_key: string;
    item_name: string;
    balance: number;
  };
  const working = new Map<string, Working>();
  // 닉네임→계정ID 자동 매칭용(닉네임이 정확히 한 명의 ID로만 존재할 때).
  // 화면의 자동 찾기와 같은 규칙을 서버에도 둬서, ID 없이 온 요청이
  // 같은 시청자를 닉네임 키로 갈라 만드는 것(양도 ID 필수화 때 잡은 중복 줄 패턴)을 막는다.
  const idsByNickname = new Map<string, Set<string>>();
  for (const row of existing) {
    working.set(`${row.viewer_key}@@${row.item_key}`, {
      viewer_key: row.viewer_key,
      nickname: row.nickname,
      account_id: row.account_id,
      item_key: row.item_key,
      item_name: row.item_name,
      balance: row.balance,
    });
    const nick = (row.nickname ?? "").trim();
    const rowId = normalizeAccountId(row.account_id);
    if (nick && rowId) {
      if (!idsByNickname.has(nick)) idsByNickname.set(nick, new Set());
      idsByNickname.get(nick)!.add(rowId);
    }
  }

  const now = new Date().toISOString();
  const touched = new Map<string, Working>();
  const eventRows: Array<Record<string, unknown>> = [];

  for (const change of changes) {
    const itemKey = String(change.itemKey || "").trim().toLowerCase();
    if (!COUPON_ITEM_KEY_RE.test(itemKey)) {
      const error = new Error("쿠폰 종류가 올바르지 않아요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const value = Number(change.value);
    if (!Number.isFinite(value) || !Number.isInteger(value) || Math.abs(value) > COUPON_MAX_BALANCE) {
      const error = new Error("수량은 정수로 입력해 주세요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    let accountId = normalizeAccountId(change.accountId ?? "");
    const nickname = String(change.nickname ?? "").trim().slice(0, 80);
    if (!accountId && nickname) {
      const known = idsByNickname.get(nickname);
      if (known && known.size === 1) accountId = [...known][0];
    }
    // 시청자 키: 계정ID 우선, 없으면 닉네임(운영 레이어 holdingOwnerKey 규약과 동일).
    const viewerKey = accountId || nickname;
    if (!viewerKey) {
      const error = new Error("시청자 ID 또는 닉네임을 입력해 주세요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const mapKey = `${viewerKey}@@${itemKey}`;
    const cur = working.get(mapKey);
    const prev = cur?.balance ?? 0;
    const rawNext = change.mode === "set" ? value : prev + value;
    const next = Math.max(0, Math.min(COUPON_MAX_BALANCE, rawNext));
    if (next === prev) continue; // 변화 없음 — 잔액도 이벤트도 그대로.

    const itemName =
      (typeof change.itemName === "string" && change.itemName.trim().slice(0, 40)) ||
      cur?.item_name ||
      itemKey;
    const merged: Working = {
      viewer_key: viewerKey,
      nickname: nickname || cur?.nickname || null,
      account_id: accountId || cur?.account_id || null,
      item_key: itemKey,
      item_name: itemName,
      balance: next,
    };
    working.set(mapKey, merged);
    touched.set(mapKey, merged);

    const actionType: CouponEvent["actionType"] =
      change.actionType && ["grant", "use", "adjust", "set"].includes(change.actionType)
        ? change.actionType
        : change.mode === "set"
          ? "set"
          : value >= 0
            ? "grant"
            : "use";
    eventRows.push({
      streamer_id: streamer.id,
      viewer_key: viewerKey,
      nickname: merged.nickname,
      item_key: itemKey,
      item_name: itemName,
      delta: next - prev,
      action_type: actionType,
      previous_count: prev,
      next_count: next,
      note: String(change.note ?? "").trim().slice(0, 500) || null,
      created_by: "streamer_admin",
      created_at: now,
    });
  }

  if (touched.size > 0) {
    await supabaseFetch(
      `/${tableName("coupon_balances")}?on_conflict=streamer_id,viewer_key,item_key`,
      {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(
          [...touched.values()].map((v) => ({ streamer_id: streamer.id, ...v, updated_at: now })),
        ),
      },
    );
    await supabaseFetch(`/${tableName("coupon_events")}`, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(eventRows),
    });
  }

  const [items, ledger] = await Promise.all([
    couponItemsForStreamer(streamer.id),
    couponLedgerForStreamer(streamer.id),
  ]);
  return { items, ...ledger, appliedCount: eventRows.length };
}

// ---------- 쿠폰 자동 적립 연결 (2단계 조각 1: 매핑 설정만) ----------
// "이 룰렛 상품에 당첨되면 = 이 쿠폰 N개 적립"의 연결(매핑)만 저장한다.
// 실제 적립 로직은 다음 조각 — 여기는 설정 화면과 저장까지만.
// couponItems 와 동일하게 audit_logs(coupon_source_map_updated) 최신 1건에 저장 — 스키마 변경 없음.

const COUPON_SOURCE_MAX_PER = 999;
const COUPON_SOURCE_MAX_PER_ITEM = 30; // 쿠폰 종류 1개당 연결할 상품 최대 개수.

// 쿠폰 종류(itemKey)마다, 어떤 상품(itemName)에 당첨되면 몇 개(per) 적립할지의 연결 목록.
export type CouponSourceMap = {
  itemKey: string;
  sources: Array<{ itemName: string; per: number }>;
};

// 매핑 정리: itemKey는 실제 쿠폰 종류만(validItemKeys 주어질 때), 상품명 trim/중복 제거,
// per는 정수 1~999 클램프(기본 1), 종류당 최대 30개, 전체 상한 방어. cleanCouponItems 스타일.
export function cleanCouponSourceMap(raw: unknown, validItemKeys?: Set<string>): CouponSourceMap[] {
  if (!Array.isArray(raw)) return [];
  const out: CouponSourceMap[] = [];
  const seenKeys = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { itemKey?: unknown; sources?: unknown };
    const itemKey = typeof rec.itemKey === "string" ? rec.itemKey.trim().toLowerCase() : "";
    if (!COUPON_ITEM_KEY_RE.test(itemKey) || seenKeys.has(itemKey)) continue;
    if (validItemKeys && !validItemKeys.has(itemKey)) continue;
    if (!Array.isArray(rec.sources)) continue;
    const sources: CouponSourceMap["sources"] = [];
    const seenNames = new Set<string>();
    for (const s of rec.sources) {
      if (!s || typeof s !== "object") continue;
      const srec = s as { itemName?: unknown; per?: unknown };
      const itemName = typeof srec.itemName === "string" ? srec.itemName.trim().slice(0, 80) : "";
      if (!itemName || seenNames.has(itemName)) continue;
      const rawPer = Number(srec.per);
      const per = Number.isFinite(rawPer)
        ? Math.max(1, Math.min(COUPON_SOURCE_MAX_PER, Math.round(rawPer)))
        : 1;
      seenNames.add(itemName);
      sources.push({ itemName, per });
      if (sources.length >= COUPON_SOURCE_MAX_PER_ITEM) break;
    }
    if (sources.length === 0) continue; // 연결이 하나도 없는 종류는 저장하지 않는다.
    seenKeys.add(itemKey);
    out.push({ itemKey, sources });
    if (out.length >= COUPON_MAX_ITEM_DEFS) break;
  }
  return out;
}

// 적립 연결(스트리머별 최신 1건). audit_logs 재활용 — 스키마 변경 없음.
export async function couponSourceMapForStreamer(streamerId: string): Promise<CouponSourceMap[]> {
  const rows = await supabaseFetch<Array<{ payload: { map?: unknown } | null }>>(
    `/${tableName("audit_logs")}?streamer_id=eq.${streamerId}&action=eq.coupon_source_map_updated&select=payload&order=created_at.desc&limit=1`,
  );
  return cleanCouponSourceMap(rows[0]?.payload?.map);
}

export async function setCouponSourceMap(
  streamer: StreamerRow,
  raw: unknown,
): Promise<CouponSourceMap[]> {
  // 실제 존재하는 쿠폰 종류만 남기려고 현재 쿠폰 종류 키를 함께 읽어 검증한다.
  const items = await couponItemsForStreamer(streamer.id);
  const validItemKeys = new Set(items.map((it) => it.key));
  const cleaned = cleanCouponSourceMap(raw, validItemKeys);
  await supabaseFetch(`/${tableName("audit_logs")}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamer.id,
      action: "coupon_source_map_updated",
      actor: "operator",
      payload: { map: cleaned },
    }),
  });
  return cleaned;
}

// ---------- 쿠폰 연결 상품을 팬 시트·배송에서 "표시상" 제외 (2단계 조각 4) ----------
// 쿠폰으로 등록(연결)한 룰렛 상품은 이제 배송이 아니라 쿠폰으로 적립된다(조각 2·3).
// 그래서 팬 업보시트/배송관리의 "표시 계산"에서만 그 상품을 뺀다 — 원본 upbo_entries·
// computeHoldings·판정은 무수정, 획득 기록(전체 이력) 탭은 그대로 유지한다.
// 매핑이 0개면 빈 Set → 필터가 원본 holdings 를 그대로 돌려줘 회귀가 없다(최우선 안전선).

// 연결된 모든 상품명을 normalizeName(공백/대소문자 흡수, 조각 2·3 매칭과 동일)한 집합.
export function couponExcludedNameSet(sourceMap: CouponSourceMap[]): Set<string> {
  const set = new Set<string>();
  for (const entry of sourceMap) {
    for (const source of entry.sources) {
      const key = normalizeName(source.itemName);
      if (key) set.add(key);
    }
  }
  return set;
}

// 표시용 holdings 필터: 각 보유자의 items 중 상품명이 excluded 에 든 것만 제거한다.
// - 쿠폰상품+일반상품을 함께 가진 보유자는 일반상품만 남는다(통째 제외 아님).
// - 쿠폰상품만 가진 보유자는 items 가 비어 자연 제외된다.
// - excluded 가 비면(매핑 0개) 원본 배열을 그대로(동일 참조) 돌려준다 = 회귀 0.
export function filterHoldingsByExcludedNames(
  holdings: ViewerHolding[],
  excluded: Set<string>,
): ViewerHolding[] {
  if (excluded.size === 0) return holdings;
  const result: ViewerHolding[] = [];
  for (const h of holdings) {
    const kept = h.items.filter((it) => !excluded.has(normalizeName(it.itemName)));
    if (kept.length === h.items.length) {
      result.push(h); // 제외 대상 없음 — 원본 holding 그대로(불필요한 재계산 회피)
      continue;
    }
    if (kept.length === 0) continue; // 쿠폰상품만 보유 → 통째 빠짐
    result.push({
      ...h,
      items: kept,
      maxProb: kept.reduce((m, it) => Math.max(m, it.probability), 0),
      total: kept.reduce((sum, it) => sum + it.quantity, 0),
    });
  }
  return result;
}

// 팬 시트 렌더(page.tsx)용 슬러그 기준 연결 상품명 집합. 팬 모드에선 쿠폰 잔액/이벤트까지
// 읽을 필요가 없어(공개 화면 성능) source map 만 로드한다. getCouponStateBySlug 와 같은
// 얇은 슬러그 로더 패턴 — 조각 1 로직 무수정 재사용. 테이블 미적용/조회 실패는 호출부에서 처리.
export async function getCouponExcludedNamesBySlug(slug: string): Promise<Set<string>> {
  const streamer = await requireStreamer(slug);
  const sourceMap = await couponSourceMapForStreamer(streamer.id);
  return couponExcludedNameSet(sourceMap);
}

// ---------- 팬 쿠폰 탭 전용: 잔액만 얇게 읽기 (읽기 전용) ----------
// 공개 팬 화면 성능을 위해 이벤트·소스맵·종류정의는 로드하지 않는다(getCouponStateBySlug 는 관리자용).
// coupon_balances 행에 nickname·item_name 이 이미 있어 추가 조인이 필요 없다.
// 잔액 0(다 쓴 쿠폰)도 그대로 반환하고, 표시 규칙(0=사용완료 표기)은 lib/fanCouponView.ts 가 담당.
// 조회 실패/테이블 미적용은 호출부에서 처리한다 — 팬 화면은 null 로 받아 "빈 장부"와 구분 표시.
export async function getCouponBalancesForFan(slug: string): Promise<CouponBalance[]> {
  const streamer = await requireStreamer(slug);
  const rows = await supabaseFetch<CouponBalanceRow[]>(
    `/${tableName("coupon_balances")}?streamer_id=eq.${streamer.id}&select=*&order=updated_at.desc&limit=5000`,
  );
  return rows.map(mapCouponBalance);
}

// 팬 쿠폰 탭 "노출 여부" 판단용: 쿠폰 종류를 등록한 스트리머만 팬 화면에 쿠폰 탭이 생긴다.
// 종류 정의(audit_logs 최신 1건)만 얇게 읽는다 — 잔액·이벤트 없이 가벼운 조회 1회.
export async function getCouponItemsBySlug(slug: string): Promise<CouponItemDef[]> {
  const streamer = await requireStreamer(slug);
  return couponItemsForStreamer(streamer.id);
}

// ---------- 쿠폰 자동 적립 (2단계 조각 2: 룰렛 당첨 → 연결된 쿠폰 자동 적립) ----------
// 조각 1(CouponSourceMap)의 연결을 실제로 적용한다: applyResults 가 "이번에 처음 기록되는
// 새 당첨(record decision)"을 저장할 때, 연결된 쿠폰을 자동으로 쌓는다.
// 적립 저장 규약은 saveCouponChanges 와 동일하다(viewer_key = 계정ID 우선·닉네임 폴백,
// balances upsert + coupon_events insert). 스키마 변경 없음(coupon_events.note/created_by 활용).

// 한 번의 적립 대상(시청자·쿠폰 종류 단위로 합산됨).
export type CouponAccrual = {
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string; // 쿠폰 표시명 스냅샷(events.item_name 에 남김)
  delta: number;
  sourceKeys: string[]; // 이 적립에 기여한 당첨들의 sourceKey(재적립 방지 참조용)
};

// 자동 적립 이벤트의 note 접두사 — created_by="auto" 와 함께 화면/재적립 방지에서 자동분을 구분한다.
const COUPON_AUTO_NOTE_PREFIX = "auto:";

// 순수 계산 함수(부작용 없음 — 단위 테스트용).
// record decision 들 × 연결(sourceMap)을 받아 적립 목록을 만든다.
// - sourceMap 을 {상품명(normalize) → [{itemKey, per}]} 인덱스로. 한 상품이 여러 쿠폰에 연결될 수 있어 배열.
// - 각 당첨의 상품명이 인덱스에 있으면 적립: 개수 = per × max(1, 당첨수량(effectiveCount)).
// - 같은 (viewerKey, itemKey) 는 합산.
// - 연결이 없으면(sourceMap 빈 배열) 아무것도 반환하지 않는다(매핑 미설정 스트리머 = 기존 동작 그대로).
export function computeCouponAccruals(
  recordDecisions: ReconcileDecision[],
  sourceMap: CouponSourceMap[],
  couponItems: CouponItemDef[] = [],
): CouponAccrual[] {
  if (!Array.isArray(sourceMap) || sourceMap.length === 0) return [];
  // 상품명(정규화) → [{itemKey, per}] 인덱스. reconcile 상품 매칭과 동일하게 normalizeName 로 맞춘다.
  const index = new Map<string, Array<{ itemKey: string; per: number }>>();
  for (const entry of sourceMap) {
    for (const source of entry.sources) {
      const nameKey = normalizeName(source.itemName);
      if (!nameKey) continue;
      if (!index.has(nameKey)) index.set(nameKey, []);
      index.get(nameKey)!.push({ itemKey: entry.itemKey, per: source.per });
    }
  }
  if (index.size === 0) return [];
  const nameByKey = new Map(couponItems.map((it) => [it.key, it.name]));

  const acc = new Map<string, CouponAccrual>();
  for (const decision of recordDecisions) {
    if (!decision || decision.decision !== "record") continue;
    const result = decision.result;
    const targets = index.get(normalizeName(result?.itemName));
    if (!targets || targets.length === 0) continue;
    const accountId = normalizeAccountId(result.fanId);
    const nickname = cleanText(result.fanNickname);
    const viewerKey = accountId || nickname;
    if (!viewerKey) continue;
    const rawCount = Number(decision.effectiveCount ?? 1);
    const winCount = Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1;
    const sourceKey = cleanText(decision.sourceKey);
    for (const { itemKey, per } of targets) {
      const delta = per * winCount;
      if (delta <= 0) continue;
      const mapKey = `${viewerKey}@@${itemKey}`;
      const cur = acc.get(mapKey);
      if (cur) {
        cur.delta += delta;
        if (sourceKey && !cur.sourceKeys.includes(sourceKey)) cur.sourceKeys.push(sourceKey);
      } else {
        acc.set(mapKey, {
          viewerKey,
          nickname,
          accountId,
          itemKey,
          itemName: nameByKey.get(itemKey) || itemKey,
          delta,
          sourceKeys: sourceKey ? [sourceKey] : [],
        });
      }
    }
  }
  return [...acc.values()].filter((a) => a.delta > 0);
}

// 이미 자동 적립된 sourceKey 집합(재적립 2차 방어). created_by="auto" 이벤트의 note 에 심긴 참조를 읽는다.
async function autoAccruedSourceKeys(streamerId: string): Promise<Set<string>> {
  const rows = await supabaseFetch<Array<{ note: string | null }>>(
    `/${tableName("coupon_events")}?streamer_id=eq.${streamerId}&created_by=eq.auto&select=note&order=created_at.desc&limit=2000`,
  );
  const out = new Set<string>();
  for (const row of rows) {
    const note = row.note ?? "";
    if (!note.startsWith(COUPON_AUTO_NOTE_PREFIX)) continue;
    for (const key of note.slice(COUPON_AUTO_NOTE_PREFIX.length).split(",")) {
      const trimmed = key.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return out;
}

// 적립 저장(saveCouponChanges 규약 재사용): balances upsert(기존 잔액+delta, 0~상한 클램프)
// + coupon_events insert(action_type="grant", created_by="auto", note=자동 참조). 스키마 변경 없음.
async function accrueCouponsForRecords(
  streamer: StreamerRow,
  accruals: CouponAccrual[],
): Promise<{ accrued: number; totalDelta: number }> {
  if (accruals.length === 0) return { accrued: 0, totalDelta: 0 };
  const existing = await supabaseFetch<CouponBalanceRow[]>(
    `/${tableName("coupon_balances")}?streamer_id=eq.${streamer.id}&select=*&limit=5000`,
  );
  type Working = {
    viewer_key: string;
    nickname: string | null;
    account_id: string | null;
    item_key: string;
    item_name: string;
    balance: number;
  };
  const working = new Map<string, Working>();
  for (const row of existing) {
    working.set(`${row.viewer_key}@@${row.item_key}`, {
      viewer_key: row.viewer_key,
      nickname: row.nickname,
      account_id: row.account_id,
      item_key: row.item_key,
      item_name: row.item_name,
      balance: row.balance,
    });
  }

  const now = new Date().toISOString();
  const touched = new Map<string, Working>();
  const eventRows: Array<Record<string, unknown>> = [];
  let totalDelta = 0;

  for (const accrual of accruals) {
    const itemKey = String(accrual.itemKey || "").trim().toLowerCase();
    if (!COUPON_ITEM_KEY_RE.test(itemKey)) continue;
    const viewerKey = String(accrual.viewerKey || "").trim();
    if (!viewerKey) continue;
    const delta = Number(accrual.delta);
    if (!Number.isFinite(delta) || delta <= 0) continue;

    const mapKey = `${viewerKey}@@${itemKey}`;
    const cur = working.get(mapKey);
    const prev = cur?.balance ?? 0;
    const next = Math.max(0, Math.min(COUPON_MAX_BALANCE, prev + Math.floor(delta)));
    if (next === prev) continue;

    const itemName =
      (typeof accrual.itemName === "string" && accrual.itemName.trim().slice(0, 40)) ||
      cur?.item_name ||
      itemKey;
    const merged: Working = {
      viewer_key: viewerKey,
      nickname: accrual.nickname?.trim().slice(0, 80) || cur?.nickname || null,
      account_id: normalizeAccountId(accrual.accountId) || cur?.account_id || null,
      item_key: itemKey,
      item_name: itemName,
      balance: next,
    };
    working.set(mapKey, merged);
    touched.set(mapKey, merged);
    const note = `${COUPON_AUTO_NOTE_PREFIX}${accrual.sourceKeys.join(",")}`.slice(0, 500);
    eventRows.push({
      streamer_id: streamer.id,
      viewer_key: viewerKey,
      nickname: merged.nickname,
      item_key: itemKey,
      item_name: itemName,
      delta: next - prev,
      action_type: "grant",
      previous_count: prev,
      next_count: next,
      note,
      created_by: "auto",
      created_at: now,
    });
    totalDelta += next - prev;
  }

  if (touched.size > 0) {
    await supabaseFetch(
      `/${tableName("coupon_balances")}?on_conflict=streamer_id,viewer_key,item_key`,
      {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(
          [...touched.values()].map((v) => ({ streamer_id: streamer.id, ...v, updated_at: now })),
        ),
      },
    );
    await supabaseFetch(`/${tableName("coupon_events")}`, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(eventRows),
    });
  }
  return { accrued: eventRows.length, totalDelta };
}

// ---------- 쿠폰 자동 적립: 교환 유입분 ----------
// 교환으로 "받은 상품"도 룰렛 당첨과 똑같이 쿠폰 연결이면 자동 적립한다.
// (교환 받은 entry 는 status=pending 이라 조각 2(수집 반영)·조각 3(소급, status=record만)
//  어느 경로에도 안 잡혀서 생기던 빈틈을 막는 조각. 계산은 조각 2를 그대로 재사용한다.)

// 교환으로 받은 상품 1건 → record ReconcileDecision 어댑터(순수).
// couponBackfillEntryToDecision 과 같은 최소-필드 캐스팅 패턴 — computeCouponAccruals 가 읽는
// 필드(decision / result.itemName·fanId·fanNickname / effectiveCount / sourceKey)만 채운다.
export function exchangeReceiveToDecision(input: {
  itemName: string;
  quantity: number;
  fanId: string;
  fanNickname: string;
  sourceKey: string;
}): ReconcileDecision {
  const result = {
    itemName: input.itemName,
    fanId: input.fanId,
    fanNickname: input.fanNickname,
  } as unknown as NormalizedResult;
  const rawCount = Number(input.quantity);
  return {
    sourceKey: input.sourceKey,
    decision: "record",
    reason: "exchange",
    result,
    catalogItem: null,
    effectiveCount: Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1,
  } as unknown as ReconcileDecision;
}

// 교환 묶음(exchangeGroupId)으로 자동 적립된 쿠폰을 회수한다(되돌리기의 짝).
// 대상 식별: created_by="auto" grant 이벤트의 note 참조키가 "exchange:<groupId>:" 를 포함하는 것만.
// (룰렛 자동 적립의 sourceKey 는 exchange: 프리픽스를 절대 안 쓰므로 오인 회수 없음.)
// 잔액은 0 밑으로 안 내려간다 — 팬이 이미 써버린 만큼은 회수 불가(기존 장부 클램프 규칙 그대로).
async function revokeCouponAccrualsForExchange(
  streamer: StreamerRow,
  exchangeGroupId: string,
): Promise<{ revoked: number; totalDelta: number }> {
  const grants = await supabaseFetch<CouponEventRow[]>(
    `/${tableName("coupon_events")}?streamer_id=eq.${streamer.id}&created_by=eq.auto&action_type=eq.grant&note=like.${COUPON_AUTO_NOTE_PREFIX}*exchange:${exchangeGroupId}:*&select=*`,
  );
  if (grants.length === 0) return { revoked: 0, totalDelta: 0 };

  const existing = await supabaseFetch<CouponBalanceRow[]>(
    `/${tableName("coupon_balances")}?streamer_id=eq.${streamer.id}&select=*&limit=5000`,
  );
  const balanceByKey = new Map(existing.map((row) => [`${row.viewer_key}@@${row.item_key}`, row]));

  const now = new Date().toISOString();
  const upserts: Array<Record<string, unknown>> = [];
  const eventRows: Array<Record<string, unknown>> = [];
  let totalDelta = 0;
  for (const g of grants) {
    const mapKey = `${g.viewer_key}@@${g.item_key}`;
    const cur = balanceByKey.get(mapKey);
    const prev = cur?.balance ?? 0;
    const next = Math.max(0, prev - Math.max(0, Number(g.delta) || 0));
    if (next === prev) continue;
    // 한 묶음에선 (viewer,item)당 grant 1건뿐(computeCouponAccruals 가 병합) — 아래 뮤테이션은
    // 혹시 모를 중복 대비 계산 방어일 뿐, upsert 키 중복은 실제로 발생하지 않는다.
    if (cur) cur.balance = next;
    upserts.push({
      streamer_id: streamer.id,
      viewer_key: g.viewer_key,
      // 닉네임은 현재 잔액 행 값 우선(적립 함수와 같은 규칙) — 옛 grant 의 닉네임으로 덮지 않는다.
      nickname: cur?.nickname ?? g.nickname,
      account_id: cur?.account_id ?? null,
      item_key: g.item_key,
      item_name: g.item_name,
      balance: next,
      updated_at: now,
    });
    eventRows.push({
      streamer_id: streamer.id,
      viewer_key: g.viewer_key,
      nickname: g.nickname,
      item_key: g.item_key,
      item_name: g.item_name,
      delta: next - prev,
      action_type: "adjust",
      previous_count: prev,
      next_count: next,
      // COUPON_AUTO_NOTE_PREFIX 로 시작하지 않는 note — autoAccruedSourceKeys(재적립 방어)가
      // 회수 이벤트를 적립 참조로 오독하지 않게 한다.
      note: `교환 되돌리기 회수 (exchange:${exchangeGroupId})`.slice(0, 500),
      created_by: "auto",
      created_at: now,
    });
    totalDelta += prev - next;
  }

  if (upserts.length > 0) {
    await supabaseFetch(
      `/${tableName("coupon_balances")}?on_conflict=streamer_id,viewer_key,item_key`,
      {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(upserts),
      },
    );
    await supabaseFetch(`/${tableName("coupon_events")}`, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify(eventRows),
    });
  }
  return { revoked: eventRows.length, totalDelta };
}

// ---------- 쿠폰 소급 적립 (2단계 조각 3: 과거 당첨을 쿠폰으로 소급) ----------
// 조각 2(computeCouponAccruals·accrueCouponsForRecords·autoAccruedSourceKeys)를 그대로 재사용한다.
// 핵심 아이디어: 저장된 record 당첨(mapEntry) 을 record ReconcileDecision 으로 "어댑트"하면
// 조각 2의 순수 계산(computeCouponAccruals)을 코드 복제 없이 재사용할 수 있다.
// 판정/entry/정가/applyResults 는 전혀 건드리지 않는 순수 추가 레인이다.

// 소급 계산에 필요한 저장된 record 당첨 행의 최소 형태(mapEntry 결과의 부분집합).
export type CouponBackfillEntry = {
  sourceKey: string;
  status: string;
  itemName: string;
  fanId: string;
  fanNickname: string;
  effectiveCount: number;
  donateTimeText: string;
};

export type CouponBackfillPeriod = { from?: string; to?: string };

export type CouponBackfillRow = {
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string;
  delta: number;
  entryCount: number; // 이 시청자·쿠폰에 기여한 당첨(sourceKey) 수
};

export type CouponBackfillPreview = {
  rows: CouponBackfillRow[];
  totalDelta: number; // 새로 적립될 쿠폰 총 개수
  totalEntries: number; // 적립에 기여한 당첨 수(합산)
  parseFailedCount: number; // 기간 지정 시 시각 해석 실패로 제외된 당첨 수
  consideredCount: number; // 기간·재적립제외 통과한 record 당첨 수
  alreadyAccruedCount: number; // 이미 자동 적립돼 제외된 당첨 수
  appliedPeriod: { from: string | null; to: string | null }; // 실제 적용된 기간(KST ISO), 미지정이면 null
};

// 저장된 record 당첨 행 → record ReconcileDecision 어댑터(순수).
// computeCouponAccruals 는 decision.decision / result.itemName / result.fanId /
// result.fanNickname / effectiveCount / sourceKey 만 읽으므로 그 필드만 채워 캐스팅한다
// (tests/coupon-accrual.test.ts 의 rec() 와 동일한 최소-필드 캐스팅 패턴).
export function couponBackfillEntryToDecision(entry: CouponBackfillEntry): ReconcileDecision {
  const result = {
    itemName: entry.itemName,
    fanId: entry.fanId,
    fanNickname: entry.fanNickname,
  } as unknown as NormalizedResult;
  const rawCount = Number(entry.effectiveCount ?? 1);
  return {
    sourceKey: entry.sourceKey,
    decision: "record",
    reason: "backfill",
    result,
    catalogItem: null,
    effectiveCount: Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1,
  } as unknown as ReconcileDecision;
}

// 기간 필터(순수). from/to 가 하나라도 주어지면 각 당첨의 donateTimeText 를 parseDonateTime 으로
// 해석(KST)해 범위(양끝 포함) 안만 통과. from/to 도 parseDonateTime 으로 해석하므로 datetime-local
// 입력("YYYY-MM-DDTHH:MM")을 KST 로 맞춰 비교한다(당첨 시각과 동일 기준). 해석 실패분(형식 불일치·빈
// 값)은 별도 카운트하고 기본 제외(후원집계 "시간 해석 실패 N건" 선례). from/to 둘 다 없으면 전체 통과.
export function filterCouponEntriesByPeriod<T extends { donateTimeText: string }>(
  entries: T[],
  period: CouponBackfillPeriod,
): { included: T[]; parseFailedCount: number; fromIso: string | null; toIso: string | null } {
  const fromIso = period.from ? parseDonateTime(period.from) : null;
  const toIso = period.to ? parseDonateTime(period.to) : null;
  const fromMs = fromIso ? Date.parse(fromIso) : null;
  const toMs = toIso ? Date.parse(toIso) : null;
  if (fromMs === null && toMs === null) {
    return { included: entries, parseFailedCount: 0, fromIso: null, toIso: null };
  }
  const included: T[] = [];
  let parseFailedCount = 0;
  for (const entry of entries) {
    const iso = parseDonateTime(entry.donateTimeText || "");
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ms)) {
      parseFailedCount++;
      continue;
    }
    if (fromMs !== null && ms < fromMs) continue;
    if (toMs !== null && ms > toMs) continue;
    included.push(entry);
  }
  return { included, parseFailedCount, fromIso, toIso };
}

// 소급 대상 record 당첨을 읽는다(status=record 만, 최신순). getStreamerState 와 동일한 upbo_entries
// 읽기 + mapEntry 매핑을 쓰되 소급에 필요한 필드만 추린다(슬러그는 불필요하므로 "" 전달).
async function recordEntriesForCouponBackfill(streamerId: string): Promise<CouponBackfillEntry[]> {
  const rows = await supabaseFetch<UpboEntryRow[]>(
    `/${tableName("upbo_entries")}?streamer_id=eq.${streamerId}&status=eq.record&select=*&order=created_at.desc&limit=5000`,
  );
  return rows.map((row) => {
    const e = mapEntry(row, "");
    return {
      sourceKey: e.sourceKey,
      status: e.status,
      itemName: e.itemName,
      fanId: e.fanId,
      fanNickname: e.fanNickname,
      effectiveCount: e.effectiveCount,
      donateTimeText: e.donateTimeText,
    };
  });
}

// 소급 계산 공통부(미리보기·반영이 같은 계산을 쓰도록 1곳으로). 저장은 하지 않는다.
async function computeCouponBackfill(
  streamer: StreamerRow,
  period: CouponBackfillPeriod,
): Promise<{ accruals: CouponAccrual[]; preview: CouponBackfillPreview }> {
  const [entries, sourceMap, couponItems, alreadyAccrued] = await Promise.all([
    recordEntriesForCouponBackfill(streamer.id),
    couponSourceMapForStreamer(streamer.id),
    couponItemsForStreamer(streamer.id),
    autoAccruedSourceKeys(streamer.id),
  ]);
  const { included, parseFailedCount, fromIso, toIso } = filterCouponEntriesByPeriod(entries, period);
  // 이미 자동 적립된 sourceKey 는 빼서 "새로 적립될 것"만 남긴다(조각 2 재적립 방지와 동일 참조).
  const fresh = alreadyAccrued.size
    ? included.filter((e) => !alreadyAccrued.has(cleanText(e.sourceKey)))
    : included;
  const alreadyAccruedCount = included.length - fresh.length;
  const decisions = fresh.map(couponBackfillEntryToDecision);
  const accruals = computeCouponAccruals(decisions, sourceMap, couponItems);
  const rows: CouponBackfillRow[] = accruals.map((a) => ({
    viewerKey: a.viewerKey,
    nickname: a.nickname,
    accountId: a.accountId,
    itemKey: a.itemKey,
    itemName: a.itemName,
    delta: a.delta,
    entryCount: a.sourceKeys.length,
  }));
  const totalDelta = rows.reduce((sum, r) => sum + r.delta, 0);
  const totalEntries = rows.reduce((sum, r) => sum + r.entryCount, 0);
  return {
    accruals,
    preview: {
      rows,
      totalDelta,
      totalEntries,
      parseFailedCount,
      consideredCount: fresh.length,
      alreadyAccruedCount,
      appliedPeriod: { from: fromIso, to: toIso },
    },
  };
}

// 미리보기: 저장하지 않고 대조표만 반환한다. balances/events 를 절대 쓰지 않는다.
export async function previewCouponBackfill(
  streamer: StreamerRow,
  period: CouponBackfillPeriod,
): Promise<CouponBackfillPreview> {
  const { preview } = await computeCouponBackfill(streamer, period);
  return preview;
}

// 반영: 같은 계산 후 accrueCouponsForRecords 로 실제 적립(created_by="auto",
// note→autoAccruedSourceKeys 재적립 방지 자동 작동). 화면 갱신용으로 최신 원장도 함께 반환한다.
export async function applyCouponBackfill(
  streamer: StreamerRow,
  period: CouponBackfillPeriod,
): Promise<
  { preview: CouponBackfillPreview; accrued: number; totalDelta: number } &
    Pick<CouponState, "balances" | "events">
> {
  const { accruals, preview } = await computeCouponBackfill(streamer, period);
  const result =
    accruals.length > 0
      ? await accrueCouponsForRecords(streamer, accruals)
      : { accrued: 0, totalDelta: 0 };
  const ledger = await couponLedgerForStreamer(streamer.id);
  return { preview, ...result, ...ledger };
}
