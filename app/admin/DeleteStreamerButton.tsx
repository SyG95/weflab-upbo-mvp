"use client";

// 스트리머 완전 삭제 버튼(온보딩 콘솔 전용). 되돌릴 수 없으므로
// 슬러그를 똑같이 타이핑해야만 실행되는 type-to-confirm 방식.

import { useActionState, useState } from "react";
import { deleteStreamerAction, type DeleteStreamerState } from "./actions";
import styles from "./admin-index.module.css";

const INITIAL: DeleteStreamerState = {};

export default function DeleteStreamerButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(deleteStreamerAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (state.ok) {
    return <span className={styles.deleteDone}>삭제됨</span>;
  }

  if (!open) {
    return (
      <button type="button" className={styles.deleteBtn} onClick={() => setOpen(true)}>
        삭제
      </button>
    );
  }

  return (
    <form action={action} className={styles.deleteConfirm}>
      <input type="hidden" name="slug" value={slug} />
      <p className={styles.deleteWarnText}>
        <b>/{slug}</b> 의 토큰·수집기록·시트 데이터가 <b>전부 영구 삭제</b>돼요. 되돌릴 수 없어요.
        확인하려면 슬러그를 똑같이 입력하세요.
      </p>
      <div className={styles.deleteRow}>
        <input
          className={styles.deleteInput}
          name="confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={slug}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className={styles.deleteYes}
          disabled={pending || typed.trim().toLowerCase() !== slug}
        >
          {pending ? "삭제 중…" : "영구 삭제"}
        </button>
        <button
          type="button"
          className={styles.resetNo}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          취소
        </button>
      </div>
      {state.error ? <span className={styles.resetErr}>{state.error}</span> : null}
    </form>
  );
}
