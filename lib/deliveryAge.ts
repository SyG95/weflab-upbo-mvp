// 배송관리 공용: 기록 시각으로부터의 경과일(그날=1일째)과 "오래 밀림" 강조 기준.
// DeliveryManager(옛 시청자별 목록·시트 보기)와 FinalDeliveryView(월별 배송관리 뷰)가 같은 규칙을 쓴다.
export const AGE_OLD_DAYS = 30;
export function ageDaysFrom(ms: number, nowMs: number): number {
  return Math.max(1, Math.floor((nowMs - ms) / 86_400_000) + 1);
}
