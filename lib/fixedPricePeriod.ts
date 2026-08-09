// 정가 기간 판정(순수 모듈, sy 확정 2026-08-09).
// 기준: "위플랩에 찍힌 후원 시각"(donateTimeText, KST) — 수집을 늦게 돌려도 기간 안 후원이면 인정.
// 시각 해석 실패분은 수집 제외 + 카운트(쿠폰 소급 filterCouponEntriesByPeriod 선례와 동일).
// 실패분 구제 경로 = 수동기록의 "정가 시그니처" 옵션.
// 기간 없는 갯수(시그니처·구버전 설정)는 항상 통과 — 기존 판정과 100% 동일.

// 시각 파서 — lib/donationEvents.ts parseDonateTime 과 동일 규칙의 자급자족 사본.
// (테스트 실행용 순수 모듈은 내부 import 를 두지 않는 이 저장소 관례를 따른다 — fanRouletteView.ts 선례.
//  donationEvents.ts 쪽 규칙이 바뀌면 여기도 같이 바꿀 것.)
// "YYYY-MM-DD HH:MM(:SS)" (위플랩 서버 표시, KST) → ISO(+09:00). 실패 시 null.
function parseDonateTime(text: string): string | null {
  const match = String(text ?? "").replace(/\s+/g, " ").trim()
    .match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const pad = (v: string) => v.padStart(2, "0");
  const iso = `${year}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${pad(match[5])}:${pad(match[6] || "0")}+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// 판정에 필요한 최소 정보. startAt/endAt 은 "YYYY-MM-DD"(KST) 또는 빈 값.
export type FixedPriceJudgeEntry = {
  count: number;
  startAt?: string;
  endAt?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// KST 하루 경계: startAt 00:00:00 ~ endAt 23:59:59 (양끝 포함).
function boundsMs(entry: FixedPriceJudgeEntry): { fromMs: number | null; toMs: number | null } {
  const fromMs =
    entry.startAt && DATE_RE.test(entry.startAt) ? Date.parse(`${entry.startAt}T00:00:00+09:00`) : null;
  const toMs =
    entry.endAt && DATE_RE.test(entry.endAt) ? Date.parse(`${entry.endAt}T23:59:59+09:00`) : null;
  return {
    fromMs: fromMs !== null && !Number.isNaN(fromMs) ? fromMs : null,
    toMs: toMs !== null && !Number.isNaN(toMs) ? toMs : null,
  };
}

// 후원 1건이 이 정가 갯수의 수집 대상인지: "in"=기간 안(또는 기간 없음), "out"=기간 밖,
// "unparsed"=기간이 있는데 후원 시각 해석 실패(수집 제외 + 별도 카운트용).
export function judgeFixedPeriod(
  entry: FixedPriceJudgeEntry,
  donateTimeText: string,
): "in" | "out" | "unparsed" {
  const { fromMs, toMs } = boundsMs(entry);
  if (fromMs === null && toMs === null) return "in";
  const iso = parseDonateTime(donateTimeText || "");
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return "unparsed";
  if (fromMs !== null && ms < fromMs) return "out";
  if (toMs !== null && ms > toMs) return "out";
  return "in";
}

// endAt 이 지났는지(«지난 정가» 파생값). now 는 테스트 주입용 — 기본 현재 시각.
export function isFixedPeriodExpired(endAt: string | undefined, now: number = Date.now()): boolean {
  if (!endAt || !DATE_RE.test(endAt)) return false;
  const toMs = Date.parse(`${endAt}T23:59:59+09:00`);
  return !Number.isNaN(toMs) && toMs < now;
}

// endAt 까지 남은 일수(D-day, KST 달력 기준). 기간 없음/해석 불가 = null, 지난 것 = 음수.
export function fixedPeriodDaysLeft(endAt: string | undefined, now: number = Date.now()): number | null {
  if (!endAt || !DATE_RE.test(endAt)) return null;
  const toMs = Date.parse(`${endAt}T23:59:59+09:00`);
  if (Number.isNaN(toMs)) return null;
  return Math.ceil((toMs - now) / 86400000);
}
