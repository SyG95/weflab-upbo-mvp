"use client";

// 운영 콘솔 목록: 장부형(컬럼 정렬) 스트리머 현황 + 줄별 관리(시트/검증실/비번 리셋/삭제).
// 상태점 = 최근 동기화 신선도(48시간 이내 초록 / 7일 이내 노랑 / 그 외·없음 회색).

import { useMemo, useState } from "react";
import Link from "next/link";
import styles from "./admin-index.module.css";
import PinResetButton from "./PinResetButton";
import DeleteStreamerButton from "./DeleteStreamerButton";
import ResetDataButton from "./ResetDataButton";
import type { AdminStreamerSummary } from "@/lib/adminDashboard";

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
                      <span className={styles.syncDot} data-fresh={f} title={FRESH_LABEL[f]} />
                      <div className={styles.nameBox}>
                        <Link href={`/${s.slug}`} className={styles.name} title="팬 시트 열기">
                          {s.displayName}
                        </Link>
                        <span className={styles.slug}>/{s.slug}</span>
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
                      <Link href={`/admin/${s.slug}${suffix}`} className={styles.verifyLink}>
                        검증실
                      </Link>
                      {isMock ? null : (
                        <>
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
