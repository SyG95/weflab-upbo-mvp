import { isMissionSettlementType } from "./upboCore";

// 후원집계(donation counter) 전용 레인.
//
// 설계 원칙 (sy 승인, 2026-07-07):
// - 업보 파이프라인(upbo_entries / reconcile / 정가 / 배수)을 읽지도 쓰지도 않는다.
//   업보에 기록된 후원도 후원이므로 교차 필터 없이 전부 카운트한다(양방향 무간섭).
// - 후원 1건 = 1행. 확장이 같은 행을 반복 전송해도 unique(streamer_id, dedup_key)
//   upsert(ignore-duplicates)로 흡수하므로 재스캔·백필이 안전하다.
// - donate_time 은 위플랩 표시 시각("YYYY-MM-DD HH:MM:SS", 서버 KST)을 +09:00 로 고정
//   해석한다. 해석 실패 시 원문(donate_time_text)만 남기고 시간 필터에서는 빠진다.
//
// upboSupabase.ts 의 supabaseFetch 는 비공개(모듈 내부)라 같은 패턴을 여기 복제했다.
// 보호 원칙상 기존 core 파일은 수정하지 않는다.

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_PREFIX = process.env.UPBO_TABLE_PREFIX || "";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // v0.1 가드: 최대 5만 행까지 집계 (초과 시 잘린 값이 아니라 오류로 알린다)

function donationTable(): string {
  return `${TABLE_PREFIX}donation_events`;
}

function assertSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
}

async function donationFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export type DonationCaptureRow = {
  sourceUid?: string;
  platform?: string;
  donateTimeText?: string;
  donationType?: string;
  donationAmount?: number | null;
  donationAmountText?: string;
  fanNickname?: string;
  fanId?: string;
  hasRoulette?: boolean;
};

export type DonationCapture = {
  type?: string;
  collectorSessionId?: string;
  sourceUrl?: string;
  capturedAt?: string;
  coverageRangeText?: string;
  // 확프(chrome.runtime.getManifest().version, 예 "0.2.3")가 전송 payload에 담아 보내는 값.
  // results/catalogs 통로는 raw_imports.raw 에 통째 저장돼 자동 보존되지만, donations 통로는
  // raw 를 저장하지 않아 여기서 별도로 audit_logs 에 남긴다(recordDonationClientVersion).
  clientVersion?: string;
  rows?: DonationCaptureRow[];
};

export type DonationIngestSummary = {
  received: number;
  accepted: number;
  inserted: number;
  duplicates: number;
  skipped: number;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toAmount(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

// "YYYY-MM-DD HH:MM(:SS)" (위플랩 서버 표시, KST) → ISO(+09:00). 실패 시 null.
export function parseDonateTime(text: string): string | null {
  const match = cleanText(text).match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const pad = (v: string) => v.padStart(2, "0");
  const iso = `${year}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${pad(match[5])}:${pad(match[6] || "0")}+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// 확장 content.js 의 dedupKey 와 같은 규칙. 서버에서도 재계산해 신뢰 경계를 서버에 둔다.
export function donationDedupKey(row: DonationCaptureRow): string {
  const uid = cleanText(row.sourceUid);
  if (uid) return `uid::${uid}`;
  const who = cleanText(row.fanId) || cleanText(row.fanNickname);
  const time = cleanText(row.donateTimeText);
  if (!who || !time) return "";
  const amount = row.donationAmount ?? cleanText(row.donationType);
  return `don::${who}::${time}::${amount}`;
}

export async function ingestDonationCapture(
  streamer: { id: string },
  capture: DonationCapture,
): Promise<DonationIngestSummary> {
  const rows = Array.isArray(capture?.rows) ? capture.rows : [];
  // 확프 버전 추적(부가 기록): 후원 집계를 막지 않도록 실패해도 무시한다.
  if (capture?.clientVersion) {
    try {
      await recordDonationClientVersion(streamer.id, capture.clientVersion);
    } catch {
      /* 버전 스냅샷 실패는 집계에 영향 주지 않는다 */
    }
  }
  const capturedAt = capture?.capturedAt && !Number.isNaN(Date.parse(capture.capturedAt))
    ? new Date(capture.capturedAt).toISOString()
    : new Date().toISOString();
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const dedupKey = donationDedupKey(row);
    if (!dedupKey) continue;
    if (byKey.has(dedupKey)) continue;
    byKey.set(dedupKey, {
      streamer_id: streamer.id,
      dedup_key: dedupKey,
      source_uid: cleanText(row.sourceUid) || null,
      fan_id: cleanText(row.fanId) || null,
      fan_nickname: cleanText(row.fanNickname) || null,
      donation_type: cleanText(row.donationType) || null,
      donation_amount: toAmount(row.donationAmount),
      donation_amount_text: cleanText(row.donationAmountText) || null,
      donate_time_text: cleanText(row.donateTimeText) || null,
      donate_time: parseDonateTime(row.donateTimeText || ""),
      has_roulette: Boolean(row.hasRoulette),
      source_url: cleanText(capture?.sourceUrl) || null,
      collector_session_id: cleanText(capture?.collectorSessionId) || null,
      captured_at: capturedAt,
    });
  }
  const events = [...byKey.values()];
  if (events.length === 0) {
    return { received: rows.length, accepted: 0, inserted: 0, duplicates: 0, skipped: rows.length };
  }
  const inserted = await donationFetch<Array<{ id: string }>>(
    `/${donationTable()}?on_conflict=streamer_id,dedup_key&select=id`,
    {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(events),
    },
  );
  const insertedCount = Array.isArray(inserted) ? inserted.length : 0;
  return {
    received: rows.length,
    accepted: events.length,
    inserted: insertedCount,
    duplicates: events.length - insertedCount,
    skipped: rows.length - events.length,
  };
}

// ---------- 후원집계 비밀번호(스트리머별) ----------
// 시트 관리자 비번(sheet_admin_pin_updated)과 같은 방식: 스키마 변경 없이 audit_logs 에
// "비밀번호 해시"만 최신 1건으로 저장한다(action=donation_admin_pin_updated).
// 원문 비밀번호는 어디에도 저장하지 않는다. 해시 계산/검증은 lib/donationAdminAuth.ts 담당.

function auditTable(): string {
  return `${TABLE_PREFIX}audit_logs`;
}

export async function getDonationPinHashForStreamer(streamerId: string): Promise<string | null> {
  const rows = await donationFetch<Array<{ payload: { pinHash?: unknown } | null }>>(
    `/${auditTable()}?streamer_id=eq.${streamerId}&action=eq.donation_admin_pin_updated&select=payload&order=created_at.desc&limit=1`,
  );
  const hash = rows?.[0]?.payload?.pinHash;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

// append-only 새 스냅샷, 최신 1건이 현재 값.
export async function setDonationPinHashForStreamer(streamerId: string, pinHash: string): Promise<void> {
  await donationFetch(`/${auditTable()}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action: "donation_admin_pin_updated",
      actor: "operator",
      payload: { pinHash },
    }),
  });
}

// 확프 버전(clientVersion) 추적. donation_events 스키마엔 버전 컬럼이 없어(스키마 변경 금지)
// pin 해시와 같은 방식으로 audit_logs 에 최신 1건 스냅샷만 남긴다(action=donation_client_version).
// 매 수신마다 append 하면 폭증하므로 직전 기록과 값이 다를 때만 새 스냅샷을 남긴다.
export async function getDonationClientVersionForStreamer(streamerId: string): Promise<string | null> {
  const rows = await donationFetch<Array<{ payload: { clientVersion?: unknown } | null }>>(
    `/${auditTable()}?streamer_id=eq.${streamerId}&action=eq.donation_client_version&select=payload&order=created_at.desc&limit=1`,
  );
  const version = rows?.[0]?.payload?.clientVersion;
  return typeof version === "string" && version.length > 0 ? version : null;
}

export async function recordDonationClientVersion(streamerId: string, clientVersion: string): Promise<void> {
  const version = cleanText(clientVersion).slice(0, 64);
  if (!version) return;
  const last = await getDonationClientVersionForStreamer(streamerId);
  if (last === version) return; // 값이 그대로면 새 스냅샷을 남기지 않는다(폭증 방지).
  await donationFetch(`/${auditTable()}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action: "donation_client_version",
      actor: "extension",
      payload: { clientVersion: version },
    }),
  });
}

export type DonationRankingRow = {
  fanKey: string;
  fanId: string | null;
  fanNickname: string | null;
  amountSum: number; // 별풍선 순위=별풍선 수량 합 / 구독 순위=현재 구독 개월(최신 이벤트 값)
  eventCount: number;
  lastDonationAt: string | null;
};

export type DonationSummary = {
  // 별풍선(구독 제외) 기준 — 요약 카드와 메인 순위.
  totals: {
    amountSum: number;
    eventCount: number;
    fanCount: number;
    unknownTimeCount: number;
  };
  // 구독은 단위가 "개월"이라 별풍선과 섞지 않고 따로 집계한다(sy 확정 2026-07-07).
  // monthsSum = 팬별 "현재 개월"(최신 이벤트의 누적 카운터)의 합 — 이벤트 합산 아님.
  subscription: {
    monthsSum: number;
    eventCount: number;
    fanCount: number;
    rankings: DonationRankingRow[];
  };
  // 미션 성공 정산 뭉치(시청자 순위에서 제외분) — 카운트 + 독립 목록(도전/대결 구분).
  // 대결미션은 다른 방 몫이 섞인 배분 결과라 개인 기록으로 재구성 불가 = 여기서만 볼 수 있는 값.
  missionSuccess: {
    amountSum: number;
    eventCount: number;
    list: MissionSettlementRow[];
  };
  // 스트리머 실수령 총계 = 일반 개인 후원(미션·구독 제외) + 미션 성공 뭉치.
  // 미션 개인 후원은 풀로 갔다 뭉치로 돌아오므로 제외(이중 카운트 방지). 구독은 별풍선 아님(제외).
  receiptTotal: {
    amountSum: number;
    generalAmount: number;
    missionAmount: number;
  };
  // 룰렛 탭용: 이 스트리머가 실제로 룰렛을 돌린 후원 갯수 종류(has_roulette=true 행 group by amount).
  rouletteAmounts: RouletteAmountRow[];
  collectedRange: { first: string | null; last: string | null };
  rankings: DonationRankingRow[];
};

export type RouletteAmountRow = { amount: number; eventCount: number; amountSum: number };

export type MissionSettlementRow = {
  kind: "대결" | "도전" | "미션";
  missionName: string | null;
  amount: number;
  at: string | null;
};

// donationType 에 "구독"이 포함되면 구독으로 본다(업보 정가 판정과 동일 규칙: upboSupabase.ts:2196).
export function isSubscription(type: string | null): boolean {
  return (type || "").includes("구독");
}

// 숲 대결/도전미션 "성공 정산" 뭉치 행 판정. 실물 표기(2026-07-07 sy 캡처):
// "대결미션 별풍선 성공" / "도전미션 별풍선 성공" — 미션+성공이 같이 있으면 정산 뭉치.
// 시청자가 미션에 넣은 개인 기록(타입에 "성공" 없음)은 그대로 집계에 남는다.
// 뭉치는 개인 기록의 재기록이라 총합이 이중 카운트되므로 집계에서 제외한다(저장은 그대로 = 원본 증거 보존).
// ※ 실측 정정(2026-09-09): 정산 행은 계정ID 없이 닉네임 칸=미션명으로 온다(운영 정산 165행 전부 계정 없음).
//   예전 주석의 "가장 먼저 넣은 계정에 붙는다"는 데이터로 확인되지 않아 걷어냈다. 규칙(미션+성공)은 그대로.
export function isMissionSuccess(type: string | null): boolean {
  // 규칙의 단일 소스는 upboCore.isMissionSettlementType(룰렛 판정·정가와 공유).
  return isMissionSettlementType(type);
}

// 미션 개인 후원(시청자가 미션에 넣은 후원). 성공 정산 뭉치와 구분 — 이건 룰렛이 돌아
// 순위/갯수 카드엔 포함되지만(리브레 검증: 미션 개인 320건 중 295건 룰렛 있음), 수령 총계에선
// 뭉치와 이중 카운트되므로 제외한다.
export function isMissionPersonal(type: string | null): boolean {
  return (type || "").includes("미션") && !isMissionSuccess(type);
}

// 정산 뭉치의 도전/대결 구분. "대결미션 별풍선 성공" → 대결, "도전미션 별풍선 성공" → 도전.
export function missionKind(type: string | null): "대결" | "도전" | "미션" {
  const t = type || "";
  if (t.includes("대결")) return "대결";
  if (t.includes("도전")) return "도전";
  return "미션";
}

// 룰렛 갯수 조건("33,330" 또는 배열)을 검증된 정수 목록으로 정규화한다.
// 스트리머마다 갯수가 달라 하드코딩 없이 입력값을 그대로 조회 조건으로 쓴다(sy 확정 2026-07-07).
// 잘못된 값은 버리고, 중복 제거, 최대 20개(URL/쿼리 남용 가드).
export function normalizeAmounts(input: unknown): number[] {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(",");
  const seen = new Set<number>();
  for (const item of raw) {
    const num = Number(String(item).trim());
    if (!Number.isFinite(num)) continue;
    const int = Math.round(num);
    if (int < 1 || int > 10_000_000) continue;
    seen.add(int);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

type DonationEventLite = {
  fan_id: string | null;
  fan_nickname: string | null;
  donation_amount: number | null;
  donation_type: string | null;
  donate_time: string | null;
  has_roulette: boolean | null;
};

// 한 그룹(별풍선 또는 구독)의 계정별 누적·순위를 만든다. events 는 donate_time desc 정렬 전제.
function rankByFan(events: DonationEventLite[]): { sum: number; rankings: DonationRankingRow[] } {
  const byFan = new Map<string, DonationRankingRow>();
  let sum = 0;
  for (const event of events) {
    const fanKey = cleanText(event.fan_id) || cleanText(event.fan_nickname);
    if (!fanKey) continue;
    const amount = Number(event.donation_amount ?? 0) || 0;
    sum += amount;
    let row = byFan.get(fanKey);
    if (!row) {
      // donate_time desc 정렬이라 첫 등장 값이 가장 최근 닉네임/시각이다.
      row = {
        fanKey,
        fanId: event.fan_id || null,
        fanNickname: event.fan_nickname || null,
        amountSum: 0,
        eventCount: 0,
        lastDonationAt: event.donate_time || null,
      };
      byFan.set(fanKey, row);
    }
    row.amountSum += amount;
    row.eventCount += 1;
  }
  const rankings = [...byFan.values()].sort(
    (a, b) => b.amountSum - a.amountSum || b.eventCount - a.eventCount || a.fanKey.localeCompare(b.fanKey),
  );
  return { sum, rankings };
}

// 구독 전용 집계. 구독 알림의 "개월"은 그 시점의 누적 카운터라(예: 39→40→…→47)
// 별풍선처럼 더하면 매달 이어간 사람일수록 부풀려진다(1위 304개월 사고, 2026-08-06 sy 확인).
// 팬별로 최신 이벤트 값 하나만 채택한다 = "현재 몇 개월째"(sy 확정 2026-08-06).
// 카운터는 구독이 끊겼다 재시작하면 1부터 다시 세므로 역대 최고와 다를 수 있다.
function rankBySubscriptionCurrent(events: DonationEventLite[]): { sum: number; rankings: DonationRankingRow[] } {
  const byFan = new Map<string, DonationRankingRow>();
  for (const event of events) {
    const fanKey = cleanText(event.fan_id) || cleanText(event.fan_nickname);
    if (!fanKey) continue;
    let row = byFan.get(fanKey);
    if (!row) {
      // donate_time desc 정렬 전제: 첫 등장 행이 최신 이벤트 = 현재 개월.
      row = {
        fanKey,
        fanId: event.fan_id || null,
        fanNickname: event.fan_nickname || null,
        amountSum: Number(event.donation_amount ?? 0) || 0,
        eventCount: 0,
        lastDonationAt: event.donate_time || null,
      };
      byFan.set(fanKey, row);
    }
    row.eventCount += 1;
  }
  const rankings = [...byFan.values()].sort(
    (a, b) => b.amountSum - a.amountSum || b.eventCount - a.eventCount || a.fanKey.localeCompare(b.fanKey),
  );
  const sum = rankings.reduce((total, row) => total + row.amountSum, 0);
  return { sum, rankings };
}

async function fetchDonationPages(query: string): Promise<DonationEventLite[]> {
  const all: DonationEventLite[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const rows = await donationFetch<DonationEventLite[]>(query, {
      headers: { range: `${from}-${from + PAGE_SIZE - 1}`, "range-unit": "items" },
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
  if (all.length >= MAX_PAGES * PAGE_SIZE) {
    throw new Error(`후원 이벤트가 ${MAX_PAGES * PAGE_SIZE}행을 넘어 집계를 중단했습니다. 기간을 좁혀 주세요.`);
  }
  return all;
}

export async function donationSummaryForStreamer(
  streamerId: string,
  options: { fromIso?: string | null; toIso?: string | null; amounts?: number[] | null; rouletteOnly?: boolean } = {},
): Promise<DonationSummary> {
  const filters = [`streamer_id=eq.${streamerId}`];
  const hasTimeFilter = Boolean(options.fromIso || options.toIso);
  if (options.fromIso) filters.push(`donate_time=gte.${encodeURIComponent(options.fromIso)}`);
  if (options.toIso) filters.push(`donate_time=lte.${encodeURIComponent(options.toIso)}`);
  // 룰렛 갯수 조건(세트=여러 값): 정확 일치 in-filter. 범위(30~99) 지원은 실데이터 분포 확인 후 후속.
  const amounts = normalizeAmounts(options.amounts ?? []);
  const amountFilter = amounts.length ? `donation_amount=in.(${amounts.join(",")})` : "";
  if (amountFilter) filters.push(amountFilter);
  // 룰렛 탭: 룰렛이 실제로 돌아간 후원만(has_roulette=true).
  if (options.rouletteOnly) filters.push("has_roulette=is.true");
  const select = "select=fan_id,fan_nickname,donation_amount,donation_type,donate_time,has_roulette";
  const order = "order=donate_time.desc.nullslast";
  const events = await fetchDonationPages(`/${donationTable()}?${filters.join("&")}&${select}&${order}`);

  // 룰렛 갯수 목록: 룰렛이 돌아간 후원(has_roulette=true)을 갯수별로 묶어 건수·합계. 갯수 desc.
  const rouletteByAmount = new Map<number, RouletteAmountRow>();
  for (const event of events) {
    if (!event.has_roulette) continue;
    const amount = Number(event.donation_amount ?? 0) || 0;
    if (amount <= 0) continue;
    let row = rouletteByAmount.get(amount);
    if (!row) {
      row = { amount, eventCount: 0, amountSum: 0 };
      rouletteByAmount.set(amount, row);
    }
    row.eventCount += 1;
    row.amountSum += amount;
  }
  const rouletteAmounts = [...rouletteByAmount.values()].sort((a, b) => b.amount - a.amount);

  // 별풍선(구독·미션정산 제외)과 구독(개월 단위)을 분리한다. 단위가 다르거나(구독)
  // 개인 기록의 재기록이라(미션 성공 정산 뭉치 — 계정 없음·닉네임 칸=미션명, 총합 이중 카운트)
  // 한 통에 더하면 집계가 오염됨.
  const missionEvents = events.filter((event) => isMissionSuccess(event.donation_type));
  const starEvents = events.filter(
    (event) => !isSubscription(event.donation_type) && !isMissionSuccess(event.donation_type),
  );
  const subEvents = events.filter((event) => isSubscription(event.donation_type));
  const star = rankByFan(starEvents);
  const sub = rankBySubscriptionCurrent(subEvents);
  const amountOf = (event: DonationEventLite) => Number(event.donation_amount ?? 0) || 0;
  const missionAmountSum = missionEvents.reduce((sum, event) => sum + amountOf(event), 0);

  // 미션 정산 목록: 뭉치 각각을 도전/대결 + 미션명(닉네임 칸) + 갯수 + 시각으로.
  // 위플랩에 찍힌 시각 최신순(sy 확정 2026-08-06). 시각 해석 실패 행은 맨 뒤, 동시각은 갯수 큰 순.
  const missionList: MissionSettlementRow[] = missionEvents
    .map((event) => ({
      kind: missionKind(event.donation_type),
      missionName: event.fan_nickname || null,
      amount: amountOf(event),
      at: event.donate_time || null,
    }))
    .sort((a, b) => {
      if (a.at && b.at) return b.at.localeCompare(a.at) || b.amount - a.amount;
      if (a.at) return -1;
      if (b.at) return 1;
      return b.amount - a.amount;
    });

  // 스트리머 실수령 총계 = 일반 개인(미션·구독 제외) + 미션 성공 뭉치.
  const generalAmount = starEvents
    .filter((event) => !isMissionPersonal(event.donation_type))
    .reduce((sum, event) => sum + amountOf(event), 0);
  const receiptAmountSum = generalAmount + missionAmountSum;

  // 기간 필터를 걸면 시간 해석 실패 행(donate_time null)은 자동 제외된다.
  // 신뢰를 위해 그런 행이 몇 개인지 함께 보여준다(별풍선 기준).
  let unknownTimeCount = 0;
  if (hasTimeFilter) {
    const unknownQuery = [
      `streamer_id=eq.${streamerId}`,
      "donate_time=is.null",
      ...(amountFilter ? [amountFilter] : []),
    ].join("&");
    const unknownRows = await fetchDonationPages(
      `/${donationTable()}?${unknownQuery}&select=fan_id,fan_nickname,donation_amount,donation_type,donate_time,has_roulette`,
    );
    unknownTimeCount = unknownRows.filter(
      (event) => !isSubscription(event.donation_type) && !isMissionSuccess(event.donation_type),
    ).length;
  } else {
    unknownTimeCount = starEvents.filter((event) => !event.donate_time).length;
  }

  const first = await donationFetch<Array<{ donate_time: string | null }>>(
    `/${donationTable()}?streamer_id=eq.${streamerId}&donate_time=not.is.null&select=donate_time&order=donate_time.asc&limit=1`,
  );
  const last = await donationFetch<Array<{ donate_time: string | null }>>(
    `/${donationTable()}?streamer_id=eq.${streamerId}&donate_time=not.is.null&select=donate_time&order=donate_time.desc&limit=1`,
  );

  return {
    totals: {
      amountSum: star.sum,
      eventCount: starEvents.length,
      fanCount: star.rankings.length,
      unknownTimeCount,
    },
    subscription: {
      monthsSum: sub.sum,
      eventCount: subEvents.length,
      fanCount: sub.rankings.length,
      rankings: sub.rankings,
    },
    missionSuccess: {
      amountSum: missionAmountSum,
      eventCount: missionEvents.length,
      list: missionList,
    },
    receiptTotal: {
      amountSum: receiptAmountSum,
      generalAmount,
      missionAmount: missionAmountSum,
    },
    rouletteAmounts,
    collectedRange: {
      first: first?.[0]?.donate_time ?? null,
      last: last?.[0]?.donate_time ?? null,
    },
    rankings: star.rankings,
  };
}
