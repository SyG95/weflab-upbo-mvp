// 조회 다이어트 운영 실데이터 검증(읽기 전용, 2026-09-11).
//  A) 배송 체크포인트 정확성: 스트리머별 실제 이벤트로 fold(all) === fold(rest, fold(prefix)) (7일 경계·중간 분할)
//  B) 옛 getStreamerState(배포본 8ad9796 lib) vs 새 getStreamerState(이 브랜치) 출력 비교 —
//     허용된 차이(옛 카탈로그 items=[], importBatches=최신 1건, modifierState.processedSourceKeys=[]) 외 0 차이
// 실행: cd /Users/sy/weflab-worktrees/query-diet && npx tsx scripts/verify-diet-prod.ts [slug,...]
// 운영 쓰기 0 (GET/HEAD 만). 열쇠는 /Users/sy/upbo-port-v24/.env.local 에서 실행 시점에 읽는다.
import fs from "node:fs";

const envText = fs.readFileSync("/Users/sy/upbo-port-v24/.env.local", "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
process.env.UPBO_TABLE_PREFIX = process.env.UPBO_TABLE_PREFIX || "upbo_alpha_";

async function main() {
const NEW = await import("../lib/upboSupabase");
const OLD = await import("/Users/sy/Documents/Codex/2026-09-09/d/outputs/wardrobe-display-local/lib/upboSupabase");

const prefix = process.env.UPBO_TABLE_PREFIX!;
const only = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);

type Ev = { id?: string; payload: unknown; created_at: string };
const sortItems = <T extends { fanId: string; itemKey: string }>(items: T[]) =>
  [...items].sort((a, b) => `${a.fanId}@@${a.itemKey}`.localeCompare(`${b.fanId}@@${b.itemKey}`));

function stripAllowed(state: Record<string, unknown>, isNew: boolean) {
  const s = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  const catalogs = (s.catalogs as Array<Record<string, unknown>>) ?? [];
  const current = s.currentCatalogVersion;
  s.catalogs = catalogs.map((c) => (c.version === current ? c : { ...c, items: "<stripped>" }));
  const batches = (s.importBatches as Array<Record<string, unknown>>) ?? [];
  s.importBatches = batches.length ? [batches[batches.length - 1]] : [];
  const ms = (s.modifierState as Record<string, unknown>) ?? {};
  s.modifierState = { pendingByViewer: ms.pendingByViewer ?? {}, processedSourceKeys: "<stripped>" };
  // 순서 무관 배열은 정렬해 비교한다. 옛 조회는 created_at 동점의 순서가 DB 임의(실측: 뒤섞임)라
  // 배열 순서 자체는 화면 계약이 아니다(computeHoldings 가 확률·수량·이름으로 다시 정렬).
  const byId = (arr: unknown) => Array.isArray(arr) ? [...arr].sort((a, b) => String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id))) : arr;
  s.upboEntries = byId(s.upboEntries);
  s.itemEvents = byId(s.itemEvents);
  if (Array.isArray(s.deliveryProgress)) {
    s.deliveryProgress = [...(s.deliveryProgress as Array<{ fanId: string; itemKey: string }>)].sort((a, b) => `${a.fanId}@@${a.itemKey}`.localeCompare(`${b.fanId}@@${b.itemKey}`));
  }
  if (Array.isArray(s.archivedFanIds)) s.archivedFanIds = [...(s.archivedFanIds as string[])].sort();
  void isNew;
  return s;
}

function diffKeys(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (out.length > 30) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} vs ${b.length}`); return out; }
    a.forEach((v, i) => diffKeys(v, b[i], `${path}[${i}]`, out));
    return out;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffKeys((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`);
  return out;
}

const streamers = await NEW.supabaseFetchAll<{ id: string; slug: string }>(`/${prefix}streamers?select=id,slug&order=created_at.asc`);
const targets = only.length ? streamers.filter((s) => only.includes(s.slug)) : streamers;
const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
let okA = 0, okB = 0, failA = 0, failB = 0;
const report: string[] = [];

for (const s of targets) {
  // A) 체크포인트 성질 검증(실제 이벤트)
  const events = await NEW.supabaseFetchAll<Ev>(
    `/${prefix}audit_logs?streamer_id=eq.${s.id}&action=eq.delivery_progress_updated&select=id,payload,created_at&order=created_at.asc,id.asc`,
  );
  const full = sortItems(NEW.foldDeliveryEvents(events));
  const splits = new Set<number>([0, events.length, Math.floor(events.length / 2), events.findIndex((e) => e.created_at >= cutoff)].filter((n) => n >= 0));
  let aOk = true;
  for (const split of splits) {
    const cp = JSON.parse(JSON.stringify(NEW.foldDeliveryEvents(events.slice(0, split))));
    const via = sortItems(NEW.foldDeliveryEvents(events.slice(split), cp));
    if (JSON.stringify(via) !== JSON.stringify(full)) { aOk = false; report.push(`[A] ${s.slug} split=${split} 불일치`); }
  }
  aOk ? okA++ : failA++;

  // B) 옛/새 상태 비교
  const [oldState, newState] = await Promise.all([OLD.getStreamerState(s.slug), NEW.getStreamerState(s.slug)]);
  const diffs = diffKeys(stripAllowed(oldState as Record<string, unknown>, false), stripAllowed(newState as Record<string, unknown>, true));
  if (diffs.length === 0) okB++; else { failB++; report.push(`[B] ${s.slug}: ${diffs.slice(0, 5).join(" | ")}`); }
  const oldCat = (oldState as unknown as { catalogs: Array<{ items?: unknown[] }> }).catalogs;
  const newCat = (newState as unknown as { catalogs: Array<{ items?: unknown[] }> }).catalogs;
  console.log(
    `${s.slug.padEnd(14)} 이벤트 ${String(events.length).padStart(4)} 항목 ${String(full.length).padStart(4)} | A ${aOk ? "OK" : "FAIL"} | B ${diffs.length === 0 ? "OK" : "FAIL"} | 카탈로그 ${oldCat.length}버전(items 옛=${oldCat.slice(0, -1).reduce((n, c) => n + (c.items?.length ?? 0), 0)}→새=${newCat.slice(0, -1).reduce((n, c) => n + (c.items?.length ?? 0), 0)})`,
  );
}
console.log(`\nA(체크포인트 성질) OK ${okA} / FAIL ${failA}   B(옛↔새 상태 동일) OK ${okB} / FAIL ${failB}`);
for (const line of report) console.log("  " + line);
process.exit(failA + failB > 0 ? 1 : 0);
}
main();
