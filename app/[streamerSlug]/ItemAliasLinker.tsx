"use client";

// 이름 연결 화면.
// 룰렛표에서 상품 이름이 바뀌면(💙얼낙즉방 → 💜얼낙즉방) 판정이 예전 당첨을 못 찾는다.
// 스트리머가 "이거랑 이거는 같은 거예요"만 눌러주면 재판정이 알아서 찾아간다.
//
// 직관성을 위해 지킨 것:
//  - 추천이 있는 것만 먼저 보여준다(대부분 이게 진짜 고쳐야 할 것).
//  - 몇 건이 걸려 있는지 항상 같이 보여준다(고칠 가치가 있는지 바로 판단되게).
//  - 추천을 미리 골라 두되, 저장 전까지는 아무것도 바뀌지 않는다.

import { useMemo, useState } from "react";
import styles from "./page.module.css";

export type AliasOption = { itemName: string; probability: number; recommended: boolean; reason?: string };
export type AliasCandidate = {
  key: string;
  amountLabel: string;
  itemName: string;
  probability: number | null;
  count: number;
  firstAt: string;
  lastAt: string;
  options: AliasOption[];
  linked?: { itemName: string; probability: number; ignored?: boolean };
  wouldRecord?: boolean;
};
type CatalogGroupLike = {
  amountRangeLabel?: string;
  amountMin?: number | null;
  amountMax?: number | null;
  items?: Array<{ itemName: string; probability: number; enabled?: boolean }>;
};

// 선택값 인코딩: "상품명||확률" (같은 이름 다른 확률을 구분해야 해서 확률까지 담는다)
function encode(itemName: string, probability: number) {
  return `${itemName}||${probability}`;
}
function decode(value: string): { itemName: string; probability: number } | null {
  const i = value.lastIndexOf("||");
  if (i < 0) return null;
  const probability = Number(value.slice(i + 2));
  if (!Number.isFinite(probability)) return null;
  return { itemName: value.slice(0, i), probability };
}

export default function ItemAliasLinker({
  slug,
  candidates,
  groups,
  onSaved,
}: {
  slug: string;
  candidates: AliasCandidate[];
  groups: CatalogGroupLike[];
  onSaved: (message: string) => void;
}) {
  // 화면에서 고른 값(저장 전). key → "상품명||확률" 또는 "__ignore__"
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of candidates) {
      if (c.linked?.ignored) {
        init[c.key] = "__ignore__";
        continue;
      }
      if (c.linked) {
        init[c.key] = encode(c.linked.itemName, c.linked.probability);
        continue;
      }
      // 추천을 미리 골라 둔다 — 스트리머는 맞는지만 보고 저장하면 된다.
      // 저장을 누르기 전까지는 아무것도 바뀌지 않으므로 안전하다.
      // 단 "이어도 업보가 되지 않는 것"(고확률 리액션)은 자동으로 고르지 않는다.
      if (!c.wouldRecord) continue;
      const rec = c.options.find((o) => o.recommended);
      if (rec) init[c.key] = encode(rec.itemName, rec.probability);
    }
    return init;
  });
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 기본 화면에는 "연결하면 실제로 업보가 되는 것"만 올린다.
  // 뽀뽀·사랑해처럼 확률이 높아 어차피 기록되지 않는 것은 접어 둔다(양이 훨씬 많다).
  const worth = useMemo(() => candidates.filter((c) => c.wouldRecord), [candidates]);
  const rest = useMemo(() => candidates.filter((c) => !c.wouldRecord), [candidates]);
  const shown = showAll ? [...worth, ...rest] : worth;

  // 그 금액대에서 고를 수 있는 상품 전부(추천에 없는 것도 직접 고를 수 있게)
  function optionsFor(c: AliasCandidate): AliasOption[] {
    const group = groups.find((g) => (g.amountRangeLabel || "") === c.amountLabel);
    const all = (group?.items ?? [])
      .filter((it) => it.enabled !== false)
      .map((it) => ({ itemName: it.itemName, probability: it.probability, recommended: false }));
    const merged = [...c.options];
    for (const opt of all) {
      if (!merged.some((m) => m.itemName === opt.itemName && m.probability === opt.probability)) merged.push(opt);
    }
    return merged;
  }

  const pickedCount = Object.values(picks).filter(Boolean).length;
  const linkedCount = Object.entries(picks).filter(([, v]) => v && v !== "__ignore__").length;
  const willRecover = candidates
    .filter((c) => picks[c.key] && picks[c.key] !== "__ignore__")
    .reduce((sum, c) => sum + c.count, 0);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const aliases: Record<string, { itemName: string; probability: number; ignored?: boolean }> = {};
      for (const [key, value] of Object.entries(picks)) {
        if (!value) continue;
        if (value === "__ignore__") {
          aliases[key] = { itemName: "", probability: 0, ignored: true };
          continue;
        }
        const decoded = decode(value);
        if (decoded) aliases[key] = decoded;
      }
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/item-aliases`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aliases }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({
          type: "err",
          text:
            res.status === 401
              ? "로그인이 풀렸어요. 관리자 비밀번호를 다시 입력해 주세요."
              : `저장 실패: ${data?.error ?? res.status}`,
        });
        return;
      }
      // 저장하면 이어진 것은 목록에서 사라진다(이제 찾아지니까).
      // 그래서 결과 문구는 이 화면이 아니라 위쪽 요약 자리에 띄운다.
      onSaved(`이름 연결 ${linkedCount}개를 저장했어요. 아래 건수에 바로 반영했습니다.`);
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
    } finally {
      setSaving(false);
    }
  }

  if (candidates.length === 0) {
    return <p className={styles.fieldHint}>이름을 연결할 게 없어요. 지금 표로 전부 찾아지고 있습니다.</p>;
  }

  return (
    <div>
      <p className={styles.fieldHint} style={{ marginTop: 0 }}>
        룰렛표에서 <b>상품 이름이 바뀌면</b> 예전 당첨을 못 찾아요. 그림문자 하나만 달라져도 그렇습니다
        (예: <code>💙얼낙즉방</code> → <code>💜얼낙즉방</code>). 같은 상품이면 아래에서 이어 주세요.
      </p>

      {worth.length > 0 ? (
        <p className={styles.fieldOk}>
          이어 주면 <b>업보로 들어갈 상품 {worth.length}개</b>를 찾았어요. 맞는지만 확인하고 저장하세요.
        </p>
      ) : (
        <p className={styles.fieldHint}>
          지금 이어 줄 만한 게 없어요. 나머지는 대부분 확률이 높은 리액션(뽀뽀·사랑해 등)이라 이어도 업보로
          기록되지 않습니다.
        </p>
      )}

      <div className={styles.dmList} style={{ marginTop: 10 }}>
        {shown.map((c) => {
          const picked = picks[c.key] ?? "";
          const rec = c.options.find((o) => o.recommended);
          return (
            <div key={c.key} className={styles.dmItem}>
              <div className={styles.dmRow}>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.dmName}>
                    <b>{c.itemName}</b>{" "}
                    <span className={styles.tagMuted}>
                      {c.amountLabel}원 · {c.probability ?? "?"}%
                    </span>{" "}
                    <span className={styles.tagWarn}>{c.count}건</span>
                  </div>
                  <div className={styles.fieldHint} style={{ margin: "2px 0 0" }}>
                    {c.firstAt ? `${c.firstAt.slice(0, 10)} ~ ${c.lastAt.slice(0, 10)}` : "시간 정보 없음"}
                  </div>
                </div>
              </div>
              <div className={styles.thresholdRow} style={{ marginTop: 6, flexWrap: "wrap" }}>
                <span className={styles.fieldHint} style={{ margin: 0 }}>
                  지금 표의
                </span>
                <select
                  value={picked}
                  onChange={(e) => setPicks((p) => ({ ...p, [c.key]: e.target.value }))}
                  disabled={saving}
                  style={{ maxWidth: 320 }}
                >
                  <option value="">— 고르지 않음 —</option>
                  {optionsFor(c).map((o, i) => (
                    <option key={`${o.itemName}-${o.probability}-${i}`} value={encode(o.itemName, o.probability)}>
                      {o.recommended ? "✓ " : ""}
                      {o.itemName} ({o.probability}%)
                    </option>
                  ))}
                  <option value="__ignore__">✕ 업보 아님 (목록에서 치우기)</option>
                </select>
                <span className={styles.fieldHint} style={{ margin: 0 }}>
                  (와) 같은 상품이에요
                </span>
                {rec && picked === encode(rec.itemName, rec.probability) ? (
                  <span className={styles.tagMuted}>{rec.reason}</span>
                ) : null}
              </div>
              {picked && picked !== "__ignore__" ? (
                c.wouldRecord ? (
                  <p className={styles.fieldOk} style={{ margin: "4px 0 0" }}>
                    이어 주면 이 {c.count}건이 업보 시트에 들어가요.
                  </p>
                ) : (
                  <p className={styles.fieldHint} style={{ margin: "4px 0 0" }}>
                    이어도 확률이 기준보다 높아서 업보로는 기록되지 않아요(표시만 정리됩니다).
                  </p>
                )
              ) : null}
            </div>
          );
        })}
      </div>

      {rest.length > 0 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} disabled={saving} style={{ marginTop: 8 }}>
          {showAll
            ? "업보가 될 것만 보기"
            : `나머지 ${rest.length}개도 보기 (확률이 높아 업보로는 안 들어가는 것들)`}
        </button>
      ) : null}

      <div className={styles.thresholdRow} style={{ marginTop: 12 }}>
        <button type="button" onClick={() => void save()} disabled={saving || pickedCount === 0}>
          {saving ? "저장 중…" : `연결 ${linkedCount}개 저장하기`}
        </button>
        {willRecover > 0 ? (
          <span className={styles.fieldHint} style={{ margin: 0 }}>
            저장하면 최대 <b>{willRecover}건</b>이 다시 판정 대상이 됩니다.
          </span>
        ) : null}
      </div>
      {msg ? <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p> : null}
      <p className={styles.fieldHint}>
        연결해도 원본 기록과 룰렛표는 그대로예요. 저장한 뒤 아래 <b>다시 판정해보기</b>를 누르면 실제로
        들어갈 건수가 보입니다.
      </p>
    </div>
  );
}
