"use client";

// 위플랩 공개 링크 등록 + "지금 가져오기" — 확프 없이 룰렛표를 읽어오는 새 레인(sy 확정 2026-07-08).
// 스트리머가 방송국에 상시 공유하는 weflab.com/user/<hash> 링크를 한 번 등록해두면, 이 버튼으로
// 언제든 최신 룰렛표를 가져올 수 있다. 확프의 "룰렛표 읽기"는 이행기 동안 병행(둘 다 같은 저장 통로).
// 당첨 결과는 이 링크에 없다 — 확프는 결과 전용으로 계속 필요하다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeflabLinkInfo } from "../../lib/api";
import styles from "./page.module.css";

export default function WeflabLinkManager({
  slug,
  initial,
}: {
  slug: string;
  initial: WeflabLinkInfo;
}) {
  const [url, setUrl] = useState(initial.url ?? "");
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [meta, setMeta] = useState(initial);
  const router = useRouter();

  const saveUrl = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/weflab-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setMeta(data.weflabLink ?? meta);
      setMsg({ kind: "ok", text: "링크를 저장했어요." });
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message || "저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  };

  const fetchNow = async () => {
    setFetching(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/weflab-link/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setMeta(data.weflabLink ?? meta);
      if (data.overlapWarning) {
        setMsg({
          kind: "warn",
          text: `가져왔어요 (표 ${data.tableCount}개 · 상품 ${data.itemCount}개). 다만 기존 룰렛표와 상품이 많이 달라요 — 링크가 맞는지 확인해 주세요.`,
        });
      } else {
        setMsg({
          kind: "ok",
          text: `가져왔어요! 표 ${data.tableCount}개 · 상품 ${data.itemCount}개${
            data.modifiedAtText ? ` · 위플랩 수정시간 ${data.modifiedAtText}` : ""
          }`,
        });
      }
      router.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message || "가져오지 못했어요." });
    } finally {
      setFetching(false);
    }
  };

  return (
    <div>
      <p className={styles.fieldHint}>
        방송국(숲)에 공유하는 위플랩 <b>공개 링크</b>를 등록해두면, 확프로 룰렛표를 읽지 않아도
        이 버튼으로 최신 표를 가져올 수 있어요. 확프는 결과(당첨) 수집에만 쓰면 됩니다.
      </p>
      <input
        className={styles.nameInput}
        type="text"
        value={url}
        placeholder="https://weflab.com/user/xxxxxxxx"
        onChange={(e) => setUrl(e.target.value)}
        maxLength={300}
      />
      <div className={styles.saveBar} style={{ marginTop: 10 }}>
        <button type="button" className={styles.saveBtn} onClick={saveUrl} disabled={saving || !url.trim()}>
          {saving ? "저장 중…" : "링크 저장"}
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={fetchNow}
          disabled={fetching || !(url.trim() || meta.url)}
        >
          {fetching ? "가져오는 중…" : "지금 가져오기"}
        </button>
      </div>
      {meta.lastFetchedAt ? (
        <p className={styles.fieldHint} style={{ marginTop: 8 }}>
          마지막으로 가져온 시각: {new Date(meta.lastFetchedAt).toLocaleString("ko-KR")}
          {meta.lastTableCount !== undefined ? ` · 표 ${meta.lastTableCount}개` : ""}
          {meta.lastModifiedText ? ` · 위플랩 수정시간 ${meta.lastModifiedText}` : ""}
        </p>
      ) : null}
      {msg ? (
        <p className={msg.kind === "ok" ? styles.fieldOk : msg.kind === "warn" ? styles.fieldHint : styles.fieldErr}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
