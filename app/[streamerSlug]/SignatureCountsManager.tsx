"use client";

// 스트리머 관리자용 "정가 설정" 화면.
// 등록한 후원 갯수와 일치하는 후원은 다음 반영부터 "정가기록"으로 남는다(룰렛 업보와 별도 표기).
// 2026-08-09 유형 구분(sy 확정): 시그니처(상시)/이벤트/서버(기간 한정) 3섹션.
//  - 기간 한정은 이름+기간(시작~종료, KST 날짜)이 붙고, "위플랩에 찍힌 후원 시각"이 기간 안일 때만 수집.
//  - 기간이 지나면 «지난 정가»로 자동 이동(수집은 기간 판정이 이미 끊음) — 삭제는 통합 삭제로 스트리머 직접.
//  - 기간이 끝나도 이미 쌓인 기록(업보)은 사라지지 않는다.
//  - 정가끼리 갯수 중복은 경고 + 저장 차단(저장 구조상 한 갯수 = 한 항목).
//  - 팬 정가 탭 표시 방식(sections/subtabs)도 여기서 스트리머가 선택.
// 갯수마다 시그 이미지 1장 + 구성품 한 줄(쉼표 구분)은 선택 — 팬 화면 시그 레일 표시용.

import { useRef, useState } from "react";
import styles from "./signatureCounts.module.css";
import { optimizeImage } from "./imageOptimize";
import type { FanFixedTabMode, SignatureDetail, SignatureKind } from "../../lib/api";

const MAX_ROWS = 100;
const IMAGE_MAX_WIDTH = 600;

type Row = {
  rowKey: number;
  kind: SignatureKind;
  label: string;
  count: string;
  parts: string;
  imageUrl: string;
  startAt: string;
  endAt: string;
};

let rowSeq = 1;

function kstToday(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function daysLeft(endAt: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endAt)) return null;
  const toMs = Date.parse(`${endAt}T23:59:59+09:00`);
  if (Number.isNaN(toMs)) return null;
  return Math.ceil((toMs - Date.now()) / 86400000);
}

// 저장된 갯수+표시 정보를 편집용 행(활성)과 «지난 정가» 목록으로 나눈다.
function splitInitial(counts: number[], details: SignatureDetail[]): { rows: Row[]; expired: SignatureDetail[] } {
  const byCount = new Map(details.map((d) => [d.count, d]));
  const rows: Row[] = [];
  const expired: SignatureDetail[] = [];
  for (const n of counts) {
    const d = byCount.get(n);
    if (d?.expired) {
      expired.push(d);
      continue;
    }
    rows.push({
      rowKey: rowSeq++,
      kind: d?.kind ?? "sig",
      label: d?.label ?? "",
      count: String(n),
      parts: d?.parts.join(", ") ?? "",
      imageUrl: d?.imageUrl ?? "",
      startAt: d?.startAt ?? "",
      endAt: d?.endAt ?? "",
    });
  }
  if (rows.length === 0) rows.push({ rowKey: rowSeq++, kind: "sig", label: "", count: "", parts: "", imageUrl: "", startAt: "", endAt: "" });
  return { rows, expired };
}

function parseParts(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

const KIND_NAME: Record<SignatureKind, string> = { sig: "시그니처", event: "이벤트", server: "서버" };

export default function SignatureCountsManager({
  slug,
  initial,
  initialDetails,
  initialFanFixedTabMode,
}: {
  slug: string;
  initial: number[];
  initialDetails: SignatureDetail[];
  initialFanFixedTabMode: FanFixedTabMode;
}) {
  const [{ rows, expired }, setData] = useState(() => splitInitial(initial, initialDetails));
  const [mode, setMode] = useState<FanFixedTabMode>(initialFanFixedTabMode);
  const [checkedExpired, setCheckedExpired] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickTargetRef = useRef<number | null>(null);

  function setRows(next: Row[]) {
    setData((prev) => ({ ...prev, rows: next }));
  }
  function patchRow(rowKey: number, patch: Partial<Row>) {
    setRows(rows.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  }

  function onChangeCount(rowKey: number, value: string) {
    if (value !== "" && !/^\d+$/.test(value)) return;
    patchRow(rowKey, { count: value });
  }

  function addRow(kind: SignatureKind) {
    if (rows.length >= MAX_ROWS) return;
    setRows([
      ...rows,
      {
        rowKey: rowSeq++,
        kind,
        label: "",
        count: "",
        parts: "",
        imageUrl: "",
        startAt: kind === "sig" ? "" : kstToday(),
        endAt: kind === "sig" ? "" : kstToday(30),
      },
    ]);
  }

  function removeRow(rowKey: number) {
    const next = rows.filter((r) => r.rowKey !== rowKey);
    setRows(next.length === 0 ? [{ rowKey: rowSeq++, kind: "sig", label: "", count: "", parts: "", imageUrl: "", startAt: "", endAt: "" }] : next);
  }

  function pickImage(rowKey: number) {
    pickTargetRef.current = rowKey;
    fileRef.current?.click();
  }

  async function onFilePicked(file: File | null) {
    const rowKey = pickTargetRef.current;
    pickTargetRef.current = null;
    if (!file || rowKey === null) return;
    setUploadingKey(rowKey);
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
      patchRow(rowKey, { imageUrl: data.url });
      setMsg({ kind: "ok", text: "이미지를 올렸어요. «저장»을 눌러야 팬 화면에 반영돼요." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "업로드 실패 — 다시 시도해 주세요." });
    } finally {
      setUploadingKey(null);
    }
  }

  // 유효 갯수 행 + 지난 정가(삭제 예정 제외)로 저장 페이로드를 만든다.
  function buildPayload(deleteChecked: boolean) {
    const validRows = rows
      .map((r) => ({ ...r, n: Number(r.count.trim()) }))
      .filter((r) => r.count.trim() !== "" && Number.isInteger(r.n) && r.n > 0);
    const keptExpired = deleteChecked ? expired.filter((d) => !checkedExpired.has(d.count)) : expired;
    const counts = [...validRows.map((r) => r.n), ...keptExpired.map((d) => d.count)];
    const details: Record<string, unknown> = {};
    for (const r of validRows) {
      const parts = parseParts(r.parts);
      if (r.kind === "sig" && parts.length === 0 && !r.imageUrl) continue;
      details[String(r.n)] = {
        parts,
        imageUrl: r.imageUrl,
        kind: r.kind,
        label: r.label.trim(),
        startAt: r.kind === "sig" ? "" : r.startAt,
        endAt: r.kind === "sig" ? "" : r.endAt,
      };
    }
    for (const d of keptExpired) {
      details[String(d.count)] = {
        parts: d.parts,
        imageUrl: d.imageUrl,
        kind: d.kind,
        label: d.label,
        startAt: d.startAt,
        endAt: d.endAt,
      };
    }
    return { counts, details, fanFixedTabMode: mode };
  }

  // 갯수 중복(활성 행끼리 + 지난 정가와) — 저장 구조상 한 갯수 = 한 항목이라 저장을 막는다.
  const activeCounts = rows
    .map((r) => Number(r.count.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const expiredCounts = expired.map((d) => d.count);
  const allCounts = [...activeCounts, ...expiredCounts];
  const dupSet = new Set(allCounts.filter((n, i) => allCounts.indexOf(n) !== i));

  async function save(deleteChecked = false) {
    if (dupSet.size > 0) {
      setMsg({ kind: "err", text: "갯수가 겹치는 정가가 있어요 — 겹침을 먼저 정리해야 저장할 수 있어요." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/signature-counts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(deleteChecked)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        const savedCounts: number[] = Array.isArray(data?.signatureCounts) ? data.signatureCounts : [];
        const savedDetails: SignatureDetail[] = Array.isArray(data?.signatureDetails) ? data.signatureDetails : [];
        setData(splitInitial(savedCounts, savedDetails));
        if (data?.fanFixedTabMode === "sections" || data?.fanFixedTabMode === "subtabs") setMode(data.fanFixedTabMode);
        setCheckedExpired(new Set());
        setMsg({
          kind: "ok",
          text: deleteChecked
            ? "지난 정가를 정리했어요. 팬들이 쌓은 기록은 그대로 남아 있어요."
            : "적용됐어요! 갯수·기간은 다음 수집 반영부터, 이미지·구성·표시 방식은 팬 화면에 바로 반영돼요.",
        });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const sigRows = rows.filter((r) => r.kind === "sig");
  const limitedRows = rows.filter((r) => r.kind !== "sig");

  function renderRow(row: Row) {
    const n = Number(row.count.trim());
    const isDup = Number.isInteger(n) && n > 0 && dupSet.has(n);
    const d = row.kind !== "sig" ? daysLeft(row.endAt) : null;
    return (
      <div key={row.rowKey} className={isDup ? `${styles.sigRow} ${styles.sigRowDup}` : styles.sigRow}>
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
              onClick={() => pickImage(row.rowKey)}
              disabled={uploadingKey !== null}
            >
              {uploadingKey === row.rowKey ? "올리는 중…" : row.imageUrl ? "교체" : "이미지 등록"}
            </button>
            {row.imageUrl ? (
              <button
                type="button"
                className={styles.imgBtn}
                onClick={() => patchRow(row.rowKey, { imageUrl: "" })}
                disabled={uploadingKey !== null}
              >
                제거
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.sigFields}>
          <div className={styles.row}>
            {row.kind !== "sig" ? (
              <select
                className={styles.kindSelect}
                value={row.kind}
                onChange={(e) => patchRow(row.rowKey, { kind: e.target.value === "server" ? "server" : "event" })}
                aria-label="정가 유형"
              >
                <option value="event">이벤트</option>
                <option value="server">서버</option>
              </select>
            ) : null}
            <input
              className={`${styles.rowInput} ${styles.countInput}`}
              type="text"
              inputMode="numeric"
              value={row.count}
              placeholder="예: 5000"
              onChange={(e) => onChangeCount(row.rowKey, e.target.value)}
            />
            <span className={styles.rowUnit}>개</span>
            {d !== null ? (
              <span className={d <= 7 ? `${styles.dday} ${styles.ddaySoon}` : styles.dday}>D-{Math.max(0, d)}</span>
            ) : null}
            <button
              type="button"
              className={styles.rowRemoveBtn}
              onClick={() => removeRow(row.rowKey)}
              aria-label="이 칸 삭제"
            >
              ×
            </button>
          </div>

          {row.kind !== "sig" ? (
            <div className={styles.periodRow}>
              <input
                className={`${styles.rowInput} ${styles.labelInput}`}
                type="text"
                value={row.label}
                placeholder="이름 (예: 여름 한정)"
                onChange={(e) => patchRow(row.rowKey, { label: e.target.value })}
              />
              <input
                className={`${styles.rowInput} ${styles.dateInput}`}
                type="date"
                value={row.startAt}
                onChange={(e) => patchRow(row.rowKey, { startAt: e.target.value })}
                aria-label="시작일"
              />
              <span className={styles.rowUnit}>~</span>
              <input
                className={`${styles.rowInput} ${styles.dateInput}`}
                type="date"
                value={row.endAt}
                onChange={(e) => patchRow(row.rowKey, { endAt: e.target.value })}
                aria-label="종료일"
              />
            </div>
          ) : null}

          <label className={styles.partsLabel}>
            구성품 <span className={styles.partsOptional}>(쉼표로 구분 — 비우면 갯수만 표시)</span>
          </label>
          <input
            className={styles.rowInput}
            type="text"
            value={row.parts}
            placeholder="예: 포스터, 포토카드, 보이스"
            onChange={(e) => patchRow(row.rowKey, { parts: e.target.value })}
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
          {isDup ? (
            <p className={styles.dupWarn}>
              ⚠ 다른 정가와 갯수가 겹쳐요 — 어떤 후원인지 구분할 수 없으니 갯수를 바꿔 주세요.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>정가 설정</h1>
        <p className={styles.sub}>
          등록한 갯수와 일치하는 후원은 다음 반영부터 <b>&quot;정가기록&quot;</b>으로 남아요.
          <b> 이벤트·서버</b>는 기간을 붙일 수 있고, <b>위플랩에 찍힌 후원 시각</b>이 기간 안일 때만 수집돼요.
          기간이 끝나면 아래 «지난 정가»로 내려가고, 팬들이 이미 쌓은 기록은 그대로 남아요.
        </p>
      </header>

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

      <h2 className={styles.secTitle}>
        시그니처 <span className={styles.secSub}>상시 — 갯수는 그대로, 이미지·구성품만 바뀌는 정가</span>
      </h2>
      <div className={styles.rows}>{sigRows.map(renderRow)}</div>
      <button type="button" className={styles.addBtn} onClick={() => addRow("sig")} disabled={rows.length >= MAX_ROWS}>
        + 시그니처 추가
      </button>

      <h2 className={styles.secTitle}>
        기간 한정 (이벤트·서버) <span className={styles.secSub}>기간 안 후원만 수집 — 종료되면 «지난 정가»로 자동 이동</span>
      </h2>
      {limitedRows.length === 0 ? (
        <p className={styles.hint}>진행 중인 기간 한정 정가가 없어요.</p>
      ) : (
        <div className={styles.rows}>{limitedRows.map(renderRow)}</div>
      )}
      <button type="button" className={styles.addBtn} onClick={() => addRow("event")} disabled={rows.length >= MAX_ROWS}>
        + 이벤트·서버 추가
      </button>

      <h2 className={styles.secTitle}>
        지난 정가 <span className={styles.secSub}>수집은 기간이 끝날 때 이미 멈췄어요 — 목록 정리만 하면 돼요</span>
      </h2>
      {expired.length === 0 ? (
        <p className={styles.hint}>지난 정가가 없어요.</p>
      ) : (
        <>
          {expired.map((d) => (
            <div key={d.count} className={styles.expiredRow}>
              <input
                type="checkbox"
                checked={checkedExpired.has(d.count)}
                onChange={(e) => {
                  setCheckedExpired((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(d.count);
                    else next.delete(d.count);
                    return next;
                  });
                }}
                aria-label={`${d.count}개 선택`}
              />
              <span className={styles.endedTag}>종료</span>
              <span>
                {KIND_NAME[d.kind]} «{d.label || "(이름 없음)"}»
              </span>
              <span className={styles.expiredCount}>{d.count.toLocaleString()}개</span>
              <span className={styles.expiredPeriod}>
                {d.startAt || "?"} ~ {d.endAt || "?"}
              </span>
            </div>
          ))}
          <button
            type="button"
            className={styles.delBatchBtn}
            onClick={() => void save(true)}
            disabled={saving || checkedExpired.size === 0}
          >
            선택한 지난 정가 삭제 ({checkedExpired.size})
          </button>
          <p className={styles.hint}>
            ※ 삭제해도 팬들이 이미 쌓은 기록(업보)은 그대로 남아요 — 지워지는 건 이 설정 목록뿐이에요. 단,
            삭제하면 그 기록의 이벤트·서버 표시는 일반 «정가»로 돌아가요.
          </p>
        </>
      )}

      <h2 className={styles.secTitle}>
        팬 화면 표시 방식 <span className={styles.secSub}>정가 탭에서 유형을 어떻게 나눠 보여줄지 — 그림은 구조 미리보기예요</span>
      </h2>
      <div className={styles.modeRow}>
        <label className={mode === "sections" ? `${styles.modeCard} ${styles.modeCardOn}` : styles.modeCard}>
          <span className={styles.modeCardHead}>
            <input
              type="radio"
              name="fanFixedTabMode"
              checked={mode === "sections"}
              onChange={() => setMode("sections")}
            />
            한 탭 + 섹션 <span className={styles.modeDesc}>(기본)</span>
          </span>
          <span className={styles.modeCardDesc}>정가 탭 하나 안에서 소제목으로 구분 — 팬이 스크롤만 내리면 전부 봐요.</span>
          {/* 미리보기: 실제 팬 정가 탭 축소판(가짜 데이터) — 소제목별 카드 + 유형 배지가 섞인 기록 */}
          <span className={styles.pv} aria-hidden="true">
            <span className={styles.pvFanTabs}>
              <i className={styles.pvFanTab}>1000</i>
              <i className={styles.pvFanTab}>5000</i>
              <i className={`${styles.pvFanTab} ${styles.pvFanTabOn}`}>정가</i>
            </span>
            <span className={styles.pvGroupLabel}>시그니처</span>
            <span className={styles.pvCards}>
              <i className={styles.pvCard}>1,000개</i>
              <i className={styles.pvCard}>2,000개</i>
            </span>
            <span className={styles.pvGroupLabel}>
              이벤트 · 여름 한정 <i className={styles.pvDday}>D-3</i>
            </span>
            <span className={styles.pvCards}>
              <i className={`${styles.pvCard} ${styles.pvCardEvent}`}>3,000개</i>
            </span>
            <span className={styles.pvGroupLabel}>
              서버 · 마크 참여 <i className={styles.pvDday}>D-12</i>
            </span>
            <span className={styles.pvCards}>
              <i className={`${styles.pvCard} ${styles.pvCardServer}`}>5,000개</i>
            </span>
            <span className={styles.pvDivider} />
            <span className={styles.pvRow}>
              <i className={styles.pvNick}>팬A</i>
              <i className={`${styles.pvBadge} ${styles.pvBadgeSig}`}>정가</i>
              <i className={styles.pvItem}>1,000개</i>
            </span>
            <span className={styles.pvRow}>
              <i className={styles.pvNick}>팬B</i>
              <i className={`${styles.pvBadge} ${styles.pvBadgeEvent}`}>이벤트</i>
              <i className={styles.pvItem}>3,000개</i>
            </span>
            <span className={styles.pvRow}>
              <i className={styles.pvNick}>팬C</i>
              <i className={`${styles.pvBadge} ${styles.pvBadgeServer}`}>서버</i>
              <i className={styles.pvItem}>5,000개</i>
            </span>
            <span className={styles.pvHint}>모든 유형이 한 화면에 차례로 보여요</span>
          </span>
        </label>

        <label className={mode === "subtabs" ? `${styles.modeCard} ${styles.modeCardOn}` : styles.modeCard}>
          <span className={styles.modeCardHead}>
            <input
              type="radio"
              name="fanFixedTabMode"
              checked={mode === "subtabs"}
              onChange={() => setMode("subtabs")}
            />
            유형별 하위 탭
          </span>
          <span className={styles.modeCardDesc}>정가 탭 안에 시그니처/이벤트/서버 탭 — 팬이 탭을 눌러 골라 봐요.</span>
          {/* 미리보기: 실제 팬 정가 탭 축소판(가짜 데이터) — 하위 탭 + 지금 누른 유형만 */}
          <span className={styles.pv} aria-hidden="true">
            <span className={styles.pvFanTabs}>
              <i className={styles.pvFanTab}>1000</i>
              <i className={styles.pvFanTab}>5000</i>
              <i className={`${styles.pvFanTab} ${styles.pvFanTabOn}`}>정가</i>
            </span>
            <span className={styles.pvTabs}>
              <i className={`${styles.pvTab} ${styles.pvTabOn}`}>시그니처 2</i>
              <i className={styles.pvTab}>이벤트 1</i>
              <i className={styles.pvTab}>서버 1</i>
            </span>
            <span className={styles.pvCards}>
              <i className={styles.pvCard}>1,000개</i>
              <i className={styles.pvCard}>2,000개</i>
            </span>
            <span className={styles.pvDivider} />
            <span className={styles.pvRow}>
              <i className={styles.pvNick}>팬A</i>
              <i className={`${styles.pvBadge} ${styles.pvBadgeSig}`}>정가</i>
              <i className={styles.pvItem}>1,000개</i>
            </span>
            <span className={styles.pvRow}>
              <i className={styles.pvNick}>팬D</i>
              <i className={`${styles.pvBadge} ${styles.pvBadgeSig}`}>정가</i>
              <i className={styles.pvItem}>2,000개</i>
            </span>
            <span className={styles.pvHint}>이벤트·서버 기록은 위 탭을 눌러야 보여요</span>
          </span>
        </label>
      </div>

      <div className={styles.saveBar}>
        <button
          className={styles.saveBtn}
          type="button"
          onClick={() => void save(false)}
          disabled={saving || uploadingKey !== null || dupSet.size > 0}
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {dupSet.size > 0 ? <span className={styles.dupWarn}>갯수 겹침을 정리해야 저장할 수 있어요.</span> : null}
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
