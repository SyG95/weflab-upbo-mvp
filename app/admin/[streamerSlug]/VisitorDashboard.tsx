import Link from "next/link";
import { getVisitorDashboardData, type VisitorDashboardData } from "@/lib/adminVisitorData";
import { lockAdminOrVisitor } from "../visitorActions";
import styles from "./page.module.css";

const LOCKED_TABS = ["원본 룰렛 결과", "자동 판단 결과", "검토 필요", "업보시트 반영 상태", "🧪 확률표 vs 실제"];
const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function date(iso?: string): string {
  return iso ? DATE_FORMAT.format(new Date(iso)) : "—";
}

export default async function VisitorDashboard({ slug, tab }: { slug: string; tab?: string }) {
  const active = tab === "catalog" ? "catalog" : "collection";
  const result = await getVisitorDashboardData(slug);
  const title = result.ok ? result.data.displayName : "스트리머";
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div className={styles.titleBox}>
              <span className={styles.kicker}>검증실 · Verification Room</span>
              <h1 className={styles.title}>{title} 대시보드</h1>
            </div>
            <div className={styles.badges}>
              <Link className={styles.fanLink} href="/admin">← 목록</Link>
              <span className={`${styles.modeBadge} ${styles.modeLive}`}>LIVE</span>
              <span className={`${styles.modeBadge} ${styles.modeMock}`}>방문자 · 읽기 전용</span>
              {result.ok ? <Link className={styles.fanLink} href={`/${result.data.slug}`}>팬/업보시트 화면 →</Link> : null}
              <form action={lockAdminOrVisitor}>
                <input type="hidden" name="returnTo" value="/admin" />
                <button className={styles.lockBtn} type="submit">나가기 / 운영자 로그인</button>
              </form>
            </div>
          </div>
          <p className={styles.headNote}>실제 서비스의 수집 요약과 확률표 버전 현황입니다. 개인별 원본 기록과 운영 설정은 운영자 전용으로 잠겨 있어요.</p>
        </header>

        {!result.ok ? <section className={styles.panel}><p className={styles.blockHint}>{result.message}</p></section> : (
          <>
            <nav className={styles.tabs} aria-label="대시보드 탭">
              <Link className={active === "collection" ? styles.tabActive : styles.tab} aria-current={active === "collection" ? "page" : undefined} href={`/admin/${result.data.slug}`}>
                수집 현황 <span className={styles.tabCount}>{result.data.counts.batches}</span>
              </Link>
              <Link className={active === "catalog" ? styles.tabActive : styles.tab} aria-current={active === "catalog" ? "page" : undefined} href={`/admin/${result.data.slug}?tab=catalog`}>
                확률표 스냅샷 <span className={styles.tabCount}>{result.data.counts.catalogs}</span>
              </Link>
              {LOCKED_TABS.map((label) => <span key={label} className={`${styles.tab} ${styles.tabLocked}`} aria-disabled="true" title="운영자 전용 · 개인별 기록 포함">🔒 {label}</span>)}
            </nav>
            {tab && tab !== "collection" && tab !== "catalog" ? <div className={`${styles.callout} ${styles.calloutInfo}`}>요청한 탭은 운영자 전용입니다. 방문자에게 공개된 수집 현황을 보여드려요.</div> : null}
            <section className={styles.panel}>
              {active === "collection" ? <Collection data={result.data} /> : <Catalogs data={result.data} />}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className={styles.stat}><span className={styles.statValue}>{value.toLocaleString()}</span><span className={styles.statLabel}>{label}</span></div>;
}

function Collection({ data }: { data: VisitorDashboardData }) {
  return <div className={styles.stack}>
    <div className={styles.statGrid}>
      <Stat label="수집 배치" value={data.counts.batches} />
      <Stat label="확률표 버전" value={data.counts.catalogs} />
      <Stat label="저장된 업보 기록" value={data.counts.recordedEntries} />
    </div>
    <h2 className={styles.blockTitle}>최근 수집 배치 · 공식 저장 요약</h2>
    <p className={styles.blockHint}>수집 당시 저장한 요약을 최근 20건까지 보여드려요. 개인별 기록과 원본 데이터는 공개되지 않습니다. 시각은 한국 표준시(KST) 기준입니다.</p>
    {data.recentBatches.length === 0 ? <p className={styles.blockHint}>아직 수집된 배치가 없어요.</p> : <div className={styles.tableScroll} role="region" aria-label="최근 수집 배치" tabIndex={0}>
      <table className={styles.batchTable}>
        <thead><tr><th scope="col">반영 시각(KST)</th><th scope="col">확률표</th><th scope="col">전체</th><th scope="col">기록</th><th scope="col">제외</th><th scope="col">중복</th><th scope="col">검토</th><th scope="col">저장 행</th></tr></thead>
        <tbody>{data.recentBatches.map((b, i) => <tr key={`${b.appliedAt}-${i}`}><td>{date(b.appliedAt)}</td><td>v{b.catalogVersion}</td><td>{b.officialSummary.totalResults}</td><td>{b.officialSummary.recordCount}</td><td>{b.officialSummary.ignoreCount}</td><td>{b.officialSummary.duplicateCount}</td><td>{b.officialSummary.needsReviewCount}</td><td>{b.entryCount}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>;
}

function Catalogs({ data }: { data: VisitorDashboardData }) {
  return <div className={styles.stack}>
    <h2 className={styles.blockTitle}>확률표 버전 현황</h2>
    <p className={styles.blockHint}>현재 적용 버전: {data.currentCatalogVersion === null ? "미등록" : `v${data.currentCatalogVersion}`} · 기록 기준 확률 {data.thresholdPercent}% 이하. 최근 20개 버전의 수집 시각과 구성 수를 보여드려요.</p>
    {data.catalogs.length === 0 ? <p className={styles.blockHint}>아직 저장된 확률표가 없어요.</p> : <div className={styles.tableScroll} role="region" aria-label="확률표 버전 현황" tabIndex={0}>
      <table className={styles.batchTable}>
        <thead><tr><th scope="col">버전</th><th scope="col">적용 상태</th><th scope="col">수집 시각(KST)</th><th scope="col">그룹 수</th><th scope="col">항목 수</th></tr></thead>
        <tbody>{data.catalogs.map((c) => <tr key={c.version}><td>v{c.version}</td><td>{c.isCurrent ? "현재 적용" : "이전 버전"}</td><td>{date(c.capturedAt)}</td><td>{c.groupCount}</td><td>{c.itemCount}</td></tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
