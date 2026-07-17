// 팬 "쿠폰" 탭 표시 계산 (순수 함수). fanRouletteView.ts 와 같은 결로, 컴포넌트(FanCouponTable)와
// 페이지(page.tsx)가 이 헬퍼를 공유해 표시 로직을 한 곳에 둔다. CSS/JSX·Node 의존성을 import 하지
// 않아 node --test 로 그대로 검증할 수 있다(couponAggregate.ts 와 같은 분리 이유).
//
// 입력은 coupon_balances 잔액 행의 최소 형태만 요구한다(CouponBalance 와 구조 호환).
// 표시 규칙: 잔액 0(다 쓴 쿠폰)도 남긴다 — 팬이 "받았고 썼다"를 확인할 수 있게 화면에서
// "사용완료"로 표기한다(나월처럼 지급→사용이 바로 도는 패턴에서 탭이 텅 비지 않게).
// 같은 시청자로 묶고, 종류는 잔액 많은 순, 시청자는 합계 많은 순(전부 0인 시청자는 뒤로).

export type CouponBalanceForView = {
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemName: string;
  balance: number;
};

export type FanCouponViewer = {
  key: string;
  nickname: string;
  accountId: string;
  coupons: { itemName: string; balance: number }[];
  total: number;
};

// 잔액 행을 시청자 단위로 묶는다. 0도 유지(사용완료 표기), 음수만 방어적으로 제외(DB CHECK 가 이미 막음).
export function groupFanCoupons(balances: readonly CouponBalanceForView[]): FanCouponViewer[] {
  const map = new Map<string, FanCouponViewer>();
  for (const b of balances) {
    const balance = Number(b.balance);
    if (!Number.isFinite(balance) || balance < 0) continue;
    const key = String(b.viewerKey || "");
    if (!key) continue;
    let v = map.get(key);
    if (!v) {
      v = { key, nickname: b.nickname ?? "", accountId: b.accountId ?? "", coupons: [], total: 0 };
      map.set(key, v);
    }
    // 같은 종류가 여러 행으로 올 일은 없지만 방어적으로 합산한다.
    const existing = v.coupons.find((c) => c.itemName === b.itemName);
    if (existing) existing.balance += balance;
    else v.coupons.push({ itemName: b.itemName, balance });
    v.total += balance;
    if (!v.nickname && b.nickname) v.nickname = b.nickname;
  }
  const out = [...map.values()];
  for (const v of out) v.coupons.sort((a, z) => z.balance - a.balance);
  out.sort((a, z) => z.total - a.total);
  return out;
}

// 업보 목록 검색과 동일하게 닉네임·계정ID 부분일치로 거른다.
export function filterFanCoupons(viewers: readonly FanCouponViewer[], query: string): FanCouponViewer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...viewers];
  return viewers.filter(
    (v) => v.nickname.toLowerCase().includes(q) || v.accountId.toLowerCase().includes(q),
  );
}
