import { getExtensionConfig, resolveExtensionToken, upsertExtensionStatus } from "@/lib/upboSupabase";
import { extensionTokenFromRequest, jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { normalizeHeartbeat } from "@/lib/extensionStatus";

export const runtime = "nodejs";

// 확프 하트비트(수집 레인 1단계, 2026-10-12). 확프 0.4.0 이 5분마다·시작 때·탭 복귀 때 보낸다.
// 토큰 확인(기존 resolveExtensionToken 그대로) → 본문 정제(허용 필드만, 개인정보 없음) → 스트리머당 1행 덮어쓰기
// → 응답에 원격 스위치(설정)를 실어 준다. 확프는 이 설정을 그대로 따른다(반영 지연 ≤5분).
// 비용: 토큰 2쿼리 + (상태 upsert 1 ∥ 설정 1). 수집·판정 통로(results/catalogs)는 건드리지 않는다.
// statusSaved=false 는 상태 테이블이 아직 없다는 뜻(sy SQL 적용 전) — 설정 응답은 그대로 나간다.
export async function POST(request: Request) {
  try {
    const streamer = await resolveExtensionToken(extensionTokenFromRequest(request));
    const body = await readJson<unknown>(request);
    // 객체가 아닌 본문은 저장하지 않는다(기본값으로 마지막 정상 상태를 덮어 "로그인 풀림" 같은 거짓 빨강이 되지 않게).
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonOk({ ok: false, error: "heartbeat body must be a JSON object" }, 400);
    }
    const payload = normalizeHeartbeat(body);
    const [statusSaved, config] = await Promise.all([
      upsertExtensionStatus(streamer.id, payload.clientVersion, payload),
      getExtensionConfig(streamer.id),
    ]);
    return jsonOk({ ok: true, config, statusSaved, serverTime: new Date().toISOString() });
  } catch (error) {
    return jsonError(error);
  }
}
