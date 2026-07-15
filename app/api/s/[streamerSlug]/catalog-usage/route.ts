import {
  isValidCatalogUsageKey,
  getStreamerRowBySlug,
  setCatalogUsage,
  type CatalogUsageOverrides,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_OVERRIDE_KEYS = 800;

// 룰렛확률표 사용여부(on/off) 오버라이드 저장. 캡처(원본)는 건드리지 않고
// "우리 사이트가 이 룰렛/상품을 쓸지"만 버전에 고정해 기록한다(전체 교체 방식).
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await readJson<{ catalogVersion?: unknown; overrides?: unknown }>(request);
    const catalogVersion = Number(body.catalogVersion);
    if (!Number.isFinite(catalogVersion) || catalogVersion < 0) {
      const error = new Error("catalogVersion must be a number");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    if (!body.overrides || typeof body.overrides !== "object" || Array.isArray(body.overrides)) {
      const error = new Error("overrides must be an object");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const entries = Object.entries(body.overrides as Record<string, unknown>);
    if (entries.length > MAX_OVERRIDE_KEYS) {
      const error = new Error(`too many override keys (max ${MAX_OVERRIDE_KEYS})`);
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const overrides: CatalogUsageOverrides = {};
    for (const [key, value] of entries) {
      if (!isValidCatalogUsageKey(key) || typeof value !== "boolean") {
        const error = new Error(`invalid override entry: ${key}`);
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      overrides[key] = value;
    }

    const saved = await setCatalogUsage(streamer, catalogVersion, overrides);
    return jsonOk({ ok: true, catalogUsage: saved });
  } catch (error) {
    return jsonError(error);
  }
}
