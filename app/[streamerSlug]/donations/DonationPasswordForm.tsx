"use client";

// 이 스트리머만의 후원집계 비밀번호를 정한다. 이미 열람 중(인증됨)에서만 동작.
// SheetAdminPasswordForm 패턴을 후원 원장 톤으로 옮긴 것.

import { useActionState } from "react";
import { setDonationAdminPassword, type DonationPasswordState } from "./donationActions";
import styles from "./donations.module.css";

export default function DonationPasswordForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<DonationPasswordState, FormData>(
    setDonationAdminPassword,
    {},
  );

  return (
    <details className={styles.pwSection}>
      <summary className={styles.pwSummary}>이 스트리머 후원집계 비밀번호 변경</summary>
      <form action={action} className={styles.pwForm}>
        <input type="hidden" name="slug" value={slug} />
        <p className={styles.pwHint}>
          설정하면 이 스트리머의 후원집계는 공용 기본 비밀번호 대신 여기서 정한 비밀번호로만
          들어올 수 있어요. 다른 스트리머에게는 영향이 없습니다.
        </p>
        <label className={styles.pwField}>
          <span className={styles.pwLabel}>새 비밀번호</span>
          <input
            className={styles.gateInput}
            type="password"
            name="newPassword"
            autoComplete="new-password"
            placeholder="4자 이상"
            required
          />
        </label>
        <label className={styles.pwField}>
          <span className={styles.pwLabel}>새 비밀번호 확인</span>
          <input
            className={styles.gateInput}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="한 번 더 입력"
            required
          />
        </label>
        <div>
          <button className={styles.gateButton} type="submit" disabled={pending}>
            {pending ? "저장 중…" : "이 비밀번호로 잠그기"}
          </button>
        </div>
        {state.error ? <p className={styles.gateError}>{state.error}</p> : null}
        {state.ok ? (
          <p className={styles.pwOk}>저장됐어요. 이제 이 스트리머는 방금 정한 비밀번호로만 열립니다.</p>
        ) : null}
      </form>
    </details>
  );
}
