"use client";

// 팬 시트 관리자 모드 잠금 화면. app/admin/AdminGate.tsx 패턴을 시트(장부) 톤으로 옮긴 것.
// - blocked: 배포 환경인데 UPBO_SHEET_ADMIN_PIN 미설정 → 안내(입력 폼 없음)
// - 그 외(locked): 비밀번호 입력 폼

import { useActionState } from "react";
import { unlockSheetAdmin, type SheetUnlockState } from "./sheetAdminActions";
import styles from "./sheetAdminGate.module.css";

export default function SheetAdminGate({
  slug,
  returnTo,
  blocked,
}: {
  slug: string;
  returnTo: string;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<SheetUnlockState, FormData>(unlockSheetAdmin, {});

  if (blocked) {
    return (
      <div className={styles.card}>
        <div className={styles.lock}>⛔</div>
        <h2 className={styles.title}>관리자 비밀번호 미설정</h2>
        <p className={styles.desc}>
          배포 환경에서 <code>UPBO_SHEET_ADMIN_PIN</code> 이 설정되지 않아 안전을 위해 관리자 화면을
          막았습니다. Vercel 환경변수에 비밀번호를 설정하면 잠금이 켜집니다.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.lock}>🔒</div>
      <h2 className={styles.title}>관리자 확인</h2>
      <p className={styles.desc}>관리자 화면은 비공개예요. 비밀번호를 입력해 주세요.</p>
      <form action={action} className={styles.form}>
        <input type="hidden" name="slug" value={slug} />
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
