// 쿠폰 이벤트 → 수동/자동 분리 집계 (2단계 조각 3, 순수 함수).
//
// ★클라이언트(CouponManager)에서도 쓰므로 이 파일은 Node 전용 의존성(node:crypto·supabaseFetch
//   등)을 절대 import 하지 않는다. upboSupabase.ts 를 클라이언트 번들에 끌고 오면 빌드가 깨지기
//   때문에, 이 순수 헬퍼만 별도 파일로 분리했다.
//
// created_by 로 수동("auto" 아님)·자동("auto") delta 합을 (viewerKey, itemKey) 단위로 낸다.
// ★주의: 이 값은 coupon_events 의 delta 합이라 0 클램프가 반영되지 않는다. 즉 현재 잔액(balance)이
//   진실이고, 수동/자동은 참고값이다(수동+자동 ≠ balance 일 수 있음 — 화면에서 balance 우선 표기).

export type CouponEventForAggregate = {
  viewerKey: string;
  itemKey: string;
  delta: number;
  createdBy: string;
};

export type CouponSourceAggregate = {
  viewerKey: string;
  itemKey: string;
  manual: number;
  auto: number;
};

export function aggregateCouponEventsBySource(
  events: CouponEventForAggregate[],
): CouponSourceAggregate[] {
  const acc = new Map<string, CouponSourceAggregate>();
  for (const ev of events) {
    const viewerKey = String(ev.viewerKey || "");
    const itemKey = String(ev.itemKey || "");
    if (!viewerKey || !itemKey) continue;
    const delta = Number(ev.delta);
    if (!Number.isFinite(delta)) continue;
    const mapKey = `${viewerKey}@@${itemKey}`;
    const cur = acc.get(mapKey) ?? { viewerKey, itemKey, manual: 0, auto: 0 };
    if (ev.createdBy === "auto") cur.auto += delta;
    else cur.manual += delta;
    acc.set(mapKey, cur);
  }
  return [...acc.values()];
}
