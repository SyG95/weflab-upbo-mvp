import {
  recordExchangeBundle,
  revertExchangeBundle,
  type ExchangeBundleInput,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// N:M 번들 교환: 주는 묶음(기록 조각×수량)과 받는 묶음(상품×수량)을 한 번에 기록.
// 검증·기록 규칙은 recordExchangeBundle 참고. 관리자 로그인 세션으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);

    const body = await readJson<{
      viewer?: { fanId?: unknown; fanNickname?: unknown };
      gives?: unknown;
      receives?: unknown;
      catalogVersion?: unknown;
      reason?: unknown;
    }>(request);

    const input: ExchangeBundleInput = {
      viewer: {
        fanId: typeof body.viewer?.fanId === "string" ? body.viewer.fanId : "",
        fanNickname: typeof body.viewer?.fanNickname === "string" ? body.viewer.fanNickname : "",
      },
      gives: Array.isArray(body.gives)
        ? body.gives.map((g) => {
            const rec = (g ?? {}) as Record<string, unknown>;
            return {
              entryId: typeof rec.entryId === "string" ? rec.entryId : "",
              quantity: Number(rec.quantity),
              itemName: typeof rec.itemName === "string" ? rec.itemName : "",
            };
          })
        : [],
      receives: Array.isArray(body.receives)
        ? body.receives.map((r) => {
            const rec = (r ?? {}) as Record<string, unknown>;
            return {
              itemName: typeof rec.itemName === "string" ? rec.itemName : "",
              probability: typeof rec.probability === "number" ? rec.probability : undefined,
              amountRangeLabel:
                typeof rec.amountRangeLabel === "string" ? rec.amountRangeLabel : undefined,
              catalogGroupIndex:
                typeof rec.catalogGroupIndex === "number" ? rec.catalogGroupIndex : null,
              quantity: Number(rec.quantity),
            };
          })
        : [],
      catalogVersion: typeof body.catalogVersion === "number" ? body.catalogVersion : null,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    };

    const result = await recordExchangeBundle(streamerSlug, input);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}

// 번들 교환 되돌리기: ?groupId=<exchangeGroupId>. 준 수량 복구 + 받은 기록 삭제, 이중 되돌리기 차단.
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const groupId = new URL(request.url).searchParams.get("groupId") ?? "";
    const result = await revertExchangeBundle(streamerSlug, groupId);
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
