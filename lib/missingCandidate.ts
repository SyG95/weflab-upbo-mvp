// ---------- 놓쳤을 수 있는 기록(관문 1) — 순수 로직 ----------
//
// 판정(reconcileResults)은 그대로 두고, 판정이 끝난 결과를 보고 "사람이 볼 만한 줄"의 수만 센다.
//   - 의심 수(countSuspects): 수집 반영 때 배치 summary.suspectCount 에 숫자로만 남긴다. 기록·정가·쿠폰·두배권 상태는 안 건드린다.
//   - 표 밖 종류 정책(foldMissingCandidatePolicies): "이 종류 앞으로 제외"를 audit 에서 접는다(스키마 0).
// 설계: meetings/2026-11-08-upbo-root-fix/DESIGN-v0.2.md §5-5·§5-6
import {
  cleanText,
  findCatalogMatch,
  normalizeName,
  type NormalizedCatalogItem,
  type ReconcileDecision,
  type ThresholdOverrides,
} from "./upboCore";

export const MISSING_CANDIDATE_POLICY_ACTION = "missing_candidate_policy";
export const MISSING_PREVIEW_SNAPSHOT_ACTION = "missing_preview_snapshot";

export type MissingKindPolicy = "exclude";

// 표 밖 종류 열쇠 = 금액 + 정규화 이름(같은 이름이라도 금액이 다르면 다른 룰렛이다).
export function missingKindKey(amount: number | null | undefined, normalizedName: string): string {
  return `${amount ?? ""}|${normalizedName}`;
}

export function kindKeyOfResult(result: { donationAmount?: number | null; normalizedName?: string; itemName?: string }): string {
  return missingKindKey(result.donationAmount ?? null, cleanText(result.normalizedName) || normalizeName(result.itemName));
}

// audit 시각순 행을 접어 "지금 유효한 제외 종류"를 만든다. decision=include 는 제외 취소.
export function foldMissingCandidatePolicies(rows: ReadonlyArray<{ payload?: unknown }>): Map<string, MissingKindPolicy> {
  const out = new Map<string, MissingKindPolicy>();
  for (const row of rows) {
    const p = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : null;
    if (!p || typeof p.key !== "string" || !p.key) continue;
    if (p.decision === "exclude") out.set(p.key, "exclude");
    else if (p.decision === "include") out.delete(p.key);
  }
  return out;
}

// 금액대 라벨 안에 금액이 들어가는가. upboCore.amountRangeLabel 이 만드는 모양: "33", "33~50", "1000~", "~50".
function amountInLabel(label: string, amount: number): boolean {
  const text = cleanText(label).replace(/,/g, "");
  if (/^\d+$/.test(text)) return Number(text) === amount;
  const range = text.match(/^(\d*)\s*~\s*(\d*)$/);
  if (!range || (range[1] === "" && range[2] === "")) return false;
  const low = range[1] === "" ? Number.NEGATIVE_INFINITY : Number(range[1]);
  const high = range[2] === "" ? Number.POSITIVE_INFINITY : Number(range[2]);
  return amount >= low && amount <= high;
}

// 표에서 칸을 못 찾은 줄의 기준 확률: 금액이 들어가는 금액대 예외가 있으면 그 값, 없으면 전역 기준.
export function thresholdForAmount(
  overrides: ThresholdOverrides,
  amount: number | null | undefined,
  globalThreshold: number,
): number {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return globalThreshold;
  for (const [label, percent] of Object.entries(overrides)) {
    if (amountInLabel(label, Number(amount))) return percent;
  }
  return globalThreshold;
}

function parseKstMs(text: string | null | undefined): number | null {
  const m = cleanText(text).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isFinite(ms) ? ms : null;
}

// 의심 수: 검토함으로 간 줄 중 확률이 기준 이하(또는 확률을 못 읽음)인 수.
// 지금 꺼 둔 칸은 "후원 뒤로 사용 설정이 안 바뀐 경우"에만 뺀다 — 옛날엔 켜졌다가 지금 꺼진 칸의 후보를 숨기지 않기 위해서다.
export function countSuspects({
  decisions,
  catalogItems,
  thresholdPercent,
  thresholdOverrides,
  lastUsageSavedMs,
  policies,
}: {
  decisions: ReadonlyArray<Pick<ReconcileDecision, "decision" | "result">>;
  catalogItems: NormalizedCatalogItem[];
  thresholdPercent: number;
  thresholdOverrides: ThresholdOverrides;
  lastUsageSavedMs: number | null;
  policies: ReadonlyMap<string, MissingKindPolicy>;
}): number {
  // 표에 같은 이름이 있으면 종류 제외를 적용하지 않는다(표와 확률만 다른 진짜 후보까지 묻히지 않게).
  const namesInTable = new Set(catalogItems.map((item) => item.normalizedName));
  let count = 0;
  for (const { decision, result } of decisions) {
    if (decision !== "needs_review") continue;
    const hit = findCatalogMatch(result, catalogItems, { includeDisabled: true });
    if (hit && hit.enabled === false) {
      const donatedMs = parseKstMs(result.donateTimeText);
      const settingChangedAfter = lastUsageSavedMs !== null && (donatedMs === null || donatedMs < lastUsageSavedMs);
      if (!settingChangedAfter) continue;
    }
    const name = cleanText(result.normalizedName) || normalizeName(result.itemName);
    if (!namesInTable.has(name) && policies.get(kindKeyOfResult(result)) === "exclude") continue;
    const threshold =
      hit?.thresholdOverridePercent ?? thresholdForAmount(thresholdOverrides, result.donationAmount, thresholdPercent);
    if (result.probability === null || result.probability === undefined || Number(result.probability) <= threshold) count += 1;
  }
  return count;
}

// 배치 summary 에 의심 수를 얹는다. 0 이나 계산 실패(undefined)면 옛 배치와 같은 모양을 그대로 둔다.
export function withSuspectCount<T extends object>(summary: T, suspectCount: number | undefined): T & { suspectCount?: number } {
  return suspectCount && suspectCount > 0 ? { ...summary, suspectCount } : summary;
}

// 머리 표시용: 배치 summary 행들의 의심 수 합.
export function sumSuspectCounts(rows: ReadonlyArray<{ summary?: unknown }>): number {
  let total = 0;
  for (const row of rows) {
    const summary = row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : null;
    const value = Number(summary?.suspectCount ?? 0);
    if (Number.isFinite(value) && value > 0) total += Math.floor(value);
  }
  return total;
}

// 기준이 이만큼 높으면 확률로 거의 못 거른다(100% 스트리머는 실제 후보 비율이 10% 수준) — 숫자 대신 "확인 필요"만 보여 준다.
export const SUSPECT_NUMBER_MAX_THRESHOLD = 50;
