"use client";

// 후원집계 잠금 화면. SheetAdminGate 패턴을 후원 원장 톤으로 옮긴 것.
// - blocked: 배포 환경인데 UPBO_DONATION_ADMIN_PIN 미설정 → 안내(입력 폼 없음)
// - 그 외(locked): 비밀번호 입력 폼

import { useActionState } from "react";
import { unlockDonationAdmin, type DonationUnlockState } from "./donationActions";
import styles from "./donations.module.css";

export default function DonationGate({
  slug,
  returnTo,
  blocked,
}: {
  slug: string;
  returnTo: string;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<DonationUnlockState, FormData>(unlockDonationAdmin, {});

  if (blocked) {
    return (
      <div className={styles.gateCard}>
        <div className={styles.gateLock}>⛔</div>
        <h2 className={styles.gateTitle}>후원집계 비밀번호 미설정</h2>
        <p className={styles.gateDesc}>
          배포 환경에서 <code>UPBO_DONATION_ADMIN_PIN</code> 이 설정되지 않아 안전을 위해 후원집계
          화면을 막았습니다. Vercel 환경변수에 비밀번호를 설정하면 잠금이 켜집니다.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.gateCard}>
      <div className={styles.gateLock}>🔒</div>
      <h2 className={styles.gateTitle}>후원집계 확인</h2>
      <p className={styles.gateDesc}>
        후원집계는 비공개예요. 업보시트 관리자와 별도의 전용 비밀번호를 입력해 주세요.
      </p>
      <form action={action} className={styles.gateForm}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          className={styles.gateInput}
          type="password"
          name="password"
          placeholder="후원집계 비밀번호"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button className={styles.gateButton} type="submit" disabled={pending}>
          {pending ? "확인 중…" : "열람하기"}
        </button>
        {state.error ? <p className={styles.gateError}>{state.error}</p> : null}
      </form>
    </div>
  );
}
