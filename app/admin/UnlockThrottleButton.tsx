"use client";

// 목록 각 줄의 "잠금 풀기" 버튼. 비밀번호를 여러 번 틀려 잠긴 시트 관리자·확프 연결·후원집계를
// 비밀번호를 바꾸지 않고 바로 풀어 준다(누가 일부러 틀려 스트리머가 잠겼을 때).

import { useActionState } from "react";
import { unlockStreamerThrottleAction, type UnlockThrottleState } from "./actions";
import styles from "./admin-index.module.css";

const INITIAL: UnlockThrottleState = {};

export default function UnlockThrottleButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(unlockStreamerThrottleAction, INITIAL);

  if (state.ok) return <span className={styles.resetDone}>잠금 풀림</span>;

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" className={styles.resetBtn} disabled={pending} title="비밀번호를 여러 번 틀려 잠긴 상태만 풀어요(비번은 그대로)">
        {pending ? "…" : "잠금 풀기"}
      </button>
      {state.error ? <span className={styles.resetErr}>{state.error}</span> : null}
    </form>
  );
}
