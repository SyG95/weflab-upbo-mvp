"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { buildRevertOf, normalizeAccountId, type ItemEvent, type UpboEntry } from "../../lib/api";

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
  // 되돌리기 재료: 원 이벤트(단건) 또는 번들 교환 묶음 id. 되돌리기 행·이미 되돌려진 행은 없음.
  revert?: { ev: ItemEvent; bundleGroupId?: string };
  reverted?: boolean;
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
  const [reverting, setReverting] = useState<string | null>(null);
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

  // 되돌리기 — 교환·양도 카드의 이력과 같은 엔진(번들 교환=묶음 DELETE, 그 외=admin_adjustment+revertOf).
  // 카드 이력은 보유 조각이 전부 취소돼 카드 자체가 사라진 시청자를 못 보여주므로, 여기가 마지막 진입점이다.
  async function revert(row: LogRow) {
    const r = row.revert;
    if (!r || busy) return;
    setBusy(true);
    setReverting(row.id);
    setMsg(null);
    try {
      if (r.bundleGroupId) {
        const res = await fetch(
          `/api/s/${encodeURIComponent(slug)}/exchange?groupId=${encodeURIComponent(r.bundleGroupId)}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          coupon?: { totalDelta?: number; error?: string } | null;
        };
        if (!res.ok || data.ok === false) throw new Error(data.error || "되돌리기에 실패했어요. 잠시 후 다시 시도해 주세요.");
        if (data.coupon?.error) {
          setMsg({
            type: "err",
            text: "교환 묶음은 되돌렸지만, 자동 적립됐던 쿠폰 회수에 실패했어요. 쿠폰 탭에서 수동으로 빼 주세요.",
          });
        } else {
          const revokedText =
            (data.coupon?.totalDelta ?? 0) > 0 ? `, 쿠폰 ${data.coupon!.totalDelta}개 회수` : "";
          setMsg({ type: "ok", text: `교환 묶음을 되돌렸어요. (준 수량 복구, 받은 기록 삭제${revokedText})` });
        }
      } else {
        const revertOf = buildRevertOf(r.ev);
        const res = await fetch(`/api/s/${encodeURIComponent(slug)}/item-events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            upboEntryId: r.ev.upboEntryId,
            actorType: "operator",
            eventType: "admin_adjustment",
            reason: `${KIND_LABEL[row.kind]} 되돌리기`,
            ...(revertOf ? { revertOf } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || "처리에 실패했어요. 이미 되돌린 기록인지 확인해 주세요.");
        }
        setMsg({ type: "ok", text: "되돌렸어요. (보유 수량 복구 반영)" });
      }
      // 서버 데이터 재조회 — 이 행은 「되돌려짐」으로 바뀌고, 새 되돌리기 행이 맨 위에 생긴다.
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "되돌리기에 실패했어요." });
    } finally {
      setBusy(false);
      setReverting(null);
    }
  }

  // 이미 되돌려진 이벤트/교환 묶음 — 버튼 대신 「되돌려짐」을 보여 이중 복구를 막는다(서버에도 같은 가드 있음).
  const revertedIds = useMemo(() => {
    const s = new Set<string>();
    for (const ev of events) {
      if (ev.eventType !== "admin_adjustment") continue;
      const id = ev.afterJson?.revertOfEventId;
      if (typeof id === "string" && id) s.add(id);
      const gid = ev.afterJson?.revertOfGroupId;
      if (typeof gid === "string" && gid) s.add(`group:${gid}`);
    }
    return s;
  }, [events]);

  const rows = useMemo<LogRow[]>(() => {
    const entryMap = new Map(entries.map((e) => [e.id, e]));
    const out: LogRow[] = [];
    // 되돌리기 가능 여부: 번들 교환은 묶음 id, 그 외는 이벤트 id 로 이미 되돌려졌는지 본다.
    const revertFields = (ev: ItemEvent, bundleGroupId?: string): Pick<LogRow, "revert" | "reverted"> => {
      const reverted = bundleGroupId ? revertedIds.has(`group:${bundleGroupId}`) : revertedIds.has(ev.id);
      return reverted ? { reverted: true } : { revert: { ev, bundleGroupId } };
    };
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
          ...revertFields(ev),
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
            ...revertFields(ev, gid),
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
            ...revertFields(ev),
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
          // void(무효)는 카드 이력과 마찬가지로 되돌리기 대상이 아니다.
          ...(ev.eventType === "cancel" ? revertFields(ev) : {}),
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
  }, [entries, events, revertedIds]);

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
                <th className={styles.ieHistRevertCol}>되돌리기</th>
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
                  <td className={styles.ieHistRevertCol}>
                    {r.revert ? (
                      <button
                        type="button"
                        className={styles.ieRevertBtn}
                        onClick={() => void revert(r)}
                        disabled={busy}
                      >
                        {reverting === r.id ? "처리 중…" : r.revert.bundleGroupId ? "묶음 되돌리기" : "되돌리기"}
                      </button>
                    ) : r.reverted ? (
                      <span className={styles.tagMuted}>되돌려짐</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
