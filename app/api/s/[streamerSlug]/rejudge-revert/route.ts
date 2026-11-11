import {
  applyApproxRejudgeRevert,
  approxRejudgeRuns,
  featureFlagsForStreamer,
  getStreamerRowBySlug,
  previewApproxRejudgeRevert,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { isSheetMasterSession } from "@/lib/sheetMasterSession";

// 다시판정 "후원 그때 표로" 넣기의 실행(runId)별 되돌리기(관문 2, PHASE1-DESIGN §6-2).
// 물리 삭제 없이 void 이벤트만 더한다. 막힌 기록(양도·배송 배정·쿠폰 적립 등)은 목록과 이유만 보여 주고 건너뛴다.
// 문: 시트 관리자 인증(401) → sy 마스터키 세션(403) → 시범 스위치(403) → runId 형식(400). 읽기(GET)도 같은 문 뒤에 둔다
// (item-events GET 무인증 사고 반복 금지).
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpError(message: string, status: number): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = status;
  return error;
}

async function requireMaster(streamerSlug: string): Promise<void> {
  await requireSheetAdmin(streamerSlug);
  if (!(await isSheetMasterSession(streamerSlug))) {
    throw httpError("되돌리기는 운영자(마스터키) 로그인에서만 할 수 있어요.", 403);
  }
}

async function streamerWithSwitch(streamerSlug: string) {
  const streamer = await getStreamerRowBySlug(streamerSlug);
  const flags = await featureFlagsForStreamer(streamer.id);
  if (!flags.asofRejudge) throw httpError("donation_time mode is not enabled for this streamer", 403);
  return streamer;
}

// 넣기 실행 목록(최근 20개): 실행 시각·넣은 수·되돌린 수. 결과 키는 내보내지 않는다.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireMaster(streamerSlug);
    const streamer = await streamerWithSwitch(streamerSlug);
    return jsonOk({ runs: await approxRejudgeRuns(streamer) });
  } catch (error) {
    return jsonError(error);
  }
}

// { runId } → 되돌리기 미리보기(쓰기 0). { runId, apply: true, confirm: <슬러그>, reason } → void 실행.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireMaster(streamerSlug);
    const body = await readJson<{ runId?: unknown; apply?: unknown; confirm?: unknown; reason?: unknown }>(request);
    const runId = typeof body.runId === "string" ? body.runId : "";
    if (!UUID.test(runId)) throw httpError("runId must be a uuid", 400);
    const streamer = await streamerWithSwitch(streamerSlug);
    if (body.apply === true) {
      return jsonOk(await applyApproxRejudgeRevert(streamer, runId, { confirm: body.confirm, reason: body.reason }));
    }
    return jsonOk(await previewApproxRejudgeRevert(streamer, runId));
  } catch (error) {
    return jsonError(error);
  }
}
