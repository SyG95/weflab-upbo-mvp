import { resolveExtensionToken } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonOk } from "@/lib/upboRoute";

export const runtime = "nodejs";

// 연결 테스트(읽기 전용, 부수효과 없음).
// Authorization: Bearer <token> → 유효하면 어느 시트에 연결됐는지 알려준다.
// 확프가 "OO님 시트에 연결됐어요 ✓" 표시에 쓴다.
export async function GET(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    return jsonOk({ ok: true, code: "ok", slug: streamer.slug, displayName: streamer.display_name });
  } catch {
    return jsonOk({ ok: false, code: "invalid_token" }, 401);
  }
}
