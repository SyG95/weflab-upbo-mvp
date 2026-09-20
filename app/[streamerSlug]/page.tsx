import IntegratedDelivery from './IntegratedDelivery';
import {selectVisibleFanTabs} from '../../lib/fanVisibleTabs';
import { isRefinedDesign, designId, type DesignId, type DesignRow } from "../../lib/designPreview";
import { allocateFanMonthly, monthlyViewers, monthOf, normalizeMonth, summarizeMonth, type MonthlyStatus } from "../../lib/fanMonthly";
import MonthPicker from "./MonthPicker";
import styles from "./page.module.css";
import ThresholdForm, { type ThresholdGroupRow } from "./ThresholdForm";
import CatalogManager from "./CatalogManager";
import DeliveryManager from "./DeliveryManager";
import ItemEventManager from "./ItemEventManager";
import ItemHistoryLog from "./ItemHistoryLog";
import RejudgeManager from "./RejudgeManager";
import SpecialRuleManager from "./SpecialRuleManager";
import {
  computeHoldings,
  DEFAULT_FAN_LAYOUT,
  normalizeFanLayout,
  fanLayoutBlocksInSlot,
  filterEntriesByCatalogUsage,
  matchFanTabLabel,
  matchFanTabLabelWhole,
  matchFanTabOrderIndex,
  matchGroupToConfig,
  normalizeAccountId,
  productColorById,
  type DeliveryAssignment,
  type FanLayoutBlock,
  type FanLayoutSlot,
  type AggItem,
  type Catalog,
  type CatalogGroup,
  type CatalogItem,
  type FanDeliveryReflect,
  type ImportBatch,
  type SignatureDetail,
  type SignatureKind,
  type StateResult,
  type StreamerState,
  type UpboEntry,
  type ViewerHolding,
  type ViewerSummary,
} from "../../lib/api";
import {
  getFanDeliveryAssignmentsBySlug,
  getStreamerState,
  getShowcaseBySlug,
  getCouponStateBySlug,
  getCouponExcludedNamesBySlug,
  getCouponBalancesForFan,
  getCouponItemsBySlug,
  couponExcludedNameSet,
  filterHoldingsByExcludedNames,
  getWardrobeBySlug,
  type ShowcaseState,
  type CouponState,
  type CouponBalance,
  type CouponItemDef,
  type WardrobeState,
} from "../../lib/upboSupabase";
import CouponManager from "./CouponManager";
import FanCouponTable from "./FanCouponTable";
import { redirect } from "next/navigation";
import WardrobeManager from "./WardrobeManager";
import { groupFanCoupons, filterFanCoupons } from "../../lib/fanCouponView";
import { resolveTheme } from "../../lib/themes";
import { noticeFontCss, noticeFontHref } from "../../lib/noticeFonts";
import { normalizeSheetFont, sheetFontCss, sheetFontHref } from "../../lib/sheetFonts";
import ThemeLiveBackground from "./ThemeLiveBackground";
import ShowcaseManager from "./ShowcaseManager";
import SignatureCountsManager from "./SignatureCountsManager";
import ManualEntryManager from "./ManualEntryManager";
import RouletteConfigManager, {
  type GroupForManager,
  type NamedRouletteForManager,
} from "./RouletteConfigManager";
import FanDeliveryModeForm from "./FanDeliveryModeForm";
import FanIdPrivacyForm from "./FanIdPrivacyForm";
import CouponTabLabelForm from "./CouponTabLabelForm";
import SheetTitleForm from "./SheetTitleForm";
import { effectiveThresholdForLabel } from "@/lib/upboCore";
import FanRevealCard, { type FanRevealTable } from "./FanRevealCard";
import ProductColorManager from "./ProductColorManager";
import FanRevealManager, { type RevealRoulette } from "./FanRevealManager";
import FanTabNameManager, { type FanNameRow, type FanTabForNaming } from "./FanTabNameManager";
import WeflabLinkManager from "./WeflabLinkManager";
import FanLayoutEditor from "./FanLayoutEditor";
import SheetAdminGate from "./SheetAdminGate";
import SheetAdminPasswordForm from "./SheetAdminPasswordForm";
import AdminTabEditor from "./AdminTabEditor";
import SortableSections from "./SortableSections";
import { AdminCollapseProvider, CollapsibleCard } from "./AdminCollapse";
import ShowcasePosterRail from "./ShowcasePosterRail";
import { sheetAdminAccessState } from "../../lib/sheetAdminAuth";
import { shouldShowRouletteTabs, splitProbabilityFamilies } from "../../lib/fanRouletteView";
import {
  OTHER_TAB_KEY,
  insertPastAfterRoulettes,
  isPastTabKey,
  oldGroupKey,
  pastLabelOfKey,
  pastTabKey,
  pastTabLabel,
  resolvePastTabRid,
  sortPastLabels,
  type PastTabContext,
} from "../../lib/fanPastTab";
import { fixedPeriodDaysLeft } from "../../lib/fixedPricePeriod";
import type { CSSProperties } from "react";

type PageProps = {
  params: Promise<{ streamerSlug: string }>;
  searchParams: Promise<{
    multi?: string;
    product?: string;
    design?: string;
    preview?: string;
    month?: string;
    status?: string;
    admin?: string;
    q?: string;
    tab?: string;
    atab?: string;
    theme?: string;
    rtab?: string;
    // 정가 탭 하위 유형(팬 표시 방식 subtabs 일 때): sig | event | server
    sfk?: string;
    w?: string;
    // P1 시안 비교 스위치(2026-08-26): "b"=방송국 옆방 레이아웃(무커스텀·팬 화면 한정)
    layout?: string;
  }>;
};

type FanTab = "ledger" | "history" | "coupon";
type AdminTab = "delivery" | "items" | "history" | "coupon" | "manual" | "roulettes" | "reveal" | "promo" | "wardrobe" | "signature" | "settings";

// 시스템 시간(끝에 Z 붙은 UTC ISO)을 Asia/Seoul 기준으로 변환해 "YYYY-MM-DD HH:mm KST"로 표시.
// donateTimeText 같은 위플랩 원문 시간에는 쓰지 않는다(그건 변환 없이 그대로 표시).
function fmtKst(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} KST`;
}

function groupAmountLabel(g: CatalogGroup): string {
  return g.amountMin === g.amountMax ? `${g.amountMin}` : `${g.amountMin}~${g.amountMax}`;
}

// entry의 룰렛 세트 표시 라벨(있을 때만). amountRangeLabel 우선, 없으면 donationAmount 숫자.
// 둘 다 없으면 undefined → 화면에서 숨긴다(억지 추론 금지).
function rouletteSetLabel(e: UpboEntry): string | undefined {
  if (e.amountRangeLabel) return e.amountRangeLabel;
  if (e.donationAmount != null) return String(e.donationAmount);
  return undefined;
}

function tabHref(slug: string, tab: FanTab, q: string): string {
  const params = new URLSearchParams();
  if (tab === "history") params.set("tab", "history");
  if (tab === "coupon") params.set("tab", "coupon");
  if (q) params.set("q", q);
  const qs = params.toString();
  return `/${slug}${qs ? `?${qs}` : ""}`;
}

// 같은 시청자의 같은 업보 항목은 ×횟수로 합치고, 확률 높은 순으로 정렬.
// 룰렛 세트 라벨이 있으면 같은 상품·확률이라도 세트별로 따로 묶는다(없으면 기존과 동일).
function aggregateItems(arr: UpboEntry[]): AggItem[] {
  const map = new Map<string, AggItem>();
  for (const e of arr) {
    const label = rouletteSetLabel(e);
    const k = `${e.itemName}@@${e.probability}@@${label ?? ""}`;
    const cur = map.get(k);
    const count = Math.max(1, Number(e.effectiveCount ?? 1));
    if (cur) cur.count += count;
    else
      map.set(k, {
        itemName: e.itemName,
        probability: e.probability,
        count,
        amountRangeLabel: label,
      });
  }
  return [...map.values()].sort((a, b) => b.probability - a.probability || b.count - a.count);
}

// entries를 계정ID(없으면 닉네임) 기준으로 통합. 시트는 확률 높은 순 내림차순.
// (히스토리 탭 등 원본 entry 기반 집계에서만 사용)
function groupByViewer(entries: UpboEntry[]): ViewerSummary[] {
  const map = new Map<string, UpboEntry[]>();
  for (const e of entries) {
    const key = (e.fanId && e.fanId.trim()) || e.fanNickname || e.id;
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }

  const groups: ViewerSummary[] = [];
  for (const [key, arr] of map) {
    const items = aggregateItems(arr);
    const top = [...arr].sort((a, b) => b.probability - a.probability)[0];
    const maxProb = items.reduce((m, it) => Math.max(m, it.probability), 0);
    groups.push({
      key,
      fanId: top.fanId,
      fanNickname: top.fanNickname,
      items,
      maxProb,
      total: arr.reduce((sum, entry) => sum + Math.max(1, Number(entry.effectiveCount ?? 1)), 0),
    });
  }

  groups.sort(
    (a, b) =>
      b.maxProb - a.maxProb ||
      b.total - a.total ||
      a.fanNickname.localeCompare(b.fanNickname),
  );
  return groups;
}

// ViewerHolding(computeHoldings 결과) → ViewerSummary(LedgerTable/DeliveryManager 공용 shape) 변환.
// mergeSets=false(기본): 같은 (itemName, probability, amountRangeLabel) 조각을 합산 — 배송관리는
//   처리수량을 세트 포함 itemKey로 저장하므로 기존 키 보존을 위해 이 모드를 유지한다.
// mergeSets=true(팬 시트 표시용): 세트(33/330)·확률 구분 없이 "상품명"만으로 합산.
//   sy 확정(2026-07-07): 같은 상품이 단차/연차 확률 차이로 칩이 갈라지던 것 통합, %는 표기 안 함
//   (확률표 공개가 정보를 담당). 정가 기록만은 "정가" 배지를 위해 별도 칩으로 유지한다.
//   probability는 화면에 안 보여도 "귀한 순" 정렬용으로 대푯값(최대)을 유지한다.
function holdingsToViewerSummaries(
  holdings: ViewerHolding[],
  opts?: { mergeSets?: boolean; withOps?: boolean },
): ViewerSummary[] {
  const mergeSets = opts?.mergeSets ?? false;
  // withOps(배송관리 전용): 줄마다 원본 기록 조각(refs=삭제용)과 미션 배지 플래그를 함께 싣는다.
  // 팬 화면 호출에는 싣지 않는다 — entryId 뭉치가 팬 페이지 payload 를 불릴 이유가 없다.
  const withOps = opts?.withOps ?? false;
  return holdings.map((h) => {
    const aggMap = new Map<string, AggItem>();
    for (const it of h.items) {
      const isFixed = it.amountRangeLabel === "정가";
      // 미션 배지: "정가 갯수와 일치해 정가로 기록된 미션 후원"만 (일반 미션 룰렛 당첨은 대상 아님).
      const isMissionFixed = isFixed && (it.donationType ?? "").includes("미션");
      const k = mergeSets
        ? `${it.itemName}@@${isFixed ? "정가" : ""}`
        : `${it.itemName}@@${it.probability}@@${it.amountRangeLabel ?? ""}`;
      // withOps ref 1조각 — 시각(recordedAtMs 등)·금액은 배송관리 시각 표시·시트 보기용(팬 호출엔 미포함).
      const opsRef = () => ({
        entryId: it.entryId,
        quantity: it.quantity,
        recordedAtMs: it.recordedAtMs,
        recordedKind: it.recordedKind,
        recordedText: it.recordedText || undefined,
        amount: it.donationAmount,
      });
      const cur = aggMap.get(k);
      if (cur) {
        cur.count += it.quantity;
        if (mergeSets && it.probability > cur.probability) cur.probability = it.probability;
        if (withOps) {
          cur.refs?.push(opsRef());
          if (isMissionFixed) cur.mission = true;
        }
      } else {
        aggMap.set(k, {
          itemName: it.itemName,
          probability: it.probability,
          count: it.quantity,
          amountRangeLabel: mergeSets ? (isFixed ? "정가" : undefined) : it.amountRangeLabel,
          ...(withOps
            ? { refs: [opsRef()], mission: isMissionFixed || undefined }
            : {}),
        });
      }
    }
    const items = [...aggMap.values()].sort(
      (a, b) => b.probability - a.probability || b.count - a.count,
    );
    return {
      key: h.key,
      fanId: h.ownerId,
      fanNickname: h.ownerName,
      items,
      maxProb: h.maxProb,
      total: h.total,
    };
  });
}

function matchesQuery(e: UpboEntry, needle: string): boolean {
  return (
    (e.fanId ?? "").toLowerCase().includes(needle) ||
    (e.fanNickname ?? "").toLowerCase().includes(needle)
  );
}

function filterViewers(groups: ViewerSummary[], q: string): ViewerSummary[] {
  if (!q) return groups;
  const needle = q.toLowerCase();
  return groups.filter(
    (g) =>
      g.fanId.toLowerCase().includes(needle) ||
      g.fanNickname.toLowerCase().includes(needle),
  );
}

// 획득 기록: 업보 목록과 별개로 상품 1건씩, 후원시간(원문) 포함. 최근순.
function historyRows(entries: UpboEntry[], q: string): UpboEntry[] {
  const needle = q.toLowerCase();
  const filtered = q ? entries.filter((e) => matchesQuery(e, needle)) : entries;
  return [...filtered].sort((a, b) =>
    a.donateTimeText < b.donateTimeText ? 1 : a.donateTimeText > b.donateTimeText ? -1 : 0,
  );
}

async function loadStreamerState(slug: string): Promise<StateResult> {
  try {
    const state = (await getStreamerState(slug)) as unknown as StreamerState;
    return { ok: true, state };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) return { ok: false, reason: "notfound" };
    return { ok: false, reason: "error" };
  }
}

export default async function StreamerUpboPage({ params, searchParams }: PageProps) {
  const { streamerSlug } = await params;
  // 팬 화면의 완료/미완료 필터(status)는 2026-09-17 제거 — 스트리머의 표시방법 설정이 팬에게 보이는 범위를 정한다.
  const { admin, q, tab, atab, theme: themePreview, rtab, sfk, w, layout, month, design, preview, product, multi } = await searchParams;
  const selectedDesign = designId("ref-u");
  const isAdminMode = admin === "1";
  const searchQuery = (q ?? "").trim();
  // 옛 옷장 탭 주소(?tab=wardrobe[&w=컷id]) → 독립 화면으로 이동(8/12 탭 제거).
  // 스트리머가 공지에 붙여둔 컷 딥링크가 죽지 않게 w 를 그대로 넘긴다.
  if (!isAdminMode && tab === "wardrobe") {
    const wq = typeof w === "string" && w ? `?w=${encodeURIComponent(w)}` : "";
    redirect(`/${encodeURIComponent(streamerSlug)}/wardrobe${wq}`);
  }
  // URL이 요청한 팬 탭. 쿠폰 탭은 스트리머가 내용을 등록했을 때만 열리므로 아래에서 한 번 더 거른다.
  const requestedFanTab: FanTab = tab === "history" ? "history" : tab === "coupon" ? "coupon" : "ledger";
  const activeAdminTab: AdminTab =
    atab === "settings"
      ? "settings"
      : atab === "items"
        ? "items"
        : atab === "history"
          ? "history"
          : atab === "coupon"
            ? "coupon"
            : atab === "manual"
            ? "manual"
            : atab === "roulettes"
              ? "roulettes"
              : atab === "reveal"
                ? "reveal"
                : atab === "promo"
            ? "promo"
            : atab === "wardrobe"
              ? "wardrobe"
            : atab === "signature"
              ? "signature"
              : "delivery";

  const result = await loadStreamerState(streamerSlug);
  const monthlyAssignmentsPromise = result.ok && !isAdminMode && ((result.state.fanDeliveryReflect ?? "off") !== "off")
    ? getFanDeliveryAssignmentsBySlug(streamerSlug).catch(() => null) : Promise.resolve([]);
  // 화면 제목용 표시 이름 — 슬러그는 주소 전용, 제목은 콘솔에서 입력한 이름(한글 가능).
  // 상태 로딩 실패 시(연결 안내 화면)만 슬러그로 폴백.
  const streamerName = (result.ok && result.state.displayName?.trim()) || streamerSlug;
  // 대문 제목(스트리머별, 표시 전용). 비어 있으면 기존 그대로 "{이름} 업보시트".
  const defaultSheetTitle = `${streamerName} 업보시트`;
  const sheetTitle = (result.ok && result.state.sheetTitle?.trim()) || defaultSheetTitle;
  // ?theme=<id> 는 저장 없이 화면에서만 테마를 미리 보는 용도(저장값 불변).
  const savedThemeId = result.ok ? result.state.settings?.accentColor : undefined;
  const theme = resolveTheme(themePreview || savedThemeId, themePreview ? null : result.ok ? result.state.settings?.customTheme : null);
  // 시트 글씨체(스트리머 선택, sheetFonts 화이트리스트) — 고르면 제목·탭·상품 칩까지 통일,
  // 미설정·오염값은 현행 개구체 그대로(변수 미주입 = CSS 기본값). 테마 vars 뒤에 얹어 항상 우선.
  const sheetFontKey = result.ok ? normalizeSheetFont(result.state.sheetFontKey) : "";
  const sheetFontFamily = sheetFontCss(sheetFontKey);
  const sheetFontLink = sheetFontHref(sheetFontKey);
  const themeStyle = {
    ...theme.vars,
    ...(sheetFontFamily ? { "--font-display": sheetFontFamily, "--font-chip": sheetFontFamily } : {}),
  } as CSSProperties;

  // 쇼케이스(홍보): 배너/포스터/공지를 등록한 스트리머만 팬 화면 레이아웃이 확장된다.
  // 조회 실패는 페이지를 죽이지 않고 "미표시"로 처리한다.
  const showcase: ShowcaseState | null = result.ok
    ? await getShowcaseBySlug(streamerSlug).catch(() => null)
    : null;
  // 쿠폰 장부(관리자 탭 전용). 테이블 미적용/조회 실패는 페이지를 죽이지 않고 탭 안에서 안내한다.
  const couponState: CouponState | null =
    result.ok && isAdminMode ? await getCouponStateBySlug(streamerSlug).catch(() => null) : null;
  // 조각 4 제외 집합 + 쿠폰 탭 노출 판단(쿠폰 종류 등록 여부)을 병렬로 얇게 읽는다.
  // 팬 모드는 공개 화면이라 잔액/이벤트 없이 가벼운 조회만(실패/미적용=빈 값=회귀 0).
  // 관리자 모드는 이미 읽은 couponState 에서 바로 뽑아 추가 조회가 없다.
  const [fanCouponExcluded, fanCouponItems, fanWardrobe] =
    result.ok && !isAdminMode
      ? await Promise.all([
          getCouponExcludedNamesBySlug(streamerSlug).catch(() => new Set<string>()),
          getCouponItemsBySlug(streamerSlug).catch(() => [] as CouponItemDef[]),
          // 옷장(의상) 탭 — 조회 실패는 "미표시"로 처리(페이지를 죽이지 않는다).
          getWardrobeBySlug(streamerSlug).catch(() => null),
        ])
      : [new Set<string>(), [] as CouponItemDef[], null];
  // 관리자 모드는 옷장 "탭을 열었을 때만" 읽는다(다른 관리 탭 = 추가 조회 0, fanCoupons 게이트와 동일 방식).
  const wardrobe: WardrobeState | null =
    result.ok && isAdminMode
      ? activeAdminTab === "wardrobe"
        ? await getWardrobeBySlug(streamerSlug).catch(() => null)
        : null
      : fanWardrobe;
  // 쿠폰 탭은 관리자에서 쿠폰 종류를 등록한 스트리머에게만 보여준다(안 쓰는 스트리머 = 탭 자체가 없음).
  const showCouponTab = fanCouponItems.length > 0;
  // 옷장은 독립 화면(/slug/wardrobe)이 본진 — 여기선 "옷장 문(버튼)" 노출 판단에만 쓴다(공개 컷 1장 이상).
  const wardrobeVisibleItems = (wardrobe?.items ?? []).filter((i) => !i.hidden);
  const activeTab: FanTab = requestedFanTab === "coupon" && !showCouponTab ? "ledger" : requestedFanTab;
  // 팬 "쿠폰" 탭 데이터(잔액). 쿠폰 탭을 실제로 열었을 때만 읽는다(다른 탭은 회귀 0).
  // 실패는 null — 화면에서 "빈 장부"와 다른 오류 문구로 구분해 보여준다.
  const fanCoupons: CouponBalance[] | null =
    result.ok && !isAdminMode && activeTab === "coupon"
      ? await getCouponBalancesForFan(streamerSlug).catch(() => null)
      : [];
  // 룰렛 확률표 공개(오른쪽 레일에 표시). 쇼케이스 콘텐츠가 없어도 확률표만으로 레일을 띄운다.
  const revealTables: FanRevealTable[] =
    result.ok && !isAdminMode ? buildFanRevealTables(result.state) : [];
  const hasProbRail = revealTables.length > 0;
  const showcaseContent = Boolean(
    showcase &&
      (showcase.bannerUrl || showcase.posterUrls?.some(Boolean) || showcase.noticeText?.trim()),
  );
  const showcaseOn = !isAdminMode && (showcaseContent || hasProbRail);
  // P1 시안 B("방송국 옆방") 비교 스위치 — 무커스텀(쇼케이스 없음) 팬 화면에서만 켠다.
  const layoutB = false;
  const posterItems = showcaseOn
    ? (showcase?.posterUrls ?? []).map((url, i) => ({ url, i })).filter((p) => Boolean(p.url))
    : [];
  const noticeText = showcase?.noticeText?.trim() ?? "";
  // 공지 전용 폰트(기본이면 사이트 글씨체 그대로). 비기본일 때만 구글폰트를 로드한다.
  const noticeFont = showcase?.noticeFont ?? "";
  const noticeFontLink = noticeFontHref(noticeFont);

  // 블록 배치(스트리머별): 포스터/확률표/공지를 어느 슬롯에 둘지. 내용 없는 블록은 표시 안 함.
  const fanLayout = normalizeFanLayout((result.ok ? result.state.fanLayout : undefined) ?? DEFAULT_FAN_LAYOUT);
  const blockPresent: Record<FanLayoutBlock, boolean> = {
    poster0: posterItems.some(p=>p.i===0),
    poster1: posterItems.some(p=>p.i===1),
    poster2: posterItems.some(p=>p.i===2),
    poster3: posterItems.some(p=>p.i===3),
    poster4: posterItems.some(p=>p.i===4),

    reveal: revealTables.length > 0,
    notice: Boolean(showcaseOn && noticeText),
  };
  const slotBlocks = (slot: FanLayoutSlot): FanLayoutBlock[] =>
    fanLayoutBlocksInSlot(fanLayout, slot).filter((b) => blockPresent[b]);
  const topBlocks = slotBlocks("top");
  const leftBlocks = slotBlocks("left");
  const rightBlocks = slotBlocks("right");
  const bottomBlocks = slotBlocks("bottom");

  // 블록 1개 렌더. horizontal=가로 슬롯(시트 위/아래) — 포스터는 가로 나열로 변형.
  const renderFanBlock = (block: FanLayoutBlock, horizontal: boolean) =>
    block.startsWith("poster") ? (
      <ShowcasePosterRail
        key={block}
        gallery={posterItems.map(({url,i})=>({url:url as string,i,link:showcase?.posterLinks?.[i]??null}))}
        horizontal={horizontal}
        posters={posterItems.filter(p=>p.i===Number(block.slice(-1))).map(({ url, i }) => ({
          url: url as string,
          i,
          link: showcase?.posterLinks?.[i] ?? null,
        }))}
      />
    ) : block === "reveal" ? (
      <FanRevealCard key="reveal" tables={revealTables} />
    ) : (
      <section key="notice" className={styles.showcaseNotice} aria-label="공지사항">
        {/* 비기본 공지 폰트일 때만 구글폰트 로드(Next가 head로 hoist·중복 제거). */}
        {noticeFontLink ? <link rel="stylesheet" href={noticeFontLink} /> : null}
        <h3>공지사항</h3>
        <p style={noticeFont ? { fontFamily: noticeFontCss(noticeFont) } : undefined}>{noticeText}</p>
      </section>
    );

  // 관리자 모드 잠금: 스트리머(슬러그)별 비밀번호 확인 전엔 화면을 열지 않는다.
  const sheetAccess = isAdminMode ? await sheetAdminAccessState(streamerSlug) : null;
  const sheetAdminLocked = sheetAccess === "locked" || sheetAccess === "blocked-unconfigured";

  const monthlyAssignments = await monthlyAssignmentsPromise;
  return (
    <main
      className={styles.page}
      data-design={selectedDesign}
      style={themeStyle}
      data-fx={theme.fx?.background}
      data-glass={theme.fx?.glass ? "1" : undefined}
      data-showcase={showcaseOn ? "1" : undefined}
    >
      <ThemeLiveBackground fx={theme.fx?.background} palette={theme.fx?.nebulaPalette} />
      {sheetFontLink ? <link rel="stylesheet" href={sheetFontLink} /> : null}
      <div className={styles.shell}>
        {showcaseOn && showcase?.bannerUrl ? (
          <section className={styles.showcaseBanner} aria-label={`${streamerName} 배너`}>
            {/* 원본 비율 유지가 핵심이라 next/image 대신 img 사용(외부 도메인 설정 불요) */}
            {showcase.bannerLink ? (
              <a href={showcase.bannerLink} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={showcase.bannerUrl} alt={`${streamerName} 배너`} />
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={showcase.bannerUrl} alt={`${streamerName} 배너`} />
            )}
          </section>
        ) : null}
        {layoutB ? null : (
          <header className={styles.cover}>
            <div className={styles.coverTop}>
              <div>
                <h1 className={styles.coverName}>{sheetTitle}</h1>
              </div>
              <a
                className={styles.adminTab}
                href={isAdminMode ? `/${streamerSlug}` : `/${streamerSlug}?admin=1`}
              >
                {isAdminMode ? "팬 화면으로" : "관리자"}
              </a>
            </div>
          </header>
        )}

        {isAdminMode && sheetAdminLocked ? (
          <SheetAdminGate
            slug={streamerSlug}
            blocked={sheetAccess === "blocked-unconfigured"}
            returnTo={`/${streamerSlug}?admin=1${activeAdminTab !== "delivery" ? `&atab=${activeAdminTab}` : ""}`}
          />
        ) : !result.ok ? (
          <ConnectionNotice reason={result.reason} slug={streamerSlug} />
        ) : isAdminMode ? (
          <AdminPanel
            integratedMonth={normalizeMonth(month)}
            state={result.state}
            activeAdminTab={activeAdminTab}
            showcase={showcase}
            coupon={couponState}
            wardrobe={wardrobe}
          />
        ) : showcaseOn ? (
          <div
            className={styles.showcaseLayout}
            data-top={topBlocks.length > 0 ? "1" : undefined}
            data-bottom={bottomBlocks.length > 0 ? "1" : undefined}
            data-rails-head={fanLayout.railsAtHead ? "1" : undefined}
          >
            {topBlocks.length > 0 ? (
              <div className={styles.slotTop}>{topBlocks.map((b) => renderFanBlock(b, true))}</div>
            ) : null}
            {leftBlocks.length > 0 ? (
              <aside className={styles.slotLeft}>{leftBlocks.map((b) => renderFanBlock(b, false))}</aside>
            ) : null}
            <div className={styles.showcaseMain}>
              <FanView
                state={result.state}
                slug={streamerSlug}
                searchQuery={searchQuery}
                activeTab={activeTab}
                activeRoulette={rtab ?? ""}
                activeSigKind={sfk ?? ""}
                activeMonth={normalizeMonth(month)}
                monthlyStatus="all"
                monthlyAssignments={monthlyAssignments}
                design={selectedDesign}
                activeProduct={product ?? ""}
                activeMonths={multi ?? ""}
                excludedNames={fanCouponExcluded}
                coupons={fanCoupons}
                showCouponTab={showCouponTab}
                wardrobeItems={wardrobeVisibleItems}
              />
            </div>
            {rightBlocks.length > 0 ? (
              <aside className={styles.slotRight}>{rightBlocks.map((b) => renderFanBlock(b, false))}</aside>
            ) : null}
            {bottomBlocks.length > 0 ? (
              <div className={styles.slotBottom}>{bottomBlocks.map((b) => renderFanBlock(b, true))}</div>
            ) : null}
          </div>
        ) : (
          <FanView
            state={result.state}
            slug={streamerSlug}
            searchQuery={searchQuery}
            activeTab={activeTab}
            activeRoulette={rtab ?? ""}
            activeSigKind={sfk ?? ""}
                activeMonth={normalizeMonth(month)}
                monthlyStatus="all"
                monthlyAssignments={monthlyAssignments}
                design={selectedDesign}
                activeProduct={product ?? ""}
                activeMonths={multi ?? ""}
            excludedNames={fanCouponExcluded}
            coupons={fanCoupons}
            showCouponTab={showCouponTab}
            wardrobeItems={wardrobeVisibleItems}
            layoutB={layoutB}
            sheetTitle={sheetTitle}
            streamerName={streamerName}
            stationLink={showcase?.bannerLink ?? null}
          />
        )}
      </div>
    </main>
  );
}

function ConnectionNotice({
  reason,
  slug,
}: {
  reason: "offline" | "notfound" | "error";
  slug: string;
}) {
  const text =
    reason === "notfound"
      ? `아직 '${slug}' 데이터가 없어요. Extension으로 룰렛표와 결과를 먼저 수집해 주세요.`
      : "업보 데이터를 불러오지 못했어요. 잠시 후 새로고침하거나 서버 표시 API 연결을 확인해 주세요.";
  return (
    <section className={styles.ledger}>
      <div className={styles.emptyState}>
        <span className={`${styles.stamp} ${styles.stampGhost}`}>대기</span>
        <p>{text}</p>
      </div>
    </section>
  );
}

// 팬 탭 시퀀스 한 칸 — 룰렛 탭 또는 정가/기타 자리. 팬 화면 탭 순서와 관리자 드래그 목록이 공유한다.
// past = "지난 시즌 · L" 탭(팬 탭 되짚기, 2026-09-20). label 은 금액대 라벨 L 원문(표시 이름은 pastTabLabelOf).
// 실제 기록이 있는 L 만 partition 시점에 동적으로 끼운다(룰렛 뒤 고정, 드래그 순서 불참).
type FanTabSeqItem =
  | { kind: "roulette"; rid: string; label: string }
  | { kind: "past"; rid: string; label: string }
  | { kind: "fixed" }
  | { kind: "other" };

// 룰렛 인덱스(관리자·팬 공용). 스트리머가 직접 묶은 룰렛(config)을 우선하고, 안 묶인 그룹은
// 자동 클러스터(자카드 ≥ 0.5)로 잠정 묶어 팬 탭을 만든다. 자동 클러스터는 관리자 화면의 "추천"으로도 쓴다.
type RouletteIndex = {
  rouletteByGroupIndex: Record<number, string>;
  rouletteLabelById: Record<string, string>;
  rouletteArchivedById: Record<string, boolean>;
  // 원본 상품명 → 룰렛(rid, 표시라벨, 보관여부). 같은 이름이 여러 룰렛이면 먼저 잡힌 것 우선.
  itemRoulette: Map<string, { rid: string; label: string; archived: boolean }>;
  // 팬 탭 순서: 보관 안 됐고 상품이 있는 룰렛만. 저장된 드래그 순서 우선, 없으면 표시라벨 순.
  fanRouletteOrder: Array<{ rid: string; label: string }>;
  // 팬 탭 전체 시퀀스(룰렛 + 정가/기타 자리 포함) — 팬 화면 탭과 관리자 "팬 탭 이름" 목록 공용.
  fanTabSequence: FanTabSeqItem[];
  // 관리자 "룰렛 관리" 탭 데이터
  managerGroups: GroupForManager[];
  managerRoulettes: NamedRouletteForManager[];
  // 기준 확률 설정용 — 예외 키(금액대 라벨) 단위로 묶은 확률표 목록.
  thresholdGroups: ThresholdGroupRow[];
  // 확률 공개 하위탭 토글 목록(보관 제외한 모든 룰렛).
  revealRoulettes: RevealRoulette[];
  // 관리자 "팬 탭 이름" 섹션 데이터 — 팬 탭 순서와 같은 목록(보관 제외) + 지문/현재 이름.
  fanTabManager: FanTabForNaming[];
  // 정가/기타 탭 표시 이름(팬 탭 이름 오버레이 적용 결과. 기본 "정가"/"기타").
  fixedTabLabel: string;
  otherTabLabel: string;
  // 팬 탭 되짚기(2026-09-20) 문맥 — 상품명이 최신 표에 없는 기록만 이걸로 (버전, 그룹)·금액대를 되짚는다.
  // 옛 버전 그룹은 itemsByRid/itemRoulette 에 넣지 않는다(다른 소비자 결과 불변).
  pastCtx: PastTabContext;
  // "지난 시즌 · L" 탭 표시 이름(pastLabels 오버레이 > 기본).
  pastTabLabelOf: (label: string) => string;
};

function buildRouletteIndex(state: StreamerState): RouletteIndex {
  const catalogs = [...(state.catalogs ?? [])].sort((a, b) => a.version - b.version);
  const activeCatalog =
    catalogs.find((c) => c.version === state.currentCatalogVersion) ?? catalogs.at(-1);
  const groups = activeCatalog?.groups ?? [];
  const config = state.rouletteConfig ?? [];

  const groupItems = groups.map((g) => [
    ...new Set((g.items ?? []).map((it) => it.itemName).filter(Boolean)),
  ]);

  // 1) 각 그룹을 스트리머가 만든 룰렛(config)에 매칭(멤버 그룹과 자카드 ≥ 0.5). 없으면 -1.
  const assignedCfg = groupItems.map((items) => matchGroupToConfig(items, config));

  // 2) 자동 클러스터(자카드 ≥ 0.5) — 추천 도우미 + 미분류 그룹 잠정 묶기용.
  const autoRoot: number[] = groups.map((_, i) => i);
  {
    const sets = groupItems.map((a) => new Set(a));
    const find = (x: number): number => {
      while (autoRoot[x] !== x) {
        autoRoot[x] = autoRoot[autoRoot[x]];
        x = autoRoot[x];
      }
      return x;
    };
    const similar = (a: Set<string>, b: Set<string>): boolean => {
      if (a.size === 0 && b.size === 0) return true;
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      let inter = 0;
      for (const n of small) if (large.has(n)) inter++;
      const union = a.size + b.size - inter;
      return union > 0 && inter / union >= 0.5;
    };
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        if (similar(sets[i], sets[j])) {
          const ri = find(i);
          const rj = find(j);
          if (ri !== rj) autoRoot[ri] = rj;
        }
      }
    }
    for (let i = 0; i < autoRoot.length; i++) autoRoot[i] = find(i);
  }

  // 3) rid: 스트리머 룰렛 우선("named:<cfgIdx>"), 미분류는 자동 클러스터("auto:<root>").
  const ridOf = (i: number): string =>
    assignedCfg[i] >= 0 ? `named:${assignedCfg[i]}` : `auto:${autoRoot[i]}`;
  const rouletteByGroupIndex: Record<number, string> = {};
  const amountsByRid: Record<string, Set<string>> = {};
  const itemsByRid: Record<string, Set<string>> = {};
  // rid별 멤버 그룹 지문(확률 공개 config 생성 + 팬 탭 이름 매칭 공용).
  const groupsByRid: Record<string, string[][]> = {};
  groups.forEach((g, i) => {
    const rid = ridOf(i);
    rouletteByGroupIndex[g.groupIndex] = rid;
    if (!amountsByRid[rid]) amountsByRid[rid] = new Set();
    if (g.amountRangeLabel) amountsByRid[rid].add(String(g.amountRangeLabel));
    if (!itemsByRid[rid]) itemsByRid[rid] = new Set();
    for (const n of groupItems[i]) itemsByRid[rid].add(n);
    if (!groupsByRid[rid]) groupsByRid[rid] = [];
    groupsByRid[rid].push(groupItems[i]);
  });

  const rouletteLabelById: Record<string, string> = {};
  const rouletteArchivedById: Record<string, boolean> = {};
  const nameOfRid: Record<string, string | undefined> = {};
  for (const rid of Object.keys(itemsByRid)) {
    rouletteLabelById[rid] = [...(amountsByRid[rid] ?? [])].join("/");
    if (rid.startsWith("named:")) {
      const cfg = config[Number(rid.slice(6))];
      nameOfRid[rid] = cfg?.name;
      rouletteArchivedById[rid] = cfg?.archived === true;
    } else {
      rouletteArchivedById[rid] = false;
    }
  }
  // 팬 탭 이름 오버레이(묶기와 독립, sy 확정 2026-07-08). 탭의 상품 지문으로 매칭해서 캡처가 바뀌거나
  // 묶음을 해제해도 이름이 따라온다. 표시 이름 우선순위(sy 2026-07-08 확장):
  //   1) 이 탭 전체에 직접 지은 오버레이 이름(팬 탭 이름)
  //   2) 이 묶음에 지은 이름(룰렛 묶기)
  //   3) 구성 룰렛들에 지은 이름 이어붙이기 — 이름 지은 룰렛들을 묶었을 때 "봄·여름"처럼 자동 표시
  //   4) 자동(금액 나열) → 그것도 없으면 "기타"
  const fanLabels = state.fanTabLabels;
  const overlayWholeOfRid: Record<string, string | undefined> = {};
  const overlayJoinOfRid: Record<string, string | undefined> = {};
  for (const rid of Object.keys(itemsByRid)) {
    const members = groupsByRid[rid] ?? [];
    overlayWholeOfRid[rid] = matchFanTabLabelWhole(members, fanLabels?.entries);
    const names: string[] = [];
    for (const g of members) {
      const nm = matchFanTabLabel([g], fanLabels?.entries);
      if (nm && !names.includes(nm)) names.push(nm);
    }
    overlayJoinOfRid[rid] = names.length > 0 ? names.join("·") : undefined;
  }
  const displayLabel = (rid: string): string =>
    overlayWholeOfRid[rid] ||
    nameOfRid[rid] ||
    overlayJoinOfRid[rid] ||
    rouletteLabelById[rid] ||
    "기타";

  const itemRoulette = new Map<string, { rid: string; label: string; archived: boolean }>();
  for (const rid of Object.keys(itemsByRid)) {
    const info = { rid, label: displayLabel(rid), archived: rouletteArchivedById[rid] ?? false };
    for (const n of itemsByRid[rid]) if (!itemRoulette.has(n)) itemRoulette.set(n, info);
  }

  const baseRoulettes = Object.keys(itemsByRid)
    .filter((rid) => itemsByRid[rid].size > 0 && !(rouletteArchivedById[rid] ?? false))
    .map((rid) => ({ rid, label: displayLabel(rid) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  // 저장된 팬 탭 순서(드래그) 적용 — 순서도 이름처럼 상품 지문으로 매칭해 캡처가 바뀌어도 따라온다.
  // 매칭 안 되는(새) 탭은 뒤에 가나다순, 정가/기타는 저장 위치가 없으면 기존처럼 맨 뒤(정가→기타).
  const savedOrder = fanLabels?.order ?? [];
  const UNORDERED = Number.MAX_SAFE_INTEGER - 2;
  const fixedOrderIdx = savedOrder.findIndex((o) => o.kind === "fixed");
  const otherOrderIdx = savedOrder.findIndex((o) => o.kind === "other");
  const seqSource: Array<{ key: number; item: FanTabSeqItem }> = baseRoulettes.map((r) => ({
    key: matchFanTabOrderIndex(groupsByRid[r.rid] ?? [], savedOrder) ?? UNORDERED,
    item: { kind: "roulette", rid: r.rid, label: r.label },
  }));
  seqSource.push({ key: fixedOrderIdx >= 0 ? fixedOrderIdx : UNORDERED + 1, item: { kind: "fixed" } });
  seqSource.push({ key: otherOrderIdx >= 0 ? otherOrderIdx : UNORDERED + 2, item: { kind: "other" } });
  seqSource.sort((a, b) => a.key - b.key); // 안정 정렬 — 같은 키(미배치)는 가나다순 유지.
  const fanTabSequence = seqSource.map((s) => s.item);
  const fanRouletteOrder = fanTabSequence.filter(
    (s): s is Extract<FanTabSeqItem, { kind: "roulette" }> => s.kind === "roulette",
  ).map(({ rid, label }) => ({ rid, label }));

  // 관리자 "팬 탭 이름" 섹션 — 팬 탭과 같은 목록. 정가/기타 이름은 별도 필드(키 고정).
  const fanTabManager: FanTabForNaming[] = fanRouletteOrder.map(({ rid, label }) => ({
    rid,
    currentLabel: label,
    autoLabel: rouletteLabelById[rid] || "",
    overlayName: overlayWholeOfRid[rid],
    configName: nameOfRid[rid],
    groups: groupsByRid[rid] ?? [],
  }));
  const fixedTabLabel = fanLabels?.fixedLabel || "정가";
  const otherTabLabel = fanLabels?.otherLabel || "기타";

  // 팬 탭 되짚기 문맥(2026-09-20). 읽기만 — 색인(itemsByRid·itemRoulette)에는 아무것도 추가하지 않는다.
  //  oldGroups: state.catalogs 전 버전(활성 포함)의 그룹 → `${version}:${groupIndex}` → {라벨, 상품명}.
  //             옛 버전 행은 조회 다이어트로 items=[] 지만 groups 는 그대로 온다(새 쿼리 0).
  //  labelRids: 활성 표 그룹 라벨 → 팬 탭으로 뜨는(비보관·상품 있음) rid 들, 중복 제거.
  const oldGroups = new Map<string, { label: string; items: string[] }>();
  for (const cat of catalogs) {
    for (const g of cat.groups ?? []) {
      oldGroups.set(oldGroupKey(cat.version, g.groupIndex), {
        label: g.amountRangeLabel ? String(g.amountRangeLabel).trim() : "",
        items: [...new Set((g.items ?? []).map((it) => it.itemName).filter(Boolean))],
      });
    }
  }
  const fanTabRids = new Set(baseRoulettes.map((r) => r.rid));
  const labelRids = new Map<string, string[]>();
  groups.forEach((g, i) => {
    // 키는 trim 한 값으로 — resolvePastTabRid·catalog-items-at 가 같은 기준으로 비교한다
    // (공백 섞인 라벨이 같은 금액대 탭 대신 past:L 로 빠지지 않게).
    const label = g.amountRangeLabel ? String(g.amountRangeLabel).trim() : "";
    if (!label) return;
    const rid = ridOf(i);
    if (!fanTabRids.has(rid)) return;
    const list = labelRids.get(label) ?? [];
    if (!list.includes(rid)) list.push(rid);
    labelRids.set(label, list);
  });
  const pastCtx: PastTabContext = {
    labelRids,
    groupItemsByRid: new Map(Object.entries(groupsByRid)),
    oldGroups,
  };
  const pastTabLabelOf = (label: string): string => pastTabLabel(label, fanLabels?.pastLabels);

  // 관리자 UI 데이터 — 실제 그룹 목록 + 스트리머가 만든 룰렛.
  const managerGroups: GroupForManager[] = groups.map((g, i) => ({
    index: g.groupIndex,
    amountLabel: g.amountRangeLabel ? String(g.amountRangeLabel) : "",
    itemCount: groupItems[i].length,
    sampleItems: groupItems[i].slice(0, 5),
    items: groupItems[i],
    assignedConfigIndex: assignedCfg[i],
    assignedName: assignedCfg[i] >= 0 ? config[assignedCfg[i]]?.name ?? "" : undefined,
    suggestKey: `auto:${autoRoot[i]}`,
  }));
  const managerRoulettes: NamedRouletteForManager[] = config
    .map((c, ci) => ({
      configIndex: ci,
      name: c.name ?? "",
      archived: c.archived === true,
      revealed: c.revealed === true,
      groupIndices: groups.filter((_, i) => assignedCfg[i] === ci).map((g) => g.groupIndex),
    }))
    .filter((r) => r.groupIndices.length > 0);

  // 기준 확률 설정용 — 예외 키(금액대 라벨) 단위로 묶은 확률표 목록.
  // 라벨이 비어 있는 그룹은 예외 키를 만들 수 없어 제외한다(기본 기준으로만 판정됨).
  const thresholdGroups: ThresholdGroupRow[] = (() => {
    const byLabel = new Map<string, ThresholdGroupRow>();
    for (const g of managerGroups) {
      if (!g.amountLabel) continue;
      const cur = byLabel.get(g.amountLabel);
      if (cur) {
        cur.itemCount += g.itemCount;
        if (cur.sampleItems.length < 2) {
          cur.sampleItems = [...cur.sampleItems, ...g.sampleItems].slice(0, 2);
        }
      } else {
        byLabel.set(g.amountLabel, {
          label: g.amountLabel,
          itemCount: g.itemCount,
          sampleItems: g.sampleItems.slice(0, 2),
        });
      }
    }
    return [...byLabel.values()];
  })();

  // 확률 공개 토글 목록: rid별 멤버 그룹 지문(위에서 계산한 groupsByRid) + 현재 공개 여부.
  const revealRoulettes: RevealRoulette[] = Object.keys(itemsByRid)
    .filter((rid) => itemsByRid[rid].size > 0 && !(rouletteArchivedById[rid] ?? false))
    .map((rid) => ({
      rid,
      label: displayLabel(rid),
      itemCount: itemsByRid[rid].size,
      groupsItemSets: groupsByRid[rid] ?? [],
      configIndex: rid.startsWith("named:") ? Number(rid.slice(6)) : null,
      revealed: rid.startsWith("named:") ? config[Number(rid.slice(6))]?.revealed === true : false,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    rouletteByGroupIndex,
    rouletteLabelById,
    rouletteArchivedById,
    itemRoulette,
    fanRouletteOrder,
    fanTabSequence,
    managerGroups,
    managerRoulettes,
    thresholdGroups,
    revealRoulettes,
    fanTabManager,
    fixedTabLabel,
    otherTabLabel,
    pastCtx,
    pastTabLabelOf,
  };
}

// 팬 화면 확률표 카드 데이터: fanRevealEnabled 마스터 on + 공개(revealed) 룰렛만.
// 업보 탭용 룰렛 묶음은 유지하되, 묶음 안에서 전체 상품명+확률표가 다른 그룹은 실제 확률군별로 분리한다.
// 목록은 "기록되는 상품"만(기록 on + 업보 기준 이하 = 팬 칩으로 뜰 수 있는 것). 확률 높은순.
function buildFanRevealTables(state: StreamerState): FanRevealTable[] {
  if (!state.fanRevealEnabled) return [];
  const config = state.rouletteConfig ?? [];
  const revealedIdx = config.map((c, i) => (c.revealed ? i : -1)).filter((i) => i >= 0);
  if (revealedIdx.length === 0) return [];
  const catalogs = [...(state.catalogs ?? [])].sort((a, b) => a.version - b.version);
  const activeCatalog =
    catalogs.find((c) => c.version === state.currentCatalogVersion) ?? catalogs.at(-1);
  const groups = activeCatalog?.groups ?? [];
  const groupItemSets = groups.map((g) => [
    ...new Set((g.items ?? []).map((it) => it.itemName).filter(Boolean)),
  ]);
  const groupCfg = groupItemSets.map((s) => matchGroupToConfig(s, config));
  // "기록되는 상품" 판정: 사용설정 오버라이드(상품>그룹>캡처값) + 기준 확률 이하(CatalogManager 규칙 동일).
  const usage = activeCatalog ? state.catalogUsageByVersion?.[activeCatalog.version] ?? {} : {};
  const threshold = Number(state.settings?.thresholdPercent ?? 2);
  // 룰렛표별 기준확률 예외 반영(판정과 동일 규칙) — 예외로 업보가 된 상품이 팬 확률표에서 빠지지 않게.
  const revealThresholdOverrides = state.thresholdOverrides ?? {};
  const recorded = (g: CatalogGroup, it: CatalogItem, idx: number): boolean => {
    if (it.probability > effectiveThresholdForLabel(revealThresholdOverrides, g.amountRangeLabel, threshold)) return false;
    const itemKey = `g${g.groupIndex}-i${it.sortOrder ?? idx}`;
    const groupKey = `g${g.groupIndex}`;
    if (usage[itemKey] !== undefined) return usage[itemKey];
    if (usage[groupKey] !== undefined) return usage[groupKey];
    return it.enabled !== false && g.enabled !== false;
  };
  const tables: FanRevealTable[] = [];
  for (const k of revealedIdx) {
    // 확률표 카드 제목도 팬 탭과 같은 이름 규칙: 팬 탭 이름 오버레이 > 묶음 이름 > 금액 나열.
    const memberSets = groupItemSets.filter((_, gi) => groupCfg[gi] === k);
    const matchedGroups = groups.filter((_, gi) => groupCfg[gi] === k);
    const families = splitProbabilityFamilies(matchedGroups);
    const parentLabel =
      matchFanTabLabel(memberSets, state.fanTabLabels?.entries) ||
      config[k].name ||
      matchedGroups.map((g) => g.amountRangeLabel).filter(Boolean).join("/") ||
      "룰렛";
    const familyTables: Array<{
      key: string;
      suffix: string;
      items: Array<{ name: string; prob: number }>;
    }> = [];

    families.forEach((family, familyIndex) => {
      // 같은 실제 확률군 안에서는 (상품, 확률) 중복을 한 줄로 합치고 금액 라벨만 모은다.
      const rows: Array<{ name: string; prob: number; amounts: Set<string> }> = [];
      const byKey = new Map<string, { name: string; prob: number; amounts: Set<string> }>();
      family.groups.forEach((g) => {
        (g.items ?? []).forEach((it, idx) => {
          if (!it.itemName) return;
          if (!recorded(g, it, idx)) return;
          const key = `${it.itemName} ${it.probability}`;
          let entry = byKey.get(key);
          if (!entry) {
            entry = { name: it.itemName, prob: it.probability, amounts: new Set() };
            byKey.set(key, entry);
            rows.push(entry);
          }
          if (g.amountRangeLabel) entry.amounts.add(String(g.amountRangeLabel));
        });
      });
      if (rows.length === 0) return;

      const probCount = new Map<string, number>();
      for (const row of rows) probCount.set(row.name, (probCount.get(row.name) ?? 0) + 1);
      const items = rows
        .map((row) => ({
          name:
            (probCount.get(row.name) ?? 0) > 1 && row.amounts.size > 0
              ? `${row.name} (${[...row.amounts].join("·")})`
              : row.name,
          prob: row.prob,
        }))
        .sort((a, b) => b.prob - a.prob);
      familyTables.push({
        key: `named:${k}:family:${familyIndex}`,
        suffix: family.amountLabels.join("/") || `확률군 ${familyIndex + 1}`,
        items,
      });
    });

    for (const familyTable of familyTables) {
      tables.push({
        key: familyTable.key,
        label: familyTables.length > 1 ? `${parentLabel} · ${familyTable.suffix}` : parentLabel,
        items: familyTable.items,
      });
    }
  }
  return tables;
}

// 보유 현황을 룰렛별로 나눈다. 보관 룰렛 상품은 팬 화면에서 제외, 매칭 안 되는 상품은 "기타".
function partitionHoldingsByRoulette(
  holdings: ViewerHolding[],
  index: RouletteIndex,
): Array<{ key: string; label: string; holdings: ViewerHolding[] }> {
  const OTHER = OTHER_TAB_KEY; // "__other__" — resolvePastTabRid 가 돌려주는 기타 키와 같은 값.
  const FIXED = "__fixed__";
  // rid → (ownerKey → ViewerHolding)
  const byRid = new Map<string, Map<string, ViewerHolding>>();
  for (const vh of holdings) {
    for (const it of vh.items) {
      // 정가(시그니처) 기록은 룰렛과 무관 — "기타"에 섞지 않고 전용 "정가" 탭으로(sy 2026-07-07).
      const isFixed = it.amountRangeLabel === "정가";
      const info = isFixed ? undefined : index.itemRoulette.get(it.originalItemName);
      if (info?.archived) continue; // 보관 룰렛은 팬 화면에서 숨김.
      // 상품명이 최신 표에 있는 기록(info 있음)은 이전과 같은 경로(불변 조건 1). 없을 때만 되짚기(2026-09-20):
      // (버전, 그룹)·금액대로 같은 금액대 탭 또는 "지난 시즌 · L"(past:L), 못 되짚으면 기존처럼 기타.
      const rid = isFixed ? FIXED : info ? info.rid : resolvePastTabRid(it, index.pastCtx);
      let owners = byRid.get(rid);
      if (!owners) {
        owners = new Map();
        byRid.set(rid, owners);
      }
      let g = owners.get(vh.key);
      if (!g) {
        g = { ...vh, items: [], maxProb: 0, total: 0 };
        owners.set(vh.key, g);
      }
      g.items.push(it);
    }
  }
  const finalize = (rid: string): ViewerHolding[] => {
    const owners = byRid.get(rid);
    if (!owners) return [];
    const list: ViewerHolding[] = [];
    for (const g of owners.values()) {
      g.total = g.items.reduce((s, it) => s + it.quantity, 0);
      g.maxProb = g.items.reduce((m, it) => Math.max(m, it.probability), 0);
      if (g.total > 0) list.push(g);
    }
    return list;
  };
  // 탭 순서 = fanTabSequence(저장된 드래그 순서 반영). 정가/기타도 저장 위치에 놓이고,
  // 저장이 없으면 기존 기본(룰렛 가나다순 → 정가 → 기타) 그대로다.
  // "지난 시즌 · L" 탭은 실제 기록이 있는 L 만, 마지막 룰렛 탭 뒤에 L 숫자순으로 끼운다(드래그 순서 불참).
  const pastItems: FanTabSeqItem[] = sortPastLabels(
    [...byRid.keys()].filter(isPastTabKey).map(pastLabelOfKey),
  ).map((label) => ({ kind: "past", rid: pastTabKey(label), label }));
  const result: Array<{ key: string; label: string; holdings: ViewerHolding[] }> = [];
  for (const seq of insertPastAfterRoulettes(index.fanTabSequence, pastItems)) {
    if (seq.kind === "roulette") {
      const list = finalize(seq.rid);
      if (list.length > 0) result.push({ key: seq.rid, label: seq.label, holdings: list });
    } else if (seq.kind === "past") {
      const list = finalize(seq.rid);
      if (list.length > 0) result.push({ key: seq.rid, label: index.pastTabLabelOf(seq.label), holdings: list });
    } else if (seq.kind === "fixed") {
      const fixed = finalize(FIXED);
      if (fixed.length > 0) result.push({ key: FIXED, label: index.fixedTabLabel, holdings: fixed });
    } else {
      const other = finalize(OTHER);
      if (other.length > 0) result.push({ key: OTHER, label: index.otherTabLabel, holdings: other });
    }
  }
  return result;
}

// 룰렛 그룹들을 하나로 합친다(룰렛 탭을 안 쓰는 "전체" 화면용). 보관 상품은 이미 partition 에서
// 빠진 상태이므로, 남은 조각만 시청자별로 다시 모아 총량을 재계산한다.
function flattenGroups(
  groups: Array<{ key: string; label: string; holdings: ViewerHolding[] }>,
): ViewerHolding[] {
  const byKey = new Map<string, ViewerHolding>();
  for (const grp of groups) {
    for (const vh of grp.holdings) {
      const cur = byKey.get(vh.key);
      if (cur) cur.items.push(...vh.items);
      else byKey.set(vh.key, { ...vh, items: [...vh.items] });
    }
  }
  const list = [...byKey.values()];
  for (const g of list) {
    g.total = g.items.reduce((s, it) => s + it.quantity, 0);
    g.maxProb = g.items.reduce((m, it) => Math.max(m, it.probability), 0);
  }
  return list;
}

// 팬 화면에 실제로 렌더되는 룰렛 탭 목록. FanView 표시와 관리자 "팬 탭 이름" 목록이 이 함수를 공유해
// 항상 일치한다 — 당첨 기록이 있어 탭으로 뜨는 룰렛만. 일반 룰렛 하나뿐이면 기존처럼 "전체"지만,
// 정가/기타가 함께 있으면 서로 섞이지 않도록 별도 탭을 보여준다.
// computeHoldings가 취소/완료/무효 항목을 이미 제외한다. 보관 시청자는 숨기되 보관 시각 이후 새 당첨은
// 다시 보인다. 룰렛표 off 상품 기록도 숨긴다(정가·수동은 항상 표시). 전부 표시 계산 — 원본 불변.
function computeFanRouletteTabs(
  state: StreamerState,
  index: RouletteIndex,
  excludedNames: Set<string>,
  month = "all",
  status: MonthlyStatus = "all",
  assignments: DeliveryAssignment[] | null = [],
): {
  previewRows: DesignRow[];
  monthlyHoldings: ViewerHolding[];
  allocated: ReturnType<typeof allocateFanMonthly>;
  showRouletteTabs: boolean;
  groups: Array<{ key: string; label: string; viewers: ViewerSummary[] }>;
  allEntries: UpboEntry[];
  deliveryMode: FanDeliveryReflect;
} {
  const archivedFanAt = state.archivedFanAt ?? {};
  const visibleUnderArchive = (e: UpboEntry): boolean => {
    const at = archivedFanAt[e.fanId];
    if (!at) return true;
    return Date.parse(e.createdAt ?? "") > Date.parse(at);
  };
  const allEntries = filterEntriesByCatalogUsage(
    (state.upboEntries ?? []).filter(visibleUnderArchive),
    state.catalogs ?? [],
    state.catalogUsageByVersion,
  );
  // 조각 4: 쿠폰에 연결한 상품은 표시상 제외(원본·판정 불변, excludedNames 빈 Set이면 그대로).
  const holdings = filterHoldingsByExcludedNames(
    computeHoldings(allEntries, state.itemEvents ?? []),
    excludedNames,
  );
  const deliveryMode: FanDeliveryReflect = assignments === null ? "off" : state.fanDeliveryReflect ?? "off";
  const hiddenHoldings = filterHoldingsByExcludedNames(computeHoldings(filterEntriesByCatalogUsage((state.upboEntries ?? []).filter(e => !visibleUnderArchive(e)), state.catalogs ?? [], state.catalogUsageByVersion), state.itemEvents ?? []), excludedNames);
  const allocated = allocateFanMonthly(holdings, deliveryMode === "off" ? [] : state.deliveryProgress ?? [], assignments ?? [], hiddenHoldings);
  const parts = partitionHoldingsByRoulette(holdings, index);
  const monthlyHoldings = flattenGroups(parts);
  const toViewers = (h: ViewerHolding[]) => monthlyViewers(h, allocated, month, deliveryMode, status);
  const showRouletteTabs = shouldShowRouletteTabs(parts);
  const groups = showRouletteTabs
    ? parts.map(p => ({ key: p.key, label: p.label, viewers: toViewers(p.holdings) }))
    : [{ key: "__all__", label: "전체", viewers: toViewers(monthlyHoldings) }];
  const previewRows: DesignRow[] = parts.flatMap(p => p.holdings.flatMap(owner => owner.items.map((item,i) => ({id:`${p.key}:${owner.key}:${item.entryId}:${i}`,ownerId:owner.key,ownerName:owner.ownerName,item:item.itemName,group:p.label,month:monthOf(item),date:monthOf(item)!=="etc" && item.recordedAtMs ? new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",year:"2-digit",month:"2-digit",day:"2-digit"}).format(item.recordedAtMs) : "기타",timestamp:item.recordedAtMs,quantity:item.quantity,done:allocated.get(item)??0}))));
  return { showRouletteTabs, groups, allEntries, deliveryMode, monthlyHoldings, allocated, previewRows };
}

// ── 정가 유형(시그니처/이벤트/서버, sy 2026-08-09) 팬 표시 조각들 ──

// 정가 기록(itemName "정가 N개")의 유형 정보를 정가 설정에서 찾는다. 없으면 null = 일반 정가(sig 취급).
// (자동·수동 정가기록 모두 itemName 을 "정가 N개"로 저장한다 — recordFixedPriceEntries/수동기록.)
const FIXED_ITEM_NAME_RE = /^정가\s*([\d,]+)\s*개$/;
function signatureDetailOfItem(
  itemName: string,
  byCount: Map<number, SignatureDetail>,
): SignatureDetail | null {
  const m = itemName.match(FIXED_ITEM_NAME_RE);
  if (!m) return null;
  return byCount.get(Number(m[1].replace(/,/g, ""))) ?? null;
}

function signatureKindOfItem(itemName: string, byCount: Map<number, SignatureDetail>): SignatureKind {
  return signatureDetailOfItem(itemName, byCount)?.kind ?? "sig";
}

// subtabs 표시용: 정가 탭 시청자 목록을 유형으로 걸러 재구성한다(원본 불변, 표시 전용).
// 만료된 이벤트·서버 기록도 자기 유형 탭에 남는다(기록은 사라지지 않는다 — sy 규칙 ①).
function filterViewersBySigKind(
  viewers: ViewerSummary[],
  byCount: Map<number, SignatureDetail>,
  kind: SignatureKind,
): ViewerSummary[] {
  const out: ViewerSummary[] = [];
  for (const v of viewers) {
    const items = v.items.filter((it) => signatureKindOfItem(it.itemName, byCount) === kind);
    if (items.length === 0) continue;
    out.push({
      ...v,
      items,
      total: items.reduce((s, it) => s + it.count, 0),
      maxProb: items.reduce((m, it) => Math.max(m, it.probability), 0),
    });
  }
  return out;
}

const SIG_KIND_NAME: Record<SignatureKind, string> = { sig: "시그니처", event: "이벤트", server: "서버" };

// 정가 탭 상단 시그 카드 가로 레일(② 가로 레일). kinds 로 보여줄 유형을 고른다(sections=전부, subtabs=현재 탭만).
// 만료(«지난 정가») 항목은 레일에서 뺀다 — 팬에게 지금 파는 것만 보여준다. 아무것도 없으면 레일 자체가 없다.
function SignatureRail({ details, kinds }: { details: SignatureDetail[]; kinds: SignatureKind[] }) {
  const active = details.filter((d) => !d.expired && kinds.includes(d.kind));
  const sigCards = active.filter((d) => d.kind === "sig");
  const limited = active.filter((d) => d.kind !== "sig");
  if (sigCards.length === 0 && limited.length === 0) return null;

  const card = (d: SignatureDetail) => (
    <div key={d.count} className={styles.sigRailCard}>
      {d.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.sigRailImg} src={d.imageUrl} alt={`정가 ${d.count.toLocaleString()}개`} loading="lazy" />
      ) : null}
      <div className={styles.sigRailMeta}>
        <span className={styles.sigRailCount}>{d.count.toLocaleString()}개</span>
        {d.parts.length > 0 ? <span className={styles.sigRailParts}>{d.parts.join(" · ")}</span> : null}
      </div>
    </div>
  );

  // 유형이 시그니처뿐이면 소제목 없이 기존 레일 그대로(불필요한 구분 안 만듦).
  const onlySig = limited.length === 0 && kinds.includes("sig");
  if (onlySig) {
    return (
      <div className={styles.sigRail} aria-label="시그니처 구성 안내">
        {sigCards.map(card)}
      </div>
    );
  }

  return (
    <div aria-label="정가 구성 안내">
      {sigCards.length > 0 ? (
        <>
          <p className={styles.sigRailGroupTitle}>시그니처</p>
          <div className={styles.sigRail}>{sigCards.map(card)}</div>
        </>
      ) : null}
      {limited.map((d) => {
        const left = fixedPeriodDaysLeft(d.endAt);
        return (
          <div key={`g-${d.count}`}>
            <p className={styles.sigRailGroupTitle}>
              {SIG_KIND_NAME[d.kind]} · {d.label || "(이름 없음)"}
              {d.endAt ? <span className={styles.sigRailGroupSub}>~{d.endAt}까지</span> : null}
              {left !== null ? (
                <span className={left <= 7 ? `${styles.sigDday} ${styles.sigDdaySoon}` : styles.sigDday}>
                  D-{Math.max(0, left)}
                </span>
              ) : null}
            </p>
            <div className={styles.sigRail}>{card(d)}</div>
          </div>
        );
      })}
    </div>
  );
}

function FanView({
  state,
  slug,
  searchQuery,
  activeTab,
  activeRoulette,
  activeSigKind,
  activeMonth,
  monthlyStatus,
  monthlyAssignments,
  design,
  activeProduct,
  activeMonths,
  excludedNames,
  coupons,
  showCouponTab,
  wardrobeItems,
  layoutB,
  sheetTitle,
  streamerName,
  stationLink,
}: {
  state: StreamerState;
  slug: string;
  searchQuery: string;
  activeTab: FanTab;
  activeRoulette: string;
  // 정가 탭 하위 유형(표시 방식 subtabs 일 때만 의미). sig | event | server 외 값 = sig.
  activeSigKind: string;
  activeMonth: string;
  monthlyStatus: MonthlyStatus;
  monthlyAssignments: DeliveryAssignment[] | null;
  design: DesignId;
  activeProduct: string;
  activeMonths: string;
  excludedNames: Set<string>;
  coupons: CouponBalance[] | null;
  showCouponTab: boolean;
  // 옷장 공개 컷(버튼 노출 판단 + 건수 표시용) — 옷장 화면 자체는 /slug/wardrobe 독립 페이지.
  wardrobeItems: WardrobeState["items"];
  // P1 시안 B 비교 스위치(?layout=b, 무커스텀 팬 화면 한정) — 신원 카드+룰렛 레일 레이아웃.
  layoutB?: boolean;
  sheetTitle?: string;
  streamerName?: string;
  // 방송국 링크 = 배너 링크 실데이터 재사용(showcase.bannerLink). 없으면 버튼 자체를 안 그린다(가짜 버튼 금지).
  stationLink?: string | null;
}) {
  const rouletteIndex = buildRouletteIndex(state);
  const { showRouletteTabs, groups: computedRouletteGroups, allEntries, deliveryMode, monthlyHoldings, allocated, previewRows } =
    computeFanRouletteTabs(state, rouletteIndex, excludedNames, activeTab === "ledger" && !["l3","l4","h4"].includes(design) ? activeMonth : "all", activeTab === "ledger" ? monthlyStatus : "all", monthlyAssignments);
  const months = [...new Set(monthlyHoldings.flatMap(v => v.items.map(monthOf)))].filter(m => m !== "etc").sort().reverse();
  const monthlyTotal = summarizeMonth(monthlyHoldings, allocated, activeMonth);
  const etcTotal = summarizeMonth(monthlyHoldings, allocated, "etc");
  const monthSuffix = `&design=${design}${design === "h4" && activeMonths ? `&multi=${encodeURIComponent(activeMonths)}` : ""}${design === "h2" && activeProduct ? `&product=${encodeURIComponent(activeProduct)}` : ""}${activeMonth !== "all" ? `&month=${encodeURIComponent(activeMonth)}` : ""}${deliveryMode !== "off" && monthlyStatus !== "all" ? `&status=${monthlyStatus}` : ""}`;
  // 쿠폰 탭 이름(스트리머별, 표시 전용) — 기본 "쿠폰", 꾸폰·마일리지처럼 바꿔 부를 수 있다.
  const couponLabel = state.couponTabLabel?.trim() || "쿠폰";
  // 쿠폰 탭: 잔액을 시청자 단위로 묶고 검색어로 거른다(0=사용완료도 표시). null=조회 실패(빈 장부와 구분).
  const couponLoadFailed = activeTab === "coupon" && coupons === null;
  const couponViewersAll = activeTab === "coupon" && coupons ? groupFanCoupons(coupons) : [];
  const couponViewersShown = filterFanCoupons(couponViewersAll, searchQuery);
  const {visibleGroups:rouletteGroups,activeGroup}=selectVisibleFanTabs(computedRouletteGroups,activeRoulette);
  const rtabKey = activeGroup?.key;
  const activeViewers = activeGroup?.viewers ?? [];
  // 정가 탭 유형 구분(시그니처/이벤트/서버, sy 2026-08-09). subtabs 모드면 하위 탭으로 걸러 보여준다.
  const sigDetails = state.signatureDetails ?? [];
  const sigByCount = new Map(sigDetails.map((d) => [d.count, d]));
  const fixedMode = state.fanFixedTabMode ?? "sections";
  const onFixedTab = activeTab === "ledger" && rtabKey === "__fixed__";
  const useSigSubtabs = onFixedTab && fixedMode === "subtabs" && sigDetails.some((d) => d.kind !== "sig");
  // sfk 미지정(탭 첫 진입)이면 기록 있는 첫 유형을 연다 — 시그니처 0명인데 빈 화면부터 보이던 것 수리.
  // sfk 를 명시한 링크(시그니처 포함)는 그대로 존중한다.
  const sigKind: SignatureKind =
    activeSigKind === "sig" || activeSigKind === "event" || activeSigKind === "server"
      ? activeSigKind
      : (["sig", "event", "server"] as SignatureKind[]).find(
          (k) => filterViewersBySigKind(activeViewers, sigByCount, k).length > 0,
        ) ?? "sig";
  const fixedTabViewers = useSigSubtabs
    ? filterViewersBySigKind(activeViewers, sigByCount, sigKind)
    : activeViewers;
  const productOptions = [...new Set((onFixedTab ? fixedTabViewers : activeViewers).flatMap(v=>v.items.map(i=>i.itemName)))].sort();
  const searchedViewers = filterViewers(onFixedTab ? fixedTabViewers : activeViewers, searchQuery);
  const shownViewers = design === "h2" && activeProduct ? searchedViewers.flatMap(v=>{const items=v.items.filter(i=>i.itemName===activeProduct); return items.length ? [{...v,items,total:items.reduce((n,i)=>n+i.count,0)}] : [];}) : searchedViewers;
  // 전체 고유 시청자 수(여러 룰렛에 걸친 사람은 1명으로).
  const allViewerCount = new Set(monthlyHoldings.map(v => v.key)).size;

  // 획득 기록은 원본 entry 기반(전체 기록, 룰렛탭·배송반영과 무관).
  const history = historyRows(allEntries, searchQuery);
  const lastApplied = state.importBatches?.[state.importBatches.length - 1]?.appliedAt;

  const pillBaseViewers = onFixedTab ? fixedTabViewers : activeViewers;
  const countPill =
    activeTab === "ledger"
      ? ["l3","l4","h4"].includes(design) ? `전체 ${pillBaseViewers.length}명` : searchQuery
        ? `${shownViewers.length} / ${pillBaseViewers.length}명`
        : `${pillBaseViewers.length}명`
      : activeTab === "coupon"
        ? couponLoadFailed
          ? "—"
          : searchQuery
            ? `${couponViewersShown.length} / ${couponViewersAll.length}명`
            : `${couponViewersAll.length}명`
        : searchQuery
          ? `${history.length} / ${allEntries.length}건`
          : `${allEntries.length}건`;

  const monthPicker = <MonthPicker products={productOptions} product={activeProduct} design={design} slug={slug} months={months} selected={activeMonth} reflect={deliveryMode !== "off"} total={monthlyTotal} etcCount={etcTotal.quantity} unavailable={monthlyAssignments === null} query={{ q: searchQuery, rtab: activeRoulette, sfk: activeSigKind, layout: layoutB ? "b" : "" }} />;

  return (
    <div className={styles.fanLayout} data-layout-b={layoutB ? "" : undefined}>
      {layoutB ? (
        <aside className={styles.idRail}>
          <div className={styles.idCard}>
            <div className={styles.idAvatar} aria-hidden="true">
              {(streamerName || slug).trim().charAt(0)}
            </div>
            <div className={styles.idText}>
              <h1 className={styles.idName}>{sheetTitle || `${streamerName || slug} 업보시트`}</h1>
            </div>
            {stationLink ? (
              <a className={styles.stationBtn} href={stationLink} target="_blank" rel="noopener noreferrer">
                방송국 가기 ↗
              </a>
            ) : null}
            <a className={styles.idAdminLink} href={`/${slug}?admin=1`}>
              관리자
            </a>
          </div>
          {showRouletteTabs && rouletteGroups.length > 0 ? (
            <div className={styles.railRoulette}>
              <h2>룰렛별 기록</h2>
              {rouletteGroups.map((g) => (
                <a
                  key={g.key}
                  className={styles.railRouletteItem}
                  href={`/${slug}?layout=b&rtab=${encodeURIComponent(g.key)}${monthSuffix}`}
                >
                  <span>{g.label}</span>
                  <span className={styles.railRouletteCount}>{g.viewers.length}명</span>
                </a>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
      <div className={styles.fanMain}>
      <section className={styles.finder} aria-labelledby="finder-title">
        <div className={styles.finderTitleRow}>
          <h2 id="finder-title">내 업보 확인</h2>
          {/* 옷장 문 — 본진은 독립 화면(/slug/wardrobe), 팬 탭에서는 옷장을 뺐다(sy 확정 8/12).
              공개 컷 1장 이상일 때만 노출(안 쓰는 스트리머 화면엔 아무 변화 없음). */}
          {wardrobeItems.length > 0 ? (
            <a className={styles.wardrobeDoor} href={`/${encodeURIComponent(slug)}/wardrobe`}>
              옷장
            </a>
          ) : null}
        </div>
        <div className={design === "h1" ? styles.searchWithMonth : undefined}>
        <form className={styles.searchRow} action={`/${slug}`} method="get">
          {activeMonth !== "all" ? <input type="hidden" name="month" value={activeMonth} /> : null}
          <input type="hidden" name="design" value={design} />
          {design === "h4" && activeMonths ? <input type="hidden" name="multi" value={activeMonths} /> : null}
          {design === "h2" && activeProduct ? <input type="hidden" name="product" value={activeProduct} /> : null}
          {layoutB ? <input type="hidden" name="layout" value="b" /> : null}
          {activeTab === "history" ? <input type="hidden" name="tab" value="history" /> : null}
          {activeTab === "coupon" ? <input type="hidden" name="tab" value="coupon" /> : null}
          {activeTab === "ledger" && showRouletteTabs && rtabKey ? (
            <input type="hidden" name="rtab" value={rtabKey} />
          ) : null}
          {useSigSubtabs && sigKind !== "sig" ? (
            <input type="hidden" name="sfk" value={sigKind} />
          ) : null}
          <input
            defaultValue={searchQuery}
            name="q"
            placeholder="예: 닉네임 또는 계정ID 일부"
            type="search"
          />
          <button type="submit">찾기</button>
        </form>
        {activeTab === "ledger" && design === "h1" ? monthPicker : null}
        </div>
        {/* P1 기본값 라운드(2026-08-26): 잔글씨 상태줄 → 시간 도장 + 숫자 띠.
            멜론 차트 문법 — 기준 시각이 이 장부의 제목급 신뢰 신호(원정 27). 전부 실데이터. */}
        {isRefinedDesign(design) ? <p className={styles.compactStats}>시청자 {allViewerCount}명 · 자동 기록 {allEntries.length}건 · 기준 {state.settings?.thresholdPercent ?? '—'}% · 마지막 반영 {lastApplied ? fmtKst(lastApplied) : '대기 중'}{deliveryMode !== 'off' ? ' · 배송 반영 중' : ''}</p> : <>
        <div className={styles.stampTimeRow}>
          <span className={styles.stampTimeValue}>
            {lastApplied ? `${fmtKst(lastApplied)} 기준` : "아직 첫 반영 전"}
          </span>
          {lastApplied ? <span className={styles.stampTimeLabel}>마지막 자동 반영</span> : null}
          {deliveryMode !== "off" ? <span className={styles.stampTimeLabel}>배송 반영 중</span> : null}
        </div>
        <div className={styles.statStrip}>
          <div>
            <b>{allEntries.length}</b>
            <span>자동 기록</span>
          </div>
          <div>
            <b>{allViewerCount}</b>
            <span>시청자</span>
          </div>
          <div>
            <b>{state.settings?.thresholdPercent ?? "—"}%</b>
            <span>기록 기준</span>
          </div>
        </div>
        </>}
        {activeTab === "ledger" && design === "l2" ? monthPicker : null}
      </section>

      <div className={styles.perforation} aria-hidden="true" />

      <section className={styles.ledger} aria-label="업보 시트">
        <div className={styles.ledgerHeader}>
          <div className={styles.tabs} role="tablist">
            <a
              className={activeTab === "ledger" ? styles.tabActiveLink : styles.tabLink}
              href={`${tabHref(slug, "ledger", searchQuery)}${searchQuery ? monthSuffix : monthSuffix.replace(/^&/, "?")}`}
            >
              업보 목록
            </a>
            <a
              className={activeTab === "history" ? styles.tabActiveLink : styles.tabLink}
              href={`${tabHref(slug, "history", searchQuery)}${monthSuffix}`}
            >
              획득 기록
            </a>
            {showCouponTab ? (
              <a
                className={activeTab === "coupon" ? styles.tabActiveLink : styles.tabLink}
                href={`${tabHref(slug, "coupon", searchQuery)}${monthSuffix}`}
              >
                {couponLabel}
              </a>
            ) : null}
          </div>
          <div className={styles.monthHeaderTools}>{activeTab === "ledger" && design === "l1" ? monthPicker : null}<span className={styles.countPill}>{countPill}</span></div>
        </div>

        {activeTab === "ledger" && design !== "l1" && design !== "l2" && design !== "h1" && design !== "h2" && !["l3","l4","h3","h4"].includes(design) ? monthPicker : null}

        {activeTab === "ledger" && showRouletteTabs && rouletteGroups.length > 0 ? (
          <div className={styles.rouletteTabs} role="tablist" aria-label="룰렛 구분">
            {rouletteGroups.map((g) => (
              <a
                key={g.key}
                className={g.key === rtabKey ? styles.rouletteTabActive : styles.rouletteTab}
                href={`/${slug}?rtab=${encodeURIComponent(g.key)}${
                  searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
                }${monthSuffix}`}
              >
                {g.label}
                <span className={styles.rouletteTabCount}>{g.viewers.length}</span>
              </a>
            ))}
          </div>
        ) : null}

        {useSigSubtabs ? (
          <div className={styles.sigSubTabs} role="tablist" aria-label="정가 유형 구분">
            {(["sig", "event", "server"] as SignatureKind[]).filter(k=>filterViewersBySigKind(activeViewers,sigByCount,k).length>0).map((k) => {
              const n = filterViewersBySigKind(activeViewers, sigByCount, k).length;
              const href = `/${slug}?rtab=__fixed__&sfk=${k}${
                searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""
              }${monthSuffix}`;
              return (
                <a key={k} className={k === sigKind ? styles.sigSubTabActive : styles.sigSubTab} href={href}>
                  {SIG_KIND_NAME[k]}
                  <span className={styles.rouletteTabCount}>{n}</span>
                </a>
              );
            })}
          </div>
        ) : null}

        {activeTab === "ledger" && design === "h2" ? monthPicker : null}

        {onFixedTab ? (
          <SignatureRail
            details={sigDetails}
            kinds={useSigSubtabs ? [sigKind] : (["sig", "event", "server"] as SignatureKind[])}
          />
        ) : null}

        {activeTab === "ledger" ? (
          <LedgerTable
            viewers={shownViewers}
            searchQuery={searchQuery}
            colors={state.productColors}
            sigByCount={onFixedTab ? sigByCount : undefined}
            hideIds={state.fanIdHidden === true}
          />
        ) : activeTab === "coupon" ? (
          <FanCouponTable
            viewers={couponViewersShown}
            searchQuery={searchQuery}
            loadFailed={couponLoadFailed}
            hideIds={state.fanIdHidden === true}
            label={couponLabel}
          />
        ) : (
          <HistoryTable rows={history} searchQuery={searchQuery} hideIds={state.fanIdHidden === true} />
        )}
        {activeTab === "ledger" && ["l3","h3"].includes(design) ? monthPicker : null}
        {/* P1 기본값 라운드: 페이지가 "-"나 표에서 뚝 끊기지 않게 끝맺음 한 줄(전부 실데이터·실설명). */}
        <div className={styles.sheetFooter}>
          <span>위플랩 룰렛 기록에서 자동으로 반영되는 공개 장부예요.</span>
          {lastApplied ? <span>마지막 반영 {fmtKst(lastApplied)}</span> : null}
        </div>
      </section>
      </div>
    </div>
  );
}

// 닉네임이 빈 기록(수집 원본에 닉네임 없음 — 리루리 23행 실측)의 표시 규칙(sy 2026-08-12):
// 계정ID를 이름 자리에 승격해 "빈 줄"로 보이지 않게 한다. 단 계정ID 숨김 시트에선
// ID를 어떤 자리에도 노출하지 않고 자리표시 문구만 보여준다(8/10 프라이버시 결정 유지).
function FanNameLabel({ nickname, fanId, hideIds }: { nickname: string; fanId: string; hideIds?: boolean }) {
  const name = (nickname ?? "").trim();
  if (!name) {
    if (!hideIds && fanId) return <span className={styles.nameFallbackId}>{fanId}</span>;
    return <span className={styles.nameFallbackNone}>닉네임 미등록</span>;
  }
  // P1 기본값 라운드(2026-08-26): 계정ID 열을 없애고 이름 아래 잔글씨로 통합 —
  // 모바일에서 표 최소 폭이 줄어 건수까지 한 화면에 들어온다. 숨김 시트는 이름만.
  return (
    <>
      {name}
      {!hideIds && fanId ? <span className={styles.nameCellId}>{fanId}</span> : null}
    </>
  );
}

function LedgerTable({
  viewers,
  searchQuery,
  colors,
  sigByCount,
  hideIds,
}: {
  viewers: ViewerSummary[];
  searchQuery: string;
  colors?: Record<string, string>;
  // 정가 탭에서만 전달 — 정가 칩에 유형(이벤트/서버) 배지와 이름을 붙인다.
  sigByCount?: Map<number, SignatureDetail>;
  // 팬 화면 계정ID 숨기기(스트리머별 설정). 열 자체를 뺀다. 검색은 원문 기준 그대로.
  hideIds?: boolean;
}) {
  if (viewers.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={`${styles.stamp} ${styles.stampGhost}`}>대기</span>
        <p>
          {searchQuery
            ? `'${searchQuery}'에 해당하는 시청자가 없어요.`
            : "아직 기록된 업보가 없어요."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.nameCol}>닉네임</th>
            <th>업보</th>
            <th className={styles.countCol}>건수</th>
          </tr>
        </thead>
        <tbody>
          {/* 숨김 모드에선 key(계정ID 기반)도 페이지 소스(RSC 페이로드)에 실리므로 행 번호로 대체한다. */}
          {viewers.map((v, i) => (
            <tr key={hideIds ? `r${i}` : v.key}>
              <td className={styles.nameCell}>
                <FanNameLabel nickname={v.fanNickname} fanId={v.fanId} hideIds={hideIds} />
              </td>
              <td>
                <div className={styles.upboCell}>
                  {v.items.map((it) => {
                    // 정가기록(시그니처 후원): 룰렛 업보와 표기를 구분한다 — %가 아니라 "정가" 배지.
                    const isFixed = it.amountRangeLabel === "정가";
                    // 유형 구분(정가 탭에서만): 이벤트/서버 배지 + 이름, 만료된 건 "·종료" 회색.
                    const sigDetail = isFixed && sigByCount ? signatureDetailOfItem(it.itemName, sigByCount) : null;
                    const sigKindOfIt = sigDetail?.kind ?? "sig";
                    const fixedBadgeText =
                      sigKindOfIt === "sig"
                        ? "정가"
                        : sigDetail?.expired
                          ? `${SIG_KIND_NAME[sigKindOfIt]}·종료`
                          : SIG_KIND_NAME[sigKindOfIt];
                    const fixedBadgeClass =
                      sigKindOfIt === "sig"
                        ? styles.upboFixedBadge
                        : sigDetail?.expired
                          ? `${styles.upboFixedBadge} ${styles.upboFixedBadgeEnded}`
                          : sigKindOfIt === "event"
                            ? `${styles.upboFixedBadge} ${styles.upboFixedBadgeEvent}`
                            : `${styles.upboFixedBadge} ${styles.upboFixedBadgeServer}`;
                    // 상품별 색상(스트리머가 정한 것만). 정가 칩은 자체 스타일 유지.
                    const col = isFixed ? undefined : productColorById(colors?.[it.itemName]);
                    return (
                      <span
                        key={`${it.itemName}@${it.amountRangeLabel ?? ""}`}
                        className={isFixed ? `${styles.upboChip} ${styles.upboChipFixed}` : styles.upboChip}
                        style={col ? { background: col.bg, borderColor: col.border } : undefined}
                      >
                        {isFixed ? (
                          <span className={fixedBadgeClass}>{fixedBadgeText}</span>
                        ) : it.amountRangeLabel ? (
                          <span className={styles.upboSet}>{it.amountRangeLabel}</span>
                        ) : null}
                        <span className={styles.upboItem} style={col ? { color: col.text } : undefined}>
                          {isFixed ? it.itemName.replace(/^정가\s*/, "") : it.itemName}
                        </span>
                        {sigDetail && sigDetail.kind !== "sig" && sigDetail.label ? (
                          <span className={styles.upboSigLabel}>{sigDetail.label}</span>
                        ) : null}
                        {/* % 배지는 표기하지 않는다(sy 확정 2026-07-07 — 확률표 공개가 정보 담당). 정렬은 확률 기준 유지. */}
                        {it.count > 1 ? <span className={styles.upboCount}>×{it.count}</span> : null}
                        {it.done ? (
                          <span className={styles.upboDelivered}>배송완료</span>
                        ) : it.delivered ? (
                          <span className={styles.upboDelivered}>{it.delivered}개 배송완료</span>
                        ) : null}
                      </span>
                    );
                  })}
                </div>
              </td>
              <td className={styles.countCell}>{v.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({
  rows,
  searchQuery,
  hideIds,
}: {
  rows: UpboEntry[];
  searchQuery: string;
  // 팬 화면 계정ID 숨기기(스트리머별 설정). 열 자체를 뺀다. 검색은 원문 기준 그대로.
  hideIds?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={`${styles.stamp} ${styles.stampGhost}`}>대기</span>
        <p>
          {searchQuery
            ? `'${searchQuery}'에 해당하는 획득 기록이 없어요.`
            : "아직 획득 기록이 없어요."}
        </p>
      </div>
    );
  }

  // 룰렛 세트 라벨이 한 줄이라도 있을 때만 컬럼을 보여준다(없으면 기존과 동일한 5열).
  const showSet = rows.some((e) => rouletteSetLabel(e));

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.nameCol}>닉네임</th>
            <th>상품</th>
            {showSet ? <th className={styles.probCol}>룰렛 세트</th> : null}
            <th className={styles.donateCol} title="위플랩 표시시간 원문(수동기록은 스트리머가 적은 날짜)">
              후원 시간
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className={styles.nameCell}>
                <FanNameLabel nickname={e.fanNickname} fanId={e.fanId} hideIds={hideIds} />
              </td>
              <td>
                {/* 확률 열은 표기하지 않는다(sy 확정 2026-07-07). 정가는 배지+이름(접두어 제거)으로 표기. */}
                {e.sourceKey.startsWith("fixed:") ? (
                  <>
                    <span className={styles.upboFixedBadge}>정가</span>{" "}
                    {e.itemName.replace(/^정가\s*/, "")}
                  </>
                ) : (
                  e.itemName
                )}
                {Number(e.multiplier ?? 1) > 1 ? (
                  <span className={styles.multiplierBadge}>×{e.multiplier} 적용</span>
                ) : null}
              </td>
              {showSet ? (
                <td className={styles.probCell}>
                  {e.sourceKey.startsWith("fixed:") ? "—" : rouletteSetLabel(e) ?? "—"}
                </td>
              ) : null}
              {/* 수동기록에 스트리머가 적은 날짜는 위플랩 원문이 아니다 — 원문처럼 보이지 않게 표시를 구분한다. */}
              <td className={styles.donateCell}>
                {e.sourceKey.startsWith("manual:") && e.donateTimeText
                  ? `${e.donateTimeText.slice(0, 10).replaceAll("-", ".")} (수동)`
                  : e.donateTimeText}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminPanel({
  state,
  activeAdminTab,
  showcase,
  coupon,
  wardrobe,
  deliveryOnly = false,
  integratedMonth,
}: {
  deliveryOnly?: boolean;
  integratedMonth?: string;
  state: StreamerState;
  activeAdminTab: AdminTab;
  showcase: ShowcaseState | null;
  coupon: CouponState | null;
  wardrobe: WardrobeState | null;
}) {
  // 룰렛표에서 꺼진 상품의 기록은 배송·교환·양도(보유현황 전체)에서도 숨긴다(정가·수동은 항상 표시).
  const entries = filterEntriesByCatalogUsage(
    state.upboEntries ?? [],
    state.catalogs ?? [],
    state.catalogUsageByVersion,
  );
  // 조각 4: 쿠폰에 연결한 룰렛 상품은 배송관리·팬탭 표시에서 제외(관리자 모드는 이미 읽은
  // couponState.sourceMap 재사용 — 추가 조회 없음, 매핑 0개면 빈 Set=회귀 0).
  const excludedNames = couponExcludedNameSet(coupon?.sourceMap ?? []);
  const events = state.itemEvents ?? [];
  const batches = state.importBatches ?? [];
  const latest: ImportBatch | undefined = batches[batches.length - 1];
  const catalogs = [...(state.catalogs ?? [])].sort((a, b) => a.version - b.version);
  const activeCatalog = catalogs.find((c) => c.version === state.currentCatalogVersion);
  const activeGroups = activeCatalog?.groups ?? [];
  const specialItemRules = state.specialItemRules ?? [];

  // 배송 관리: holdings 기반 시청자 목록(취소/완료 제외, 양도 후 현재 보유자 반영).
  // 팬 화면과 동일하게 "보관(배송완료 숨김) 시각 이후의 새 당첨"만 살린다(sy 2026-07-08 후속).
  // → 완전 보관 시청자는 목록에서 사라지고, 재당첨자는 새 기록만 들고 배송 목록에 다시 오른다.
  const deliveryArchivedFanAt = state.archivedFanAt ?? {};
  const isDeliveryVisible = (e: UpboEntry): boolean => {
    const at = deliveryArchivedFanAt[e.fanId];
    if (!at) return true;
    return Date.parse(e.createdAt ?? "") > Date.parse(at);
  };
  const deliveryVisibleEntries = entries.filter(isDeliveryVisible);
  const deliveryHiddenEntries = entries.filter((e) => !isDeliveryVisible(e));
  const holdings = filterHoldingsByExcludedNames(
    computeHoldings(deliveryVisibleEntries, events),
    excludedNames,
  );
  const viewers = holdingsToViewerSummaries(holdings, { withOps: true });
  // 숨긴 옛 당첨분의 (fanId,itemKey)별 개수. 이미 배송완료로 저장된 처리수량이 "옛 기록 몫"이므로,
  // 새 당첨이 같은 itemKey일 때 새 기록을 "이미 배송됨"으로 오인시키지 않도록 배송관리에서 이 값만큼
  // 처리수량 기준선을 보정한다(표시 계산 전용 — 원본/스키마 불변, 현재 채루 데이터엔 충돌 없어 대개 무효).
  // 숨긴 시청자의 옛 기록 — 배송관리 "숨긴 시청자" 탭(목록·복구 미리보기)과 아래 기준선 보정이 공유.
  const hiddenViewerSummaries = holdingsToViewerSummaries(
    filterHoldingsByExcludedNames(computeHoldings(deliveryHiddenEntries, events), excludedNames),
  );
  const archivedHiddenCounts: Record<string, Record<string, number>> = {};
  for (const hv of hiddenViewerSummaries) {
    const perItem: Record<string, number> = {};
    for (const it of hv.items) {
      const k = `${it.itemName}@@${it.probability}@@${it.amountRangeLabel ?? ""}`;
      perItem[k] = (perItem[k] ?? 0) + it.count;
    }
    if (Object.keys(perItem).length > 0) archivedHiddenCounts[hv.fanId] = perItem;
  }

  // ── 룰렛(교환 후보) 계산 ──────────────────────────────────────────────
  // 룰렛 클러스터링·이름/보관 매칭은 팬 화면과 공용이라 buildRouletteIndex 로 뽑아 쓴다.
  const rouletteIndex = buildRouletteIndex(state);
  const { rouletteByGroupIndex, rouletteLabelById, rouletteArchivedById, managerGroups, managerRoulettes, thresholdGroups, revealRoulettes, fanTabManager } =
    rouletteIndex;
  // 팬 탭 이름 관리 목록 = 카탈로그 전체가 아니라 "팬 화면에 실제 탭으로 구분 표시되는 룰렛"만(sy 2026-07-08).
  // 팬 화면과 동일 계산(computeFanRouletteTabs)을 공유해 목록이 항상 팬 탭과 일치한다.
  const { groups: fanTabGroups } = computeFanRouletteTabs(state, rouletteIndex, excludedNames);
  const fanTabByRid = new Map(fanTabManager.map((t) => [t.rid, t]));
  // 관리자 목록 = 팬 화면 탭 순서 그대로(정가/기타 자리 포함) — 드래그 편집의 초기 순서가 된다.
  // 정가/기타 탭은 팬 화면에 실제로 떴을 때만 이름칸을 보여준다(안 뜨는데 이름 받는 혼란 방지).
  // "지난 시즌 · L" 탭도 떴을 때만 이름칸(정가/기타와 같은 규칙). 드래그 순서에는 참여하지 않는다(룰렛 뒤 고정).
  const fanNameRows: FanNameRow[] = fanTabGroups
    .map((g): FanNameRow | null => {
      if (g.key === "__fixed__") return { kind: "fixed" };
      if (g.key === "__other__") return { kind: "other" };
      if (isPastTabKey(g.key)) {
        const label = pastLabelOfKey(g.key);
        return { kind: "past", label, currentName: state.fanTabLabels?.pastLabels?.[label] };
      }
      const tab = fanTabByRid.get(g.key);
      return tab ? { kind: "tab", tab } : null;
    })
    .filter((r): r is FanNameRow => r !== null);
  const activeGroupsForExchange = activeCatalog?.groups ?? [];
  // 사용설정(catalogUsage) 오버라이드: sy가 켜고 끈 값. 없으면 위플랩 캡처 값을 그대로 따른다.
  const usageOverrides: Record<string, boolean> = activeCatalog
    ? state.catalogUsageByVersion?.[activeCatalog.version] ?? {}
    : {};
  // 효과적 사용여부: 상품 오버라이드 > 그룹 오버라이드 > 위플랩 캡처 값(CatalogManager와 동일 규칙).
  const effectiveEnabled = (g: CatalogGroup, item: CatalogItem, idxInGroup: number): boolean => {
    const itemKey = `g${g.groupIndex}-i${item.sortOrder ?? idxInGroup}`;
    const groupKey = `g${g.groupIndex}`;
    if (usageOverrides[itemKey] !== undefined) return usageOverrides[itemKey];
    if (usageOverrides[groupKey] !== undefined) return usageOverrides[groupKey];
    return item.enabled !== false && g.enabled !== false;
  };

  // ItemEventManager에 넘길 교환 후보: "룰렛기록 on(sy 사용설정 반영)" + 당첨 기준(thresholdPercent)
  // 이하 상품만. 룰렛(rouletteId)별로 상품명 중복을 제거한다(단차/연차 중복 합치기).
  const exchangeThreshold = Number(state.settings?.thresholdPercent ?? 2);
  // 룰렛표별 기준확률 예외 반영 — 예외로 업보가 된 상품도 교환·수동기록 후보에 뜨게(판정과 동일 규칙).
  const exchangeThresholdOverrides = state.thresholdOverrides ?? {};
  const catalogItems: {
    itemName: string;
    probability: number;
    amountRangeLabel?: string;
    catalogGroupIndex?: number;
    rouletteId: string;
    rouletteLabel?: string;
  }[] = [];
  {
    const seen = new Set<string>();
    for (const g of activeGroupsForExchange) {
      const rid = rouletteByGroupIndex[g.groupIndex];
      if (rouletteArchivedById[rid]) continue; // 보관(숨김)된 룰렛은 교환·수동기록 후보에서 제외.
      (g.items ?? []).forEach((it, idx) => {
        if (!effectiveEnabled(g, it, idx)) return;
        if (it.probability > effectiveThresholdForLabel(exchangeThresholdOverrides, g.amountRangeLabel, exchangeThreshold)) return;
        const dedupeKey = `${rid}::${it.itemName}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        catalogItems.push({
          itemName: it.itemName,
          probability: it.probability,
          amountRangeLabel: g.amountRangeLabel ?? undefined,
          catalogGroupIndex: g.groupIndex,
          rouletteId: rid,
          rouletteLabel: rouletteLabelById[rid] || undefined,
        });
      });
    }
  }

  // 쿠폰 자동 적립 "연결" 후보: 교환 후보와 같은 규칙(on·기준 이하)에서 상품명만 중복 제거.
  // 계산은 서버(page)에서 끝내고 이름 목록만 CouponManager에 내려준다(손타이핑 금지 — 후보에서만 고르기).
  const couponSourceCandidates = [...new Set(catalogItems.map((c) => c.itemName))];

  // 상품 색상 지정 대상: 팬에 뜨는 상품(교환 후보 = on·기준 이하) 상품명 중복 제거, 확률 높은순.
  const colorableProducts = (() => {
    const seen = new Map<string, number>();
    for (const it of catalogItems) if (!seen.has(it.itemName)) seen.set(it.itemName, it.probability);
    // 직접 입력·교환 등 룰렛표 밖 상품도 보유 중이면 색을 입힐 수 있게 추가(정가는 자체 스타일이라 제외).
    for (const g of holdings)
      for (const it of g.items) {
        if (it.amountRangeLabel === "정가") continue;
        if (!seen.has(it.itemName)) seen.set(it.itemName, it.probability);
      }
    return [...seen.entries()]
      .map(([name, prob]) => ({ name, prob }))
      .sort((a, b) => b.prob - a.prob);
  })();

  // 관리자 상위탭: 기본 순서·이름. 스트리머 오버레이(adminUiPrefs)로 순서/이름만 바꾼다.
  // 오버레이가 없으면 아래 기본 배열 그대로 = 지금과 100% 동일(안 만진 스트리머 무변화).
  const ADMIN_TABS: Array<{ id: string; label: string; href: string; activeWhen: AdminTab[] }> = [
    { id: "delivery", label: "배송 관리", href: `/${state.slug}?admin=1`, activeWhen: ["delivery"] },
    { id: "items", label: "교환·양도", href: `/${state.slug}?admin=1&atab=items`, activeWhen: ["items", "history"] },
    { id: "coupon", label: "쿠폰", href: `/${state.slug}?admin=1&atab=coupon`, activeWhen: ["coupon"] },
    { id: "manual", label: "수동기록", href: `/${state.slug}?admin=1&atab=manual`, activeWhen: ["manual"] },
    { id: "roulettes", label: "룰렛 관리", href: `/${state.slug}?admin=1&atab=roulettes`, activeWhen: ["roulettes", "reveal"] },
    { id: "promo", label: "포스터 및 배너", href: `/${state.slug}?admin=1&atab=promo`, activeWhen: ["promo"] },
    { id: "wardrobe", label: "옷장", href: `/${state.slug}?admin=1&atab=wardrobe`, activeWhen: ["wardrobe"] },
    { id: "signature", label: "정가 설정", href: `/${state.slug}?admin=1&atab=signature`, activeWhen: ["signature"] },
    { id: "settings", label: "설정", href: `/${state.slug}?admin=1&atab=settings`, activeWhen: ["settings"] },
    { id: "donations", label: "후원집계", href: `/${state.slug}/donations`, activeWhen: [] },
  ];
  const uiPrefs = state.adminUiPrefs ?? { tabOrder: [], tabLabels: {}, collapsed: {}, sectionOrder: {} };
  const orderedTabs = (() => {
    const byId = new Map(ADMIN_TABS.map((t) => [t.id, t] as const));
    const seen = new Set<string>();
    const out: typeof ADMIN_TABS = [];
    for (const id of uiPrefs.tabOrder) {
      const t = byId.get(id);
      if (t && !seen.has(id)) {
        out.push(t);
        seen.add(id);
      }
    }
    // 오버레이에 없는(빠진) 탭은 기본 순서 그대로 뒤에 붙인다 — 탭이 사라지는 사고 방지.
    for (const t of ADMIN_TABS) if (!seen.has(t.id)) out.push(t);
    return out.map((t) => ({ ...t, label: uiPrefs.tabLabels[t.id]?.trim() || t.label }));
  })();

  if(deliveryOnly)return <DeliveryManager
              slug={state.slug}
              viewers={viewers}
              fixedEntries={entries
                .filter((e) => e.sourceKey.startsWith("fixed:"))
                .map((e) => ({
                  sourceKey: e.sourceKey,
                  fanId: e.fanId,
                  fanNickname: e.fanNickname,
                  itemName: e.itemName,
                  donateTimeText: e.donateTimeText,
                }))}
              fixedPriceNotes={state.fixedPriceNotes ?? []}
              archivedHiddenCounts={archivedHiddenCounts}
              hiddenViewers={hiddenViewerSummaries}
              archivedFanAt={deliveryArchivedFanAt}
              entryCount={(state.upboEntries ?? []).length}
            />;

  return (
    <AdminCollapseProvider slug={state.slug} initialCollapsed={uiPrefs.collapsed}>
    <div className={styles.adminPanel}>
      <div className={styles.adminHead}>
        <span className={styles.adminBadge}>관리자</span>
        <p className={styles.adminHeadNote}>
          스트리머/운영자용 화면이에요. 배송 관리가 메인이고, 나머지는 설정 탭에 모았어요. 실제
          로그인·권한은 다음 단계입니다.
        </p>
        <p className={styles.fieldHint}>마지막 반영 {fmtKst(latest?.appliedAt)}</p>
        {/* 기간 한정 정가 수시 알림(sy 확정 2026-08-09 — 관리자 머리 위치, D-7 이하만 강조). */}
        {(() => {
          const details = state.signatureDetails ?? [];
          const running = details.filter((d) => d.kind !== "sig" && !d.expired && d.endAt);
          const expiredCount = details.filter((d) => d.expired).length;
          if (running.length === 0 && expiredCount === 0) return null;
          return (
            <div className={styles.sigAlertBox}>
              {running.map((d) => {
                const left = fixedPeriodDaysLeft(d.endAt) ?? 0;
                return (
                  <p
                    key={d.count}
                    className={left <= 7 ? `${styles.sigAlertLine} ${styles.sigAlertSoon}` : styles.sigAlertLine}
                  >
                    🔔 {SIG_KIND_NAME[d.kind]} «{d.label || "(이름 없음)"}» 정가 {d.count.toLocaleString()}개
                    <span className={left <= 7 ? `${styles.sigDday} ${styles.sigDdaySoon}` : styles.sigDday}>
                      D-{Math.max(0, left)}
                    </span>
                    {d.endAt} 종료 — 종료 후엔 수집에서 자동으로 빠져요
                  </p>
                );
              })}
              {expiredCount > 0 ? (
                <p className={`${styles.sigAlertLine} ${styles.sigAlertEnded}`}>
                  ✅ 지난 정가 {expiredCount}건 수집 종료 — «정가 설정 → 지난 정가»에서 정리할 수 있어요 (팬
                  기록은 남아요)
                </p>
              ) : null}
            </div>
          );
        })()}
      </div>

      <div className={styles.tabs} role="tablist">
        {orderedTabs.map((t) => (
          <a
            key={t.id}
            className={t.activeWhen.includes(activeAdminTab) ? styles.tabActiveLink : styles.tabLink}
            href={t.href}
          >
            {t.label}
          </a>
        ))}
      </div>

      {activeAdminTab === "delivery" ? (
        <CollapsibleCard sectionKey="delivery" title="배송 관리">
          {/* 시청자가 전부 숨김 처리된 경우에도 "숨긴 시청자" 탭(복구)은 열 수 있어야 한다. */}
          {viewers.length > 0 || hiddenViewerSummaries.length > 0 ? (
            <IntegratedDelivery month={integratedMonth ?? "all"}>
            <DeliveryManager
              slug={state.slug}
              viewers={viewers}
              fixedEntries={entries
                .filter((e) => e.sourceKey.startsWith("fixed:"))
                .map((e) => ({
                  sourceKey: e.sourceKey,
                  fanId: e.fanId,
                  fanNickname: e.fanNickname,
                  itemName: e.itemName,
                  donateTimeText: e.donateTimeText,
                }))}
              fixedPriceNotes={state.fixedPriceNotes ?? []}
              archivedHiddenCounts={archivedHiddenCounts}
              hiddenViewers={hiddenViewerSummaries}
              archivedFanAt={deliveryArchivedFanAt}
              entryCount={(state.upboEntries ?? []).length}
            />
            </IntegratedDelivery>
          ) : (
            <p className={styles.fieldHint}>아직 배송할 업보 기록이 없어요.</p>
          )}
        </CollapsibleCard>
      ) : activeAdminTab === "items" || activeAdminTab === "history" ? (
        <CollapsibleCard sectionKey="items" title="교환·양도">
          {/* 하위탭: 기존 상위탭 두 개(items/history)를 한 상위탭 아래로 묶었다.
              atab 값은 그대로 유지 — 기존 북마크/링크(atab=history 포함)가 계속 동작한다. */}
          <div className={styles.subTabs} role="tablist">
            <a
              className={activeAdminTab === "items" ? styles.subTabActiveLink : styles.subTabLink}
              href={`/${state.slug}?admin=1&atab=items`}
            >
              업보 항목 관리
            </a>
            <a
              className={activeAdminTab === "history" ? styles.subTabActiveLink : styles.subTabLink}
              href={`/${state.slug}?admin=1&atab=history`}
            >
              양도·교환 이력
            </a>
          </div>
          {activeAdminTab === "items" ? (
            entries.length > 0 ? (
              <ItemEventManager
                slug={state.slug}
                entries={entries}
                events={events}
                catalogItems={catalogItems}
                rouletteByGroupIndex={rouletteByGroupIndex}
                catalogVersion={activeCatalog?.version ?? state.currentCatalogVersion ?? null}
                deliveryProgress={state.deliveryProgress ?? []}
              />
            ) : (
              <p className={styles.fieldHint}>아직 관리할 업보 항목이 없어요.</p>
            )
          ) : (
            <>
              <p className={styles.fieldHint}>
                누가 누구에게 어떤 상품을 양도/교환/취소했는지 최근순으로 모아서 보여줘요. 원본 당첨 기록은 그대로예요.
                실수한 처리는 오른쪽 「되돌리기」로 되살릴 수 있어요(카드가 사라진 시청자도 여기서).
              </p>
              <ItemHistoryLog slug={state.slug} entries={entries} events={events} />
            </>
          )}
        </CollapsibleCard>
      ) : activeAdminTab === "coupon" ? (
        <CollapsibleCard sectionKey="coupon" title="쿠폰 장부">
          <p className={styles.fieldHint}>
            배송할 업보와 별개로, 시청자가 모아 두는 쿠폰(교환권·티켓·코인) 장부예요. 쿠폰 이름을
            만들고 룰렛 상품을 연결해 두면 당첨될 때마다 자동으로 쌓이고, 연결 전의 지난 당첨도
            가져올 수 있어요. 물론 손으로 지급/사용을 적어도 됩니다. 어디에 쓸 수 있는지는 스트리머
            마음 — 여기는 장부만 정확하게 지켜요. 쿠폰을 등록하면 팬 화면에도 쿠폰 탭이 생겨요.
          </p>
          {coupon ? (
            <CouponManager
              slug={state.slug}
              initialItems={coupon.items}
              initialBalances={coupon.balances}
              initialEvents={coupon.events}
              initialSourceMap={coupon.sourceMap}
              couponSources={couponSourceCandidates}
              viewerSuggestions={viewers
                .filter((v) => v.fanNickname)
                .map((v) => ({ fanId: v.fanId, fanNickname: v.fanNickname }))}
              lastAppliedAt={state.importBatches?.[state.importBatches.length - 1]?.appliedAt}
            />
          ) : (
            <p className={styles.fieldHint}>
              쿠폰 장부를 불러오지 못했어요. DB에 쿠폰 테이블
              (supabase/migrations/20260707_coupon_ledger.sql)이 아직 적용되지 않았을 수 있어요.
            </p>
          )}
        </CollapsibleCard>
      ) : activeAdminTab === "manual" ? (
        <CollapsibleCard sectionKey="manual" title="수동기록">
          <p className={styles.fieldHint}>
            위플랩에 안 잡히는 룰렛 결과나 정가 시그니처를 직접 넣는 곳이에요. 넣은 기록은 배송·양도/교환·팬
            화면에서 자동수집분과 똑같이 다뤄지고, 같은 상품은 자동으로 합산돼요. 여기서 넣고, 실제 관리는 배송
            관리에서 하세요.
          </p>
          <ManualEntryManager
            slug={state.slug}
            entries={entries}
            catalogItems={catalogItems}
            catalogVersion={activeCatalog?.version ?? state.currentCatalogVersion ?? null}
            catalogCapturedAt={activeCatalog?.capturedAt ?? null}
            currentItemTabs={Object.fromEntries(
              [...rouletteIndex.itemRoulette].map(([name, info]) => [
                name,
                info.archived ? "" : info.label,
              ]),
            )}
            signatureCounts={state.signatureCounts ?? []}
          />
        </CollapsibleCard>
      ) : activeAdminTab === "roulettes" || activeAdminTab === "reveal" ? (
        <>
          {/* 룰렛 관리 하위탭 */}
          <div className={styles.subTabs}>
            <a
              className={activeAdminTab === "roulettes" ? styles.subTabActiveLink : styles.subTabLink}
              href={`/${state.slug}?admin=1&atab=roulettes`}
            >
              룰렛 설정
            </a>
            <a
              className={activeAdminTab === "reveal" ? styles.subTabActiveLink : styles.subTabLink}
              href={`/${state.slug}?admin=1&atab=reveal`}
            >
              확률 공개
            </a>
          </div>

          {activeAdminTab === "reveal" ? (
            <CollapsibleCard sectionKey="reveal" title="확률 공개 (팬 화면 룰렛 확률표)">
              <p className={styles.fieldHint}>
                공개할 룰렛만 켜면 그 룰렛 확률표가 팬 화면 오른쪽에 떠요. 기록 on/off와 무관하게,
                방송에서 도는 룰렛의 확률을 팬에게 보여줄 수 있어요.
              </p>
              <FanRevealManager
                slug={state.slug}
                roulettes={revealRoulettes}
                master={state.fanRevealEnabled ?? false}
                existingConfig={state.rouletteConfig ?? []}
              />
            </CollapsibleCard>
          ) : (
            <SortableSections tabId="roulettes" slug={state.slug} allSectionOrder={uiPrefs.sectionOrder}>
              {/* 위플랩 공개 링크 — 확프 없이 룰렛표 수집(sy 확정 2026-07-08, 확프와 병행). */}
              <CollapsibleCard sectionKey="weflab-link" title="위플랩 룰렛표 링크">
                <WeflabLinkManager slug={state.slug} initial={state.weflabLink ?? {}} />
              </CollapsibleCard>

              {/* 팬 탭 이름 — 묶기와 독립(sy 확정 2026-07-08). 탭의 상품 지문에 이름을 매단다. */}
              <CollapsibleCard sectionKey="fan-tab-names" title="팬 탭 이름·순서 (팬 화면 룰렛 탭)">
                <p className={styles.fieldHint}>
                  팬 화면 룰렛 탭에 보일 이름을 정하고, 드래그로 탭 순서를 바꾸세요. 이름과 순서는
                  룰렛 묶기와 별개로 탭의 상품 구성에 붙어서, 묶거나 해제해도 유지되고 새 룰렛표가
                  들어와도 따라옵니다.
                </p>
                <FanTabNameManager
                  slug={state.slug}
                  rows={fanNameRows}
                  fixedLabel={state.fanTabLabels?.fixedLabel ?? ""}
                  otherLabel={state.fanTabLabels?.otherLabel ?? ""}
                  existingEntries={state.fanTabLabels?.entries ?? []}
                  existingPastLabels={state.fanTabLabels?.pastLabels ?? {}}
                />
              </CollapsibleCard>

              {/* 룰렛 상품 · 사용 설정 + 룰렛 이름/묶기 + 상품 색상 */}
              <CollapsibleCard sectionKey="roulette-usage" title="룰렛 상품 · 사용 설정">
                {activeGroups.length > 0 ? (
                  <CatalogManager
                    slug={state.slug}
                    groups={activeGroups}
                    threshold={state.settings?.thresholdPercent ?? 0}
                    thresholdOverrides={state.thresholdOverrides ?? {}}
                    version={activeCatalog?.version ?? state.currentCatalogVersion}
                    catalogs={catalogs}
                    usageByVersion={state.catalogUsageByVersion ?? {}}
                  />
                ) : (
                  <p className={styles.fieldHint}>
                    현재 사용 중인 룰렛표(v{state.currentCatalogVersion})에서 상품을 찾지 못했어요.
                    Extension으로 룰렛표를 먼저 저장해 주세요.
                  </p>
                )}
                <RouletteConfigManager
                  slug={state.slug}
                  groups={managerGroups}
                  roulettes={managerRoulettes}
                  existingConfig={state.rouletteConfig ?? []}
                />
                <div style={{ marginTop: 14, borderTop: "1px solid var(--paper-line)", paddingTop: 14 }}>
                  <p className={styles.fieldHint} style={{ marginTop: 0 }}>
                    팬 화면에서 상품마다 배경색으로 구분해요(선택사항).
                  </p>
                  <ProductColorManager
                    slug={state.slug}
                    products={colorableProducts}
                    initial={state.productColors ?? {}}
                  />
                </div>
              </CollapsibleCard>

              {/* 룰렛표를 늦게 올렸을 때 되살리기 */}
              <CollapsibleCard sectionKey="rejudge" title="빠진 기록 다시 판정하기">
                <RejudgeManager slug={state.slug} groups={activeGroups} />
              </CollapsibleCard>

              {/* 기준 확률 설정 */}
              <CollapsibleCard sectionKey="threshold" title="기준 확률 설정">
                <ThresholdForm
                  slug={state.slug}
                  current={state.settings?.thresholdPercent ?? 0}
                  groups={thresholdGroups}
                  overrides={state.thresholdOverrides ?? {}}
                />
              </CollapsibleCard>

              {/* 두배권/특수 보상 확인 */}
              <CollapsibleCard sectionKey="special" title="두배권 후보 확인">
                <SpecialRuleManager slug={state.slug} rules={specialItemRules} />
              </CollapsibleCard>

              {/* 룰렛표(catalog) 버전 이력 */}
              <CollapsibleCard sectionKey="catalog-history" title="룰렛표 버전 이력">
                <ul className={styles.catalogList}>
                  {catalogs.map((c) => (
                    <CatalogRow key={c.version} catalog={c} isActive={c.version === state.currentCatalogVersion} />
                  ))}
                </ul>
              </CollapsibleCard>
            </SortableSections>
          )}
        </>
      ) : activeAdminTab === "signature" ? (
        <CollapsibleCard sectionKey="signature" title="정가 설정 (시그니처 후원 갯수)">
          <p className={styles.fieldHint}>
            여기 등록한 갯수와 일치하는 후원은 다음 수집 반영부터 &quot;정가기록&quot;으로 남아요. 룰렛
            업보와 별도로 표시되고, 상품 내용은 배송 관리의 정가 메모에서 적으면 됩니다.
          </p>
          <SignatureCountsManager
            slug={state.slug}
            initial={state.signatureCounts ?? []}
            initialDetails={state.signatureDetails ?? []}
            initialFanFixedTabMode={state.fanFixedTabMode ?? "sections"}
          />
        </CollapsibleCard>
      ) : activeAdminTab === "promo" ? (
        <SortableSections tabId="promo" slug={state.slug} allSectionOrder={uiPrefs.sectionOrder}>
          {/* 팬 화면 배치 편집기: 포스터/확률표/공지 블록을 원하는 자리로 */}
          <CollapsibleCard sectionKey="fan-layout" title="팬 화면 배치">
            <FanLayoutEditor
              slug={state.slug}
              initial={state.fanLayout}
              available={{
                poster0: Boolean(showcase?.posterUrls?.[0]),
                poster1: Boolean(showcase?.posterUrls?.[1]),
                poster2: Boolean(showcase?.posterUrls?.[2]),
                poster3: Boolean(showcase?.posterUrls?.[3]),
                poster4: Boolean(showcase?.posterUrls?.[4]),

                reveal: Boolean(
                  state.fanRevealEnabled && (state.rouletteConfig ?? []).some((c) => c.revealed),
                ),
                notice: Boolean(showcase?.noticeText?.trim()),
              }}
            />
          </CollapsibleCard>

          <CollapsibleCard sectionKey="showcase" title="포스터 및 배너 (배너·포스터·공지)">
            <p className={styles.fieldHint}>
              여기서 등록한 배너·포스터·공지사항이 팬 화면에 그대로 보여요. 하나라도 등록하면 팬 화면
              레이아웃이 배너 + 포스터 형태로 바뀝니다. 비우고 저장하면 원래 화면으로 돌아가요.
            </p>
            <ShowcaseManager slug={state.slug} initial={showcase} />
          </CollapsibleCard>
        </SortableSections>
      ) : activeAdminTab === "wardrobe" ? (
        <CollapsibleCard sectionKey="wardrobe" title="옷장 (의상·헤어)">
          <p className={styles.fieldHint}>
            의상·헤어 컷을 올리면 팬 화면에 옷장 탭이 생겨요(1장 이상일 때만). 분류 없이 이미지를 바로 등록할 수 있으며, 테마를 만들어
            고르고, 여러 장을 한꺼번에 끌어다 놓으면 돼요.
          </p>
          {process.env.UPBO_WARDROBE_RECOVERY === "read-only" ? (
            <p role="status">옷장을 점검하고 있어요. 이미지와 설정은 보존되며, 지금은 편집할 수 없어요.</p>
          ) : <WardrobeManager slug={state.slug} initial={wardrobe} />}
        </CollapsibleCard>
      ) : (
        <SortableSections tabId="settings" slug={state.slug} allSectionOrder={uiPrefs.sectionOrder}>
          {/* 시트 테마 — 전용 설정 화면으로 이동 */}
          <CollapsibleCard sectionKey="theme" title="시트 테마">
            <p className={styles.fieldHint}>
              팬 화면과 관리자 화면의 색·분위기를 고르는 화면으로 이동해요. 미리보기로 비교하면서
              바로 저장할 수 있어요.
            </p>
            <a
              className={styles.secondaryButton}
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
              href={`/${state.slug}/settings`}
            >
              테마 설정 열기 →
            </a>
          </CollapsibleCard>

          {/* 관리자 상위탭 순서·이름 커스텀 */}
          <CollapsibleCard sectionKey="tab-editor" title="탭 순서·이름 설정">
            <AdminTabEditor
              slug={state.slug}
              tabs={ADMIN_TABS.map((t) => ({ id: t.id, defaultLabel: t.label }))}
              initialOrder={orderedTabs.map((t) => t.id)}
              initialLabels={uiPrefs.tabLabels}
            />
          </CollapsibleCard>

          {/* 이 시트 관리자 비밀번호 */}
          <CollapsibleCard sectionKey="password" title="관리자 비밀번호 (이 시트 전용)">
            <SheetAdminPasswordForm slug={state.slug} />
          </CollapsibleCard>

          {/* 팬 화면 배송 반영 */}
          <CollapsibleCard sectionKey="delivery-reflect" title="팬 화면 배송 반영">
            <p className={styles.fieldHint}>
              배송 관리에서 처리한 수량을 팬 화면에 어떻게 보여줄지 정해요. 이 스트리머에게만
              적용됩니다. 기본은 &quot;반영 안 함&quot;이라, 바꾸지 않으면 지금 그대로예요.
            </p>
            <FanDeliveryModeForm slug={state.slug} initial={state.fanDeliveryReflect ?? "off"} />
          </CollapsibleCard>

          {/* 팬 화면 계정ID 숨기기 */}
          <CollapsibleCard sectionKey="fan-id-privacy" title="팬 화면 계정ID 숨기기">
            <p className={styles.fieldHint}>
              켜면 팬 화면 표(업보·획득 기록·쿠폰)에서 계정ID 열이 통째로 사라져요. 관리자
              화면과 검색(본인 ID로 찾기)은 그대로예요. 기본은 &quot;끔&quot;이라, 켜지 않으면
              지금 그대로입니다. 이 스트리머에게만 적용됩니다.
            </p>
            <FanIdPrivacyForm slug={state.slug} initial={state.fanIdHidden === true} />
          </CollapsibleCard>

          {/* 팬 쿠폰 탭 이름 */}
          <CollapsibleCard sectionKey="coupon-tab-label" title="쿠폰 탭 이름">
            <p className={styles.fieldHint}>
              팬 화면의 쿠폰 탭·표에 보일 이름을 정해요 (예: 꾸폰, 마일리지). 표시만 바뀌고
              장부·집계는 그대로예요. 비우고 저장하면 기본 &quot;쿠폰&quot;으로 돌아갑니다.
            </p>
            <CouponTabLabelForm slug={state.slug} initial={state.couponTabLabel ?? ""} />
          </CollapsibleCard>

          {/* 팬 대문 제목 */}
          <CollapsibleCard sectionKey="sheet-title" title="대문 제목">
            <p className={styles.fieldHint}>
              팬 화면 맨 위 대문에 보일 제목을 직접 정해요. 이모지·특수문자도 돼요. 표시만
              바뀌고 장부·브라우저 탭 제목·관리자 화면은 그대로예요. 비우고 저장하면 기본
              {` "${state.displayName?.trim() || state.slug} 업보시트"`}로 돌아갑니다.
            </p>
            <SheetTitleForm
              slug={state.slug}
              initial={state.sheetTitle ?? ""}
              defaultTitle={`${state.displayName?.trim() || state.slug} 업보시트`}
            />
          </CollapsibleCard>

          {/* 최신 결과 반영 요약 */}
          <CollapsibleCard sectionKey="latest" title="최신 결과 반영">
            {latest ? (
              <>
                <div className={styles.metaRow}>
                  <span className={styles.tag}>catalog v{latest.catalogVersion}</span>
                  <span className={styles.tag}>적용 기준 {latest.thresholdPercent}%</span>
                  <span className={styles.tagMuted}>캡처 {fmtKst(latest.capturedAt)}</span>
                  <span className={styles.tagMuted}>반영 {fmtKst(latest.appliedAt)}</span>
                </div>
                <div className={styles.statGrid}>
                  <Stat label="자동 기록" value={latest.summary.recordCount} accent />
                  <Stat label="최종 카운트" value={latest.summary.effectiveRecordCount ?? latest.summary.recordCount} />
                  <Stat label="두배권 감지" value={latest.summary.modifierCount ?? 0} />
                  <Stat label="제외" value={latest.summary.ignoreCount} />
                  <Stat label="중복" value={latest.summary.duplicateCount} />
                  <Stat label="확인 필요" value={latest.summary.needsReviewCount} />
                </div>
                <p className={styles.fieldHint}>
                  전체 결과 {latest.summary.totalResults.toLocaleString()}건 중 기준 이하{" "}
                  {latest.entryCount}건이 업보 후보로 기록됐어요.
                  {(latest.summary.missionSettlementCount ?? 0) > 0
                    ? ` 미션 정산 뭉치 ${latest.summary.missionSettlementCount}건은 계정이 없어 제외했어요.`
                    : ""}
                </p>
              </>
            ) : (
              <p className={styles.fieldHint}>아직 반영된 결과 배치가 없어요.</p>
            )}
          </CollapsibleCard>

        </SortableSections>
      )}
    </div>
    </AdminCollapseProvider>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={accent ? styles.statValueAccent : styles.statValue}>
        {value.toLocaleString()}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function CatalogRow({ catalog, isActive }: { catalog: Catalog; isActive: boolean }) {
  const itemCount = catalog.itemCount ?? catalog.items?.length ?? 0;
  const isEmpty = itemCount === 0;
  const groups = catalog.groups ?? [];

  return (
    <li className={`${styles.catalogItem} ${isEmpty ? styles.catalogItemEmpty : ""}`}>
      <div className={styles.catalogTop}>
        <span className={styles.catalogVersion}>v{catalog.version}</span>
        {isEmpty ? (
          <span className={styles.tagWarn}>빈 버전 · 사용하지 않음 / 확인 필요</span>
        ) : isActive ? (
          <span className={styles.tagActive}>현재 사용 중</span>
        ) : (
          <span className={styles.tagMuted}>이전 버전</span>
        )}
      </div>

      {isEmpty ? (
        <p className={styles.fieldHint}>상품 0개. 룰렛표 읽기 실패/빈 저장 흔적이라 판별에 쓰지 않아요.</p>
      ) : (
        <>
          <div className={styles.metaRow}>
            <span className={styles.tagMuted}>상품 {itemCount}개</span>
            <span className={styles.tagMuted}>그룹 {groups.length}개</span>
            {groups.length > 0 ? (
              <span className={`${styles.tagMuted} ${styles.tagWrap}`}>
                금액쌍 {groups.map((g) => groupAmountLabel(g)).join(" · ")}
              </span>
            ) : null}
            <span className={styles.tagMuted}>캡처 {fmtKst(catalog.capturedAt)}</span>
          </div>

          {/* 사람이 읽는 이름(생일룰렛 등) — 저장 API 후속 필요라 입력칸은 자리만 마련 */}
          <div className={styles.labelPlaceholder}>
            <input
              type="text"
              placeholder="예: 생일룰렛 / 서버룰렛 (표시 이름)"
              disabled
              aria-label="룰렛 표시 이름"
            />
            <button type="button" disabled>
              저장
            </button>
            <span className={styles.tagFollowup}>API 후속 필요</span>
          </div>
        </>
      )}
    </li>
  );
}
