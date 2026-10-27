"use client";

// 목록 각 줄의 "비번 리셋" 버튼. 확인 한 번 거친 뒤 랜덤 4자리로 리셋하고
// 새 비밀번호를 복사 버튼으로 보여준다(공용 PIN 을 쓰던 시트를 개별 비번으로 옮기는 용도 겸).

import { useActionState, useState } from "react";
import { resetStreamerPinAction, type ResetPinState } from "./actions";
import CopyField from "./CopyField";
import styles from "./admin-index.module.css";

const INITIAL: ResetPinState = {};

export default function PinResetButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(resetStreamerPinAction, INITIAL);
  const [confirming, setConfirming] = useState(false);

  if (state.ok && state.pin) {
    return (
      <div className={styles.resetDone}>
        <CopyField label="새 비밀번호" value={state.pin} />
      </div>
    );
  }

  if (confirming) {
    return (
      <form action={action} className={styles.resetConfirm}>
        <input type="hidden" name="slug" value={slug} />
        <span className={styles.resetWarn}>기존 비번 무효화됨</span>
        <button type="submit" className={styles.resetYes} disabled={pending}>
          {pending ? "…" : "리셋"}
        </button>
        <button type="button" className={styles.resetNo} onClick={() => setConfirming(false)}>
          취소
        </button>
        {state.error ? <span className={styles.resetErr}>{state.error}</span> : null}
      </form>
    );
  }

  return (
    <button type="button" className={styles.resetBtn} onClick={() => setConfirming(true)}>
      비번 리셋
    </button>
  );
}
