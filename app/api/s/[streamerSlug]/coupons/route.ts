import { saveCouponChanges, type CouponChangeInput } from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// 쿠폰 잔액 변경(지급/사용/조정/값설정) 배치 저장.
// 잔액은 0 밑으로 안 내려가고, 실제 변화는 전부 coupon_events 이력으로 남는다.
// 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);

    const body = await readJson<{ changes?: unknown }>(request);
    if (!Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > 200) {
      const error = new Error("changes must be a non-empty array (max 200)");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }
    const changes: CouponChangeInput[] = [];
    for (const raw of body.changes) {
      if (!raw || typeof raw !== "object") {
        const error = new Error("invalid change entry");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      const rec = raw as Record<string, unknown>;
      const mode = rec.mode === "set" ? "set" : rec.mode === "delta" ? "delta" : null;
      if (!mode) {
        const error = new Error("mode must be 'delta' or 'set'");
        (error as Error & { status?: number }).status = 400;
        throw error;
      }
      changes.push({
        nickname: typeof rec.nickname === "string" ? rec.nickname : undefined,
        accountId: typeof rec.accountId === "string" ? rec.accountId : undefined,
        itemKey: typeof rec.itemKey === "string" ? rec.itemKey : "",
        itemName: typeof rec.itemName === "string" ? rec.itemName : undefined,
        mode,
        value: Number(rec.value),
        actionType:
          typeof rec.actionType === "string" &&
          ["grant", "use", "adjust", "set"].includes(rec.actionType)
            ? (rec.actionType as CouponChangeInput["actionType"])
            : undefined,
        note: typeof rec.note === "string" ? rec.note : undefined,
      });
    }

    const state = await saveCouponChanges(streamerSlug, changes);
    return jsonOk({ ok: true, ...state });
  } catch (error) {
    return jsonError(error);
  }
}
