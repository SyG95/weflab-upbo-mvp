"use client";

// 관리자용 "상품 색상" 설정. 팬 화면에서 상품마다 배경 하이라이트 색을 지정한다(선택사항).
// 20색 프리셋만 고를 수 있고, 색 안 정한 상품은 기본색 그대로. 인증은 관리자 로그인 세션(쿠키).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_COLORS, productColorById } from "../../lib/api";
import styles from "./signatureCounts.module.css";

export default function ProductColorManager({
  slug,
  products,
  initial,
}: {
  slug: string;
  products: Array<{ name: string; prob: number }>;
  initial: Record<string, string>;
}) {
  const [colors, setColors] = useState<Record<string, string>>(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();
  const setCount = Object.keys(colors).length;

  function pick(name: string, id: string | null) {
    setColors((prev) => {
      const next = { ...prev };
      if (id) next[name] = id;
      else delete next[name];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/product-colors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ colors }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 팬 화면에 바로 반영됩니다." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  if (products.length === 0) {
    return <p className={styles.hint}>팬 화면에 뜨는 상품이 아직 없어요. 룰렛표·기록이 들어오면 여기서 색을 정할 수 있어요.</p>;
  }

  const productRows = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {products.map((p) => {
          const col = productColorById(colors[p.name]);
          return (
            <div
              key={p.name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "9px 11px",
                border: "1px solid var(--paper-line)",
                borderRadius: 11,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  padding: "4px 9px",
                  borderRadius: 9,
                  fontSize: 12,
                  background: col ? col.bg : "var(--paper)",
                  border: `1px solid ${col ? col.border : "var(--paper-line)"}`,
                }}
              >
                <span style={{ fontWeight: 700, color: col ? col.text : "var(--ink)" }}>{p.name}</span>
                <span style={{ fontWeight: 800, color: "var(--stamp)" }}>{p.prob}%</span>
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => pick(p.name, null)}
                  title="색 없음(기본색)"
                  aria-label="색 없음"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 5,
                    border: !col ? "2px solid var(--stamp)" : "1px solid var(--paper-line)",
                    background: "var(--surface)",
                    color: "var(--muted)",
                    fontSize: 12,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
                {PRODUCT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(p.name, c.id)}
                    title={c.id}
                    aria-label={c.id}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      background: c.bg,
                      border: colors[p.name] === c.id ? `2px solid ${c.text}` : `1px solid ${c.border}`,
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={styles.saveBtn}
        style={{ background: "var(--surface)", color: "var(--ink)", border: "1px solid var(--paper-line)" }}
      >
        🎨 상품 색상 설정 열기{setCount > 0 ? ` (${setCount}개 지정됨)` : ""}
      </button>

      {open ? (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface)",
              color: "var(--ink)",
              borderRadius: 14,
              width: "100%",
              maxWidth: 560,
              maxHeight: "82vh",
              display: "flex",
              flexDirection: "column",
              border: "1px solid var(--paper-line)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "13px 16px",
                borderBottom: "1px solid var(--paper-line)",
              }}
            >
              <b>상품 색상</b>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  border: "1px solid var(--paper-line)",
                  background: "var(--paper)",
                  color: "var(--muted)",
                  borderRadius: 8,
                  padding: "4px 10px",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                닫기
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "14px 16px", flex: 1 }}>
              <p className={styles.sub} style={{ marginTop: 0 }}>
                상품마다 <b>배경색</b>을 넣어 구분해요. 색 안 정한 상품은 기본색 그대로예요(선택사항).
              </p>
              {productRows}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderTop: "1px solid var(--paper-line)",
              }}
            >
              <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
                {saving ? "저장 중…" : "저장"}
              </button>
              {msg ? (
                <span className={msg.kind === "ok" ? styles.ok : styles.err} style={{ margin: 0 }}>
                  {msg.text}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
