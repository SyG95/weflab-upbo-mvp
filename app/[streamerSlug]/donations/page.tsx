// 후원집계(후원 원장) — 업보시트 관리자 화면에서 진입하는 관리자 전용 페이지.
// 업보시트 관리자 비밀번호와 별도의 전용 비밀번호(UPBO_DONATION_ADMIN_PIN)로 잠근다.
// 데이터는 donation_events 집계만 사용하며 업보 기록과는 완전히 분리돼 있다.

import type { CSSProperties } from "react";
import { donationAdminAccessState } from "@/lib/donationAdminAuth";
import { getStreamerRowBySlug } from "@/lib/upboSupabase";
import { resolveTheme } from "@/lib/themes";
import ThemeLiveBackground from "../ThemeLiveBackground";
import DonationGate from "./DonationGate";
import DonationDashboard from "./DonationDashboard";
import DonationPasswordForm from "./DonationPasswordForm";
import styles from "./donations.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ streamerSlug: string }>;
  searchParams: Promise<{ theme?: string }>;
};

export default async function DonationsPage({ params, searchParams }: PageProps) {
  const { streamerSlug } = await params;
  const { theme: themePreview } = await searchParams;
  const access = await donationAdminAccessState(streamerSlug);
  const locked = access === "locked" || access === "blocked-unconfigured";

  // 후원집계 화면도 스트리머가 고른 테마(팬 시트와 같은 accent_color 프리셋)를 입는다.
  // 스트리머 조회 실패(로컬 무 Supabase 등)는 기본 테마로 폴백. ?theme= 로 미리보기 가능.
  const savedThemeId = await getStreamerRowBySlug(streamerSlug)
    .then((row) => row.accent_color ?? undefined)
    .catch(() => undefined);
  const theme = resolveTheme(themePreview || savedThemeId);
  const themeStyle = theme.vars as CSSProperties;

  return (
    <main
      className={styles.page}
      style={themeStyle}
      data-fx={theme.fx?.background}
      data-glass={theme.fx?.glass ? "1" : undefined}
    >
      <ThemeLiveBackground fx={theme.fx?.background} palette={theme.fx?.nebulaPalette} />
      <div className={styles.shell}>
        <header className={styles.cover}>
          <div>
            <p className={styles.kicker}>후원 원장 · 관리자 전용</p>
            <h1 className={styles.title}>{streamerSlug} 후원집계</h1>
          </div>
          <a className={styles.backLink} href={`/${streamerSlug}?admin=1`}>
            업보시트 관리자로
          </a>
        </header>
        {locked ? (
          <DonationGate
            slug={streamerSlug}
            blocked={access === "blocked-unconfigured"}
            returnTo={`/${streamerSlug}/donations`}
          />
        ) : (
          <>
            <DonationDashboard slug={streamerSlug} />
            <DonationPasswordForm slug={streamerSlug} />
          </>
        )}
      </div>
    </main>
  );
}
