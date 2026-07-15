"use client";

// 콘솔 상단 "새 스트리머 추가" 폼. 슬러그 하나로 생성+토큰+초기PIN을 한 번에 발급하고
// 결과 3개를 복사 버튼으로 보여준다(생성 직후 1회 표시).

import { useActionState } from "react";
import { createStreamerAction, type CreateStreamerState } from "./actions";
import CopyField from "./CopyField";
import styles from "./admin-index.module.css";

const INITIAL: CreateStreamerState = {};

export default function AddStreamerForm() {
  const [state, action, pending] = useActionState(createStreamerAction, INITIAL);

  return (
    <section className={styles.addCard}>
      <h2 className={styles.addTitle}>＋ 새 스트리머 추가</h2>
      <p className={styles.addNote}>
        슬러그(영문 소문자)만 넣으면 확장 토큰과 초기 비밀번호까지 한 번에 발급돼요. 아래 값을 복사해
        스트리머에게 전달하세요.
      </p>
      <form action={action} className={styles.addForm}>
        <input
          className={styles.addInput}
          name="slug"
          placeholder="슬러그 (예: poromi)"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <input
          className={styles.addInput}
          name="displayName"
          placeholder="표시 이름 (선택)"
          autoComplete="off"
        />
        <button className={styles.addBtn} type="submit" disabled={pending}>
          {pending ? "발급 중…" : "추가하고 발급"}
        </button>
      </form>

      {state.error ? <p className={styles.addError}>⚠️ {state.error}</p> : null}

      {state.ok && state.result ? (
        <div className={styles.addResult}>
          <p className={styles.addResultHead}>
            ✅ <b>{state.result.displayName}</b> 생성 완료 — 아래 3개를 복사해 전달하세요.{" "}
            <b>이 화면에서만 보여요.</b>
          </p>
          <CopyField label="슬러그 (주소)" value={state.result.slug} />
          <CopyField label="확장 토큰" value={state.result.token} />
          <CopyField label="초기 비밀번호" value={state.result.pin} />
          <p className={styles.addResultHint}>
            스트리머는 <code>/{state.result.slug}</code> 에서 이 비밀번호로 들어가 자기 비번으로 바꾸면
            돼요.
          </p>
        </div>
      ) : null}
    </section>
  );
}
