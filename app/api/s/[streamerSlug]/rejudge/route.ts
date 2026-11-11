import {
  applyApproxRejudgeForStreamer,
  applyRejudgeForStreamer,
  featureFlagsForStreamer,
  getStreamerRowBySlug,
  missingSuspectHeadline,
  previewDonationTimeRejudgeForStreamer,
  previewRejudgeForStreamer,
  setMissingCandidatePolicy,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { isSheetMasterSession } from "@/lib/sheetMasterSession";

export const runtime = "nodejs";
// 후원 시점 근사 미리보기는 원본 전량을 결과마다 다시 판정한다(무거운 스트리머 수 초) — 넉넉히 둔다.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ streamerSlug: string }> };

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

// 넣기 요청의 "화면이 마지막으로 그린 줄" 위치 표지 {o: 분류 순서, t: 후원 시각 ms|null, k: 결과 키}(lib/rejudgeApplySelection.ts).
function parseSeenThrough(raw: unknown): { o: number; t: number | null; k: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { o, t, k } = raw as Record<string, unknown>;
  if (typeof o !== "number" || !Number.isInteger(o) || o < 0 || o > 3) return null;
  if (t !== null && (typeof t !== "number" || !Number.isFinite(t))) return null;
  if (typeof k !== "string" || k.length === 0 || k.length > 300) return null;
  return { o, t, k };
}

// 이 스트리머가 쓸 수 있는 판정 기준(화면이 "판정 기준" 선택을 보일지 정한다). 시범 스위치는 sy 가 /admin 에서 켠다.
// ?suspect=1 이면 관리자 머리 표시용 의심 수도 함께 준다(시범 스위치 켠 스트리머만, 원본은 읽지 않음).
// canApply = "그때 표로" 넣기·되돌리기 버튼을 보일지(시범 스위치 + sy 마스터키 세션). 서버 쓰기 경로도 같은 조건으로 다시 막는다.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const flags = await featureFlagsForStreamer(streamer.id);
    const wantsSuspect = new URL(request.url).searchParams.get("suspect") === "1";
    const suspect = wantsSuspect && flags.asofRejudge ? await missingSuspectHeadline(streamer) : null;
    const canApply = flags.asofRejudge && (await isSheetMasterSession(streamerSlug));
    return jsonOk({ modes: { now: true, donationTime: flags.asofRejudge }, suspect, canApply });
  } catch (error) {
    return jsonError(error);
  }
}

// 재판정: 저장된 원본을 현재 확률표로 다시 돌려, 기록됐어야 할 결과만 새로 넣는다.
// - 기본은 미리보기(dryRun). 실제 저장은 apply:true + confirm=<슬러그> 둘 다 있어야 한다
//   (데이터 초기화와 같은 확인 게이트).
// - 기존 기록은 절대 수정·삭제하지 않는다. 새로 넣는 것만 한다.
// - mode: "now"(기본, 현행) | "donation_time"(후원 그때 표로 근사, 시범 스위치 필요).
//   donation_time 미리보기는 기록 쓰기 0(첫 쪽에 미처리 수 audit 1줄만). donation_time 넣기(관문 2)는 sy 마스터키 세션만 —
//   스트리머 개인 비밀번호 세션은 403(화면도 버튼을 숨긴다). 계획 지문(planFingerprint)이 다르면 409, 쓰기 0.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{
      apply?: unknown;
      confirm?: unknown;
      sourceKeys?: unknown;
      mode?: unknown;
      page?: unknown;
      rawUntil?: unknown;
      policy?: { amount?: unknown; itemName?: unknown; decision?: unknown };
      fingerprint?: unknown;
      seenThrough?: unknown;
    }>(request);
    // 표 밖(🟠) 종류 "앞으로 제외"·취소. 기록은 만들지 않고 audit 한 줄만 남긴다. 미리보기와 같은 시범 스위치 뒤에 둔다.
    if (body.policy !== undefined) {
      const flags = await featureFlagsForStreamer(streamer.id);
      if (!flags.asofRejudge) throw httpError("donation_time mode is not enabled for this streamer", 403);
      if (!body.policy || typeof body.policy !== "object") throw httpError("policy must be an object", 400);
      return jsonOk({ ok: true, ...(await setMissingCandidatePolicy(streamer, body.policy as { amount: unknown; itemName: unknown; decision: unknown })) });
    }
    const mode = body.mode === undefined || body.mode === "now" ? "now" : body.mode === "donation_time" ? "donation_time" : null;
    if (!mode) throw httpError('mode must be "now" or "donation_time"', 400);
    const wantsApply = body.apply === true;
    if (mode === "donation_time") {
      const flags = await featureFlagsForStreamer(streamer.id);
      if (!flags.asofRejudge) throw httpError("donation_time mode is not enabled for this streamer", 403);
      // rawUntil = 첫 쪽 응답이 준 원본 기준 시각(다음 쪽·넣기가 같은 원본 범위로 계산하게). 시각 글자만 받는다.
      const rawUntil = body.rawUntil === undefined || body.rawUntil === null ? null : String(body.rawUntil);
      const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
      if (rawUntil !== null && (!ISO_TIMESTAMP.test(rawUntil) || !Number.isFinite(Date.parse(rawUntil)))) {
        throw httpError("rawUntil must be a timestamp", 400);
      }
      if (wantsApply) {
        // 넣기·되돌리기는 sy 마스터키 세션만(sy 결정 11/11). 화면 숨김만으로는 안 되므로 여기서 막는다.
        if (!(await isSheetMasterSession(streamerSlug))) {
          throw httpError("이 넣기는 운영자(마스터키) 로그인에서만 할 수 있어요.", 403);
        }
        if (String(body.confirm ?? "") !== streamerSlug) throw httpError("confirm must equal the streamer slug", 400);
        const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
        if (!/^[0-9a-f]{16}$/.test(fingerprint)) throw httpError("fingerprint must be the preview planFingerprint", 400);
        if (rawUntil === null) throw httpError("rawUntil is required to apply", 400);
        const seenThrough = parseSeenThrough(body.seenThrough);
        if (!seenThrough) throw httpError("seenThrough must be the last shown row position", 400);
        const keys = body.sourceKeys;
        const problem = !Array.isArray(keys)
          ? "sourceKeys must be an array of strings"
          : keys.length === 0
            ? "sourceKeys is empty"
            : keys.length > 20000
              ? "sourceKeys is too long (max 20000)"
              : keys.some((k) => typeof k !== "string" || k.length === 0 || k.length > 300)
                ? "each sourceKey must be a string of 1 to 300 characters"
                : "";
        if (problem) throw httpError(problem, 400);
        return jsonOk(
          await applyApproxRejudgeForStreamer(streamer, { fingerprint, rawUntil, seenThrough, sourceKeys: keys as string[] }),
        );
      }
      const page = body.page === undefined ? 0 : Number(body.page);
      if (!Number.isInteger(page) || page < 0 || page > 10_000) throw httpError("page must be a non-negative integer", 400);
      return jsonOk(await previewDonationTimeRejudgeForStreamer(streamer, { page, rawUntil }));
    }
    if (!wantsApply) {
      return jsonOk(await previewRejudgeForStreamer(streamer));
    }
    if (String(body.confirm ?? "") !== streamerSlug) {
      const error = new Error("confirm must equal the streamer slug");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    // sourceKeys = 미리보기에서 본 후보 키. 있으면 그 안의 것만 넣는다(없으면 예전처럼 지금 후보 전부).
    let previewKeys: string[] | undefined;
    if (body.sourceKeys !== undefined) {
      const keys = body.sourceKeys;
      const problem = !Array.isArray(keys)
        ? "sourceKeys must be an array of strings"
        : keys.length > 50000
          ? "sourceKeys is too long (max 50000)"
          : keys.some((k) => typeof k !== "string" || k.length > 300)
            ? "each sourceKey must be a string of at most 300 characters"
            : "";
      if (problem) {
        const error = new Error(problem);
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      previewKeys = keys as string[];
    }
    return jsonOk(await applyRejudgeForStreamer(streamer, { previewKeys }));
  } catch (error) {
    return jsonError(error);
  }
}
