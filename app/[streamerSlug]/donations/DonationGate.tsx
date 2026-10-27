"use client";

// 후원집계 잠금 화면. SheetAdminGate 패턴을 후원 원장 톤으로 옮긴 것.
// - blocked: 이 스트리머의 후원집계 전용 비밀번호가 아직 없음 → 업보시트 관리자 로그인 안내(입력 폼 없음)
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
        <h2 className={styles.gateTitle}>후원집계 비밀번호를 아직 안 정했어요</h2>
        <p className={styles.gateDesc}>
          업보시트 관리자 화면에 로그인한 뒤 다시 열면, 들어와서 후원집계 전용 비밀번호를 정할 수 있어요.{" "}
          <a href={`/${encodeURIComponent(slug)}?admin=1`}>업보시트 관리자 로그인</a>
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
