"use client";

// 스트리머 관리자용 "정가(시그니처 갯수) 설정" 화면.
// 여기 등록한 후원 갯수와 일치하는 후원은 다음 반영부터 "정가기록"으로 남는다(룰렛 업보와 별도 표기).
// 기존 extension 토큰으로 인증한다(새 로그인 없음). 전용 링크 #토큰 으로 들어오면 자동 입력.
// UX 패턴은 ThemePicker.tsx(토큰 입력/hash 자동채움/저장 상태 문구/fetch 패턴)를 그대로 따른다.

import { useState } from "react";
import styles from "./signatureCounts.module.css";

const MIN_ROWS = 5; // 항상 최소 5칸 표시
const MAX_ROWS = 100; // "갯수 추가" 상한

// 저장된 갯수 목록을 최소 5칸짜리 입력칸 문자열 배열로 바꾼다(부족하면 빈 칸으로 채움).
function toRows(counts: number[]): string[] {
  const rows = counts.map((n) => String(n));
  while (rows.length < MIN_ROWS) rows.push("");
  return rows;
}

export default function SignatureCountsManager({ slug, initial }: { slug: string; initial: number[] }) {
  const [rows, setRows] = useState<string[]>(() => toRows(initial));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function onChangeRow(index: number, value: string) {
    // 숫자만 허용(빈 문자열은 허용 — 저장 시 무시됨).
    if (value !== "" && !/^\d+$/.test(value)) return;
    setRows((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  function onAddRow() {
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, ""]));
  }

  function onRemoveRow(index: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length < MIN_ROWS ? toRows(next.map(Number).filter((n) => n > 0)) : next;
    });
  }

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    // 빈 칸 제외, 양의 정수만 골라 전송.
    const counts = rows
      .map((v) => v.trim())
      .filter((v) => v !== "")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/signature-counts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        const saved: number[] = Array.isArray(data?.signatureCounts) ? data.signatureCounts : [];
        setRows(toRows(saved));
        setMsg({ kind: "ok", text: "적용됐어요! 다음 수집 반영부터 정가기록이 남습니다." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const savedCounts = rows
    .map((v) => v.trim())
    .filter((v) => v !== "")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const hasDuplicate = new Set(savedCounts).size !== savedCounts.length;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>정가(시그니처 갯수) 설정</h1>
        <p className={styles.sub}>
          여기 등록한 갯수와 일치하는 후원은 다음 반영부터 <b>&quot;정가기록&quot;</b>으로 남아요. 룰렛 업보와
          별도로 표시됩니다.
        </p>
      </header>

      {savedCounts.length > 0 ? (
        <div className={styles.chipRow}>
          {savedCounts.map((n, i) => (
            <span key={`${n}-${i}`} className={styles.chip}>
              {n.toLocaleString()}개
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.rows}>
        {rows.map((value, index) => (
          <div key={index} className={styles.row}>
            <input
              className={styles.rowInput}
              type="text"
              inputMode="numeric"
              value={value}
              placeholder="예: 5000"
              onChange={(e) => onChangeRow(index, e.target.value)}
            />
            <span className={styles.rowUnit}>개</span>
            <button
              type="button"
              className={styles.rowRemoveBtn}
              onClick={() => onRemoveRow(index)}
              aria-label="이 칸 삭제"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button type="button" className={styles.addBtn} onClick={onAddRow} disabled={rows.length >= MAX_ROWS}>
        + 갯수 추가
      </button>

      {hasDuplicate ? <p className={styles.hint}>중복된 갯수는 저장 시 자동으로 정리돼요.</p> : null}

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
