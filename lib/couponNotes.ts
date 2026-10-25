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
//      단, 그 적립 시각에 그 상품이 그 쿠폰에 연결돼 있지 않았던 게 연결 이력으로 확실하면 거기 숨어 있을 수
//      없으므로 확실 쪽으로 돌린다(예: 쿠폰에 새 상품을 연결하고 전체 기간 소급 — 리뷰 M2).
//   3) 교환으로 받은 상품의 열쇠("exchange:<묶음>:<n>")는 묶음마다 따로 조각을 만든다. 교환 되돌리기는
//      메모에 그 묶음이 든 조각을 통째로 회수하므로, 룰렛 당첨·다른 묶음과 섞이면 남의 몫까지 회수된다(리뷰 L3).

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

// 교환 받은 상품 열쇠의 묶음 표시("exchange:<묶음>:") — 룰렛 당첨 열쇠는 "".
// 교환 되돌리기의 메모 검색(note like *exchange:<묶음>:*)과 같은 모양이다.
export function accrualKeyGroup(key: string): string {
  if (!key.startsWith("exchange:")) return "";
  const end = key.indexOf(":", "exchange:".length);
  return end > 0 ? key.slice(0, end + 1) : key;
}

// 키 순서를 지키며 note 가 maxLen 이하가 되게 묶는다. groupOf 가 다른 키는 같은 묶음에 넣지 않는다.
// 키 하나가 혼자서도 넘치면(현실적으로 없음 — 열쇠는 30자 안팎) 그 키만 따로.
export function packAccrualKeys(
  keys: string[],
  maxLen = COUPON_NOTE_MAX,
  groupOf: (key: string) => string = () => "",
): string[][] {
  const packs: string[][] = [];
  let current: string[] = [];
  let currentGroup = "";
  let length = COUPON_AUTO_NOTE_PREFIX.length;
  for (const key of keys) {
    const group = groupOf(key);
    const add = (current.length > 0 ? 1 : 0) + key.length;
    if (current.length > 0 && (length + add > maxLen || group !== currentGroup)) {
      packs.push(current);
      current = [];
      length = COUPON_AUTO_NOTE_PREFIX.length;
    }
    if (current.length === 0) currentGroup = group;
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
  // 룰렛 당첨 열쇠 먼저, 그다음 교환 묶음별로 모아 묶음마다 따로 조각을 만든다(머리 주석 3).
  const byGroup = new Map<string, string[]>();
  for (const key of keys) {
    const group = accrualKeyGroup(key);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(key);
  }
  const ordered = [...(byGroup.get("") ?? []), ...[...byGroup].filter(([group]) => group !== "").flatMap(([, ks]) => ks)];
  const deltaByKey = new Map<string, number>();
  if (input.parts && input.parts.length > 0) {
    for (const part of input.parts) {
      const d = Number(part.delta);
      deltaByKey.set(part.sourceKey, (deltaByKey.get(part.sourceKey) ?? 0) + (Number.isFinite(d) && d > 0 ? d : 0));
    }
  } else {
    deltaByKey.set(ordered[0], total); // 키별 증가분을 모르면 첫 묶음에 몰아 담는다
  }
  const slices: AccrualEventSlice[] = [];
  let running = prev;
  let remaining = total;
  for (const pack of packAccrualKeys(ordered, COUPON_NOTE_MAX, accrualKeyGroup)) {
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
  cutoffAt: string; // 이 당첨들이 숨어 있을 수 있는 잘린 적립 중 가장 늦은 시각(ISO)
  sourceKeys: string[]; // 서버 안에서 상품별 건수를 셀 때만 쓴다(화면으로는 안 보낸다)
};

// 잘린 적립 시각 markMs 에 이 당첨(sourceKey)의 상품이 itemKey 쿠폰에 연결돼 있었나:
// true=연결됨, false=연결 안 됨이 확실, null=모름(이력 없음 등).
export type CouponLinkCheck = (markMs: number, sourceKey: string, itemKey: string) => boolean | null;

// 쿠폰 연결 저장본 1개(audit coupon_source_map_updated). links: 쿠폰 itemKey → 정규화한 상품명들.
export type CouponLinkSnapshot = { atMs: number; links: Map<string, Set<string>> };

// 연결을 읽은 뒤 적립 줄을 쓰기까지의 틈(요청 한 번)에 연결이 바뀌었을 수 있다 —
// 적립 시각 직전 이만큼 안의 저장본은 전부 "그때 쓰였을 수 있는 연결"로 본다.
// ★Vercel 함수 최대 시간(지금 Hobby 300초, Pro 로 올려도 최대 800초)보다 반드시 길어야 한다. 짧으면 실제로
//   쓴 저장본이 빠져 "연결 안 됨"으로 오판 → 숨은 열쇠 이중 적립(리뷰 LOW-1). maxDuration 을 올릴 때 같이 볼 것.
export const COUPON_LINK_GUARD_MS = 15 * 60 * 1000;

// 연결 이력 + 당첨별 정규화 상품명 → CouponLinkCheck. "연결 안 됨"은 그때 쓰였을 수 있는 저장본 전부에서
// 그 쿠폰의 연결 목록에 상품이 없을 때만 확실하다. 그 쿠폰 연결이 아예 안 보이면(잘린 적립이 있었는데
// 연결이 없을 수는 없다 = 이력이 빈 것) 모름.
export function couponLinkCheckFromHistory(
  history: CouponLinkSnapshot[],
  productByKey: Map<string, string>,
): CouponLinkCheck {
  const snaps = [...history].filter((s) => Number.isFinite(s.atMs)).sort((a, b) => a.atMs - b.atMs);
  return (markMs, sourceKey, itemKey) => {
    const product = productByKey.get(sourceKey);
    if (!product) return null;
    const from = markMs - COUPON_LINK_GUARD_MS;
    let base: CouponLinkSnapshot | null = null;
    const usable: CouponLinkSnapshot[] = [];
    for (const snap of snaps) {
      if (snap.atMs <= from) base = snap;
      else if (snap.atMs <= markMs) usable.push(snap);
      else break;
    }
    if (base) usable.unshift(base);
    let sawCoupon = false;
    for (const snap of usable) {
      const products = snap.links.get(itemKey);
      if (!products) continue;
      sawCoupon = true;
      if (products.has(product)) return true;
    }
    return sawCoupon ? false : null;
  };
}

// 소급 적립 후보를 "확실/확인 불가"로 나눈다.
// 확인 불가 = 그 (시청자, 쿠폰)에 잘린 옛 적립이 있고, 당첨이 그 적립 시각 이전(같은 시각 포함, 또는 시각 모름)에
// 생겼으며, 그 적립 시각에 상품이 그 쿠폰에 연결돼 있지 않았다고 확실히 말할 수 없는 것.
export function splitAccrualsByTruncation<A extends AccrualLike>(
  accruals: A[],
  marks: TruncatedAccrualMark[],
  createdAtByKey: Map<string, string | undefined>,
  wasLinkedAt?: CouponLinkCheck,
): { certain: A[]; uncertain: UncertainAccrualRow[] } {
  if (marks.length === 0) return { certain: accruals, uncertain: [] };
  const marksByPair = new Map<string, number[]>();
  for (const mark of marks) {
    const ms = Date.parse(mark.createdAt);
    if (!Number.isFinite(ms)) continue;
    const pair = `${mark.viewerKey}@@${mark.itemKey}`;
    if (!marksByPair.has(pair)) marksByPair.set(pair, []);
    marksByPair.get(pair)!.push(ms);
  }
  const certain: A[] = [];
  const uncertain: UncertainAccrualRow[] = [];
  const toRow = (accrual: A, sourceKeys: string[], delta: number, cutoffMs: number): UncertainAccrualRow => ({
    viewerKey: accrual.viewerKey,
    nickname: accrual.nickname,
    accountId: accrual.accountId,
    itemKey: accrual.itemKey,
    itemName: accrual.itemName,
    entryCount: sourceKeys.length,
    delta,
    cutoffAt: new Date(cutoffMs).toISOString(),
    sourceKeys,
  });
  for (const accrual of accruals) {
    const pairMarks = marksByPair.get(`${accrual.viewerKey}@@${accrual.itemKey}`);
    if (!pairMarks || pairMarks.length === 0) {
      certain.push(accrual);
      continue;
    }
    const latestMark = Math.max(...pairMarks);
    // 이 당첨이 숨어 있을 수 있는 잘린 적립 중 가장 늦은 시각 — 없으면 null(확실).
    const blockingMark = (sourceKey: string): number | null => {
      const created = createdAtByKey.get(sourceKey);
      const createdMs = created ? Date.parse(created) : Number.NaN;
      if (!Number.isFinite(createdMs)) return latestMark; // 시각을 모르면 확인 불가
      let worst: number | null = null;
      for (const markMs of pairMarks) {
        if (markMs < createdMs) continue; // 당첨보다 먼저 쓴 적립엔 들어갈 수 없다
        if (wasLinkedAt && wasLinkedAt(markMs, sourceKey, accrual.itemKey) === false) continue;
        worst = worst === null ? markMs : Math.max(worst, markMs);
      }
      return worst;
    };
    if (!accrual.parts || accrual.parts.length === 0) {
      // 키별 몫을 모르면 나눌 수 없다 — 하나라도 확인 불가면 통째로 확인 불가(덜 지급 쪽, 리뷰 L5).
      const blocks = accrual.sourceKeys.map(blockingMark).filter((m): m is number => m !== null);
      if (accrual.sourceKeys.length === 0 || blocks.length > 0) {
        uncertain.push(toRow(accrual, accrual.sourceKeys, accrual.delta, blocks.length > 0 ? Math.max(...blocks) : latestMark));
      } else {
        certain.push(accrual);
      }
      continue;
    }
    const kept: AccrualPart[] = [];
    const dropped: AccrualPart[] = [];
    let cutoffMs = Number.NEGATIVE_INFINITY;
    for (const part of accrual.parts) {
      const markMs = blockingMark(part.sourceKey);
      if (markMs === null) {
        kept.push(part);
      } else {
        dropped.push(part);
        cutoffMs = Math.max(cutoffMs, markMs);
      }
    }
    if (dropped.length > 0) {
      uncertain.push(
        toRow(
          accrual,
          dropped.map((p) => p.sourceKey),
          dropped.reduce((sum, p) => sum + p.delta, 0),
          cutoffMs,
        ),
      );
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
