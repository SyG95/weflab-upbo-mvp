import { getStreamerRowBySlug, uploadMemoImage } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function badRequest(message: string): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  return error;
}

// 메모(시청자/정가) 첨부 이미지 1장 업로드. 관리자 로그인 세션 필요. 공개 URL을 돌려준다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    await getStreamerRowBySlug(streamerSlug); // 스트리머 존재 확인(없으면 404)

    const formData = await request.formData();
    const value = formData.get("image");
    if (!(value instanceof File) || value.size === 0) throw badRequest("image 파일이 필요합니다.");
    if (!ALLOWED_IMAGE_TYPES.has(value.type)) throw badRequest("지원하지 않는 이미지 형식이에요(jpg/png/webp).");
    if (value.size > MAX_IMAGE_BYTES) throw badRequest("이미지가 8MB를 넘어요.");

    const url = await uploadMemoImage(streamerSlug, {
      bytes: await value.arrayBuffer(),
      contentType: value.type,
    });
    return jsonOk({ ok: true, url });
  } catch (error) {
    return jsonError(error);
  }
}
