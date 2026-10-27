// ---------- 수동기록 겹침 의심(1단계 묶음 3, G11) — 순수 로직 ----------
//
// 왜 필요한가:
//   검토함에 갇힌 당첨을 스트리머가 이미 수동기록으로 넣어 둔 경우가 많다(밍가연 10/24, 깡총총 10/23).
//   후원 시점 근사 판정이 같은 당첨을 또 "새로 기록될 것"으로 내면 두 번 들어간다. 수동기록은 원본 키가 없어
//   중복 방지(unique source_key)가 못 잡는다 → 사람·상품·날짜로 "같은 건일 수 있다"를 표시만 한다(덮어쓰지 않음, D9).
//
// 규칙(PHASE1-TEST-PLAN.md §3-3):
//   강한 의심 = 계정ID 같음 + 상품 알맹이(itemNameCore) 같음 + 날짜 ±1일(KST 달력)
//   약한 의심 = 계정ID 같음(또는 계정ID 없는 수동기록의 닉네임 같음) + 상품 이름 포함 관계(또는 알맹이 같음) + 날짜 ±1일
//   날짜 없는 수동기록은 기간과 무관하게 의심한다. 취소를 반영해 남은 개수가 0인 수동기록은 뺀다.
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
};

export type ManualOverlap = { level: "strong" | "weak"; manualEntryId: string; summary: string };

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

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
  row: { fanId: string; fanNickname: string; itemName: string; donateTimeText: string },
  manualEntries: ManualOverlapEntry[],
): ManualOverlap | null {
  const rowCore = itemNameCore(row.itemName);
  const rowMs = parseDonateTimeMs(row.donateTimeText);
  let weak: ManualOverlap | null = null;
  for (const m of manualEntries) {
    if (!(m.remaining > 0)) continue;
    const idMatch = sameId(m.fanId, row.fanId);
    // 계정ID 없이 닉네임만 적은 수동기록(또는 원본에 계정ID가 없는 줄)은 닉네임으로만 맞춰 본다 — 약한 의심까지만.
    const nickOnly = (!normalizeAccountId(m.fanId) || !normalizeAccountId(row.fanId)) && cleanText(m.fanNickname) !== "" && cleanText(m.fanNickname) === cleanText(row.fanNickname);
    if (!idMatch && !nickOnly) continue;
    const core = itemNameCore(m.itemName);
    const coreEqual = core !== "" && core === rowCore;
    const partial = core !== "" && rowCore !== "" && (core.includes(rowCore) || rowCore.includes(core));
    if (!coreEqual && !partial) continue;
    const mMs = parseDonateTimeMs(m.donateTimeText);
    const dateOk = mMs === null || rowMs === null || Math.abs(kstDay(mMs) - kstDay(rowMs)) <= 1;
    if (!dateOk) continue;
    const summary = `${dateLabel(mMs)} 수동기록(${cleanText(m.itemName)} ×${m.remaining})`;
    if (idMatch && coreEqual) return { level: "strong", manualEntryId: m.id, summary };
    if (!weak) weak = { level: "weak", manualEntryId: m.id, summary };
  }
  return weak;
}
