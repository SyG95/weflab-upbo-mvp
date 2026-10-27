import {
  applyRejudgeForStreamer,
  featureFlagsForStreamer,
  getStreamerRowBySlug,
  previewDonationTimeRejudgeForStreamer,
  previewRejudgeForStreamer,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";
// 후원 시점 근사 미리보기는 원본 전량을 결과마다 다시 판정한다(무거운 스트리머 수 초) — 넉넉히 둔다.
export const maxDuration = 60;

type RouteContext = { params: Promise<{ streamerSlug: string }> };

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

// 이 스트리머가 쓸 수 있는 판정 기준(화면이 "판정 기준" 선택을 보일지 정한다). 시범 스위치는 sy 가 /admin 에서 켠다.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);
    const flags = await featureFlagsForStreamer(streamer.id);
    return jsonOk({ modes: { now: true, donationTime: flags.asofRejudge } });
  } catch (error) {
    return jsonError(error);
  }
}

// 재판정: 저장된 원본을 현재 확률표로 다시 돌려, 기록됐어야 할 결과만 새로 넣는다.
// - 기본은 미리보기(dryRun). 실제 저장은 apply:true + confirm=<슬러그> 둘 다 있어야 한다
//   (데이터 초기화와 같은 확인 게이트).
// - 기존 기록은 절대 수정·삭제하지 않는다. 새로 넣는 것만 한다.
// - mode: "now"(기본, 현행) | "donation_time"(후원 그때 표로 근사 — 1단계 묶음 3, 미리보기만·쓰기 0, 시범 스위치 필요).
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
    }>(request);
    const mode = body.mode === undefined || body.mode === "now" ? "now" : body.mode === "donation_time" ? "donation_time" : null;
    if (!mode) throw httpError('mode must be "now" or "donation_time"', 400);
    const wantsApply = body.apply === true;
    if (mode === "donation_time") {
      // 넣기는 묶음 4(실제 삽입 id 장부·void 되돌리기)가 붙기 전까지 막는다.
      if (wantsApply) throw httpError("donation_time mode is preview-only for now", 400);
      const flags = await featureFlagsForStreamer(streamer.id);
      if (!flags.asofRejudge) throw httpError("donation_time mode is not enabled for this streamer", 403);
      const page = body.page === undefined ? 0 : Number(body.page);
      if (!Number.isInteger(page) || page < 0 || page > 10_000) throw httpError("page must be a non-negative integer", 400);
      // rawUntil = 첫 쪽 응답이 준 원본 기준 시각(다음 쪽이 같은 원본 범위로 계산하게). 시각 글자만 받는다.
      const rawUntil = body.rawUntil === undefined || body.rawUntil === null ? null : String(body.rawUntil);
      const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
      if (rawUntil !== null && (!ISO_TIMESTAMP.test(rawUntil) || !Number.isFinite(Date.parse(rawUntil)))) {
        throw httpError("rawUntil must be a timestamp", 400);
      }
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
