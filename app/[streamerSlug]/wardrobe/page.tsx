// 옷장 독립 화면(/[slug]/wardrobe) — 업보시트의 한 탭이 아니라 옷장이 주인공인 전용 페이지.
// 후원집계(donations) 독립 레인과 같은 껍데기 문법(스트리머 테마·글씨체·살아있는 배경)을 잇고,
// 인증 없는 팬 공개 화면이다. 공개 컷 0장이면 안내만 보여준다(업보시트 탭 노출 규칙과 동일 기준).
// ?w=<컷id> 딥링크는 크게보기를 바로 연다(탭의 ?tab=wardrobe&w= 과 같은 문법).

import type { CSSProperties } from "react";
import { getSheetFontKeyBySlug, getStreamerRowBySlug, getWardrobeBySlug } from "@/lib/upboSupabase";
import { sheetFontCss, sheetFontHref } from "@/lib/sheetFonts";
import { resolveTheme } from "@/lib/themes";
import ThemeLiveBackground from "../ThemeLiveBackground";
import WardrobeStandaloneView from "./WardrobeStandaloneView";
import WardrobeRecoveryView from "../WardrobeRecoveryView";
import styles from "./wardrobePage.module.css";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ streamerSlug: string }>;
  searchParams: Promise<{ theme?: string; w?: string }>;
};

export default async function WardrobePage({ params, searchParams }: PageProps) {
  const { streamerSlug } = await params;
  const { theme: themePreview, w } = await searchParams;

  // 조회 실패(로컬 무 Supabase 등)는 기본 테마·빈 옷장으로 폴백 — 페이지를 죽이지 않는다.
  const [streamerRow, sheetFontKey, wardrobe] = await Promise.all([
    getStreamerRowBySlug(streamerSlug).catch(() => null),
    getSheetFontKeyBySlug(streamerSlug).catch(() => ""),
    getWardrobeBySlug(streamerSlug).catch(() => null),
  ]);
  const items = (wardrobe?.items ?? []).filter((i) => !i.hidden);
  // 제목은 콘솔에서 입력한 표시 이름(한글 가능) — 슬러그는 주소 전용.
  const streamerName = streamerRow?.display_name?.trim() || streamerSlug;
  const theme = resolveTheme(themePreview || streamerRow?.accent_color || undefined, themePreview ? null : streamerRow?.custom_theme);
  const sheetFontFamily = sheetFontCss(sheetFontKey);
  const sheetFontLink = sheetFontHref(sheetFontKey);
  const themeStyle = {
    ...theme.vars,
    ...(sheetFontFamily ? { "--font-display": sheetFontFamily, "--font-chip": sheetFontFamily } : {}),
  } as CSSProperties;

  return (
    <main
      className={styles.page}
      style={themeStyle}
      data-fx={theme.fx?.background}
      data-glass={theme.fx?.glass ? "1" : undefined}
    >
      <ThemeLiveBackground fx={theme.fx?.background} palette={theme.fx?.nebulaPalette} />
      {sheetFontLink ? <link rel="stylesheet" href={sheetFontLink} /> : null}
      <div className={styles.shell}>
        <header className={styles.cover}>
          <div>
            <p className={styles.kicker}>옷장</p>
            <h1 className={styles.title}>{streamerName} 옷장</h1>
          </div>
          <a className={styles.backLink} href={`/${encodeURIComponent(streamerSlug)}`}>
            업보시트로
          </a>
        </header>
        {process.env.UPBO_WARDROBE_RECOVERY === "read-only" ? (
          <WardrobeRecoveryView items={items} />
        ) : items.length === 0 ? (
          <p className={styles.empty}>아직 공개된 컷이 없어요 — 곧 채워질 거예요.</p>
        ) : (
          <WardrobeStandaloneView
            slug={streamerSlug}
            themes={wardrobe?.themes ?? []}
            settings={wardrobe?.settings}
            items={items}
            initialItemId={typeof w === "string" && w ? w : null}
          />
        )}
      </div>
    </main>
  );
}
