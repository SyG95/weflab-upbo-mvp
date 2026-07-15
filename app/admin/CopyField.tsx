"use client";

// 값 하나 + 복사 버튼. 온보딩 결과(슬러그/토큰/PIN) 전달용.

import { useState } from "react";
import styles from "./admin-index.module.css";

export default function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 접근 불가(http 등) — 사용자가 직접 선택복사하면 됨.
    }
  }

  return (
    <div className={styles.copyField}>
      <span className={styles.copyLabel}>{label}</span>
      <code className={styles.copyValue}>{value}</code>
      <button type="button" className={styles.copyBtn} onClick={copy}>
        {copied ? "복사됨 ✓" : "복사"}
      </button>
    </div>
  );
}
