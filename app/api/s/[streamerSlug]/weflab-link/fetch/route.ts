import { getStreamerRowBySlug, latestCatalogOrNull, saveCatalogForStreamer, setWeflabLinkInfo, weflabLinkForStreamer } from "@/lib/upboSupabase";
import { jsonError, jsonOk } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { fetchWeflabPublicCatalog, overlapRatioWithExisting } from "@/lib/weflabPublicCatalog";
import type { CatalogGroup } from "@/lib/api";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

// "지금 가져오기" — 등록된 위플랩 공개 링크를 서버가 직접 읽어 룰렛표를 저장한다.
// 확프 룰렛표 읽기와 같은 저장 통로(saveCatalogForStreamer)를 재사용 — 판정·버전관리·중복방지·
// 사용설정 승계는 100% 동일 로직. 실패하면 기존 카탈로그는 절대 바뀌지 않는다(fail-safe).
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const body = await request.text();
    const parsed = body ? (JSON.parse(body) as { url?: string }) : {};
    const link = await weflabLinkForStreamer(streamer.id);
    const url = (parsed.url || link.url || "").trim();
    if (!url) {
      const error = new Error("먼저 위플랩 공개 링크를 등록해 주세요.");
      (error as Error & { status?: number }).status = 400;
      throw error;
    }

    const result = await fetchWeflabPublicCatalog(url);

    // 엉뚱한 링크 방지: 기존 캡처와 상품 겹침이 낮으면 저장은 하되 경고를 남긴다(판단은 스트리머 몫).
    const existing = await latestCatalogOrNull(streamer.id);
    const overlap = overlapRatioWithExisting(
      result.capture.groups,
      (existing?.groups as CatalogGroup[] | undefined) ?? undefined,
    );
    const lowOverlap = overlap < 0.2;

    const catalog = await saveCatalogForStreamer(streamer, result.capture);
    const savedLink = await setWeflabLinkInfo(streamer, {
      url,
      lastFetchedAt: new Date().toISOString(),
      lastModifiedText: result.modifiedAtText ?? undefined,
      lastTableCount: result.tableCount,
      lastItemCount: result.itemCount,
      lastOverlapWarning: lowOverlap,
    });

    return jsonOk({
      ok: true,
      catalog,
      weflabLink: savedLink,
      tableCount: result.tableCount,
      itemCount: result.itemCount,
      modifiedAtText: result.modifiedAtText,
      overlapWarning: lowOverlap,
    });
  } catch (error) {
    return jsonError(error);
  }
}
