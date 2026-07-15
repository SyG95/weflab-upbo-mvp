import Link from "next/link";
import styles from "./page.module.css";
import FilterableTable, { type Column, type Facet, type SortOption } from "./FilterableTable";
import {
  getAdminDashboardData,
  type AdminDashboardData,
  type AdminDashboardResult,
  type BatchView,
  type CatalogView,
} from "@/lib/adminDashboard";
import { getMockAdminDashboardData } from "@/lib/adminDashboardMock";
import {
  computeAccuracyStats,
  type Anomaly,
  type GroupAccuracy,
  type ItemAccuracy,
  type LuckRow,
} from "@/lib/accuracyStats";
import { adminAccessState } from "@/lib/adminAuth";
import { lockAdmin } from "../actions";
import AdminGate from "../AdminGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TabKey = "collection" | "catalog" | "raw" | "decisions" | "review" | "reflection" | "accuracy";

const TABS: { key: TabKey; label: string }[] = [
  { key: "collection", label: "수집 현황" },
  { key: "catalog", label: "확률표 스냅샷" },
  { key: "raw", label: "원본 룰렛 결과" },
  { key: "decisions", label: "자동 판단 결과" },
  { key: "review", label: "검토 필요" },
  { key: "reflection", label: "업보시트 반영 상태" },
  { key: "accuracy", label: "🧪 확률표 vs 실제" },
];

// 원본/판단/검토 탭은 raw_imports 재실행 결과(검증용 재현)임을 알리는 탭들.
const REDERIVED_TABS = new Set<TabKey>(["raw", "decisions", "review"]);

type PageProps = {
  params: Promise<{ streamerSlug: string }>;
  searchParams: Promise<{ tab?: string; mock?: string }>;
};

function fmtKst(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} KST`;
}

function tabHref(slug: string, tab: TabKey, isMock: boolean): string {
  const qs = new URLSearchParams();
  qs.set("tab", tab);
  if (isMock) qs.set("mock", "1");
  return `/admin/${slug}?${qs.toString()}`;
}

export default async function AdminDashboardPage({ params, searchParams }: PageProps) {
  const { streamerSlug } = await params;
  const sp = await searchParams;
  const isMock = sp.mock === "1";
  const activeTab: TabKey = TABS.find((t) => t.key === sp.tab)?.key ?? "collection";

  // 접근 잠금: 잠겨 있거나(배포+토큰미설정 포함) 인증 안 됐으면 데이터를 읽지 않고 게이트만 보여준다.
  const access = await adminAccessState();
  const returnTo = tabHref(streamerSlug, activeTab, isMock);
  if (access === "locked" || access === "blocked-unconfigured") {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <AdminGate returnTo={returnTo} blocked={access === "blocked-unconfigured"} />
        </div>
      </main>
    );
  }
  const unconfigured = access === "open-unconfigured";

  const result: AdminDashboardResult = isMock
    ? { ok: true, data: getMockAdminDashboardData(streamerSlug) }
    : await getAdminDashboardData(streamerSlug);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div className={styles.titleBox}>
              <span className={styles.kicker}>검증실 · Verification Room</span>
              <h1 className={styles.title}>{streamerSlug} 대시보드</h1>
            </div>
            <div className={styles.badges}>
              <Link className={styles.fanLink} href={isMock ? "/admin?mock=1" : "/admin"}>
                ← 목록
              </Link>
              {isMock ? (
                <span className={`${styles.modeBadge} ${styles.modeMock}`}>MOCK 데이터</span>
              ) : (
                <span className={`${styles.modeBadge} ${styles.modeLive}`}>LIVE</span>
              )}
              <Link className={styles.fanLink} href={`/${streamerSlug}`}>
                팬/업보시트 화면 →
              </Link>
              {access === "authed" ? (
                <form action={lockAdmin}>
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button className={styles.lockBtn} type="submit">
                    🔓 잠금
                  </button>
                </form>
              ) : null}
            </div>
          </div>
          <p className={styles.headNote}>
            위플랩 원본 수집 데이터와 업보 자동 판단을 한 화면에서 추적·검증합니다. 이 화면은{" "}
            <strong>읽기 전용</strong>이며 원본 데이터를 변경하지 않습니다.
          </p>
        </header>

        {unconfigured ? (
          <Callout tone="warn">
            🔓 <strong>접근 잠금이 비활성 상태</strong>입니다(로컬, <code>UPBO_ADMIN_TOKEN</code> 미설정). 배포
            시에는 Vercel 환경변수에 <code>UPBO_ADMIN_TOKEN</code> 을 설정해야 비밀번호 잠금이 켜집니다.
          </Callout>
        ) : null}

        {!result.ok ? (
          <StateNotice reason={result.reason} message={result.message} slug={streamerSlug} />
        ) : (
          <>
            {isMock ? (
              <Callout tone="warn">
                지금은 <strong>MOCK 데이터</strong>입니다(<code>?mock=1</code>). 화면·구조 검토용 샘플이며 실제
                판정 결과가 아닙니다.
              </Callout>
            ) : null}

            <nav className={styles.tabs} aria-label="대시보드 탭">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  className={t.key === activeTab ? styles.tabActive : styles.tab}
                  href={tabHref(streamerSlug, t.key, isMock)}
                >
                  {t.label}
                  <TabCount tab={t.key} data={result.data} />
                </Link>
              ))}
            </nav>

            {REDERIVED_TABS.has(activeTab) ? (
              <Callout tone="info">
                이 탭은 저장된 원본(<code>raw_imports</code>)을 <strong>현재 판단 로직으로 다시 돌린 검증용
                재현</strong>입니다. 당시 공식 판단이 아닙니다. 공식 기록은 <strong>수집 현황</strong>의 요약과{" "}
                <strong>업보시트 반영 상태</strong>(저장된 <code>upbo_entries</code>)입니다.
              </Callout>
            ) : null}

            <section className={styles.panel}>
              <TabContent tab={activeTab} data={result.data} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function TabCount({ tab, data }: { tab: TabKey; data: AdminDashboardData }) {
  const map: Record<TabKey, number> = {
    collection: data.counts.batches,
    catalog: data.counts.catalogs,
    raw: data.counts.rawResults,
    decisions: data.counts.record + data.counts.ignore + data.counts.duplicate + data.counts.needsReview,
    review: data.counts.needsReview,
    reflection: data.counts.reflections,
    accuracy: data.counts.reflections,
  };
  return <span className={styles.tabCount}>{map[tab]}</span>;
}

function TabContent({ tab, data }: { tab: TabKey; data: AdminDashboardData }) {
  switch (tab) {
    case "collection":
      return <CollectionTab data={data} />;
    case "catalog":
      return <CatalogTab data={data} />;
    case "raw":
      return <RawTab data={data} />;
    case "decisions":
      return <DecisionsTab data={data} />;
    case "review":
      return <ReviewTab data={data} />;
    case "reflection":
      return <ReflectionTab data={data} />;
    case "accuracy":
      return <AccuracyTab data={data} />;
    default:
      return null;
  }
}

/* ── 1. 수집 현황 ─────────────────────────────────────────── */
function CollectionTab({ data }: { data: AdminDashboardData }) {
  return (
    <div className={styles.stack}>
      <div className={styles.statGrid}>
        <Stat label="수집 배치" value={data.counts.batches} />
        <Stat label="확률표 버전" value={data.counts.catalogs} />
        <Stat label="원본 결과 row" value={data.counts.rawResults} />
        <Stat label="기록(record)" value={data.counts.record} accent />
        <Stat label="검토 필요" value={data.counts.needsReview} warn={data.counts.needsReview > 0} />
        <Stat label="업보시트 반영" value={data.counts.reflections} />
      </div>

      <h3 className={styles.blockTitle}>배치 목록 (공식 저장 기록)</h3>
      <p className={styles.blockHint}>
        아래 요약은 import 당시 저장된 공식 기록입니다. <strong>재현</strong> 열은 원본을 현재 로직으로 다시 돌린
        검증값으로, 일치하지 않으면 룰렛표/룰 변경 등을 점검할 신호입니다.
      </p>
      {data.batches.length === 0 ? (
        <p className={styles.blockHint}>아직 수집된 배치가 없어요.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.batchTable}>
            <thead>
              <tr>
                <th>반영 시각(KST)</th>
                <th>catalog</th>
                <th>확프</th>
                <th>기준</th>
                <th>전체</th>
                <th>기록</th>
                <th>제외</th>
                <th>중복</th>
                <th>검토</th>
                <th>재현 일치</th>
                <th>batchId</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <BatchRow key={b.id} batch={b} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BatchRow({ batch }: { batch: BatchView }) {
  const s = batch.officialSummary;
  return (
    <tr>
      <td>{fmtKst(batch.appliedAt)}</td>
      <td>
        <span className={styles.vtag}>v{batch.catalogVersion}</span>
      </td>
      <td>
        {batch.clientVersion ? (
          <code className={styles.monoInline} title="확프(확장) 버전">
            {batch.clientVersion}
          </code>
        ) : (
          "—"
        )}
      </td>
      <td>{batch.thresholdPercent}%</td>
      <td>{s.totalResults}</td>
      <td className={styles.cellRecord}>{s.recordCount}</td>
      <td>{s.ignoreCount}</td>
      <td>{s.duplicateCount}</td>
      <td className={s.needsReviewCount > 0 ? styles.cellReview : undefined}>{s.needsReviewCount}</td>
      <td>
        {!batch.rawAvailable ? (
          <span className={styles.reproNone} title="raw_imports 없음 — 재현 불가">
            원본 없음
          </span>
        ) : batch.summaryMatches ? (
          <span className={styles.reproOk}>일치</span>
        ) : (
          <span className={styles.reproDiff} title="재현 결과가 공식 요약과 다름">
            불일치
          </span>
        )}
      </td>
      <td>
        <code className={styles.monoInline} title={batch.id}>
          {batch.id}
        </code>
      </td>
    </tr>
  );
}

/* ── 2. 확률표 스냅샷 ─────────────────────────────────────── */
function CatalogTab({ data }: { data: AdminDashboardData }) {
  if (data.catalogs.length === 0) {
    return <p className={styles.blockHint}>아직 저장된 룰렛표 스냅샷이 없어요.</p>;
  }
  return (
    <div className={styles.stack}>
      {data.catalogs.map((c) => (
        <CatalogCard key={c.version} catalog={c} />
      ))}
    </div>
  );
}

function CatalogCard({ catalog }: { catalog: CatalogView }) {
  const isEmpty = catalog.itemCount === 0;
  return (
    <article className={`${styles.catalogCard} ${isEmpty ? styles.catalogEmpty : ""}`}>
      <div className={styles.catalogHead}>
        <span className={styles.vtag}>v{catalog.version}</span>
        {catalog.displayName ? <span className={styles.catalogName}>{catalog.displayName}</span> : null}
        {isEmpty ? (
          <span className={styles.tagWarn}>빈 버전 · 사용 안 함</span>
        ) : catalog.isCurrent ? (
          <span className={styles.tagActive}>현재 사용 중</span>
        ) : (
          <span className={styles.tagMuted}>이전 버전</span>
        )}
        <span className={styles.catalogMeta}>
          상품 {catalog.itemCount}개 · 그룹 {catalog.groupCount}개 · 캡처 {fmtKst(catalog.capturedAt)}
        </span>
      </div>

      {catalog.warnings.length > 0 ? (
        <ul className={styles.warnList}>
          {catalog.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}

      {isEmpty ? (
        <p className={styles.blockHint}>상품 0개. 읽기 실패/빈 저장 흔적이라 판별에 쓰지 않습니다.</p>
      ) : (
        <div className={styles.groupGrid}>
          {catalog.groups.map((g) => (
            <div key={g.groupIndex} className={styles.groupBox}>
              <div className={styles.groupTop}>
                <span className={styles.groupLabel}>{g.amountRangeLabel || `그룹 ${g.groupIndex}`}</span>
                {g.doubleEnabled ? <span className={styles.tagMuted}>두배 가능</span> : null}
                {!g.enabled ? <span className={styles.tagWarn}>비활성</span> : null}
              </div>
              <table className={styles.itemTable}>
                <tbody>
                  {g.items.map((it, i) => (
                    <tr key={`${it.itemName}-${i}`} className={!it.enabled ? styles.itemOff : undefined}>
                      <td>{it.itemName}</td>
                      <td className={styles.itemProb}>{it.probability}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* ── 3. 원본 룰렛 결과 ─────────────────────────────────────── */
function RawTab({ data }: { data: AdminDashboardData }) {
  if (!data.rederiveAvailable) return <RederiveUnavailable />;
  const rows = data.rawResults.map((r) => ({
    ...r,
    roulette: `${r.rouletteIndex + 1}/${r.rouletteTotal || 1}`,
  }));
  const columns: Column[] = [
    { key: "fanNickname", label: "닉네임" },
    { key: "fanId", label: "계정ID", kind: "mono" },
    { key: "itemName", label: "상품" },
    { key: "donationType", label: "후원유형" },
    { key: "donationAmount", label: "금액", kind: "num", align: "right" },
    { key: "donateTimeText", label: "후원시간(원문)" },
    { key: "roulette", label: "회차" },
    { key: "probability", label: "원본확률", kind: "percent", align: "right" },
    { key: "rawText", label: "원문 텍스트" },
    { key: "sourceKey", label: "sourceKey", kind: "mono" },
    { key: "batchId", label: "batchId", kind: "mono" },
  ];
  return (
    <FilterableTable
      rows={rows}
      columns={columns}
      searchKeys={["fanNickname", "fanId", "itemName", "sourceKey", "rawText"]}
      sortOptions={[
        { key: "donateTimeText", label: "후원시간" },
        { key: "donationAmount", label: "금액" },
        { key: "probability", label: "확률" },
      ]}
      emptyText="원본 룰렛 결과가 없어요."
    />
  );
}

/* ── 4. 자동 판단 결과 ─────────────────────────────────────── */
function DecisionsTab({ data }: { data: AdminDashboardData }) {
  if (!data.rederiveAvailable) return <RederiveUnavailable />;
  return <DecisionTable rows={data.decisions} withFacet emptyText="판단 결과가 없어요." />;
}

/* ── 5. 검토 필요 ─────────────────────────────────────────── */
function ReviewTab({ data }: { data: AdminDashboardData }) {
  if (!data.rederiveAvailable) return <RederiveUnavailable />;
  return (
    <div className={styles.stack}>
      <p className={styles.blockHint}>
        룰렛표에서 매칭되는 상품을 찾지 못한(<code>needs_review</code>) 결과입니다. 룰렛표 누락·오타·새 상품일 수
        있어 사람이 확인해야 합니다.
      </p>
      <DecisionTable rows={data.needsReview} emptyText="검토가 필요한 결과가 없어요. 👍" />
    </div>
  );
}

function DecisionTable({
  rows,
  withFacet,
  emptyText,
}: {
  rows: AdminDashboardData["decisions"];
  withFacet?: boolean;
  emptyText?: string;
}) {
  const mapped = rows.map((d) => ({
    ...d,
    catalogLabel: d.catalogVersion == null ? "—" : `v${d.catalogVersion}`,
    roulette: `${d.rouletteIndex + 1}/${d.rouletteTotal || 1}`,
    effective: d.multiplier > 1 ? `${d.effectiveCount} (×${d.multiplier})` : String(d.effectiveCount),
  }));
  const columns: Column[] = [
    { key: "decision", label: "판단", kind: "badge", width: "92px" },
    { key: "reason", label: "이유(reason)" },
    { key: "catalogLabel", label: "catalog" },
    { key: "fanNickname", label: "닉네임" },
    { key: "fanId", label: "계정ID", kind: "mono" },
    { key: "itemName", label: "상품" },
    { key: "amountRangeLabel", label: "룰렛세트" },
    { key: "probability", label: "확률", kind: "percent", align: "right" },
    { key: "effective", label: "유효수" },
    { key: "donateTimeText", label: "후원시간(원문)" },
    { key: "sourceKey", label: "sourceKey", kind: "mono" },
    { key: "batchId", label: "batchId", kind: "mono" },
  ];
  const facet: Facet | undefined = withFacet
    ? {
        label: "상태",
        key: "decision",
        options: [
          { value: "record", label: "기록(record)" },
          { value: "ignore", label: "제외(ignore)" },
          { value: "duplicate", label: "중복(duplicate)" },
          { value: "needs_review", label: "검토필요(needs_review)" },
        ],
      }
    : undefined;
  const sortOptions: SortOption[] = [
    { key: "probability", label: "확률" },
    { key: "donateTimeText", label: "후원시간" },
    { key: "decision", label: "판단상태" },
  ];
  return (
    <FilterableTable
      rows={mapped}
      columns={columns}
      searchKeys={["fanNickname", "fanId", "itemName", "sourceKey", "reason"]}
      facet={facet}
      sortOptions={sortOptions}
      emptyText={emptyText}
    />
  );
}

/* ── 6. 업보시트 반영 상태 ─────────────────────────────────── */
function ReflectionTab({ data }: { data: AdminDashboardData }) {
  const rows = data.reflections.map((r) => ({
    ...r,
    catalogLabel: r.catalogVersion == null ? "—" : `v${r.catalogVersion}`,
    effective: r.multiplier > 1 ? `${r.effectiveCount} (×${r.multiplier})` : String(r.effectiveCount),
  }));
  const columns: Column[] = [
    { key: "status", label: "반영상태", kind: "badge", width: "92px" },
    { key: "catalogLabel", label: "catalog" },
    { key: "fanNickname", label: "닉네임" },
    { key: "fanId", label: "계정ID", kind: "mono" },
    { key: "itemName", label: "상품" },
    { key: "amountRangeLabel", label: "룰렛세트" },
    { key: "probability", label: "확률", kind: "percent", align: "right" },
    { key: "effective", label: "유효수" },
    { key: "donateTimeText", label: "후원시간(원문)" },
    { key: "sourceKey", label: "sourceKey", kind: "mono" },
    { key: "batchId", label: "batchId", kind: "mono" },
  ];
  return (
    <div className={styles.stack}>
      <p className={styles.blockHint}>
        업보시트에 반영된 <strong>공식 저장 기록</strong>(<code>upbo_entries</code>)입니다. record로 채택된
        건만 들어오며, 상태(대기/완료/취소/숨김)로 배송 처리를 추적합니다.
      </p>
      <FilterableTable
        rows={rows}
        columns={columns}
        searchKeys={["fanNickname", "fanId", "itemName", "sourceKey"]}
        facet={{
          label: "상태",
          key: "status",
          options: [
            { value: "pending", label: "대기(pending)" },
            { value: "completed", label: "완료(completed)" },
            { value: "cancelled", label: "취소(cancelled)" },
            { value: "hidden", label: "숨김(hidden)" },
          ],
        }}
        sortOptions={[
          { key: "probability", label: "확률" },
          { key: "donateTimeText", label: "후원시간" },
          { key: "status", label: "상태" },
        ]}
        emptyText="아직 업보시트에 반영된 기록이 없어요."
      />

      {data.deliveryProgress.length > 0 ? (
        <>
          <h3 className={styles.blockTitle}>배송 진행 (참고)</h3>
          <div className={styles.tableScroll}>
            <table className={styles.batchTable}>
              <thead>
                <tr>
                  <th>닉네임</th>
                  <th>계정ID</th>
                  <th>상품</th>
                  <th>처리 수량</th>
                  <th>업데이트(KST)</th>
                </tr>
              </thead>
              <tbody>
                {data.deliveryProgress.map((d) => (
                  <tr key={`${d.fanId}-${d.itemKey}`}>
                    <td>{d.fanNickname}</td>
                    <td>
                      <code className={styles.monoInline}>{d.fanId}</code>
                    </td>
                    <td>{d.itemName}</td>
                    <td>{d.processedCount}</td>
                    <td>{fmtKst(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ── 7. 🧪 확률표 vs 실제 (베타) ──────────────────────────── */
function AccuracyTab({ data }: { data: AdminDashboardData }) {
  const stats = computeAccuracyStats(data);
  return (
    <div className={styles.stack}>
      <Callout tone="info">
        🧪 <strong>베타 · 실험 지표</strong>입니다. 반응을 보고 정식 기능으로 남기거나 뺄 수 있어요. 확률표(선언
        확률)와 실제 당첨 기록(<code>upbo_entries</code>)을 <strong>같은 금액대 안에서</strong> 견줍니다. 읽기
        전용이며 원본을 바꾸지 않습니다.
      </Callout>

      {!stats.available ? (
        <p className={styles.blockHint}>
          {stats.totalDrops === 0
            ? "아직 당첨 기록(upbo_entries)이 없어 비교할 수 없어요. 결과가 수집·반영되면 여기에서 확률표와 견줍니다."
            : "현재 확률표와 금액대가 맞는 당첨 기록이 없어 비교할 수 없어요. 확률표 버전/금액대 라벨을 확인해 주세요."}
        </p>
      ) : (
        <>
          <div className={styles.statGrid}>
            <Stat label="총 당첨 드롭" value={stats.totalDrops} />
            <Stat label="비교된 드롭" value={stats.matchedDrops} accent />
            <Stat label="금액대 밖(비교 제외)" value={stats.unmatchedDrops} warn={stats.unmatchedDrops > 0} />
          </div>
          <p className={styles.blockHint}>
            확률표 <strong>v{stats.catalogVersion}</strong> 기준. 표본(드롭 수)이 작을수록 실제율은 크게 출렁여요 —
            아래 각 세트의 <strong>표본 n</strong>을 꼭 함께 보세요. 소수 표본의 큰 편차는 조작이 아니라 우연일 수
            있습니다.
          </p>

          <AnomalyBanner anomalies={stats.anomalies} />

          {stats.groups.map((group) => (
            <AccGroupCard key={group.label} group={group} />
          ))}

          <h3 className={styles.blockTitle}>행운 순위 (잘 뜬 / 아쉬운 후원자)</h3>
          <p className={styles.blockHint}>
            뽑은 상품들의 <strong>평균 당첨확률</strong>이 낮을수록 귀한 걸 뽑은 거예요(운 좋음 🍀). 표본이 적으면
            운빨이 크니 <strong>드롭 수</strong>도 같이 보세요.
          </p>
          <LuckTable rows={stats.luck} />
        </>
      )}
    </div>
  );
}

function AnomalyBanner({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return (
      <div className={`${styles.callout} ${styles.calloutInfo}`}>
        ✅ <strong>확률표와 유의하게 다른 항목은 아직 없어요.</strong> (표본이 충분한 항목만 판정하며, 소표본은 판단을
        보류합니다.)
      </div>
    );
  }
  return (
    <div className={styles.anomalyBox}>
      <div className={styles.anomalyTitle}>
        ⚠️ 확률표와 크게 다른 항목 <strong>{anomalies.length}개</strong>
        <span className={styles.anomalyTitleSub}>표본이 충분한데도 우연으로 보기 어려운 차이</span>
      </div>
      <ul className={styles.anomalyList}>
        {anomalies.map((a) => (
          <li key={`${a.groupLabel}-${a.itemName}`} className={styles.anomalyItem}>
            <span className={`${styles.anomalyDir} ${a.direction === "high" ? styles.anomalyHigh : styles.anomalyLow}`}>
              {a.direction === "high" ? "▲ 많이 뜸" : "▼ 덜 뜸"}
            </span>
            <span className={styles.anomalyText}>
              <strong>{a.groupLabel} 세트 · {a.itemName}</strong> — 확률표 {a.declaredProb.toFixed(1)}%인데 실제{" "}
              {a.actualPct.toFixed(1)}% ({a.actualCount}/{a.totalDrops}회) · z={a.zScore.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.anomalyFoot}>
        z는 확률표대로일 때의 기대와 얼마나 벗어났는지예요(|z|≥2면 우연 확률 5% 미만). 확률표 오입력·업데이트 누락·
        수집 편향 등을 점검할 신호이며, 그 자체가 조작의 증거는 아닙니다.
      </p>
    </div>
  );
}

function AccGroupCard({ group }: { group: GroupAccuracy }) {
  const scaleMax = Math.max(
    1,
    ...group.items.map((it) => Math.max(it.declaredProb, it.actualPct)),
    ...group.unlisted.map((it) => it.actualPct),
  );
  const small = group.totalDrops < 20;
  return (
    <article className={styles.accCard}>
      <div className={styles.accHead}>
        <span className={styles.accLabel}>{group.label} 세트</span>
        <span className={`${styles.accSample} ${small ? styles.accSampleSmall : ""}`}>
          표본 n={group.totalDrops}
          {small ? " · 적음(편차 참고만)" : ""}
        </span>
      </div>
      <div className={styles.accLegend}>
        <span>
          <i className={styles.accSwatchDeclared} /> 확률표(선언)
        </span>
        <span>
          <i className={styles.accSwatchActual} /> 실제 당첨률
        </span>
      </div>
      <div className={styles.accItems}>
        {group.items.map((it) => (
          <AccItemRow key={it.itemName} item={it} scaleMax={scaleMax} />
        ))}
        {group.unlisted.map((it) => (
          <AccItemRow key={`x-${it.itemName}`} item={it} scaleMax={scaleMax} unlisted />
        ))}
      </div>
    </article>
  );
}

function AccItemRow({
  item,
  scaleMax,
  unlisted,
}: {
  item: ItemAccuracy;
  scaleMax: number;
  unlisted?: boolean;
}) {
  const dev = item.deviation;
  const devKind = Math.abs(dev) < 1 ? "flat" : dev > 0 ? "up" : "down";
  return (
    <div className={styles.accItem}>
      <div className={styles.accItemTop}>
        <span className={styles.accItemName}>
          {item.itemName}
          {unlisted ? <span className={styles.accUnlisted}>확률표 없음</span> : null}
        </span>
        <span className={styles.accItemNums}>
          {unlisted ? (
            <span className={styles.accActualNum}>실제 {item.actualPct.toFixed(1)}%</span>
          ) : (
            <>
              <span className={styles.accDeclaredNum}>선언 {item.declaredProb.toFixed(1)}%</span>
              <span className={styles.accActualNum}>실제 {item.actualPct.toFixed(1)}%</span>
              <span className={`${styles.accDev} ${styles[`accDev_${devKind}`]}`}>
                {devKind === "flat" ? "≈ 비슷" : `${dev > 0 ? "▲+" : "▼"}${Math.abs(dev).toFixed(1)}%p`}
              </span>
              {item.verdict === "high" || item.verdict === "low" ? (
                <span className={styles.accFlag} title={`z=${item.zScore.toFixed(1)} · 표본 충분 + 유의`}>
                  ⚠ 이상
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>
      {!unlisted ? (
        <div className={styles.accBarTrack}>
          <div className={styles.accBarDeclared} style={{ width: `${(item.declaredProb / scaleMax) * 100}%` }} />
        </div>
      ) : null}
      <div className={styles.accBarTrack}>
        <div className={styles.accBarActual} style={{ width: `${(item.actualPct / scaleMax) * 100}%` }} />
      </div>
      <span className={styles.accItemCount}>실제 {item.actualCount}회</span>
    </div>
  );
}

function LuckTable({ rows }: { rows: LuckRow[] }) {
  if (rows.length === 0) {
    return <p className={styles.blockHint}>확률이 있는 당첨 기록이 없어 행운 순위를 낼 수 없어요.</p>;
  }
  const shown = rows.slice(0, 15);
  const third = Math.max(1, Math.ceil(rows.length / 3));
  return (
    <div className={styles.tableScroll}>
      <table className={styles.batchTable}>
        <thead>
          <tr>
            <th>순위</th>
            <th>닉네임</th>
            <th>계정ID</th>
            <th>드롭 수</th>
            <th>평균 당첨확률</th>
            <th>가장 귀한 한 방</th>
            <th>행운</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => {
            const rank = index + 1;
            const badge = rank <= third ? "🍀" : rank > rows.length - third ? "💧" : "·";
            return (
              <tr key={row.fanKey}>
                <td>{rank}</td>
                <td>{row.fanNickname}</td>
                <td>
                  <code className={styles.monoInline}>{row.fanId || "—"}</code>
                </td>
                <td>{row.drops}</td>
                <td className={styles.luckProb}>{row.avgProb.toFixed(1)}%</td>
                <td>
                  {row.rarest ? (
                    <span>
                      {row.rarest.itemName} <span className={styles.luckRareProb}>({row.rarest.prob.toFixed(1)}%)</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={styles.luckBadge}>{badge}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── 공용 ─────────────────────────────────────────────────── */
function RederiveUnavailable() {
  return (
    <Callout tone="warn">
      이 스트리머는 저장된 원본(<code>raw_imports</code>)이 없어 원본/판단/검토를 재현할 수 없습니다. 공식 요약은{" "}
      <strong>수집 현황</strong>, 반영 기록은 <strong>업보시트 반영 상태</strong> 탭에서 확인하세요.
    </Callout>
  );
}

function StateNotice({
  reason,
  message,
  slug,
}: {
  reason: "needs_env" | "notfound" | "error";
  message?: string;
  slug: string;
}) {
  const content =
    reason === "needs_env"
      ? {
          title: "환경 설정 필요",
          body: "Supabase 연결(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)이 설정되지 않았습니다. 정식 데이터를 보려면 환경 변수를 설정하세요.",
        }
      : reason === "notfound"
        ? {
            title: "데이터 없음",
            body: `'${slug}' 스트리머 데이터가 아직 없어요. Extension으로 룰렛표와 결과를 먼저 수집해야 표시됩니다.`,
          }
        : {
            title: "불러오기 실패",
            body: message || "대시보드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.",
          };
  return (
    <div className={styles.notice}>
      <span className={styles.noticeStamp}>대기</span>
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      <p className={styles.noticeHint}>
        화면/구조만 먼저 보려면{" "}
        <Link className={styles.inlineLink} href={`/admin/${slug}?mock=1`}>
          ?mock=1 샘플
        </Link>
        로 열 수 있습니다.
      </p>
    </div>
  );
}

function Callout({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  return <div className={`${styles.callout} ${tone === "warn" ? styles.calloutWarn : styles.calloutInfo}`}>{children}</div>;
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={`${styles.stat} ${warn ? styles.statWarn : ""}`}>
      <span className={accent ? styles.statValueAccent : styles.statValue}>{value.toLocaleString()}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
