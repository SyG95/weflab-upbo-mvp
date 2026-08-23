"use client";

// 관리자용 "대문 제목" 입력 — 팬 화면 맨 위 대문(h1)에 보일 문구를 스트리머가 직접 정한다.
// 기본 "{이름} 업보시트", 비우고 저장하면 기본으로 되돌아간다. 이모지·특수문자 자유.
// 표시 전용(브라우저 탭 제목·관리자 화면·옷장/후원 페이지·데이터는 그대로).
// 저장 UX 는 CouponTabLabelForm(설정 탭 이웃)의 fetch 패턴을 따른다.
// 길이는 서버(SHEET_TITLE_MAX)와 같은 **코드포인트** 기준 — input maxLength 는 UTF-16 단위라
// 이모지 하나를 2글자로 세고 서로게이트 쌍을 반토막 낼 수 있어 쓰지 않고, onChange 에서 자른다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./signatureCounts.module.css";

const MAX = 24; // 서버 SHEET_TITLE_MAX 와 같은 값(30px 대문 폰트, 모바일 두 줄 안)

function clampTitle(value: string): string {
  return Array.from(value.replace(/[\r\n\t]+/g, " ")).slice(0, MAX).join("");
}

export default function SheetTitleForm({
  slug,
  initial,
  defaultTitle,
}: {
  slug: string;
  initial: string;
  // 비어 있을 때 대문에 실제로 보이는 기본 문구("{이름} 업보시트") — placeholder·미리보기용.
  defaultTitle: string;
}) {
  const [title, setTitle] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  const count = Array.from(title).length;
  const preview = title.trim() || defaultTitle;

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/sheet-title`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        const saved = typeof data.sheetTitle === "string" ? data.sheetTitle : "";
        setTitle(saved);
        setMsg({
          kind: "ok",
          text: saved ? `저장됐어요! 대문에 "${saved}"로 보입니다.` : `저장됐어요! 기본 제목("${defaultTitle}")으로 보입니다.`,
        });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          margin: "4px 0",
          padding: "10px 12px",
          border: "1px solid var(--paper-line)",
          borderRadius: 10,
          background: "var(--surface)",
        }}
      >
        {/* 대문 미리보기 — 팬 화면 대문과 같은 색·폰트 토큰(.page 안에서 렌더되므로 테마 변수 그대로) */}
        <div
          aria-label="대문 미리보기"
          style={{
            padding: "14px 16px",
            borderRadius: "4px 12px 12px 4px",
            background: "var(--cover)",
            color: "var(--on-cover)",
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.15,
            overflowWrap: "anywhere",
            wordBreak: "keep-all",
          }}
        >
          {preview}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b>대문 제목</b>
          <input
            value={title}
            placeholder={defaultTitle}
            disabled={saving}
            onChange={(e) => setTitle(clampTitle(e.target.value))}
            style={{
              flex: "1 1 220px",
              minWidth: 0,
              maxWidth: 360,
              padding: "6px 10px",
              border: "1px solid var(--paper-line)",
              borderRadius: 8,
              background: "var(--paper)",
              color: "var(--ink)",
              fontSize: 14,
            }}
            aria-label="대문 제목"
          />
          <span className={styles.hint} style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>
            {count}/{MAX}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || title.trim() === initial.trim()}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--paper-line)",
              borderRadius: 8,
              background: "none",
              color: "var(--ink)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            저장
          </button>
        </label>
        <span className={styles.hint} style={{ margin: 0 }}>
          이모지·특수문자 자유 (예: 🐻 늉이네 업보창고, 늉이 업보시트 ✨). 비우고 저장하면 기본
          &quot;{defaultTitle}&quot;로 돌아가요.
        </span>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
