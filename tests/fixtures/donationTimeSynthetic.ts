// 후원 시점 근사 다시판정(1단계 묶음 3) 합성 시험 데이터 — 실명·계정ID 0(전부 지어낸 값).
// 모양은 10/24 검수 사례(표 3버전·170 표 예외 45→40%·꺼진 상품·늦게 몰려 들어온 원본)를 따라 했지만 시각·상품명은 바꿨고,
// 🟢 엄격 조건 G1~G12 반례를 한 줄씩 섞었다. 단위 테스트와 로컬 미러 보강(합성 슬러그)이 같은 데이터를 쓴다.
// 행 모양은 DB 그대로(snake_case) — 가짜 PostgREST·미러가 바로 돌려줄 수 있게.
import { normalizeCatalogCapture } from "../../lib/upboCore";

export const SYNTH_STREAMER = {
  id: "5e1f0000-0000-4000-8000-000000000001",
  slug: "asof-demo",
  display_name: "근사판정 시험",
  threshold_percent: 10,
  created_at: "2026-09-17T02:00:00.000Z",
  updated_at: "2026-10-25T09:40:56.000Z",
};

const SID = SYNTH_STREAMER.id;
const kst = (text: string) => new Date(`${text}+09:00`).toISOString();
const uuid = (n: number) => `5e1f0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Table = { amount: number; items: Array<[string, number]>; enabled?: boolean };

function catalogRow(n: number, version: number, capturedKst: string, tables: Table[]) {
  const normalized = normalizeCatalogCapture({
    capturedAt: kst(capturedKst),
    groups: tables.map((t) => ({
      amountMin: t.amount,
      amountMax: t.amount,
      enabled: t.enabled ?? true,
      items: t.items.map(([name, probability], idx) => ({ name, probability, sortOrder: idx })),
    })),
  });
  return {
    id: uuid(100 + n),
    streamer_id: SID,
    version,
    display_name: null,
    amount_set_label: null,
    source_url: "https://example.invalid/roulette",
    captured_at: normalized.capturedAt,
    created_at: normalized.capturedAt,
    group_count: normalized.groupCount,
    item_count: normalized.itemCount,
    probability_sums: normalized.probabilitySums,
    warnings: normalized.warnings,
    groups: normalized.groups,
    items: normalized.items,
    raw: null,
  };
}

const T170: Table = { amount: 170, items: [["손편지", 1], ["간식!", 40], ["영상편지", 45], ["꽝", 14]] };
const T330v1: Table = { amount: 330, items: [["영상 단컷", 5], ["네컷", 10], ["응원", 85]] };
const T330v2: Table = { amount: 330, items: [["영상 단컷", 4], ["네컷", 11], ["응원", 85]] };

export const SYNTH_CATALOGS = [
  catalogRow(1, 1, "2026-09-17T12:00:00", [
    { amount: 33, items: [["윙크", 15], ["볼풍선", 15], ["혀내밀기", 13.5], ["사진10장", 2], ["짧은영상", 1], ["볼찌르기", 1], ["하트", 52.5]] },
    T330v1,
    T170,
  ]),
  catalogRow(2, 2, "2026-09-20T06:10:00", [
    { amount: 33, items: [["윙크", 15], ["볼풍선", 15], ["혀내밀기", 13.5], ["사진10장", 2], ["짧은영상", 1], ["볼찌르기", 1], ["하트뿅뿅", 1], ["하트", 51.5]] },
    T330v2,
    T170,
  ]),
  // 위플랩 10/24 12:38:05 수정 → 12:41:30 가져옴: 짧은영상 1→2%, 사진10장 2% → "사진 1장" 3%
  catalogRow(3, 3, "2026-10-24T12:41:30", [
    { amount: 33, items: [["윙크", 15], ["볼풍선", 15], ["혀내밀기", 13.5], ["사진 1장", 3], ["짧은영상", 2], ["볼찌르기", 1], ["하트뿅뿅", 1], ["하트", 49.5]] },
    T330v2,
    T170,
  ]),
];

let auditSeq = 200;
function audit(action: string, atKst: string, payload: unknown, actor = "sheet_admin") {
  auditSeq += 1;
  return { id: uuid(auditSeq), streamer_id: SID, action, actor, payload, created_at: kst(atKst) };
}

function link(atKst: string, modified: string) {
  return audit("weflab_link_updated", atKst, {
    link: { url: "https://example.invalid/roulette", lastFetchedAt: kst(atKst), lastModifiedText: modified, lastTableCount: 3, lastItemCount: 15 },
  }, "operator");
}

export const SYNTH_AUDITS = [
  link("2026-09-17T12:00:05", "2026년 09월 06일 18시 31분 10초"),
  audit("catalog_usage_updated", "2026-09-17T13:00:00", { catalogVersion: 1, overrides: { "g2-i1": false } }, "extension"), // 간식! 꺼짐
  audit("threshold_overrides_updated", "2026-09-18T00:00:00", { overrides: { "170": 45 } }),
  audit("signature_counts_updated", "2026-09-18T00:10:00", { counts: [330] }),
  link("2026-09-20T06:10:05", "2026년 09월 20일 05시 48분 20초"),
  link("2026-10-24T12:41:35", "2026년 10월 24일 12시 38분 05초"),
  audit("threshold_overrides_updated", "2026-10-24T12:50:00", { overrides: { "170": 40 } }),
  audit("item_alias_updated", "2026-10-24T13:00:00", { aliases: { "33::하트뿅::1": { itemName: "하트뿅뿅", probability: 1 } } }),
  link("2026-10-25T09:00:05", "2026년 10월 24일 12시 38분 05초"), // 같은 내용 다시 가져옴(새 구간 아님)
  audit("threshold_percent_updated", "2026-10-25T18:20:00", { before: 10, after: 10, source: "baseline" }, "operator"),
  // v3 저장본(간식!·볼찌르기 꺼짐) — 10/26 이후라 그 전 후원은 v1 저장본 승계(간식!만 꺼짐)로 판정된다
  audit("catalog_usage_updated", "2026-10-26T10:00:00", { catalogVersion: 3, overrides: { "g2-i1": false, "g0-i5": false } }, "extension"),
];

export const SYNTH_BATCHES = [
  { id: uuid(301), streamer_id: SID, catalog_version: 1, threshold_percent: 10, applied_at: kst("2026-09-17T22:40:00"), captured_at: kst("2026-09-17T22:40:00"), summary: {}, entry_count: 1, source_url: null },
  { id: uuid(302), streamer_id: SID, catalog_version: 2, threshold_percent: 10, applied_at: kst("2026-10-17T15:30:00"), captured_at: kst("2026-10-17T15:30:00"), summary: {}, entry_count: 1, source_url: null },
  { id: uuid(303), streamer_id: SID, catalog_version: 3, threshold_percent: 10, applied_at: kst("2026-10-24T23:05:00"), captured_at: kst("2026-10-24T23:05:00"), summary: {}, entry_count: 1, source_url: null },
];

// 기대 분류(정답): kind new=새로 기록될 것, existing=이미 기록, review=검토, excluded=제외.
export type SynthExpect = {
  label: string;
  kind: "new" | "existing" | "review" | "excluded" | "suspected";
  cls?: "green" | "yellow";
  reasonIncludes?: string;
  hiddenOnFan?: boolean;
};

type SynthResult = {
  uid: string;
  time: string;
  viewer: number;
  amount: number;
  item: string;
  prob: number | null;
  type?: string;
};

function captureRow(r: SynthResult) {
  const v = String(r.viewer).padStart(2, "0");
  return {
    sourceUid: r.uid,
    donateTimeText: r.time,
    donationType: r.type ?? "별풍선",
    donationAmount: r.amount,
    donationAmountText: `${r.amount}개`,
    fanNickname: `시청자${v}`,
    fanId: `viewer${v}`,
    results: [{ name: r.item, probability: r.prob, index: 0, total: 1, rawText: r.prob === null ? r.item : `(${r.prob}%) ${r.item}` }],
  };
}

// 결과 한 줄 + 정답. uid 는 전부 지어낸 값(synth…).
export const SYNTH_RESULTS: Array<SynthResult & { batch: 1 | 2 | 3 | 4; expect: SynthExpect }> = [
  { batch: 1, uid: "synth0001", time: "2026-09-17 22:00:00", viewer: 16, amount: 170, item: "손편지", prob: 1, expect: { label: "그때 이미 기록", kind: "existing" } },
  { batch: 1, uid: "synth0002", time: "2026-09-10 20:00:00", viewer: 17, amount: 33, item: "사진10장", prob: 2, expect: { label: "첫 표 저장 전 후원(G4)", kind: "new", cls: "yellow", reasonIncludes: "아직 저장돼 있지 않았어요" } },
  { batch: 2, uid: "synth0003", time: "2026-10-16 20:00:00", viewer: 18, amount: 33, item: "짧은영상", prob: 1, expect: { label: "실시간 기록분", kind: "existing" } },
  // ── 10/24 23:05 늦게 몰려 들어온 원본(10/17~10/24) ──
  { batch: 3, uid: "synth0101", time: "2026-10-21 19:12:40", viewer: 1, amount: 33, item: "사진10장", prob: 2, expect: { label: "늦은 수집 누락 ①", kind: "new", cls: "green" } },
  { batch: 3, uid: "synth0102", time: "2026-10-23 17:05:13", viewer: 2, amount: 33, item: "짧은영상", prob: 1, expect: { label: "늦은 수집 누락 ②", kind: "new", cls: "green" } },
  { batch: 3, uid: "synth0103", time: "2026-10-18 21:00:00", viewer: 3, amount: 33, item: "윙크", prob: 15, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0104", time: "2026-10-18 21:01:00", viewer: 3, amount: 33, item: "볼풍선", prob: 15, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0105", time: "2026-10-18 21:02:00", viewer: 3, amount: 33, item: "윙크", prob: 15, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0106", time: "2026-10-18 21:03:00", viewer: 3, amount: 33, item: "볼풍선", prob: 15, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0107", time: "2026-10-23 16:51:00", viewer: 2, amount: 33, item: "혀내밀기", prob: 13.5, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0108", time: "2026-10-19 22:00:00", viewer: 4, amount: 33, item: "윙크", prob: 15, expect: { label: "기준 초과", kind: "excluded" } },
  { batch: 3, uid: "synth0109", time: "2026-10-22 21:00:00", viewer: 5, amount: 33, item: "짧은 영상", prob: 1, expect: { label: "G1 띄어쓰기", kind: "new", cls: "yellow", reasonIncludes: "표기가 표와 조금 달라요" } },
  { batch: 3, uid: "synth0110", time: "2026-10-24 12:40:00", viewer: 6, amount: 33, item: "짧은영상", prob: 2, expect: { label: "G4 표 바뀌는 중", kind: "new", cls: "yellow", reasonIncludes: "바뀌는 중이었어요" } },
  { batch: 3, uid: "synth0111", time: "2026-10-20 22:00:00", viewer: 7, amount: 33, item: "사진10장", prob: 2, expect: { label: "G11 수동기록 겹침", kind: "new", cls: "yellow", reasonIncludes: "수동기록과 같은 건일 수 있어요" } },
  { batch: 3, uid: "synth0112", time: "2026-10-22 22:30:00", viewer: 8, amount: 330, item: "영상 단컷", prob: 4, expect: { label: "G8 정가 금액", kind: "new", cls: "yellow", reasonIncludes: "정가 금액과 같아요" } },
  { batch: 3, uid: "synth0113", time: "2026-10-23 20:00:00", viewer: 10, amount: 33, item: "하트뿅", prob: 1, expect: { label: "G12 이름 연결", kind: "new", cls: "yellow", reasonIncludes: "이름 연결로 맞춘" } },
  { batch: 3, uid: "synth0114", time: "2026-10-22 23:00:00", viewer: 11, amount: 33, item: "볼찌르기", prob: 1, expect: { label: "G10 키 흔들림", kind: "new", cls: "yellow", reasonIncludes: "다른 상품으로 잡힌 적" } },
  { batch: 3, uid: "synth0115", time: "2026-10-23 21:00:00", viewer: 12, amount: 33, item: "수수께끼", prob: 1, expect: { label: "어느 표에도 없음", kind: "review" } },
  { batch: 3, uid: "synth0116", time: "2026-10-24 17:55:00", viewer: 13, amount: 33, item: "짧은영상", prob: 2, expect: { label: "실시간 기록분(새 표)", kind: "existing" } },
  { batch: 3, uid: "synth0117", time: "2026-10-22 20:00:00", viewer: 14, amount: 170, item: "간식!", prob: 40, expect: { label: "그때 꺼진 상품인데 기록됨", kind: "suspected" } },
  { batch: 3, uid: "synth0118", time: "2026-10-22 19:00:00", viewer: 15, amount: 170, item: "영상편지", prob: 45, expect: { label: "170 표 그때 예외 45%", kind: "new", cls: "green" } },
  // ── 10/25 23:00 다음 원본: 같은 결과가 또 담기고(1건은 다른 상품으로), 새 결과 1건 ──
  { batch: 4, uid: "synth0101", time: "2026-10-21 19:12:40", viewer: 1, amount: 33, item: "사진10장", prob: 2, expect: { label: "중복(같은 값)", kind: "new", cls: "green" } },
  { batch: 4, uid: "synth0114", time: "2026-10-22 23:00:00", viewer: 11, amount: 33, item: "윙크", prob: 15, expect: { label: "중복(다른 상품)", kind: "new", cls: "yellow" } },
  { batch: 4, uid: "synth0119", time: "2026-10-25 20:00:00", viewer: 9, amount: 33, item: "볼찌르기", prob: 1, expect: { label: "그때 켜짐·지금 v3 꺼짐", kind: "new", cls: "green", hiddenOnFan: true } },
];

const RAW_SAVED: Record<number, string> = {
  1: kst("2026-09-17T22:40:00"),
  2: kst("2026-10-17T15:30:00"),
  3: kst("2026-10-24T23:05:00"),
  4: kst("2026-10-25T23:00:00"),
};

export const SYNTH_RAW_IMPORTS = [1, 2, 3, 4].map((b) => ({
  id: uuid(400 + b),
  streamer_id: SID,
  type: "results",
  batch_id: b <= 3 ? uuid(300 + b) : null,
  catalog_version: b <= 3 ? b : 3,
  captured_at: RAW_SAVED[b],
  saved_at: RAW_SAVED[b],
  raw: { capturedAt: RAW_SAVED[b], rows: SYNTH_RESULTS.filter((r) => r.batch === b).map(captureRow) },
}));

function entry(n: number, r: SynthResult, version: number, groupIndex: number, label: string, prob: number, createdKst: string) {
  const v = String(r.viewer).padStart(2, "0");
  return {
    id: uuid(500 + n),
    streamer_id: SID,
    source_key: `${r.uid}::0`,
    batch_id: null,
    catalog_version: version,
    status: "pending",
    fan_nickname: `시청자${v}`,
    fan_id: `viewer${v}`,
    item_name: r.item,
    probability: prob,
    donate_time_text: r.time,
    donation_type: "별풍선",
    donation_amount: r.amount,
    donation_amount_text: `${r.amount}개`,
    catalog_group_index: groupIndex,
    amount_range_label: label,
    roulette_index: 0,
    roulette_total: 1,
    raw_text: `(${r.prob}%) ${r.item}`,
    public_note: "",
    admin_note: "",
    raw_import_id: null,
    created_at: kst(createdKst),
    updated_at: kst(createdKst),
  };
}

const byUid = (uid: string) => SYNTH_RESULTS.find((r) => r.uid === uid)!;

export const SYNTH_ENTRIES = [
  entry(1, byUid("synth0001"), 1, 2, "170", 1, "2026-09-17T22:40:00"),
  entry(2, byUid("synth0003"), 2, 0, "33", 1, "2026-10-17T15:30:00"),
  entry(3, byUid("synth0116"), 3, 0, "33", 2, "2026-10-24T23:05:00"),
  entry(4, byUid("synth0117"), 3, 2, "170", 40, "2026-10-24T23:05:00"),
  {
    // 스트리머가 먼저 넣어 둔 수동기록(시청자07 사진10장, 10/20 날짜) — G11 겹침 대상
    ...entry(5, { uid: "manual", time: "2026-10-20 12:00", viewer: 7, amount: 0, item: "사진10장", prob: 2 }, 2, 0, "33", 2, "2026-10-21T10:00:00"),
    source_key: "manual:5e1f0000-0000-4000-8000-0000000005ff",
    donation_type: "manual",
    donation_amount: null,
    donation_amount_text: "",
    roulette_total: 0,
    raw_text: "",
    admin_note: JSON.stringify({ effectiveCount: 1 }),
  },
];

// 합성 데이터의 기대 요약(정답) — SYNTH_RESULTS 의 expect 를 결과 키 단위로 센 값.
export const SYNTH_EXPECTED_SUMMARY = { N: 22, a: 4, d: 11, c: 1, b: 6, green: 4, yellow: 7, suspectedOver: 1, hiddenOnFan: 1, alsoNowRecord: 3 };

export const SYNTH_TABLES = {
  streamers: [SYNTH_STREAMER],
  catalogs: SYNTH_CATALOGS,
  audit_logs: SYNTH_AUDITS,
  import_batches: SYNTH_BATCHES,
  raw_imports: SYNTH_RAW_IMPORTS,
  upbo_entries: SYNTH_ENTRIES,
  upbo_item_events: [] as unknown[],
};
