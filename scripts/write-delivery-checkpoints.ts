// 점검 창 전용: 스트리머별 배송 체크포인트 1장 기록(2026-09-11). 기본은 dry-run(집계만).
//   npx tsx scripts/write-delivery-checkpoints.ts            → 스트리머별 이벤트 수·접힌 항목 수만 출력
//   npx tsx scripts/write-delivery-checkpoints.ts --execute  → 이벤트가 MIN_EVENTS 이상인 스트리머에 체크포인트 기록
// 기록 직후 "전량 접기 vs 체크포인트+이후" 를 다시 비교해 불일치면 즉시 보고(되돌리기=해당 체크포인트 이벤트 삭제).
import fs from "node:fs";

const envText = fs.readFileSync("/Users/sy/upbo-port-v24/.env.local", "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
process.env.UPBO_TABLE_PREFIX = process.env.UPBO_TABLE_PREFIX || "upbo_alpha_";
const EXECUTE = process.argv.includes("--execute");
const MIN_EVENTS = 20;

async function main() {
const LIB = await import("../lib/upboSupabase");
const prefix = process.env.UPBO_TABLE_PREFIX!;
type Ev = { id?: string; payload: unknown; created_at: string };
const sortItems = <T extends { fanId: string; itemKey: string }>(items: T[]) =>
  [...items].sort((a, b) => `${a.fanId}@@${a.itemKey}`.localeCompare(`${b.fanId}@@${b.itemKey}`));

const streamers = await LIB.supabaseFetchAll<{ id: string; slug: string; created_at?: string }>(`/${prefix}streamers?select=id,slug,created_at`, LIB.PAGE_CREATED_ASC);
let written = 0, skipped = 0, failed = 0;
for (const s of streamers) {
  const events = await LIB.supabaseFetchAll<Ev>(
    `/${prefix}audit_logs?streamer_id=eq.${s.id}&action=eq.delivery_progress_updated&select=id,payload,created_at`,
    LIB.PAGE_CREATED_ASC,
  );
  const full = sortItems(LIB.foldDeliveryEvents(events));
  const line = `${s.slug.padEnd(14)} 이벤트 ${String(events.length).padStart(4)} 항목 ${String(full.length).padStart(4)}`;
  if (events.length < MIN_EVENTS) { console.log(`${line} | 건너뜀(<${MIN_EVENTS})`); skipped++; continue; }
  if (!EXECUTE) { console.log(`${line} | 기록 대상(dry-run)`); continue; }
  const result = await LIB.writeDeliveryCheckpoint(s.id);
  if (!result.written) { console.log(`${line} | 기록 안 함: ${result.reason}`); failed++; continue; }
  // 기록 직후 재검증: 새 읽기 경로(체크포인트+이후) 결과가 전량 접기와 같은가
  const via = sortItems(await LIB.getOperatorState(s.slug).then((o) => o.deliveryProgress));
  const same = JSON.stringify(via) === JSON.stringify(full);
  console.log(`${line} | 기록됨(coversThrough=${result.coversThrough}) | 재검증 ${same ? "OK" : "★불일치"}`);
  same ? written++ : failed++;
}
console.log(`\n기록 ${written} / 건너뜀 ${skipped} / 실패 ${failed}${EXECUTE ? "" : "  (dry-run)"}`);
process.exit(failed > 0 ? 1 : 0);
}
main();
