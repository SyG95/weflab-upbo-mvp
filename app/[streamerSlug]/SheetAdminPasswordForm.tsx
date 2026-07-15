"use client";

// 설정 탭: 이 시트(스트리머)만의 관리자 비밀번호를 정한다. 이미 로그인된 상태에서만 동작.

import { useActionState } from "react";
import styles from "./page.module.css";
import { setSheetAdminPassword, type SheetPasswordState } from "./sheetAdminActions";

export default function SheetAdminPasswordForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState<SheetPasswordState, FormData>(
    setSheetAdminPassword,
    {},
  );

  return (
    <form action={action} className={styles.ieForm}>
      <input type="hidden" name="slug" value={slug} />
      <p className={styles.fieldHint}>
        이 시트에 로그인할 관리자 비밀번호를 정합니다. 설정하면 이 시트는 공용 기본 비밀번호 대신
        여기서 정한 비밀번호로만 들어올 수 있어요. (다른 스트리머 시트에는 영향 없음)
      </p>
      <label className={styles.ieField}>
        <span className={styles.ieLabel}>새 비밀번호</span>
        <input
          className={styles.ieInput}
          type="password"
          name="newPassword"
          autoComplete="new-password"
          placeholder="4자 이상"
          required
        />
      </label>
      <label className={styles.ieField}>
        <span className={styles.ieLabel}>새 비밀번호 확인</span>
        <input
          className={styles.ieInput}
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="한 번 더 입력"
          required
        />
      </label>
      <div>
        <button className={styles.cmSaveBtn} type="submit" disabled={pending}>
          {pending ? "저장 중…" : "이 시트 비밀번호 저장"}
        </button>
      </div>
      {state.error ? <p className={styles.fieldErr}>{state.error}</p> : null}
      {state.ok ? (
        <p className={styles.fieldOk}>
          저장됐어요. 이제 이 시트는 방금 정한 비밀번호로 로그인합니다.
        </p>
      ) : null}
    </form>
  );
}
