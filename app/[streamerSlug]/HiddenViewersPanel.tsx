"use client";

// 배송관리 "숨긴 시청자" 하위탭 — 숨김(완료 후 목록 제외) 처리된 시청자 목록 + 개별 복구.
// 복구는 기존 viewer-archive API(archived:false)를 그대로 쓴다(새 서버 기능 없음).
// 성공하면 전체 새로고침으로 서버 계산(SSR)과 운영 저장값을 처음부터 다시 읽는다 —
// 클라이언트에 남은 기준선 보정값(archivedHiddenCounts)과 어긋나는 것을 원천 차단.
// 같은 이유로 저장 안 된 변경(dirty)이 있으면 복구를 막는다(새로고침으로 날아가는 사고 방지).

import { useMemo, useState } from "react";
import styles from "./page.module.css";
import type { AggItem, ViewerSummary } from "../../lib/api";

type DeliveryState = Record<string, Record<string, number>>;

const itemKey = (it: AggItem) =>
  `${it.itemName}@@${it.probability}@@${it.amountRangeLabel ?? ""}`;

// 숨긴 시각(ISO) → "7월 7일" (Asia/Seoul). 파싱 불가면 빈 문자열.
function fmtArchivedAt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(d);
}

// 복구 미리보기: 복구 후 이 시청자가 어떤 상태가 되는지.
// shortfall = 복구 후 "미처리"로 표시될 개수(숨김분 + 현재 보이는 재당첨분 − 서버 저장 처리수량).
type Preview = { doneKinds: number; totalKinds: number; shortfall: number };

export default function HiddenViewersPanel({
  slug,
  hidden,
  archivedFanAt,
  visibleViewers,
  rawProgress,
  loading,
  dirty,
}: {
  slug: string;
  // 숨긴 시청자의 옛 기록(항목·수량). page.tsx가 보관 필터로 걸러낸 것과 동일 계산.
  hidden: ViewerSummary[];
  // fanId -> 숨긴 시각(ISO)
  archivedFanAt: Record<string, string>;
  // 현재 배송관리에 보이는 시청자(재당첨 신규분) — 복구 후 총량 계산용.
  visibleViewers: ViewerSummary[];
  // 서버에 저장된 처리수량 원본(기준선 보정 전 값).
  rawProgress: DeliveryState;
  loading: boolean;
  dirty: boolean;
}) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<ViewerSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // fanId -> itemKey -> 현재 보이는 수량(재당첨 신규분). 복구 후 총량 = 숨김분 + 이 값.
  const visibleByFan = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const v of visibleViewers) {
      if (!v.fanId) continue;
      const m = out.get(v.fanId) ?? new Map<string, number>();
      for (const it of v.items) m.set(itemKey(it), (m.get(itemKey(it)) ?? 0) + it.count);
      out.set(v.fanId, m);
    }
    return out;
  }, [visibleViewers]);

  const previews = useMemo(() => {
    const out = new Map<string, Preview>();
    for (const hv of hidden) {
      const vis = visibleByFan.get(hv.fanId);
      const raw = rawProgress[hv.fanId] ?? {};
      let doneKinds = 0;
      let shortfall = 0;
      for (const it of hv.items) {
        const k = itemKey(it);
        const total = it.count + (vis?.get(k) ?? 0);
        const done = Math.min(raw[k] ?? 0, total);
        if (done >= total) doneKinds += 1;
        else shortfall += total - done;
      }
      out.set(hv.key, { doneKinds, totalKinds: hv.items.length, shortfall });
    }
    return out;
  }, [hidden, visibleByFan, rawProgress]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return hidden
      .filter(
        (hv) =>
          !needle ||
          hv.fanId.toLowerCase().includes(needle) ||
          hv.fanNickname.toLowerCase().includes(needle),
      )
      .sort((a, b) =>
        String(archivedFanAt[b.fanId] ?? "").localeCompare(String(archivedFanAt[a.fanId] ?? "")),
      );
  }, [hidden, q, archivedFanAt]);

  const restore = async () => {
    if (!target) return;
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/viewer-archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fanIds: [target.fanId], archived: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const text =
          res.status === 401
            ? "로그인이 풀렸어요. 관리자 비밀번호로 다시 들어와 주세요."
            : `복구 실패 — ${typeof data?.error === "string" && data.error ? data.error : `서버 오류(${res.status})`}`;
        setMessage({ type: "err", text });
        setRestoring(false);
        return;
      }
      setMessage({ type: "ok", text: `${target.fanNickname} 복구 완료! 화면을 새로 불러옵니다…` });
      // 복구는 SSR 계산(보관 필터·기준선 보정)에 두루 영향을 주므로 전체 새로고침이 가장 안전하다.
      window.location.reload();
    } catch {
      setMessage({ type: "err", text: "네트워크 문제로 복구하지 못했어요. 잠시 후 다시 시도해 주세요." });
      setRestoring(false);
    }
  };

  const targetPreview = target ? previews.get(target.key) : undefined;

  return (
    <>
      <p className={styles.fieldHint}>
        배송완료 후 숨긴 시청자예요. 복구하면 옛 기록이 배송 목록과 팬 화면에 다시 보입니다. 원본
        기록은 숨겨진 동안에도 삭제되지 않아요.
      </p>
      {message ? (
        <p className={message.type === "ok" ? styles.fieldOk : styles.fieldErr}>{message.text}</p>
      ) : null}
      {dirty ? (
        <p className={styles.fieldErr}>
          저장 안 된 변경이 있어요. 먼저 저장하거나 되돌린 뒤 복구할 수 있어요.
        </p>
      ) : null}
      {loading ? <p className={styles.fieldHint}>운영 저장값 불러오는 중…</p> : null}

      {hidden.length === 0 ? (
        <p className={styles.fieldHint}>숨긴 시청자가 없어요.</p>
      ) : (
        <>
          <div className={styles.cmToolbar}>
            <input
              className={styles.cmSearch}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="닉네임 또는 계정ID 검색"
              aria-label="숨긴 시청자 검색"
            />
            <span className={styles.tagMuted}>숨긴 시청자 {hidden.length}명</span>
          </div>

          <ul className={styles.dmList}>
            {rows.map((hv) => {
              const p = previews.get(hv.key) ?? { doneKinds: 0, totalKinds: 0, shortfall: 0 };
              const when = fmtArchivedAt(archivedFanAt[hv.fanId]);
              return (
                <li key={hv.key} className={styles.dmItem}>
                  <div className={styles.dmRow}>
                    <span className={styles.dmName}>{hv.fanNickname}</span>
                    <span className={styles.dmId}>{hv.fanId}</span>
                    {when ? <span className={styles.tagMuted}>{when} 숨김</span> : null}
                    <span className={styles.tagMuted}>
                      상품 {hv.items.length}종 · {hv.total}개
                    </span>
                    {loading ? null : p.shortfall === 0 ? (
                      <span className={styles.tagActive}>복구 후 전부 완료</span>
                    ) : (
                      <span className={styles.tagWarn}>복구 후 미처리 {p.shortfall}개</span>
                    )}
                    <div className={styles.dmActions}>
                      <button
                        type="button"
                        className={styles.dmAllBtn}
                        onClick={() => setTarget(hv)}
                        disabled={dirty || loading || restoring}
                      >
                        복구
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {rows.length === 0 ? (
            <p className={styles.fieldHint}>조건에 맞는 숨긴 시청자가 없어요.</p>
          ) : null}
        </>
      )}

      {/* 복구 확인 모달 — 복구 후 상태 미리보기 + 팬 화면 노출 경고 */}
      {target ? (
        <div
          className={styles.modalOverlay}
          onClick={() => (restoring ? null : setTarget(null))}
          role="presentation"
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hv-restore-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="hv-restore-title" className={styles.modalTitle}>
              {target.fanNickname} 님을 복구할까요?
            </h3>
            <p className={styles.fieldHint}>
              숨겨 둔 기록 {target.items.length}종 · {target.total}개가 배송 목록에 돌아옵니다.{" "}
              {targetPreview && targetPreview.shortfall > 0
                ? `복구 후 미처리 ${targetPreview.shortfall}개가 배송 중 목록에 표시돼요.`
                : "전부 '처리 완료' 상태로 복원돼요."}
            </p>
            <p className={styles.fieldHint}>팬 화면에도 이 시청자의 옛 기록이 다시 보여요.</p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancel}
                onClick={() => setTarget(null)}
                disabled={restoring}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.modalConfirm}
                onClick={restore}
                disabled={restoring}
              >
                {restoring ? "복구 중…" : "복구"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
