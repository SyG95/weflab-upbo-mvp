"use client";

// 대시보드 접근 잠금 화면.
// - blocked: 배포 환경인데 UPBO_ADMIN_TOKEN 미설정 → 안내(로그인 폼 없음)
// - 그 외(locked): 비밀번호 입력 폼

import { useActionState } from "react";
import { unlockAdmin, type UnlockState } from "./actions";
import styles from "./AdminGate.module.css";

export default function AdminGate({
  returnTo,
  blocked,
}: {
  returnTo: string;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockAdmin, {});

  if (blocked) {
    return (
      <div className={styles.card}>
        <div className={styles.lock}>⛔</div>
        <h1 className={styles.title}>관리자 토큰 미설정</h1>
        <p className={styles.desc}>
          배포 환경에서 <code>UPBO_ADMIN_TOKEN</code> 이 설정되지 않아 안전을 위해 접근을 막았습니다. Vercel
          프로젝트 환경변수에 토큰을 설정하면 비밀번호 잠금이 켜집니다.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.lock}>🔒</div>
      <h1 className={styles.title}>관리자 확인</h1>
      <p className={styles.desc}>이 검증 대시보드는 비공개입니다. 관리자 비밀번호를 입력하세요.</p>
      <form action={action} className={styles.form}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          className={styles.input}
          type="password"
          name="password"
          placeholder="관리자 비밀번호"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "들어가기"}
        </button>
        {state.error ? <p className={styles.error}>{state.error}</p> : null}
      </form>
    </div>
  );
}
