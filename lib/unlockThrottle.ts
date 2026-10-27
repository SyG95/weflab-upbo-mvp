// 잠금 해제 시도 제한(무차별 대입 방어) — 시트 관리자·확프 페어링·후원집계·마스터키 (2026-10-27).
//
// 서버리스라 인메모리 카운터를 못 쓴다 → 확프 페어링(lib/extensionPairing.ts)처럼 audit_logs 에
// 성공/실패 "여부"만 append 하고 그 기록을 세어 판정한다. 스키마 변경 0. 비밀번호 원문·해시는 남기지 않는다.
// 요청한 곳은 IP 대신 서버 비밀키 HMAC 표지(adminAuth.clientTag)로만 actor 칸에 남긴다.
// lib/upboSupabase.ts 와 겹치지 않으려고 donationEvents.ts 처럼 REST 호출을 따로 둔다.
//
// 정책:
// - 시트 관리자·확프 페어링(스트리머별, 같은 비밀번호라 한 셈): 15분 7회 + 24시간 30회.
//   초기·리셋 PIN 이 4자리(1만 조합)라 하루 상한이 있어야 며칠 만에 다 훑지 못한다.
// - 후원집계(스트리머별): 같은 상한, 후원집계 전용 비밀번호 실패만 센다.
// - 성공하면 15분 창만 새로 센다. 24시간 창은 비밀번호 변경·운영자 "잠금 풀기"로만 초기화된다
//   (성공마다 하루 상한까지 새로 주면, 스트리머가 하루 몇 번 로그인하는 동안 상한이 몇 배가 된다).
// - 마스터키(sy 전용 UPBO_ADMIN_TOKEN)는 스트리머 잠금과 따로 센다: 요청한 곳(IP)별 15분 10회 + 전체 15분 100회.
//   전역 /admin 콘솔·관리자 API(Bearer)·잠긴 시트의 마스터키 입장 모두 이 셈을 쓴다.
//   → 누가 일부러 틀려도 그 IP 만 잠기고 sy 는 다른 곳에서 들어온다. 스트리머 시트가 잠겨도 sy 는 마스터키로 연다.

export type UnlockKind = "sheet" | "pair" | "donation" | "master";

// hardResetOnly: 성공으로는 초기화되지 않고 비밀번호 변경·운영자 잠금 풀기로만 초기화되는 창.
export type ThrottleWindow = { ms: number; max: number; hardResetOnly?: boolean };

export type ThrottlePolicy = {
  failed: string; // 이 잠금이 기록하는 실패 action
  ok: string; // 이 잠금이 기록하는 성공 action
  countedFailures: readonly string[]; // 셀 실패 action(같은 비밀번호를 검사하는 다른 통로 포함)
  softResets: readonly string[]; // 성공 — 이 시각 이후 실패만 센다(hardResetOnly 창 제외)
  hardResets: readonly string[]; // 비밀번호 변경·운영자 잠금 풀기 — 모든 창 초기화
  windows: readonly ThrottleWindow[];
};

export type ThrottleRow = { action: string; created_at: string; actor?: string | null };

export type ThrottleState = {
  locked: boolean;
  retryAfterSec: number; // 잠김일 때 풀리기까지 남은 초
  remaining: number; // 잠기기 전까지 남은 시도(가장 빡빡한 창 기준)
};

// 콘솔 "잠금 풀기"가 남기는 행. 시트·페어링·후원집계 잠금을 모두 초기화한다.
export const OPERATOR_UNLOCK_ACTION = "unlock_reset_by_operator";

const MINUTE = 60 * 1000;
const STREAMER_WINDOWS: readonly ThrottleWindow[] = [
  { ms: 15 * MINUTE, max: 7 },
  { ms: 24 * 60 * MINUTE, max: 30, hardResetOnly: true },
];
// 마스터키: 요청한 곳(IP 표지)별. 전체 합은 MASTER_GLOBAL_WINDOWS 로 따로 본다(여러 IP 로 나눠 대입 대비).
const MASTER_WINDOWS: readonly ThrottleWindow[] = [{ ms: 15 * MINUTE, max: 10 }];
export const MASTER_GLOBAL_WINDOWS: readonly ThrottleWindow[] = [{ ms: 15 * MINUTE, max: 100 }];

const SHEET_COUNT = {
  countedFailures: ["sheet_admin_unlock_failed", "extension_pair_failed"],
  softResets: ["sheet_admin_unlock_ok", "extension_pair_ok"],
  hardResets: ["sheet_admin_pin_updated", OPERATOR_UNLOCK_ACTION],
  windows: STREAMER_WINDOWS,
} as const;

export const UNLOCK_POLICIES: Record<UnlockKind, ThrottlePolicy> = {
  sheet: { failed: "sheet_admin_unlock_failed", ok: "sheet_admin_unlock_ok", ...SHEET_COUNT },
  // 확프 페어링은 시트 관리자 비밀번호를 검사하므로 시트와 같은 셈을 쓴다(기록 action 만 다름).
  pair: { failed: "extension_pair_failed", ok: "extension_pair_ok", ...SHEET_COUNT },
  donation: {
    failed: "donation_admin_unlock_failed",
    ok: "donation_admin_unlock_ok",
    countedFailures: ["donation_admin_unlock_failed"],
    softResets: ["donation_admin_unlock_ok"],
    hardResets: ["donation_admin_pin_updated", OPERATOR_UNLOCK_ACTION],
    windows: STREAMER_WINDOWS,
  },
  master: {
    failed: "master_key_failed",
    ok: "master_key_ok",
    countedFailures: ["master_key_failed"],
    softResets: ["master_key_ok"],
    hardResets: [],
    windows: MASTER_WINDOWS,
  },
};

function longestWindowMs(windows: readonly ThrottleWindow[]): number {
  return Math.max(...windows.map((w) => w.ms));
}

// audit 기록(순서 무관)으로 지금 잠겼는지 계산한다. 순수 함수 — I/O 없음.
// 각 창에서 "마지막 리셋 이후 실패"가 max 이상이면 잠금. 풀리는 시각 = 그 창 안에서
// 뒤에서 max 번째 실패가 창 밖으로 나가는 때(잠긴 동안의 시도는 기록하지 않으므로 늘지 않는다).
// pending = 지금 시도 중인 요청이 미리 남긴 실패 수(beginUnlockAttempt 가 1을 넘긴다). 잠금 판단에선 빼고,
// remaining(이번 시도까지 포함해 남은 횟수)에는 넣는다. windows 를 주면 정책의 창 대신 그 창으로 본다.
export function evaluateThrottle(
  rows: ThrottleRow[],
  now: number,
  policy: ThrottlePolicy,
  pending = 0,
  windows: readonly ThrottleWindow[] = policy.windows,
): ThrottleState {
  let lastSoftAt = -Infinity;
  let lastHardAt = -Infinity;
  const failureRows: Array<{ t: number; actor: string; matched: boolean }> = [];
  const successRows: Array<{ t: number; actor: string }> = [];
  for (const row of rows) {
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t)) continue;
    if (policy.hardResets.includes(row.action)) lastHardAt = Math.max(lastHardAt, t);
    else if (policy.softResets.includes(row.action)) {
      lastSoftAt = Math.max(lastSoftAt, t);
      successRows.push({ t, actor: row.actor ?? "" });
    }
    // DB 시각(created_at)과 서버 시각(now)이 조금 어긋나도 방금 남긴 기록을 놓치지 않게 미래 시각도 센다.
    else if (policy.countedFailures.includes(row.action)) failureRows.push({ t, actor: row.actor ?? "", matched: false });
  }
  // 성공한 시도도 비밀번호를 보기 전에 실패 1줄을 먼저 남긴다(beginUnlockAttempt). 그 줄은 실패가 아니므로
  // 성공마다 "같은 곳이 그 직전에 남긴 가장 최근 실패" 1줄을 짝지어 뺀다 — 안 빼면 정상 로그인이 하루 상한을 깎는다.
  failureRows.sort((a, b) => a.t - b.t);
  for (const success of successRows.sort((a, b) => a.t - b.t)) {
    for (let i = failureRows.length - 1; i >= 0; i--) {
      const f = failureRows[i];
      if (!f.matched && f.actor === success.actor && f.t <= success.t) {
        f.matched = true;
        break;
      }
    }
  }
  const failures = failureRows.filter((f) => !f.matched).map((f) => f.t);

  let locked = false;
  let retryAfterMs = 0;
  let remaining = Infinity;
  for (const w of windows) {
    const since = w.hardResetOnly ? lastHardAt : Math.max(lastSoftAt, lastHardAt);
    const inWindow = failures.filter((t) => t > since && t > now - w.ms);
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

// streamerId=null 은 스트리머와 무관한 마스터키 셈(streamer_id 비움).
function streamerFilter(streamerId: string | null): string {
  return streamerId === null ? "streamer_id=is.null" : `streamer_id=eq.${encodeURIComponent(streamerId)}`;
}

function actorValue(tag: string): string {
  return `ip:${tag}`;
}

type CountOptions = {
  now?: number;
  pending?: number;
  actorTag?: string; // 주면 그 요청한 곳(IP 표지)의 기록만 센다
  windows?: readonly ThrottleWindow[];
};

// 지금 잠금 상태. 가장 긴 창 안의 최근 기록만 읽는다(최신 200건이면 어느 창의 상한보다 많다).
export async function getUnlockThrottle(
  kind: UnlockKind,
  streamerId: string | null,
  options: CountOptions = {},
): Promise<ThrottleState> {
  const policy = UNLOCK_POLICIES[kind];
  const windows = options.windows ?? policy.windows;
  const now = options.now ?? Date.now();
  const { table } = supabaseEnv();
  const actions = [...new Set([...policy.countedFailures, ...policy.softResets, ...policy.hardResets])].join(",");
  const since = encodeURIComponent(new Date(now - longestWindowMs(windows)).toISOString());
  const actor = options.actorTag ? `&actor=eq.${encodeURIComponent(actorValue(options.actorTag))}` : "";
  const rows = await auditFetch<ThrottleRow[]>(
    `/${table}?${streamerFilter(streamerId)}&action=in.(${actions})${actor}&created_at=gte.${since}&select=action,created_at,actor&order=created_at.desc&limit=200`,
  );
  return evaluateThrottle(rows ?? [], now, policy, options.pending ?? 0, windows);
}

async function insertRow(streamerId: string | null, action: string, actor: string) {
  const { table } = supabaseEnv();
  await auditFetch(`/${table}`, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      streamer_id: streamerId,
      action,
      actor,
      payload: { at: new Date().toISOString() },
    }),
  });
}

function mergeStates(a: ThrottleState, b: ThrottleState): ThrottleState {
  return {
    locked: a.locked || b.locked,
    retryAfterSec: Math.max(a.locked ? a.retryAfterSec : 0, b.locked ? b.retryAfterSec : 0),
    remaining: Math.min(a.remaining, b.remaining),
  };
}

// 잠금 해제 시도 시작(시트·페어링·후원집계, 스트리머별). 비밀번호를 검사하기 "전에" 이 시도를 실패로 먼저 남기고 다시 센다.
// 확인→기록 순서면 동시에 몰려온 요청 수백 개가 모두 "아직 0회"를 보고 통과한다(서버리스 병렬 실행).
// 먼저 기록하면 각 요청이 자기 기록을 포함해 세므로, 상한을 넘는 요청은 비밀번호를 검사하지 못한다.
// 돌려준 값이 locked 면 비밀번호를 검사하지 말고 거절한다. 맞으면 호출자가 recordUnlockSuccess 를 부른다.
// 기록 실패는 그대로 throw(fail-closed).
export async function beginUnlockAttempt(
  kind: Exclude<UnlockKind, "master">,
  streamerId: string,
  actorTag: string,
): Promise<ThrottleState> {
  const before = await getUnlockThrottle(kind, streamerId);
  if (before.locked) return before;
  await insertRow(streamerId, UNLOCK_POLICIES[kind].failed, actorValue(actorTag));
  return getUnlockThrottle(kind, streamerId, { pending: 1 });
}

// 마스터키 시도 시작. 요청한 곳(IP 표지)별 셈과 전체 셈을 둘 다 본다. 쓰는 법은 beginUnlockAttempt 와 같다.
export async function beginMasterAttempt(actorTag: string): Promise<ThrottleState> {
  const beforeMine = await getUnlockThrottle("master", null, { actorTag });
  const beforeAll = await getUnlockThrottle("master", null, { windows: MASTER_GLOBAL_WINDOWS });
  const before = mergeStates(beforeMine, beforeAll);
  if (before.locked) return before;
  await insertRow(null, UNLOCK_POLICIES.master.failed, actorValue(actorTag));
  const mine = await getUnlockThrottle("master", null, { actorTag, pending: 1 });
  const all = await getUnlockThrottle("master", null, { windows: MASTER_GLOBAL_WINDOWS, pending: 1 });
  return mergeStates(mine, all);
}

// 비밀번호가 맞았을 때. 기록이 실패해도 로그인은 진행한다(다음 시도 때 실패가 조금 더 셀 뿐).
export async function recordUnlockSuccess(
  kind: UnlockKind,
  streamerId: string | null,
  actorTag: string,
): Promise<void> {
  try {
    await insertRow(kind === "master" ? null : streamerId, UNLOCK_POLICIES[kind].ok, actorValue(actorTag));
  } catch (error) {
    console.error(`[unlockThrottle] ${kind} 성공 기록 실패`, (error as Error).message);
  }
}

// 콘솔 "잠금 풀기": 이 스트리머의 시트·페어링·후원집계 잠금(하루 상한 포함)을 모두 초기화한다.
export async function recordOperatorUnlock(streamerId: string): Promise<void> {
  await insertRow(streamerId, OPERATOR_UNLOCK_ACTION, "operator");
}

// ---------- 스트리머별 잠금 해제 판정(시트·페어링·후원집계 공통) ----------

export type UnlockDecision =
  | { kind: "pin" } // 이 스트리머의 비밀번호로 통과
  | { kind: "master" } // 마스터키로 통과
  | { kind: "wrong"; remaining: number }
  | { kind: "locked"; retryAfterSec: number } // 이 스트리머 잠금이 걸림(마스터키도 아님)
  | { kind: "not-issued" }; // 개별 비밀번호가 아직 없음(마스터키로만 열림)

// 1) 개별 비번이 있고 이 스트리머가 잠기지 않았으면: 스트리머 셈으로 한 번 세고, 개별 비번·마스터키 둘 다 받는다.
// 2) 잠겼거나 개별 비번이 없으면: 마스터키만 받고, 이 시도는 마스터키 셈(요청한 곳별·전체)으로 센다.
//    → 잠긴 시트에서도 sy 는 들어오지만, 그 틈으로 마스터키를 끝없이 대입하지는 못한다.
// 남은 구멍(알고 씀): 잠기지 않은 시트에서 틀린 시도는 마스터키 셈에 들어가지 않는다 — 스트리머별 상한(하루 30회)
// 안에서 마스터키 추측이 가능하다. 마스터키를 길고 무작위로 두는 것이 전제(보고서 §5).
export async function decideStreamerUnlock(input: {
  kind: Exclude<UnlockKind, "master">;
  streamerId: string;
  actorTag: string;
  passwordHash: string;
  pinHash: string | null;
  masterHash: string | null;
}): Promise<UnlockDecision> {
  const { kind, streamerId, actorTag, passwordHash, pinHash, masterHash } = input;
  let lockedFor = 0;
  if (pinHash) {
    const t = await beginUnlockAttempt(kind, streamerId, actorTag);
    if (!t.locked) {
      const which = passwordHash === pinHash ? "pin" : masterHash && passwordHash === masterHash ? "master" : null;
      if (!which) return { kind: "wrong", remaining: t.remaining };
      await recordUnlockSuccess(kind, streamerId, actorTag);
      return { kind: which };
    }
    lockedFor = t.retryAfterSec;
  }
  if (masterHash) {
    const m = await beginMasterAttempt(actorTag);
    if (!m.locked && passwordHash === masterHash) {
      await recordUnlockSuccess("master", null, actorTag);
      return { kind: "master" };
    }
  }
  return pinHash ? { kind: "locked", retryAfterSec: lockedFor } : { kind: "not-issued" };
}

// 판정 → 화면 문구(통과가 아닐 때).
export function unlockErrorMessage(decision: UnlockDecision, notIssuedMessage: string): string {
  if (decision.kind === "wrong") return wrongPasswordMessage(decision.remaining);
  if (decision.kind === "locked") return lockedMessage(decision.retryAfterSec);
  return notIssuedMessage;
}
