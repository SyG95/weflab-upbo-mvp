"use client";

// 운영 콘솔 목록: 장부형(컬럼 정렬) 스트리머 현황 + 줄별 관리(시트/검증실/비번 리셋/삭제).
// 상태점 = 확프 하트비트 신호등(0.4.0+, 서버가 계산한 초록/노랑/빨강 + 사유 툴팁).
//   하트비트가 없는 줄(옛 확프)은 예전처럼 최근 동기화 신선도(48시간 이내 초록 / 7일 이내 노랑 / 그 외·없음 회색).
// 되읽기 스위치(줄별·전체) = 서버 원격 설정. 확프는 다음 하트비트(≤5분)에 따른다.

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import styles from "./admin-index.module.css";
import PinResetButton from "./PinResetButton";
import RenameStreamerButton from "./RenameStreamerButton";
import DeleteStreamerButton from "./DeleteStreamerButton";
import ResetDataButton from "./ResetDataButton";
import { setExtensionConfigAction, setExtensionConfigForAllAction } from "./actions";
import type { AdminStreamerSummary } from "@/lib/adminDashboard";
import {
  EXTENSION_CONFIG_DEFAULT,
  extensionConfigSummary,
  formatElapsed,
  type ExtensionConfig,
  type ExtensionLightColor,
} from "@/lib/extensionStatus";

function fmtKst(iso?: string): string {
  if (!iso) return "수집 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

type Freshness = "fresh" | "stale" | "none";

function freshness(iso?: string): Freshness {
  if (!iso) return "none";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "none";
  const hours = (Date.now() - t) / 36e5;
  if (hours <= 48) return "fresh";
  if (hours <= 24 * 7) return "stale";
  return "none";
}

const FRESH_LABEL: Record<Freshness, string> = {
  fresh: "48시간 내 동기화",
  stale: "7일 내 동기화",
  none: "동기화 오래됨/없음",
};

const LIGHT_LABEL: Record<ExtensionLightColor, string> = {
  green: "확프 정상",
  yellow: "확프 주의",
  red: "확프 이상",
  gray: "확프 상태 없음",
};

type ExtensionSummary = NonNullable<AdminStreamerSummary["extension"]>;

// 툴팁: 사유(없으면 "정상") · 참고 정보(색 무관) · 마지막 하트비트 N분 전. 렌더 시각 기준이라 SSR/수화 차이는 무시한다.
function extensionTitle(ext: ExtensionSummary): string {
  const reasons = ext.light.reasons.length > 0 ? ext.light.reasons.join(" · ") : "정상";
  const notes = ext.notes.length > 0 ? ` · ${ext.notes.join(" · ")}` : "";
  return `${LIGHT_LABEL[ext.light.color]}: ${reasons}${notes} · ${formatElapsed(Date.now() - Date.parse(ext.updatedAt))} 전`;
}

// 되읽기 설정 줄은 켜져 있거나 기본값과 다른 값이 있을 때만 보인다(전부 기본·꺼짐이면 토글 툴팁에만).
function showConfigLine(config: ExtensionConfig): boolean {
  if (config.catchupEnabled) return true;
  return (Object.keys(EXTENSION_CONFIG_DEFAULT) as Array<keyof ExtensionConfig>).some(
    (key) => key !== "catchupEnabled" && config[key] !== EXTENSION_CONFIG_DEFAULT[key],
  );
}

// 줄별 되읽기 스위치. 저장 중엔 낙관적으로 보여 주고, 저장 뒤 목록 새로고침(revalidate) 값으로 맞춘다.
function CatchupToggle({
  slug,
  enabled,
  summary,
  disabled,
}: {
  slug: string;
  enabled: boolean;
  summary: string;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(enabled);
  const [error, setError] = useState("");
  return (
    <>
      <label
        className={styles.catchupToggle}
        title={`확프 되읽기(빠진 행 다시 읽기) — ${summary}. 서버 설정, 다음 하트비트(최대 5분)에 반영`}
      >
        <input
          type="checkbox"
          checked={shown}
          disabled={disabled || pending}
          onChange={(event) => {
            const next = event.target.checked;
            setError("");
            startTransition(async () => {
              setShown(next);
              const res = await setExtensionConfigAction(slug, { catchupEnabled: next });
              if (!res.ok) setError(res.error || "저장 실패");
            });
          }}
        />
        되읽기
      </label>
      {error ? <span className={styles.resetErr}>{error}</span> : null}
    </>
  );
}

// 목록 머리: 되읽기 전체 끄기/켜기(확인 한 번). 스트리머마다 자기 설정에 덮어쓴 이벤트 1건씩 남는다.
function CatchupAllControls({ onCount, total, disabled }: { onCount: number; total: number; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const run = (enabled: boolean) => {
    const question = enabled
      ? "모든 스트리머의 확프 되읽기를 켤까요?"
      : "모든 스트리머의 확프 되읽기를 끌까요?";
    if (!window.confirm(`${question}\n확프는 다음 하트비트(최대 5분)에 따라요.`)) return;
    setMessage("");
    startTransition(async () => {
      const res = await setExtensionConfigForAllAction({ catchupEnabled: enabled });
      setMessage(res.ok ? `${res.count ?? 0}명 ${enabled ? "켬" : "끔"} ✓` : res.error || "저장 실패");
    });
  };
  return (
    <div className={styles.catchupBar}>
      <span>
        확프 되읽기 <b>{onCount}</b> / {total}명 켜짐
      </span>
      <button type="button" className={styles.resetBtn} disabled={disabled || pending} onClick={() => run(false)}>
        되읽기 전체 끄기
      </button>
      <button type="button" className={styles.resetBtn} disabled={disabled || pending} onClick={() => run(true)}>
        전체 켜기
      </button>
      {pending ? <span className={styles.catchupMsg}>저장 중…</span> : null}
      {!pending && message ? <span className={styles.catchupMsg}>{message}</span> : null}
    </div>
  );
}

type SortKey = "attention" | "recent" | "name";

export default function StreamerList({
  streamers,
  isMock,
}: {
  streamers: AdminStreamerSummary[];
  isMock: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("attention");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let out = needle
      ? streamers.filter(
          (s) => s.slug.toLowerCase().includes(needle) || s.displayName.toLowerCase().includes(needle),
        )
      : streamers;
    out = [...out].sort((a, b) => {
      if (sort === "name") return a.displayName.localeCompare(b.displayName);
      if (sort === "recent") return String(b.lastAppliedAt ?? "").localeCompare(String(a.lastAppliedAt ?? ""));
      return (
        b.needsReviewSum - a.needsReviewSum ||
        String(b.lastAppliedAt ?? "").localeCompare(String(a.lastAppliedAt ?? ""))
      );
    });
    return out;
  }, [streamers, query, sort]);

  const suffix = isMock ? "?mock=1" : "";
  const catchupOnCount = streamers.filter((s) => s.extensionConfig.catchupEnabled).length;

  return (
    <div className={styles.listWrap}>
      <div className={styles.controls}>
        <input
          className={styles.search}
          type="search"
          placeholder="스트리머 검색 (이름 / 슬러그)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className={styles.sortBox}>
          <span>정렬</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="attention">검토 필요순</option>
            <option value="recent">최근 동기화순</option>
            <option value="name">이름순</option>
          </select>
        </label>
        <span className={styles.count}>
          {shown.length} / {streamers.length}명
        </span>
      </div>
      <CatchupAllControls onCount={catchupOnCount} total={streamers.length} disabled={isMock} />

      {shown.length === 0 ? (
        <p className={styles.empty}>
          {query ? `'${query}'에 해당하는 스트리머가 없어요.` : "아직 등록된 스트리머가 없어요."}
        </p>
      ) : (
        <>
          <div className={styles.colHead} aria-hidden>
            <span className={styles.chName}>스트리머</span>
            <span className={styles.chRecords}>기록</span>
            <span className={styles.chReview}>검토</span>
            <span className={styles.chSync}>최근 동기화</span>
            <span className={styles.chActions}>관리</span>
          </div>
          <ul className={styles.list}>
            {shown.map((s) => {
              const f = freshness(s.lastAppliedAt);
              return (
                <li key={s.slug}>
                  <div className={styles.row}>
                    <div className={styles.rowMain}>
                      {s.extension ? (
                        <span
                          className={styles.syncDot}
                          data-light={s.extension.light.color}
                          role="img"
                          aria-label={extensionTitle(s.extension)}
                          title={extensionTitle(s.extension)}
                          suppressHydrationWarning
                        />
                      ) : (
                        <span className={styles.syncDot} data-fresh={f} title={FRESH_LABEL[f]} />
                      )}
                      <div className={styles.nameBox}>
                        <Link href={`/${s.slug}`} className={styles.name} title="팬 시트 열기">
                          {s.displayName}
                        </Link>
                        <span className={styles.slug}>/{s.slug}</span>
                        {s.extension ? (
                          <span className={styles.extLine}>
                            확프{s.extension.clientVersion ? ` v${s.extension.clientVersion}` : ""} · {s.extension.screenSummary}
                          </span>
                        ) : null}
                        {/* 초록이 아니면 사유를 글자로도 — 툴팁은 터치 화면에서 안 보인다 */}
                        {s.extension && s.extension.light.reasons.length > 0 ? (
                          <span className={styles.extReasons} data-light={s.extension.light.color}>
                            {s.extension.light.reasons.join(" · ")}
                          </span>
                        ) : null}
                        {s.extension && s.extension.notes.length > 0 ? (
                          <span className={styles.extNotes}>{s.extension.notes.join(" · ")}</span>
                        ) : null}
                        {showConfigLine(s.extensionConfig) ? (
                          <span className={styles.extConfig}>
                            되읽기 {s.extensionConfig.catchupEnabled ? "켜짐" : "꺼짐"} ·{" "}
                            {extensionConfigSummary(s.extensionConfig)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className={styles.colRecords}>{s.recordSum.toLocaleString()}</span>
                    <span className={styles.colReview}>
                      {s.needsReviewSum > 0 ? (
                        <span className={styles.needs}>{s.needsReviewSum}</span>
                      ) : (
                        <span className={styles.dash}>—</span>
                      )}
                    </span>
                    <span className={styles.colSync}>{fmtKst(s.lastAppliedAt)}</span>
                    <div className={styles.rowActions}>
                      <CatchupToggle
                        slug={s.slug}
                        enabled={s.extensionConfig.catchupEnabled}
                        summary={extensionConfigSummary(s.extensionConfig)}
                        disabled={isMock}
                      />
                      <Link href={`/admin/${s.slug}${suffix}`} className={styles.verifyLink}>
                        검증실
                      </Link>
                      {isMock ? null : (
                        <>
                          <RenameStreamerButton slug={s.slug} current={s.displayName} />
                          <PinResetButton slug={s.slug} />
                          <ResetDataButton slug={s.slug} />
                          <DeleteStreamerButton slug={s.slug} />
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
