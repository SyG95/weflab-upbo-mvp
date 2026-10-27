// 잠금 해제 시도 제한(무차별 대입 방어) — 시트 관리자·후원집계·전역 /admin 콘솔 (2026-10-27).
//
// 서버리스라 인메모리 카운터를 못 쓴다 → 확프 페어링(lib/extensionPairing.ts)처럼 audit_logs 에
// 성공/실패 "여부"만 append 하고 그 기록을 세어 판정한다. 스키마 변경 0. 비밀번호 원문·해시는 남기지 않는다.
// lib/upboSupabase.ts 와 겹치지 않으려고 donationEvents.ts 처럼 REST 호출을 따로 둔다.
//
// 정책:
// - 시트 관리자(스트리머별): 15분 7회 + 24시간 30회. 초기·리셋 PIN 이 4자리(1만 조합)라 하루 상한이 있어야
//   며칠 만에 다 훑지 못한다. 같은 비밀번호를 검사하는 확프 페어링 실패도 함께 센다.
// - 후원집계(스트리머별): 같은 상한, 후원집계 전용 비밀번호 실패만 센다.
// - 전역 /admin 콘솔(sy 한 명, 슬러그 없음): 전역 카운터 1개(streamer_id 비움), 15분 10회.
//   누가 일부러 틀리면 sy 도 15분 잠기지만, 마스터 토큰을 계속 대입하는 통로는 닫힌다.
// - 마지막 성공 또는 비밀번호 변경 이후의 실패만 센다. 비번이 바뀌면 옛 추측은 의미가 없으므로
//   콘솔 "비번 리셋"이 그 시트의 잠금도 함께 푼다.
// - 잠긴 동안엔 마스터키도 받지 않는다. 잠금 중 마스터키만 통과시키면 "틀림=잠김 / 맞음=통과"로
//   마스터키를 끝없이 대입하는 통로가 된다.

export type UnlockKind = "sheet" | "pair" | "donation" | "console";

export type ThrottleWindow = { ms: number; max: number };

export type ThrottlePolicy = {
  failed: string; // 이 잠금이 기록하는 실패 action
  ok: string; // 이 잠금이 기록하는 성공 action
  countedFailures: readonly string[]; // 셀 실패 action(같은 비밀번호를 검사하는 다른 통로 포함)
  resets: readonly string[]; // 이 시각 이후 실패만 센다(성공·비밀번호 변경)
  windows: readonly ThrottleWindow[];
};

export type ThrottleRow = { action: string; created_at: string };

export type ThrottleState = {
  locked: boolean;
  retryAfterSec: number; // 잠김일 때 풀리기까지 남은 초
  remaining: number; // 잠기기 전까지 남은 시도(가장 빡빡한 창 기준)
};

const MINUTE = 60 * 1000;
const STREAMER_WINDOWS: readonly ThrottleWindow[] = [
  { ms: 15 * MINUTE, max: 7 },
  { ms: 24 * 60 * MINUTE, max: 30 },
];
const CONSOLE_WINDOWS: readonly ThrottleWindow[] = [{ ms: 15 * MINUTE, max: 10 }];

export const UNLOCK_POLICIES: Record<UnlockKind, ThrottlePolicy> = {
  sheet: {
    failed: "sheet_admin_unlock_failed",
    ok: "sheet_admin_unlock_ok",
    countedFailures: ["sheet_admin_unlock_failed", "extension_pair_failed"],
    resets: ["sheet_admin_unlock_ok", "extension_pair_ok", "sheet_admin_pin_updated"],
    windows: STREAMER_WINDOWS,
  },
  // 확프 페어링(lib/extensionPairing.ts)은 시트 관리자 비밀번호를 검사하므로 시트와 같은 셈을 쓴다(기록 action 만 다름).
  pair: {
    failed: "extension_pair_failed",
    ok: "extension_pair_ok",
    countedFailures: ["sheet_admin_unlock_failed", "extension_pair_failed"],
    resets: ["sheet_admin_unlock_ok", "extension_pair_ok", "sheet_admin_pin_updated"],
    windows: STREAMER_WINDOWS,
  },
  donation: {
    failed: "donation_admin_unlock_failed",
    ok: "donation_admin_unlock_ok",
    countedFailures: ["donation_admin_unlock_failed"],
    resets: ["donation_admin_unlock_ok", "donation_admin_pin_updated"],
    windows: STREAMER_WINDOWS,
  },
  console: {
    failed: "admin_console_unlock_failed",
    ok: "admin_console_unlock_ok",
    countedFailures: ["admin_console_unlock_failed"],
    resets: ["admin_console_unlock_ok"],
    windows: CONSOLE_WINDOWS,
  },
};

function longestWindowMs(policy: ThrottlePolicy): number {
  return Math.max(...policy.windows.map((w) => w.ms));
}

// audit 기록(순서 무관)으로 지금 잠겼는지 계산한다. 순수 함수 — I/O 없음.
// 각 창에서 "마지막 리셋 이후 실패"가 max 이상이면 잠금. 풀리는 시각 = 그 창 안에서
// 뒤에서 max 번째 실패가 창 밖으로 나가는 때(잠긴 동안의 시도는 기록하지 않으므로 늘지 않는다).
// pending = 지금 시도 중인 요청이 미리 남긴 실패 수(beginUnlockAttempt 가 1을 넘긴다). 잠금 판단에선 빼고,
// remaining(이번 시도까지 포함해 남은 횟수)에는 넣는다.
export function evaluateThrottle(
  rows: ThrottleRow[],
  now: number,
  policy: ThrottlePolicy,
  pending = 0,
): ThrottleState {
  let lastResetAt = -Infinity;
  const failures: number[] = [];
  for (const row of rows) {
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t)) continue;
    if (policy.resets.includes(row.action)) lastResetAt = Math.max(lastResetAt, t);
  }
  for (const row of rows) {
    const t = Date.parse(row.created_at);
    // DB 시각(created_at)과 서버 시각(now)이 조금 어긋나도 방금 남긴 기록을 놓치지 않게 미래 시각도 센다.
    if (!Number.isFinite(t)) continue;
    if (policy.countedFailures.includes(row.action) && t > lastResetAt) failures.push(t);
  }
  failures.sort((a, b) => a - b);

  let locked = false;
  let retryAfterMs = 0;
  let remaining = Infinity;
  for (const w of policy.windows) {
    const inWindow = failures.filter((t) => t > now - w.ms);
    remaining = Math.min(remaining, w.max - inWindow.length);
    const earlier = inWindow.length - pending;
    if (earlier >= w.max) {
      locked = true;
      const unlockAt = inWindow[earlier - w.max] + w.ms;
      retryAfterMs = Math.max(retryAfterMs, unlockAt - now);
    }
  }
  return {
    locked,
    retryAfterSec: locked ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0,
    remaining: Math.max(0, remaining),
  };
}

// 화면 문구: 잠김 → 몇 분 뒤에 다시. 분 단위 올림(최소 1분).
export function lockedMessage(retryAfterSec: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  const when = minutes >= 120 ? `${Math.ceil(minutes / 60)}시간` : `${minutes}분`;
  return `비밀번호를 여러 번 틀려 잠시 잠겼어요. ${when} 뒤에 다시 시도해 주세요.`;
}

// 화면 문구: 틀림 → 남은 시도가 적을 때만 알려 준다(방금 실패 1건은 이미 뺀 값을 넘긴다).
export function wrongPasswordMessage(remainingAfterThis: number): string {
  const base = "비밀번호가 올바르지 않습니다.";
  if (remainingAfterThis <= 0) return `${base} 여러 번 틀려 잠시 잠겼어요. 조금 뒤에 다시 시도해 주세요.`;
  if (remainingAfterThis <= 3) return `${base} (${remainingAfterThis}번 더 틀리면 잠시 잠겨요)`;
  return base;
}

// ---------- audit_logs I/O ----------

function supabaseEnv() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return { url, key, table: `${process.env.UPBO_TABLE_PREFIX || ""}audit_logs` };
}

async function auditFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = supabaseEnv();
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("authorization", `Bearer ${key}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${url}/rest/v1${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text || res.statusText}`);
  return (text ? JSON.parse(text) : null) as T;
}

// streamerId=null 은 전역 콘솔 카운터(streamer_id 비움).
function streamerFilter(streamerId: string | null): string {
  return streamerId === null ? "streamer_id=is.null" : `streamer_id=eq.${encodeURIComponent(streamerId)}`;
}

// 지금 잠금 상태. 가장 긴 창 안의 최근 기록만 읽는다(최신 200건이면 어느 창의 상한보다 많다).
export async function getUnlockThrottle(
  kind: UnlockKind,
  streamerId: string | null,
  now = Date.now(),
  pending = 0,
): Promise<ThrottleState> {
  const policy = UNLOCK_POLICIES[kind];
  const { table } = supabaseEnv();
  const actions = [...new Set([...policy.countedFailures, ...policy.resets])].join(",");
  const since = encodeURIComponent(new Date(now - longestWindowMs(policy)).toISOString());
  const rows = await auditFetch<ThrottleRow[]>(
    `/${table}?${streamerFilter(streamerId)}&action=in.(${actions})&created_at=gte.${since}&select=action,created_at&order=created_at.desc&limit=200`,
  );
  return evaluateThrottle(rows ?? [], now, policy, pending);
}

async function insertAttempt(kind: UnlockKind, streamerId: string | null, outcome: "ok" | "failed") {
  const policy = UNLOCK_POLICIES[kind];
  const { table } = supabaseEnv();
  await auditFetch(`/${table}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action: outcome === "ok" ? policy.ok : policy.failed,
      actor: "unlock",
      payload: { at: new Date().toISOString() },
    }),
  });
}

// 잠금 해제 시도 시작. 비밀번호를 검사하기 "전에" 이 시도를 실패로 먼저 남기고 다시 센다.
// 확인→기록 순서면 동시에 몰려온 요청 수백 개가 모두 "아직 0회"를 보고 통과한다(서버리스 병렬 실행).
// 먼저 기록하면 각 요청이 자기 기록을 포함해 세므로, 상한을 넘는 요청은 비밀번호를 검사하지 못한다.
// 돌려준 값이 locked 면 비밀번호를 검사하지 말고 거절한다. 맞으면 호출자가 recordUnlockSuccess 를 부른다
// (성공 기록이 이 실패를 포함한 이전 실패를 모두 무효로 만든다). 기록 실패는 그대로 throw(fail-closed).
export async function beginUnlockAttempt(
  kind: UnlockKind,
  streamerId: string | null,
): Promise<ThrottleState> {
  const before = await getUnlockThrottle(kind, streamerId);
  if (before.locked) return before;
  await insertAttempt(kind, streamerId, "failed");
  return getUnlockThrottle(kind, streamerId, Date.now(), 1);
}

// 비밀번호가 맞았을 때. 기록이 실패해도 로그인은 진행한다(다음 시도 때 실패가 조금 더 셀 뿐).
export async function recordUnlockSuccess(kind: UnlockKind, streamerId: string | null): Promise<void> {
  try {
    await insertAttempt(kind, streamerId, "ok");
  } catch (error) {
    console.error(`[unlockThrottle] ${kind} 성공 기록 실패`, (error as Error).message);
  }
}
