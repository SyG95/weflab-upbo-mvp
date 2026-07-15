"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { normalizeAccountId, type ItemEvent, type UpboEntry } from "../../lib/api";

// 시스템 시각(UTC ISO)을 Asia/Seoul "MM-DD HH:mm"로.
function fmtKst(iso?: string): string {
  if (!iso) return "—";
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
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function readStr(json: Record<string, unknown> | null, key: string): string {
  if (!json) return "";
  const v = json[key];
  return typeof v === "string" ? v : "";
}

type LogKind = "transfer" | "exchange" | "cancel" | "revert";

type LogRow = {
  id: string;
  createdAt?: string;
  kind: LogKind;
  who: string; // 양도=준 사람 / 교환·취소·되돌리기=보유자
  to?: string; // 양도받는 사람
  toId?: string; // 양도받는 사람 계정ID(비어 있으면 갈라짐 위험)
  item: string;
  newItem?: string;
  qty: number | null;
  reason: string | null;
};

const KIND_LABEL: Record<LogKind, string> = {
  transfer: "양도",
  exchange: "교환",
  cancel: "취소",
  revert: "되돌리기",
};

export default function ItemHistoryLog({
  slug,
  entries,
  events,
}: {
  slug: string;
  entries: UpboEntry[];
  events: ItemEvent[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function saveOwnerId(eventId: string) {
    const id = idDraft.trim();
    if (!id) {
      setMsg({ type: "err", text: "계정ID를 적어 주세요." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/item-events`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, ownerId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "저장에 실패했어요.");
      setMsg({ type: "ok", text: "계정ID를 넣어 같은 사람으로 통합했어요." });
      setEditingId(null);
      setIdDraft("");
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "저장에 실패했어요." });
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo<LogRow[]>(() => {
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    const out: LogRow[] = [];
    // N:M 번들 교환은 조각(entry)마다 이벤트가 생기지만 이력엔 그룹당 1건만 보여준다.
    const seenBundles = new Set<string>();
    // after_json 의 gave/received 요약([{itemName, quantity}])을 "A 2개 + B 1개"로.
    const fmtBundle = (raw: unknown): string => {
      if (!Array.isArray(raw)) return "";
      return raw
        .map((x) => {
          const rec = (x ?? {}) as Record<string, unknown>;
          const name = typeof rec.itemName === "string" ? rec.itemName : "";
          const n = Number(rec.quantity);
          return name ? `${name} ${Number.isFinite(n) ? n : "?"}개` : "";
        })
        .filter(Boolean)
        .join(" + ");
    };
    for (const ev of events) {
      const entry = entryMap.get(ev.upboEntryId);
      const itemName = entry?.itemName ?? "(상품)";
      const winner = entry?.fanNickname || "(이름 없음)";
      const qty = ev.quantityDelta ?? null;
      if (ev.eventType === "transfer") {
        out.push({
          id: ev.id,
          createdAt: ev.createdAt,
          kind: "transfer",
          who: readStr(ev.beforeJson, "currentOwnerName") || winner,
          to: readStr(ev.afterJson, "currentOwnerName") || "(받는 사람)",
          toId: normalizeAccountId(readStr(ev.afterJson, "currentOwnerId")),
          item: itemName,
          qty,
          reason: ev.reason ?? null,
        });
      } else if (ev.eventType === "exchange") {
        if (ev.afterJson?.exchangeOut === true) {
          // 번들 교환: 그룹당 1건, "주는 묶음 → 받는 묶음"으로 표시.
          const gid = readStr(ev.afterJson, "exchangeGroupId") || ev.id;
          if (seenBundles.has(gid)) continue;
          seenBundles.add(gid);
          out.push({
            id: ev.id,
            createdAt: ev.createdAt,
            kind: "exchange",
            who: readStr(ev.afterJson, "viewerName") || winner,
            item: fmtBundle(ev.afterJson?.gave) || itemName,
            newItem: fmtBundle(ev.afterJson?.received) || "(상품)",
            qty: null,
            reason: ev.reason ?? null,
          });
        } else {
          out.push({
            id: ev.id,
            createdAt: ev.createdAt,
            kind: "exchange",
            who: winner,
            item: readStr(ev.beforeJson, "currentItemName") || itemName,
            newItem: readStr(ev.afterJson, "currentItemName") || "(상품)",
            qty,
            reason: ev.reason ?? null,
          });
        }
      } else if (ev.eventType === "cancel" || ev.eventType === "void") {
        out.push({
          id: ev.id,
          createdAt: ev.createdAt,
          kind: "cancel",
          who: winner,
          item: itemName,
          qty,
          reason: ev.reason ?? null,
        });
      } else if (ev.eventType === "admin_adjustment") {
        const revertGid = readStr(ev.afterJson, "revertOfGroupId");
        if (revertGid) {
          // 번들 교환 되돌리기: 조각마다 이벤트가 생기지만 이력엔 묶음당 1건만.
          const k = `revert:${revertGid}`;
          if (seenBundles.has(k)) continue;
          seenBundles.add(k);
          out.push({
            id: ev.id,
            createdAt: ev.createdAt,
            kind: "revert",
            who: winner,
            item: "교환 묶음 (준 수량 복구 · 받은 기록 삭제)",
            qty: null,
            reason: ev.reason ?? null,
          });
        } else {
          out.push({
            id: ev.id,
            createdAt: ev.createdAt,
            kind: "revert",
            who: winner,
            item: itemName,
            qty,
            reason: ev.reason ?? null,
          });
        }
      }
      // created_from_source / memo / status_change / quantity_adjust 는 이력 목록에서 생략.
    }
    out.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return out;
  }, [entries, events]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.who} ${r.to ?? ""} ${r.item} ${r.newItem ?? ""}`.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div className={styles.ieWrap}>
      <div className={styles.ieToolbar}>
        <input
          className={styles.ieSearch}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="닉네임 · 상품 검색"
          aria-label="이력 검색"
        />
      </div>

      <div className={styles.ieSummary}>
        <span className={styles.tag}>이력 {rows.length}건</span>
        {q.trim() ? <span className={styles.tagMuted}>검색 결과 {view.length}건</span> : null}
      </div>
      {msg ? (
        <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p>
      ) : null}

      {view.length === 0 ? (
        <p className={styles.fieldHint}>
          {q.trim() ? "조건에 맞는 이력이 없어요." : "아직 양도·교환·취소 이력이 없어요."}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.donateCol}>시간</th>
                <th>내용</th>
                <th className={styles.countCol}>개수</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr key={r.id}>
                  <td className={styles.donateCell}>{fmtKst(r.createdAt)}</td>
                  <td>
                    <span className={styles.ieLogKind}>{KIND_LABEL[r.kind]}</span>{" "}
                    {r.kind === "transfer" ? (
                      <>
                        <strong>{r.who}</strong> <span className={styles.ieArrow}>→</span>{" "}
                        <strong>{r.to}</strong>{" "}
                        {r.toId ? (
                          <span className={styles.ieId}>{r.toId}</span>
                        ) : editingId === r.id ? (
                          <span className={styles.ieHistFix}>
                            <input
                              className={styles.ieHistFixInput}
                              value={idDraft}
                              onChange={(e) => setIdDraft(e.target.value)}
                              placeholder="계정ID"
                              autoFocus
                            />
                            <button
                              type="button"
                              className={styles.ieRevertBtn}
                              onClick={() => saveOwnerId(r.id)}
                              disabled={busy}
                            >
                              {busy ? "저장 중…" : "저장"}
                            </button>
                            <button
                              type="button"
                              className={styles.ieRevertBtn}
                              onClick={() => {
                                setEditingId(null);
                                setIdDraft("");
                              }}
                              disabled={busy}
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={styles.ieHistFixBtn}
                            onClick={() => {
                              setEditingId(r.id);
                              setIdDraft("");
                              setMsg(null);
                            }}
                          >
                            계정ID 지정
                          </button>
                        )}{" "}
                        · {r.item}
                      </>
                    ) : r.kind === "exchange" ? (
                      <>
                        <strong>{r.who}</strong> · {r.item} <span className={styles.ieArrow}>→</span> {r.newItem}
                      </>
                    ) : (
                      <>
                        <strong>{r.who}</strong> · {r.item}
                      </>
                    )}
                  </td>
                  <td className={styles.countCell}>{r.qty != null ? `${r.qty}개` : "—"}</td>
                  <td className={styles.idCell}>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
