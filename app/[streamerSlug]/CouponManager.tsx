"use client";

// 쿠폰 장부(1단계 수동 MVP) — 업보(배송 대상)와 별개로 시청자별로 쌓이는 지불 수단.
// 스트리머가 쿠폰 "종류"를 직접 정의하고(커스텀), 지급/사용/값설정을 수동 기입한다.
// 모든 변화는 이력으로 남고 잔액은 0 밑으로 내려가지 않는다(서버에서 강제).
// 인증은 관리자 로그인 세션(쿠키) — SignatureCountsManager와 동일 패턴.

import { useMemo, useState } from "react";
import styles from "./coupon.module.css";
import type {
  CouponBackfillPreview,
  CouponBalance,
  CouponEvent,
  CouponItemDef,
  CouponSourceMap,
} from "../../lib/upboSupabase";
import { aggregateCouponEventsBySource } from "../../lib/couponAggregate";

type ViewerSuggestion = { fanId: string; fanNickname: string };

type Props = {
  slug: string;
  initialItems: CouponItemDef[];
  initialBalances: CouponBalance[];
  initialEvents: CouponEvent[];
  initialSourceMap: CouponSourceMap[];
  // 자동 적립 연결 후보 상품명(현재 룰렛표에서 on·기준 이하, 중복 제거) — 서버(page)에서 계산해 내려준다.
  couponSources: string[];
  viewerSuggestions: ViewerSuggestion[];
  // 마지막 수집 반영 시각(ISO). "지난 당첨 가져오기"가 어디까지의 기록을 보는지 알려주는 용도.
  lastAppliedAt?: string;
};

const ACTION_LABEL: Record<CouponEvent["actionType"], string> = {
  grant: "지급",
  use: "사용",
  adjust: "조정",
  set: "값 설정",
};

function fmtKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CouponManager({
  slug,
  initialItems,
  initialBalances,
  initialEvents,
  initialSourceMap,
  couponSources,
  viewerSuggestions,
  lastAppliedAt,
}: Props) {
  const [items, setItems] = useState<CouponItemDef[]>(initialItems);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [balances, setBalances] = useState<CouponBalance[]>(initialBalances);
  const [events, setEvents] = useState<CouponEvent[]>(initialEvents);

  // 자동 적립 연결(2단계 조각 1: 매핑 설정만).
  const [sourceMap, setSourceMap] = useState<CouponSourceMap[]>(initialSourceMap);
  const [sourceDraft, setSourceDraft] = useState<Record<string, string>>({});
  const [savingSources, setSavingSources] = useState(false);
  // 화면에서 연결을 바꿨는데 아직 저장 안 한 상태 — 이걸 모르고 미리보기하면 "0건" 함정에 빠진다.
  const [sourcesDirty, setSourcesDirty] = useState(false);

  // 지난 기록 소급(2단계 조각 3). 기간은 datetime-local(KST 로 해석), 비우면 전체.
  const [bfFrom, setBfFrom] = useState("");
  const [bfTo, setBfTo] = useState("");
  const [bfPreview, setBfPreview] = useState<CouponBackfillPreview | null>(null);
  const [bfLoading, setBfLoading] = useState(false);
  const [bfApplying, setBfApplying] = useState(false);
  const [bfMsg, setBfMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 기록 폼
  const [nickname, setNickname] = useState("");
  const [accountId, setAccountId] = useState("");
  const [itemKey, setItemKey] = useState(initialItems[0]?.key ?? "");
  const [action, setAction] = useState<"grant" | "use" | "set">("grant");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");

  const [savingItems, setSavingItems] = useState(false);
  const [savingChange, setSavingChange] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ── 쿠폰 종류 정의 ────────────────────────────────────────────────────
  function onAddItem() {
    // 키는 내부 식별자(이름을 바꿔도 잔액이 따라오게 고정) — 핸들러에서만 생성.
    const key = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    setItems((prev) => (prev.length >= 30 ? prev : [...prev, { key, name: "" }]));
    setItemsDirty(true);
  }

  function onRenameItem(key: string, name: string) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, name } : it)));
    setItemsDirty(true);
  }

  function onRemoveItem(key: string) {
    const hasBalance = balances.some((b) => b.itemKey === key && b.balance > 0);
    if (hasBalance && !window.confirm("이 쿠폰을 가진 시청자가 있어요. 목록에서 빼도 잔액과 이력은 남습니다. 계속할까요?")) {
      return;
    }
    setItems((prev) => prev.filter((it) => it.key !== key));
    setItemsDirty(true);
  }

  async function saveItems() {
    const cleaned = items
      .map((it) => ({ key: it.key, name: it.name.trim() }))
      .filter((it) => it.name !== "");
    setSavingItems(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/coupon-items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "쿠폰 종류 저장 실패 — 다시 시도해 주세요." });
      } else {
        const saved: CouponItemDef[] = Array.isArray(data?.items) ? data.items : [];
        setItems(saved);
        setItemsDirty(false);
        if (!saved.some((it) => it.key === itemKey)) setItemKey(saved[0]?.key ?? "");
        setMsg({ kind: "ok", text: "쿠폰 종류를 저장했어요." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSavingItems(false);
    }
  }

  // ── 자동 적립 연결(매핑) ──────────────────────────────────────────────
  function sourcesFor(key: string): CouponSourceMap["sources"] {
    return sourceMap.find((m) => m.itemKey === key)?.sources ?? [];
  }

  function updateSources(
    key: string,
    updater: (cur: CouponSourceMap["sources"]) => CouponSourceMap["sources"],
  ) {
    setSourceMap((prev) => {
      const idx = prev.findIndex((m) => m.itemKey === key);
      const next = updater(idx >= 0 ? prev[idx].sources : []);
      if (idx >= 0) {
        const copy = [...prev];
        if (next.length === 0) copy.splice(idx, 1);
        else copy[idx] = { itemKey: key, sources: next };
        return copy;
      }
      return next.length === 0 ? prev : [...prev, { itemKey: key, sources: next }];
    });
    // 연결이 바뀌면 "저장 전" 표시를 켜고, 이전 미리보기 결과는 낡은 값이라 지운다.
    setSourcesDirty(true);
    setBfPreview(null);
  }

  function addSource(key: string) {
    const name = (sourceDraft[key] ?? "").trim();
    if (!name) return;
    updateSources(key, (cur) =>
      cur.some((s) => s.itemName === name) ? cur : [...cur, { itemName: name, per: 1 }],
    );
    setSourceDraft((prev) => ({ ...prev, [key]: "" }));
  }

  function removeSource(key: string, itemName: string) {
    updateSources(key, (cur) => cur.filter((s) => s.itemName !== itemName));
  }

  function changePer(key: string, itemName: string, per: number) {
    const clamped = Math.max(1, Math.min(999, Math.round(per)));
    updateSources(key, (cur) =>
      cur.map((s) => (s.itemName === itemName ? { ...s, per: clamped } : s)),
    );
  }

  async function saveSources() {
    setSavingSources(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/coupon-source-map`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ map: sourceMap }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "적립 연결 저장 실패 — 다시 시도해 주세요." });
      } else {
        const saved: CouponSourceMap[] = Array.isArray(data?.map) ? data.map : [];
        setSourceMap(saved);
        setSourcesDirty(false);
        setMsg({
          kind: "ok",
          text: "적립 연결을 저장했어요. 이제부터 이 상품 당첨은 배송 대신 쿠폰으로 쌓여요. 연결하기 전에 이미 나온 당첨은 아래 '지난 당첨 가져오기'를 한 번 돌려서 옮겨 주세요.",
        });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSavingSources(false);
    }
  }

  // ── 지난 기록 소급(과거 당첨 → 쿠폰) ──────────────────────────────────
  // "이번 달" 프리셋은 현재 날짜에서 파생(하드코딩 금지). KST 기준 이달 1일 00:00 ~ 지금.
  function kstLocalValue(d: Date): string {
    // 'sv-SE' 로케일 → "YYYY-MM-DD HH:MM:SS"(24h). datetime-local 형식으로 자른다.
    return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T").slice(0, 16);
  }

  function presetThisMonth() {
    const now = kstLocalValue(new Date());
    setBfFrom(`${now.slice(0, 7)}-01T00:00`);
    setBfTo(now);
    setBfPreview(null);
    setBfMsg(null);
  }

  function presetAllTime() {
    setBfFrom("");
    setBfTo("");
    setBfPreview(null);
    setBfMsg(null);
  }

  async function loadBackfillPreview() {
    // 함정 방지: 화면에서 바꾼 연결이 저장 전이면 서버는 옛날 연결로 계산해서 "0건"이 나온다.
    if (sourcesDirty) {
      setBfMsg({
        kind: "err",
        text: "위에서 바꾼 연결이 아직 저장 전이에요. '적립 연결 저장'을 먼저 누른 다음 미리보기해 주세요 — 저장 전 연결은 계산에 안 들어가요.",
      });
      return;
    }
    setBfLoading(true);
    setBfMsg(null);
    try {
      const qs = new URLSearchParams();
      if (bfFrom) qs.set("from", bfFrom);
      if (bfTo) qs.set("to", bfTo);
      const res = await fetch(
        `/api/s/${encodeURIComponent(slug)}/coupon-backfill?${qs.toString()}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setBfPreview(null);
        setBfMsg({ kind: "err", text: data?.error || "미리보기 실패 — 다시 시도해 주세요." });
      } else {
        setBfPreview((data?.preview as CouponBackfillPreview) ?? null);
      }
    } catch {
      setBfMsg({ kind: "err", text: "네트워크 오류로 미리보기하지 못했어요." });
    } finally {
      setBfLoading(false);
    }
  }

  async function applyBackfill() {
    if (!bfPreview || bfPreview.totalDelta <= 0) {
      setBfMsg({ kind: "err", text: "가져올 쿠폰이 없어요. 먼저 미리보기로 확인해 주세요." });
      return;
    }
    const ok = window.confirm(
      `시청자 ${bfPreview.rows.length}명에게 쿠폰 ${bfPreview.totalDelta}개를 지금 쌓을까요?\n반영하면 잔액에 바로 들어가요. 잘못 넣었다면 아래 잔액 현황에서 직접 고칠 수 있어요.`,
    );
    if (!ok) return;
    setBfApplying(true);
    setBfMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/coupon-backfill`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: bfFrom || undefined, to: bfTo || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setBfMsg({ kind: "err", text: data?.error || "반영 실패 — 다시 시도해 주세요." });
      } else {
        if (Array.isArray(data?.balances)) setBalances(data.balances);
        if (Array.isArray(data?.events)) setEvents(data.events);
        setBfPreview(null);
        setBfMsg({
          kind: "ok",
          text: `가져오기 완료 — 당첨 ${data?.accrued ?? 0}건에서 쿠폰 ${data?.totalDelta ?? 0}개가 쌓였어요. 아래 잔액 현황과 팬 화면 쿠폰 탭에서 바로 확인할 수 있어요.`,
        });
      }
    } catch {
      setBfMsg({ kind: "err", text: "네트워크 오류로 반영하지 못했어요." });
    } finally {
      setBfApplying(false);
    }
  }

  // ── 지급/사용/값설정 기록 ─────────────────────────────────────────────
  async function submitChange() {
    const nick = nickname.trim();
    let id = accountId.trim();
    // ID를 비우면 아는 시청자 목록에서 닉네임으로 찾아 채운다(ID 우선 규약 — 중복 줄 방지).
    if (!id && nick) {
      const found =
        viewerSuggestions.find((v) => v.fanNickname === nick)?.fanId ||
        balances.find((b) => b.nickname === nick)?.accountId ||
        "";
      id = found;
    }
    if (!nick && !id) {
      setMsg({ kind: "err", text: "시청자 닉네임 또는 ID를 입력해 주세요." });
      return;
    }
    if (!itemKey) {
      setMsg({ kind: "err", text: "쿠폰 종류를 먼저 만들어 주세요." });
      return;
    }
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0 || (action !== "set" && n === 0)) {
      setMsg({ kind: "err", text: "수량은 0 이상의 정수로 입력해 주세요." });
      return;
    }

    const itemName = items.find((it) => it.key === itemKey)?.name || itemKey;
    const change =
      action === "set"
        ? { nickname: nick, accountId: id, itemKey, itemName, mode: "set", value: n, actionType: "set", note }
        : {
            nickname: nick,
            accountId: id,
            itemKey,
            itemName,
            mode: "delta",
            value: action === "grant" ? n : -n,
            actionType: action,
            note,
          };

    setSavingChange(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/coupons`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes: [change] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "기록 실패 — 다시 시도해 주세요." });
      } else {
        if (Array.isArray(data?.balances)) setBalances(data.balances);
        if (Array.isArray(data?.events)) setEvents(data.events);
        if (Array.isArray(data?.items) && data.items.length > 0) setItems(data.items);
        setQty("");
        setNote("");
        setMsg(
          data?.appliedCount === 0
            ? { kind: "ok", text: "잔액에 변화가 없어 기록하지 않았어요(이미 같은 값)." }
            : { kind: "ok", text: "장부에 기록했어요." },
        );
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 기록하지 못했어요." });
    } finally {
      setSavingChange(false);
    }
  }

  function pickRow(b: CouponBalance) {
    setNickname(b.nickname);
    setAccountId(b.accountId);
    setItemKey(b.itemKey);
  }

  const sortedBalances = [...balances].sort(
    (a, b) => a.nickname.localeCompare(b.nickname, "ko") || a.itemName.localeCompare(b.itemName, "ko"),
  );
  const datalistId = `coupon-viewers-${slug}`;
  // "지난 당첨 가져오기"가 어디까지의 기록을 보는지 알려줄 때 쓴다(없으면 표시 생략).
  const lastAppliedText = lastAppliedAt ? fmtKst(lastAppliedAt) : "";

  // 수동/자동 분리(참고값). events(최근분) delta 합이라 0 클램프가 반영 안 돼 잔액과 다를 수 있다
  // → 화면에선 잔액(balance)을 합계로 우선 표기하고, 수동·자동은 참고값으로만 보여준다.
  const eventAggregate = useMemo(() => {
    const list = aggregateCouponEventsBySource(
      events.map((e) => ({ viewerKey: e.viewerKey, itemKey: e.itemKey, delta: e.delta, createdBy: e.createdBy })),
    );
    const map = new Map<string, { manual: number; auto: number }>();
    for (const a of list) map.set(`${a.viewerKey}@@${a.itemKey}`, { manual: a.manual, auto: a.auto });
    return map;
  }, [events]);

  return (
    <div>
      {/* 1. 쿠폰 종류 */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>쿠폰 종류</h3>
        <p className={styles.blockSub}>
          이 스트리머가 쓰는 쿠폰 이름을 정해요(예: 치킨쿠폰, 이로치티켓). 이름은 나중에 바꿔도
          잔액이 그대로 따라와요.
        </p>
        <div className={styles.itemRows}>
          {items.map((it) => (
            <div key={it.key} className={styles.itemRow}>
              <input
                className={styles.itemNameInput}
                type="text"
                value={it.name}
                placeholder="쿠폰 이름 (예: 치킨쿠폰)"
                maxLength={40}
                onChange={(e) => onRenameItem(it.key, e.target.value)}
              />
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemoveItem(it.key)}
                aria-label="이 쿠폰 종류 삭제"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className={styles.addBtn} onClick={onAddItem} disabled={items.length >= 30}>
          + 쿠폰 종류 추가
        </button>
        {itemsDirty ? (
          <div>
            <button type="button" className={styles.saveBtn} onClick={saveItems} disabled={savingItems} style={{ marginTop: 10 }}>
              {savingItems ? "저장 중…" : "쿠폰 종류 저장"}
            </button>
          </div>
        ) : null}
      </div>

      {/* 1.5 자동 적립 연결 (2단계 조각 1 — 매핑 설정만) */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>룰렛 당첨 → 쿠폰 자동 적립 연결</h3>
        <p className={styles.blockSub}>
          어떤 룰렛 상품에 당첨되면 어떤 쿠폰을 몇 개 적립할지 연결해 둬요. 상품은 현재 룰렛표에서
          기준 확률 이내로 켜져 있는 것만 고를 수 있어요. <b>연결해 두면 이후 당첨부터 자동으로 적립</b>되고,
          연결 전에 이미 나온 당첨은 아래 &ldquo;지난 당첨 가져오기&rdquo;에서 옮길 수 있어요.
        </p>
        {items.length === 0 ? (
          <p className={styles.empty}>먼저 위에서 쿠폰 종류를 만들어 주세요.</p>
        ) : couponSources.length === 0 ? (
          <p className={styles.empty}>연결할 수 있는 상품이 없습니다(기준 확률 이내 상품이 없어요).</p>
        ) : (
          <>
            <div className={styles.mapList}>
              {items.map((it) => {
                const sources = sourcesFor(it.key);
                const available = couponSources.filter(
                  (name) => !sources.some((s) => s.itemName === name),
                );
                const draft = sourceDraft[it.key] ?? "";
                return (
                  <div key={it.key} className={styles.mapItem}>
                    <div className={styles.mapItemHead}>{it.name || "(이름 없음)"}</div>
                    {sources.length === 0 ? (
                      <p className={styles.mapEmpty}>연결된 상품이 없어요.</p>
                    ) : (
                      <div className={styles.mapRows}>
                        {sources.map((s) => (
                          <div key={s.itemName} className={styles.mapRow}>
                            <span className={styles.mapSourceName}>{s.itemName}</span>
                            <div className={styles.stepper}>
                              <button
                                type="button"
                                className={styles.stepperBtn}
                                onClick={() => changePer(it.key, s.itemName, s.per - 1)}
                                disabled={s.per <= 1}
                                aria-label="적립 개수 줄이기"
                              >
                                −
                              </button>
                              <span className={styles.stepperVal}>{s.per}</span>
                              <button
                                type="button"
                                className={styles.stepperBtn}
                                onClick={() => changePer(it.key, s.itemName, s.per + 1)}
                                disabled={s.per >= 999}
                                aria-label="적립 개수 늘리기"
                              >
                                +
                              </button>
                            </div>
                            <span className={styles.perUnit}>개 적립</span>
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() => removeSource(it.key, s.itemName)}
                              aria-label="이 연결 삭제"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.mapAddRow}>
                      <select
                        className={styles.select}
                        value={draft}
                        onChange={(e) =>
                          setSourceDraft((prev) => ({ ...prev, [it.key]: e.target.value }))
                        }
                        disabled={available.length === 0}
                      >
                        <option value="">
                          {available.length === 0 ? "연결할 상품을 모두 골랐어요" : "상품 선택"}
                        </option>
                        {available.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.addBtn}
                        onClick={() => addSource(it.key)}
                        disabled={!draft}
                        style={{ marginTop: 0 }}
                      >
                        + 연결 추가
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.hint}>
              찾는 상품이 목록에 안 보이면, 룰렛표에서 꺼져 있거나 기준 확률보다 높은 상품이에요.
              그런 당첨은 업보 기록 자체가 안 남아서 쿠폰으로도 세어지지 않아요.
            </p>
            <p className={styles.hint}>
              저장하면 연결한 상품은 <b>팬 화면 업보 목록에서 빠지고</b>, 그때부터 쿠폰으로만 쌓여요.
              이미 나온 당첨은 그냥 두면 어느 쪽에도 안 보이니까, 저장한 다음 아래 &ldquo;지난 당첨
              가져오기&rdquo;까지 꼭 한 번 돌려 주세요.
            </p>
            {sourcesDirty ? (
              <p className={styles.previewWarn}>
                방금 바꾼 연결이 아직 저장 전이에요 — 아래 버튼으로 저장해야 실제로 적용돼요.
              </p>
            ) : null}
            <div>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={saveSources}
                disabled={savingSources}
                style={{ marginTop: 12 }}
              >
                {savingSources ? "저장 중…" : "적립 연결 저장"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 1.6 지난 당첨 가져오기 = 소급 적립 (2단계 조각 3) */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>지난 당첨 가져오기</h3>
        <p className={styles.blockSub}>
          연결을 저장하기 <b>전에 이미 나왔던 당첨</b>도 여기서 쿠폰으로 가져와요. 기간을 정해{" "}
          <b>미리보기</b>로 숫자를 먼저 확인하고, 맞으면 <b>반영</b>을 누르면 돼요. 이미 쿠폰으로
          들어간 당첨은 알아서 빼고 계산하니까, 여러 번 눌러도 두 번 쌓일 걱정은 없어요.
        </p>
        {sourceMap.length === 0 ? (
          <p className={styles.empty}>
            아직 연결이 없어요. 위에서 룰렛 상품을 쿠폰에 연결하고 저장하면, 여기서 지난 당첨을
            가져올 수 있어요.
          </p>
        ) : (
          <>
            <div className={styles.form}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>시작</span>
                <input
                  className={styles.dateInput}
                  type="datetime-local"
                  value={bfFrom}
                  onChange={(e) => {
                    setBfFrom(e.target.value);
                    setBfPreview(null);
                  }}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>끝</span>
                <input
                  className={styles.dateInput}
                  type="datetime-local"
                  value={bfTo}
                  onChange={(e) => {
                    setBfTo(e.target.value);
                    setBfPreview(null);
                  }}
                />
              </div>
              <button type="button" className={styles.pickBtn} onClick={presetThisMonth}>
                이번 달
              </button>
              <button type="button" className={styles.pickBtn} onClick={presetAllTime}>
                전체 기간
              </button>
            </div>
            <p className={styles.hint}>
              기간을 비우면 전체 기록이 대상이에요. 시각은 위플랩 표시 시각(한국 시간) 기준으로
              봐요.
            </p>
            {lastAppliedText ? (
              <p className={styles.hint}>
                지금 여기 들어 있는 당첨 기록은 <b>{lastAppliedText}까지 수집된 것</b>이 전부예요.
                그 뒤 방송분은 다음 수집 때 들어오고, 연결해 둔 상품이면 그때 자동으로 쿠폰이 쌓여요.
              </p>
            ) : null}
            <div className={styles.backfillActions}>
              <button
                type="button"
                className={styles.addBtn}
                onClick={loadBackfillPreview}
                disabled={bfLoading}
                style={{ marginTop: 0 }}
              >
                {bfLoading ? "확인 중…" : "미리보기"}
              </button>
              {bfPreview && bfPreview.totalDelta > 0 ? (
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={applyBackfill}
                  disabled={bfApplying}
                >
                  {bfApplying ? "반영 중…" : "이대로 반영"}
                </button>
              ) : null}
            </div>

            {bfPreview ? (
              <div className={styles.previewBox}>
                <p className={styles.previewTotal}>
                  새로 쌓일 쿠폰: 총 {bfPreview.totalDelta.toLocaleString()}개 (당첨{" "}
                  {bfPreview.totalEntries.toLocaleString()}건 → 시청자 {bfPreview.rows.length}명)
                </p>
                {bfPreview.rows.length === 0 ? (
                  <p className={styles.previewMuted}>
                    가져올 새 당첨이 없어요. 연결한 상품이 이 기간에 당첨된 적이 없거나, 이미 전부
                    쿠폰으로 들어가 있는 거예요.
                  </p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>시청자</th>
                          <th>쿠폰</th>
                          <th>당첨</th>
                          <th>적립</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bfPreview.rows.map((r) => (
                          <tr key={`${r.viewerKey}@@${r.itemKey}`}>
                            <td>
                              <span className={styles.viewerName}>{r.nickname || r.viewerKey}</span>{" "}
                              {r.accountId ? <span className={styles.viewerId}>({r.accountId})</span> : null}
                            </td>
                            <td>{items.find((it) => it.key === r.itemKey)?.name || r.itemName}</td>
                            <td className={styles.splitVal}>{r.entryCount.toLocaleString()}건</td>
                            <td>
                              <span className={styles.balanceValue}>+{r.delta.toLocaleString()}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {bfPreview.parseFailedCount > 0 ? (
                  <p className={styles.previewWarn}>
                    시간 해석 실패 {bfPreview.parseFailedCount}건 — 당첨 시각을 읽지 못해 기간
                    필터에서 빠졌어요(전체 기간으로 다시 미리보기하면 포함됩니다).
                  </p>
                ) : null}
                {bfPreview.alreadyAccruedCount > 0 ? (
                  <p className={styles.previewMuted}>
                    이미 자동 적립된 당첨 {bfPreview.alreadyAccruedCount}건은 중복을 막으려고
                    제외했어요.
                  </p>
                ) : null}
              </div>
            ) : null}
            {bfMsg ? <p className={bfMsg.kind === "ok" ? styles.ok : styles.err}>{bfMsg.text}</p> : null}
          </>
        )}
      </div>

      {/* 2. 지급/사용 기록 */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>지급 · 사용 기록</h3>
        <p className={styles.blockSub}>
          룰렛에서 뽑았거나 상품 대신 교환해 준 쿠폰은 <b>지급</b>, 쿠폰으로 상품을 사 갔으면{" "}
          <b>사용</b>으로 적어요. 잘못 적었으면 <b>값 설정</b>으로 바로잡으면 됩니다.
        </p>
        <div className={styles.form}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>닉네임</span>
            <input
              className={styles.nickInput}
              type="text"
              list={datalistId}
              value={nickname}
              placeholder="시청자 닉네임"
              onChange={(e) => setNickname(e.target.value)}
            />
            <datalist id={datalistId}>
              {viewerSuggestions.map((v) => (
                <option key={`${v.fanId}@@${v.fanNickname}`} value={v.fanNickname} />
              ))}
            </datalist>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>계정 ID (권장)</span>
            <input
              className={styles.idInput}
              type="text"
              value={accountId}
              placeholder="비우면 자동 찾기"
              onChange={(e) => setAccountId(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>쿠폰</span>
            <select className={styles.select} value={itemKey} onChange={(e) => setItemKey(e.target.value)}>
              {items.length === 0 ? <option value="">종류를 먼저 추가</option> : null}
              {items.map((it) => (
                <option key={it.key} value={it.key}>
                  {it.name || "(이름 없음)"}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>처리</span>
            <select
              className={styles.select}
              value={action}
              onChange={(e) => setAction(e.target.value as "grant" | "use" | "set")}
            >
              <option value="grant">지급 (+)</option>
              <option value="use">사용 (−)</option>
              <option value="set">값 설정 (=)</option>
            </select>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>수량</span>
            <input
              className={styles.qtyInput}
              type="text"
              inputMode="numeric"
              value={qty}
              placeholder="예: 1"
              onChange={(e) => {
                if (e.target.value === "" || /^\d+$/.test(e.target.value)) setQty(e.target.value);
              }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>메모 (선택)</span>
            <input
              className={styles.noteInput}
              type="text"
              value={note}
              maxLength={500}
              placeholder="예: 6/30 방송 룰렛"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={submitChange}
            disabled={savingChange || items.length === 0}
          >
            {savingChange ? "기록 중…" : "장부에 기록"}
          </button>
        </div>
        <p className={styles.hint}>
          같은 닉네임이 여러 명일 수 있어 계정 ID로 구분해요. ID를 비우면 업보 기록에서 닉네임이 정확히
          일치하는 시청자의 ID를 자동으로 찾아 씁니다.
        </p>
        {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
      </div>

      {/* 3. 잔액 현황 */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>잔액 현황</h3>
        {sortedBalances.length === 0 ? (
          <p className={styles.empty}>아직 쿠폰을 가진 시청자가 없어요. 위에서 첫 지급을 기록해 보세요.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>시청자</th>
                    <th>쿠폰</th>
                    <th>잔액(합계)</th>
                    <th>수동</th>
                    <th>자동</th>
                    <th>마지막 변경</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBalances.map((b) => {
                    const split = eventAggregate.get(`${b.viewerKey}@@${b.itemKey}`) ?? { manual: 0, auto: 0 };
                    return (
                      <tr key={b.id}>
                        <td>
                          <span className={styles.viewerName}>{b.nickname || "(닉네임 없음)"}</span>{" "}
                          {b.accountId ? <span className={styles.viewerId}>({b.accountId})</span> : null}
                        </td>
                        <td>{items.find((it) => it.key === b.itemKey)?.name || b.itemName}</td>
                        <td>
                          <span className={styles.balanceValue}>{b.balance.toLocaleString()}</span>
                        </td>
                        <td className={styles.splitVal}>{split.manual.toLocaleString()}</td>
                        <td className={styles.splitVal}>{split.auto.toLocaleString()}</td>
                        <td className={styles.eventTime}>{fmtKst(b.updatedAt)}</td>
                        <td>
                          <button type="button" className={styles.pickBtn} onClick={() => pickRow(b)}>
                            이 시청자로 입력
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={styles.tableNote}>
              합계는 실제 잔액이 정답이에요. 수동·자동은 최근 이력을 기준으로 나눈 <b>참고값</b>이라,
              사용(−)이 섞이거나 이력이 길면 수동+자동이 합계와 다를 수 있어요. 수동과 자동이 겹쳐
              이중으로 쌓인 것 같으면 확인 후 <b>값 설정</b>으로 정리하세요.
            </p>
          </>
        )}
      </div>

      {/* 4. 변경 이력 */}
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>변경 이력</h3>
        <p className={styles.blockSub}>
          누가 언제 얼마나 받았고 썼는지 최근순으로 남아요. 이력은 지워지지 않습니다(최근 300건 표시).
        </p>
        {events.length === 0 ? (
          <p className={styles.empty}>아직 기록이 없어요.</p>
        ) : (
          <div className={styles.eventList}>
            {events.map((ev) => (
              <div key={ev.id} className={styles.eventRow}>
                <span className={styles.eventTime}>{fmtKst(ev.createdAt)}</span>
                <span className={styles.viewerName}>{ev.nickname || ev.viewerKey}</span>
                <span>{items.find((it) => it.key === ev.itemKey)?.name || ev.itemName}</span>
                <span
                  className={
                    ev.actionType === "grant"
                      ? styles.badgeGrant
                      : ev.actionType === "use"
                        ? styles.badgeUse
                        : styles.badgeSet
                  }
                >
                  {ACTION_LABEL[ev.actionType]}
                </span>
                <span className={styles.eventDelta}>
                  {ev.delta > 0 ? `+${ev.delta}` : ev.delta} ({ev.previousCount} → {ev.nextCount})
                </span>
                {ev.note ? <span className={styles.eventNote}>{ev.note}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
