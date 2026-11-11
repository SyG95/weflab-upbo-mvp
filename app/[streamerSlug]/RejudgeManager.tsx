"use client";

// 재판정 화면.
// 룰렛확률표를 늦게 올린 탓에 "검토 필요"로 빠져 팬 시트에 안 들어간 결과를,
// 지금 표 기준으로 다시 판정해 되살린다. 원본과 기존 기록은 건드리지 않고,
// 새로 기록될 것만 추가한다(같은 걸 두 번 눌러도 두 번 들어가지 않음).
// 시범 스위치가 켜진 스트리머는 "후원 그때 표로(근사)" 미리보기도 고를 수 있다(확프 0.5.0 1단계 묶음 3, 쓰기 0).
// 관문 2: sy 마스터키로 연 세션(canApply)만 그 미리보기에서 🟢·🟡 를 골라 넣고, 실행별로 void 되돌리기를 할 수 있다.
//   스트리머 개인 비밀번호 세션은 지금처럼 미리보기만(버튼 없음, 서버도 403).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import ItemAliasLinker, { type AliasCandidate } from "./ItemAliasLinker";
import { forgetMissingSuspectCache } from "./MissingSuspectNotice";
import type { DonationTimeRow, DonationTimeSummary, ExcludedKind, OutsideKind } from "@/lib/rejudge";
import { prefillDateOf, stashManualPrefill } from "@/lib/manualPrefill";
import {
  approxApplyMessage,
  approxSelection,
  carryApproxPicks,
  isApproxRowPicked,
  isInsertableApproxRow,
} from "@/lib/rejudgeApplySelection";

type Candidate = {
  sourceKey: string;
  fanId: string;
  fanNickname: string;
  itemName: string;
  probability: number;
  amountRangeLabel: string;
  donateTimeText: string;
};

type PreviewResult = {
  catalogVersion: number;
  thresholdPercent: number;
  summary: {
    batchCount: number;
    scannedResults: number;
    wouldRecord: number;
    alreadyRecorded: number;
    stillNeedsReview: number;
    ignored: number;
  };
  candidates: Candidate[];
  aliasCandidates?: AliasCandidate[];
};

type AsofPreview = {
  latestVersion: number | null;
  thresholdPercent: number;
  summary: DonationTimeSummary;
  rows: DonationTimeRow[];
  page: number;
  pageCount: number;
  totalRows: number;
  inputFingerprint: string;
  planFingerprint: string;
  rowsToken: string;
  rawUntil: string | null;
  aliasCandidates?: AliasCandidate[];
  outsideKinds?: OutsideKind[];
  excludedKinds?: ExcludedKind[];
};

type Mode = "now" | "donation_time";

type ApproxRun = { runId: string; appliedAt: string; inserted: number; revertedAt: string | null; voided: number };

type RevertPreview = {
  runId: string;
  appliedAt: string | null;
  targets: number;
  voidable: number;
  alreadyCancelled: number;
  blocked: Array<{
    entryId: string;
    itemName: string;
    fanNickname: string;
    donateTimeText: string;
    reasons: Array<{ code: string; text: string }>;
  }>;
  missing: number;
  ledgerMismatch: { ledgerOnly: number; noteOnly: number } | null;
};

const RUNS_SHOWN = 20;

const APPLY_DOUBLE_NOTE =
  "앞 줄이 수집에서 빠졌다면 두배권이 빠져 수량이 1개 적게 들어갈 수 있어요. 넣은 뒤 수량 조정으로 고칠 수 있어요.";

function kstText(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type CatalogGroupLike = {
  amountRangeLabel?: string;
  items?: Array<{ itemName: string; probability: number; enabled?: boolean }>;
};

const MAX_ROWS_SHOWN = 200;

const CLS_LABEL: Record<string, string> = { green: "🟢 맞음", yellow: "🟡 확인", grey: "⚠️ 의심", orange: "🟠 표 밖" };
const NOW_LABEL: Record<string, string> = {
  record: "들어감",
  needs_review: "검토함",
  ignore: "제외",
  duplicate: "이미 있음",
  no_catalog: "—",
};

export default function RejudgeManager({ slug, groups = [] }: { slug: string; groups?: CatalogGroupLike[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "preview" | "apply" | "more" | "revert">("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [asof, setAsof] = useState<AsofPreview | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // 시범 스위치(sy 가 /admin 에서 켬)가 켜졌을 때만 "판정 기준" 선택을 보인다. 못 읽으면 지금처럼 "지금 표로"만.
  const [asofAvailable, setAsofAvailable] = useState(false);
  const [mode, setMode] = useState<Mode>("now");
  // 서버는 한 번에 2,000행까지 보내고, 화면은 그중 앞부분만 그린 뒤 "더 보기"로 늘린다(서버 재요청은 받은 행을 다 본 뒤에만).
  const [asofShown, setAsofShown] = useState(MAX_ROWS_SHOWN);
  const [openKind, setOpenKind] = useState("");
  // 관문 2: 넣기·되돌리기 버튼은 서버가 canApply(시범 스위치 + 마스터키 세션)를 줄 때만 보인다.
  const [canApply, setCanApply] = useState(false);
  // 사람이 바꾼 체크만 담는다(없으면 🟢 체크·🟡 해제 기본값). 새 미리보기마다 비운다.
  const [picks, setPicks] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<ApproxRun[] | null>(null);
  const [runsReload, setRunsReload] = useState(0);
  const [runsShown, setRunsShown] = useState(RUNS_SHOWN);
  const [revertPreview, setRevertPreview] = useState<RevertPreview | null>(null);
  const [revertReason, setRevertReason] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.modes?.donationTime === true) setAsofAvailable(true);
        if (alive && data?.canApply === true) setCanApply(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  // 넣기 실행 기록(되돌리기용). 마스터키 세션 + "그때 표로" 모드일 때만 읽는다.
  useEffect(() => {
    if (!canApply || mode !== "donation_time") return;
    let alive = true;
    fetch(`/api/s/${encodeURIComponent(slug)}/rejudge-revert`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data?.runs)) setRuns(data.runs as ApproxRun[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, canApply, mode, runsReload]);

  function errorText(status: number, data: { error?: string } | null): string {
    return status === 401
      ? "로그인이 풀렸어요. 관리자 비밀번호를 다시 입력해 주세요."
      : `실패했어요: ${data?.error ?? status}`;
  }

  // noticeAfter: 이름 연결을 저장하면 그 목록은 사라지므로(이제 찾아지니까),
  // 결과 문구를 여기 요약 자리에 대신 띄운다. state 로 넘기면 이 함수가 옛 값을
  // 붙잡아 못 읽으므로 인자로 직접 받는다.
  async function call(apply: boolean, noticeAfter = "") {
    if (mode === "donation_time" && !apply) return void callAsof(0, noticeAfter);
    setBusy(apply ? "apply" : "preview");
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 넣기는 미리보기에서 본 후보 키만 보낸다 — 그사이 새로 생긴 후보는 넣지 않고 숫자로만 알려 준다.
        body: JSON.stringify(
          apply ? { apply: true, confirm: slug, sourceKeys: (preview?.candidates ?? []).map((c) => c.sourceKey) } : {},
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        return;
      }
      if (apply) {
        setPreview(null);
        // recorded = 실제로 들어간 수, requested = 확인창에서 넣겠다고 한 수(미리보기 기준).
        // 둘이 다르면 왜 다른지 같이 보여 준다(그사이 이미 들어감 / 표·기준이 바뀜).
        const recorded = Number(data.recorded ?? 0);
        const requested = Number(data.requested ?? recorded);
        const already = Number(data.alreadyExisted ?? 0);
        const changed = Number(data.changedSincePreview ?? 0);
        const fresh = Number(data.notInPreview ?? 0);
        const reasons: string[] = [];
        if (already > 0) reasons.push(`${already}건은 그사이 이미 들어가 있었어요`);
        if (changed > 0) reasons.push(`${changed}건은 그사이 표나 기준이 바뀌어 넣을 대상에서 빠졌어요`);
        let text =
          requested !== recorded
            ? `미리보기 ${requested}건 중 ${recorded}건을 업보 시트에 넣었어요.`
            : `${recorded}건을 업보 시트에 넣었어요.`;
        if (reasons.length > 0) text += ` (${reasons.join(", ")})`;
        if (recorded > 0) text += " 팬 화면에서 바로 보입니다.";
        if (fresh > 0) text += ` 미리보기 뒤에 새로 찾은 ${fresh}건은 넣지 않았어요. 다시 미리보기로 확인해 주세요.`;
        setMsg({ type: "ok", text });
        router.refresh();
      } else {
        setPreview(data as PreviewResult);
        if (noticeAfter) {
          setMsg({ type: "ok", text: noticeAfter });
        } else if (data.summary.wouldRecord === 0) {
          setMsg({ type: "ok", text: "새로 넣을 게 없어요. 지금 표 기준으로 빠진 기록이 없습니다." });
        }
      }
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
    } finally {
      setBusy("");
    }
  }

  // 후원 그때 표로(근사) 미리보기. page 0 = 처음부터 다시, 그 뒤 쪽은 아래에 이어 붙인다.
  // keepPicks: 넣기가 막히거나 멈춘 뒤 다시 부를 때 — 분류가 같은 줄은 사람이 고른 것을 그대로 두고, 바뀐 줄만 해제한다.
  async function callAsof(page: number, noticeAfter = "", opts: { keepPicks?: boolean; noticeType?: "ok" | "err" } = {}) {
    setBusy(page === 0 ? "preview" : "more");
    if (page === 0) setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // 다음 쪽은 첫 쪽과 같은 원본 범위(rawUntil)로 — 방송 중 새 원본이 쌓여도 쪽끼리 어긋나지 않게.
        body: JSON.stringify({ mode: "donation_time", page, ...(page > 0 && asof?.rawUntil ? { rawUntil: asof.rawUntil } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        return;
      }
      const next = data as AsofPreview;
      if (page > 0 && asof && (next.rowsToken !== asof.rowsToken || next.inputFingerprint !== asof.inputFingerprint)) {
        // 쪽 사이에 행 목록(앞쪽 결과가 기록됨·분류 바뀜)이나 판정 재료가 바뀌면 이어 붙일 때 행이 빠진다 → 처음부터 다시.
        await callAsof(0, "그사이 판정 재료가 바뀌어 처음부터 다시 불러왔어요.");
        return;
      }
      if (page === 0) {
        forgetMissingSuspectCache(slug);
        if (opts.keepPicks && asof) {
          setPicks(carryApproxPicks(asof.rows, picks, next.rows));
        } else {
          setAsofShown(MAX_ROWS_SHOWN);
          setPicks({});
        }
        setAsof(next);
        if (noticeAfter) setMsg({ type: opts.noticeType ?? "ok", text: noticeAfter });
        else if (next.summary.d === 0 && next.summary.suspectedOver === 0 && next.summary.outside.rows === 0) {
          setMsg({ type: "ok", text: "새로 기록될 게 없어요. 후원 그때 표 기준으로도 빠진 기록이 없습니다." });
        }
      } else {
        setAsof((prev) => {
          if (!prev) return next;
          const seen = new Set(prev.rows.map((r) => r.sourceKey));
          return {
            ...next,
            rows: [...prev.rows, ...next.rows.filter((r) => !seen.has(r.sourceKey))],
            aliasCandidates: prev.aliasCandidates,
            outsideKinds: prev.outsideKinds,
            excludedKinds: prev.excludedKinds,
          };
        });
        setAsofShown((n) => n + MAX_ROWS_SHOWN);
      }
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
    } finally {
      setBusy("");
    }
  }

  // 표 밖(🟠) 종류 "앞으로 제외"·취소. 저장 뒤 미리보기를 다시 불러 목록과 숫자를 맞춘다.
  async function setKindPolicy(kind: { amount: number | null; itemName: string }, decision: "exclude" | "include") {
    if (decision === "exclude" && !window.confirm(`«${kind.itemName}»(${kind.amount ?? "금액 없음"}개)을 앞으로 목록에서 뺄까요?\n기록은 바뀌지 않고, 나중에 다시 볼 수 있어요.`)) return;
    setBusy("preview");
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: { amount: kind.amount, itemName: kind.itemName, decision } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        setBusy("");
        return;
      }
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
      setBusy("");
      return;
    }
    await callAsof(0, decision === "exclude" ? "이 종류는 앞으로 목록에서 뺐어요." : "이 종류를 다시 보여 줘요.");
  }

  // 표 밖 줄 → 수동기록 화면으로 값 넘기기. 시청자 정보는 주소창에 싣지 않는다.
  function openManualEntry(row: DonationTimeRow) {
    const ok = stashManualPrefill(slug, {
      fanId: row.fanId,
      fanNickname: row.fanNickname,
      itemName: row.itemName,
      probability: row.probability,
      date: prefillDateOf(row.donateTimeText),
    });
    if (!ok) {
      setMsg({ type: "err", text: "이 브라우저에서는 값을 넘길 수 없어요. 수동기록 탭에서 직접 입력해 주세요." });
      return;
    }
    router.push(`/${encodeURIComponent(slug)}?admin=1&atab=manual`);
  }

  // 관문 2 넣기: 화면에 그린 줄 중 고른 🟢·🟡 만, 마지막으로 그린 줄 위치(seenThrough)와 계획 지문을 같이 보낸다.
  // 서버는 같은 원본 범위로 다시 계산해 지문이 다르면 409, 못 본 줄·넣을 수 없는 줄이 섞이면 400(둘 다 쓰기 0).
  async function onApplyAsof() {
    if (!asof) return;
    const { keys, seenThrough } = approxSelection(shownMainRows, picks);
    if (keys.length === 0 || !seenThrough) return;
    const ok = window.confirm(
      `고른 ${keys.length}건을 업보 시트에 넣습니다.\n` +
        `후원 그때 룰렛표의 상품·확률로 1개씩 들어가고, 기존 기록은 바뀌지 않아요.\n` +
        `${APPLY_DOUBLE_NOTE}\n` +
        `잘못 넣으면 "넣기 실행 기록"에서 되돌릴 수 있지만, 되돌린 결과는 다시 넣을 수 없어요.\n\n진행할까요?`,
    );
    if (!ok) return;
    setBusy("apply");
    setMsg(null);
    let notice = "";
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "donation_time",
          apply: true,
          confirm: slug,
          fingerprint: asof.planFingerprint,
          rawUntil: asof.rawUntil,
          seenThrough,
          sourceKeys: keys,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409) {
        // 판정 재료가 바뀌었다(쓰기 0). 옛 목록으로 다시 누르지 않게 새 미리보기를 불러온다 — 분류가 같은 줄의 선택은 그대로.
        await callAsof(0, `${data?.error ?? "판정 기준이 바뀌었어요."} 새 미리보기를 불러왔어요 — 고른 줄을 다시 확인해 주세요.`, {
          keepPicks: true,
          noticeType: "err",
        });
        return;
      }
      if (res.status >= 500) {
        // 서버가 넣다가 멈췄을 수 있다(장부는 넣기 전에 먼저 쓴다) — 실행 기록과 미리보기를 다시 불러 실제 상태를 보여 준다.
        setRunsReload((n) => n + 1);
        router.refresh();
        await callAsof(0, `${data?.error ?? "넣는 중에 문제가 생겼어요. 일부가 들어갔을 수 있어요."} 미리보기와 넣기 실행 기록을 다시 불러왔어요.`, {
          keepPicks: true,
          noticeType: "err",
        });
        return;
      }
      if (!res.ok) {
        // 400·401·403 은 서버가 쓰기 전에 막은 것(쓰기 0).
        setMsg({ type: "err", text: errorText(res.status, data) });
        setBusy("");
        return;
      }
      notice = approxApplyMessage({
        requested: Number(data.requested ?? keys.length),
        inserted: Number(data.inserted ?? 0),
        alreadyExisted: Number(data.alreadyExisted ?? 0),
        couponLinked: Number(data.couponLinked ?? 0),
      });
    } catch {
      // 응답을 못 받았다 — 서버에서는 들어갔을 수도 있다. 실제 상태를 다시 불러온다.
      setRunsReload((n) => n + 1);
      router.refresh();
      await callAsof(0, "연결이 끊겨 결과를 못 받았어요. 일부가 들어갔을 수 있어요 — 미리보기와 넣기 실행 기록을 다시 불러왔어요.", {
        keepPicks: true,
        noticeType: "err",
      });
      return;
    }
    setRunsReload((n) => n + 1);
    router.refresh();
    // 넣은 뒤 미리보기를 다시 불러 목록·미처리 수(머리 표시 기준점)를 맞춘다.
    await callAsof(0, notice);
  }

  async function previewRevert(runId: string) {
    setBusy("revert");
    setMsg(null);
    setRevertReason("");
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge-revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        return;
      }
      setRevertPreview(data as RevertPreview);
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
    } finally {
      setBusy("");
    }
  }

  async function applyRevert() {
    if (!revertPreview) return;
    const reason = revertReason.trim();
    if (!reason || revertPreview.voidable === 0) return;
    const ok = window.confirm(
      `이 실행으로 넣은 기록 ${revertPreview.voidable}건을 되돌립니다(취소 표시, 지우지 않음).\n` +
        `막힌 ${revertPreview.blocked.length}건은 건너뛰어요. 되돌린 결과는 다시 넣을 수 없어요.\n\n진행할까요?`,
    );
    if (!ok) return;
    setBusy("revert");
    setMsg(null);
    let notice = "";
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge-revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: revertPreview.runId, apply: true, confirm: slug, reason }),
      });
      const data = await res.json().catch(() => null);
      if (res.status >= 500) {
        // 되돌리다 멈췄을 수 있다(장부는 void 전에 먼저 쓴다) — 실행 기록·미리보기를 다시 불러 실제 상태를 보여 준다.
        setRevertPreview(null);
        setRunsReload((n) => n + 1);
        router.refresh();
        const text = `${data?.error ?? "되돌리는 중에 문제가 생겼어요. 일부가 되돌려졌을 수 있어요."} 넣기 실행 기록을 다시 불러왔어요.`;
        if (asof) await callAsof(0, text, { keepPicks: true, noticeType: "err" });
        else {
          setMsg({ type: "err", text });
          setBusy("");
        }
        return;
      }
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        setBusy("");
        return;
      }
      const blocked = Array.isArray(data.blocked) ? data.blocked.length : 0;
      notice =
        `${Number(data.voided ?? 0)}건을 되돌렸어요(취소 표시).` +
        (Number(data.alreadyCancelled ?? 0) > 0 ? ` 이미 취소된 ${Number(data.alreadyCancelled)}건은 그대로 뒀어요.` : "") +
        (blocked > 0 ? ` 막힌 ${blocked}건은 건너뛰었어요 — 따로 처리해 주세요.` : "");
      setRevertPreview(null);
      setRevertReason("");
    } catch {
      setRevertPreview(null);
      setRunsReload((n) => n + 1);
      setMsg({ type: "err", text: "연결이 끊겨 결과를 못 받았어요. 일부가 되돌려졌을 수 있어요 — 넣기 실행 기록을 다시 불러왔어요." });
      setBusy("");
      return;
    }
    setRunsReload((n) => n + 1);
    router.refresh();
    if (asof) await callAsof(0, notice);
    else {
      setMsg({ type: "ok", text: notice });
      setBusy("");
    }
  }

  function onApply() {
    if (!preview) return;
    const ok = window.confirm(
      `${preview.summary.wouldRecord}건을 업보 시트에 넣습니다.\n` +
        `기존 기록은 바뀌지 않고, 빠졌던 것만 새로 들어갑니다.\n\n진행할까요?`,
    );
    if (ok) void call(true);
  }

  function onModeChange(next: Mode) {
    if (next === mode || busy !== "") return;
    setMode(next);
    setPreview(null);
    setAsof(null);
    setMsg(null);
    setRevertPreview(null);
  }

  const s = preview?.summary;
  const shown = preview?.candidates.slice(0, MAX_ROWS_SHOWN) ?? [];
  // 이름만 바뀐 것으로 보이는 묶음이 있으면 연결 화면을 처음부터 펼쳐 준다.
  const aliasCandidates = (mode === "donation_time" ? asof?.aliasCandidates : preview?.aliasCandidates) ?? [];
  const recommendCount = aliasCandidates.filter((c) => c.wouldRecord).length;
  const hasRecommendation = recommendCount > 0;
  const a = asof?.summary;
  const mainRows = asof ? asof.rows.filter((r) => r.kind !== "outside") : [];
  // 화면에 그린 줄만 고를 수 있다(넣기 요청의 "본 줄까지만" 기준).
  const shownMainRows = mainRows.slice(0, asofShown);
  const selection = canApply ? approxSelection(shownMainRows, picks) : { keys: [] as string[], seenThrough: null };
  const couponPicked = canApply ? shownMainRows.filter((r) => r.couponLinked && isApproxRowPicked(r, picks)).length : 0;
  const unseenInsertable = a ? Math.max(0, a.d - shownMainRows.filter((r) => isInsertableApproxRow(r)).length) : 0;
  const outsideRowsOf = (key: string) => (asof?.rows ?? []).filter((r) => r.kind === "outside" && r.kindKey === key);

  const aliasLinker =
    aliasCandidates.length > 0 ? (
      <details className={styles.dmItem} style={{ marginTop: 10 }} open={hasRecommendation}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          이름이 바뀐 상품 연결하기
          {hasRecommendation ? (
            <span className={styles.tagWarn} style={{ marginLeft: 6 }}>
              {recommendCount}개 발견
            </span>
          ) : null}
        </summary>
        <div style={{ marginTop: 10 }}>
          <ItemAliasLinker
            slug={slug}
            candidates={aliasCandidates}
            groups={groups}
            onSaved={(message) => void call(false, message)}
          />
        </div>
      </details>
    ) : null;

  return (
    <div>
      <p className={styles.fieldHint} style={{ marginTop: 0 }}>
        룰렛표를 늦게 올렸을 때 씁니다. 표가 없던 시점에 들어온 결과는 &ldquo;검토 필요&rdquo;로 빠져
        팬 시트에 안 들어가는데, 표를 올린 뒤 이 버튼을 누르면 <b>지금 표 기준으로 다시 판정</b>해서
        빠졌던 것만 채워 넣습니다.
      </p>
      <ul className={styles.fieldHint} style={{ marginTop: 6, paddingLeft: 18 }}>
        <li>이미 들어가 있는 기록은 건드리지 않아요(고치거나 지우지 않습니다).</li>
        <li>두 번 눌러도 같은 게 두 번 들어가지 않아요.</li>
        <li>
          두배권은 적용되지 않습니다. 두배로 받아야 할 게 있으면 <b>수동기록</b>에서 개수를 올려주세요.
        </li>
      </ul>

      {asofAvailable ? (
        <fieldset style={{ border: 0, padding: 0, margin: "10px 0 0" }}>
          <legend className={styles.fieldHint} style={{ margin: 0, fontWeight: 700 }}>
            판정 기준
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 4, fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name={`rejudge-mode-${slug}`}
                checked={mode === "now"}
                disabled={busy !== ""}
                onChange={() => onModeChange("now")}
              />
              지금 표로
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name={`rejudge-mode-${slug}`}
                checked={mode === "donation_time"}
                disabled={busy !== ""}
                onChange={() => onModeChange("donation_time")}
              />
              후원 그때 표로(근사·미리보기)
            </label>
          </div>
          {mode === "donation_time" ? (
            <p className={styles.fieldHint} style={{ marginTop: 4 }}>
              후원한 시각에 쓰던 룰렛표·사용 설정·기준확률로 다시 판정해 봅니다. 확프가 끊겼거나 표 갱신이 늦어
              검토함에 갇힌 당첨을 찾는 용도예요.{" "}
              {canApply ? (
                <b>🟢는 처음부터 골라져 있고, 🟡는 이유를 보고 직접 골라 넣어요.</b>
              ) : (
                <b>여기서는 미리보기만 되고 시트에는 넣지 않아요.</b>
              )}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className={styles.thresholdRow} style={{ marginTop: 10 }}>
        <button type="button" onClick={() => void call(false)} disabled={busy !== ""}>
          {busy === "preview" ? "확인 중…" : "다시 판정해보기(미리보기)"}
        </button>
        {mode === "now" && preview && s && s.wouldRecord > 0 ? (
          <button type="button" onClick={onApply} disabled={busy !== ""}>
            {busy === "apply" ? "넣는 중…" : `${s.wouldRecord}건 시트에 넣기`}
          </button>
        ) : null}
      </div>

      {msg ? <p className={msg.type === "ok" ? styles.fieldOk : styles.fieldErr}>{msg.text}</p> : null}

      {mode === "donation_time" && canApply ? (
        <details className={styles.dmItem} style={{ marginTop: 10, padding: "8px 10px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            넣기 실행 기록{runs ? ` ${runs.length}건` : ""}
          </summary>
          <p className={styles.fieldHint}>
            잘못 넣었으면 실행별로 되돌릴 수 있어요. 되돌리기는 지우는 게 아니라 &lsquo;취소&rsquo; 표시라서{" "}
            <b>되돌린 결과는 다시 넣을 수 없어요</b>(팬 &ldquo;획득 기록&rdquo; 탭에는 취소된 채로 남아요). 양도·배송
            처리·쿠폰 적립이 있는 기록은 막고 이유를 보여 줘요.
          </p>
          {runs && runs.length === 0 ? <p className={styles.fieldHint}>아직 넣은 실행이 없어요.</p> : null}
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {(runs ?? []).slice(0, runsShown).map((run) => {
              const open = revertPreview?.runId === run.runId ? revertPreview : null;
              return (
                <div key={run.runId} style={{ borderTop: "1px solid rgba(127,127,127,0.25)", paddingTop: 8 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
                    <span>{kstText(run.appliedAt)}</span>
                    <span className={styles.tagMuted}>넣음 {run.inserted}건</span>
                    {run.voided > 0 ? <span className={styles.tagWarn}>되돌림 {run.voided}건</span> : null}
                    <button type="button" onClick={() => void previewRevert(run.runId)} disabled={busy !== ""}>
                      {busy === "revert" && !open ? "확인 중…" : "되돌리기 미리보기"}
                    </button>
                  </div>
                  {open ? (
                    <div style={{ marginTop: 8 }}>
                      <p className={styles.fieldHint} style={{ marginTop: 0 }}>
                        이 실행의 기록 {open.targets}건: 되돌릴 수 있음 <b>{open.voidable}</b> · 이미 취소 {open.alreadyCancelled} ·
                        막힘 {open.blocked.length}
                        {open.missing > 0 ? ` · 장부엔 있지만 기록이 없음 ${open.missing}(이미 있던 결과라 안 들어갔거나 중간에 멈춤·지워짐)` : ""}
                      </p>
                      {open.ledgerMismatch ? (
                        <p className={styles.fieldErr}>
                          넣기 장부와 기록 표시가 서로 달라요(장부에만 {open.ledgerMismatch.ledgerOnly}건, 기록에만{" "}
                          {open.ledgerMismatch.noteOnly}건). 둘 다에 있는 기록만 되돌려요.
                        </p>
                      ) : null}
                      {open.blocked.length > 0 ? (
                        <div className={styles.tableWrap} style={{ marginTop: 6 }}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>후원시간</th>
                                <th>닉네임</th>
                                <th>상품</th>
                                <th>막힌 이유</th>
                              </tr>
                            </thead>
                            <tbody>
                              {open.blocked.map((b) => (
                                <tr key={b.entryId}>
                                  <td style={{ whiteSpace: "nowrap" }}>{b.donateTimeText || "—"}</td>
                                  <td style={{ whiteSpace: "nowrap" }}>{b.fanNickname || "—"}</td>
                                  <td style={{ whiteSpace: "nowrap" }}>{b.itemName}</td>
                                  <td style={{ minWidth: 160 }}>{b.reasons.map((r) => r.text).join(" · ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                      {open.voidable > 0 ? (
                        <div className={styles.thresholdRow} style={{ marginTop: 8, flexWrap: "wrap" }}>
                          <input
                            type="text"
                            value={revertReason}
                            maxLength={200}
                            placeholder="되돌리는 이유(필수)"
                            onChange={(e) => setRevertReason(e.target.value)}
                            disabled={busy !== ""}
                            style={{ minWidth: 0, flex: "1 1 160px" }}
                          />
                          <button type="button" onClick={() => void applyRevert()} disabled={busy !== "" || !revertReason.trim()}>
                            {busy === "revert" ? "되돌리는 중…" : `${open.voidable}건 되돌리기`}
                          </button>
                        </div>
                      ) : (
                        <p className={styles.fieldHint}>되돌릴 수 있는 기록이 없어요.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {runs && runs.length > runsShown ? (
            <div className={styles.thresholdRow} style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setRunsShown((n) => n + RUNS_SHOWN)} disabled={busy !== ""}>
                {`실행 더 보기 (${runsShown}/${runs.length})`}
              </button>
            </div>
          ) : null}
        </details>
      ) : null}

      {mode === "now" && preview && s ? (
        <div style={{ marginTop: 12 }}>
          <p className={styles.fieldHint} style={{ marginTop: 0 }}>
            룰렛표 v{preview.catalogVersion} · 기준 확률 {preview.thresholdPercent}% 로 원본{" "}
            {s.scannedResults.toLocaleString()}건을 다시 봤어요.
          </p>
          <p className={styles.fieldHint}>
            <b>새로 넣을 것 {s.wouldRecord}건</b> · 이미 들어가 있음 {s.alreadyRecorded}건 · 기준 확률
            초과라 제외 {s.ignored}건 · 지금 표로도 못 찾음 {s.stillNeedsReview}건
          </p>
          {s.stillNeedsReview > 0 ? (
            <p className={styles.fieldHint}>
              못 찾은 {s.stillNeedsReview}건은 상품 이름이 지금 표와 다르거나, 그때 쓰던 룰렛이 지금 표에
              없는 경우예요. <b>이름만 바뀐 것이면 아래에서 이어 주면 찾아집니다.</b>
            </p>
          ) : null}

          {aliasLinker}

          {shown.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 10 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>후원시간</th>
                    <th>닉네임</th>
                    <th>계정ID</th>
                    <th>룰렛</th>
                    <th>상품</th>
                    <th>확률</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.sourceKey}>
                      <td>{c.donateTimeText || "—"}</td>
                      <td>{c.fanNickname || "—"}</td>
                      <td>{c.fanId || "—"}</td>
                      <td>{c.amountRangeLabel || "—"}</td>
                      <td>{c.itemName}</td>
                      <td>{c.probability}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.candidates.length > shown.length ? (
            <p className={styles.fieldHint}>
              목록은 앞 {MAX_ROWS_SHOWN}건만 보여줘요. 넣기를 누르면 {preview.candidates.length}건 전부
              들어갑니다.
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === "donation_time" && asof && a ? (
        <div style={{ marginTop: 12 }}>
          <p className={styles.fieldHint} style={{ marginTop: 0 }}>
            원본 {a.scannedResults.toLocaleString()}줄(결과 {a.N.toLocaleString()}건)을 후원 시각마다 그때 룰렛표로 다시
            봤어요. 지금 표는 v{asof.latestVersion ?? "—"} · 지금 기준 확률 {asof.thresholdPercent}%.
          </p>
          <p className={styles.fieldHint}>
            결과 {a.N}건 = 이미 기록 {a.a} + <b>새로 기록될 것 {a.d}</b>(🟢 {a.green} · 🟡 {a.yellow}) + 검토{" "}
            {a.c} + 제외 {a.b}
          </p>
          <p className={styles.fieldHint}>
            제외 {a.b}건: 그때 기준 초과 {a.excluded.over_threshold} · 그때 꺼진 상품 {a.excluded.disabled_then} · 두배권
            칸 {a.excluded.modifier} · 미션 정산 {a.excluded.mission}
            {a.excluded.policy > 0 ? ` · 제외하기로 정한 종류 ${a.excluded.policy}` : ""}
            {a.alsoNowRecord > 0 ? ` · 새로 기록될 것 중 ${a.alsoNowRecord}건은 "지금 표로"로도 들어가요` : ""}
          </p>
          {a.hiddenOnFan > 0 ? (
            <p className={styles.fieldHint}>
              <span className={styles.tagMuted}>팬 화면 숨김 {a.hiddenOnFan}</span> 넣어도 팬 화면엔 안 보이는 것(그
              표 버전에서 지금 꺼 둔 상품)이에요.
            </p>
          ) : null}
          {a.suspectedOver > 0 ? (
            <p className={styles.fieldHint}>
              <span className={styles.tagWarn}>오기록 의심 {a.suspectedOver}</span> 이미 기록됐는데 그때 기준으로는
              제외였던 것이에요. 표시만 하고 지우지 않아요.
            </p>
          ) : null}
          <p className={styles.fieldHint}>
            🟢 = 그때 표·사용 설정·기준과 전부 정확히 맞음, 🟡 = 하나라도 확실하지 않음(이유 참고), 🟠 = 그때 표에 없는
            저확률 결과.{canApply ? " 🟠는 이 목록으로 넣지 않고 수동기록으로 넣어요." : " 미리보기만 되고 시트에는 넣지 않아요."}{" "}
            🟢도 수집에서 통째로 빠진 앞 줄까지 보증하지는 않아서, 2배 여부는 원본과 달라질 수 있어요.
          </p>
          {a.c > a.outside.rows ? (
            <p className={styles.fieldHint}>
              검토 {a.c}건 중 {a.c - a.outside.rows}건은 기준 확률보다 높거나 그때 룰렛표가 없어서 아래 목록에 넣지 않았어요.
            </p>
          ) : null}

          {aliasLinker}

          {(asof.outsideKinds?.length ?? 0) > 0 ? (
            <details className={styles.dmItem} style={{ marginTop: 10, padding: "8px 10px" }} open>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                🟠 표에 없는 저확률 결과 {asof.outsideKinds!.length}종류 · {a.outside.rows}줄
              </summary>
              <p className={styles.fieldHint}>
                그때 룰렛표에 칸이 없어서 자동으로 판단할 수 없는 결과예요. 게임 결과처럼 기록할 게 아니면 종류째 빼 두고,
                기록할 게 있으면 줄을 펼쳐 수동기록으로 넣어 주세요.
              </p>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {asof.outsideKinds!.map((kind) => {
                  const expanded = openKind === kind.key;
                  const kindRows = expanded ? outsideRowsOf(kind.key) : [];
                  return (
                    <div key={kind.key} style={{ borderTop: "1px solid rgba(127,127,127,0.25)", paddingTop: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
                        <b style={{ overflowWrap: "anywhere" }}>{kind.itemName}</b>
                        <span className={styles.tagMuted}>{kind.amount ?? "금액 없음"}개</span>
                        <span className={styles.fieldHint} style={{ margin: 0 }}>
                          {kind.count}줄 · {kind.firstTimeText.slice(0, 10)}
                          {kind.lastTimeText.slice(0, 10) !== kind.firstTimeText.slice(0, 10) ? ` ~ ${kind.lastTimeText.slice(0, 10)}` : ""}
                          {kind.probabilityMin !== null
                            ? ` · ${kind.probabilityMin}%${kind.probabilityMax !== kind.probabilityMin ? ` ~ ${kind.probabilityMax}%` : ""}`
                            : " · 확률 없음"}
                          {kind.inOtherTable ? " · 다른 표에만 있음" : ""}
                        </span>
                      </div>
                      <div className={styles.thresholdRow} style={{ marginTop: 6 }}>
                        <button type="button" onClick={() => setOpenKind(expanded ? "" : kind.key)} disabled={busy !== ""}>
                          {expanded ? "줄 접기" : "줄 보기"}
                        </button>
                        {kind.excludable ? (
                          <button type="button" onClick={() => void setKindPolicy(kind, "exclude")} disabled={busy !== ""}>
                            이 종류 앞으로 제외
                          </button>
                        ) : null}
                      </div>
                      {kind.excludable ? null : (
                        <p className={styles.fieldHint}>룰렛표에 같은 이름이 있어 종류째 뺄 수 없어요. 줄을 펼쳐 확인해 주세요.</p>
                      )}
                      {expanded ? (
                        kindRows.length > 0 ? (
                          <div className={styles.tableWrap} style={{ marginTop: 8 }}>
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th>후원시간</th>
                                  <th>닉네임</th>
                                  <th>계정ID</th>
                                  <th>확률</th>
                                  <th>이유</th>
                                  <th>넣기</th>
                                </tr>
                              </thead>
                              <tbody>
                                {kindRows.map((r) => (
                                  <tr key={r.sourceKey}>
                                    <td style={{ whiteSpace: "nowrap" }}>{r.donateTimeText || "—"}</td>
                                    <td style={{ whiteSpace: "nowrap" }}>{r.fanNickname || "—"}</td>
                                    <td style={{ whiteSpace: "nowrap" }}>{r.fanId || "—"}</td>
                                    <td style={{ whiteSpace: "nowrap" }}>{r.probability === null ? "—" : `${r.probability}%`}</td>
                                    <td style={{ minWidth: 150 }}>
                                      {r.reasonText}
                                      {r.tags.map((t) => (
                                        <span key={t} className={`${styles.tagMuted} ${styles.tagWrap}`} style={{ display: "block", marginTop: 4 }}>
                                          {t}
                                        </span>
                                      ))}
                                    </td>
                                    <td>
                                      <div className={styles.thresholdRow} style={{ margin: 0, flexWrap: "nowrap" }}>
                                        <button type="button" style={{ whiteSpace: "nowrap" }} onClick={() => openManualEntry(r)} disabled={busy !== ""}>
                                          수동기록으로 넣기
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className={styles.fieldHint}>줄이 아직 안 불러와졌어요. 아래 &ldquo;더 보기&rdquo;를 눌러 주세요.</p>
                        )
                      ) : null}
                      {expanded && kindRows.length > 0 && kindRows.length < kind.count ? (
                        <p className={styles.fieldHint}>
                          {kind.count}줄 중 {kindRows.length}줄만 불러왔어요. 나머지는 아래 &ldquo;더 보기&rdquo;를 눌러 주세요.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          {(asof.excludedKinds?.length ?? 0) > 0 ? (
            <details className={styles.dmItem} style={{ marginTop: 10, padding: "8px 10px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>제외하기로 정한 종류 {asof.excludedKinds!.length}개</summary>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {asof.excludedKinds!.map((kind) => (
                  <div key={kind.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
                    <span style={{ overflowWrap: "anywhere" }}>
                      {kind.itemName} · {kind.amount ?? "금액 없음"}개 · {kind.count}줄
                    </span>
                    <button type="button" onClick={() => void setKindPolicy(kind, "include")} disabled={busy !== ""}>
                      다시 보기
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {canApply && a.d > 0 ? (
            <div className={styles.dmItem} style={{ marginTop: 10, padding: "8px 10px" }}>
              <div className={styles.thresholdRow} style={{ margin: 0 }}>
                <button type="button" onClick={() => void onApplyAsof()} disabled={busy !== "" || selection.keys.length === 0}>
                  {busy === "apply" ? "넣는 중…" : `고른 ${selection.keys.length}건 시트에 넣기`}
                </button>
              </div>
              <p className={styles.fieldHint}>{APPLY_DOUBLE_NOTE}</p>
              {couponPicked > 0 ? (
                <p className={styles.fieldHint}>
                  <span className={styles.tagWarn}>쿠폰 반영</span> 고른 줄 중 {couponPicked}건은 쿠폰에 연결된 상품이에요. 넣어도
                  쿠폰은 자동으로 안 쌓여요 — 넣은 뒤 쿠폰 탭 &ldquo;지난 당첨 가져오기&rdquo;로 반영해 주세요(안 하면 팬 보유에서도
                  빠지고 쿠폰도 안 붙어요).
                </p>
              ) : null}
              {unseenInsertable > 0 ? (
                <p className={styles.fieldHint}>
                  아직 화면에 안 펼친 🟢·🟡 {unseenInsertable}건은 넣지 않아요. 아래 &ldquo;더 보기&rdquo;로 펼친 줄만 고를 수 있어요.
                </p>
              ) : null}
            </div>
          ) : null}

          {mainRows.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 10 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {canApply ? <th>넣기</th> : null}
                    <th>분류</th>
                    <th>이유</th>
                    <th>후원시간</th>
                    <th>닉네임</th>
                    <th>계정ID</th>
                    <th>금액</th>
                    <th>상품(원본)</th>
                    <th>확률</th>
                    <th>그때 표</th>
                    <th>지금 표로</th>
                  </tr>
                </thead>
                <tbody>
                  {shownMainRows.map((r) => (
                    <tr key={r.sourceKey}>
                      {canApply ? (
                        <td>
                          {isInsertableApproxRow(r) ? (
                            <input
                              type="checkbox"
                              aria-label={`${r.itemName} 넣기`}
                              checked={isApproxRowPicked(r, picks)}
                              disabled={busy !== ""}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setPicks((prev) => ({ ...prev, [r.sourceKey]: checked }));
                              }}
                            />
                          ) : null}
                        </td>
                      ) : null}
                      <td style={{ whiteSpace: "nowrap" }}>{CLS_LABEL[r.kind === "suspected" ? "grey" : r.cls]}</td>
                      <td style={{ minWidth: 180 }}>
                        {r.reasonText}
                        {r.reasons.length > 1 ? ` 외 ${r.reasons.length - 1}` : ""}
                        {r.tags.map((t) => (
                          <span key={t} className={`${styles.tagMuted} ${styles.tagWrap}`} style={{ display: "block", marginTop: 4 }}>
                            {t}
                          </span>
                        ))}
                        {canApply && r.couponLinked ? (
                          <span className={`${styles.tagWarn} ${styles.tagWrap}`} style={{ display: "block", marginTop: 4 }}>
                            쿠폰 연결 상품 — 넣은 뒤 쿠폰 반영 필요
                          </span>
                        ) : null}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.donateTimeText || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.fanNickname || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.fanId || "—"}</td>
                      <td>{r.donationAmount ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.itemName}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.probability === null ? "—" : `${r.probability}%`}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        v{r.judged.version}
                        {r.judged.amountRangeLabel ? ` · ${r.judged.amountRangeLabel}` : ""}
                        {` · 기준 ${r.judged.threshold}%`}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{NOW_LABEL[r.nowDecision] ?? r.nowDecision}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {asofShown < mainRows.length || asof.page + 1 < asof.pageCount ? (
            <div className={styles.thresholdRow} style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => (asofShown < mainRows.length ? setAsofShown((n) => n + MAX_ROWS_SHOWN) : void callAsof(asof.page + 1))}
                disabled={busy !== ""}
              >
                {busy === "more" ? "불러오는 중…" : `더 보기 (${Math.min(asofShown, mainRows.length)}/${asof.totalRows - a.outside.rows})`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
