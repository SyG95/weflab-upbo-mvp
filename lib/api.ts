// Upbo Beta 웹사이트 전용 API 클라이언트.
// core/extension/server 로직은 절대 건드리지 않고, 로컬 검증 API state만 읽고
// thresholdPercent 저장만 호출한다. (read + settings POST 한정)

import type { ManualTabHint } from "./manualTabHint";
import type { FanRevealScope } from "./fanRevealScope";

export const API_BASE =
  process.env.UPBO_API_BASE ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://127.0.0.1:3000");

export type UpboEntry = {
  id: string;
  streamerSlug: string;
  sourceKey: string;
  batchId: string;
  status: string;
  fanNickname: string;
  fanId: string;
  itemName: string;
  probability: number;
  donateTimeText: string;
  donationType: string;
  rouletteIndex: number;
  rouletteTotal: number;
  rawText: string;
  publicNote?: string;
  adminNote?: string;
  // 아래는 core(Hermes) 후속으로 채워지는 표시용 필드. 값이 있을 때만 화면에 노출한다.
  donationAmount?: number;
  donationAmountText?: string;
  catalogVersion?: number;
  catalogGroupIndex?: number;
  amountRangeLabel?: string;
  rouletteGroupLabel?: string;
  multiplier?: number;
  effectiveCount?: number;
  modifierSourceKeys?: string[];
  // 수동기록 상품을 넣을 팬 탭 힌트(admin_note JSON tabHint, 2026-09-21 직접 입력 → 2026-09-29 표 상품 포함).
  // 없거나 모양이 아니면 undefined = 상품이 정한 탭(표에 없는 상품은 "표에 없음"). 있으면 팬 화면이 먼저 본다.
  manualTabHint?: ManualTabHint;
  // 운영 레이어(양도/교환): 값이 원본과 다를 때만 화면에 "→ 현재" 로 노출한다.
  currentOwnerName?: string | null;
  currentOwnerId?: string | null;
  currentItemName?: string | null;
  quantityOriginal?: number | null;
  quantityCurrent?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

// 운영 변경 이력(양도/교환/취소/되돌리기 등) 1건.
export type ItemEvent = {
  id: string;
  upboEntryId: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  quantityDelta: number | null;
  reason: string | null;
  memo: string | null;
  approvalStatus: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt?: string;
};

// 되돌리기(admin_adjustment) 역연산 재료 — 서버가 이걸 after_json.revertOf 로 저장하고,
// foldEntryHoldings 가 읽어 수량을 실제로 복구한다. 교환·양도 카드 이력과 양도·교환 이력 탭이
// 같은 규칙을 쓰도록 한 곳에 둔다. 되돌릴 수 없는 종류(memo 등)는 undefined.
export type RevertOfInput = {
  eventId: string;
  kind: "restore" | "transfer_back" | "exchange_back";
  quantity?: number;
  toOwnerId?: string;
  toOwnerName?: string;
  newItemName?: string;
};

export function buildRevertOf(ev: ItemEvent): RevertOfInput | undefined {
  const quantity = ev.quantityDelta ?? undefined;
  if (ev.eventType === "cancel") return { eventId: ev.id, kind: "restore", quantity };
  if (ev.eventType === "transfer") {
    return {
      eventId: ev.id,
      kind: "transfer_back",
      quantity,
      toOwnerId: typeof ev.afterJson?.currentOwnerId === "string" ? ev.afterJson.currentOwnerId : "",
      toOwnerName: typeof ev.afterJson?.currentOwnerName === "string" ? ev.afterJson.currentOwnerName : "",
    };
  }
  if (ev.eventType === "exchange") {
    return {
      eventId: ev.id,
      kind: "exchange_back",
      quantity,
      newItemName: typeof ev.afterJson?.currentItemName === "string" ? ev.afterJson.currentItemName : "",
    };
  }
  return undefined;
}

export type CatalogItem = {
  itemName: string;
  probability: number;
  enabled?: boolean;
  sortOrder?: number;
  normalizedName?: string;
  amountRangeLabel?: string;
};

export type CatalogGroup = {
  groupIndex: number;
  amountMin: number;
  amountMax: number;
  enabled?: boolean;
  doubleEnabled?: boolean;
  items?: CatalogItem[];
  amountRangeLabel?: string;
};

export type Catalog = {
  version: number;
  sourceUrl?: string;
  capturedAt?: string;
  groupCount?: number;
  itemCount?: number;
  groups?: CatalogGroup[];
  items?: unknown[];
  // 사람이 붙이는 이름 (생일룰렛 등) — 저장 API가 아직 없어 현재는 보통 없음.
  displayName?: string;
};

export type ImportBatchSummary = {
  totalResults: number;
  recordCount: number;
  effectiveRecordCount?: number;
  ignoreCount: number;
  duplicateCount: number;
  needsReviewCount: number;
  modifierCount?: number;
  multiplierAppliedCount?: number;
  // 미션 성공 정산 뭉치라 무시한 결과 수(ignoreCount 에 포함). 규칙 도입(2026-09) 이후 배치만 있음.
  missionSettlementCount?: number;
  // 판정에 쓴 스냅샷(검증실 재현용). 없으면 도입 전 배치.
  thresholdOverrides?: Record<string, number>;
  judgeRules?: { missionSettlementIgnore?: boolean };
};

export type ImportBatch = {
  id: string;
  catalogVersion: number;
  thresholdPercent: number;
  sourceUrl?: string;
  capturedAt?: string;
  appliedAt?: string;
  summary: ImportBatchSummary;
  entryCount: number;
};

export type SpecialItemRule = {
  ruleKey: string;
  ruleType: "next_result_multiplier";
  status: "candidate" | "confirmed" | "rejected";
  multiplier: number;
  groupIndex?: number;
  amountRangeLabel?: string;
  itemName?: string;
  normalizedName?: string;
  probability?: number;
};

export type ViewerNote = {
  fanId: string;
  fanNickname: string;
  noteText: string;
  // 메모에 첨부한 이미지 URL 목록(관리자 전용, 팬 화면 미노출).
  noteImages?: string[];
  updatedAt?: string;
};

export type DeliveryProgressItem = {
  fanId: string;
  fanNickname: string;
  itemKey: string;
  itemName: string;
  probability?: number;
  amountRangeLabel?: string;
  processedCount: number;
  updatedAt?: string;
};

// delivery_progress.updated_at 을 "그 항목이 완료(변경)된 시각"으로 믿을 수 있는 컷오프.
// 이 시각 이전의 updated_at 은 diff 저장 도입 전 "마지막 전체 저장 시각"이라 항목별 시각이 아니다
// (매 저장마다 전 행이 같은 now 로 덮였음) — 화면에는 이 시각 이후 값만 완료 시각으로 표시한다.
// ★ 라이브 배포 시점으로 갱신해야 한다(배포 직전 값 교체).
// 2026-08-26 20:34 KST 배포 — 롤아웃 중 구코드(전량 저장)가 마지막으로 찍을 수 있는 시각을
// 넘기도록 10분 여유를 둔다(이전이면 가짜 완료 시각, 이후 몇 분 내 새 저장은 시각 미표시로 안전).
export const DELIVERY_PROGRESS_TS_CUTOFF = "2026-08-26T20:45:00+09:00";

// 후원 기록 시각의 출처 구분.
//  donate       = 위플랩 원문 후원 시각(donateTimeText) — 진짜 후원 시각.
//  manual       = 수동기록: 원문 시각이 없어 기록 생성 시각(createdAt)으로 대체(옛 수동기록 전부 — 배송 기간·월별에서는 기타).
//  manual_dated = 수동기록: 스트리머가 적은 후원 날짜(donateTimeText, 2026-09 부터) — 배송 기간·월별에 donate 와 같이 묶인다.
//                 배지는 여전히 "수동"(위플랩 원문이 아니므로 "원문" 문구를 받지 않는다).
//  exchange     = 교환으로 받은 기록: 교환된 시각(createdAt)이지 원 후원 시각이 아니다.
//  created      = 자동수집인데 원문 시각이 비거나 해석 불가 → 시트 반영 시각(createdAt)으로 대체.
export type RecordedKind = "donate" | "manual" | "manual_dated" | "exchange" | "created";

// "YYYY-MM-DD HH:MM(:SS)" (위플랩 서버 표시, KST) → epoch ms. 실패 시 null.
// donationEvents.parseDonateTime 의 자급자족 사본(저장소 관례: 레인 간 직접 import 금지,
// fixedPricePeriod 와 동일 방식) — 순수 모듈이라 클라이언트/서버 어디서든 쓴다.
export function parseDonateTimeMs(text: string | null | undefined): number | null {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = clean.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  const pad = (v: string) => v.padStart(2, "0");
  const iso = `${year}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${pad(match[5])}:${pad(match[6] || "0")}+09:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// 기록 1건의 "기록 시각"(epoch ms)과 출처를 정한다. 비교·정렬은 반드시 이 ms 값으로만 한다
// (donateTimeText 원문은 +09:00, createdAt 은 UTC Z — 문자열 비교는 시간대가 섞여 틀어진다).
export function entryRecordedAt(entry: {
  sourceKey?: string;
  donateTimeText?: string;
  createdAt?: string;
}): { ms: number | null; kind: RecordedKind | null } {
  const sourceKey = entry.sourceKey ?? "";
  const donateMs = parseDonateTimeMs(entry.donateTimeText);
  // 시각이 있는 수동기록은 스트리머가 적은 날짜(manual_dated) — 원문(donate)과 구분한다. 그 외 분기는 불변:
  // donateTimeText 가 ""(옛 수동기록 전부)이면 아래 createdAt 폴백으로 내려가 kind "manual" 그대로.
  if (donateMs !== null) return { ms: donateMs, kind: sourceKey.startsWith("manual:") ? "manual_dated" : "donate" };
  const createdMs = entry.createdAt ? Date.parse(entry.createdAt) : NaN;
  const fallback = Number.isNaN(createdMs) ? null : createdMs;
  if (sourceKey.startsWith("manual:")) return { ms: fallback, kind: fallback === null ? null : "manual" };
  if (sourceKey.startsWith("exchange:")) return { ms: fallback, kind: fallback === null ? null : "exchange" };
  return { ms: fallback, kind: fallback === null ? null : "created" };
}

export type OpsState = {
  viewerNotes: ViewerNote[];
  deliveryProgress: DeliveryProgressItem[];
  // 시트 보기(B뷰)의 "어느 후원 건을 완료로 쳤는지" 배정 메모(관리자 전용 오버레이).
  // 수량 장부(deliveryProgress)가 항상 진실이고 이 배열은 힌트다 — 어긋나면 FIFO 로 보정 표시.
  deliveryAssignments?: DeliveryAssignment[];
  // 배송관리 "묶음(기간) 보기" 설정(관리자 전용, 표시 전용) — lib/deliveryPeriod.ts 참조.
  deliveryPeriod?: import("./deliveryPeriod").DeliveryPeriodConfig;
};

// 배정 메모 1건. entryId 만으로는 조각을 못 집는다(부분 양도·교환 시 같은 entryId 가 여러 줄) —
// ownerKey(현재 보유자 키)+itemKey(상품@@확률@@세트)까지 있어야 배송관리의 한 줄을 특정한다.
export type DeliveryAssignment = {
  entryId: string;
  ownerKey: string; // ViewerSummary.key 와 동일(정규화 계정ID, 없으면 닉네임)
  itemKey: string; // itemName@@probability@@amountRangeLabel — DeliveryManager itemKey 와 동일
  doneCount: number;
  doneAt: string; // ISO — 이 건을 완료로 찍은 시각
};

// 룰렛 관리(스트리머별 오버레이): 스트리머가 "이 그룹들은 같은 룰렛"이라고 직접 묶고 이름을 붙인다.
// 캡처(버전)가 아니라 "각 멤버 그룹의 상품 구성(groups)"에 매다는 방식 — 상품 겹침으로 매칭하므로
// 새 캡처가 들어와도 같은 그룹이면 소속 룰렛(이름·보관)이 자동으로 따라온다.
export type RouletteConfigEntry = {
  // 이 룰렛에 담긴 각 멤버 그룹의 상품명 집합. 새 캡처의 그룹을 이 룰렛에 매칭하는 지문.
  // 예: 33룰렛 + 330룰렛을 한 룰렛으로 묶으면 groups = [[33상품들], [330상품들]].
  groups: string[][];
  name?: string; // 스트리머가 정한 표시 이름(팬 탭 라벨). 없으면 금액 라벨 사용.
  archived?: boolean; // 보관(숨김) — 원본 불변, 목록·팬·후보에서 제외. 복구 가능.
  // 팬 화면에 이 룰렛 "확률표"를 공개할지(기록 on/off 와 독립). 마스터 스위치가 켜져 있을 때만 노출.
  revealed?: boolean;
};

// 팬 화면 상품 색상 팔레트(20색). 배경 하이라이트 방식: 연한 배경 + 진한 글씨(테마 무관 가독성).
// 색상환 20등분 + 밝기 3단 순환으로 서로 구분되게. 자유 색 대신 프리셋만 골라 쓴다.
export type ProductColor = { id: string; bg: string; text: string; border: string };
export const PRODUCT_COLORS: ProductColor[] = Array.from({ length: 20 }, (_, i) => {
  const h = Math.round((i * 360) / 20);
  const L = [94, 86, 79][i % 3];
  return {
    id: `c${i + 1}`,
    bg: `hsl(${h}, 85%, ${L}%)`,
    text: `hsl(${h}, 60%, 26%)`,
    border: `hsl(${h}, 55%, ${L - 11}%)`,
  };
});
export function productColorById(id: string | undefined | null): ProductColor | undefined {
  if (!id) return undefined;
  return PRODUCT_COLORS.find((c) => c.id === id);
}

// 한 룰렛에 담긴 모든 멤버 그룹의 상품명 합집합(union).
export function rouletteEntryItems(e: RouletteConfigEntry): string[] {
  const s = new Set<string>();
  for (const g of e.groups ?? []) for (const n of g) s.add(n);
  return [...s];
}

// 정가 갯수의 유형(sy 확정 2026-08-09): sig=시그니처(상시, 갯수 불변), event/server=기간 한정.
export type SignatureKind = "sig" | "event" | "server";

// 팬 화면 정가 탭 표시 방식(스트리머 선택, sy 2026-08-09): sections=한 탭+섹션(기본), subtabs=유형별 하위 탭.
export type FanFixedTabMode = "sections" | "subtabs";

// 시그니처 갯수 1개의 표시 정보. parts=구성품 이름 목록, imageUrl=시그 이미지(우리 스토리지 공개 URL).
// kind 기본 "sig"(상시). event/server 는 label(이름)과 기간(startAt~endAt, KST 날짜)이 붙는다.
// 기간 판정은 "위플랩에 찍힌 후원 시각" 기준(수집 실행 시각 아님) — lib/fixedPricePeriod.ts.
// expired 는 읽기 시점 파생값(endAt 경과 = «지난 정가»): 수집은 기간으로 이미 끊겼고 목록 정리만 남은 상태.
// 기간이 끝나도 이미 쌓인 기록(업보)은 절대 사라지지 않는다.
export type SignatureDetail = {
  count: number;
  parts: string[];
  imageUrl: string;
  kind: SignatureKind;
  label: string;
  startAt: string; // "YYYY-MM-DD" 또는 "" (sig 는 항상 "")
  endAt: string;   // "YYYY-MM-DD" 또는 "" — 이 날짜의 23:59:59(KST)까지 수집
  expired: boolean;
};

export type StreamerState = {
  slug: string;
  displayName: string;
  // 시트 글씨체 키(lib/sheetFonts.ts 화이트리스트). ""/누락 = 기본 개구체.
  sheetFontKey?: string;
  settings: {
    thresholdPercent: number;
    siteTitle?: string;
    sheetName?: string;
    posterImageUrl?: string;
    accentColor?: string;
    customTheme?: import("./customTheme").CustomTheme | null;
  };
  catalogs: Catalog[];
  currentCatalogVersion: number;
  importBatches: ImportBatch[];
  upboEntries: UpboEntry[];
  specialItemRules?: SpecialItemRule[];
  modifierState?: unknown;
  rawImports?: unknown[];
  auditLogs?: unknown[];
  // 운영 이벤트 목록. computeHoldings(upboEntries, itemEvents) 로 현재 보유 현황을 계산한다.
  itemEvents?: ItemEvent[];
  // 룰렛확률표 사용여부 오버라이드(버전별 최신 1건). 키 "g0"=그룹, "g0-i2"=상품.
  // 없거나 비면 위플랩 캡처 값을 그대로 따른다.
  catalogUsageByVersion?: Record<number, Record<string, boolean>>;
  // 룰렛표(금액대)별 기준확률 예외. 키 = 금액대 라벨(예: "33"), 값 = 기준 %.
  // 없거나 비면 전역 thresholdPercent 하나로 판정한다(기존과 동일).
  thresholdOverrides?: Record<string, number>;
  // 정가기록(시그니처 후원) — 스트리머가 지정한 시그니처 갯수와 기록별 수기 메모.
  signatureCounts?: number[];
  // 시그니처 갯수별 표시·유형 정보(구성품·이미지·유형·기간). 팬 레일·관리자 편집·기간 판정에 쓴다.
  // signatureCounts 는 등록된 전체 갯수(만료 포함) — 기간 조건은 details 쪽이 담당한다.
  signatureDetails?: SignatureDetail[];
  // 팬 화면 정가 탭 표시 방식(스트리머 선택). 기본 sections.
  fanFixedTabMode?: FanFixedTabMode;
  fixedPriceNotes?: Array<{ entrySourceKey: string; noteText: string; images?: string[]; updatedAt?: string }>;
  // 배송완료 후 보관(숨김) 처리된 시청자 fanId 목록 — 관리자·팬 화면 모두에서 숨긴다.
  // 물리 삭제 아님(원본 불변), 복구 가능.
  archivedFanIds?: string[];
  // 각 보관 시청자의 마지막 보관 시각(ISO). 이 시각 이후에 새로 당첨된 기록은 팬 화면에서 다시 보인다.
  // (보관=배송완료 후 숨김이지만, 그 시청자가 또 당첨되면 새 업보만 다시 뜨고 옛 기록은 계속 숨김)
  archivedFanAt?: Record<string, string>;
  // 룰렛 관리 오버레이(스트리머별 최신 1건). 룰렛 이름·보관 상태를 상품명 지문으로 저장한다.
  rouletteConfig?: RouletteConfigEntry[];
  // 팬 탭 이름 오버레이(스트리머별 최신 1건). 이름을 묶음(rouletteConfig)이 아니라 "탭의 상품 지문"에
  // 매달아 묶기/해제와 독립으로 유지한다(sy 확정 2026-07-08). fixedLabel/otherLabel = 정가/기타 탭 이름.
  fanTabLabels?: FanTabLabels;
  // 위플랩 공개 링크(스트리머별). 등록해두면 "지금 가져오기"로 확프 없이 룰렛표를 읽어온다
  // (설계: weflab-public-link-catalog-ingestion-2026-07-08). 확프 룰렛표 읽기와 병행, 결과는 확프 유지.
  weflabLink?: WeflabLinkInfo;
  // 배송 진행(처리 수량). 팬 화면 "배송 반영" 옵션이 켜지면 당첨 수량에서 차감/표시하는 데 쓴다.
  deliveryProgress?: DeliveryProgressItem[];
  // 팬 화면 배송 반영 방식(스트리머별). 기본 off. remaining=남은 개수, mark=배송완료 표시.
  fanDeliveryReflect?: FanDeliveryReflect;
  // 팬 화면 구분 축(스트리머별). 기본 둘 다 켬. 없으면 DEFAULT_FAN_AXIS_PREFS.
  fanAxisPrefs?: FanAxisPrefs;
  // 상품별 색상(스트리머별). 상품명 → 팔레트 id("c1"~"c20"). 없으면 기본색.
  productColors?: Record<string, string>;
  // 팬 화면 룰렛 확률표 공개 마스터 스위치. off면 확률표 카드 자체가 안 뜬다(개별 revealed 무시).
  fanRevealEnabled?: boolean;
  // 확률표 공개 범위(2026-09-29): target=업보 대상 품목만(기본, 지금까지와 동일) / all=전체 확률표(대상 행 강조).
  fanRevealScope?: FanRevealScope;
  // 팬 화면 계정ID 숨기기(스트리머별). 켜면 팬 화면 표에서 계정ID 열이 통째로 빠진다. 기본 off.
  fanIdHidden?: boolean;
  // 팬 쿠폰 탭 이름(스트리머별, 표시 전용). ""=기본 "쿠폰". 예: 꾸폰, 마일리지.
  couponTabLabel?: string;
  // 팬 대문 제목(스트리머별, 표시 전용). ""=기본 "{이름} 업보시트". 이모지 등 자유, 코드포인트 24자 상한.
  sheetTitle?: string;
  // 팬 화면 블록 배치(포스터/확률표/공지 × 슬롯). 없으면 DEFAULT_FAN_LAYOUT(기존 배치).
  fanLayout?: FanLayout;
  // 관리자 상위탭 순서/이름 + 섹션 접힘 커스텀(스트리머별 오버레이). 없으면 코드 기본.
  adminUiPrefs?: {
    tabOrder: string[];
    tabLabels: Record<string, string>;
    collapsed: Record<string, boolean>;
    sectionOrder: Record<string, string[]>;
  };
  createdAt?: string;
  updatedAt?: string;
};

// 팬 화면 배송 반영 방식.
// off           : 반영 안 함(당첨 총량 그대로) — 기본값, 기존 동작.
// remaining     : (a) 남은 개수(당첨 − 배송완료). 다 배송된 상품/시청자는 팬 화면에서 사라진다.
// remaining_done: (b) 남은 개수 + 다 배송되면 사라지지 않고 "배송완료"로 남긴다.
// mark          : (c) 총량은 그대로 두고 "배송완료 N" 표시만 붙인다.
export type FanDeliveryReflect = "off" | "remaining" | "remaining_done" | "mark";

export function normalizeFanDeliveryReflect(raw: unknown): FanDeliveryReflect {
  return raw === "remaining" || raw === "remaining_done" || raw === "mark" ? raw : "off";
}

// ── 팬 화면 구분 축(스트리머별, 2026-09-21) ───────────────────────────────
// monthRail    : "언제" 축(월별 보기 레일). 끄면 월 쿼리를 무시하고 항상 전체 기간, 월별 잔여 수치도 안 보인다.
// rouletteTabs : "어느 룰렛" 축(룰렛 탭). 끄면 룰렛 구분 없이 한 목록, 정가만 따로("전체 | 정가").
// 기본 둘 다 켬 = 종전 화면과 동일. 저장은 audit_logs 오버레이 최신 1건(fan_axis_updated, payload.axis).
export type FanAxisPrefs = { monthRail: boolean; rouletteTabs: boolean };

export const DEFAULT_FAN_AXIS_PREFS: FanAxisPrefs = { monthRail: true, rouletteTabs: true };

// 불리언이 아닌 값(누락·문자열·null 등)은 그 항목만 기본값으로. 객체가 아니면 전부 기본값.
export function normalizeFanAxisPrefs(raw: unknown): FanAxisPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    monthRail: typeof o.monthRail === "boolean" ? o.monthRail : DEFAULT_FAN_AXIS_PREFS.monthRail,
    rouletteTabs: typeof o.rouletteTabs === "boolean" ? o.rouletteTabs : DEFAULT_FAN_AXIS_PREFS.rouletteTabs,
  };
}

// ── 팬 화면 블록 배치(스트리머별) ──────────────────────────────────────────
// 포스터/확률표/공지 블록을 어느 자리(슬롯)에 둘지. 시트는 항상 중앙 고정, 배너는 맨 위 고정.
// left/right = 시트 양옆 세로 레일, top/bottom = 시트 위/아래 가로 스트립.
export const POSTER_BLOCKS = ['poster0','poster1','poster2','poster3','poster4'] as const;
export type FanLayoutBlock = typeof POSTER_BLOCKS[number] | "reveal" | "notice";
export type FanLayoutSlot = "left" | "right" | "top" | "bottom";
export type FanLayoutPos = { slot: FanLayoutSlot; order: number };
export type FanLayout = Record<FanLayoutBlock,FanLayoutPos> & {railsAtHead?:boolean};
export const FAN_LAYOUT_BLOCKS: FanLayoutBlock[] = [...POSTER_BLOCKS,'reveal','notice'];
export const DEFAULT_FAN_LAYOUT: FanLayout = {
 poster0:{slot:'left',order:0},poster1:{slot:'left',order:1},poster2:{slot:'left',order:2},poster3:{slot:'left',order:3},poster4:{slot:'left',order:4},
 reveal:{slot:'right',order:0},notice:{slot:'right',order:10},railsAtHead:false
};
const FAN_LAYOUT_SLOTS: FanLayoutSlot[] = ['left','right','top','bottom'];
export function normalizeFanLayout(raw:unknown):FanLayout {
 const out=structuredClone(DEFAULT_FAN_LAYOUT);
 if(!raw||typeof raw!=='object')return out;
 const source=raw as Record<string,unknown>;
 const legacy=!!source.posters && !POSTER_BLOCKS.some(k=>source[k]);
 for(const block of FAN_LAYOUT_BLOCKS){
  const val=(source[block] ?? (block.startsWith('poster') ? source.posters : undefined)) as Partial<FanLayoutPos>|undefined;
  if(!val||typeof val!=='object')continue;
  if(FAN_LAYOUT_SLOTS.includes(val.slot as FanLayoutSlot))out[block].slot=val.slot as FanLayoutSlot;
  if(Number.isFinite(Number(val.order)))out[block].order=Math.max(0,Math.min(99,Math.floor(Number(val.order))*(legacy?10:1)+(legacy&&block.startsWith('poster')?Number(block.slice(-1)):0)));
 }
 out.railsAtHead=source.railsAtHead===true;
 return out;
}
export function fanLayoutBlocksInSlot(layout:FanLayout,slot:FanLayoutSlot):FanLayoutBlock[]{
 const clean=normalizeFanLayout(layout);
 return FAN_LAYOUT_BLOCKS.filter(b=>clean[b].slot===slot).sort((a,b)=>clean[a].order-clean[b].order);
}

// 상품명 집합 두 개의 자카드 유사도(0~1). 룰렛 "같은 것" 판정에 쓰는 겹침 비율.
export function jaccardStrings(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  for (const x of small) if (large.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni > 0 ? inter / uni : 0;
}

// 한 그룹(상품명 집합)이 config 의 어느 룰렛에 속하는지 찾는다.
// 룰렛의 멤버 그룹들과 자카드 유사도 ≥ 0.5 로 최고 매칭되는 룰렛의 인덱스(없으면 -1).
// 새 캡처로 그룹 인덱스가 바뀌어도 상품 구성이 비슷하면 같은 룰렛으로 매칭된다.
export function matchGroupToConfig(
  groupItems: string[],
  config: RouletteConfigEntry[] | undefined,
): number {
  if (!config?.length) return -1;
  let best = -1;
  let score = 0.5;
  config.forEach((e, i) => {
    for (const member of e.groups ?? []) {
      const s = jaccardStrings(groupItems, member);
      if (s >= score) {
        score = s;
        best = i;
      }
    }
  });
  return best;
}

// ── 팬 탭 이름(팬 화면 룰렛 탭 표시 이름) ─────────────────────────────────
// 이름은 묶음이 아니라 "탭의 상품 지문(멤버 그룹들의 상품명 집합)"에 매달린다(sy 확정 2026-07-08).
// 묶기/해제와 완전 독립: 해제해도 이름이 남고, 같은 지문의 탭이 다시 생기면 이름이 되살아난다.
export type FanTabLabelEntry = { name: string; groups: string[][] };
// 팬 탭 순서(드래그) — 순서도 이름처럼 상품 지문에 매달린다. 정가/기타는 지문이 없어 kind 로 구분.
export type FanTabOrderItem =
  | { kind: "tab"; groups: string[][] }
  | { kind: "fixed" }
  | { kind: "other" };
export type FanTabLabels = {
  entries: FanTabLabelEntry[];
  order?: FanTabOrderItem[];
  fixedLabel?: string;
  otherLabel?: string;
  // "이전 표 · L" 탭(팬 탭 되짚기, 2026-09-20) 표시 이름 — 금액대 라벨 L → 이름. 없으면 기본 이름.
  pastLabels?: Record<string, string>;
};

// ── 위플랩 공개 링크(스트리머별 룰렛표 수집 소스) ─────────────────────────
// url = 방송국에 공유하는 weflab.com/user/<hash> 고정 링크. lastFetch* = "지금 가져오기" 결과 메타
// (표시·정합 안내용, 판정에는 안 쓰임 — 저장은 기존 saveCatalogForStreamer 재사용).
export type WeflabLinkInfo = {
  url?: string;
  lastFetchedAt?: string;
  lastModifiedText?: string;
  lastTableCount?: number;
  lastItemCount?: number;
  lastOverlapWarning?: boolean;
};

// 이 탭(멤버 그룹 지문들)에 맞는 오버레이 이름을 찾는다 — 그룹 쌍 최고 자카드 ≥ 0.5 인 항목.
// 새 캡처로 그룹이 바뀌어도 상품 구성이 비슷하면 같은 이름이 따라온다(matchGroupToConfig 와 같은 규칙).
export function matchFanTabLabel(
  memberGroups: string[][],
  labels: FanTabLabelEntry[] | undefined,
): string | undefined {
  if (!labels?.length || memberGroups.length === 0) return undefined;
  let best: string | undefined;
  let score = 0.5;
  for (const entry of labels) {
    for (const member of entry.groups) {
      for (const g of memberGroups) {
        const s = jaccardStrings(g, member);
        if (s >= score) {
          score = s;
          best = entry.name;
        }
      }
    }
  }
  return best;
}

// 이 탭 "전체"에 직접 붙은 오버레이 이름을 찾는다 — 저장된 지문이 탭의 모든 멤버 그룹을 덮는 항목만.
// (묶기로 여러 룰렛을 합친 탭에서 "그 합쳐진 탭 자체에 지은 이름"과 "구성 룰렛 하나에 지은 이름"을
//  구분하기 위함. 부분만 덮으면 whole 이 아니다.) 덮는 항목이 여럿이면 지문 그룹 수가 많은 것 우선.
export function matchFanTabLabelWhole(
  memberGroups: string[][],
  labels: FanTabLabelEntry[] | undefined,
): string | undefined {
  if (!labels?.length || memberGroups.length === 0) return undefined;
  let best: string | undefined;
  let bestCoverage = -1;
  for (const entry of labels) {
    const coversAll = memberGroups.every((g) =>
      entry.groups.some((m) => jaccardStrings(g, m) >= 0.5),
    );
    if (coversAll && entry.groups.length > bestCoverage) {
      best = entry.name;
      bestCoverage = entry.groups.length;
    }
  }
  return best;
}

// 이 탭(멤버 그룹 지문들)이 저장된 팬 탭 순서에서 몇 번째인지 찾는다 — matchFanTabLabelWhole 과
// 같은 전체 커버 규칙(모든 멤버 그룹이 자카드 ≥ 0.5 로 덮여야 매칭). 상품 구성이 절반 이상 바뀌면
// 이름처럼 순서도 풀려 뒤(가나다순)로 간다. 덮는 항목이 여럿이면 지문 그룹 수가 많은 것 우선.
export function matchFanTabOrderIndex(
  memberGroups: string[][],
  order: FanTabOrderItem[] | undefined,
): number | undefined {
  if (!order?.length || memberGroups.length === 0) return undefined;
  let best: number | undefined;
  let bestCoverage = -1;
  order.forEach((item, idx) => {
    if (item.kind !== "tab") return;
    const coversAll = memberGroups.every((g) =>
      item.groups.some((m) => jaccardStrings(g, m) >= 0.5),
    );
    if (coversAll && item.groups.length > bestCoverage) {
      best = idx;
      bestCoverage = item.groups.length;
    }
  });
  return best;
}

export type StateResult =
  | { ok: true; state: StreamerState }
  | { ok: false; reason: "offline" | "notfound" | "error" };

// 정가기록(시그니처 후원): 룰렛 on/off 와 무관 — 필터에서 항상 제외(항상 표시).
export function isFixedPriceEntry(e: UpboEntry): boolean {
  return (
    e.amountRangeLabel === "정가" ||
    (e.sourceKey?.startsWith("fixed:") ?? false) ||
    (e.sourceKey?.startsWith("정가") ?? false)
  );
}

// 수동기록(스트리머가 직접 넣은 것): 룰렛 on/off 와 무관 — 항상 표시.
export function isManualEntry(e: UpboEntry): boolean {
  return e.sourceKey?.startsWith("manual:") ?? false;
}

// 한 기록의 상품이 "지금 우리 룰렛표에서 켜져 있나"를 판정한다.
// 우선순위: 상품 오버라이드(g{gi}-i{so}) > 그룹 오버라이드(g{gi}) > 위플랩 캡처값(item/group.enabled).
// (applyCatalogUsage 판정 규칙과 동일) 매칭 불가(그룹/버전/카탈로그 없음)면 안전하게 유지(true).
function entryCatalogEnabled(
  e: UpboEntry,
  catalogByVersion: Map<number, Catalog>,
  usageByVersion: Record<number, Record<string, boolean>> | undefined,
): boolean {
  const gi = e.catalogGroupIndex;
  const ver = e.catalogVersion;
  if (gi === undefined || gi === null || ver === undefined || ver === null) return true;
  const cat = catalogByVersion.get(ver);
  if (!cat) return true;
  const group = (cat.groups ?? []).find((g) => g.groupIndex === gi);
  if (!group) return true;
  const usage = usageByVersion?.[ver] ?? {};
  const item = (group.items ?? []).find((it) => it.itemName === e.itemName);
  const so = item?.sortOrder;
  const itemOverride = so !== undefined ? usage[`g${gi}-i${so}`] : undefined;
  const groupOverride = usage[`g${gi}`];
  const captured = item?.enabled !== false && group.enabled !== false;
  const effective = itemOverride ?? groupOverride ?? captured;
  return effective !== false;
}

// 현재 룰렛표 on/off 기준으로 "지금 켜진 상품"의 기록만 남긴다(표시용 필터, 원본 불변).
// 정가·수동기록·매칭불가 기록은 항상 유지한다. 팬 화면·배송·교환 등 보유현황 전체에 공통 적용.
export function filterEntriesByCatalogUsage(
  entries: UpboEntry[],
  catalogs: Catalog[],
  usageByVersion: Record<number, Record<string, boolean>> | undefined,
): UpboEntry[] {
  const byVer = new Map<number, Catalog>();
  for (const c of catalogs) byVer.set(c.version, c);
  return entries.filter(
    (e) =>
      isFixedPriceEntry(e) ||
      isManualEntry(e) ||
      entryCatalogEnabled(e, byVer, usageByVersion),
  );
}

// 시청자 단위 통합 결과(업보 목록 / 배송 관리 공용)
// amountRangeLabel: 룰렛 세트 표시 라벨(있을 때만). 같은 상품·확률이라도 세트가 다르면 따로 묶는다.
export type AggItem = {
  itemName: string;
  probability: number;
  count: number;
  amountRangeLabel?: string;
  // 배송완료 수량(팬 화면 "배송 반영: 표시(mark)" 모드에서만 채움). 표시용.
  delivered?: number;
  // 미션 유래 정가 기록(donation_type에 "미션" 포함 + 정가) — 배송관리 "미션" 배지용(withOps 때만 채움).
  mission?: boolean;
  // 이 줄을 구성하는 원본 기록 조각(entryId, 남은 수량) — 배송관리 "기록 삭제"(취소 이벤트)용(withOps 때만).
  // recordedAtMs/recordedKind/recordedText: 기록 시각(entryRecordedAt 계산값)과 원문 — 시각·경과일 표시,
  // 시트 보기(B뷰) 날짜 열·FIFO 배분용. amount: 후원 금액(있을 때만, 시트 보기 금액 열용).
  refs?: Array<{
    entryId: string;
    quantity: number;
    recordedAtMs?: number | null;
    recordedKind?: RecordedKind | null;
    recordedText?: string;
    amount?: number;
  }>;
  // 다 배송됨(remaining_done 모드에서만): 개수는 0이지만 "배송완료"로 남겨 표시한다.
  done?: boolean;
};

export type ViewerSummary = {
  key: string;
  fanId: string;
  fanNickname: string;
  items: AggItem[];
  maxProb: number;
  total: number;
};

// ───────────────────────────────────────────────────────────────────────────
// 운영 레이어: 현재 보유 현황(holdings)
// 원본 upbo_entries 는 절대 변경하지 않는다. 양도/교환/취소/완료 이벤트(ItemEvent)를
// 원본 위에 "접어서"(fold) 지금 누가 무엇을 몇 개 들고 있는지를 계산한다.
// 한 원본 엔트리가 부분 양도/교환되면 여러 HoldingItem 으로 쪼개질 수 있고,
// 모든 조각은 entryId 로 동일한 원본 엔트리를 가리킨다.
// ───────────────────────────────────────────────────────────────────────────

// 시청자가 "지금" 보유 중인 아이템 1조각.
// entryId: 이 조각이 유래한 원본 upbo_entry 의 id. 운영 이벤트(POST item-events)는
//          반드시 이 entryId 를 대상으로 보낸다.
export type HoldingItem = {
  entryId: string;
  itemName: string;
  probability: number;
  amountRangeLabel?: string;
  // 원본 기록이 판정된 룰렛표 (버전, 그룹) — 팬 탭 되짚기(2026-09-20)용. 없으면 null(직접 입력 계열).
  // 교환·양도로 조각이 쪼개져도 원본 entry 값을 그대로 물려받는다(표시 분류 전용, 판정과 무관).
  catalogVersion: number | null;
  catalogGroupIndex: number | null;
  // 직접 입력 수동기록의 탭 힌트(2026-09-21) — catalogVersion 이 null 인 조각에서만 팬 탭 결정에 쓴다. 없으면 null.
  tabHint?: ManualTabHint | null;
  // 원본 기록의 후원 유형(도전미션 별풍선 등). 배송관리 "미션" 배지 판별용 — 교환돼도 원본 유형 유지.
  donationType?: string;
  // 현재 남은 수량(양도/교환으로 빠져나간 분, 취소/완료된 분을 차감한 값).
  quantity: number;
  // 원본 수량(effectiveCount 기준). 표시용 "원본 N개 중 M개".
  originalQuantity: number;
  // 이 조각이 교환으로 원본과 다른 아이템이 되었으면 원본 상품명을 보존(표시용).
  originalItemName: string;
  // 현재 이 조각을 보유한 사람(양도되면 원래 당첨자와 다름).
  currentOwnerId: string;
  currentOwnerName: string;
  // 이 조각이 양도되어 원래 당첨자와 보유자가 다르면 true(표시용 "← 원래 닉네임").
  transferred: boolean;
  // 원래 당첨자 정보(양도 추적용).
  sourceOwnerId: string;
  sourceOwnerName: string;
  // 원본 기록의 시각 정보(entryRecordedAt) — 배송관리 시각·경과일 표시용. 팬 payload 에는 안 실린다
  // (withOps refs 로만 내려간다).
  recordedAtMs: number | null;
  recordedKind: RecordedKind | null;
  recordedText: string;
  // 원본 기록의 후원 금액(있을 때만) — 시트 보기 금액 열용.
  donationAmount?: number;
};

// 현재 보유자(계정ID 없으면 닉네임) 단위로 묶은 보유 현황.
export type ViewerHolding = {
  key: string;
  ownerId: string;
  ownerName: string;
  items: HoldingItem[];
  maxProb: number;
  total: number;
};

// 위플랩 초기 수집분(2026-06-28)은 계정ID가 "(calippenguin)"처럼 괄호째 저장되어 있고,
// 이후 수집분은 "calippenguin"처럼 깨끗하게 들어온다. 같은 사람이 둘로 갈라지지 않도록
// ID를 비교/표시하기 전에 겉 괄호를 벗겨 통일한다. (원본 DB는 변경하지 않는다)
export function normalizeAccountId(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const m = s.match(/^\((.*)\)$/);
  return (m ? m[1] : s).trim();
}

function holdingOwnerKey(ownerId: string, ownerName: string): string {
  return normalizeAccountId(ownerId) || ownerName || "";
}

function readOwnerFrom(json: Record<string, unknown> | null, idKey: string, nameKey: string) {
  if (!json) return { id: undefined as string | undefined, name: undefined as string | undefined };
  const id = json[idKey];
  const name = json[nameKey];
  return {
    id: typeof id === "string" ? id : undefined,
    name: typeof name === "string" ? name : undefined,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// 한 원본 엔트리 위에 그 엔트리의 이벤트들을 시간순으로 접어 현재 보유 조각들을 만든다.
// 같은 (보유자, 아이템) 조합은 하나의 조각으로 합친다.
function foldEntryHoldings(entry: UpboEntry, events: ItemEvent[]): HoldingItem[] {
  const originalQuantity = Math.max(1, Number(entry.effectiveCount ?? 1));
  const sourceOwnerId = normalizeAccountId(entry.fanId);
  const sourceOwnerName = entry.fanNickname ?? "";
  // 기록 시각은 entry 단위 — 이 entry 에서 나온 모든 조각이 같은 시각을 공유한다.
  const recordedAt = entryRecordedAt(entry);

  // Lot は (보유자, 아이템) 단위 현재 상태. 교환으로 확률·라벨이 달라진 조각을 추적하기 위해
  // probability/amountRangeLabel 도 per-lot 으로 관리한다.
  type Lot = {
    ownerId: string;
    ownerName: string;
    itemName: string;
    probability: number;
    amountRangeLabel: string | undefined;
    quantity: number;
  };

  // 보유자+아이템 조합별 누적 수량. 키는 owner@@item.
  const lots = new Map<string, Lot>();
  const lotKey = (ownerId: string, ownerName: string, itemName: string) =>
    `${holdingOwnerKey(ownerId, ownerName)}@@${itemName}`;

  const seed: Lot = {
    ownerId: sourceOwnerId,
    ownerName: sourceOwnerName,
    itemName: entry.itemName,
    probability: entry.probability,
    amountRangeLabel: entry.amountRangeLabel || undefined,
    quantity: originalQuantity,
  };
  lots.set(lotKey(seed.ownerId, seed.ownerName, seed.itemName), seed);

  const addToLot = (
    ownerId: string,
    ownerName: string,
    itemName: string,
    probability: number,
    amountRangeLabel: string | undefined,
    delta: number,
  ) => {
    const key = lotKey(ownerId, ownerName, itemName);
    const existing = lots.get(key);
    if (existing) {
      existing.quantity += delta;
      // 동일 key 로 추가될 때 확률·라벨은 최신 이벤트 값으로 갱신한다.
      existing.probability = probability;
      existing.amountRangeLabel = amountRangeLabel;
    } else {
      lots.set(key, { ownerId, ownerName, itemName, probability, amountRangeLabel, quantity: delta });
    }
  };

  // 지정 보유자 lot 에서 최대 amount 만큼 빼낸다(되돌리기 역연산에도 사용). 부족하면 가능한 만큼만.
  const takeFromLot = (ownerId: string, ownerName: string, itemName: string, amount: number): number => {
    const lot = lots.get(lotKey(ownerId, ownerName, itemName));
    if (!lot) return 0;
    const taken = Math.min(lot.quantity, amount);
    lot.quantity -= taken;
    return taken;
  };

  // 원본 보유 lot 에서 최대 amount 만큼 빼낸다. 부족하면 가능한 만큼만.
  const takeFromOrigin = (itemName: string, amount: number): number =>
    takeFromLot(sourceOwnerId, sourceOwnerName, itemName, amount);

  const ordered = [...events].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  );

  for (const ev of ordered) {
    const delta = numberOrUndefined(ev.quantityDelta);
    if (ev.eventType === "transfer") {
      const to = readOwnerFrom(ev.afterJson, "currentOwnerId", "currentOwnerName");
      const amount = delta ?? originalQuantity;
      // 양도는 아이템·확률·라벨을 그대로 유지하고 보유자만 바뀐다.
      const originLot = lots.get(lotKey(sourceOwnerId, sourceOwnerName, entry.itemName));
      const prob = originLot?.probability ?? entry.probability;
      const label = originLot?.amountRangeLabel;
      const moved = takeFromOrigin(entry.itemName, amount);
      if (moved > 0) addToLot(normalizeAccountId(to.id), to.name ?? "", entry.itemName, prob, label, moved);
    } else if (ev.eventType === "exchange") {
      // N:M 번들 교환의 "주는 쪽"(exchangeOut): 조각이 장부에서 나가기만 한다.
      // 받는 쪽은 별도의 exchange:<groupId> entry로 들어오므로 여기서 더할 것이 없다.
      // 표시가 없는 레거시 교환은 기존 "1:1 변신" 동작 그대로(하위호환).
      if (ev.afterJson?.exchangeOut === true) {
        const amount = delta ?? originalQuantity;
        takeFromOrigin(entry.itemName, amount);
        continue;
      }
      const newItemName =
        (typeof ev.afterJson?.currentItemName === "string" ? ev.afterJson.currentItemName : "") || entry.itemName;
      // 교환 후 확률은 룰렛표 값(currentItemProbability). 없으면 원본 확률 유지.
      const rawProb = ev.afterJson?.currentItemProbability;
      const newProbability =
        typeof rawProb === "number" && Number.isFinite(rawProb) ? rawProb : entry.probability;
      const rawLabel = ev.afterJson?.currentAmountRangeLabel;
      const newAmountRangeLabel =
        typeof rawLabel === "string" ? rawLabel || undefined : entry.amountRangeLabel || undefined;
      const amount = delta ?? originalQuantity;
      const moved = takeFromOrigin(entry.itemName, amount);
      if (moved > 0) addToLot(sourceOwnerId, sourceOwnerName, newItemName, newProbability, newAmountRangeLabel, moved);
    } else if (ev.eventType === "cancel" || ev.eventType === "void" || ev.eventType === "complete") {
      const amount = delta ?? originalQuantity;
      takeFromOrigin(entry.itemName, amount);
    } else if (ev.eventType === "quantity_adjust" && delta !== undefined) {
      const originLot = lots.get(lotKey(sourceOwnerId, sourceOwnerName, entry.itemName));
      if (delta >= 0) addToLot(sourceOwnerId, sourceOwnerName, entry.itemName, originLot?.probability ?? entry.probability, originLot?.amountRangeLabel, delta);
      else takeFromOrigin(entry.itemName, -delta);
    } else if (ev.eventType === "admin_adjustment") {
      // 되돌리기(보상 이벤트): after_json.revertOf 에 원 처리의 역연산 재료가 담겨 있으면 수량을 실제로 복구한다.
      // revertOf 가 없는 옛 되돌리기 기록은 기존대로 표시용(수량 영향 없음 — 하위호환).
      const r = ev.afterJson?.revertOf;
      if (r && typeof r === "object" && !Array.isArray(r)) {
        const rec = r as Record<string, unknown>;
        const kind = typeof rec.kind === "string" ? rec.kind : "";
        const qRaw = Number(rec.quantity);
        const q = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : originalQuantity;
        const originLot = lots.get(lotKey(sourceOwnerId, sourceOwnerName, entry.itemName));
        const prob = originLot?.probability ?? entry.probability;
        const label = originLot?.amountRangeLabel ?? (entry.amountRangeLabel || undefined);
        if (kind === "restore") {
          // 취소·번들 교환(나감)의 역: 원 보유자에게 수량을 되살린다.
          addToLot(sourceOwnerId, sourceOwnerName, entry.itemName, prob, label, q);
        } else if (kind === "transfer_back") {
          // 양도의 역: 받은 사람에게서 회수해 원 보유자에게 돌린다(받은 쪽이 이미 써서 부족하면 가능한 만큼만).
          const to = readOwnerFrom(rec, "toOwnerId", "toOwnerName");
          const taken = takeFromLot(normalizeAccountId(to.id), to.name ?? "", entry.itemName, q);
          if (taken > 0) addToLot(sourceOwnerId, sourceOwnerName, entry.itemName, prob, label, taken);
        } else if (kind === "exchange_back") {
          // (구 방식 1:1) 교환의 역: 바뀐 상품을 회수하고 원래 상품으로 되살린다.
          const newItemName = typeof rec.newItemName === "string" ? rec.newItemName : "";
          const taken = newItemName ? takeFromLot(sourceOwnerId, sourceOwnerName, newItemName, q) : 0;
          if (taken > 0)
            addToLot(sourceOwnerId, sourceOwnerName, entry.itemName, entry.probability, entry.amountRangeLabel || undefined, taken);
        }
      }
    }
    // memo / status_change 등은 수량 보유에 영향 없음(표시용).
  }

  const holdings: HoldingItem[] = [];
  for (const lot of lots.values()) {
    if (lot.quantity <= 0) continue;
    const transferred = holdingOwnerKey(lot.ownerId, lot.ownerName) !== holdingOwnerKey(sourceOwnerId, sourceOwnerName);
    holdings.push({
      entryId: entry.id,
      itemName: lot.itemName,
      probability: lot.probability,
      amountRangeLabel: lot.amountRangeLabel,
      catalogVersion: entry.catalogVersion ?? null,
      catalogGroupIndex: entry.catalogGroupIndex ?? null,
      tabHint: entry.manualTabHint ?? null,
      donationType: entry.donationType,
      quantity: lot.quantity,
      originalQuantity,
      originalItemName: entry.itemName,
      currentOwnerId: lot.ownerId,
      currentOwnerName: lot.ownerName,
      transferred,
      sourceOwnerId,
      sourceOwnerName,
      recordedAtMs: recordedAt.ms,
      recordedKind: recordedAt.kind,
      recordedText: entry.donateTimeText ?? "",
      donationAmount: entry.donationAmount,
    });
  }
  return holdings;
}

// 전체 entries + 전체 itemEvents 로부터 현재 보유자 단위 보유 현황을 계산한다.
// 순수 함수: 원본을 변경하지 않는다.
export function computeHoldings(entries: UpboEntry[], events: ItemEvent[]): ViewerHolding[] {
  const eventsByEntry = new Map<string, ItemEvent[]>();
  for (const ev of events) {
    const arr = eventsByEntry.get(ev.upboEntryId);
    if (arr) arr.push(ev);
    else eventsByEntry.set(ev.upboEntryId, [ev]);
  }

  const byOwner = new Map<string, ViewerHolding>();
  for (const entry of entries) {
    const holdings = foldEntryHoldings(entry, eventsByEntry.get(entry.id) ?? []);
    for (const h of holdings) {
      const key = holdingOwnerKey(h.currentOwnerId, h.currentOwnerName) || entry.id;
      const group = byOwner.get(key);
      if (group) {
        group.items.push(h);
      } else {
        byOwner.set(key, {
          key,
          ownerId: h.currentOwnerId,
          ownerName: h.currentOwnerName,
          items: [h],
          maxProb: 0,
          total: 0,
        });
      }
    }
  }

  const result: ViewerHolding[] = [];
  for (const group of byOwner.values()) {
    group.items.sort((a, b) => b.probability - a.probability || b.quantity - a.quantity);
    group.maxProb = group.items.reduce((m, it) => Math.max(m, it.probability), 0);
    group.total = group.items.reduce((sum, it) => sum + it.quantity, 0);
    if (group.total > 0) result.push(group);
  }
  result.sort(
    (a, b) => b.maxProb - a.maxProb || b.total - a.total || a.ownerName.localeCompare(b.ownerName),
  );
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// 상품명 기준 통합(merge): 한 보유자의 조각(HoldingItem)들을 "현재 상품명" 기준으로 합친다.
// sy 전제: 33/330(단차·연차)은 같은 룰렛의 차이일 뿐, 나오는 상품 자체는 같은 상품이고
// 같은 상품이면 확률도 같다. 그래서 세트 구분 없이 상품명으로 합쳐 한 줄로 보여준다.
// sources 는 실제 양도/교환/취소를 적용할 원본 조각들이며, "본인 당첨분(양도 안 받은 것)"을
// 앞에 둬서 처리 시 본인 것부터 차감(받은 것은 뒤로)한다.
// ───────────────────────────────────────────────────────────────────────────
export type MergedHolding = {
  key: string; // 상품명(보유자 내 병합 키)
  itemName: string;
  probability: number;
  quantity: number;
  sources: HoldingItem[];
  anyTransferred: boolean;
  anyExchanged: boolean;
};

export function mergeHoldingItemsByName(items: HoldingItem[]): MergedHolding[] {
  const map = new Map<string, MergedHolding>();
  for (const it of items) {
    const key = it.itemName;
    const exchanged = it.itemName !== it.originalItemName;
    const cur = map.get(key);
    if (cur) {
      cur.quantity += it.quantity;
      cur.sources.push(it);
      cur.anyTransferred = cur.anyTransferred || it.transferred;
      cur.anyExchanged = cur.anyExchanged || exchanged;
    } else {
      map.set(key, {
        key,
        itemName: it.itemName,
        probability: it.probability,
        quantity: it.quantity,
        sources: [it],
        anyTransferred: it.transferred,
        anyExchanged: exchanged,
      });
    }
  }
  const out = [...map.values()];
  for (const m of out) {
    // 본인 당첨분(transferred=false)을 앞으로 → 양도/교환은 본인 것부터 소진.
    m.sources.sort((a, b) => Number(a.transferred) - Number(b.transferred));
  }
  out.sort((a, b) => b.probability - a.probability || b.quantity - a.quantity);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// 시트 보기(B뷰): 한 줄(=보유 조각)별 완료 배분 계산.
// 진실은 줄 묶음의 처리수량(processed)이고 배정(assignments)은 힌트다:
//  1) 배정된 조각부터(doneAt 오래된 순) 배정 수량만큼 채우고,
//  2) 남은 수량은 기록 시각 오래된 조각부터(FIFO, 시각 없음은 맨 뒤) 채운다.
// 반환은 refs 입력 순서 그대로. doneAt 은 "배정과 수량이 일치해 그 조각이 전량 완료"일 때만
// 싣는다 — FIFO 로 보정된 완료는 시각을 모르므로 null(화면에서 "수량 기준" 표기).
// ───────────────────────────────────────────────────────────────────────────
export type RefAllocation = {
  allocated: number;
  state: "done" | "part" | "pending";
  doneAt: string | null;
};

export function allocateDeliveryToRefs(
  refs: Array<{ entryId: string; quantity: number; recordedAtMs?: number | null }>,
  processed: number,
  assignments: Record<string, { doneCount: number; doneAt: string }>,
): RefAllocation[] {
  const allocated = refs.map(() => 0);
  let remaining = Math.max(0, Math.floor(processed));

  const indexed = refs.map((ref, i) => ({ ref, i, assign: assignments[ref.entryId] }));

  // 1) 배정 힌트 우선. 순서는 doneAt 을 해석한 ms 기준(문자열 비교 금지 — 시간대 섞이면 틀어진다).
  //    doneAt 이 비었거나 해석 불가한 배정은 "시각 미상의 기존 완료 고정(pin)"이므로 맨 앞에서 먼저 채운다.
  const hintMs = (doneAt: string): number => {
    if (!doneAt) return Number.NEGATIVE_INFINITY;
    const ms = Date.parse(doneAt);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  const hinted = indexed
    .filter((x) => x.assign && x.assign.doneCount > 0)
    .sort((a, b) => {
      const am = hintMs(a.assign!.doneAt);
      const bm = hintMs(b.assign!.doneAt);
      return am === bm ? 0 : am < bm ? -1 : 1; // -Infinity 동률 안전(빼기 비교는 NaN)
    });
  for (const x of hinted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.floor(x.assign!.doneCount), x.ref.quantity);
    allocated[x.i] += take;
    remaining -= take;
  }

  // 2) 남은 수량은 FIFO(기록 시각 오래된 순, 시각 없음은 맨 뒤, 동률은 entryId).
  const fifo = [...indexed].sort((a, b) => {
    const am = a.ref.recordedAtMs ?? Number.POSITIVE_INFINITY;
    const bm = b.ref.recordedAtMs ?? Number.POSITIVE_INFINITY;
    return am - bm || a.ref.entryId.localeCompare(b.ref.entryId);
  });
  for (const x of fifo) {
    if (remaining <= 0) break;
    const room = x.ref.quantity - allocated[x.i];
    if (room <= 0) continue;
    const take = Math.min(remaining, room);
    allocated[x.i] += take;
    remaining -= take;
  }

  return refs.map((ref, i) => {
    const a = allocated[i];
    const assign = assignments[ref.entryId];
    const fullyByAssign = assign && a >= ref.quantity && Math.floor(assign.doneCount) >= ref.quantity;
    return {
      allocated: a,
      state: a >= ref.quantity && ref.quantity > 0 ? "done" : a > 0 ? "part" : "pending",
      // pin(doneAt="")은 시각 미상 — null 로 정규화해 화면이 "수량 기준"으로 표기하게 한다.
      doneAt: fullyByAssign && assign.doneAt ? assign.doneAt : null,
    } as RefAllocation;
  });
}

export async function fetchStreamerState(slug: string): Promise<StateResult> {
  try {
    const res = await fetch(`${API_BASE}/api/s/${encodeURIComponent(slug)}/state`, {
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, reason: "notfound" };
    if (!res.ok) return { ok: false, reason: "error" };
    const state = (await res.json()) as StreamerState;
    return { ok: true, state };
  } catch {
    // API 서버가 꺼져 있거나 연결 불가
    return { ok: false, reason: "offline" };
  }
}
