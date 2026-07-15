"use client";

// 스트리머가 자기 업보시트 테마를 직접 고르는 화면.
// 기존 extension 토큰으로 인증한다(새 로그인 없음). 전용 링크 #토큰 으로 들어오면 자동 입력.

import { useState, type CSSProperties } from "react";
import { THEMES, resolveTheme, type Theme } from "../../../lib/themes";
import styles from "./settings.module.css";

export default function ThemePicker({ slug, initialThemeId }: { slug: string; initialThemeId: string }) {
  const [selected, setSelected] = useState(initialThemeId || "paper");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const theme = resolveTheme(selected);

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 업보시트에 바로 적용됩니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>업보시트 테마 고르기</h1>
        <p className={styles.sub}>
          <b>{slug}</b> 업보시트의 전체 분위기를 골라보세요. 표·기능은 그대로, 색·느낌만 바뀝니다.
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.grid}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.card} ${t.id === selected ? styles.cardOn : ""}`}
              onClick={() => setSelected(t.id)}
              aria-pressed={t.id === selected}
            >
              <span className={styles.swatch} aria-hidden style={swatchStyle(t)} />
              <span className={styles.cardLabel}>
                {t.emoji} {t.label}
              </span>
              <span className={styles.cardBlurb}>{t.blurb}</span>
            </button>
          ))}
        </div>

        <aside className={styles.previewCol}>
          <p className={styles.previewLabel}>미리보기</p>
          <ThemePreview theme={theme} slug={slug} />
        </aside>
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : `${theme.emoji} 이 테마로 저장`}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}

function swatchStyle(t: Theme): CSSProperties {
  const v = t.vars;
  return {
    background: `linear-gradient(135deg, ${v["--cover"]} 0 38%, ${v["--stamp"]} 38% 68%, ${v["--surface"]} 68% 100%)`,
  };
}

function ThemePreview({ theme, slug }: { theme: Theme; slug: string }) {
  return (
    <div
      className={styles.preview}
      style={theme.vars as CSSProperties}
      data-glass={theme.fx?.glass ? "1" : undefined}
    >
      <div className={styles.pvCover}>{slug} 업보시트</div>
      <div className={styles.pvCard}>
        <div className={styles.pvRow}>
          <span className={styles.pvName}>달빛여우</span>
          <span className={styles.pvChip}>
            <b className={styles.pvItem}>스벅콘</b>
            <b className={styles.pvProb}>1.5%</b>
          </span>
        </div>
        <div className={styles.pvRow}>
          <span className={styles.pvName}>별헤는밤</span>
          <span className={styles.pvChip}>
            <b className={styles.pvItem}>치킨</b>
            <b className={styles.pvProb}>2%</b>
          </span>
        </div>
        <div className={styles.pvBtnRow}>
          <span className={styles.pvBtn}>찾기</span>
        </div>
      </div>
    </div>
  );
}
