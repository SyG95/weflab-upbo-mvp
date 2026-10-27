// ---------- 수동기록 겹침 의심(1단계 묶음 3, G11) — 순수 로직 ----------
//
// 왜 필요한가:
//   검토함에 갇힌 당첨을 스트리머가 이미 수동기록으로 넣어 둔 경우가 많다(10/24·10/23 검수 사례).
//   후원 시점 근사 판정이 같은 당첨을 또 "새로 기록될 것"으로 내면 두 번 들어간다. 수동기록은 원본 키가 없어
//   중복 방지(unique source_key)가 못 잡는다 → 사람·상품·날짜로 "같은 건일 수 있다"를 표시만 한다(덮어쓰지 않음, D9).
//
// 규칙(PHASE1-TEST-PLAN.md §3-3, 2026-10-27 리뷰 반영):
//   강한 의심 = 계정ID 같음 + 상품 알맹이(itemNameCore) 같음 + 날짜 ±1일(KST 달력) 또는 날짜 없음
//   약한 의심 = 계정ID 같음(또는 계정ID 없는 쪽의 닉네임 같음) + 상품 알맹이 같음·이름 포함 관계 + 아래 중 하나
//     - 날짜 ±1일 또는 날짜 없음
//     - 수동기록 날짜가 후원 뒤 30일 안(늦게 발견해 "기록한 날"을 적은 경우)
//     - 수동기록을 만든 시각이 후원 뒤(날짜 칸과 무관하게)
//   상품 이름은 원본 이름·그때 표 칸 이름·이름 연결 대상 이름 중 하나라도 맞으면 같은 상품으로 본다
//   (그때 표엔 옛 이름이 있는데 수동기록은 새 이름으로 적은 경우). 취소를 반영해 남은 개수가 0인 수동기록은 뺀다.
import { normalizeAccountId, parseDonateTimeMs } from "./api";
import { cleanText } from "./upboCore";
import { itemNameCore } from "./itemAlias";

export type ManualOverlapEntry = {
  id: string;
  fanId: string;
  fanNickname: string;
  itemName: string;
  donateTimeText: string; // "" = 날짜 모름
  remaining: number; // 취소 반영 뒤 남은 개수
  createdAt?: string | null; // 수동기록을 만든 시각(ISO)
};

export type ManualOverlap = { level: "strong" | "weak"; manualEntryId: string; summary: string };

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const LATE_RECORD_DAYS = 30;

function kstDay(msValue: number): number {
  return Math.floor((msValue + KST_OFFSET_MS) / DAY_MS);
}

function sameId(a: string, b: string): boolean {
  const x = normalizeAccountId(a).toLowerCase();
  const y = normalizeAccountId(b).toLowerCase();
  return x !== "" && x === y;
}

function dateLabel(msValue: number | null): string {
  if (msValue === null) return "날짜 없는";
  const d = new Date(msValue + KST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function findManualOverlaps(
  row: { fanId: string; fanNickname: string; itemName: string; donateTimeText: string; itemNames?: string[] },
  manualEntries: ManualOverlapEntry[],
): ManualOverlap | null {
  const rowCores = [...new Set([row.itemName, ...(row.itemNames ?? [])].map(itemNameCore).filter((core) => core !== ""))];
  const rowMs = parseDonateTimeMs(row.donateTimeText);
  let weak: ManualOverlap | null = null;
  for (const m of manualEntries) {
    if (!(m.remaining > 0)) continue;
    const idMatch = sameId(m.fanId, row.fanId);
    // 계정ID 없이 닉네임만 적은 수동기록(또는 원본에 계정ID가 없는 줄)은 닉네임으로만 맞춰 본다 — 약한 의심까지만.
    const nickOnly =
      (!normalizeAccountId(m.fanId) || !normalizeAccountId(row.fanId)) &&
      cleanText(m.fanNickname) !== "" &&
      cleanText(m.fanNickname) === cleanText(row.fanNickname);
    if (!idMatch && !nickOnly) continue;
    const core = itemNameCore(m.itemName);
    if (!core) continue;
    const coreEqual = rowCores.includes(core);
    const partial = rowCores.some((rc) => core.includes(rc) || rc.includes(core));
    if (!coreEqual && !partial) continue;
    const mMs = parseDonateTimeMs(m.donateTimeText);
    const near = mMs === null || rowMs === null || Math.abs(kstDay(mMs) - kstDay(rowMs)) <= 1;
    const lateDated = mMs !== null && rowMs !== null && kstDay(mMs) >= kstDay(rowMs) && kstDay(mMs) - kstDay(rowMs) <= LATE_RECORD_DAYS;
    const createdMs = m.createdAt ? Date.parse(m.createdAt) : NaN;
    const createdAfter = rowMs !== null && Number.isFinite(createdMs) && createdMs >= rowMs;
    if (!near && !lateDated && !createdAfter) continue;
    const summary = `${dateLabel(mMs)} 수동기록(${cleanText(m.itemName)} ×${m.remaining})`;
    if (idMatch && coreEqual && near) return { level: "strong", manualEntryId: m.id, summary };
    if (!weak) weak = { level: "weak", manualEntryId: m.id, summary };
  }
  return weak;
}
