import { getStreamerRowBySlug, uploadSignatureImage } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function badRequest(message: string): never {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  throw error;
}

// 시그 이미지 1장 업로드(정가 설정 화면 전용). 관리자 로그인 세션으로 인증한다.
// 업로드만 하고 URL 을 돌려준다 — 어느 갯수에 붙는지는 "저장"(signature-counts POST)이 확정한다.
// (저장 시 안 쓰게 된 이미지는 setSignatureCounts 가 정리한다.)
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    await getStreamerRowBySlug(streamerSlug);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) badRequest("이미지 파일이 없어요");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) badRequest("jpg/png/webp 이미지만 올릴 수 있어요");
    if (file.size > MAX_IMAGE_BYTES) badRequest("이미지는 8MB 이하만 올릴 수 있어요");

    const url = await uploadSignatureImage(streamerSlug, {
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    });
    return jsonOk({ ok: true, url });
  } catch (error) {
    return jsonError(error);
  }
}
