import { knownSourceKeysForStreamer, resolveExtensionToken } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk } from "@/lib/upboRoute";
import { clampKnownKeysDays } from "@/lib/extensionStatus";

export const runtime = "nodejs";

// 서버가 최근 N일(기본 7, 1~14) 원본(raw_imports)에 이미 가진 행의 열쇠 목록 — 읽기 전용, 부수효과 없음.
// 확프 0.4.0 이 재설치 직후(본 키 캐시가 빈 상태) 1회 받아 캐시를 채운다 → 서버가 이미 받은 행은 다시 안 보낸다.
// 열쇠 규칙은 확프 content.js 와 같다(lib/extensionStatus.knownKeysFromRawRows). 각 목록 최대 5,000개.
export async function GET(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    const days = clampKnownKeysDays(new URL(request.url).searchParams.get("days"));
    const { resultKeys, donationKeys } = await knownSourceKeysForStreamer(streamer.id, days);
    return jsonOk({ ok: true, days, resultKeys, donationKeys });
  } catch (error) {
    return jsonError(error);
  }
}
