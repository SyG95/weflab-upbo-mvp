import {
  assertAdminToken,
  executeStreamerReset,
  hasResetScope,
  previewStreamerReset,
  type ResetScope,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 스트리머 데이터 초기화 API(콘솔 버튼과 같은 로직, Bearer UPBO_ADMIN_TOKEN).
// 기본은 dryRun(건수 미리보기만) — 실제 삭제는 dryRun:false + confirm=슬러그를 함께 보내야 한다.
// 프리셋: full=백지+테마(비번·링크는 유지) / roulette=룰렛결과만 / donations=후원집계만.
const PRESETS: Record<string, ResetScope> = {
  full: { roulette: true, donations: true, catalogs: true, coupons: true, screenState: true, pins: false },
  roulette: { roulette: true, donations: false, catalogs: false, coupons: false, screenState: false, pins: false },
  donations: { roulette: false, donations: true, catalogs: false, coupons: false, screenState: false, pins: false },
};

type ResetBody = {
  preset?: string;
  scope?: Partial<ResetScope>;
  dryRun?: boolean;
  confirm?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertAdminToken(request.headers.get("authorization"));
    const { streamerSlug } = await context.params;
    const body = await readJson<ResetBody>(request);
    const preset = body.preset ? PRESETS[body.preset] : undefined;
    if (body.preset && !preset) {
      throw new Error(`unknown preset: ${body.preset} (full | roulette | donations)`);
    }
    const scope: ResetScope = {
      roulette: false,
      donations: false,
      catalogs: false,
      coupons: false,
      screenState: false,
      pins: false,
      ...(preset ?? {}),
      ...(body.scope ?? {}),
    };
    if (!hasResetScope(scope)) throw new Error("scope is empty: pass preset or scope");
    const dryRun = body.dryRun !== false;
    if (dryRun) {
      const result = await previewStreamerReset(streamerSlug, scope);
      return jsonOk({ ok: true, dryRun: true, scope, ...result });
    }
    if (String(body.confirm ?? "").trim().toLowerCase() !== streamerSlug.toLowerCase()) {
      throw new Error("confirm must equal the streamer slug to execute");
    }
    const result = await executeStreamerReset(streamerSlug, scope);
    return jsonOk({ ok: true, dryRun: false, scope, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
