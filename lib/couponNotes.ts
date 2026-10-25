// ---------- 쿠폰 자동 적립 메모(재적립 방지 열쇠) — 순수 로직 ----------
//
// 왜 필요한가(2026-10-25 1단계 묶음 2):
//   자동 적립 이벤트(coupon_events, created_by="auto")의 note 에 "auto:" + 기여한 당첨 sourceKey 들을
//   쉼표로 이어 붙이고, 재적립 방지가 이 note 를 다시 읽는다. 그런데 note 를 500자에서 잘라 저장해 왔다
//   (slice(0,500)). 한 (시청자, 쿠폰)에 키가 약 17개를 넘으면 뒤쪽 키가 사라져, 같은 기간을 다시 소급하면
//   그 당첨들이 "새 적립"으로 한 번 더 쌓였다(예: 새 쿠폰 연결을 추가하고 전체 기간 소급).
//
// 고친 방식(스키마 변경 없음):
//   1) 새 적립은 키 묶음마다 이벤트를 나눠 써서 note 가 항상 COUPON_NOTE_MAX(499)자 이하가 되게 한다.
//      잔액 변화는 묶음 순서대로 나눠 담는다(이전·다음 잔액이 이어짐, 합계 = 실제 증가분).
//   2) 길이가 500자 이상인 옛 note 는 잘렸을 수 있으므로 마지막 조각(잘린 키일 수 있음)을 버린다.
//      그 (시청자, 쿠폰)에서 그 적립 시각 이전에 생긴 당첨은 이미 받았는지 알 수 없으니,
//      소급에서 자동 적립하지 않고 "확인 불가"로 따로 센다(이중 지급보다 덜 지급이 안전).

export const COUPON_AUTO_NOTE_PREFIX = "auto:";
export const COUPON_NOTE_MAX = 499; // 새로 쓰는 note 의 최대 길이(500 미만 — 500 이상은 옛 잘림으로 판정)
export const COUPON_NOTE_TRUNCATED_LEN = 500; // 옛 코드가 slice(0,500) 하던 길이

export type AccrualPart = { sourceKey: string; delta: number };

// computeCouponAccruals 결과와 같은 모양(구조적 호환). parts 는 키별 증가분(없으면 첫 묶음에 몰아 담음).
export type AccrualLike = {
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string;
  delta: number;
  sourceKeys: string[];
  parts?: AccrualPart[];
};

export type AccrualEventSlice = {
  sourceKeys: string[];
  previous: number;
  next: number;
  note: string;
};

export function buildAccrualNote(keys: string[]): string {
  return `${COUPON_AUTO_NOTE_PREFIX}${keys.join(",")}`;
}

// 키 순서를 지키며 note 가 maxLen 이하가 되게 묶는다. 키 하나가 혼자서도 넘치면(현실적으로 없음) 그 키만 따로.
export function packAccrualKeys(keys: string[], maxLen = COUPON_NOTE_MAX): string[][] {
  const packs: string[][] = [];
  let current: string[] = [];
  let length = COUPON_AUTO_NOTE_PREFIX.length;
  for (const key of keys) {
    const add = (current.length > 0 ? 1 : 0) + key.length;
    if (current.length > 0 && length + add > maxLen) {
      packs.push(current);
      current = [];
      length = COUPON_AUTO_NOTE_PREFIX.length;
    }
    current.push(key);
    length += (current.length > 1 ? 1 : 0) + key.length;
  }
  if (current.length > 0) packs.push(current);
  return packs;
}

// 한 (시청자, 쿠폰) 적립을 이벤트 조각들로 나눈다. prev→next 는 상한 클램프까지 반영된 실제 잔액 변화.
// 조각마다 그 묶음 키들의 증가분만큼(남은 실제 증가분 안에서) 담고, 이전·다음 잔액을 이어 붙인다.
export function splitAccrualIntoEvents(input: {
  sourceKeys: string[];
  parts?: AccrualPart[];
  prev: number;
  next: number;
}): AccrualEventSlice[] {
  const { prev, next } = input;
  const total = Math.max(0, next - prev);
  const keys = input.sourceKeys.length > 0 ? input.sourceKeys : (input.parts ?? []).map((p) => p.sourceKey);
  if (keys.length === 0) {
    return [{ sourceKeys: [], previous: prev, next: prev + total, note: buildAccrualNote([]) }];
  }
  const deltaByKey = new Map<string, number>();
  if (input.parts && input.parts.length > 0) {
    for (const part of input.parts) {
      const d = Number(part.delta);
      deltaByKey.set(part.sourceKey, (deltaByKey.get(part.sourceKey) ?? 0) + (Number.isFinite(d) && d > 0 ? d : 0));
    }
  } else {
    deltaByKey.set(keys[0], total); // 키별 증가분을 모르면 첫 묶음에 몰아 담는다
  }
  const slices: AccrualEventSlice[] = [];
  let running = prev;
  let remaining = total;
  for (const pack of packAccrualKeys(keys)) {
    const packDelta = pack.reduce((sum, key) => sum + (deltaByKey.get(key) ?? 0), 0);
    const take = Math.min(packDelta, remaining);
    slices.push({ sourceKeys: pack, previous: running, next: running + take, note: buildAccrualNote(pack) });
    running += take;
    remaining -= take;
  }
  // 키별 증가분 합이 실제 증가분보다 작으면(입력 불일치) 남은 몫을 마지막 조각에 붙여 합계를 맞춘다.
  if (remaining > 0) {
    const last = slices[slices.length - 1];
    last.next += remaining;
  }
  return slices;
}

// 자동 적립 note → 열쇠 목록. 500자 이상이면 잘렸을 수 있어 마지막 조각을 버리고 truncated=true.
export function parseAutoAccrualNote(note: string | null | undefined): { keys: string[]; truncated: boolean } | null {
  const text = note ?? "";
  if (!text.startsWith(COUPON_AUTO_NOTE_PREFIX)) return null;
  const truncated = text.length >= COUPON_NOTE_TRUNCATED_LEN;
  const segments = text.slice(COUPON_AUTO_NOTE_PREFIX.length).split(",");
  if (truncated) segments.pop();
  return { keys: segments.map((s) => s.trim()).filter(Boolean), truncated };
}

export type TruncatedAccrualMark = { viewerKey: string; itemKey: string; createdAt: string };

export type UncertainAccrualRow = {
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string;
  entryCount: number;
  delta: number;
};

// 소급 적립 후보를 "확실/확인 불가"로 나눈다.
// 확인 불가 = 그 (시청자, 쿠폰)에 잘린 옛 적립이 있고, 당첨이 그 적립 시각 이전(또는 시각 모름)에 생긴 것.
export function splitAccrualsByTruncation<A extends AccrualLike>(
  accruals: A[],
  marks: TruncatedAccrualMark[],
  createdAtByKey: Map<string, string | undefined>,
): { certain: A[]; uncertain: UncertainAccrualRow[] } {
  if (marks.length === 0) return { certain: accruals, uncertain: [] };
  const latestMark = new Map<string, number>();
  for (const mark of marks) {
    const ms = Date.parse(mark.createdAt);
    if (!Number.isFinite(ms)) continue;
    const key = `${mark.viewerKey}@@${mark.itemKey}`;
    latestMark.set(key, Math.max(latestMark.get(key) ?? Number.NEGATIVE_INFINITY, ms));
  }
  const certain: A[] = [];
  const uncertain: UncertainAccrualRow[] = [];
  for (const accrual of accruals) {
    const cutoff = latestMark.get(`${accrual.viewerKey}@@${accrual.itemKey}`);
    if (cutoff === undefined) {
      certain.push(accrual);
      continue;
    }
    const parts: AccrualPart[] =
      accrual.parts && accrual.parts.length > 0
        ? accrual.parts
        : accrual.sourceKeys.map((sourceKey, i) => ({ sourceKey, delta: i === 0 ? accrual.delta : 0 }));
    const isUncertain = (part: AccrualPart) => {
      const created = createdAtByKey.get(part.sourceKey);
      const ms = created ? Date.parse(created) : Number.NaN;
      return !Number.isFinite(ms) || ms <= cutoff;
    };
    const kept = parts.filter((p) => !isUncertain(p));
    const dropped = parts.filter((p) => isUncertain(p));
    if (dropped.length > 0) {
      uncertain.push({
        viewerKey: accrual.viewerKey,
        nickname: accrual.nickname,
        accountId: accrual.accountId,
        itemKey: accrual.itemKey,
        itemName: accrual.itemName,
        entryCount: dropped.length,
        delta: dropped.reduce((sum, p) => sum + p.delta, 0),
      });
    }
    if (kept.length > 0) {
      certain.push({
        ...accrual,
        delta: kept.reduce((sum, p) => sum + p.delta, 0),
        sourceKeys: kept.map((p) => p.sourceKey),
        parts: kept,
      });
    }
  }
  return { certain: certain.filter((a) => a.delta > 0), uncertain };
}
