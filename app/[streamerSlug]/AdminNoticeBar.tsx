"use client";

// 관리자 머리말 공지 한 줄 + 닫기. 기한과 이 브라우저의 "닫음" 기억을 여기서 함께 본다.
// 첫 화면에서는 숨겨 두었다가 기억을 읽은 뒤에 보여서, 닫은 사람에게 공지가 번쩍 보였다 사라지지 않게 한다.

import { useEffect, useState } from "react";
import { noticeStorageKey, noticeVisible, type AdminNotice } from "../../lib/adminNotice";
import styles from "./page.module.css";

export default function AdminNoticeBar({ notice }: { notice: AdminNotice }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let closed = false;
    try {
      closed = window.localStorage.getItem(noticeStorageKey(notice.id)) === "1";
    } catch {
      closed = false; // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 기한까지 보여 준다
    }
    // 브라우저 저장소는 화면을 그린 뒤에만 읽을 수 있어 여기서 한 번 상태를 맞춘다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(noticeVisible(notice, Date.now(), closed));
  }, [notice]);

  if (!show) return null;
  return (
    <aside className={styles.adminNotice} aria-label="업데이트 안내">
      <p className={styles.adminNoticeText}>{notice.text}</p>
      <button
        type="button"
        className={styles.adminNoticeClose}
        aria-label="공지 닫기 (다시 보이지 않음)"
        onClick={() => {
          try {
            window.localStorage.setItem(noticeStorageKey(notice.id), "1");
          } catch {
            // 저장 못 해도 지금 화면에서는 닫는다
          }
          setShow(false);
        }}
      >
        ×
      </button>
    </aside>
  );
}
