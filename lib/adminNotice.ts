// 관리자 화면 머리말의 기간 한정 공지(닫기 가능).
// 닫으면 그 브라우저에만 기억한다(localStorage, 운영 DB 쓰기 없음 — sy 10/27 결정). 기한이 지나면 아무도 안 본다.
// 새 공지를 올릴 땐 id 를 바꾼다(같은 id 면 예전에 닫은 사람은 계속 안 본다).

export type AdminNotice = { id: string; until: string; text: string };

export const THEME_UPDATE_NOTICE: AdminNotice = {
  id: "theme-update-2026-10-27",
  // 배포일(10/27) 기준 7일 — 11/3 자정(KST)에 모든 화면에서 사라진다.
  until: "2026-11-03T00:00:00+09:00",
  text: "시트 테마가 업데이트됐어요.",
};

export const noticeStorageKey = (id: string) => `upbo-notice-closed:${id}`;

// 지금 보여야 하나: 기한 전이고, 이 브라우저에서 닫지 않았으면
export function noticeVisible(notice: AdminNotice, nowMs: number, closed: boolean): boolean {
  return !closed && nowMs < Date.parse(notice.until);
}
