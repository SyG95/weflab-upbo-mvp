"use client";

// 대시보드 접근 잠금 화면.
// - blocked: 배포 환경인데 UPBO_ADMIN_TOKEN 미설정 → 안내(로그인 폼 없음)
// - 그 외(locked): 비밀번호 입력 폼

import { useActionState } from "react";
import { type UnlockState } from "./actions";
import { unlockAdminOrVisitor } from "./visitorActions";
import styles from "./AdminGate.module.css";

export default function AdminGate({
  returnTo,
  blocked,
}: {
  returnTo: string;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockAdminOrVisitor, {});

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
      <h1 className={styles.title}>업보 운영 콘솔</h1>
      <p className={styles.desc}>실제 운영 중인 스트리머와 수집 현황을 확인할 수 있어요.</p>
      <p className={styles.visitorNote}>
        방문자 비밀번호 <strong>1234</strong><br />
        방문자는 공개 운영 현황만 조회할 수 있어요. 설정 변경과 개인별 원본 기록은 잠겨 있어요.
      </p>
      <form action={action} className={styles.form}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          aria-label="운영자 또는 방문자 비밀번호"
          className={styles.input}
          type="password"
          name="password"
          placeholder="운영자 또는 방문자 비밀번호"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "들어가기"}
        </button>
        {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      </form>
    </div>
  );
}
