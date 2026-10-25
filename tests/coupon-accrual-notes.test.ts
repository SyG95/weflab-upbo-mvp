// 쿠폰 자동 적립 메모(재적립 방지 열쇠) 500자 잘림 수리 — 순수 규칙(lib/couponNotes)과
// 소급 경로 전체(applyCouponBackfill)를 가짜 PostgREST 로 검증한다(2026-10-25 1단계 묶음 2).
// 버그: note 를 500자에서 잘라 저장 → 키 ~17개 넘는 (시청자, 쿠폰)은 같은 기간을 다시 소급하면 이중 적립.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  COUPON_AUTO_NOTE_PREFIX,
  COUPON_NOTE_MAX,
  buildAccrualNote,
  packAccrualKeys,
  parseAutoAccrualNote,
  splitAccrualIntoEvents,
  splitAccrualsByTruncation,
} from "../lib/couponNotes";

// 합성 열쇠(실데이터 uid 와 같은 25자 + "::0", 값은 임의) — 길이 28
const key = (i: number) => `tstuid${String(i).padStart(19, "0")}::0`;
const keys = (n: number, from = 0) => Array.from({ length: n }, (_, i) => key(from + i));

// ---------- 순수 규칙 ----------

test("열쇠 묶기: 순서 유지, 모든 열쇠 정확히 한 번, 메모는 499자 이하", () => {
  assert.equal(key(0).length, 28);
  for (const n of [1, 17, 18, 100]) {
    const packs = packAccrualKeys(keys(n));
    assert.deepEqual(packs.flat(), keys(n), `n=${n} 순서·누락 없음`);
    for (const pack of packs) assert.ok(buildAccrualNote(pack).length <= COUPON_NOTE_MAX, `n=${n} 메모 길이`);
  }
  assert.equal(packAccrualKeys(keys(17)).length, 1, "17개(497자)는 한 줄");
  assert.equal(packAccrualKeys(keys(18)).length, 2, "18개(526자)부터 두 줄");
  assert.deepEqual(packAccrualKeys([]), []);
});

test("이벤트 나누기: 조각별 증가분 합 = 실제 증가분, 이전·다음 잔액이 이어진다", () => {
  const ks = keys(40);
  const slices = splitAccrualIntoEvents({
    sourceKeys: ks,
    parts: ks.map((sourceKey) => ({ sourceKey, delta: 2 })),
    prev: 10,
    next: 90,
  });
  assert.ok(slices.length >= 3);
  assert.equal(slices[0].previous, 10);
  assert.equal(slices.at(-1)!.next, 90);
  for (let i = 1; i < slices.length; i += 1) assert.equal(slices[i].previous, slices[i - 1].next, "잔액 이어짐");
  assert.deepEqual(slices.flatMap((s) => s.sourceKeys), ks);
  for (const s of slices) {
    assert.ok(s.note.length <= COUPON_NOTE_MAX);
    assert.equal(s.next - s.previous, s.sourceKeys.length * 2, "조각 증가분 = 그 조각 열쇠들의 몫");
  }
});

test("이벤트 나누기: 상한에 걸려 실제 증가분이 작으면 앞 조각부터 채우고 뒤 조각은 0", () => {
  const ks = keys(40);
  const slices = splitAccrualIntoEvents({ sourceKeys: ks, parts: ks.map((sourceKey) => ({ sourceKey, delta: 1 })), prev: 0, next: 20 });
  assert.equal(slices.reduce((sum, s) => sum + (s.next - s.previous), 0), 20);
  assert.equal(slices[0].next - slices[0].previous, Math.min(20, slices[0].sourceKeys.length));
  assert.equal(slices.at(-1)!.next - slices.at(-1)!.previous, 0, "마지막 조각은 0이어도 열쇠는 남긴다(재적립 방지)");
});

test("이벤트 나누기: 열쇠 없음·키별 몫 없음 경계", () => {
  assert.deepEqual(splitAccrualIntoEvents({ sourceKeys: [], prev: 3, next: 5 }), [
    { sourceKeys: [], previous: 3, next: 5, note: COUPON_AUTO_NOTE_PREFIX },
  ]);
  const ks = keys(20);
  const slices = splitAccrualIntoEvents({ sourceKeys: ks, prev: 0, next: 7 });
  assert.equal(slices[0].next - slices[0].previous, 7, "몫을 모르면 첫 조각에 몰아 담음");
  assert.equal(slices.reduce((sum, s) => sum + (s.next - s.previous), 0), 7);
});

test("메모 해석: 500자 미만은 그대로, 500자 이상(옛 잘림)은 마지막 조각을 버리고 truncated", () => {
  assert.equal(parseAutoAccrualNote("수동 지급"), null);
  assert.equal(parseAutoAccrualNote(null), null);
  assert.deepEqual(parseAutoAccrualNote(buildAccrualNote(keys(3))), { keys: keys(3), truncated: false });
  // 옛 코드가 쓰던 방식 그대로 30개를 잘라 저장한 메모
  const oldNote = buildAccrualNote(keys(30)).slice(0, 500);
  assert.equal(oldNote.length, 500);
  const parsed = parseAutoAccrualNote(oldNote)!;
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.keys.length < 30, "뒤쪽 열쇠는 잃어버렸다");
  assert.deepEqual(parsed.keys, keys(parsed.keys.length), "남은 건 앞쪽 온전한 열쇠뿐(잘린 조각 제거)");
  assert.equal(parseAutoAccrualNote(`${COUPON_AUTO_NOTE_PREFIX}${"x".repeat(494)}`)!.truncated, false, "499자는 온전");
});

test("확인 불가 가르기: 잘린 적립 시각 이전(또는 시각 모름) 당첨만 빼고, 다른 쌍은 그대로", () => {
  const a = {
    viewerKey: "v1",
    nickname: "팬1",
    accountId: "v1",
    itemKey: "gold",
    itemName: "골드",
    delta: 4,
    sourceKeys: ["k1", "k2", "k3", "k4"],
    parts: ["k1", "k2", "k3", "k4"].map((sourceKey) => ({ sourceKey, delta: 1 })),
  };
  const b = { ...a, viewerKey: "v2", accountId: "v2", sourceKeys: ["k9"], parts: [{ sourceKey: "k9", delta: 1 }], delta: 1 };
  const created = new Map<string, string | undefined>([
    ["k1", "2026-10-01T00:00:00Z"],
    ["k2", "2026-10-02T00:00:00Z"],
    ["k3", "2026-10-20T00:00:00Z"],
    ["k4", undefined],
    ["k9", "2026-10-01T00:00:00Z"],
  ]);
  const { certain, uncertain } = splitAccrualsByTruncation(
    [a, b],
    [{ viewerKey: "v1", itemKey: "gold", createdAt: "2026-10-10T00:00:00Z" }],
    created,
  );
  assert.deepEqual(
    certain.map((c) => ({ v: c.viewerKey, d: c.delta, k: c.sourceKeys })),
    [
      { v: "v1", d: 1, k: ["k3"] },
      { v: "v2", d: 1, k: ["k9"] },
    ],
  );
  assert.deepEqual(uncertain.map((u) => ({ v: u.viewerKey, n: u.entryCount, d: u.delta })), [{ v: "v1", n: 3, d: 3 }]);
});

// ---------- 소급 경로 전체(가짜 PostgREST) ----------

type Row = Record<string, unknown>;

const db = {
  entries: [] as Row[],
  itemEvents: [] as Row[],
  audit: [] as Row[],
  couponEvents: [] as Row[],
  balances: [] as Row[],
  clock: Date.parse("2026-10-25T00:00:00Z"),
};

function eqv(q: URLSearchParams, k: string) {
  return q.get(k)?.replace(/^eq\./, "");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  const body = text ? JSON.parse(text) : null;
  const q = url.searchParams;
  res.setHeader("content-type", "application/json");
  const send = (status: number, value: unknown) => {
    if (Array.isArray(value) && String(req.headers.prefer ?? "").includes("count=exact")) {
      res.setHeader("content-range", `0-${Math.max(0, value.length - 1)}/${value.length}`);
    }
    res.statusCode = status;
    res.end(value === "" ? "" : JSON.stringify(value));
  };
  const sid = eqv(q, "streamer_id");
  if (q.get("or")) return send(200, []); // 첫 페이지에 전부 담아 주므로 다음 페이지는 비어 있다
  switch (url.pathname) {
    case "/rest/v1/upbo_entries":
      return send(200, db.entries.filter((r) => r.streamer_id === sid));
    case "/rest/v1/upbo_item_events":
      return send(200, db.itemEvents.filter((r) => r.streamer_id === sid));
    case "/rest/v1/audit_logs": {
      const action = eqv(q, "action");
      const rows = db.audit
        .filter((r) => r.streamer_id === sid && r.action === action)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return send(200, rows.slice(0, Number(q.get("limit") ?? "1000")));
    }
    case "/rest/v1/coupon_events": {
      if (req.method === "POST") {
        for (const r of Array.isArray(body) ? body : [body]) db.couponEvents.push({ id: `e${db.couponEvents.length}`, ...r });
        return send(201, "");
      }
      const createdBy = eqv(q, "created_by");
      return send(
        200,
        db.couponEvents.filter((r) => r.streamer_id === sid && (!createdBy || r.created_by === createdBy)),
      );
    }
    case "/rest/v1/coupon_balances": {
      if (req.method === "POST") {
        for (const r of Array.isArray(body) ? body : [body]) {
          const cur = db.balances.find(
            (b) => b.streamer_id === r.streamer_id && b.viewer_key === r.viewer_key && b.item_key === r.item_key,
          );
          if (cur) Object.assign(cur, r);
          else db.balances.push({ ...r });
        }
        return send(201, "");
      }
      return send(200, db.balances.filter((r) => r.streamer_id === sid));
    }
    default:
      return send(200, []);
  }
});

let lib: typeof import("../lib/upboSupabase");

test.before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.UPBO_TABLE_PREFIX = "";
  lib = await import("../lib/upboSupabase");
});

test.after(() => {
  server.close();
});

const STREAMER = { id: "s-c", slug: "ccc", display_name: "C", threshold_percent: 2 } as Parameters<
  typeof import("../lib/upboSupabase").applyCouponBackfill
>[0];

function entry(i: number, viewer: string, createdAt: string): Row {
  return {
    id: `en-${viewer}-${i}`,
    streamer_id: "s-c",
    source_key: key(i),
    status: "pending",
    item_name: "황금 열쇠",
    fan_id: viewer,
    fan_nickname: `닉-${viewer}`,
    donate_time_text: "2026-10-01 12:00:00",
    donation_type: "별풍선",
    admin_note: "",
    created_at: createdAt,
  };
}

function seedCouponSetup() {
  db.audit = [
    {
      streamer_id: "s-c",
      action: "coupon_items_updated",
      created_at: "2026-09-01T00:00:00Z",
      payload: { items: [{ key: "gold", name: "골드쿠폰" }] },
    },
    {
      streamer_id: "s-c",
      action: "coupon_source_map_updated",
      created_at: "2026-09-01T00:00:00Z",
      payload: { map: [{ itemKey: "gold", sources: [{ itemName: "황금 열쇠", per: 1 }] }] },
    },
  ];
}

const balanceOf = (viewer: string) =>
  Number(db.balances.find((b) => b.viewer_key === viewer && b.item_key === "gold")?.balance ?? 0);

test("옛 잘린 메모가 있는 시청자: 그 이전 당첨은 '확인 불가'로 빠지고 다시 적립되지 않는다", async () => {
  seedCouponSetup();
  db.entries = Array.from({ length: 30 }, (_, i) => entry(i, "viewer1", `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`));
  db.itemEvents = [];
  // 수리 전 코드가 남긴 자동 적립 1줄(30개를 한 줄에, 500자에서 잘림)
  db.couponEvents = [
    {
      id: "old-1",
      streamer_id: "s-c",
      viewer_key: "viewer1",
      item_key: "gold",
      delta: 30,
      action_type: "grant",
      created_by: "auto",
      created_at: "2026-10-02T00:00:00Z",
      note: buildAccrualNote(keys(30)).slice(0, 500),
    },
  ];
  db.balances = [{ streamer_id: "s-c", viewer_key: "viewer1", item_key: "gold", item_name: "골드쿠폰", balance: 30 }];

  const preview = await lib.previewCouponBackfill(STREAMER, {});
  const keptByNote = parseAutoAccrualNote(buildAccrualNote(keys(30)).slice(0, 500))!.keys.length;
  assert.equal(preview.alreadyAccruedCount, keptByNote, "메모에 남은 열쇠만 '이미 적립'");
  assert.equal(preview.uncertainCount, 30 - keptByNote, "잘려 나간 열쇠의 당첨은 확인 불가");
  assert.equal(preview.totalDelta, 0, "수리 전엔 여기서 다시 쌓였다 — 이제 0");
  assert.deepEqual(preview.uncertainRows.map((r) => [r.viewerKey, r.itemKey, r.entryCount]), [["viewer1", "gold", 30 - keptByNote]]);

  const applied = await lib.applyCouponBackfill(STREAMER, {});
  assert.equal(applied.totalDelta, 0);
  assert.equal(balanceOf("viewer1"), 30, "잔액 그대로(이중 적립 0)");
});

test("수리 뒤 새 적립: 열쇠 40개도 메모가 잘리지 않아, 같은 기간을 두 번 소급해도 재적립 0", async () => {
  seedCouponSetup();
  db.entries = Array.from({ length: 40 }, (_, i) => entry(100 + i, "viewer2", "2026-10-20T00:00:00Z"));
  db.itemEvents = [];
  db.couponEvents = [];
  db.balances = [];

  const first = await lib.applyCouponBackfill(STREAMER, {});
  assert.equal(first.totalDelta, 40);
  assert.equal(first.accrued, 1, "적립 수는 (시청자, 쿠폰) 단위 그대로");
  assert.equal(balanceOf("viewer2"), 40);
  const grants = db.couponEvents.filter((e) => e.viewer_key === "viewer2" && e.action_type === "grant");
  assert.ok(grants.length >= 3, "메모 길이 때문에 여러 줄로 나뉜다");
  for (const g of grants) assert.ok(String(g.note).length < 500, "모든 메모가 500자 미만");
  assert.equal(
    grants.reduce((sum, g) => sum + Number(g.delta), 0),
    40,
    "줄별 증가분 합 = 실제 증가분",
  );
  const recovered = new Set(grants.flatMap((g) => parseAutoAccrualNote(String(g.note))!.keys));
  assert.equal(recovered.size, 40, "40개 열쇠 전부 되찾을 수 있다");

  const second = await lib.applyCouponBackfill(STREAMER, {});
  assert.equal(second.totalDelta, 0, "두 번째 소급은 재적립 0");
  assert.equal(second.preview.alreadyAccruedCount, 40);
  assert.equal(balanceOf("viewer2"), 40);
});

test("잘린 메모 시각 이후에 생긴 당첨은 정상 적립된다", async () => {
  seedCouponSetup();
  db.entries = [
    ...Array.from({ length: 30 }, (_, i) => entry(i, "viewer1", `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`)),
    ...Array.from({ length: 5 }, (_, i) => entry(200 + i, "viewer1", "2026-10-21T00:00:00Z")),
  ];
  db.itemEvents = [];
  db.couponEvents = [
    {
      id: "old-1",
      streamer_id: "s-c",
      viewer_key: "viewer1",
      item_key: "gold",
      delta: 30,
      action_type: "grant",
      created_by: "auto",
      created_at: "2026-10-02T00:00:00Z",
      note: buildAccrualNote(keys(30)).slice(0, 500),
    },
  ];
  db.balances = [{ streamer_id: "s-c", viewer_key: "viewer1", item_key: "gold", item_name: "골드쿠폰", balance: 30 }];
  const applied = await lib.applyCouponBackfill(STREAMER, {});
  assert.equal(applied.totalDelta, 5, "새 당첨 5건만 적립");
  assert.equal(balanceOf("viewer1"), 35);
});
