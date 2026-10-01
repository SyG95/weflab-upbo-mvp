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
  normalizeResultCapture,
  reconcileResults,
  type NormalizedCatalogItem,
  type NormalizedResult,
  type ReconcileDecision,
  type ResultCapture,
  type SpecialItemRule,
} from "./upboCore";
import { applyItemAliases, type ItemAliasMap } from "./itemAlias";

export type RejudgeSourceBatch = {
  batchId: string;
  capture: ResultCapture;
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
