// ---------- 후원 시점 근사 다시판정 "눌러 넣기" 선택 상태(관문 2) — 순수, import 0개 ----------
//
// 화면(RejudgeManager)과 서버(rejudge.ts 정렬·넣기 검사)가 같은 줄 순서 규칙을 쓴다.
// import 가 없어야 한다 — 클라이언트 화면이 이 파일을 쓰므로, 판정 모듈(upboCore)·crypto 가 공개 번들에 끌려오면 안 된다.
//
// 넣을 수 있는 줄: 새로 기록될 것(kind "new")의 🟢·🟡 만. 🟠(표 밖)는 수동기록, ⚪·오기록 의심은 이 경로로 넣지 않는다.
// 기본 선택: 🟢 체크, 🟡 해제(sy 결정 11/11). 사람이 바꾼 것(overrides)이 이긴다.
// "본 줄까지만": 화면에 그린 줄(shownRows)만 고를 수 있고, 마지막으로 그린 줄의 위치 표지(seenThrough)를 서버에 같이 보낸다.
//   서버는 같은 입력으로 다시 계산한 목록에서 그 표지 "이하" 줄만 넣을 수 있게 한다(사람이 못 본 줄은 못 넣음).

export type ApproxRowLike = {
  sourceKey: string;
  kind: "new" | "suspected" | "outside";
  cls: string;
  timeMs: number | null;
  // 아래는 다시 불러온 줄이 "같은 판단"인지 비교할 때만 쓴다(미리보기 행 DonationTimeRow 에 다 있다).
  reasonText?: string;
  reasons?: string[];
  tags?: string[];
  manualOverlap?: unknown;
  judged?: {
    version?: number;
    groupIndex?: number | null;
    amountRangeLabel?: string;
    itemName?: string;
    storeItemName?: string;
    probability?: number | null;
    threshold?: number;
  };
};

// 사람이 고른 근거 전부: 분류·이유·꼬리표·수동기록 겹침·판정 세트(버전·칸·라벨·상품·확률·기준).
function approxRowBasis(row: ApproxRowLike): string {
  const j = row.judged ?? {};
  return JSON.stringify([
    row.kind,
    row.cls,
    row.reasonText ?? "",
    row.reasons ?? [],
    row.tags ?? [],
    row.manualOverlap ?? null,
    j.version ?? null,
    j.groupIndex ?? null,
    j.amountRangeLabel ?? "",
    j.itemName ?? "",
    j.storeItemName ?? "",
    j.probability ?? null,
    j.threshold ?? null,
  ]);
}

// 줄 위치 표지: 분류 순서(0 🟢 → 1 🟡 → 2 🟠 → 3 오기록 의심), 후원 시각(못 읽으면 맨 뒤), 결과 키.
// 미리보기 목록의 정렬 순서와 같다. 다른 줄이 그사이 기록돼 목록에서 빠져도 남은 줄의 표지는 그대로다(쪽 번호와 달리 안 밀린다).
export type ApproxCursor = { o: number; t: number | null; k: string };

export function approxRowOrder(row: Pick<ApproxRowLike, "kind" | "cls">): number {
  return row.kind === "suspected" ? 3 : row.kind === "outside" ? 2 : row.cls === "green" ? 0 : 1;
}

export function approxCursorOf(row: ApproxRowLike): ApproxCursor {
  return { o: approxRowOrder(row), t: row.timeMs, k: row.sourceKey };
}

export function compareApproxCursor(a: ApproxCursor, b: ApproxCursor): number {
  return (
    a.o - b.o ||
    (a.t ?? Number.MAX_SAFE_INTEGER) - (b.t ?? Number.MAX_SAFE_INTEGER) ||
    a.k.localeCompare(b.k)
  );
}

export function isInsertableApproxRow(row: Pick<ApproxRowLike, "kind" | "cls">): boolean {
  return row.kind === "new" && (row.cls === "green" || row.cls === "yellow");
}

// 체크 상태 한 줄: 사람이 바꿨으면 그 값, 아니면 🟢만 체크.
export function isApproxRowPicked(row: ApproxRowLike, overrides: Readonly<Record<string, boolean>>): boolean {
  if (!isInsertableApproxRow(row)) return false;
  const changed = overrides[row.sourceKey];
  return changed === undefined ? row.cls === "green" : changed;
}

// shownRows = 화면에 그린 줄(서버 정렬 순서 그대로). 넣을 키와 마지막으로 그린 줄의 표지를 돌려준다.
export function approxSelection(
  shownRows: ApproxRowLike[],
  overrides: Readonly<Record<string, boolean>>,
): { keys: string[]; seenThrough: ApproxCursor | null } {
  const keys: string[] = [];
  for (const row of shownRows) if (isApproxRowPicked(row, overrides)) keys.push(row.sourceKey);
  const last = shownRows.at(-1);
  return { keys, seenThrough: last ? approxCursorOf(last) : null };
}

// 미리보기를 다시 불렀을 때(409 뒤 자동 재미리보기 등) 사람이 고른 것을 이어 간다.
//   - 같은 결과 키의 분류·이유·꼬리표·수동기록 겹침·판정 세트가 전부 같을 때만 그때의 체크 상태를 그대로 둔다.
//   - 분류가 바뀐 줄은 해제한다(예: 🟡 로 바뀐 🟢, 🟢 로 바뀐 🟡 도 사람이 다시 보고 고르게).
//   - 분류는 같은데 근거가 하나라도 바뀐 줄(예: 그사이 수동기록이 생겨 겹침이 붙은 🟡)은 사람 선택을 버린다 —
//     🟡 는 해제, 🟢 로 남은 줄은 기본 체크 규칙 그대로.
//   - 사라진 줄은 버리고, 새로 나타난 줄은 기본값(🟢 체크·🟡 해제).
export function carryApproxPicks(
  prevRows: ApproxRowLike[],
  prevPicks: Readonly<Record<string, boolean>>,
  nextRows: ApproxRowLike[],
): Record<string, boolean> {
  const before = new Map(prevRows.map((row) => [row.sourceKey, row]));
  const out: Record<string, boolean> = {};
  for (const row of nextRows) {
    if (!isInsertableApproxRow(row)) continue;
    const prev = before.get(row.sourceKey);
    if (!prev) continue;
    if (prev.kind !== row.kind || prev.cls !== row.cls) {
      out[row.sourceKey] = false;
      continue;
    }
    if (approxRowBasis(prev) !== approxRowBasis(row)) {
      if (row.cls !== "green") out[row.sourceKey] = false;
      continue;
    }
    const picked = isApproxRowPicked(prev, prevPicks);
    if (picked !== (row.cls === "green")) out[row.sourceKey] = picked;
  }
  return out;
}

// 넣기 결과 문구(화면). 실제로 들어간 수만 "넣음"으로 쓴다.
export function approxApplyMessage(result: { requested: number; inserted: number; alreadyExisted: number; couponLinked?: number }): string {
  const { requested, inserted, alreadyExisted } = result;
  let text = `요청 ${requested}건 중 ${inserted}건 넣음${alreadyExisted > 0 ? `, ${alreadyExisted}건은 이미 있었어요.` : "."}`;
  if ((result.couponLinked ?? 0) > 0) {
    text += ` 쿠폰 연결 상품 ${result.couponLinked}건은 쿠폰이 자동으로 쌓이지 않아요 — 쿠폰 탭 "지난 당첨 가져오기"로 반영해 주세요.`;
  }
  return text;
}
