"use client";

// 재판정 화면.
// 룰렛확률표를 늦게 올린 탓에 "검토 필요"로 빠져 팬 시트에 안 들어간 결과를,
// 지금 표 기준으로 다시 판정해 되살린다. 원본과 기존 기록은 건드리지 않고,
// 새로 기록될 것만 추가한다(같은 걸 두 번 눌러도 두 번 들어가지 않음).
// 시범 스위치가 켜진 스트리머는 "후원 그때 표로(근사)" 미리보기도 고를 수 있다(확프 0.5.0 1단계 묶음 3, 쓰기 0).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import ItemAliasLinker, { type AliasCandidate } from "./ItemAliasLinker";
import type { DonationTimeRow, DonationTimeSummary } from "@/lib/rejudge";

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
  aliasCandidates?: AliasCandidate[];
};

type Mode = "now" | "donation_time";

type CatalogGroupLike = {
  amountRangeLabel?: string;
  items?: Array<{ itemName: string; probability: number; enabled?: boolean }>;
};

const MAX_ROWS_SHOWN = 200;

const CLS_LABEL: Record<string, string> = { green: "🟢 맞음", yellow: "🟡 확인", grey: "⚠️ 의심" };
const NOW_LABEL: Record<string, string> = {
  record: "들어감",
  needs_review: "검토함",
  ignore: "제외",
  duplicate: "이미 있음",
  no_catalog: "—",
};

export default function RejudgeManager({ slug, groups = [] }: { slug: string; groups?: CatalogGroupLike[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "preview" | "apply" | "more">("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [asof, setAsof] = useState<AsofPreview | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // 시범 스위치(sy 가 /admin 에서 켬)가 켜졌을 때만 "판정 기준" 선택을 보인다. 못 읽으면 지금처럼 "지금 표로"만.
  const [asofAvailable, setAsofAvailable] = useState(false);
  const [mode, setMode] = useState<Mode>("now");

  useEffect(() => {
    let alive = true;
    fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.modes?.donationTime === true) setAsofAvailable(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

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
  async function callAsof(page: number, noticeAfter = "") {
    setBusy(page === 0 ? "preview" : "more");
    if (page === 0) setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/rejudge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "donation_time", page }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: errorText(res.status, data) });
        return;
      }
      const next = data as AsofPreview;
      if (page === 0) {
        setAsof(next);
        if (noticeAfter) setMsg({ type: "ok", text: noticeAfter });
        else if (next.summary.d === 0 && next.summary.suspectedOver === 0) {
          setMsg({ type: "ok", text: "새로 기록될 게 없어요. 후원 그때 표 기준으로도 빠진 기록이 없습니다." });
        }
      } else {
        setAsof((prev) =>
          prev ? { ...next, rows: [...prev.rows, ...next.rows], aliasCandidates: prev.aliasCandidates } : next,
        );
      }
    } catch {
      setMsg({ type: "err", text: "연결에 실패했어요. 잠시 뒤 다시 시도해 주세요." });
    } finally {
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
    if (next === mode) return;
    setMode(next);
    setPreview(null);
    setAsof(null);
    setMsg(null);
  }

  const s = preview?.summary;
  const shown = preview?.candidates.slice(0, MAX_ROWS_SHOWN) ?? [];
  // 이름만 바뀐 것으로 보이는 묶음이 있으면 연결 화면을 처음부터 펼쳐 준다.
  const aliasCandidates = (mode === "donation_time" ? asof?.aliasCandidates : preview?.aliasCandidates) ?? [];
  const recommendCount = aliasCandidates.filter((c) => c.wouldRecord).length;
  const hasRecommendation = recommendCount > 0;
  const a = asof?.summary;

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
              <input type="radio" name={`rejudge-mode-${slug}`} checked={mode === "now"} onChange={() => onModeChange("now")} />
              지금 표로
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name={`rejudge-mode-${slug}`}
                checked={mode === "donation_time"}
                onChange={() => onModeChange("donation_time")}
              />
              후원 그때 표로(근사·미리보기)
            </label>
          </div>
          {mode === "donation_time" ? (
            <p className={styles.fieldHint} style={{ marginTop: 4 }}>
              후원한 시각에 쓰던 룰렛표·사용 설정·기준확률로 다시 판정해 봅니다. 확프가 끊겼거나 표 갱신이 늦어
              검토함에 갇힌 당첨을 찾는 용도예요. <b>지금은 미리보기만 되고 시트에는 넣지 않아요.</b>
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
            🟢 = 그때 표·사용 설정·기준과 전부 정확히 맞음, 🟡 = 하나라도 확실하지 않음(이유 참고). 미리보기만 되고
            시트에는 넣지 않아요.
          </p>

          {aliasLinker}

          {asof.rows.length > 0 ? (
            <div className={styles.tableWrap} style={{ marginTop: 10 }}>
              <table className={styles.table}>
                <thead>
                  <tr>
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
                  {asof.rows.map((r) => (
                    <tr key={r.sourceKey}>
                      <td style={{ whiteSpace: "nowrap" }}>{CLS_LABEL[r.kind === "suspected" ? "grey" : r.cls]}</td>
                      <td style={{ minWidth: 180 }}>
                        {r.reasonText}
                        {r.reasons.length > 1 ? ` 외 ${r.reasons.length - 1}` : ""}
                        {r.tags.map((t) => (
                          <span key={t} className={`${styles.tagMuted} ${styles.tagWrap}`} style={{ display: "block", marginTop: 4 }}>
                            {t}
                          </span>
                        ))}
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
          {asof.page + 1 < asof.pageCount ? (
            <div className={styles.thresholdRow} style={{ marginTop: 10 }}>
              <button type="button" onClick={() => void callAsof(asof.page + 1)} disabled={busy !== ""}>
                {busy === "more" ? "불러오는 중…" : `더 보기 (${asof.rows.length}/${asof.totalRows})`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
