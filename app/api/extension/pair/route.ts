import { pairExtension } from "@/lib/extensionPairing";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";

export const runtime = "nodejs";

// 확프 비밀번호 페어링 교환 통로.
// 입력 {slug, password} → 검증 통과 시 진짜 확장 토큰을 1회 반환한다(확프는 토큰만 저장).
// 실패/잠금/미존재는 code 로 구분해 확프가 정규식 추측 없이 안내하게 한다.
export async function POST(request: Request) {
  try {
    const body = await readJson<{ slug?: unknown; password?: unknown }>(request);
    const { status, ...rest } = await pairExtension(body.slug, body.password);
    return jsonOk(rest, status);
  } catch (error) {
    return jsonError(error);
  }
}
