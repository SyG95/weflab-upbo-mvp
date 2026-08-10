// 팬 화면 "쿠폰" 탭 (읽기 전용, 표시 전용). 업보 목록과 별개로, 시청자가 모아 둔 쿠폰 잔액만 보여준다.
// 업보 목록(LedgerTable)과 같은 page.module.css 를 재사용해 시각적으로 한 몸처럼 보이게 하되,
// 헤더/라벨은 "쿠폰"으로 명확히 구분한다(업보의 또 다른 보기로 오해되지 않도록).
// 잔액 0은 "사용완료"로 표기(받았고 썼다는 확인), 조회 실패(loadFailed)는 빈 장부와 다른 문구로 구분.
// 묶기/거르기 계산은 lib/fanCouponView.ts(순수) 가 담당 — 여기선 렌더만 한다.
import styles from "./page.module.css";
import type { FanCouponViewer } from "../../lib/fanCouponView";

export default function FanCouponTable({
  viewers,
  searchQuery,
  loadFailed,
  hideIds,
}: {
  viewers: FanCouponViewer[];
  searchQuery: string;
  loadFailed?: boolean;
  // 팬 화면 계정ID 숨기기(스트리머별 설정). 열 자체를 뺀다. 검색은 원문 기준 그대로.
  hideIds?: boolean;
}) {
  if (loadFailed) {
    return (
      <div className={styles.emptyState}>
        <span className={`${styles.stamp} ${styles.stampGhost}`}>오류</span>
        <p>쿠폰 정보를 못 불러왔어요. 새로고침해 보고, 계속 그러면 스트리머에게 알려 주세요.</p>
      </div>
    );
  }
  if (viewers.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={`${styles.stamp} ${styles.stampGhost}`}>대기</span>
        <p>
          {searchQuery
            ? `'${searchQuery}'에 해당하는 시청자가 없어요.`
            : "아직 쌓인 쿠폰이 없어요."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.nameCol}>닉네임</th>
            {hideIds ? null : <th>계정ID</th>}
            <th>쿠폰</th>
            <th className={styles.countCol}>합계</th>
          </tr>
        </thead>
        <tbody>
          {/* 숨김 모드에선 key(계정ID 기반)도 페이지 소스(RSC 페이로드)에 실리므로 행 번호로 대체한다. */}
          {viewers.map((v, i) => (
            <tr key={hideIds ? `r${i}` : v.key}>
              <td className={styles.nameCell}>{v.nickname}</td>
              {hideIds ? null : <td className={styles.idCell}>{v.accountId}</td>}
              <td>
                <div className={styles.upboCell}>
                  {v.coupons.map((c) => (
                    <span key={c.itemName} className={styles.upboChip}>
                      <span className={styles.upboItem}>{c.itemName}</span>
                      {c.balance > 0 ? (
                        <span className={styles.upboCount}>×{c.balance}</span>
                      ) : (
                        // 잔액 0 = 받았고 다 쓴 쿠폰. 숨기지 않고 "사용완료"로 남겨 팬이 확인할 수 있게.
                        <span className={styles.upboDelivered}>사용완료</span>
                      )}
                    </span>
                  ))}
                </div>
              </td>
              <td className={styles.countCell}>{v.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
