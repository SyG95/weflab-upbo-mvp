// ---------- 후원 시점 근사 판정의 입력 고르기(1단계 묶음 3, D3) — 순수 로직 ----------
//
// 왜 필요한가:
//   늦게 들어온 결과(확프 끊김·표 갱신 지연)는 "도착 시점"의 최신 표·사용 설정·기준으로 판정돼
//   검토함에 갇히거나 잘못 기록된다(10/24·9/16 검수 사례). 다시판정도 "지금 표"만 써서 못 푼다.
//   → 후원 시각 t 에 실제로 쓰였을 판정 입력(표 버전·사용 설정·기준확률 예외·전역 기준%·두배권 규칙)을
//     저장된 이력에서 골라 낸다. 판정 자체는 실시간과 같은 reconcileResults 를 그대로 부른다(여기서는 입력만).
//
// 규칙(PHASE1-DESIGN.md §5-1):
//   - 그때 표: captured_at < t 인 것 중 버전 번호 최대(수동기록 "그날 표"와 같은 규칙). 없으면 가장 옛 버전 + beforeFirst.
//   - 표 애매: 위플랩 수정시간(weflab_link_updated 의 lastModifiedText)부터 우리 수집 시각 사이의 후원은
//     위플랩은 이미 새 표로 돌렸는데 우리는 옛 표를 가진 구간이다. 이때는 결과의 (상품, 확률)로 맞는 버전을 고르고
//     "애매"로 표시한다. 수정시간을 모르는 버전(확프 수집)은 그때 표에 없고 다음 표에만 맞으면 다음 표 + 애매.
//   - 사용 설정: created_at < t 인 버전별 최신 저장본(빈 저장 {} 도 저장본) → 실시간과 같은 computeEffectiveOverrides.
//     승계 규칙 변경(5d8b9d2) 배포가 확인된 시각 전 후원은 근사.
//   - 기준확률 예외: t 이전 최신 스냅샷(2026-08-14 신설 전은 예외 없음). 전역 기준%: thresholdPercentAt 과 같은 규칙.
//   - 두배권: t 이전 확정 규칙 + t 이전에 같은 금액대·같은 이름으로 확정된 칸(옛 버전 칸은 확률만 달라 ruleKey 가 다르다).
//   - 리셋: 데이터 초기화(룰렛·확률표·화면 설정·비밀번호/링크 범위) 이전 후원은 따로 표시한다 — 화면 설정 리셋은
//     사용 설정·예외·두배권·정가 이력을, 비밀번호/링크 리셋은 위플랩 수정시간 이력을 지워 "그때" 재료가 사라진다.
//   - 결과마다 다시 계산하지 않게 이력은 한 번 정렬해 두고, 시각 찾기는 이진 탐색 + (버전, 이력 위치) 단위 캐시.
import * as crypto from "node:crypto";
import {
  applyThresholdOverrides,
  buildSpecialItemRuleCandidates,
  cleanText,
  cleanThresholdOverrides,
  findCatalogMatch,
  isMultiplierCandidateName,
  normalizeName,
  specialRuleKeyForItem,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type SpecialItemRule,
  type ThresholdOverrides,
} from "./upboCore";
import {
  parseThresholdHistoryRow,
  THRESHOLD_PERCENT_ACTION,
  type ThresholdBatchSnapshot,
  type ThresholdPercentAt,
  type ThresholdPercentHistoryEntry,
} from "./thresholdHistory";
import { parseDonateTimeMs, type CatalogGroup } from "./api";

export type UsageOverrides = Record<string, boolean>;

// 실시간 경로와 "같은" 사용 설정 계산 함수(upboSupabase.computeEffectiveOverrides·applyCatalogUsage)를 받는다.
// 이 모듈이 upboSupabase 를 직접 import 하면 upboSupabase → rejudge → judgeInputsAt → upboSupabase 순환이 생긴다.
export type UsageEngine = {
  computeEffectiveOverrides: (
    targetVersion: number,
    targetGroups: CatalogGroup[],
    usageByVersion: Record<number, UsageOverrides>,
    groupsByVersion: Record<number, CatalogGroup[]>,
  ) => UsageOverrides;
  applyCatalogUsage: (items: NormalizedCatalogItem[], overrides: UsageOverrides) => NormalizedCatalogItem[];
};

// 승계 규칙이 "저장본이 전부"로 바뀐 커밋(5d8b9d2)은 2026-08-30 11:59 KST 지만 배포 시각은 기록이 없다.
// 이 커밋을 담은 배포가 확인되는 첫 태그(deploy-20260917-1027, 09:23 KST) 전 후원은 근사로 본다(보수적).
// Vercel 배포 이력으로 실제 배포 시각이 확인되면 앞당긴다.
export const USAGE_RULE_EXACT_FROM_MS = Date.parse("2026-09-17T09:23:06+09:00");
// 금액대별 기준확률 예외 신설(2026-08-14). 그 전 후원은 "예외 없음"이 정답.
export const THRESHOLD_OVERRIDES_FROM_MS = Date.parse("2026-08-14T00:00:00+09:00");

export const DONATION_TIME_AUDIT_ACTIONS = [
  "catalog_usage_updated",
  "threshold_overrides_updated",
  THRESHOLD_PERCENT_ACTION,
  "special_item_rule",
  "data_reset",
  "weflab_link_updated",
  "signature_counts_updated",
] as const;

// "그때" 재료를 지우는 데이터 초기화 범위(lib/upboSupabase.ts resetTargets). 후원집계·쿠폰만 지운 초기화는 무관.
const RESET_SCOPES_THAT_ERASE_HISTORY = ["roulette", "catalogs", "screenState", "pins"] as const;

// DB 에서 한 번에 읽은 재료(모양 그대로).
export type JudgeHistoryRaw = {
  catalogs: Array<{ id?: string; version: number; captured_at?: string | null; created_at?: string | null; groups: unknown }>;
  audits: Array<{ id: string; action: string; created_at: string; payload: unknown }>;
  batches: Array<{ id?: string; applied_at?: string | null; threshold_percent?: number | string | null }>;
  currentThresholdPercent: number;
};

export type JudgeCatalog = {
  version: number;
  capturedAt: string | null;
  capturedMs: number | null;
  groups: CatalogGroup[];
  items: NormalizedCatalogItem[];
};

export type UsageEvent = { id: string; atMs: number; createdAt: string; catalogVersion: number; overrides: UsageOverrides };
export type OverridesEvent = { id: string; atMs: number; overrides: ThresholdOverrides };
export type RuleEvent = { id: string; atMs: number; rule: SpecialItemRule };
export type LinkEvent = { id: string; atMs: number; fetchedMs: number | null; modifiedText: string; modifiedMs: number | null };
export type AmbiguityWindow = { fromMs: number; toMs: number; version: number; modifiedText: string };

export type JudgeHistory = {
  catalogs: JudgeCatalog[]; // 버전 오름차순
  groupsByVersion: Record<number, CatalogGroup[]>;
  usage: UsageEvent[]; // 아래 이벤트 목록은 전부 시각 오름차순
  overrides: OverridesEvent[];
  thresholdHistory: ThresholdPercentHistoryEntry[];
  thresholdHistoryIds: string[];
  thresholdBatches: ThresholdBatchSnapshot[];
  currentThreshold: number;
  rules: RuleEvent[];
  resets: Array<{ id: string; atMs: number }>;
  links: LinkEvent[];
  windows: AmbiguityWindow[];
  // 정가로 등록된 적이 있는 갯수 전부(signature_counts_updated 이력) — G8 은 "그때 또는 언젠가 정가"면 🟡.
  fixedAmountsEver: Set<number>;
  fixedEventIds: string[];
  cache: {
    usage: Map<string, UsageAt>;
    items: Map<string, NormalizedCatalogItem[]>;
    rules: Map<string, SpecialItemRule[]>;
    threshold: Map<string, ThresholdPercentAt>;
  };
  // 이진 탐색용 시각 배열(위 목록과 같은 순서)
  usageMs: number[];
  overridesMs: number[];
  rulesMs: number[];
  thresholdHistoryMs: number[];
  batchMs: number[];
};

function ms(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

function payloadOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanUsage(raw: unknown): UsageOverrides {
  const out: UsageOverrides = {};
  for (const [key, value] of Object.entries(payloadOf(raw))) {
    if (/^g\d+(-i\d+)?$/.test(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

// sorted 안에서 값이 tMs 보다 작은(inclusive=true 면 작거나 같은) 원소 수.
function countBefore(sorted: number[], tMs: number, inclusive = false): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < tMs || (inclusive && sorted[mid] === tMs)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const KST_OFFSET_MS = 9 * 3_600_000;

// 후원 시각 글자 → epoch ms. parseDonateTimeMs 는 모양만 보고 Date.parse 에 맡겨 "2026-02-30" 을 3/2 로 굴린다 —
// 근사 판정에서는 그런 값을 "시각을 못 읽음"(G9)으로 다뤄야 하므로 KST 로 되돌려 글자와 같은지 다시 확인한다.
export function parseDonateTimeMsStrict(text: string | null | undefined): number | null {
  const value = parseDonateTimeMs(text);
  if (value === null) return null;
  const m = cleanText(text).match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const d = new Date(value + KST_OFFSET_MS);
  const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const same =
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5]) &&
    d.getUTCSeconds() === Number(m[6] ?? 0);
  return same ? value : null;
}

// 두배권처럼 보이는 이름. 실시간 후보 탐지(isMultiplierCandidateName)보다 넓게 본다 — 여기서는 🟡 로 올리는 데만
// 쓰므로 넓게 잡아도 안전하다("다음 룰렛 ×2", "*2", "두배 찬스", "더블 찬스", "2x", 3배 계열 등).
export function looksLikeMultiplierName(value: unknown): boolean {
  if (isMultiplierCandidateName(value)) return true;
  const text = cleanText(value).toLowerCase();
  // "세배"는 설날 리액션 이름일 수 있어 넣지 않는다(두배권이 아니면 스트리머 전체가 🟡 가 된다).
  return /두\s*배|[23]\s*배|[x×✕✖*]\s*[23](?!\d)|(?<!\d)[23]\s*[x×✕✖]|더\s*블|트\s*리\s*플|double|triple|배\s*수/.test(text);
}

// "2026년 09월 07일 04시 14분 28초"(위플랩 공개 페이지 "수정시간은 …") → "2026-09-07T04:14:28+09:00". 모양이 다르면 null.
export function parseWeflabModifiedAtIso(text: string | null | undefined): string | null {
  const m = cleanText(text).match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(\d{1,2})\s*시\s*(\d{1,2})\s*분(?:\s*(\d{1,2})\s*초)?/);
  if (!m) return null;
  const pad = (v: string | undefined) => String(v ?? "0").padStart(2, "0");
  const iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${pad(m[5])}:${pad(m[6])}+09:00`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  // Date.parse 가 넘친 값(13월·32일)을 다음 달로 굴리지 않았는지 다시 확인한다.
  const back = new Date(t + KST_OFFSET_MS).toISOString().slice(0, 19);
  return back === iso.slice(0, 19) ? iso : null;
}

function catalogItemsOf(groups: CatalogGroup[]): NormalizedCatalogItem[] {
  // 저장된 groups 는 normalizeCatalogCapture 결과라 items 를 그대로 펼치면 catalogs.items 와 같다(upboCore:290).
  return groups.flatMap((group) =>
    ((group.items ?? []) as unknown as NormalizedCatalogItem[]).map((item) =>
      item.normalizedName ? item : { ...item, normalizedName: normalizeName(item.itemName) },
    ),
  );
}

// 그때 표: captured_at < t 인 버전 중 번호 최대. 없으면 가장 옛 버전 + beforeFirst. 표가 하나도 없으면 null.
export function catalogAt(
  tMs: number,
  catalogs: Array<Pick<JudgeCatalog, "version" | "capturedAt" | "capturedMs">>,
): { version: number; capturedAt: string | null; beforeFirst: boolean } | null {
  if (catalogs.length === 0) return null;
  let best: (typeof catalogs)[number] | null = null;
  for (const c of catalogs) {
    if (c.capturedMs !== null && c.capturedMs < tMs && (!best || c.version > best.version)) best = c;
  }
  if (best) return { version: best.version, capturedAt: best.capturedAt, beforeFirst: false };
  const first = catalogs.reduce((min, c) => (c.version < min.version ? c : min), catalogs[0]);
  return { version: first.version, capturedAt: first.capturedAt, beforeFirst: true };
}

// 위플랩 수정시간 ~ 우리가 그 내용을 처음 가져온 시각 = "표 애매" 구간. 같은 수정시간 글자를 여러 번 가져왔으면
// 처음 본 시각까지만 애매하다(그 뒤로는 우리 표가 이미 그 내용). 구간의 version = 그 가져오기로 생긴(또는 재사용된) 버전.
export function ambiguityWindows(
  catalogs: Array<Pick<JudgeCatalog, "version" | "capturedAt" | "capturedMs">>,
  links: LinkEvent[],
): AmbiguityWindow[] {
  const firstSeen = new Map<string, { fetchedMs: number; modifiedMs: number }>();
  for (const link of links) {
    if (link.modifiedMs === null || !link.modifiedText) continue;
    const fetchedMs = link.fetchedMs ?? link.atMs;
    const prev = firstSeen.get(link.modifiedText);
    if (!prev || fetchedMs < prev.fetchedMs) firstSeen.set(link.modifiedText, { fetchedMs, modifiedMs: link.modifiedMs });
  }
  const windows: AmbiguityWindow[] = [];
  for (const [modifiedText, { fetchedMs, modifiedMs }] of firstSeen) {
    if (modifiedMs >= fetchedMs) continue;
    // 저장된 표의 captured_at 은 가져오기 기록(lastFetchedAt)보다 조금 앞선다 → 1초 여유로 그 버전을 잡는다.
    const at = catalogAt(fetchedMs + 1_000, catalogs);
    if (!at || at.beforeFirst) continue;
    windows.push({ fromMs: modifiedMs, toMs: fetchedMs, version: at.version, modifiedText });
  }
  return windows.sort((a, b) => a.fromMs - b.fromMs);
}

export function buildJudgeHistory(raw: JudgeHistoryRaw): JudgeHistory {
  const catalogs: JudgeCatalog[] = raw.catalogs
    .map((row) => {
      const groups = (Array.isArray(row.groups) ? row.groups : []) as CatalogGroup[];
      const capturedAt = row.captured_at ?? row.created_at ?? null;
      return { version: Number(row.version), capturedAt, capturedMs: ms(capturedAt), groups, items: catalogItemsOf(groups) };
    })
    .filter((c) => Number.isFinite(c.version))
    .sort((a, b) => a.version - b.version);
  const groupsByVersion: Record<number, CatalogGroup[]> = {};
  for (const c of catalogs) groupsByVersion[c.version] = c.groups;

  const audits = [...raw.audits]
    .filter((a) => ms(a.created_at) !== null)
    .sort((a, b) => (ms(a.created_at)! - ms(b.created_at)!) || String(a.id).localeCompare(String(b.id)));
  const usage: UsageEvent[] = [];
  const overrides: OverridesEvent[] = [];
  const thresholdHistory: ThresholdPercentHistoryEntry[] = [];
  const thresholdHistoryIds: string[] = [];
  const rules: RuleEvent[] = [];
  const resets: Array<{ id: string; atMs: number }> = [];
  const links: LinkEvent[] = [];
  const fixedAmountsEver = new Set<number>();
  const fixedEventIds: string[] = [];
  for (const a of audits) {
    const atMs = ms(a.created_at)!;
    const p = payloadOf(a.payload);
    if (a.action === "catalog_usage_updated") {
      const v = Number(p.catalogVersion);
      if (Number.isFinite(v)) usage.push({ id: a.id, atMs, createdAt: a.created_at, catalogVersion: v, overrides: cleanUsage(p.overrides) });
    } else if (a.action === "threshold_overrides_updated") {
      overrides.push({ id: a.id, atMs, overrides: cleanThresholdOverrides(p.overrides) });
    } else if (a.action === THRESHOLD_PERCENT_ACTION) {
      const entry = parseThresholdHistoryRow({ created_at: a.created_at, payload: a.payload });
      if (entry) {
        thresholdHistory.push(entry);
        thresholdHistoryIds.push(a.id);
      }
    } else if (a.action === "special_item_rule") {
      const rule = payloadOf(p.rule) as Partial<SpecialItemRule>;
      if (typeof rule.ruleKey === "string" && rule.ruleKey) rules.push({ id: a.id, atMs, rule: rule as SpecialItemRule });
    } else if (a.action === "data_reset") {
      const scope = payloadOf(p.scope);
      if (RESET_SCOPES_THAT_ERASE_HISTORY.some((key) => scope[key] === true)) resets.push({ id: a.id, atMs });
    } else if (a.action === "weflab_link_updated") {
      const link = payloadOf(p.link);
      const modifiedText = typeof link.lastModifiedText === "string" ? link.lastModifiedText : "";
      links.push({
        id: a.id,
        atMs,
        fetchedMs: ms(link.lastFetchedAt),
        modifiedText,
        modifiedMs: ms(parseWeflabModifiedAtIso(modifiedText)),
      });
    } else if (a.action === "signature_counts_updated") {
      fixedEventIds.push(a.id);
      for (const value of Array.isArray(p.counts) ? p.counts : []) {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) fixedAmountsEver.add(n);
      }
    }
  }
  const thresholdBatches: ThresholdBatchSnapshot[] = raw.batches
    .map((b) => ({ appliedAt: String(b.applied_at ?? ""), thresholdPercent: Number(b.threshold_percent) }))
    .filter((b) => ms(b.appliedAt) !== null && Number.isFinite(b.thresholdPercent))
    .sort((a, b) => Date.parse(a.appliedAt) - Date.parse(b.appliedAt));
  return {
    catalogs,
    groupsByVersion,
    usage,
    overrides,
    thresholdHistory,
    thresholdHistoryIds,
    thresholdBatches,
    currentThreshold: Number(raw.currentThresholdPercent),
    rules,
    resets,
    links,
    windows: ambiguityWindows(catalogs, links),
    fixedAmountsEver,
    fixedEventIds,
    cache: { usage: new Map(), items: new Map(), rules: new Map(), threshold: new Map() },
    usageMs: usage.map((e) => e.atMs),
    overridesMs: overrides.map((e) => e.atMs),
    rulesMs: rules.map((e) => e.atMs),
    thresholdHistoryMs: thresholdHistory.map((h) => Date.parse(h.at)),
    batchMs: thresholdBatches.map((b) => Date.parse(b.appliedAt)),
  };
}

export type UsageAtVersion = { found: true; eventId: string; createdAt: string; overrides: UsageOverrides };

// created_at < t 인 버전별 최신 저장본. 빈 저장 {} 도 저장본(found)이다 — 저장은 "전체 교체"라 {} 는
// "전부 위플랩 값으로"라는 뜻이고, 승계를 다시 깔면 안 된다(F4·헤르메스 2). 맵에 없는 버전 = 저장 없음(승계 대상).
export function usageByVersionAt(events: UsageEvent[], tMs: number): Map<number, UsageAtVersion> {
  const out = new Map<number, UsageAtVersion>();
  for (const e of events) {
    if (e.atMs >= tMs) continue;
    const prev = out.get(e.catalogVersion);
    if (!prev || Date.parse(prev.createdAt) <= e.atMs) {
      out.set(e.catalogVersion, { found: true, eventId: e.id, createdAt: e.createdAt, overrides: e.overrides });
    }
  }
  return out;
}

export type UsageAt = {
  overrides: UsageOverrides;
  source: "own" | "carry" | "none";
  eventId: string | null;
  approximate: boolean;
};

// 후원 시각 t 에 이 버전에 적용됐을 사용 설정. 계산은 실시간과 같은 computeEffectiveOverrides 가 한다.
// 같은 (버전, t 이전 저장 수)면 답이 같으므로 캐시한다(근사 여부만 t 로 따로 정한다).
export function usageAt(tMs: number, version: number, history: JudgeHistory, engine: UsageEngine): UsageAt {
  const approximate = tMs < USAGE_RULE_EXACT_FROM_MS;
  const key = `${version}|${countBefore(history.usageMs, tMs)}`;
  const cached = history.cache.usage.get(key);
  if (cached) return { ...cached, approximate };
  const map = usageByVersionAt(history.usage, tMs);
  const record: Record<number, UsageOverrides> = {};
  for (const [v, u] of map) record[v] = u.overrides;
  const overrides = engine.computeEffectiveOverrides(version, history.groupsByVersion[version] ?? [], record, history.groupsByVersion);
  const own = map.get(version);
  let out: UsageAt;
  if (own) out = { overrides, source: "own", eventId: own.eventId, approximate };
  else {
    // computeEffectiveOverrides 와 같은 순서로 승계 출처를 찾는다(설정 있는 직전 버전 중 groups 가 있는 가장 최신 1개).
    const prior = [...map.keys()]
      .filter((v) => v < version && Object.keys(record[v] ?? {}).length > 0 && history.groupsByVersion[v])
      .sort((a, b) => b - a)[0];
    out =
      prior !== undefined
        ? { overrides, source: "carry", eventId: map.get(prior)!.eventId, approximate }
        : { overrides, source: "none", eventId: null, approximate };
  }
  history.cache.usage.set(key, out);
  return out;
}

// 후원 시각 t 의 금액대별 기준확률 예외(t 이전 최신 스냅샷). 신설(8/14) 전 후원은 예외 없음.
export function thresholdOverridesAt(tMs: number, events: OverridesEvent[]): { overrides: ThresholdOverrides; eventId: string | null } {
  if (tMs < THRESHOLD_OVERRIDES_FROM_MS) return { overrides: {}, eventId: null };
  let picked: OverridesEvent | null = null;
  for (const e of events) {
    if (e.atMs < tMs) picked = e;
    else break;
  }
  return picked ? { overrides: picked.overrides, eventId: picked.id } : { overrides: {}, eventId: null };
}

function overridesAtFast(tMs: number, history: JudgeHistory): { overrides: ThresholdOverrides; eventId: string | null } {
  if (tMs < THRESHOLD_OVERRIDES_FROM_MS) return { overrides: {}, eventId: null };
  const picked = history.overrides[countBefore(history.overridesMs, tMs) - 1];
  return picked ? { overrides: picked.overrides, eventId: picked.id } : { overrides: {}, eventId: null };
}

const EPSILON = 1e-9;
function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return Math.abs(a - b) < EPSILON;
}

// thresholdPercentAt(lib/thresholdHistory.ts)과 같은 규칙을 정렬해 둔 이력으로 계산한다(결과마다 정렬하지 않게).
// 같은 값이 나오는지는 tests/judge-inputs-at.test.ts 가 무작위 시각으로 맞대 본다.
export function thresholdPercentAtFast(tMs: number, history: JudgeHistory): ThresholdPercentAt {
  const hIndex = countBefore(history.thresholdHistoryMs, tMs) - 1;
  const bIndex = countBefore(history.batchMs, tMs, true) - 1;
  const key = `${hIndex}|${hIndex >= 0 ? "" : bIndex}`;
  const cached = history.cache.threshold.get(key);
  if (cached) return cached;
  let out: ThresholdPercentAt;
  if (hIndex >= 0) {
    const picked = history.thresholdHistory[hIndex];
    const next = history.thresholdHistory[hIndex + 1];
    const exact = next ? next.before !== null && sameNumber(next.before, picked.after) : sameNumber(picked.after, history.currentThreshold);
    out = { value: picked.after, exact, source: "history" };
  } else if (bIndex >= 0) {
    out = { value: history.thresholdBatches[bIndex].thresholdPercent, exact: false, source: "batch" };
  } else {
    out = { value: history.currentThreshold, exact: false, source: "current" };
  }
  history.cache.threshold.set(key, out);
  return out;
}

function latestRuleByKey(events: RuleEvent[], untilMs: number): Map<string, SpecialItemRule> {
  const out = new Map<string, SpecialItemRule>();
  for (const e of events) if (e.atMs < untilMs) out.set(e.rule.ruleKey, e.rule);
  return out;
}

function labelNameKey(amountRangeLabel: unknown, normalizedName: unknown): string {
  return `${cleanText(amountRangeLabel)}::${cleanText(normalizedName)}`;
}

// 후원 시각 t 에 이 버전 칸들에 적용할 두배권 규칙(reconcileResults 의 specialItemRules 로 넘긴다).
//   - t 이전에 그 칸의 ruleKey 로 확정된 규칙
//   - 옛 버전 칸은 확률만 달라 ruleKey 가 다르다 → t 이전에 같은 금액대·같은 정규화 이름이 확정(그 이름의 마지막 상태)이면 두배권
//   t 뒤에 확정된 것은 쓰지 않는다(명세 "t 이전"). 그런 칸은 이름이 두배권 같으면 G7 로 🟡 가 된다.
export function specialRulesAt(tMs: number, events: RuleEvent[], versionItems: NormalizedCatalogItem[]): SpecialItemRule[] {
  const before = latestRuleByKey(events, tMs);
  const nameRule = new Map<string, SpecialItemRule>();
  for (const e of events) {
    if (e.atMs >= tMs) break;
    nameRule.set(labelNameKey(e.rule.amountRangeLabel, e.rule.normalizedName || normalizeName(e.rule.itemName)), e.rule);
  }
  // 같은 버전에 같은 금액대·이름 칸이 여럿이고 그중 한 칸만 (키로) 따로 정해 뒀다면, 나머지 칸은 스트리머가 일부러
  // 남긴 것일 수 있다 → 그 버전에서는 이름으로 넓히지 않는다(두배권 ⚪ 대신 기록 후보 🟡 로 보이게).
  const decidedInVersion = new Set<string>();
  for (const item of versionItems) {
    if (before.has(specialRuleKeyForItem(item))) decidedInVersion.add(labelNameKey(item.amountRangeLabel, item.normalizedName));
  }
  const confirmedByName = (label: unknown, name: unknown) => {
    if (decidedInVersion.has(labelNameKey(label, name))) return null;
    const rule = nameRule.get(labelNameKey(label, name));
    return rule?.status === "confirmed" ? rule : null;
  };
  const candidates = buildSpecialItemRuleCandidates(versionItems, [...before.values()]).map((rule) =>
    rule.status === "candidate" && confirmedByName(rule.amountRangeLabel, rule.normalizedName)
      ? { ...rule, status: "confirmed" as const }
      : rule,
  );
  // 실시간 후보 탐지(isMultiplierCandidateName)가 못 알아보는 이름으로 확정된 칸은 후보 목록에 아예 안 올라온다 →
  // 옛 버전 칸(확률만 달라 ruleKey 가 다름)도 이름으로 맞으면 근사 판정 전용 확정 규칙을 만들어 준다.
  const known = new Set(candidates.map((rule) => rule.ruleKey));
  for (const item of versionItems) {
    const ruleKey = specialRuleKeyForItem(item);
    if (known.has(ruleKey)) continue;
    const named = confirmedByName(item.amountRangeLabel, item.normalizedName);
    if (!named) continue;
    known.add(ruleKey);
    candidates.push({
      ruleKey,
      ruleType: "next_result_multiplier",
      status: "confirmed",
      multiplier: Math.max(2, Number(named.multiplier || 2)),
      groupIndex: item.groupIndex,
      amountRangeLabel: item.amountRangeLabel,
      itemName: item.itemName,
      normalizedName: item.normalizedName,
      probability: item.probability,
      itemEnabled: item.enabled !== false,
    });
  }
  return candidates;
}

// 표 전체를 볼 때 쓰는 이름 검사: 낱말형(두배·2배·더블·트리플)과, "×2" 표기는 룰렛·다음·권 같은 말과 함께일 때만 본다.
// "손편지 x3"·"사진 ×2" 같은 수량 표기까지 넣으면 그런 상품 하나 때문에 그 스트리머 행이 전부 🟡 가 된다(리뷰 2026-10-27).
// 결과 자체의 이름은 looksLikeMultiplierName 으로 넓게 본다.
function looksLikeMultiplierWord(value: unknown): boolean {
  if (isMultiplierCandidateName(value)) return true;
  const text = cleanText(value).toLowerCase();
  if (/두\s*배|[23]\s*배|더\s*블|트\s*리\s*플|double|triple/.test(text)) return true;
  return /[x×✕✖*]\s*[23](?!\d)|(?<!\d)[23]\s*[x×✕✖]/.test(text) && /룰렛|다음|next|권|보상/.test(text);
}

// 이 스트리머에 두배권 칸·확정 규칙이 하나라도 있었나(G7 초기 정책: 있으면 🟢 금지).
export function hasMultiplierCells(history: JudgeHistory): boolean {
  if (history.rules.some((e) => e.rule.status === "confirmed")) return true;
  return history.catalogs.some((c) => c.items.some((item) => looksLikeMultiplierWord(item.itemName)));
}

export function lastResetMs(history: JudgeHistory): number | null {
  return history.resets.length ? Math.max(...history.resets.map((r) => r.atMs)) : null;
}

// 전역 기준%가 근사일 때 "판정이 안 뒤집히는지" 볼 후보값들(이력의 전후 값·배치 스냅샷·지금 값).
export function thresholdPercentCandidates(history: JudgeHistory): number[] {
  const values = new Set<number>([history.currentThreshold]);
  for (const h of history.thresholdHistory) {
    values.add(h.after);
    if (h.before !== null) values.add(h.before);
  }
  for (const b of history.thresholdBatches) values.add(b.thresholdPercent);
  return [...values].filter((v) => Number.isFinite(v));
}

export type VersionInputsAt = {
  version: number;
  items: NormalizedCatalogItem[]; // 그때 사용 설정 + 그때 기준확률 예외를 얹은 판정용 목록(꺼진 칸 포함)
  usage: { source: UsageAt["source"]; eventId: string | null; approximate: boolean };
  thresholdPercent: ThresholdPercentAt;
  thresholdOverridesEventId: string | null;
  specialRules: SpecialItemRule[];
};

export type JudgeInputsAt = VersionInputsAt & {
  capturedAt: string | null;
  beforeFirst: boolean;
  tableAmbiguous: boolean;
  ambiguity: "window" | "next_version" | "before_first" | null;
  preReset: boolean;
};

function rawItemsOf(history: JudgeHistory, version: number): NormalizedCatalogItem[] {
  return history.catalogs.find((c) => c.version === version)?.items ?? [];
}

// 정해진 버전에 대해 후원 시각 t 의 판정 입력(사용 설정·예외·기준%·두배권). 결과마다 같은 걸 다시 만들지 않게 캐시한다.
export function versionInputsAt(tMs: number, version: number, history: JudgeHistory, engine: UsageEngine): VersionInputsAt {
  const usage = usageAt(tMs, version, history, engine);
  const overrides = overridesAtFast(tMs, history);
  const itemsKey = `${version}|${usage.source}|${usage.eventId ?? ""}|${overrides.eventId ?? ""}`;
  let items = history.cache.items.get(itemsKey);
  if (!items) {
    items = applyThresholdOverrides(engine.applyCatalogUsage(rawItemsOf(history, version), usage.overrides), overrides.overrides);
    history.cache.items.set(itemsKey, items);
  }
  const rulesKey = `${itemsKey}|${countBefore(history.rulesMs, tMs)}`;
  let specialRules = history.cache.rules.get(rulesKey);
  if (!specialRules) {
    specialRules = specialRulesAt(tMs, history.rules, items);
    history.cache.rules.set(rulesKey, specialRules);
  }
  return {
    version,
    items,
    usage: { source: usage.source, eventId: usage.eventId, approximate: usage.approximate },
    thresholdPercent: thresholdPercentAtFast(tMs, history),
    thresholdOverridesEventId: overrides.eventId,
    specialRules,
  };
}

// 그 결과의 (상품, 확률, 금액)이 이 버전의 칸에 있나(꺼진 칸 포함).
export function resultMatchesVersion(probe: NormalizedResult, version: number, history: JudgeHistory): boolean {
  return findCatalogMatch(probe, rawItemsOf(history, version), { includeDisabled: true }) !== null;
}

// 후원 시각 t 의 판정 입력 한 벌. probe(그 결과 자체)를 주면 표 애매 구간에서 (상품, 확률)로 버전을 고른다.
export function pickJudgeInputsAt(
  tMs: number,
  history: JudgeHistory,
  engine: UsageEngine,
  probe?: NormalizedResult,
): JudgeInputsAt | null {
  const base = catalogAt(tMs, history.catalogs);
  if (!base) return null;
  let version = base.version;
  let ambiguity: JudgeInputsAt["ambiguity"] = base.beforeFirst ? "before_first" : null;
  const inWindow = history.windows.filter((w) => tMs >= w.fromMs && tMs < w.toMs && w.version !== base.version);
  if (inWindow.length > 0) ambiguity = "window";
  if (probe && !resultMatchesVersion(probe, base.version, history)) {
    const alt = inWindow.find((w) => resultMatchesVersion(probe, w.version, history))?.version;
    if (alt !== undefined) {
      version = alt;
    } else if (inWindow.length === 0) {
      // 수정시간을 모르는(확프로 수집한) 표 교체: 그때 표엔 없고 바로 다음 표에만 맞으면 다음 표가 쓰였을 가능성이 크다.
      const next = history.catalogs.find((c) => c.version > base.version);
      if (next && resultMatchesVersion(probe, next.version, history)) {
        version = next.version;
        ambiguity = "next_version";
      }
    }
  }
  const reset = lastResetMs(history);
  return {
    ...versionInputsAt(tMs, version, history, engine),
    capturedAt: history.catalogs.find((c) => c.version === version)?.capturedAt ?? null,
    beforeFirst: base.beforeFirst,
    tableAmbiguous: ambiguity !== null,
    ambiguity,
    preReset: reset !== null && tMs <= reset,
  };
}

// "지금 표로" 판정 입력(현행 다시판정과 같은 재료: 최신 버전·최신 사용 설정·최신 예외·지금 기준%·최신 두배권 규칙).
export function currentJudgeInputs(
  history: JudgeHistory,
  engine: UsageEngine,
): { version: number; items: NormalizedCatalogItem[]; thresholdPercent: number; specialRules: SpecialItemRule[] } | null {
  const latest = history.catalogs.at(-1);
  if (!latest) return null;
  const forever = Number.POSITIVE_INFINITY;
  const usage = usageAt(forever, latest.version, history, engine);
  const overrides = thresholdOverridesAt(forever, history.overrides);
  const items = applyThresholdOverrides(engine.applyCatalogUsage(latest.items, usage.overrides), overrides.overrides);
  return {
    version: latest.version,
    items,
    thresholdPercent: history.currentThreshold,
    specialRules: buildSpecialItemRuleCandidates(items, [...latestRuleByKey(history.rules, forever).values()]),
  };
}

// 팬 화면이 쓰는 사용 설정 맵을 getStreamerState 와 같은 규칙으로 만든다(F5): 최근 200건 안의 버전별 최신 저장본,
// 그리고 최신 버전만 승계까지 반영. "넣어도 팬 화면엔 안 보여요" 꼬리표가 팬 화면과 같은 답을 내게 한다.
export function fanUsageByVersionLikeState(history: JudgeHistory, engine: UsageEngine): Record<number, UsageOverrides> {
  const byVersion: Record<number, UsageOverrides> = {};
  const recent = [...history.usage].sort((a, b) => b.atMs - a.atMs || b.id.localeCompare(a.id)).slice(0, 200);
  for (const e of recent) {
    if (byVersion[e.catalogVersion] === undefined) byVersion[e.catalogVersion] = e.overrides;
  }
  const latest = history.catalogs.at(-1);
  if (latest) {
    byVersion[latest.version] = engine.computeEffectiveOverrides(latest.version, latest.groups, byVersion, history.groupsByVersion);
  }
  return byVersion;
}

// 판정 입력 지문: 쓴 이벤트 id·버전 목록·지금 기준 + 호출자가 주는 재료(별칭·수동기록·원본 묶음 상태)가 하나라도
// 바뀌면 달라진다(묶음 4 넣기의 409 "다시 미리보기" 근거).
export function judgeInputFingerprint(history: JudgeHistory, extra: Record<string, unknown>): string {
  const sortedJson = (value: unknown): string =>
    JSON.stringify(value, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
        : v,
    );
  const lastBatch = history.thresholdBatches.at(-1)?.appliedAt ?? "";
  const material = {
    catalogs: history.catalogs.map((c) => [c.version, c.capturedAt]),
    usage: history.usage.map((e) => e.id),
    overrides: history.overrides.map((e) => e.id),
    threshold: history.thresholdHistoryIds,
    rules: history.rules.map((e) => e.id),
    resets: history.resets.map((e) => e.id),
    links: history.links.map((e) => e.id),
    fixed: history.fixedEventIds,
    batches: [history.thresholdBatches.length, lastBatch],
    current: history.currentThreshold,
    extra,
  };
  return crypto.createHash("sha1").update(sortedJson(material)).digest("hex").slice(0, 16);
}
