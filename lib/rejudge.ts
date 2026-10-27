// ---------- 재판정(rejudge) — 순수 로직 ----------
//
// 왜 필요한가:
//   룰렛확률표를 늦게 갱신하면, 그 전에 들어온 결과는 "옛 표"로 판정된다.
//   새 표에 있는 상품이어도 당시엔 매칭이 안 돼 needs_review 로 빠지고,
//   판정 엔진이 needs_review 키까지 modifierState.processedSourceKeys 에 넣어
//   저장하기 때문에(upboCore reconcileResults), 확장으로 같은 기간을 다시 보내도
//   "duplicate"로 걸러져 영영 복구되지 않는다.
//   → 저장된 원본(raw_imports)을 "현재 표"로 다시 돌려, 기록됐어야 할 것만 건져낸다.
//
// 안전 규칙(절대 어기지 않는다):
//   1) reconcileResults 는 수정하지 않는다. 여기서는 "그대로" 재실행만 한다.
//   2) 이미 공식 기록(upbo_entries)에 있는 sourceKey 는 건드리지 않는다.
//      → 기존 기록의 수정·삭제는 이 기능의 범위가 아니다. 새로 넣는 것만 한다.
//   3) 두배권(modifier)은 적용하지 않는다. 두배권은 "시간순 상태"라서 뒤늦게
//      다시 계산하면 이미 소모된 배수가 두 번 적용될 수 있다. 매 배치에 빈
//      modifierState 를 넘기고, 결과 상태는 저장하지 않는다(effectiveCount 는 항상 1).
//      확정된 두배권 항목 자체는 specialItemRules 로 그대로 넘겨 ignore 처리된다.
//      "사용 안 함"으로 꺼 둔 확정 두배권 칸도 같은 ignore 다(2026-10-01, 사용 여부와 분리) —
//      이름 연결 화면(unmatched)에 "다음 룰렛 2배"가 섞여 잘못 연결되는 일을 막는다.
//   4) 배치를 저장 순서대로 하나씩 재실행한다. 같은 결과가 여러 배치에 중복 캡처돼
//      있으므로, 한 번에 몰아 돌리면 같은 sourceKey 가 두 번 record 로 잡힌다.
//      (공식 apply 순서·검증실 재현과 같은 방식)
import {
  cleanText,
  findCatalogMatch,
  isMissionSettlementType,
  normalizeResultCapture,
  reconcileResults,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type ReconcileDecision,
  type ResultCapture,
  type SpecialItemRule,
} from "./upboCore";
import { aliasTargetFor, applyItemAliases, applyItemAliasesIfUnmatched, type ItemAliasMap } from "./itemAlias";
import { filterEntriesByCatalogUsage, type Catalog, type UpboEntry } from "./api";
import {
  currentJudgeInputs,
  hasMultiplierCells,
  looksLikeMultiplierName,
  parseDonateTimeMsStrict,
  pickJudgeInputsAt,
  resultMatchesVersion,
  thresholdPercentCandidates,
  versionInputsAt,
  type JudgeHistory,
  type UsageEngine,
  type UsageOverrides,
} from "./judgeInputsAt";
import { findManualOverlaps, type ManualOverlap, type ManualOverlapEntry } from "./manualOverlap";
import {
  classifyDonationTimeRow,
  excludeReasonText,
  type DonationTimeClass,
  type DonationTimeExcludeKind,
  type DonationTimeFacts,
} from "./rejudgeClassify";

export type RejudgeSourceBatch = {
  batchId: string;
  capture: ResultCapture;
  // raw_imports.saved_at — 후원 시각을 못 읽는 결과의 대체 시각(후원 시점 근사 모드만 쓴다).
  savedAt?: string | null;
};

export type RejudgeSummary = {
  batchCount: number; // 다시 돌린 배치 수
  scannedResults: number; // 다시 본 원본 결과 수
  wouldRecord: number; // 새로 기록될 건수
  alreadyRecorded: number; // 이미 기록돼 있어 건너뛴 건수
  stillNeedsReview: number; // 새 표로도 매칭 안 되는 건수
  ignored: number; // 기준 확률 초과, 미션 정산 뭉치(계정 없음) 등으로 제외되는 건수(정산은 매칭 여부와 무관)
};

export type RejudgeCandidate = {
  sourceKey: string;
  batchId: string;
  fanId: string;
  fanNickname: string;
  itemName: string;
  probability: number;
  amountRangeLabel: string;
  catalogGroupIndex: number | null;
  donationType: string;
  donationAmount: number | null;
  donationAmountText: string;
  donateTimeText: string;
  rouletteIndex: number;
  rouletteTotal: number;
  rawText: string;
};

function toCandidate(decision: ReconcileDecision, batchId: string): RejudgeCandidate {
  const result = decision.result;
  return {
    sourceKey: decision.sourceKey,
    batchId,
    fanId: result.fanId,
    fanNickname: result.fanNickname,
    itemName: result.itemName,
    // 기록에 남기는 확률은 "현재 표"의 값이다(판정 근거와 일치시킨다).
    probability: decision.catalogItem?.probability ?? result.probability ?? 0,
    amountRangeLabel: decision.catalogItem?.amountRangeLabel ?? "",
    catalogGroupIndex: decision.catalogItem?.groupIndex ?? null,
    donationType: result.donationType,
    donationAmount: result.donationAmount,
    donationAmountText: result.donationAmountText,
    donateTimeText: result.donateTimeText,
    rouletteIndex: result.rouletteIndex,
    rouletteTotal: result.rouletteTotal,
    rawText: result.rawText,
  };
}

// 저장된 원본 배치들을 현재 확률표로 다시 판정해, "새로 기록돼야 할 것"만 골라낸다.
// I/O 없음 — 테스트 가능한 순수 함수.
export function collectRejudgeCandidates({
  batches,
  catalogItems,
  thresholdPercent,
  existingSourceKeys,
  specialItemRules = [],
  aliases = {},
}: {
  batches: RejudgeSourceBatch[];
  catalogItems: NormalizedCatalogItem[];
  thresholdPercent: number;
  existingSourceKeys: Set<string>;
  specialItemRules?: SpecialItemRule[];
  // "예전 이름 = 지금 표의 이 상품" 연결표. 비어 있으면 기존 동작과 100% 동일하다.
  aliases?: ItemAliasMap;
}): { summary: RejudgeSummary; candidates: RejudgeCandidate[]; unmatched: NormalizedResult[] } {
  // 원본 집합은 건드리지 않는다(호출자의 Set 을 오염시키지 않기 위해 복사).
  const seen = new Set<string>(existingSourceKeys);
  const candidates: RejudgeCandidate[] = [];
  // 지금 표로도 못 찾은 결과 — 이름 연결 화면의 재료가 된다(연결 전 원본 이름 그대로).
  const unmatched: NormalizedResult[] = [];
  const summary: RejudgeSummary = {
    batchCount: 0,
    scannedResults: 0,
    wouldRecord: 0,
    alreadyRecorded: 0,
    stillNeedsReview: 0,
    ignored: 0,
  };

  for (const batch of batches) {
    let normalized;
    try {
      normalized = normalizeResultCapture(batch.capture);
    } catch {
      // 원본이 깨진 배치는 조용히 건너뛴다(읽기 실패가 재판정 전체를 막지 않게).
      continue;
    }
    if (normalized.results.length === 0) continue;
    summary.batchCount += 1;
    summary.scannedResults += normalized.results.length;

    // 연결해 둔 이름은 여기서 "지금 표의 상품"으로 바꿔서 판정에 넘긴다.
    // sourceKey 는 그대로라 중복 방지·멱등성에 영향이 없다.
    const aliased = applyItemAliases(normalized.results, catalogItems, aliases);
    const originalByKey = new Map(normalized.results.map((result) => [result.sourceKey, result]));

    const recon = reconcileResults({
      catalogItems,
      results: aliased,
      thresholdPercent,
      existingSourceKeys: seen,
      specialItemRules,
      // 두배권 미적용(위 안전 규칙 3). 결과 상태는 버린다.
      modifierState: {},
      // 꺼진 확정 두배권 칸도 ignore(위 규칙 3 보강). 반영(apply)과 같은 규칙을 명시한다.
      modifierIgnoresUsage: true,
    });

    for (const decision of recon.decisions) {
      if (decision.decision === "record") {
        summary.wouldRecord += 1;
        seen.add(decision.sourceKey);
        candidates.push(toCandidate(decision, batch.batchId));
      } else if (decision.decision === "duplicate") {
        summary.alreadyRecorded += 1;
      } else if (decision.decision === "needs_review") {
        summary.stillNeedsReview += 1;
        // 연결 화면에는 바뀌기 전 "원래 이름"을 보여줘야 스트리머가 알아본다.
        unmatched.push(originalByKey.get(decision.sourceKey) ?? decision.result);
      } else {
        summary.ignored += 1;
      }
    }
  }

  return { summary, candidates, unmatched };
}

// ---------- 후원 시점 근사 다시판정(1단계 묶음 3, D3·D1) — 미리보기 전용, 순수 ----------
//
// "지금 표로"(collectRejudgeCandidates)와 다른 점:
//   - 결과마다 후원 시각 t 의 판정 입력(그때 표·사용 설정·예외·기준%·두배권)을 pickJudgeInputsAt 으로 고른다.
//   - 결과 키(sourceKey) 단위로 한 번만 센다(같은 결과가 여러 원본 묶음에 들어 있어도 1건). 첫 묶음의 값으로 판정하고,
//     뒤 묶음에서 상품·확률·금액·계정이 다르게 잡혔으면 "키 흔들림"(G10)으로 표시한다.
//   - reconcileResults 는 결과 1건씩, 기존 키 없이·빈 두배권 상태로 부른다(위 안전 규칙 1·3과 같음). 결정은 바꾸지 않는다.
//   - "사용 안 함" 당첨은 엔진상 검토함(needs_review)이다(F1). 꺼진 칸까지 다시 찾아 "그때 꺼짐(⚪)"과 "어느 칸에도 없음(검토)"을 가른다.
//   - 이미 기록된 결과도 근사 판정을 돌려, 근사로는 제외인 것을 "오기록 의심"으로 표시만 한다(삭제 기능 없음).
// 쓰기 0: 이 함수는 판정 결과와 분류만 돌려준다.

export type DonationTimeRow = {
  sourceKey: string;
  kind: "new" | "suspected";
  cls: DonationTimeClass;
  reasonText: string;
  reasons: string[];
  tags: string[];
  donateTimeText: string;
  timeMs: number | null;
  fanNickname: string;
  fanId: string;
  donationType: string;
  donationAmount: number | null;
  itemName: string; // 원본 상품명
  probability: number | null; // 원본 확률
  // 그때 판정 근거: 버전·칸·확률·기준. 넣기(묶음 4)는 이 세트를 그대로 저장한다.
  judged: {
    version: number;
    groupIndex: number | null;
    amountRangeLabel: string;
    itemName: string; // 표 칸 이름
    probability: number | null;
    threshold: number;
    storeItemName: string; // 넣을 때 저장할 이름(원문, 별칭이면 연결 대상 이름 — 실시간·현행 다시판정과 같은 규칙)
  };
  nowDecision: ReconcileDecision["decision"] | "no_catalog";
  manualOverlap: ManualOverlap | null;
  ambiguity: DonationTimeFacts["tableAmbiguity"];
};

export type DonationTimeSummary = {
  batchCount: number;
  scannedResults: number; // 원본 묶음에 나온 횟수(중복 포함)
  N: number; // 결과 키 수 = a + d + c + b
  a: number; // 이미 기록
  d: number; // 새로 기록될 것(🟢+🟡)
  c: number; // 검토(그때 표에서도 못 찾음)
  b: number; // 제외(⚪)
  green: number;
  yellow: number;
  suspectedOver: number; // 이미 기록됐는데 근사로는 제외
  hiddenOnFan: number; // d 중 넣어도 팬 화면엔 안 보이는 것
  alsoNowRecord: number; // d 중 "지금 표로" 다시판정으로도 들어가는 것
  excluded: Record<DonationTimeExcludeKind, number>;
  review: { noMatch: number; aliasTargetMissing: number; noCatalog: number };
  timeUnknown: number;
};

type Occurrence = { result: NormalizedResult; savedAt: string | null; signature: string };

// 같은 결과 키가 원본 묶음마다 "판정에 영향을 주는 값"이 같은지(G10). 후원 시각·종류도 본다 — 시각이 다르면 그때 표·설정이,
// 종류가 다르면 미션 정산 여부가 달라진다. 닉네임은 시청자가 바꿀 수 있고 판정과 무관해 뺀다.
function occurrenceSignature(r: NormalizedResult): string {
  return [
    cleanText(r.itemName),
    r.probability ?? "",
    r.donationAmount ?? "",
    cleanText(r.fanId),
    cleanText(r.donateTimeText),
    cleanText(r.donationType),
  ].join("|");
}

function nearly(a: number | null | undefined, b: number | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(Number(a) - Number(b)) < 0.000001;
}

function judgeOne(
  catalogItems: NormalizedCatalogItem[],
  result: NormalizedResult,
  thresholdPercent: number,
  specialItemRules: SpecialItemRule[],
): ReconcileDecision {
  return reconcileResults({
    catalogItems,
    results: [result],
    thresholdPercent,
    existingSourceKeys: new Set<string>(),
    specialItemRules,
    modifierState: {},
    missionSettlementIgnore: true,
    modifierIgnoresUsage: true,
  }).decisions[0];
}

export function collectDonationTimeCandidates({
  batches,
  history,
  engine,
  existingSourceKeys,
  manualEntries = [],
  aliases = {},
  fanCatalogs,
  fanUsageByVersion,
}: {
  batches: RejudgeSourceBatch[];
  history: JudgeHistory;
  engine: UsageEngine;
  existingSourceKeys: Set<string>;
  manualEntries?: ManualOverlapEntry[];
  aliases?: ItemAliasMap;
  // 팬 화면 필터(filterEntriesByCatalogUsage)에 그대로 넣을 표·사용 설정 맵(getStreamerState 와 같은 규칙).
  fanCatalogs: Catalog[];
  fanUsageByVersion: Record<number, UsageOverrides>;
}): { summary: DonationTimeSummary; rows: DonationTimeRow[]; aliasUnmatched: NormalizedResult[]; nowItems: NormalizedCatalogItem[] } {
  const summary: DonationTimeSummary = {
    batchCount: 0,
    scannedResults: 0,
    N: 0,
    a: 0,
    d: 0,
    c: 0,
    b: 0,
    green: 0,
    yellow: 0,
    suspectedOver: 0,
    hiddenOnFan: 0,
    alsoNowRecord: 0,
    excluded: { over_threshold: 0, disabled_then: 0, modifier: 0, mission: 0 },
    review: { noMatch: 0, aliasTargetMissing: 0, noCatalog: 0 },
    timeUnknown: 0,
  };

  // 1) 결과 키 단위로 모은다(첫 묶음 값 + 뒤 묶음의 다른 모양 여부).
  const firstByKey = new Map<string, Occurrence>();
  const unstable = new Set<string>();
  for (const batch of batches) {
    let normalized;
    try {
      normalized = normalizeResultCapture(batch.capture);
    } catch {
      continue; // 깨진 원본은 건너뛴다(현행 다시판정과 같음)
    }
    if (normalized.results.length === 0) continue;
    summary.batchCount += 1;
    summary.scannedResults += normalized.results.length;
    const savedAt = batch.savedAt ?? normalized.capturedAt ?? null;
    for (const result of normalized.results) {
      const signature = occurrenceSignature(result);
      const prev = firstByKey.get(result.sourceKey);
      if (!prev) firstByKey.set(result.sourceKey, { result, savedAt, signature });
      else if (prev.signature !== signature) unstable.add(result.sourceKey);
    }
  }

  const now = currentJudgeInputs(history, engine);
  const nowItems = now?.items ?? [];
  const multiplierStreamer = hasMultiplierCells(history);
  // 근사 기준%일 때 "어느 후보 기준으로도 기록"인지 볼 최솟값. 후보를 못 구하면 안전하다고 보지 않는다.
  const floorRaw = Math.min(...thresholdPercentCandidates(history));
  const thresholdFloor = Number.isFinite(floorRaw) ? floorRaw : Number.NEGATIVE_INFINITY;
  const rows: DonationTimeRow[] = [];
  const aliasUnmatched: NormalizedResult[] = [];

  for (const [sourceKey, occ] of firstByKey) {
    summary.N += 1;
    const result = occ.result;
    const known = parseDonateTimeMsStrict(result.donateTimeText);
    if (known === null) summary.timeUnknown += 1;
    const savedMs = occ.savedAt ? Date.parse(occ.savedAt) : NaN;
    // 후원 시각을 못 읽으면 원본 저장 시각(없으면 지금)으로 근사한다 — G9 로 🟡 가 된다.
    const tMs = known ?? (Number.isFinite(savedMs) ? savedMs : Number.MAX_SAFE_INTEGER);
    const existing = existingSourceKeys.has(sourceKey);

    // "지금 표로"(현행 다시판정과 같은 재료) — 비교 표시용.
    let nowDecision: DonationTimeRow["nowDecision"] = existing ? "duplicate" : "no_catalog";
    if (now && !existing) {
      const aliasedNow = applyItemAliases([result], now.items, aliases)[0];
      nowDecision = judgeOne(now.items, aliasedNow, now.thresholdPercent, now.specialRules).decision;
    }

    const inputs = pickJudgeInputsAt(tMs, history, engine, result);
    if (!inputs) {
      if (existing) summary.a += 1;
      else {
        summary.c += 1;
        summary.review.noCatalog += 1;
      }
      continue;
    }
    const versionItems = history.catalogs.find((c) => c.version === inputs.version)?.items ?? [];
    const alias = applyItemAliasesIfUnmatched(result, versionItems, nowItems, aliases);
    const judged = alias.result;
    const decision = judgeOne(inputs.items, judged, inputs.thresholdPercent.value, inputs.specialRules);

    let excludeKind: DonationTimeExcludeKind | null = null;
    let disabledMatch: NormalizedCatalogItem | null = null;
    if (decision.decision === "ignore") {
      excludeKind = isMissionSettlementType(judged.donationType) ? "mission" : decision.modifierRule ? "modifier" : "over_threshold";
    } else if (decision.decision === "needs_review") {
      const any = findCatalogMatch(judged, inputs.items, { includeDisabled: true });
      if (any && any.enabled === false) {
        excludeKind = "disabled_then";
        disabledMatch = any;
      }
    }

    // 표시용 칸: 기록·제외면 엔진이 고른 칸, 그때 꺼진 상품이면 그 꺼진 칸.
    const item = decision.catalogItem ?? disabledMatch;
    const threshold = item?.thresholdOverridePercent ?? inputs.thresholdPercent.value;
    const base = {
      sourceKey,
      donateTimeText: result.donateTimeText,
      timeMs: known,
      fanNickname: result.fanNickname,
      fanId: result.fanId,
      donationType: result.donationType,
      donationAmount: result.donationAmount,
      itemName: result.itemName,
      probability: result.probability,
      judged: {
        version: inputs.version,
        groupIndex: item?.groupIndex ?? null,
        amountRangeLabel: item?.amountRangeLabel ?? "",
        itemName: item?.itemName ?? "",
        probability: item?.probability ?? null,
        threshold,
        storeItemName: judged.itemName,
      },
      nowDecision,
    };

    if (existing) {
      summary.a += 1;
      if (excludeKind) {
        summary.suspectedOver += 1;
        rows.push({
          ...base,
          kind: "suspected",
          cls: "grey",
          reasonText: `이미 기록됐지만 ${excludeReasonText(excludeKind)}`,
          reasons: [],
          tags: [],
          manualOverlap: null,
          ambiguity: inputs.ambiguity,
        });
      }
      continue;
    }
    if (decision.decision !== "record") {
      if (excludeKind) {
        summary.b += 1;
        summary.excluded[excludeKind] += 1;
      } else {
        summary.c += 1;
        if (alias.aliasTargetMissing) summary.review.aliasTargetMissing += 1;
        else summary.review.noMatch += 1;
        // 이름 연결 화면 재료: 그때 표로도 못 찾은 것만(그때 표로 풀리는 건 연결이 필요 없다).
        aliasUnmatched.push(result);
      }
      continue;
    }

    // 새로 기록될 것 — 🟢 엄격 조건 G1~G12.
    const matched = item!;
    // G4 보강(확프 수집 표처럼 위플랩 수정시간을 모르는 교체): 바로 다음 표에도 같은 칸이 있는데 그 표로 판정하면
    // 결과가 달라지면(사용 설정·금액대 예외 차이) 어느 표였는지가 판정을 가른다 → 애매.
    let ambiguity: DonationTimeRow["ambiguity"] = inputs.ambiguity;
    if (ambiguity === null) {
      const next = history.catalogs.find((c) => c.version > inputs.version);
      if (next && resultMatchesVersion(judged, next.version, history)) {
        const nextInputs = versionInputsAt(tMs, next.version, history, engine);
        if (judgeOne(nextInputs.items, judged, nextInputs.thresholdPercent.value, nextInputs.specialRules).decision !== "record") {
          ambiguity = "next_conflict";
        }
      }
    }
    const aliasTarget = aliasTargetFor(result, nowItems, aliases);
    const manualOverlap = findManualOverlaps(
      {
        fanId: result.fanId,
        fanNickname: result.fanNickname,
        itemName: result.itemName,
        donateTimeText: result.donateTimeText,
        // 그때 표엔 옛 이름이 있어도 수동기록은 새 이름(연결 대상)으로 적었을 수 있다.
        itemNames: [judged.itemName, matched.itemName, ...(aliasTarget ? [aliasTarget.itemName] : [])],
      },
      manualEntries,
    );
    const fanView = filterEntriesByCatalogUsage(
      [
        {
          sourceKey,
          catalogVersion: inputs.version,
          catalogGroupIndex: matched.groupIndex,
          itemName: judged.itemName,
          amountRangeLabel: matched.amountRangeLabel,
        } as UpboEntry,
      ],
      fanCatalogs,
      fanUsageByVersion,
    );
    const hiddenOnFan = fanView.length === 0;
    const classified = classifyDonationTimeRow({
      decision: "record",
      excludeKind: null,
      exactName: cleanText(result.itemName) === matched.itemName,
      probabilityKnown: result.probability !== null && nearly(judged.probability, matched.probability),
      amountKnown: result.donationAmount !== null,
      tableAmbiguity: ambiguity,
      usageApproximate: inputs.usage.approximate,
      thresholdSafe:
        matched.thresholdOverridePercent !== undefined && matched.thresholdOverridePercent !== null
          ? true
          : inputs.thresholdPercent.exact || matched.probability <= thresholdFloor,
      multiplierRisk: multiplierStreamer || looksLikeMultiplierName(result.itemName),
      // 정가 설정은 바뀐다(정가 → 룰렛 전환 등) — 그때든 지금이든 정가로 등록된 적 있는 갯수면 🟡.
      fixedPriceCandidate: result.donationAmount !== null && history.fixedAmountsEver.has(result.donationAmount),
      timeKnown: known !== null,
      preReset: inputs.preReset,
      keyUnstable: unstable.has(sourceKey),
      // 원본 고유번호(sourceUid)가 없으면 시각·계정·상품 해시가 열쇠라 같은 초의 같은 후원 2건이 1건으로 합쳐질 수 있다.
      fallbackKey: sourceKey.startsWith("fallback::"),
      manualOverlapSummary: manualOverlap?.summary ?? null,
      aliasUsed: alias.aliasUsed,
      hiddenOnFan,
    });
    summary.d += 1;
    if (classified.cls === "green") summary.green += 1;
    else summary.yellow += 1;
    if (hiddenOnFan) summary.hiddenOnFan += 1;
    if (nowDecision === "record") summary.alsoNowRecord += 1;
    rows.push({ ...base, kind: "new", ...classified, manualOverlap, ambiguity });
  }

  // 🟢 → 🟡 → 오기록 의심, 같은 분류 안에서는 후원 시각 순(못 읽은 시각은 뒤).
  const order = (r: DonationTimeRow) => (r.kind === "suspected" ? 2 : r.cls === "green" ? 0 : 1);
  rows.sort(
    (x, y) =>
      order(x) - order(y) ||
      (x.timeMs ?? Number.MAX_SAFE_INTEGER) - (y.timeMs ?? Number.MAX_SAFE_INTEGER) ||
      x.sourceKey.localeCompare(y.sourceKey),
  );
  return { summary, rows, aliasUnmatched, nowItems };
}
