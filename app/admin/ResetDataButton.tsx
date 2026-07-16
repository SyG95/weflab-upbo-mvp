"use client";

// 스트리머 데이터 초기화 버튼(온보딩 콘솔 전용). 완전 삭제와 달리 계정·테마·확장
// 연동은 남기고 체크한 데이터만 비운다. 실수 방지 2단계:
// ① 삭제될 건수 미리보기 → ② 슬러그 타이핑 확인 후 실행.
// 미리보기 후 체크를 바꾸면 실행칸을 숨기고 다시 미리보기를 요구한다(건수-범위 불일치 방지).

import { useActionState, useState } from "react";
import { resetStreamerDataAction, type ResetDataState } from "./actions";
import styles from "./admin-index.module.css";

const INITIAL: ResetDataState = {};

const OPTIONS = [
  { name: "scope_roulette", scopeKey: "roulette", label: "룰렛결과(업보 기록)" },
  { name: "scope_donations", scopeKey: "donations", label: "후원집계" },
  { name: "scope_catalogs", scopeKey: "catalogs", label: "확률표" },
  { name: "scope_coupons", scopeKey: "coupons", label: "쿠폰 장부" },
  { name: "scope_screen", scopeKey: "screenState", label: "화면 설정·상태(배너·레이아웃·특수룰 등)" },
  { name: "scope_pins", scopeKey: "pins", label: "비밀번호·위플랩 링크까지 (지우면 공통 기본값으로 돌아감)" },
] as const;

type OptionName = (typeof OPTIONS)[number]["name"];
type Checked = Record<OptionName, boolean>;

const NONE: Checked = {
  scope_roulette: false,
  scope_donations: false,
  scope_catalogs: false,
  scope_coupons: false,
  scope_screen: false,
  scope_pins: false,
};

const PRESETS: Array<{ label: string; value: Checked }> = [
  {
    label: "백지+테마만 남기기",
    value: { ...NONE, scope_roulette: true, scope_donations: true, scope_catalogs: true, scope_coupons: true, scope_screen: true },
  },
  { label: "룰렛결과만", value: { ...NONE, scope_roulette: true } },
  { label: "후원집계만", value: { ...NONE, scope_donations: true } },
];

export default function ResetDataButton({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(resetStreamerDataAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Checked>(NONE);
  const [typed, setTyped] = useState("");

  if (state.ok && state.mode === "execute") {
    return (
      <div className={styles.resetDone}>
        <p className={styles.wipeDoneTitle}>
          /{state.slug} 데이터 초기화 완료 — 총 {state.total?.toLocaleString()}건 삭제
        </p>
        <ul className={styles.wipeList}>
          {(state.items ?? []).map((item) => (
            <li key={item.key}>
              {item.label} <b>{item.count.toLocaleString()}건</b>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className={styles.wipeBtn} onClick={() => setOpen(true)}>
        초기화
      </button>
    );
  }

  // 미리보기 결과가 현재 체크 상태와 일치할 때만 실행칸을 연다.
  const previewed = state.ok === true && state.mode === "preview" && state.slug === slug;
  const scopeMatches =
    previewed && state.scope != null && OPTIONS.every((o) => state.scope![o.scopeKey] === checked[o.name]);
  const anyChecked = OPTIONS.some((o) => checked[o.name]);

  return (
    <form action={action} className={styles.wipePanel}>
      <input type="hidden" name="slug" value={slug} />
      <p className={styles.wipeWarnText}>
        <b>/{slug}</b> 데이터 초기화 — 계정·테마·확장 연동은 남고, 체크한 데이터만 <b>영구 삭제</b>돼요.
        되돌릴 수 없어요.
      </p>
      <div className={styles.wipePresetRow}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={styles.resetBtn}
            onClick={() => setChecked(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className={styles.wipeOpts}>
        {OPTIONS.map((option) => (
          <label key={option.name} className={styles.wipeOpt}>
            <input
              type="checkbox"
              name={option.name}
              checked={checked[option.name]}
              onChange={(e) => setChecked((prev) => ({ ...prev, [option.name]: e.target.checked }))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className={styles.deleteRow}>
        <button
          type="submit"
          name="mode"
          value="preview"
          className={styles.resetBtn}
          disabled={pending || !anyChecked}
        >
          {pending ? "확인 중…" : "삭제될 건수 미리보기"}
        </button>
        <button
          type="button"
          className={styles.resetNo}
          onClick={() => {
            setOpen(false);
            setChecked(NONE);
            setTyped("");
          }}
        >
          취소
        </button>
      </div>
      {previewed && !scopeMatches ? (
        <span className={styles.wipeStale}>체크 항목이 바뀌었어요 — 미리보기를 다시 눌러주세요.</span>
      ) : null}
      {scopeMatches ? (
        <div className={styles.wipePreview}>
          <ul className={styles.wipeList}>
            {(state.items ?? []).map((item) => (
              <li key={item.key}>
                {item.label} <b>{item.count.toLocaleString()}건</b>
              </li>
            ))}
          </ul>
          <p className={styles.wipeTotal}>총 {state.total?.toLocaleString()}건이 삭제돼요.</p>
          <div className={styles.deleteRow}>
            <input
              className={styles.deleteInput}
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={slug}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              name="mode"
              value="execute"
              className={styles.deleteYes}
              disabled={pending || typed.trim().toLowerCase() !== slug}
            >
              {pending ? "초기화 중…" : "초기화 실행"}
            </button>
          </div>
        </div>
      ) : null}
      {state.error ? <span className={styles.resetErr}>{state.error}</span> : null}
    </form>
  );
}
