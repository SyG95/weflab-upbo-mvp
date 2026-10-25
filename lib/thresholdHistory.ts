// ---------- 전역 기준확률(streamers.threshold_percent) 변경 이력 — 순수 로직 ----------
//
// 왜 필요한가:
//   기준%는 streamers 행을 덮어쓰기만 해서(setStreamerSettings·upsertStreamer) "그 후원 시각의 기준"을
//   알 수 없었다(2026-10-25 확인). 늦게 들어온 옛 결과를 그때 기준으로 다시 판정하려면 이력이 필요하다.
//   → 바꿀 때마다 audit_logs(action=threshold_percent_updated)에 before/after 를 남기고,
//     후원 시각 t 의 기준은 이 이력(없으면 반영 배치 스냅샷)으로 고른다.
//
// 규칙:
//   1) 이력이 없으면 첫 저장은 값이 같아도 1줄(baseline) — 그 시각부터 정확해진다.
//   2) 이력이 있으면 "새 값이 최신 after 와 다르거나, 지금 DB 값(before)이 최신 after 와 다를 때"만 1줄.
//      후자는 기록 없이 바뀐 흔적(다른 경로·기록 실패)을 다음 저장 때 메우는 장치다.
//   3) 그때 기준: t 이전 마지막 이력의 after(정확). 다만 "그 뒤로 기록 없이 바뀐 흔적"이 있으면 근사 —
//      다음 이력이 있으면 그 before 가, 마지막 이력이면 지금 DB 값(current)이 after 와 달라야 흔적이다
//      (설정 저장의 기록 실패 503 뒤 다시 저장 안 함·관리자 등록 best-effort 실패·두 탭 엇갈린 저장).
//      이력 시작 전이면 t 이전 마지막 반영 배치 스냅샷(근사), 그것도 없으면 현재 값(근사).
//   4) 같은 시각 경계: 이력은 "t 보다 앞"만(저장과 같은 시각의 후원은 바뀌기 전 값으로 보수적으로 본다),
//      배치는 "t 이하"(그 반영 시각에 실제로 쓰인 값의 스냅샷이므로 같은 시각도 그 값).

export const THRESHOLD_PERCENT_ACTION = "threshold_percent_updated";

export type ThresholdPercentSource = "settings" | "admin_upsert" | "baseline";

export type ThresholdPercentChange = {
  before: number | null;
  after: number;
  source: ThresholdPercentSource;
};

export type ThresholdPercentHistoryEntry = {
  at: string; // audit created_at(ISO)
  before: number | null;
  after: number;
};

export type ThresholdBatchSnapshot = {
  appliedAt: string; // import_batches.applied_at(ISO)
  thresholdPercent: number;
};

export type ThresholdPercentAt = {
  value: number;
  exact: boolean;
  source: "history" | "batch" | "current";
};

const EPSILON = 1e-9;

function same(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return Math.abs(a - b) < EPSILON;
}

// 이번 저장에서 남길 이력 1줄(없으면 null).
export function thresholdChangeToRecord(args: {
  hasHistory: boolean;
  latestAfter: number | null;
  before: number | null;
  after: number;
  source: Exclude<ThresholdPercentSource, "baseline">;
}): ThresholdPercentChange | null {
  const { hasHistory, latestAfter, before, after, source } = args;
  if (!hasHistory) {
    return { before, after, source: before !== null && same(before, after) ? "baseline" : source };
  }
  if (same(after, latestAfter) && (before === null || same(before, latestAfter))) return null;
  return { before, after, source };
}

// audit payload → 이력 1줄(모양이 깨진 줄은 버린다).
export function parseThresholdHistoryRow(row: { created_at?: unknown; payload?: unknown }): ThresholdPercentHistoryEntry | null {
  const at = typeof row.created_at === "string" ? row.created_at : "";
  const payload = (row.payload ?? {}) as { before?: unknown; after?: unknown };
  const after = Number(payload.after);
  if (!at || !Number.isFinite(Date.parse(at)) || payload.after === null || payload.after === undefined || !Number.isFinite(after)) {
    return null;
  }
  const beforeNum = Number(payload.before);
  const before = payload.before === null || payload.before === undefined || !Number.isFinite(beforeNum) ? null : beforeNum;
  return { at, before, after };
}

// 후원 시각 tMs 에 쓰였을 전역 기준%. history·batches 는 순서 무관(안에서 정렬).
export function thresholdPercentAt(
  tMs: number,
  history: ThresholdPercentHistoryEntry[],
  batches: ThresholdBatchSnapshot[],
  current: number,
): ThresholdPercentAt {
  const rows = history
    .filter((h) => Number.isFinite(Date.parse(h.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let index = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (Date.parse(rows[i].at) < tMs) index = i;
    else break;
  }
  if (index >= 0) {
    const picked = rows[index];
    const next = rows[index + 1];
    // 다음 이력의 before(마지막 이력이면 지금 DB 값)가 이번 after 와 다르면, 그 사이 어딘가에서 기록 없이
    // 바뀐 것 — 시점을 모른다. 첫 줄이 아닌데 before 가 비어 있는 줄(모양이 깨짐)도 확인할 수 없으니 근사.
    const exact = next ? next.before !== null && same(next.before, picked.after) : same(picked.after, current);
    return { value: picked.after, exact, source: "history" };
  }
  const batch = batches
    .filter((b) => Number.isFinite(Date.parse(b.appliedAt)) && Number.isFinite(b.thresholdPercent) && Date.parse(b.appliedAt) <= tMs)
    .sort((a, b) => Date.parse(a.appliedAt) - Date.parse(b.appliedAt))
    .at(-1);
  if (batch) return { value: batch.thresholdPercent, exact: false, source: "batch" };
  return { value: current, exact: false, source: "current" };
}
