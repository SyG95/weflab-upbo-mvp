import {
  cleanShowcaseLink,
  getShowcaseBySlug,
  getStreamerRowBySlug,
  setShowcase,
  uploadShowcaseImage,
  type ShowcaseState,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { isNoticeFontKey } from "@/lib/noticeFonts";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_NOTICE_LENGTH = 2000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ShowcaseSlot = "banner" | "poster0" | "poster1";

// formData 에서 이미지 파일 하나를 꺼내 검증한다. 필드가 비어있으면 undefined.
async function readImageField(formData: FormData, field: string): Promise<{ bytes: ArrayBuffer; contentType: string } | undefined> {
  const value = formData.get(field);
  if (!(value instanceof File) || value.size === 0) return undefined;
  if (!ALLOWED_IMAGE_TYPES.has(value.type)) {
    const error = new Error(`${field}: unsupported image type`);
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  if (value.size > MAX_IMAGE_BYTES) {
    const error = new Error(`${field}: image exceeds 8MB limit`);
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return { bytes: await value.arrayBuffer(), contentType: value.type };
}

// 팬 업보시트 쇼케이스(홍보) 편집: 배너/포스터 2장/공지문구를 업로드하고 저장한다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const formData = await request.formData();
    const noticeTextRaw = formData.get("noticeText");
    const noticeText = typeof noticeTextRaw === "string" ? noticeTextRaw.slice(0, MAX_NOTICE_LENGTH) : undefined;
    // 공지 폰트: 필드가 있으면 화이트리스트로만 반영(모르는 값=기본 ""), 없으면 기존값 유지.
    const noticeFont = formData.has("noticeFont")
      ? isNoticeFontKey(formData.get("noticeFont"))
        ? (formData.get("noticeFont") as string)
        : ""
      : undefined;

    const bannerFile = await readImageField(formData, "banner");
    const poster0File = await readImageField(formData, "poster0");
    const poster1File = await readImageField(formData, "poster1");
    const poster2File = await readImageField(formData, "poster2");

    const removeBanner = formData.get("removeBanner") === "1";
    const removePoster0 = formData.get("removePoster0") === "1";
    const removePoster1 = formData.get("removePoster1") === "1";
    const removePoster2 = formData.get("removePoster2") === "1";

    const current: ShowcaseState = (await getShowcaseBySlug(streamerSlug)) ?? {
      bannerUrl: null,
      posterUrls: [null, null, null],
      bannerLink: null,
      posterLinks: [null, null, null],
      noticeText: "",
      noticeFont: "",
    };

    // 링크 필드(텍스트): 필드가 있으면 갱신(빈값/잘못된 스킴은 null), 없으면 기존값 유지.
    const linkOf = (field: string, fallback: string | null): string | null =>
      formData.has(field) ? cleanShowcaseLink(formData.get(field)) : fallback;
    const bannerLink = linkOf("bannerLink", current.bannerLink);
    const poster0Link = linkOf("poster0Link", current.posterLinks[0]);
    const poster1Link = linkOf("poster1Link", current.posterLinks[1]);
    const poster2Link = linkOf("poster2Link", current.posterLinks[2]);

    const bannerUrl = bannerFile
      ? await uploadShowcaseImage(streamerSlug, "banner", bannerFile)
      : removeBanner
        ? null
        : current.bannerUrl;

    const poster0Url = poster0File
      ? await uploadShowcaseImage(streamerSlug, "poster0", poster0File)
      : removePoster0
        ? null
        : current.posterUrls[0];

    const poster1Url = poster1File
      ? await uploadShowcaseImage(streamerSlug, "poster1", poster1File)
      : removePoster1
        ? null
        : current.posterUrls[1];

    const poster2Url = poster2File
      ? await uploadShowcaseImage(streamerSlug, "poster2", poster2File)
      : removePoster2
        ? null
        : current.posterUrls[2];

    const nextState: ShowcaseState = {
      bannerUrl,
      posterUrls: [poster0Url, poster1Url, poster2Url],
      bannerLink,
      posterLinks: [poster0Link, poster1Link, poster2Link],
      noticeText: noticeText ?? current.noticeText,
      noticeFont: noticeFont ?? current.noticeFont ?? "",
    };

    const showcase = await setShowcase(streamer, nextState);
    return jsonOk({ ok: true, showcase });
  } catch (error) {
    return jsonError(error);
  }
}
