"use client";

// 검증 대시보드 표 공용 컴포넌트(읽기 전용).
// 검색 / 상태 필터(facet) / 정렬을 클라이언트에서 처리한다. 데이터 변경 기능은 없다.

import { useMemo, useState } from "react";
import styles from "./FilterableTable.module.css";

export type Column = {
  key: string;
  label: string;
  kind?: "text" | "num" | "percent" | "badge" | "mono";
  width?: string;
  align?: "left" | "right" | "center";
};

export type Facet = {
  label: string;
  key: string;
  options: { value: string; label: string }[];
};

export type SortOption = { key: string; label: string };

type Row = Record<string, unknown>;

const BADGE_CLASS: Record<string, string> = {
  record: styles.badgeRecord,
  ignore: styles.badgeIgnore,
  duplicate: styles.badgeDuplicate,
  needs_review: styles.badgeReview,
  pending: styles.badgePending,
  completed: styles.badgeCompleted,
  cancelled: styles.badgeCancelled,
  hidden: styles.badgeHidden,
};

const BADGE_LABEL: Record<string, string> = {
  record: "기록",
  ignore: "제외",
  duplicate: "중복",
  needs_review: "검토필요",
  pending: "대기",
  completed: "완료",
  cancelled: "취소",
  hidden: "숨김",
};

export default function FilterableTable({
  rows,
  columns,
  searchKeys,
  searchPlaceholder,
  facet,
  sortOptions,
  emptyText,
}: {
  rows: Row[];
  columns: Column[];
  searchKeys: string[];
  searchPlaceholder?: string;
  facet?: Facet;
  sortOptions?: SortOption[];
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [facetValue, setFacetValue] = useState("all");
  const [sortKey, setSortKey] = useState(sortOptions?.[0]?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let out = rows;
    if (needle) {
      out = out.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
    }
    if (facet && facetValue !== "all") {
      out = out.filter((r) => String(r[facet.key] ?? "") === facetValue);
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = typeof av === "number" ? av : Number(av);
        const bn = typeof bv === "number" ? bv : Number(bv);
        const cmp =
          !Number.isNaN(an) && !Number.isNaN(bn) && av !== "" && bv !== ""
            ? an - bn
            : String(av ?? "").localeCompare(String(bv ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, query, facet, facetValue, sortKey, sortDir, searchKeys]);

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? "검색 (닉네임 / 계정ID / sourceKey / 상품)"}
          type="search"
        />
        {facet ? (
          <label className={styles.control}>
            <span>{facet.label}</span>
            <select value={facetValue} onChange={(e) => setFacetValue(e.target.value)}>
              <option value="all">전체</option>
              {facet.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {sortOptions && sortOptions.length > 0 ? (
          <label className={styles.control}>
            <span>정렬</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              {sortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.dirBtn}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              aria-label="정렬 방향 전환"
            >
              {sortDir === "asc" ? "▲ 오름" : "▼ 내림"}
            </button>
          </label>
        ) : null}
        <span className={styles.count}>
          {filtered.length} / {rows.length}건
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>{emptyText ?? "표시할 데이터가 없어요."}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${String(r.sourceKey ?? r.id ?? i)}-${i}`}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{ textAlign: c.align ?? "left" }}
                      className={c.kind === "mono" ? styles.monoCell : undefined}
                    >
                      {renderCell(r, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function renderCell(row: Record<string, unknown>, col: Column) {
  const value = row[col.key];
  if (col.kind === "badge") {
    const key = String(value ?? "");
    return <span className={`${styles.badge} ${BADGE_CLASS[key] ?? ""}`}>{BADGE_LABEL[key] ?? key}</span>;
  }
  if (value === null || value === undefined || value === "") {
    return <span className={styles.dim}>—</span>;
  }
  if (col.kind === "percent") return `${value}%`;
  if (col.kind === "mono") {
    return (
      <code className={styles.mono} title={String(value)}>
        {String(value)}
      </code>
    );
  }
  return String(value);
}
