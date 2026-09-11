// 조회 다이어트(2026-09-11) 순수 로직 테스트:
//  1) foldDeliveryEvents — fold(all) === fold(rest, fold(prefix)) (체크포인트 정확성의 근거)
//  2) mergeCatalogRows — 옛 버전 items=[]·최신 버전 전체 행
//  3) supabaseFetchAll — 1,000행 페이지 순회·id 중복 제거·마지막 페이지 판정
import test, { before } from "node:test";
import assert from "node:assert/strict";

// lib/upboSupabase 는 import 시점에 env 를 읽으므로(정적 import 는 호이스팅됨) before 훅에서 동적 import 한다.
type Lib = typeof import("../lib/upboSupabase");
let foldDeliveryEvents: Lib["foldDeliveryEvents"];
let mergeCatalogRows: Lib["mergeCatalogRows"];
let supabaseFetchAll: Lib["supabaseFetchAll"];
let PAGE_CREATED_ASC: Lib["PAGE_CREATED_ASC"];
let PAGE_CREATED_DESC: Lib["PAGE_CREATED_DESC"];
before(async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-key";
  const lib = await import("../lib/upboSupabase");
  foldDeliveryEvents = lib.foldDeliveryEvents;
  mergeCatalogRows = lib.mergeCatalogRows;
  supabaseFetchAll = lib.supabaseFetchAll;
  PAGE_CREATED_ASC = lib.PAGE_CREATED_ASC;
  PAGE_CREATED_DESC = lib.PAGE_CREATED_DESC;
});

type Ev = { payload: unknown; created_at: string };

function ev(at: string, items: Array<Record<string, unknown>>): Ev {
  return { payload: { items }, created_at: at };
}

// 결정적 의사난수(재현 가능)
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function randomEvents(seed: number, n: number): Ev[] {
  const r = rng(seed);
  const fans = ["a1", "b2", "c3", "(d4)", "e5"];
  const keys = ["치킨@@1@@33", "커피@@5@@33", "굿즈@@0.5@@330", "노래@@2@@33"];
  const out: Ev[] = [];
  const t0 = Date.parse("2026-08-01T00:00:00Z");
  for (let i = 0; i < n; i += 1) {
    const count = 1 + Math.floor(r() * 3);
    const items: Array<Record<string, unknown>> = [];
    for (let k = 0; k < count; k += 1) {
      items.push({
        fanId: fans[Math.floor(r() * fans.length)],
        fanNickname: `닉${Math.floor(r() * 3)}`,
        itemKey: keys[Math.floor(r() * keys.length)],
        itemName: "상품",
        probability: Math.floor(r() * 10),
        amountRangeLabel: r() < 0.5 ? "33" : "330",
        processedCount: Math.floor(r() * 4), // 0 포함(처리 취소)
      });
    }
    // 옛 통째 스냅샷(8/26 이전)처럼 큰 이벤트도 섞는다
    if (i % 7 === 0) for (const f of fans) items.push({ fanId: f, itemKey: keys[0], itemName: "상품", processedCount: Math.floor(r() * 2) });
    out.push(ev(new Date(t0 + i * 60_000).toISOString(), items));
  }
  return out;
}

function sortItems<T extends { fanId: string; itemKey: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => `${a.fanId}@@${a.itemKey}`.localeCompare(`${b.fanId}@@${b.itemKey}`));
}

test("foldDeliveryEvents: 체크포인트 분할과 전량 접기가 같다(모든 분할점)", () => {
  for (const seed of [1, 7, 42, 2026]) {
    const all = randomEvents(seed, 60);
    const full = sortItems(foldDeliveryEvents(all));
    for (let split = 0; split <= all.length; split += 1) {
      const checkpoint = foldDeliveryEvents(all.slice(0, split)); // 체크포인트 = 접은 답(>0 만)
      const viaCheckpoint = sortItems(foldDeliveryEvents(all.slice(split), checkpoint));
      assert.deepEqual(viaCheckpoint, full, `seed=${seed} split=${split}`);
    }
  }
});

test("foldDeliveryEvents: 체크포인트가 JSON 왕복(직렬화→역직렬화)돼도 같다", () => {
  const all = randomEvents(9, 40);
  const full = sortItems(foldDeliveryEvents(all));
  const cp = JSON.parse(JSON.stringify(foldDeliveryEvents(all.slice(0, 25))));
  const restored = sortItems(foldDeliveryEvents(all.slice(25), cp));
  assert.deepEqual(restored, full);
});

test("foldDeliveryEvents: 항목 updatedAt 은 그 항목을 마지막으로 바꾼 이벤트 시각", () => {
  const rows = [
    ev("2026-08-01T00:00:00Z", [{ fanId: "a1", itemKey: "k", itemName: "x", processedCount: 1 }]),
    ev("2026-08-02T00:00:00Z", [{ fanId: "b2", itemKey: "k", itemName: "x", processedCount: 2 }]),
  ];
  const full = foldDeliveryEvents(rows);
  assert.equal(full.find((i) => i.fanId === "a1")?.updatedAt, "2026-08-01T00:00:00Z");
  const cp = foldDeliveryEvents(rows.slice(0, 1));
  const via = foldDeliveryEvents(rows.slice(1), cp);
  assert.equal(via.find((i) => i.fanId === "a1")?.updatedAt, "2026-08-01T00:00:00Z");
  assert.equal(via.find((i) => i.fanId === "b2")?.updatedAt, "2026-08-02T00:00:00Z");
});

test("foldDeliveryEvents: 0 으로 되돌린 항목은 결과에서 빠지고, 다시 올리면 돌아온다", () => {
  const rows = [
    ev("2026-08-01T00:00:00Z", [{ fanId: "a1", itemKey: "k", itemName: "x", processedCount: 3 }]),
    ev("2026-08-02T00:00:00Z", [{ fanId: "a1", itemKey: "k", itemName: "x", processedCount: 0 }]),
  ];
  assert.equal(foldDeliveryEvents(rows).length, 0);
  const cp = foldDeliveryEvents(rows); // 빈 체크포인트
  const later = ev("2026-08-03T00:00:00Z", [{ fanId: "a1", itemKey: "k", itemName: "x", processedCount: 1 }]);
  assert.equal(foldDeliveryEvents([later], cp)[0]?.processedCount, 1);
});

test("mergeCatalogRows: 옛 버전은 items=[]·raw=null, 최신 버전은 전체 행", () => {
  const slim = [
    { id: "c1", streamer_id: "s", version: 1, groups: [{ groupIndex: 0 }], item_count: 5 },
    { id: "c2", streamer_id: "s", version: 2, groups: [{ groupIndex: 0 }], item_count: 6 },
  ] as unknown as Parameters<typeof mergeCatalogRows>[0];
  const full = { id: "c2", streamer_id: "s", version: 2, groups: [{ groupIndex: 0 }], items: [{ itemName: "x" }], raw: { r: 1 } } as unknown as Parameters<typeof mergeCatalogRows>[1];
  const merged = mergeCatalogRows(slim, full);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].items, []);
  assert.equal(merged[0].raw, null);
  assert.equal(merged[1], full);
  // 최신 행이 없으면(빈 카탈로그) 그대로
  assert.equal(mergeCatalogRows(slim, undefined)[1].items instanceof Array, true);
});

test("foldDeliveryEvents: 겹침 창 재적용은 멱등 — 체크포인트 이전 60초 구간을 다시 접어도 같다", () => {
  for (const seed of [3, 11, 99]) {
    const all = randomEvents(seed, 80); // 1분 간격 이벤트
    const full = sortItems(foldDeliveryEvents(all));
    for (const cut of [10, 40, 79]) {
      const coversThrough = all[cut].created_at;
      const cp = JSON.parse(JSON.stringify(foldDeliveryEvents(all.filter((e) => e.created_at <= coversThrough))));
      const since = new Date(Date.parse(coversThrough) - 60_000).toISOString(); // overlapSince 와 동일 규칙
      const replay = all.filter((e) => e.created_at > since); // 겹침 구간(이미 접힌 이벤트 포함) + 이후
      assert.deepEqual(sortItems(foldDeliveryEvents(replay, cp)), full, `seed=${seed} cut=${cut}`);
    }
  }
});

test("keysetCursorFilter: PostgREST or=() 커서 문법과 '+' 인코딩", async () => {
  const lib = await import("../lib/upboSupabase");
  const f = lib.keysetCursorFilter(lib.PAGE_CREATED_DESC, { created_at: "2026-09-11T08:32:33.802+00:00", id: "abc" });
  assert.equal(f, "or=(created_at.lt.2026-09-11T08%3A32%3A33.802%2B00%3A00,and(created_at.eq.2026-09-11T08%3A32%3A33.802%2B00%3A00,id.lt.abc))");
  const g = lib.keysetCursorFilter(lib.PAGE_CREATED_ASC, { created_at: "2026-01-01T00:00:00Z", id: "x" });
  assert.equal(g, "or=(created_at.gt.2026-01-01T00%3A00%3A00Z,and(created_at.eq.2026-01-01T00%3A00%3A00Z,id.gt.x))");
  assert.equal(lib.keysetCursorFilter(lib.PAGE_CREATED_ASC, { created_at: null, id: "x" }), null);
});

// 커서 문법을 해석하는 가짜 PostgREST — 페이지 사이에 행이 지워져도 건너뜀이 없는지 본다.
function fakeServer(rows: Array<{ id: string; created_at: string; n: number }>, dir: "asc" | "desc") {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.search);
    const limit = Number(url.searchParams.get("limit") || 1000);
    const or = url.searchParams.get("or");
    let data = [...rows].sort((a, b) => (a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) * (dir === "desc" ? -1 : 1));
    if (or) {
      const m = or.match(/^\(created_at\.(lt|gt)\.([^,]+),and\(created_at\.eq\.([^,]+),id\.(lt|gt)\.([^)]+)\)\)$/);
      assert.ok(m, `커서 형식: ${or}`);
      const [, op, ca, , , id] = m;
      data = data.filter((r) => (op === "lt" ? r.created_at < ca || (r.created_at === ca && r.id < id) : r.created_at > ca || (r.created_at === ca && r.id > id)));
    }
    return new Response(JSON.stringify(data.slice(0, limit)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("supabaseFetchAll: 키셋 커서로 1,000행 페이지를 이어 받고, 사이에 앞쪽 행이 지워져도 건너뜀이 없다", async () => {
  const total = 2503;
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, created_at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`, n: i }));
  const { calls, fetchImpl } = fakeServer(rows, "desc");
  const origFetch = globalThis.fetch;
  let deleted = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const res = await fetchImpl(input);
    // 첫 페이지 응답 직후 "앞쪽" 행 하나(가장 최신, desc 정렬의 1번째)를 삭제 — offset 방식이면 1,001번째가 밀려 건너뛰어진다
    if (!deleted) { deleted = true; rows.splice(rows.findIndex((r) => r.n === total - 1), 1); }
    return res;
  }) as typeof fetch;
  try {
    const got = await supabaseFetchAll<{ id: string; created_at: string; n: number }>("/upbo_alpha_upbo_entries?streamer_id=eq.x&select=*", PAGE_CREATED_DESC);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].includes("order=created_at.desc%2Cid.desc") || calls[0].includes("order=created_at.desc,id.desc"));
    assert.ok(calls[1].includes("or="), "2페이지부터 커서 필터");
    const ids = new Set(got.map((r) => r.id));
    assert.equal(ids.size, got.length, "중복 없음");
    assert.equal(got.length, total, "1페이지에 이미 담긴 행은 유지, 이후 페이지는 건너뜀 없이 전부");
    const ns = got.map((r) => r.n).sort((a, b) => a - b);
    assert.equal(ns[0], 0); assert.equal(ns[ns.length - 1], total - 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("supabaseFetchAll: 첫 페이지가 1,000행 미만이면 요청 1회로 끝난다", async () => {
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify([{ id: "a", created_at: "2026-01-01T00:00:00Z" }, { id: "b", created_at: "2026-01-01T00:00:01Z" }]), { status: 200 });
  }) as typeof fetch;
  try {
    const got = await supabaseFetchAll<{ id: string; created_at: string }>("/t?select=*", PAGE_CREATED_ASC);
    assert.equal(calls, 1);
    assert.equal(got.length, 2);
  } finally {
    globalThis.fetch = origFetch;
  }
});
