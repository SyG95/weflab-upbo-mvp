import Link from "next/link";
import styles from "./admin-index.module.css";
import StreamerList from "./StreamerList";
import AddStreamerForm from "./AddStreamerForm";
import { getAdminIndex, type AdminIndexResult } from "@/lib/adminDashboard";
import { getMockAdminIndex } from "@/lib/adminDashboardMock";
import { adminAccessState } from "@/lib/adminAuth";
import { lockAdmin } from "./actions";
import AdminGate from "./AdminGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ mock?: string }> };

export default async function AdminIndexPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const isMock = sp.mock === "1";
  const returnTo = isMock ? "/admin?mock=1" : "/admin";

  const access = await adminAccessState();
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

  const result: AdminIndexResult = isMock
    ? { ok: true, streamers: getMockAdminIndex() }
    : await getAdminIndex();

  const total = result.ok ? result.streamers.length : 0;
  const needsAttention = result.ok ? result.streamers.filter((s) => s.needsReviewSum > 0).length : 0;
  const syncedRecently = result.ok ? countSyncedRecently(result.streamers) : 0;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div>
              <span className={styles.kicker}>업보 운영 콘솔 · Operations</span>
              <h1 className={styles.title}>스트리머 현황판</h1>
            </div>
            <div className={styles.badges}>
              {isMock ? (
                <span className={`${styles.modeBadge} ${styles.modeMock}`}>MOCK 데이터</span>
              ) : (
                <span className={`${styles.modeBadge} ${styles.modeLive}`}>LIVE</span>
              )}
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
            새 스트리머 개설(슬러그·토큰·비밀번호 발급)부터 수집 상태 확인, 비번 리셋·삭제까지 — 시트
            운영에 필요한 모든 걸 여기서 해요.
          </p>
        </header>

        {unconfigured ? (
          <div className={`${styles.callout} ${styles.calloutWarn}`}>
            🔓 <strong>접근 잠금 비활성</strong>(로컬, <code>UPBO_ADMIN_TOKEN</code> 미설정). 배포 시 Vercel
            환경변수에 설정하면 잠깁니다.
          </div>
        ) : null}

        {!result.ok ? (
          <Notice reason={result.reason} message={result.message} />
        ) : (
          <>
            {isMock ? null : <AddStreamerForm />}
            <div className={styles.statRow}>
              <span className={styles.statChip}>
                운영 중 시트 <b>{total}</b>
              </span>
              <span className={`${styles.statChip} ${styles.statChipOk}`}>
                48시간 내 동기화 <b>{syncedRecently}</b>
              </span>
              <span className={`${styles.statChip} ${needsAttention > 0 ? styles.statChipWarn : ""}`}>
                검토 필요 <b>{needsAttention}</b>
              </span>
            </div>
            <StreamerList streamers={result.streamers} isMock={isMock} />
          </>
        )}
      </div>
    </main>
  );
}

// 최근 48시간 안에 수집(동기화)이 들어온 시트 수 — 지금 살아 움직이는 시트가 몇 개인지.
function countSyncedRecently(streamers: { lastAppliedAt?: string }[]): number {
  const now = Date.now();
  return streamers.filter((s) => {
    if (!s.lastAppliedAt) return false;
    const t = new Date(s.lastAppliedAt).getTime();
    return Number.isFinite(t) && now - t <= 48 * 36e5;
  }).length;
}

function Notice({ reason, message }: { reason: "needs_env" | "error"; message?: string }) {
  const content =
    reason === "needs_env"
      ? {
          title: "환경 설정 필요",
          body: "Supabase 연결(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)이 설정되지 않았습니다.",
        }
      : { title: "불러오기 실패", body: message || "목록을 불러오지 못했습니다." };
  return (
    <div className={styles.notice}>
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      <p className={styles.noticeHint}>
        화면만 먼저 보려면{" "}
        <Link className={styles.inlineLink} href="/admin?mock=1">
          ?mock=1 샘플
        </Link>
        로 열 수 있어요.
      </p>
    </div>
  );
}
