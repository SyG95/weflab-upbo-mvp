"use client";

// 후원 원장 대시보드 — 첫 행동은 "기간 선택"이고, 그 기간의 열혈(1위)과 순위 원장을 읽는다.
// donation_events 집계만 조회하며 업보 기록과는 완전히 분리돼 있다(교차 참조 없음).
// 시간 축은 전부 위플랩 서버 기준(KST, +09:00)으로 고정한다.

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./donations.module.css";

type RankingRow = {
  fanKey: string;
  fanId: string | null;
  fanNickname: string | null;
  amountSum: number;
  eventCount: number;
  lastDonationAt: string | null;
};

type MissionSettlementRow = { kind: "대결" | "도전" | "미션"; missionName: string | null; amount: number; at: string | null };
type RouletteAmountRow = { amount: number; eventCount: number; amountSum: number };

type Summary = {
  totals: { amountSum: number; eventCount: number; fanCount: number; unknownTimeCount: number };
  subscription: { monthsSum: number; eventCount: number; fanCount: number; rankings: RankingRow[] };
  missionSuccess: { amountSum: number; eventCount: number; list: MissionSettlementRow[] };
  receiptTotal: { amountSum: number; generalAmount: number; missionAmount: number };
  rouletteAmounts: RouletteAmountRow[];
  collectedRange: { first: string | null; last: string | null };
  rankings: RankingRow[];
};

type PresetId = "today" | "week" | "month" | "all";
type TabId = "total" | "roulette" | "mission";
const MAX_TABLE_ROWS = 50;

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "total", label: "총후원" },
  { id: "roulette", label: "룰렛" },
  { id: "mission", label: "도전·대결미션" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// 기간 입력은 연/월/일/시/분을 각각 타이핑한다. 전부 위플랩 서버 기준(KST)으로 해석.
type DateParts = { y: number; mo: number; d: number; h: number; mi: number };

// epoch(ms) → KST 달력 조각. +9시간 밀고 UTC 게터로 읽으면 KST 값이 된다.
function epochToParts(epochMs: number): DateParts {
  const s = new Date(epochMs + 9 * 3600_000);
  return {
    y: s.getUTCFullYear(),
    mo: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    h: s.getUTCHours(),
    mi: s.getUTCMinutes(),
  };
}

function nowParts(): DateParts {
  return epochToParts(Date.now());
}

function todayStartParts(): DateParts {
  return { ...nowParts(), h: 0, mi: 0 };
}

function monthStartParts(): DateParts {
  return { ...nowParts(), d: 1, h: 0, mi: 0 };
}

function weekAgoParts(): DateParts {
  return epochToParts(Date.now() - 7 * 86_400_000);
}

// KST 조각 → ISO(+09:00). 잘못된 달력(2월 30일 등)·범위 밖 값은 null.
function partsToIso(p: DateParts): string | null {
  const { y, mo, d, h, mi } = p;
  if (![y, mo, d, h, mi].every((n) => Number.isInteger(n))) return null;
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  // KST 달력값을 UTC epoch로: Date.UTC 로 만든 뒤 9시간 뒤로. round-trip 으로 유효 날짜 검증.
  const utc = Date.UTC(y, mo - 1, d, h, mi) - 9 * 3600_000;
  const back = new Date(utc + 9 * 3600_000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+09:00`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtKst(iso: string | null): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed
    .toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/\. /g, ".")
    .replace(/\.,?\s*/g, ". ")
    .trim();
}

// 표의 좁은 시각 열용 짧은 포맷: "26.06.14 05:48" (한 줄, 열 안 깨짐).
function fmtKstShort(iso: string | null): string {
  if (!iso) return "-";
  const p = new Date(iso);
  if (Number.isNaN(p.getTime())) return "-";
  const k = epochToParts(p.getTime());
  return `${String(k.y).slice(2)}.${pad(k.mo)}.${pad(k.d)} ${pad(k.h)}:${pad(k.mi)}`;
}

// 숫자 카운트업 — 기간을 바꿀 때마다 0에서 목표값까지 차오른다(대시보드 보는맛).
// 움직임 줄이기(prefers-reduced-motion) 설정이면 즉시 최종값을 보여준다.
function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    const apply = (n: number) => {
      shownRef.current = n;
      setShown(n);
    };
    if (from === to) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      apply(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{fmtNum(shown)}</>;
}

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "today", label: "오늘" },
  { id: "week", label: "최근 7일" },
  { id: "month", label: "이번 달" },
  { id: "all", label: "전체 누적" },
];

export default function DonationDashboard({ slug }: { slug: string }) {
  const [preset, setPreset] = useState<PresetId | "custom">("month");
  // 기본값 = 현재 KST 기준 이번 달(1일 00:00 ~ 지금). 기간 칸은 절대 비어 있지 않다(sy 요청).
  const [range, setRange] = useState<{ from: string | null; to: string | null }>(() => ({
    from: partsToIso(monthStartParts()),
    to: null,
  }));
  const [fromParts, setFromParts] = useState<DateParts>(() => monthStartParts());
  const [toParts, setToParts] = useState<DateParts>(() => nowParts());
  const [activeTab, setActiveTab] = useState<TabId>("total");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const query = params.toString();
    fetch(`/api/s/${encodeURIComponent(slug)}/donation-summary${query ? `?${query}` : ""}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body as Summary);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message || "집계를 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug, range.from, range.to, reloadTick]);

  // 로딩 표시는 기간을 바꾸는 행동(핸들러)에서 켠다 — effect 안 동기 setState 금지 규칙 준수.
  // 프리셋을 누르면 아래 날짜 칸도 그 기간으로 채워져서 "지금 보는 기간"이 항상 보인다.
  const pickPreset = useCallback((id: PresetId) => {
    setLoading(true);
    setError(null);
    setPreset(id);
    const nowP = nowParts();
    setToParts(nowP);
    if (id === "today") {
      const p = todayStartParts();
      setFromParts(p);
      setRange({ from: partsToIso(p), to: null });
    } else if (id === "week") {
      const p = weekAgoParts();
      setFromParts(p);
      setRange({ from: partsToIso(p), to: null });
    } else if (id === "month") {
      const p = monthStartParts();
      setFromParts(p);
      setRange({ from: partsToIso(p), to: null });
    } else {
      // 전체 누적: 조회는 무제한(null), 칸은 마지막 값 유지(다시 커스텀 편집할 때 이어서).
      setRange({ from: null, to: null });
    }
  }, []);

  const applyCustom = useCallback(() => {
    const from = partsToIso(fromParts);
    const to = partsToIso(toParts);
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    setPreset("custom");
    setRange({ from, to });
  }, [fromParts, toParts]);

  const customValid = partsToIso(fromParts) !== null && partsToIso(toParts) !== null;

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadTick((t) => t + 1);
  }, []);

  const totals = data?.totals;
  const subscription = data?.subscription;
  const rankings = data?.rankings ?? [];
  const podium = rankings.slice(0, 3); // 상위 3명 = 시상대
  const tableRows = rankings.slice(3, MAX_TABLE_ROWS); // 4위부터 표
  const subRows = (subscription?.rankings ?? []).slice(0, MAX_TABLE_ROWS);
  const hasAnyData = Boolean(totals && (totals.eventCount > 0 || (subscription?.eventCount ?? 0) > 0));
  const totalSum = totals?.amountSum || 0;
  const sharePct = (value: number) => (totalSum > 0 ? ((value / totalSum) * 100).toFixed(1) : "0.0");

  // "그 외 N명" — 시상대(3) + 표에 안 보이는 나머지. 시상대+표+그외 = 100%가 되게.
  const shownAmount = [...podium, ...tableRows].reduce((sum, r) => sum + r.amountSum, 0);
  const othersCount = Math.max(0, (totals?.fanCount ?? 0) - podium.length - tableRows.length);
  const othersAmount = Math.max(0, totalSum - shownAmount);
  const othersBar = totalSum > 0 ? Math.max(2, Math.round((othersAmount / totalSum) * 100)) : 0;

  // 지금 보고 있는 기간을 사람이 읽는 한 줄로.
  const activeRangeText =
    preset === "all" || (!range.from && !range.to)
      ? "전체 누적"
      : `${range.from ? fmtKst(range.from) : "처음"} ~ ${range.to ? fmtKst(range.to) : "지금"}`;

  return (
    <>
      <section className={styles.periodPanel} aria-label="기간 선택">
        <div className={styles.presetRow} role="group" aria-label="기간 프리셋">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={preset === p.id ? `${styles.presetBtn} ${styles.presetActive}` : styles.presetBtn}
              onClick={() => pickPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.rangeRow}>
          <DateTimeField label="시작" parts={fromParts} onChange={setFromParts} />
          <span className={styles.rangeTilde}>~</span>
          <DateTimeField label="끝" parts={toParts} onChange={setToParts} />
          <button type="button" className={styles.customApply} onClick={applyCustom} disabled={!customValid}>
            적용
          </button>
        </div>
        <p className={styles.activeRange}>
          <span className={styles.activeRangeLabel}>보는 기간</span> {activeRangeText}
        </p>
        <p className={styles.evidence}>
          수집 범위 {fmtKst(data?.collectedRange.first ?? null)} ~ {fmtKst(data?.collectedRange.last ?? null)}
          {totals && totals.unknownTimeCount > 0 ? (
            <span className={styles.evidenceWarn}>
              {" · "}시간 해석 실패 {fmtNum(totals.unknownTimeCount)}건은 기간 필터에서 제외됩니다
            </span>
          ) : null}
        </p>
      </section>

      <div className={styles.tabBar} role="tablist" aria-label="후원집계 보기">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? `${styles.tabBtn} ${styles.tabActive}` : styles.tabBtn}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <section className={styles.stateCard} aria-label="불러오는 중">
          <div className={styles.skeleton} style={{ width: "100%" }}>
            <div className={styles.skelBar} style={{ width: "42%" }} />
            <div className={styles.skelBar} style={{ width: "88%" }} />
            <div className={styles.skelBar} style={{ width: "76%" }} />
            <div className={styles.skelBar} style={{ width: "82%" }} />
          </div>
        </section>
      ) : error ? (
        <section className={styles.stateCard} aria-label="오류">
          <h2 className={styles.stateTitle}>집계를 불러오지 못했어요</h2>
          <p className={styles.stateDesc}>{error}</p>
          <button type="button" className={styles.retryBtn} onClick={retry}>
            다시 시도
          </button>
        </section>
      ) : activeTab === "roulette" ? (
        <RouletteTab
          slug={slug}
          from={range.from}
          to={range.to}
          amounts={data?.rouletteAmounts ?? []}
          reloadKey={reloadTick}
          overallEventCount={totals?.eventCount ?? 0}
        />
      ) : activeTab === "mission" ? (
        <MissionTab summary={data?.missionSuccess} />
      ) : !totals || !hasAnyData ? (
        <section className={styles.stateCard} aria-label="데이터 없음">
          <h2 className={styles.stateTitle}>
            {data?.collectedRange.first ? "이 기간에는 수집된 후원이 없어요" : "아직 수집된 후원이 없어요"}
          </h2>
          <p className={styles.stateDesc}>
            {data?.collectedRange.first
              ? "다른 기간을 선택하거나 전체 누적으로 확인해 보세요."
              : "후원 수집기(후원집계 전용 확장)가 켜져 있고 확장 토큰이 맞는지 확인해 주세요. 수집이 시작되면 여기에서 바로 집계됩니다."}
          </p>
        </section>
      ) : (
        <>
          <section className={styles.summaryStrip} aria-label="기간 요약">
            <div className={`${styles.sumCell} ${styles.sumHero}`}>
              <span className={styles.sumLabel}>별풍선 합계</span>
              <span className={styles.sumValue}>
                <AnimatedNumber value={totals.amountSum} />
                <span className={styles.sumUnit}>개</span>
              </span>
            </div>
            <div className={styles.sumCell}>
              <span className={styles.sumLabel}>후원 건수</span>
              <span className={styles.sumValue}>
                <AnimatedNumber value={totals.eventCount} duration={700} />
                <span className={styles.sumUnit}>건</span>
              </span>
            </div>
            <div className={styles.sumCell}>
              <span className={styles.sumLabel}>참여 계정</span>
              <span className={styles.sumValue}>
                <AnimatedNumber value={totals.fanCount} duration={600} />
                <span className={styles.sumUnit}>명</span>
              </span>
            </div>
          </section>

          {data && data.receiptTotal.missionAmount > 0 ? (
            <section className={styles.receiptCard} aria-label="스트리머 실수령">
              <div className={styles.receiptMain}>
                <span className={styles.receiptLabel}>스트리머 실수령 총계</span>
                <span className={styles.receiptValue}>
                  <AnimatedNumber value={data.receiptTotal.amountSum} />
                  <span className={styles.sumUnit}>개</span>
                </span>
              </div>
              <p className={styles.receiptBreak}>
                일반 후원 {fmtNum(data.receiptTotal.generalAmount)}개 + 미션 정산{" "}
                {fmtNum(data.receiptTotal.missionAmount)}개
              </p>
              <p className={styles.receiptNote}>
                위 &lsquo;별풍선 합계&rsquo;는 시청자가 우리 방에서 실제 쏜 순위 기준이고, 이건 미션 배분까지
                반영한 실제 받은 별풍선이에요. 미션에 넣은 개인 후원은 정산으로 돌아오므로 여기선 한 번만 셉니다.
              </p>
            </section>
          ) : null}

          {podium.length > 0 ? (
            <section className={styles.podiumCard} aria-label="후원 순위 상위 3명">
              <div className={styles.podium} data-count={podium.length}>
                {[1, 0, 2].map((slot) => {
                  const row = podium[slot];
                  if (!row) return <div key={slot} className={styles.podiumEmpty} aria-hidden="true" />;
                  const rank = slot + 1;
                  return (
                    <div
                      key={row.fanKey}
                      className={`${styles.podiumCol} ${styles[`podiumRank${rank}`]}`}
                    >
                      {rank === 1 ? <span className={styles.podiumBadge}>후원 1등</span> : null}
                      <p className={styles.podiumName}>{row.fanNickname || row.fanKey}</p>
                      {row.fanId ? <p className={styles.podiumId}>({row.fanId})</p> : null}
                      <p className={styles.podiumSum}>{fmtNum(row.amountSum)}개</p>
                      <div className={styles.podiumBar}>
                        <span className={styles.podiumRankNum}>{rank}</span>
                        <span className={styles.podiumBarMeta}>
                          {fmtNum(row.eventCount)}건 · {sharePct(row.amountSum)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {tableRows.length > 0 ? (
            <section className={styles.ledgerCard} aria-label="후원 순위 4위부터">
              <table className={styles.ledgerTable}>
                <thead>
                  <tr>
                    <th className={styles.thRank}>순위</th>
                    <th>시청자</th>
                    <th className={styles.thSum}>합계(개)</th>
                    <th className={styles.thCount}>후원 건수</th>
                    <th className={styles.thShare}>비중</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, index) => {
                    const rank = index + 4;
                    const tableMax = tableRows[0]?.amountSum || 1;
                    const barPct = Math.max(3, Math.round((row.amountSum / tableMax) * 100));
                    return (
                      <tr key={row.fanKey}>
                        <td>
                          <span className={styles.rankNum}>{rank}</span>
                        </td>
                        <td className={styles.fanCell}>
                          <span className={styles.fanName}>{row.fanNickname || row.fanKey}</span>
                          {row.fanId ? <span className={styles.fanId}>({row.fanId})</span> : null}
                        </td>
                        <td className={styles.numCell}>{fmtNum(row.amountSum)}</td>
                        <td className={styles.countCell}>{fmtNum(row.eventCount)}</td>
                        <td>
                          <div className={styles.shareCell}>
                            <div className={styles.shareTrack} style={{ flex: 1 }}>
                              <div
                                className={styles.shareFill}
                                style={{ width: `${barPct}%`, animationDelay: `${Math.min(index * 35, 420)}ms` }}
                              />
                            </div>
                            <span className={styles.sharePct}>{sharePct(row.amountSum)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {othersCount > 0 ? (
                    <tr className={styles.othersRow}>
                      <td />
                      <td className={styles.fanCell}>그 외 {fmtNum(othersCount)}명</td>
                      <td className={styles.numCell}>{fmtNum(othersAmount)}</td>
                      <td className={styles.countCell}>—</td>
                      <td>
                        <div className={styles.shareCell}>
                          <div className={styles.shareTrack} style={{ flex: 1 }}>
                            <div
                              className={styles.shareFillMuted}
                              style={{ width: `${othersBar}%`, animationDelay: `${Math.min(tableRows.length * 35, 455)}ms` }}
                            />
                          </div>
                          <span className={styles.sharePct}>{sharePct(othersAmount)}%</span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className={styles.ledgerFoot}>
                시상대 3명 + 표 {fmtNum(tableRows.length)}명 + 그 외를 더하면 전체 {fmtNum(totals.fanCount)}명 · 100%
              </p>
            </section>
          ) : null}

          {subscription && subscription.eventCount > 0 ? (
            <section className={styles.subCard} aria-label="구독 집계">
              <div className={styles.subHead}>
                <span className={styles.subBadge}>구독</span>
                <p className={styles.subNote}>
                  구독은 단위가 별풍선(개)이 아니라 개월이라 위 순위와 분리해서 셉니다. 개월은 알림마다
                  더한 값이 아니라 가장 최근 알림에 찍힌 &ldquo;지금 몇 개월째&rdquo;입니다(쉬었다 다시
                  구독하면 1부터 다시 셉니다).
                </p>
              </div>
              <div className={styles.subTotals}>
                <span>
                  현재 합 <b>{fmtNum(subscription.monthsSum)}</b>개월
                </span>
                <span>
                  <b>{fmtNum(subscription.eventCount)}</b>건
                </span>
                <span>
                  <b>{fmtNum(subscription.fanCount)}</b>명
                </span>
              </div>
              {subRows.length > 0 ? (
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th className={styles.thRank}>순위</th>
                      <th>시청자</th>
                      <th className={styles.thSum}>현재 개월</th>
                      <th className={styles.thCount}>건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subRows.map((row, index) => {
                      const rank = index + 1;
                      return (
                        <tr key={row.fanKey}>
                          <td>
                            <span className={rank <= 3 ? `${styles.rankNum} ${styles.rankTop}` : styles.rankNum}>
                              {rank}
                            </span>
                          </td>
                          <td className={styles.fanCell}>
                            <span className={styles.fanName}>{row.fanNickname || row.fanKey}</span>
                            {row.fanId ? <span className={styles.fanId}>({row.fanId})</span> : null}
                          </td>
                          <td className={styles.numCell}>{fmtNum(row.amountSum)}</td>
                          <td className={styles.countCell}>{fmtNum(row.eventCount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : null}
            </section>
          ) : null}

          <LabGate title="실험실">
            <BetaLab
              slug={slug}
              from={range.from}
              to={range.to}
              reloadKey={reloadTick}
              rankings={rankings}
              totals={totals}
            />
          </LabGate>
        </>
      )}
    </>
  );
}

// ---------- 🧪 실험실(베타) ----------
// 이 아래 지표들은 시험용이다. 반응을 보고 정식으로 남기거나 뺀다(sy 지침 2026-07-09).
// 전부 지금 화면의 순위 데이터로 클라이언트에서 계산하며, 순위 변동만 "직전 같은 길이 기간"을
// 한 번 더 조회해 비교한다. 서버/집계 로직(donationEvents.ts)은 건드리지 않는다.

type StyleKind = "한방형" | "꾸준형" | "균형";

// 직전 같은 길이 기간의 순위 맵(fanKey → 순위). 전체 누적/무기간이면 비교 없음.
// 상태는 effect 안 동기 setState 없이 요청키로 파생한다(이 파일의 기존 규칙과 동일).
function usePreviousRankMap(slug: string, from: string | null, to: string | null, reloadKey: number) {
  // 비교 가능 여부만 순수 판정한다(now 읽기는 effect로). from 있고 유효하며,
  // to 가 있으면 to>from 이어야 한다. to 가 없으면(프리셋=지금까지) 항상 비교 가능.
  const canCompare = useMemo(() => {
    if (!from) return false;
    const fromMs = Date.parse(from);
    if (!Number.isFinite(fromMs)) return false;
    if (to) {
      const toMs = Date.parse(to);
      if (!Number.isFinite(toMs) || toMs <= fromMs) return false;
    }
    return true;
  }, [from, to]);

  const reqKey = canCompare ? `${from}|${to ?? "now"}|${reloadKey}` : "";
  const [result, setResult] = useState<{ key: string; map: Map<string, number>; ok: boolean } | null>(null);

  useEffect(() => {
    if (!canCompare || !from) return;
    const fromMs = Date.parse(from);
    const toMs = to ? Date.parse(to) : Date.now();
    if (!Number.isFinite(toMs) || toMs <= fromMs) return;
    const span = toMs - fromMs;
    const prevFrom = new Date(fromMs - span).toISOString();
    const prevTo = new Date(fromMs).toISOString();
    const controller = new AbortController();
    const params = new URLSearchParams({ from: prevFrom, to: prevTo });
    fetch(`/api/s/${encodeURIComponent(slug)}/donation-summary?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) throw new Error("prev fetch failed");
        const next = new Map<string, number>();
        (body.rankings as RankingRow[] | undefined)?.forEach((row, i) => next.set(row.fanKey, i + 1));
        setResult({ key: reqKey, map: next, ok: true });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setResult({ key: reqKey, map: new Map(), ok: false });
      });
    return () => controller.abort();
  }, [slug, canCompare, from, to, reqKey]);

  let status: "none" | "loading" | "ready" | "empty";
  let map: Map<string, number> | null = null;
  if (!canCompare) status = "none";
  else if (!result || result.key !== reqKey) status = "loading";
  else if (!result.ok) status = "none";
  else {
    map = result.map;
    status = result.map.size > 0 ? "ready" : "empty";
  }
  return { map, status };
}

// 후원 스타일: 평균 단가가 높고 횟수가 적으면 한방형, 그 반대면 꾸준형, 애매하면 균형.
function classifyStyle(avg: number, count: number, refAvg: number, refCount: number): StyleKind {
  if (avg >= refAvg * 1.25 && count <= refCount) return "한방형";
  if (count >= refCount * 1.25 && avg <= refAvg) return "꾸준형";
  return "균형";
}

const STYLE_META: Record<StyleKind, { emoji: string; dot: string }> = {
  한방형: { emoji: "💥", dot: "dotHit" },
  꾸준형: { emoji: "🌱", dot: "dotSteady" },
  균형: { emoji: "⚖️", dot: "dotBalanced" },
};

// 실험실 열쇠 잠금. 스트리머가 열쇠("open")를 입력하면 실험실이 열리고, 브라우저에 기억된다.
// 보안 목적이 아니라(이 페이지는 이미 비밀번호 뒤에 있음) 실험 기능을 기본으로 숨겨두고
// 궁금한 사람만 열쇠로 열어보게 하는 소프트 게이트. 두 실험실이 같은 열쇠로 함께 열린다.
const LAB_KEY = "open";
const LAB_STORAGE_KEY = "upbo_lab_open";
const LAB_UNLOCK_EVENT = "upbo-lab-unlock";

function useLabUnlock(): { unlocked: boolean; unlock: () => void; relock: () => void } {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setUnlocked(window.localStorage.getItem(LAB_STORAGE_KEY) === "1");
      } catch {
        setUnlocked(false);
      }
    };
    read();
    window.addEventListener(LAB_UNLOCK_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(LAB_UNLOCK_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const unlock = useCallback(() => {
    try {
      window.localStorage.setItem(LAB_STORAGE_KEY, "1");
    } catch {
      // 저장 실패해도 이번 세션은 열어준다.
    }
    window.dispatchEvent(new Event(LAB_UNLOCK_EVENT));
  }, []);
  const relock = useCallback(() => {
    try {
      window.localStorage.removeItem(LAB_STORAGE_KEY);
    } catch {
      // noop
    }
    window.dispatchEvent(new Event(LAB_UNLOCK_EVENT));
  }, []);
  return { unlocked, unlock, relock };
}

// 실험실을 감싸는 열쇠 게이트. 잠겨 있으면 열쇠 입력칸만, 열리면 내용 + 다시 잠그기 버튼.
function LabGate({ title, children }: { title: string; children: ReactNode }) {
  const { unlocked, unlock, relock } = useLabUnlock();
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) {
    return (
      <div className={styles.labWrap}>
        {children}
        <button type="button" className={styles.labRelock} onClick={relock}>
          🔒 실험실 다시 잠그기
        </button>
      </div>
    );
  }

  const submit = () => {
    if (keyInput.trim().toLowerCase() === LAB_KEY) {
      setError(false);
      unlock();
    } else {
      setError(true);
    }
  };

  return (
    <section className={styles.labLocked} aria-label={`${title} 잠김`}>
      <div className={styles.labLockedHead}>
        <span className={styles.labLockedTag}>🧪 {title} · 잠김</span>
        <p className={styles.labLockedText}>실험 지표 모음이에요. 열쇠를 입력하면 열려요.</p>
      </div>
      <div className={styles.labKeyRow}>
        <input
          className={error ? `${styles.labKeyInput} ${styles.labKeyInputErr}` : styles.labKeyInput}
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="열쇠"
          aria-label={`${title} 열쇠`}
        />
        <button type="button" className={styles.labKeyBtn} onClick={submit}>
          열기
        </button>
      </div>
      {error ? <p className={styles.labKeyErr}>열쇠가 맞지 않아요.</p> : null}
    </section>
  );
}

function BetaLab({
  slug,
  from,
  to,
  reloadKey,
  rankings,
  totals,
}: {
  slug: string;
  from: string | null;
  to: string | null;
  reloadKey: number;
  rankings: RankingRow[];
  totals: Summary["totals"];
}) {
  const { map: prevRank, status: prevStatus } = usePreviousRankMap(slug, from, to, reloadKey);

  const totalSum = totals.amountSum || 0;
  const top3 = rankings.slice(0, 3);
  const top3Sum = top3.reduce((sum, row) => sum + row.amountSum, 0);
  const concentration = totalSum > 0 ? (top3Sum / totalSum) * 100 : 0;
  const unitAvg = totals.eventCount > 0 ? totals.amountSum / totals.eventCount : 0;

  // 산점도·스타일 분류용 상위 7명.
  const shown = rankings.slice(0, 7).map((row) => ({
    ...row,
    avg: row.eventCount > 0 ? row.amountSum / row.eventCount : 0,
  }));
  const refAvg = unitAvg || 1;
  const counts = shown.map((row) => row.eventCount).sort((a, b) => a - b);
  const refCount = counts.length ? counts[Math.floor(counts.length / 2)] : 1;

  // 산점도 좌표계(SVG). x=후원 건수, y=평균 단가.
  const W = 320;
  const H = 172;
  const PAD = 30;
  const xMax = Math.max(...shown.map((row) => row.eventCount), 1);
  const yMax = Math.max(...shown.map((row) => row.avg), 1);
  const px = (v: number) => PAD + (v / xMax) * (W - PAD * 2);
  const py = (v: number) => H - PAD - (v / yMax) * (H - PAD * 2);

  const raceMax = top3[0]?.amountSum || 1;

  return (
    <section className={styles.betaLab} aria-label="실험실 베타 지표">
      <div className={styles.betaBanner}>
        <span className={styles.betaTag}>🧪 실험실 · 베타</span>
        <span className={styles.betaBannerLead}>같은 후원 데이터를 여러 각도로 본 실험 지표</span>
      </div>
      <div className={styles.betaBody}>
        <p className={styles.betaBannerText}>
          아래 지표들은 <b>시험 중</b>이에요. 반응을 보고 정식 기능으로 남기거나 뺄 수 있어요.
        </p>

      {/* 1) 핵심 수식 2개 + 집중도 게이지 */}
      <section className={styles.betaCard} aria-label="핵심 수식과 집중도">
        <div className={styles.betaHead}>
          <h3 className={styles.betaTitle}>한눈 수식</h3>
          <p className={styles.betaSub}>합계를 건수·인원으로 나눠 성격을 본다</p>
        </div>
        <div className={styles.formulaGrid}>
          <div className={styles.formulaTile}>
            <span className={styles.formulaLabel}>평균 후원 단가</span>
            <span className={styles.formulaExpr}>
              별풍선 <b>{fmtNum(totals.amountSum)}</b> ÷ 건수 <b>{fmtNum(totals.eventCount)}</b>
            </span>
            <span className={styles.formulaResult}>
              {fmtNum(unitAvg)}
              <span className={styles.formulaUnit}>개/건</span>
            </span>
          </div>
          <div className={styles.formulaTile}>
            <span className={styles.formulaLabel}>1인당 평균</span>
            <span className={styles.formulaExpr}>
              별풍선 <b>{fmtNum(totals.amountSum)}</b> ÷ 인원 <b>{fmtNum(totals.fanCount)}</b>
            </span>
            <span className={styles.formulaResult}>
              {fmtNum(totals.fanCount > 0 ? totals.amountSum / totals.fanCount : 0)}
              <span className={styles.formulaUnit}>개/명</span>
            </span>
          </div>
        </div>
        <div className={styles.gaugeRow}>
          <div
            className={styles.gaugeRing}
            style={{ ["--pct" as string]: concentration.toFixed(1) }}
            role="img"
            aria-label={`상위 3명 집중도 ${concentration.toFixed(1)}퍼센트`}
          >
            <div className={styles.gaugeCenter}>
              <span className={styles.gaugePct}>{concentration.toFixed(0)}%</span>
              <span className={styles.gaugeCap}>상위 3명</span>
            </div>
          </div>
          <p className={styles.gaugeNote}>
            상위 3명 <b>{fmtNum(top3Sum)}</b>개 ÷ 전체 <b>{fmtNum(totalSum)}</b>개 = <b>{concentration.toFixed(1)}%</b>.
            {concentration >= 60
              ? " 소수 큰손에 쏠려 있어요 — 이들이 빠지면 타격이 커요."
              : " 여러 명에게 고르게 퍼져 있어요."}
          </p>
        </div>
      </section>

      {/* 2) 추격 대결 미터 */}
      {top3.length >= 2 ? (
        <section className={styles.betaCard} aria-label="상위 추격 대결">
          <div className={styles.betaHead}>
            <h3 className={styles.betaTitle}>추격 대결</h3>
            <p className={styles.betaSub}>1위까지 얼마나 따라왔나</p>
          </div>
          <div className={styles.race}>
            {top3.map((row, index) => {
              const pct = Math.max(4, (row.amountSum / raceMax) * 100);
              const ahead = index > 0 ? top3[index - 1] : null;
              const gap = ahead ? ahead.amountSum - row.amountSum : 0;
              const catchPct = ahead && ahead.amountSum > 0 ? (row.amountSum / ahead.amountSum) * 100 : 100;
              return (
                <div key={row.fanKey} className={styles.raceRow}>
                  <div className={styles.raceTop}>
                    <span className={styles.raceName}>
                      {index + 1}. {row.fanNickname || row.fanKey}
                    </span>
                    <span className={styles.raceAmt}>{fmtNum(row.amountSum)}개</span>
                  </div>
                  <div className={styles.raceTrack}>
                    <div
                      className={styles.raceFill}
                      style={{ width: `${pct}%`, animationDelay: `${index * 90}ms` }}
                    />
                  </div>
                  {ahead ? (
                    <span className={styles.raceGap}>
                      {index}위까지 <b>{fmtNum(gap)}</b>개 남음 · {catchPct.toFixed(1)}% 지점
                    </span>
                  ) : (
                    <span className={styles.raceGap}>선두</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* 3) 순위 변동 */}
      <section className={styles.betaCard} aria-label="순위 변동">
        <div className={styles.betaHead}>
          <h3 className={styles.betaTitle}>순위 변동</h3>
          <p className={styles.betaSub}>직전 같은 길이 기간 대비 ▲오름 ▼내림 NEW신규</p>
        </div>
        {prevStatus === "ready" ? (
          <div className={styles.deltaList}>
            {shown.map((row, index) => {
              const cur = index + 1;
              const prev = prevRank?.get(row.fanKey);
              let mark: ReactNode;
              if (prev === undefined) {
                mark = <span className={styles.deltaNew}>NEW</span>;
              } else {
                const move = prev - cur;
                if (move > 0) mark = <span className={`${styles.deltaMark} ${styles.deltaUp}`}>▲ {move}</span>;
                else if (move < 0) mark = <span className={`${styles.deltaMark} ${styles.deltaDown}`}>▼ {-move}</span>;
                else mark = <span className={`${styles.deltaMark} ${styles.deltaFlat}`}>—</span>;
              }
              return (
                <div key={row.fanKey} className={styles.deltaItem}>
                  <span className={styles.deltaRankNow}>{cur}</span>
                  <span className={styles.deltaName}>{row.fanNickname || row.fanKey}</span>
                  {mark}
                </div>
              );
            })}
          </div>
        ) : prevStatus === "loading" ? (
          <p className={styles.deltaMuted}>직전 기간과 비교하는 중…</p>
        ) : prevStatus === "empty" ? (
          <p className={styles.deltaMuted}>직전 같은 길이 기간엔 후원이 없어 비교할 게 없어요.</p>
        ) : (
          <p className={styles.deltaMuted}>
            전체 누적은 직전 기간 비교가 없어요. 기간(오늘·이번 달 등)을 고르면 순위 변동이 표시됩니다.
          </p>
        )}
      </section>

      {/* 4) 후원 스타일 산점도 */}
      {shown.length >= 3 ? (
        <section className={styles.betaCard} aria-label="후원 스타일 산점도">
          <div className={styles.betaHead}>
            <h3 className={styles.betaTitle}>후원 스타일</h3>
            <p className={styles.betaSub}>가로=후원 횟수, 세로=평균 단가</p>
          </div>
          <div className={styles.scatterWrap}>
            <svg className={styles.scatterSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="후원 스타일 분포">
              <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} className={styles.scatterAxis} />
              <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} className={styles.scatterAxis} />
              <text x={W - PAD} y={H - PAD + 16} className={styles.scatterAxisLabel} textAnchor="end">
                후원 횟수 →
              </text>
              <text x={PAD - 6} y={PAD - 10} className={styles.scatterAxisLabel} textAnchor="start">
                ↑ 평균 단가
              </text>
              {shown.map((row, index) => {
                const style = classifyStyle(row.avg, row.eventCount, refAvg, refCount);
                return (
                  <g key={row.fanKey}>
                    <circle cx={px(row.eventCount)} cy={py(row.avg)} r={9} className={styles[STYLE_META[style].dot]} />
                    <text x={px(row.eventCount)} y={py(row.avg) + 3.5} className={styles.scatterDotNum} textAnchor="middle">
                      {index + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className={styles.scatterLegend}>
              <span className={styles.styleBadge}>💥 한방형 — 크게 한 번</span>
              <span className={styles.styleBadge}>🌱 꾸준형 — 자주 조금씩</span>
              <span className={styles.styleBadge}>⚖️ 균형</span>
            </div>
          </div>
        </section>
      ) : null}
      </div>
    </section>
  );
}

// 연/월/일/시/분을 각각 숫자로 타이핑하는 기간 입력 칸(브라우저 달력 대신, 모바일 숫자패드).
function DateTimeField({
  label,
  parts,
  onChange,
}: {
  label: string;
  parts: DateParts;
  onChange: (next: DateParts) => void;
}) {
  const invalid = partsToIso(parts) === null;
  const set = (key: keyof DateParts) => (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    onChange({ ...parts, [key]: digits === "" ? Number.NaN : Number(digits) });
  };
  return (
    <span className={invalid ? `${styles.dtField} ${styles.dtFieldInvalid}` : styles.dtField}>
      <DtCell width={40} unit="년" max={2100} aria={`${label} 연도`} value={parts.y} onSet={set("y")} />
      <DtCell width={22} unit="월" max={12} aria={`${label} 월`} value={parts.mo} onSet={set("mo")} />
      <DtCell width={22} unit="일" max={31} aria={`${label} 일`} value={parts.d} onSet={set("d")} />
      <span className={styles.dtGap} />
      <DtCell width={22} unit="" max={23} aria={`${label} 시`} value={parts.h} onSet={set("h")} padded />
      <span className={styles.dtColon}>:</span>
      <DtCell width={22} unit="" max={59} aria={`${label} 분`} value={parts.mi} onSet={set("mi")} padded />
    </span>
  );
}

// 시:분 칸은 평소엔 "05"처럼 두 자리로 보여주고, 고치는 동안에만 타이핑한 숫자를 그대로 둔다.
function DtCell({
  width,
  unit,
  max,
  aria,
  value,
  onSet,
  padded,
}: {
  width: number;
  unit: string;
  max: number;
  aria: string;
  value: number;
  onSet: (raw: string) => void;
  padded?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const display = Number.isNaN(value) ? "" : padded && !editing ? pad(value) : String(value);
  return (
    <span className={styles.dtCell}>
      <input
        className={styles.dtInput}
        style={{ width }}
        inputMode="numeric"
        value={display}
        onChange={(e) => onSet(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        maxLength={String(max).length}
        aria-label={aria}
      />
      {unit ? <span className={styles.dtUnit}>{unit}</span> : null}
    </span>
  );
}

// 룰렛 실험실(베타) — 후원 레인 데이터(has_roulette + 베팅 갯수)만으로 만드는 "베팅 행동" 통계.
// ⚠ 룰렛의 "결과(무엇이 떴는지)"는 이 레인에 없다(업보 파이프라인 소관). 그래서 확률표 대비 실제
//   당첨률·잘뜬/못뜬 같은 결과 기반 통계는 여기서 만들지 않는다(sy에 별도 결정사항으로 보고).
const DIST_SEGS = ["seg0", "seg1", "seg2", "seg3", "seg4"];

function RouletteLab({
  amounts,
  overallEventCount,
}: {
  amounts: RouletteAmountRow[];
  overallEventCount: number;
}) {
  const totalSpins = amounts.reduce((sum, row) => sum + row.eventCount, 0);
  const totalStars = amounts.reduce((sum, row) => sum + row.amountSum, 0);
  const avgBet = totalSpins > 0 ? totalStars / totalSpins : 0;
  const spinRate = overallEventCount > 0 ? Math.min(100, (totalSpins / overallEventCount) * 100) : 0;
  const oneInEvery = totalSpins > 0 ? overallEventCount / totalSpins : 0;

  // 베팅 금액 구성: 스핀 많은 순 상위 5 + 나머지 "기타".
  const sorted = [...amounts].sort((a, b) => b.eventCount - a.eventCount);
  const top = sorted.slice(0, 5);
  const restCount = sorted.slice(5).reduce((sum, row) => sum + row.eventCount, 0);
  const segs = top.map((row, index) => ({
    key: String(row.amount),
    label: `${fmtNum(row.amount)}개`,
    count: row.eventCount,
    pct: totalSpins > 0 ? (row.eventCount / totalSpins) * 100 : 0,
    seg: DIST_SEGS[Math.min(index, 4)],
  }));
  if (restCount > 0) {
    segs.push({
      key: "기타",
      label: "기타",
      count: restCount,
      pct: totalSpins > 0 ? (restCount / totalSpins) * 100 : 0,
      seg: DIST_SEGS[4],
    });
  }

  if (totalSpins === 0) return null;

  return (
    <section className={styles.betaLab} aria-label="룰렛 실험실 베타 지표">
      <div className={styles.betaBanner}>
        <span className={styles.betaTag}>🧪 룰렛 실험실 · 베타</span>
        <span className={styles.betaBannerLead}>룰렛 베팅 통계를 여러 각도로</span>
      </div>
      <div className={styles.betaBody}>
        <p className={styles.betaBannerText}>
          시험 중이에요. 여긴 <b>후원 갯수·룰렛 여부</b>로 만드는 베팅 통계예요. 룰렛의 <b>당첨 결과</b>(무엇이 떴는지)는
          이 후원집계엔 없어서, 확률표 대비 실제 당첨률은 여기서 다루지 않아요.
        </p>

        {/* R1) 룰렛 요약 수식 + 발생률 게이지 */}
        <section className={styles.betaCard} aria-label="룰렛 요약 수식">
          <div className={styles.betaHead}>
            <h3 className={styles.betaTitle}>룰렛 한눈 수식</h3>
            <p className={styles.betaSub}>스핀·베팅을 나눠 본다</p>
          </div>
          <div className={styles.formulaGrid}>
            <div className={styles.formulaTile}>
              <span className={styles.formulaLabel}>총 룰렛 스핀</span>
              <span className={styles.formulaExpr}>모든 갯수 합</span>
              <span className={styles.formulaResult}>
                {fmtNum(totalSpins)}
                <span className={styles.formulaUnit}>회</span>
              </span>
            </div>
            <div className={styles.formulaTile}>
              <span className={styles.formulaLabel}>평균 베팅</span>
              <span className={styles.formulaExpr}>
                별풍선 <b>{fmtNum(totalStars)}</b> ÷ 스핀 <b>{fmtNum(totalSpins)}</b>
              </span>
              <span className={styles.formulaResult}>
                {fmtNum(avgBet)}
                <span className={styles.formulaUnit}>개/스핀</span>
              </span>
            </div>
          </div>
          <div className={styles.gaugeRow}>
            <div
              className={styles.gaugeRing}
              style={{ ["--pct" as string]: spinRate.toFixed(1) }}
              role="img"
              aria-label={`룰렛 발생률 ${spinRate.toFixed(1)}퍼센트`}
            >
              <div className={styles.gaugeCenter}>
                <span className={styles.gaugePct}>{spinRate.toFixed(0)}%</span>
                <span className={styles.gaugeCap}>룰렛 발생</span>
              </div>
            </div>
            <p className={styles.gaugeNote}>
              룰렛 스핀 <b>{fmtNum(totalSpins)}</b>회 ÷ 전체 후원 <b>{fmtNum(overallEventCount)}</b>건 ={" "}
              <b>{spinRate.toFixed(1)}%</b>.
              {oneInEvery >= 1 ? ` 이 방 후원 ${oneInEvery.toFixed(1)}건 중 1건에서 룰렛이 돌았어요.` : ""}
            </p>
          </div>
        </section>

        {/* R2) 베팅 금액 구성(100% 스택 막대) */}
        <section className={styles.betaCard} aria-label="베팅 금액 구성">
          <div className={styles.betaHead}>
            <h3 className={styles.betaTitle}>베팅 금액 구성</h3>
            <p className={styles.betaSub}>어떤 갯수로 많이 돌렸나 (스핀 기준 비율)</p>
          </div>
          <div className={styles.distBar}>
            {segs.map((seg) => (
              <div
                key={seg.key}
                className={`${styles.distSeg} ${styles[seg.seg]}`}
                style={{ width: `${Math.max(seg.pct, 1)}%` }}
                title={`${seg.label} ${seg.pct.toFixed(1)}%`}
              />
            ))}
          </div>
          <div className={styles.distLegend}>
            {segs.map((seg) => (
              <div key={seg.key} className={styles.distRow}>
                <span className={`${styles.distSwatch} ${styles[seg.seg]}`} />
                <span className={styles.distLabel}>{seg.label}</span>
                <span className={styles.distVal}>
                  {fmtNum(seg.count)}회 · {seg.pct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

// CSV 한 칸. 쉼표·따옴표·줄바꿈은 따옴표로 감싸고, =·+·-·@ 로 시작하는 닉네임은
// 엑셀이 수식으로 읽지 않게 앞에 ' 를 붙인다.
function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// KST 날짜만 "2026-10-21" — 파일 이름용.
function kstDate(iso: string | null): string {
  const k = epochToParts(iso ? new Date(iso).getTime() : Date.now());
  return `${k.y}-${pad(k.mo)}-${pad(k.d)}`;
}

// 룰렛 순위를 엑셀에서 바로 열리는 CSV로 내려받는다. 화면(50명)과 달리 전원을 담는다.
// 계정ID 칸은 넣지 않는다(sy 결정 2026-10-21: 파일이 밖으로 돌아도 ID가 안 나가게).
function downloadRouletteCsv(slug: string, rows: RankingRow[], from: string | null, to: string | null, selectedKey: string) {
  const lines = [["순위", "닉네임", "합계(개)", "룰렛 횟수", "마지막 룰렛 시각"].map(csvCell).join(",")];
  rows.forEach((row, index) => {
    const at = row.lastDonationAt ? epochToParts(new Date(row.lastDonationAt).getTime()) : null;
    lines.push(
      [
        index + 1,
        row.fanNickname || "(닉네임 없음)",
        row.amountSum,
        row.eventCount,
        at ? `${at.y}-${pad(at.mo)}-${pad(at.d)} ${pad(at.h)}:${pad(at.mi)}` : "",
      ]
        .map(csvCell)
        .join(","),
    );
  });
  const amountLabel = selectedKey ? `${selectedKey.replace(/,/g, "+")}개` : "전체";
  const periodLabel = !from && !to ? "전체기간" : `${from ? kstDate(from) : "처음"}~${kstDate(to)}`;
  // 맨 앞 BOM = 엑셀이 한글을 UTF-8로 읽게 하는 표시.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}_룰렛_${amountLabel}_${periodLabel}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari 는 바로 해제하면 다운로드가 취소될 수 있어 늦춰서 해제.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// 룰렛 탭 — 이 스트리머가 실제로 룰렛을 돌린 후원 갯수 목록을 칩으로 보여주고,
// 고른 갯수의 계정별 순위(룰렛 횟수)를 보여준다. 개인후원과 무관하게 has_roulette=true만.
function RouletteTab({
  slug,
  from,
  to,
  amounts,
  reloadKey,
  overallEventCount,
}: {
  slug: string;
  from: string | null;
  to: string | null;
  amounts: RouletteAmountRow[];
  reloadKey: number;
  overallEventCount: number;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedKey = [...selected].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("rouletteOnly", "1");
    if (selectedKey) params.set("amounts", selectedKey);
    fetch(`/api/s/${encodeURIComponent(slug)}/donation-summary?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${res.status}`);
        setData(body as Summary);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message || "룰렛 집계를 불러오지 못했습니다.");
      })
      // 칩을 연달아 누르면 앞 요청이 취소된다. 취소된 요청이 로딩을 끄면 옛 표·옛 파일이 새 이름표로 보이므로 무시.
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, from, to, selectedKey, reloadKey]);

  const toggle = (amount: number) => {
    setLoading(true);
    setSelected((prev) => (prev.includes(amount) ? prev.filter((a) => a !== amount) : [...prev, amount]));
  };

  const totals = data?.totals;
  const rows = (data?.rankings ?? []).slice(0, MAX_TABLE_ROWS);

  if (amounts.length === 0) {
    return (
      <section className={styles.stateCard} aria-label="룰렛 없음">
        <h2 className={styles.stateTitle}>이 기간에 룰렛 기록이 없어요</h2>
        <p className={styles.stateDesc}>룰렛이 돌아간 후원이 수집되면 갯수별로 여기에 표시됩니다.</p>
      </section>
    );
  }

  return (
    <>
      <section className={styles.condCard} aria-label="룰렛 갯수 선택">
        <p className={styles.rouletteHint}>
          룰렛이 돌아간 후원 갯수예요. 여러 개 고르면 합쳐서 봅니다. 안 고르면 전체 룰렛 후원을 셉니다.
        </p>
        <div className={styles.condChips}>
          {amounts.map((row) => {
            const on = selected.includes(row.amount);
            return (
              <button
                key={row.amount}
                type="button"
                className={on ? `${styles.rouletteChip} ${styles.rouletteChipOn}` : styles.rouletteChip}
                onClick={() => toggle(row.amount)}
                aria-pressed={on}
              >
                {fmtNum(row.amount)}개 <span className={styles.rouletteChipCount}>{fmtNum(row.eventCount)}회</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.ledgerCard} aria-label="룰렛 순위">
        <div className={styles.condHead}>
          <span className={styles.condBadge}>{selectedKey ? `${selectedKey.replace(/,/g, "+")}개` : "전체 룰렛"}</span>
          {loading ? (
            <span className={styles.condMeta}>불러오는 중…</span>
          ) : error ? (
            <span className={styles.condError}>{error}</span>
          ) : totals ? (
            <span className={styles.condMeta}>
              총 <b>{fmtNum(totals.amountSum)}</b>개 · 룰렛 <b>{fmtNum(totals.eventCount)}</b>회 ·{" "}
              <b>{fmtNum(totals.fanCount)}</b>명
            </span>
          ) : null}
          {!loading && !error && totals && totals.eventCount > 0 ? (
            <button
              type="button"
              className={styles.exportBtn}
              onClick={() => downloadRouletteCsv(slug, data?.rankings ?? [], from, to, selectedKey)}
            >
              엑셀로 받기
            </button>
          ) : null}
        </div>
        {!loading && !error && totals ? (
          totals.eventCount === 0 ? (
            <p className={styles.condEmpty}>이 조건에 해당하는 룰렛 후원이 없어요.</p>
          ) : (
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th className={styles.thRank}>순위</th>
                  <th>시청자</th>
                  <th className={styles.thSum}>합계(개)</th>
                  <th className={styles.thCount}>룰렛 횟수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rank = index + 1;
                  return (
                    <tr key={row.fanKey}>
                      <td>
                        <span className={rank <= 3 ? `${styles.rankNum} ${styles.rankTop}` : styles.rankNum}>{rank}</span>
                      </td>
                      <td className={styles.fanCell}>
                        <span className={styles.fanName}>{row.fanNickname || row.fanKey}</span>
                        {row.fanId ? <span className={styles.fanId}>({row.fanId})</span> : null}
                      </td>
                      <td className={styles.numCell}>{fmtNum(row.amountSum)}</td>
                      <td className={styles.countCell}>{fmtNum(row.eventCount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : null}
      </section>

      <LabGate title="룰렛 실험실">
        <RouletteLab amounts={amounts} overallEventCount={overallEventCount} />
      </LabGate>
    </>
  );
}

// 도전·대결미션 탭 — 성공한 미션 목록(종류·미션명·수령·시각). 미션별 후원자 세부는 위플랩 구조상 불가.
function MissionTab({ summary }: { summary?: Summary["missionSuccess"] }) {
  if (!summary || summary.list.length === 0) {
    return (
      <section className={styles.stateCard} aria-label="미션 없음">
        <h2 className={styles.stateTitle}>이 기간에 미션 정산이 없어요</h2>
        <p className={styles.stateDesc}>대결·도전미션이 성공하면 배분받은 별풍선이 여기에 표시됩니다.</p>
      </section>
    );
  }
  return (
    <section className={styles.subCard} aria-label="미션 정산">
      <div className={styles.subHead}>
        <span className={styles.subBadge}>미션 정산</span>
        <p className={styles.subNote}>
          대결·도전미션 성공 시 배분받은 별풍선. 시청자 순위와 무관한 독립 기록이에요. 대결미션은 다른 방
          후원이 섞여 개인 기록으로는 알 수 없는 값입니다. (미션별 후원자 세부는 위플랩 구조상 제공 안 됨)
        </p>
      </div>
      <div className={styles.subTotals}>
        <span>
          총 <b>{fmtNum(summary.amountSum)}</b>개
        </span>
        <span>
          <b>{fmtNum(summary.eventCount)}</b>건
        </span>
      </div>
      <table className={styles.ledgerTable}>
        <thead>
          <tr>
            <th className={styles.thKind}>종류</th>
            <th>미션</th>
            <th className={styles.thSum}>수령(개)</th>
            <th className={styles.thTime}>시각</th>
          </tr>
        </thead>
        <tbody>
          {summary.list.map((row, index) => (
            <tr key={`${row.kind}-${row.missionName}-${row.at}-${index}`}>
              <td>
                <span className={row.kind === "대결" ? `${styles.missionKind} ${styles.missionVs}` : styles.missionKind}>
                  {row.kind}
                </span>
              </td>
              <td className={styles.fanCell}>
                <span className={styles.fanName}>{row.missionName || "이름 없음"}</span>
              </td>
              <td className={styles.numCell}>{fmtNum(row.amount)}</td>
              <td className={styles.timeCell}>{fmtKstShort(row.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
