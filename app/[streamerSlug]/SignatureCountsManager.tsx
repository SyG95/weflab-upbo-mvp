"use client";

// 스트리머 관리자용 "정가(시그니처 갯수) 설정" 화면.
// 여기 등록한 후원 갯수와 일치하는 후원은 다음 반영부터 "정가기록"으로 남는다(룰렛 업보와 별도 표기).
// 2026-08-09 확장(sy 가로 레일 채택): 갯수마다 시그 이미지 1장 + 구성품 한 줄(쉼표 구분)을 선택으로
// 얹는다. 수집 판정은 여전히 갯수만 쓰고, 이미지·구성품은 팬 화면 정가 탭 시그 레일 표시에만 쓴다.
// 인증은 관리자 로그인 세션(쿠키). 업로드는 옷장·홍보와 같은 스토리지(optimizeImage 공유).

import { useRef, useState } from "react";
import styles from "./signatureCounts.module.css";
import { optimizeImage } from "./imageOptimize";
import type { SignatureDetail } from "../../lib/api";

const MAX_ROWS = 100; // "갯수 추가" 상한
const IMAGE_MAX_WIDTH = 600; // 시그 이미지는 작게 쓰인다(레일 카드 폭 ~150px)

type Row = { count: string; parts: string; imageUrl: string };

// 저장된 갯수+표시 정보를 편집용 행으로 합친다. 비어 있으면 빈 행 1칸으로 시작.
function toRows(counts: number[], details: SignatureDetail[]): Row[] {
  const byCount = new Map(details.map((d) => [d.count, d]));
  const rows = counts.map((n) => {
    const d = byCount.get(n);
    return { count: String(n), parts: d?.parts.join(", ") ?? "", imageUrl: d?.imageUrl ?? "" };
  });
  if (rows.length === 0) rows.push({ count: "", parts: "", imageUrl: "" });
  return rows;
}

function parseParts(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function SignatureCountsManager({
  slug,
  initial,
  initialDetails,
}: {
  slug: string;
  initial: number[];
  initialDetails: SignatureDetail[];
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial, initialDetails));
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickTargetRef = useRef<number | null>(null);

  function patchRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function onChangeCount(index: number, value: string) {
    // 숫자만 허용(빈 문자열은 허용 — 저장 시 무시됨).
    if (value !== "" && !/^\d+$/.test(value)) return;
    patchRow(index, { count: value });
  }

  function onAddRow() {
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, { count: "", parts: "", imageUrl: "" }]));
  }

  function onRemoveRow(index: number) {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [{ count: "", parts: "", imageUrl: "" }] : next;
    });
  }

  function pickImage(index: number) {
    pickTargetRef.current = index;
    fileRef.current?.click();
  }

  async function onFilePicked(file: File | null) {
    const index = pickTargetRef.current;
    pickTargetRef.current = null;
    if (!file || index === null) return;
    setUploadingIndex(index);
    setMsg(null);
    try {
      const optimized = await optimizeImage(file, IMAGE_MAX_WIDTH);
      const form = new FormData();
      form.append("file", optimized);
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/signature-image`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false || typeof data?.url !== "string") {
        throw new Error(data?.error || "업로드 실패 — 다시 시도해 주세요.");
      }
      patchRow(index, { imageUrl: data.url });
      setMsg({ kind: "ok", text: "이미지를 올렸어요. «저장»을 눌러야 팬 화면에 반영돼요." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "업로드 실패 — 다시 시도해 주세요." });
    } finally {
      setUploadingIndex(null);
    }
  }

  async function save() {
    // 빈 칸 제외, 양의 정수만 골라 전송. 표시 정보(details)는 갯수가 유효한 행에서만 모은다.
    const valid = rows
      .map((r) => ({ ...r, n: Number(r.count.trim()) }))
      .filter((r) => r.count.trim() !== "" && Number.isInteger(r.n) && r.n > 0);
    const counts = valid.map((r) => r.n);
    const details: Record<string, { parts: string[]; imageUrl: string }> = {};
    for (const r of valid) {
      const parts = parseParts(r.parts);
      if (parts.length === 0 && !r.imageUrl) continue;
      details[String(r.n)] = { parts, imageUrl: r.imageUrl };
    }

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/signature-counts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counts, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        const savedCounts: number[] = Array.isArray(data?.signatureCounts) ? data.signatureCounts : [];
        const savedDetails: SignatureDetail[] = Array.isArray(data?.signatureDetails) ? data.signatureDetails : [];
        setRows(toRows(savedCounts, savedDetails));
        setMsg({ kind: "ok", text: "적용됐어요! 갯수는 다음 수집 반영부터, 이미지·구성은 팬 화면에 바로 반영돼요." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const savedCounts = rows
    .map((r) => r.count.trim())
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
          별도로 표시됩니다. 갯수마다 <b>시그 이미지 1장 + 구성품 한 줄</b>을 선택으로 얹을 수 있어요 —
          채우면 팬 화면 정가 탭 위에 시그 카드 줄이 생기고, 비워두면 지금과 똑같이 갯수만 동작해요.
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

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          void onFilePicked(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      <div className={styles.rows}>
        {rows.map((row, index) => (
          <div key={index} className={styles.sigRow}>
            <div className={styles.imgSlot}>
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.imgThumb} src={row.imageUrl} alt="시그 이미지" />
              ) : (
                <div className={styles.imgEmpty}>이미지 없음</div>
              )}
              <div className={styles.imgBtns}>
                <button
                  type="button"
                  className={styles.imgBtn}
                  onClick={() => pickImage(index)}
                  disabled={uploadingIndex !== null}
                >
                  {uploadingIndex === index ? "올리는 중…" : row.imageUrl ? "교체" : "이미지 등록"}
                </button>
                {row.imageUrl ? (
                  <button
                    type="button"
                    className={styles.imgBtn}
                    onClick={() => patchRow(index, { imageUrl: "" })}
                    disabled={uploadingIndex !== null}
                  >
                    제거
                  </button>
                ) : null}
              </div>
            </div>

            <div className={styles.sigFields}>
              <div className={styles.row}>
                <input
                  className={styles.rowInput}
                  type="text"
                  inputMode="numeric"
                  value={row.count}
                  placeholder="예: 5000"
                  onChange={(e) => onChangeCount(index, e.target.value)}
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
              <label className={styles.partsLabel}>
                구성품 <span className={styles.partsOptional}>(쉼표로 구분 — 비우면 갯수만 표시)</span>
              </label>
              <input
                className={styles.rowInput}
                type="text"
                value={row.parts}
                placeholder="예: 포스터, 포토카드, 보이스"
                onChange={(e) => patchRow(index, { parts: e.target.value })}
              />
              <div className={styles.partsPreview}>
                {parseParts(row.parts).length === 0 ? (
                  <span className={styles.partsNone}>구성품 없음</span>
                ) : (
                  parseParts(row.parts).map((p, i) => (
                    <span key={`${p}-${i}`} className={styles.partChip}>
                      {p}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className={styles.addBtn} onClick={onAddRow} disabled={rows.length >= MAX_ROWS}>
        + 갯수 추가
      </button>

      {hasDuplicate ? <p className={styles.hint}>중복된 갯수는 저장 시 자동으로 정리돼요.</p> : null}

      <div className={styles.saveBar}>
        <button
          className={styles.saveBtn}
          type="button"
          onClick={save}
          disabled={saving || uploadingIndex !== null}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
