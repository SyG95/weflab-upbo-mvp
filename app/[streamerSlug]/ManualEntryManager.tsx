"use client";

// 수동기록 관리 화면. 위플랩에 안 잡히는 룰렛 결과를 스트리머가 직접 넣는 "입력/보관 창구".
// 저장 실체는 upbo_entries(source_key manual:...) 라서, 배송·양도교환·팬화면은 자동수집분과 동등하게 다룬다.
// 여기서는 추가 / 목록 / 개수 수정 / 삭제(수동분만)만 한다.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import { normalizeAccountId, type UpboEntry } from "../../lib/api";

type ItemChoice = {
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  catalogGroupIndex?: number;
  rouletteId?: string;
  rouletteLabel?: string;
};

// "직접 입력"(룰렛확률표에 없는 상품) 선택지 sentinel — 교환 모달(ItemEventManager)과 동일 패턴.
const CUSTOM_ITEM = "__custom__";

export default function ManualEntryManager({
  slug,
  entries,
  catalogItems,
  catalogVersion,
}: {
  slug: string;
  entries: UpboEntry[];
  catalogItems: ItemChoice[];
  catalogVersion: number | null;
}) {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [idOpen, setIdOpen] = useState(false);
  const [pick, setPick] = useState(""); // choiceKey 또는 CUSTOM_ITEM
  // 직접 입력(룰렛확률표에 없는 상품): 이름 필수, 확률은 선택(없으면 0 — 정가·교환 직접입력과 동일 취급).
  const [customName, setCustomName] = useState("");
  const [customProb, setCustomProb] = useState("");
  const [count, setCount] = useState(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const idRef = useRef<HTMLInputElement>(null);

  // 시청자 계정 자동완성 후보(정가만 있는 계정 제외).
  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.sourceKey?.startsWith("fixed:")) continue;
      const id = normalizeAccountId(e.fanId);
      if (!id) continue;
      const nick = e.fanNickname?.trim() ?? "";
      const cur = map.get(id);
      if (cur === undefined) map.set(id, nick);
      else if (!cur && nick) map.set(id, nick);
    }
    return [...map.entries()]
      .map(([id, nickname]) => ({ id, nickname }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [entries]);

  const idSuggestions = useMemo(() => {
    const q = normalizeAccountId(ownerId).toLowerCase();
    const list = q
      ? accountOptions.filter(
          (a) => a.id.toLowerCase().startsWith(q) || a.nickname.toLowerCase().startsWith(q),
        )
      : accountOptions;
    return list.slice(0, 50);
  }, [accountOptions, ownerId]);

  // 상품 선택지(룰렛확률표, 사용 on + 업보 기준 이하) — 룰렛별 optgroup.
  const choiceKey = (c: ItemChoice) => `${c.rouletteId ?? ""}@@${c.itemName}@@${c.probability}`;
  const catalogSorted = useMemo(
    () =>
      [...catalogItems].sort(
        (a, b) => b.probability - a.probability || a.itemName.localeCompare(b.itemName),
      ),
    [catalogItems],
  );
  const rouletteGroups = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, { label: string; items: ItemChoice[] }>();
    for (const c of catalogSorted) {
      const rid = c.rouletteId ?? "";
      let g = byId.get(rid);
      if (!g) {
        g = { label: c.rouletteLabel ? `룰렛 ${c.rouletteLabel}` : "룰렛", items: [] };
        byId.set(rid, g);
        order.push(rid);
      }
      g.items.push(c);
    }
    return order.map((rid) => ({ rid, ...byId.get(rid)! }));
  }, [catalogSorted]);
  const showGroups = rouletteGroups.length > 1;
  const picked = catalogItems.find((c) => choiceKey(c) === pick) ?? null;

  // 수동기록 목록(최근순).
  const manualEntries = useMemo(
    () =>
      entries
        .filter((e) => e.sourceKey?.startsWith("manual:"))
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    [entries],
  );

  async function addEntry() {
    const id = ownerId.trim();
    if (!id) {
      setMsg({ type: "err", text: "계정ID를 적어 주세요." });
      return;
    }
    // 직접 입력은 룰렛표와 무관한 상품 — 룰렛 연결(catalog) 없이 저장. DB는 상품명만 있으면 성립.
    let itemPayload: {
      itemName: string;
      probability: number;
      amountRangeLabel: string;
      catalogGroupIndex: number | null;
      catalogVersion: number | null;
    };
    if (pick === CUSTOM_ITEM) {
      const name = customName.trim();
      if (!name) {
        setMsg({ type: "err", text: "상품 이름을 적어 주세요." });
        return;
      }
      const p = customProb.trim();
      if (p !== "" && !Number.isFinite(Number(p))) {
        setMsg({ type: "err", text: "확률은 숫자로 적어 주세요. (예: 5)" });
        return;
      }
      itemPayload = {
        itemName: name,
        probability: p === "" ? 0 : Number(p),
        amountRangeLabel: "",
        catalogGroupIndex: null,
        catalogVersion: null,
      };
    } else if (picked) {
      itemPayload = {
        itemName: picked.itemName,
        probability: picked.probability,
        amountRangeLabel: picked.amountRangeLabel ?? "",
        catalogGroupIndex: picked.catalogGroupIndex ?? null,
        catalogVersion,
      };
    } else {
      setMsg({ type: "err", text: "상품을 골라 주세요." });
      return;
    }
    const known = accountOptions.find((a) => a.id === normalizeAccountId(id))?.nickname ?? "";
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fanId: id,
          fanNickname: ownerName.trim() || known,
          ...itemPayload,
          count,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || String(res.status));
      setMsg({ type: "ok", text: "수동기록을 추가했어요." });
      setOwnerId("");
      setOwnerName("");
      setPick("");
      setCustomName("");
      setCustomProb("");
      setCount(1);
      router.refresh();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "추가에 실패했어요." });
    } finally {
      setSaving(false);
    }
  }

  async function changeCount(id: string, next: number) {
    if (next < 1) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/manual-entries`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, count: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "개수 수정에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  async function removeEntry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/s/${encodeURIComponent(slug)}/manual-entries?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setMsg({ type: "ok", text: "수동기록을 삭제했어요." });
      router.refresh();
    } catch {
      setMsg({ type: "err", text: "삭제에 실패했어요." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.ieWrap}>
      {msg ? (
        <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p>
      ) : null}

      {/* 추가 폼 */}
      <div className={styles.ieForm}>
        <div className={styles.ieField}>
          <span className={styles.ieLabel}>
            시청자 계정ID <span className={styles.ieReq}>*</span>
          </span>
          <div className={styles.ieCombo}>
            <div className={styles.ieComboInputRow}>
              <input
                ref={idRef}
                className={styles.ieInput}
                value={ownerId}
                onChange={(e) => {
                  setOwnerId(e.target.value);
                  setIdOpen(e.target.value.trim().length > 0);
                }}
                onFocus={() => setIdOpen(ownerId.trim().length > 0)}
                onBlur={() => window.setTimeout(() => setIdOpen(false), 150)}
                placeholder={accountOptions[0] ? `예: ${accountOptions[0].id}` : "계정ID 입력"}
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.ieComboBtn}
                tabIndex={-1}
                aria-label="계정 목록 열기"
                onClick={() => {
                  const n = !idOpen;
                  idRef.current?.focus();
                  setIdOpen(n);
                }}
              >
                ▾
              </button>
            </div>
            {idOpen ? (
              <div className={styles.ieComboList} role="listbox">
                {idSuggestions.length === 0 ? (
                  <p className={styles.ieComboEmpty}>
                    일치하는 계정이 없어요. 그대로 넣으면 새 계정으로 처리돼요.
                  </p>
                ) : (
                  idSuggestions.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      className={styles.ieComboItem}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setOwnerId(a.id);
                        if (!ownerName.trim() && a.nickname) setOwnerName(a.nickname);
                        setIdOpen(false);
                      }}
                    >
                      <span className={styles.ieComboItemId}>{a.id}</span>
                      {a.nickname ? <span className={styles.ieComboItemNick}>{a.nickname}</span> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        <label className={styles.ieField}>
          <span className={styles.ieLabel}>
            닉네임 <span className={styles.ieOptional}>(선택 — 비우면 기존 기록에서 자동)</span>
          </span>
          <input
            className={styles.ieInput}
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="예: 달빛여우"
          />
        </label>

        <label className={styles.ieField}>
          <span className={styles.ieLabel}>
            상품 <span className={styles.ieReq}>*</span>
          </span>
          <select className={styles.ieSelect} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">상품을 고르세요…</option>
            {showGroups
              ? rouletteGroups.map((g) => (
                  <optgroup key={g.rid} label={g.label}>
                    {g.items.map((c) => (
                      <option key={choiceKey(c)} value={choiceKey(c)}>
                        {c.itemName} · {c.probability}%
                      </option>
                    ))}
                  </optgroup>
                ))
              : catalogSorted.map((c) => (
                  <option key={choiceKey(c)} value={choiceKey(c)}>
                    {c.itemName} · {c.probability}%
                  </option>
                ))}
            <option value={CUSTOM_ITEM}>직접 입력… (룰렛확률표에 없는 상품)</option>
          </select>
          {catalogItems.length === 0 ? (
            <span className={styles.ieFormHint}>
              룰렛확률표에 사용(on)으로 켜진 업보 대상 상품이 없어요. «설정 → 룰렛 상품 사용 설정»을
              먼저 켜거나, «직접 입력…»으로 넣을 수 있어요.
            </span>
          ) : null}
        </label>

        {pick === CUSTOM_ITEM ? (
          <>
            <label className={styles.ieField}>
              <span className={styles.ieLabel}>
                상품 이름 <span className={styles.ieReq}>*</span>
              </span>
              <input
                className={styles.ieInput}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="예: 팬미팅 초대권"
              />
            </label>
            <label className={styles.ieField}>
              <span className={styles.ieLabel}>
                확률(%) <span className={styles.ieOptional}>(선택 — 몰라도 됨)</span>
              </span>
              <input
                className={styles.ieInput}
                value={customProb}
                onChange={(e) => setCustomProb(e.target.value)}
                inputMode="decimal"
                placeholder="예: 5"
              />
            </label>
          </>
        ) : null}

        <div className={styles.ieField}>
          <span className={styles.ieLabel}>개수</span>
          <div className={styles.dmStepper}>
            <button
              type="button"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              disabled={count <= 1}
              aria-label="개수 감소"
            >
              −
            </button>
            <span className={styles.dmCountDone}>{count}</span>
            <button
              type="button"
              onClick={() => setCount((c) => Math.min(9999, c + 1))}
              aria-label="개수 증가"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <button
            type="button"
            className={styles.modalConfirm}
            onClick={addEntry}
            disabled={
              saving || !ownerId.trim() || (pick === CUSTOM_ITEM ? !customName.trim() : !picked)
            }
          >
            {saving ? "추가 중…" : "수동기록 추가"}
          </button>
        </div>
      </div>

      {/* 목록 */}
      <div className={styles.ieSummary}>
        <span className={styles.tag}>수동기록 {manualEntries.length}건</span>
      </div>
      {manualEntries.length === 0 ? (
        <p className={styles.fieldHint}>아직 수동기록이 없어요.</p>
      ) : (
        <ul className={styles.ieList}>
          {manualEntries.map((e) => {
            const cnt = Math.max(1, Number(e.effectiveCount ?? 1));
            const busy = busyId === e.id;
            return (
              <li key={e.id} className={styles.ieCard}>
                <div className={styles.ieCardHead}>
                  <div className={styles.ieIdentity}>
                    <span className={styles.ieName}>{e.fanNickname || "(이름 없음)"}</span>
                    {e.fanId ? <span className={styles.ieId}>{e.fanId}</span> : null}
                    <span className={styles.dmItemName}>
                      {e.itemName}
                      <span className={styles.dmItemProb}>{e.probability}%</span>
                      {e.amountRangeLabel ? <span className={styles.upboSet}>{e.amountRangeLabel}</span> : null}
                    </span>
                  </div>
                  <div className={styles.ieActions}>
                    <div className={styles.dmStepper}>
                      <button
                        type="button"
                        onClick={() => changeCount(e.id, cnt - 1)}
                        disabled={busy || cnt <= 1}
                        aria-label="개수 감소"
                      >
                        −
                      </button>
                      <span className={styles.dmCountDone}>{cnt}개</span>
                      <button
                        type="button"
                        onClick={() => changeCount(e.id, cnt + 1)}
                        disabled={busy}
                        aria-label="개수 증가"
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className={styles.ieChipBtnDanger}
                      onClick={() => removeEntry(e.id)}
                      disabled={busy}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
