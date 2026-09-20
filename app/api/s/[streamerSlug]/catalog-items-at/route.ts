import { parseDonateTimeMs, type CatalogGroup } from "@/lib/api";
import { isManualDonateTimeText } from "@/lib/manualEntryDate";
import { effectiveThresholdForLabel } from "@/lib/upboCore";
import { catalogSlimAtOrBefore, getStreamerRowBySlug, latestThresholdOverrides } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

function badRequest(message: string): Error {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  return error;
}

// 수동기록 폼의 "그날 표" 후보(ManualEntryManager 의 ItemChoice 와 같은 모양).
type ItemChoice = {
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  catalogGroupIndex?: number;
  rouletteId?: string;
  rouletteLabel?: string;
};

// 관리자 전용 on-demand GET `?at=YYYY-MM-DD HH:MM`(KST, 수동기록이 저장할 값 그대로):
// 그 시각 이전에 캡처된 룰렛표 중 최대 버전의 상품 목록.
// 수동기록 폼에서 후원 시각이 활성 표 캡처 시각보다 이를 때만 호출한다(팬 경로 무영향 — 불변 조건 4).
//  - 경계를 "그날 끝"이 아니라 저장할 시각 그대로 잡는다: 같은 날 표를 새로 캡처해도
//    그 전에 일어난 후원은 옛 표 상품을 고를 수 있다(리뷰 지적 4).
//  - 사용 on/off 는 무시(옛 표는 이미 지나간 표라 사용 설정이 없다). 확률은 기준확률 이하만(기존 예외 헬퍼 재사용).
//  - 그 버전이 현재 활성 버전(최대 버전)과 같으면 { sameAsCurrent: true } 만 돌려준다(현재 표 옵션으로 충분).
//  - catalogGroupIndex = 그 버전의 groupIndex, rouletteLabel = 금액대 라벨 → 저장되면 1단계 되짚기가 탭을 찾는다.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const at = (new URL(request.url).searchParams.get("at") ?? "").trim();
    if (!at || !isManualDonateTimeText(at)) throw badRequest("at=YYYY-MM-DD HH:MM 형식이 필요합니다.");
    const boundary = parseDonateTimeMs(at);
    if (boundary === null) throw badRequest("at=YYYY-MM-DD HH:MM 형식이 필요합니다.");
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const found = await catalogSlimAtOrBefore(streamer.id, new Date(boundary).toISOString());
    if (!found || found.version === found.latestVersion) return jsonOk({ ok: true, sameAsCurrent: true });

    const overrides = await latestThresholdOverrides(streamer.id);
    const threshold = Number(streamer.threshold_percent ?? 2);
    const groups = Array.isArray(found.groups) ? (found.groups as CatalogGroup[]) : [];
    const items: ItemChoice[] = [];
    for (const g of groups) {
      if (!g || typeof g !== "object" || typeof g.groupIndex !== "number") continue;
      const label = typeof g.amountRangeLabel === "string" ? g.amountRangeLabel.trim() : "";
      const limit = effectiveThresholdForLabel(overrides, label, threshold);
      const seen = new Set<string>();
      for (const it of g.items ?? []) {
        if (!it || typeof it.itemName !== "string" || !it.itemName.trim()) continue;
        const probability = Number(it.probability);
        if (!Number.isFinite(probability) || probability > limit) continue;
        if (seen.has(it.itemName)) continue;
        seen.add(it.itemName);
        items.push({
          itemName: it.itemName,
          probability,
          amountRangeLabel: label || undefined,
          catalogGroupIndex: g.groupIndex,
          rouletteId: `v${found.version}:g${g.groupIndex}`,
          rouletteLabel: label || undefined,
        });
      }
    }
    items.sort((a, b) => b.probability - a.probability || a.itemName.localeCompare(b.itemName));
    return jsonOk({ ok: true, version: found.version, capturedAt: found.capturedAt, items });
  } catch (error) {
    return jsonError(error);
  }
}
