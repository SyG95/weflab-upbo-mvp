// 게시판 요청함 — 나월 전용 "임시 실험" 독립 레인.
// - 본진 규약: 기존 파일 수정 없음(이 폴더의 새 파일만). 데이터는 읽기 전용. 어떤 쓰기도 없다.
// - 나월(slug=nawol) 외 스트리머는 404. EXPIRES_AT 이후엔 나월도 404(자동 종료).
// - 게시판 댓글은 서버가 아니라 "관리자 브라우저"가 숲에 직접 요청한다(클라이언트 fetch).
//   Vercel 해외 서버 IP가 숲에서 막히는 경우를 피하는 확실한 경로 — 나월이 숲 웹을 보는 것과 동일.
// - 종료일 이후 이 폴더(board-requests)를 통째로 지우면 흔적 없이 제거된다.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sheetAdminAccessState } from "@/lib/sheetAdminAuth";
import { getStreamerState } from "@/lib/upboSupabase";
import {
  computeHoldings,
  filterEntriesByCatalogUsage,
  normalizeAccountId,
  type StreamerState,
  type UpboEntry,
} from "@/lib/api";
import BoardRequestsView, { type SheetViewerLite } from "./BoardRequestsView";
import styles from "./boardRequests.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "게시판 요청함 (실험) — nawol",
  robots: { index: false, follow: false },
};

const ALLOWED_SLUG = "nawol";
// 임시 실험 종료 시각(KST 7/15 자정) — 이후 페이지가 스스로 내려간다(404).
const EXPIRES_AT = Date.parse("2026-07-15T00:00:00+09:00");

// 시트의 시청자 보유 업보 — 팬 페이지와 같은 읽기 경로(getStreamerState → computeHoldings).
async function loadSheetViewers(): Promise<Record<string, SheetViewerLite>> {
  // 본진 page.tsx(250행)와 동일한 공식 패턴으로 상태 타입을 맞춘다.
  const state = (await getStreamerState(ALLOWED_SLUG)) as unknown as StreamerState;
  const archivedFanAt = state.archivedFanAt ?? {};
  const visibleUnderArchive = (e: UpboEntry): boolean => {
    const at = archivedFanAt[e.fanId];
    if (!at) return true;
    return Date.parse(e.createdAt ?? "") > Date.parse(at);
  };
  const entries = filterEntriesByCatalogUsage(
    (state.upboEntries ?? []).filter(visibleUnderArchive),
    state.catalogs ?? [],
    state.catalogUsageByVersion,
  );
  const holdings = computeHoldings(entries, state.itemEvents ?? []);

  const out: Record<string, SheetViewerLite> = {};
  for (const h of holdings) {
    const id = normalizeAccountId(h.ownerId);
    if (!id) continue;
    out[id] = {
      nick: h.ownerName,
      total: h.total,
      items: h.items
        .filter((it) => it.quantity > 0)
        .map((it) => ({ name: it.itemName, qty: it.quantity })),
    };
  }
  return out;
}

type PageProps = { params: Promise<{ streamerSlug: string }> };

export default async function BoardRequestsPage({ params }: PageProps) {
  const { streamerSlug } = await params;
  if (streamerSlug !== ALLOWED_SLUG) notFound();
  if (Date.now() >= EXPIRES_AT) notFound(); // 실험 기간 종료 → 자동 비공개

  // 관리자(나월) 전용 — 기존 시트 관리자 로그인 세션을 읽기만 한다.
  const access = await sheetAdminAccessState(ALLOWED_SLUG);
  if (access !== "authed") {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.lockedCard}>
            <h1 className={styles.lockedTitle}>게시판 요청함 (실험)</h1>
            <p>
              업보시트 <b>관리자 로그인</b> 후에 볼 수 있는 실험 화면이에요.
            </p>
            <a className={styles.lockedLink} href={`/${ALLOWED_SLUG}?admin=1`}>
              관리자 로그인 하러 가기
            </a>
          </div>
        </div>
      </main>
    );
  }

  // 시트 보유업보 로드 실패는 페이지를 죽이지 않는다 — 댓글만이라도 보여준다.
  let sheetViewers: Record<string, SheetViewerLite> = {};
  let sheetOk = true;
  try {
    sheetViewers = await loadSheetViewers();
  } catch {
    sheetOk = false;
  }

  return (
    <BoardRequestsView
      sheetViewers={sheetViewers}
      sheetOk={sheetOk}
      expiresAt={EXPIRES_AT}
      backHref={`/${ALLOWED_SLUG}?admin=1`}
    />
  );
}
