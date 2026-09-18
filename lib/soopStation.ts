// 배송관리 공용: 시청자 계정ID → 숲 방송국 주소.
// DeliveryManager(옛 시청자별 목록)와 FinalDeliveryView(시청자별 뷰 헤더)가 같은 링크를 쓴다.
// ch.sooplive.co.kr/{id} 는 www.sooplive.com/station/{id} 로 301 리다이렉트되므로 최종 주소를 바로 쓴다.
// 계정ID가 없으면 null → 버튼을 그리지 않는다.
// (숲이 없는 계정도 200을 주기 때문에 링크가 살아있는지는 미리 확인할 수 없다.)
export function soopStationUrl(fanId: string | null | undefined): string | null {
  const id = (fanId ?? "").trim().toLowerCase();
  if (!id) return null;
  return `https://www.sooplive.com/station/${encodeURIComponent(id)}`;
}
