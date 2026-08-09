"use client";

// 스트리머가 시트 글씨체(디스플레이 폰트)를 직접 고르는 섹션 — 테마 고르기 아래에 붙는다.
// 인증은 테마 저장과 동일한 관리자 로그인 세션(쿠키). 후보 폰트는 sheetFonts 화이트리스트.
// 미리보기는 css2 text= 파라미터로 필요한 글자만 잘라 로드해 모바일에서도 가볍다.

import { useState } from "react";
import { SHEET_FONTS, sheetFontsPreviewHref } from "../../../lib/sheetFonts";
import styles from "./settings.module.css";

const SAMPLE = "업보시트 내 업보 확인 · 상품 칩 1.5% ×12";

export default function FontPicker({ slug, initialFontKey }: { slug: string; initialFontKey: string }) {
  const [selected, setSelected] = useState(initialFontKey);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const current = SHEET_FONTS.find((f) => f.key === selected) ?? SHEET_FONTS[0];
  const currentFamily = current.css === "var(--font-base)" ? current.css : `${current.css}, var(--font-base)`;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/sheet-font`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fontKey: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 업보시트 제목·탭·상품 칩에 바로 적용됩니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.fontSection}>
      {/* 후보 폰트 미리보기 글자만 부분 로드(통짜 한글 폰트 로드 방지) */}
      <link rel="stylesheet" href={sheetFontsPreviewHref(SAMPLE)} />
      <h2 className={styles.fontTitle}>글씨체 고르기</h2>
      <p className={styles.sub}>
        제목·탭·상품 칩의 글씨체를 바꿉니다. 닉네임·숫자 등 본문은 읽기 쉬운 고딕 그대로예요.
      </p>

      <div className={styles.fontGrid}>
        {SHEET_FONTS.map((f) => (
          <button
            key={f.key || "default"}
            type="button"
            className={`${styles.card} ${f.key === selected ? styles.cardOn : ""}`}
            onClick={() => setSelected(f.key)}
            aria-pressed={f.key === selected}
          >
            <span
              className={styles.fontSample}
              style={{ fontFamily: f.css === "var(--font-base)" ? undefined : `${f.css}, var(--font-base)` }}
            >
              업보시트
            </span>
            <span className={styles.cardLabel}>{f.label}</span>
            <span className={styles.cardBlurb}>{f.blurb}</span>
          </button>
        ))}
      </div>

      <div className={styles.fontPreviewBox} style={{ fontFamily: currentFamily }}>
        {SAMPLE}
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : `이 글씨체로 저장 (${current.label})`}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </section>
  );
}
