"use client";

// 목록 각 줄의 "이름 수정" 버튼. 팬 시트 제목에 쓰는 표시 이름(한글 가능)만 바꾼다.
// 슬러그(주소)·비밀번호·확장 토큰·수집 연결은 그대로 둔다.

import { useActionState, useState } from "react";
import { renameStreamerAction, type RenameStreamerState } from "./actions";
import styles from "./admin-index.module.css";

const INITIAL: RenameStreamerState = {};

export default function RenameStreamerButton({ slug, current }: { slug: string; current: string }) {
  const [state, action, pending] = useActionState(renameStreamerAction, INITIAL);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form action={action} className={styles.resetConfirm}>
        <input type="hidden" name="slug" value={slug} />
        <input
          className={styles.renameInput}
          name="displayName"
          defaultValue={state.displayName ?? current}
          maxLength={40}
          placeholder="한글 이름"
          autoFocus
        />
        <button type="submit" className={styles.renameSave} disabled={pending}>
          {pending ? "…" : "저장"}
        </button>
        <button type="button" className={styles.resetNo} onClick={() => setEditing(false)}>
          닫기
        </button>
        {state.error ? <span className={styles.resetErr}>{state.error}</span> : null}
        {state.ok && !state.error ? <span className={styles.renameDone}>저장됨 ✓</span> : null}
      </form>
    );
  }

  return (
    <button type="button" className={styles.resetBtn} onClick={() => setEditing(true)} title="팬 시트 제목에 쓰는 표시 이름 변경 (주소는 그대로)">
      이름 수정
    </button>
  );
}
