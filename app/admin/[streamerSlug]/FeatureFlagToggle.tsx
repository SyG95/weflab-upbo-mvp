"use client";

// 스트리머별 시범 기능 스위치(확프 0.5.0 1단계). 지금은 다시판정 "후원 그때 표로(근사)" 미리보기 하나만 화면에 둔다.
// 켜면 그 스트리머의 업보시트 관리 화면 다시판정에 "판정 기준" 선택이 보인다(넣기는 묶음 4 전까지 없음).
import { useState, useTransition } from "react";
import styles from "./page.module.css";
import { setFeatureFlagsAction } from "../actions";
import type { UpboFeatureFlags } from "@/lib/featureFlags";

export default function FeatureFlagToggle({ slug, initial }: { slug: string; initial: UpboFeatureFlags }) {
  const [flags, setFlags] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function toggleAsof() {
    const next = !flags.asofRejudge;
    setError("");
    startTransition(async () => {
      const res = await setFeatureFlagsAction(slug, { asofRejudge: next });
      if (res.ok && res.flags) setFlags(res.flags);
      else setError(res.error || "저장하지 못했어요.");
    });
  }

  return (
    <div className={`${styles.callout} ${styles.calloutInfo}`} style={{ marginTop: 12 }}>
      <strong>시범 기능</strong> · 다시판정 &ldquo;후원 그때 표로(근사)&rdquo; 미리보기:{" "}
      <b>{flags.asofRejudge ? "켜짐" : "꺼짐"}</b>{" "}
      <button type="button" className={styles.lockBtn} onClick={toggleAsof} disabled={pending}>
        {pending ? "저장 중…" : flags.asofRejudge ? "끄기" : "켜기"}
      </button>
      <br />
      켜면 이 스트리머 업보시트 관리 화면의 다시판정에 &ldquo;판정 기준&rdquo; 선택이 보여요. 미리보기만 되고 넣기는
      아직 없어요(쓰기 0).
      {error ? <span style={{ display: "block", color: "#b42318" }}>{error}</span> : null}
    </div>
  );
}
