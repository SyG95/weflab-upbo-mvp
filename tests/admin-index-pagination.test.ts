// 운영자 목록 집계(getAdminStreamerIndex)가 Supabase 1회 응답 상한(Max rows)에 걸려도
// import_batches 를 전량 수신하는지 검증한다.
//
// 재현한 실사고(2026-08-10, 리브레): 전 스트리머 배치를 asc 정렬 단일 조회로 가져오다
// 서버 상한에서 조용히 잘려, 가장 최신 배치(=리브레의 8/10 수집)가 빠지고
// 목록 신호등이 7/13 로 굳었다. 이 테스트는 상한 500 을 흉내 내는 가짜 PostgREST 로
// "상한보다 많은 배치(1,200개)" 상황을 만들고, 최신 배치가 집계에 반드시 포함되는지 본다.
import http from "node:http";

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const MAX_ROWS = 500; // Supabase Settings→API "Max rows" 흉내: limit 을 더 크게 요청해도 이만큼만 반환

type BatchRow = { streamer_id: string; applied_at: string; summary: Record<string, number> };

const STREAMERS = [
  { id: "s-libre", slug: "libre", display_name: "리브레", threshold_percent: 2, updated_at: "2026-08-10T00:00:00+00:00" },
  { id: "s-poromi", slug: "poromi", display_name: "포로미", threshold_percent: 2, updated_at: "2026-08-09T00:00:00+00:00" },
];

// asc 정렬 시드 1,200개: 리브레 옛 배치 50 → 포로미 옛 배치 1,149 → 리브레 최신 1개(맨 끝).
// 단일 조회(상한 500)라면 최신 배치는 무조건 잘리는 배치 규모다.
const NEWEST_AT = "2026-08-10T06:24:16+00:00";
const batches: BatchRow[] = [];
for (let i = 0; i < 50; i += 1) {
  batches.push({
    streamer_id: "s-libre",
    applied_at: `2026-07-${String(6 + (i % 7)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00+00:00`,
    summary: { recordCount: 1, needsReviewCount: 0 },
  });
}
for (let i = 0; i < 1149; i += 1) {
  const day = 14 + Math.floor(i / 60);
  batches.push({
    streamer_id: "s-poromi",
    applied_at: `2026-07-${String(Math.min(day, 31)).padStart(2, "0")}T12:${String(i % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}+00:00`,
    summary: { recordCount: 2, needsReviewCount: 1 },
  });
}
batches.sort((a, b) => a.applied_at.localeCompare(b.applied_at));
batches.push({ streamer_id: "s-libre", applied_at: NEWEST_AT, summary: { recordCount: 30, needsReviewCount: 24 } });

let requestCount = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/rest/v1/streamers") {
    res.end(JSON.stringify(STREAMERS));
    return;
  }
  if (url.pathname === "/rest/v1/import_batches") {
    requestCount += 1;
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? String(MAX_ROWS));
    const effective = Math.min(limit, MAX_ROWS); // 상한: 요청 limit 이 커도 여기서 자른다
    res.end(JSON.stringify(batches.slice(offset, offset + effective)));
    return;
  }
  res.end("[]");
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server address unavailable");

  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";

  const { getAdminStreamerIndex } = await import("../lib/upboSupabase");

  const rows = await getAdminStreamerIndex();
  const libre = rows.find((r) => r.slug === "libre");
  const poromi = rows.find((r) => r.slug === "poromi");
  if (!libre || !poromi) throw new Error("streamer rows missing from index");

  // 핵심: 상한(500)보다 배치가 많아도(1,200) 맨 끝의 최신 배치가 신호등 계산에 포함돼야 한다.
  assertEqual(libre.lastAppliedAt, NEWEST_AT, "libre lastAppliedAt must be the newest batch");
  assertEqual(libre.batchCount, 51, "libre batchCount (50 old + 1 newest)");
  assertEqual(poromi.batchCount, 1149, "poromi batchCount");
  assertEqual(libre.recordSum, 50 * 1 + 30, "libre recordSum");
  assertEqual(libre.needsReviewSum, 24, "libre needsReviewSum");
  assertEqual(poromi.recordSum, 1149 * 2, "poromi recordSum");
  if (requestCount < 3) {
    // 1,200개 ÷ 상한 500 → 최소 3페이지. 페이지 순회가 실제로 일어났는지 확인한다.
    throw new Error(`expected paginated fetching (>=3 requests), got ${requestCount}`);
  }
  console.log(`admin-index-pagination: OK (batches=${batches.length}, requests=${requestCount})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => server.close());
