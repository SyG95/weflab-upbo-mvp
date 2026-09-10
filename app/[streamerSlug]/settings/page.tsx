import ThemePicker from "./ThemePicker";
import FontPicker from "./FontPicker";
import SheetAdminGate from "../SheetAdminGate";
import { DEFAULT_THEME_ID } from "../../../lib/themes";
import { normalizeSheetFont } from "../../../lib/sheetFonts";
import { getStreamerRowBySlug, getSheetFontKeyBySlug } from "../../../lib/upboSupabase";
import { sheetAdminAccessState } from "../../../lib/sheetAdminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ streamerSlug: string }> };

export default async function ThemeSettingsPage({ params }: PageProps) {
  const { streamerSlug } = await params;

  // 설정 페이지도 관리자 로그인(스트리머별 비밀번호) 뒤로 숨긴다.
  const access = await sheetAdminAccessState(streamerSlug);
  if (access === "locked" || access === "blocked-unconfigured") {
    return (
      <div style={{ maxWidth: 520, margin: "48px auto", padding: "0 16px" }}>
        <SheetAdminGate
          slug={streamerSlug}
          blocked={access === "blocked-unconfigured"}
          returnTo={`/${streamerSlug}/settings`}
        />
      </div>
    );
  }

  let initialThemeId = DEFAULT_THEME_ID;
  let initialFontKey = "";
  let initialCustom: unknown = null;
  try {
    const state = await getStreamerRowBySlug(streamerSlug);
    if(state?.accent_color) initialThemeId=state.accent_color;
    initialCustom=state?.custom_theme ?? null;
    initialFontKey=normalizeSheetFont(await getSheetFontKeyBySlug(streamerSlug));

  } catch {
    // Supabase 미설정/스트리머 없음 → 기본값으로 미리보기만 제공
  }
  return (
    <>
      <ThemePicker slug={streamerSlug} initialThemeId={initialThemeId} initialCustom={initialCustom} />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 20px 48px" }}>
        <FontPicker slug={streamerSlug} initialFontKey={initialFontKey} />
      </div>
    </>
  );
}
