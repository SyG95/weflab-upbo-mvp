import { collectRejudgeCandidates, type RejudgeSourceBatch } from "../lib/rejudge";
import { normalizeName, type NormalizedCatalogItem, type SpecialItemRule } from "../lib/upboCore";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 확률표 상품 한 줄. 금액대 33원 룰렛에 붙는다.
function item(itemName: string, probability: number, amount = 33, groupIndex = 0): NormalizedCatalogItem {
  return {
    groupIndex,
    amountMin: amount,
    amountMax: amount,
    amountRangeLabel: String(amount),
    enabled: true,
    doubleEnabled: false,
    itemName,
    normalizedName: normalizeName(itemName),
    probability,
    sortOrder: 0,
    raw: null,
  };
}

// 위플랩 캡처 한 장(후원 1행 + 룰렛 결과 1개).
function capture(uid: string, itemName: string, probability: number, amount = 33): RejudgeSourceBatch["capture"] {
  return {
    capturedAt: "2026-07-31T12:00:00.000Z",
    rows: [
      {
        sourceUid: uid,
        donateTimeText: "2026-07-31 12:00:00",
        donationType: "별풍선",
        donationAmount: amount,
        fanNickname: "테스트팬",
        fanId: "testfan",
        results: [{ name: itemName, probability, index: 0, total: 1 }],
      },
    ],
  };
}

const catalog = [item("❤️A단컷", 1), item("배박수", 11)];
const THRESHOLD = 5;

// 1) 표에 있고 기준 확률 이하 → 새로 기록될 후보가 된다.
{
  const r = collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid1", "❤️A단컷", 1) }],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
  });
  assertEq(r.summary.wouldRecord, 1, "표에 있는 저확률 상품은 기록 후보여야 함");
  assertEq(r.candidates[0].sourceKey, "uid1::0", "sourceKey는 원본 그대로여야 함");
  assertEq(r.candidates[0].itemName, "❤️A단컷", "상품명 보존");
  assertEq(r.candidates[0].probability, 1, "확률은 현재 표의 값을 쓴다");
  assertEq(r.candidates[0].amountRangeLabel, "33", "금액대 라벨은 현재 표에서 채운다");
}

// 2) 이미 시트에 들어가 있는 기록은 건너뛴다(중복 기록 금지).
{
  const r = collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid1", "❤️A단컷", 1) }],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(["uid1::0"]),
  });
  assertEq(r.summary.wouldRecord, 0, "이미 기록된 건 후보에서 빠져야 함");
  assertEq(r.summary.alreadyRecorded, 1, "이미 기록된 건으로 세어야 함");
  assertEq(r.candidates.length, 0, "후보 목록도 비어야 함");
}

// 3) ★같은 결과가 여러 배치에 중복 캡처돼 있어도 후보는 1건뿐이어야 한다.
//    (배치를 하나씩 순서대로 돌리지 않으면 여기서 2건이 되어 시트에 두 번 들어간다)
{
  const r = collectRejudgeCandidates({
    batches: [
      { batchId: "b1", capture: capture("uid1", "❤️A단컷", 1) },
      { batchId: "b2", capture: capture("uid1", "❤️A단컷", 1) },
    ],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
  });
  assertEq(r.summary.wouldRecord, 1, "중복 캡처는 한 번만 기록 후보가 돼야 함");
  assertEq(r.summary.alreadyRecorded, 1, "두 번째 캡처는 중복으로 세어야 함");
  assertEq(r.candidates.length, 1, "후보도 1건");
}

// 4) 지금 표에도 없는 상품(이름 다름/사라진 룰렛)은 여전히 검토 필요로 남는다.
{
  const r = collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid9", "주둥이봉인 2분", 2) }],
    catalogItems: [item("주둥이봉인 2분 (윙크)", 2)], // 이름이 다르다
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
  });
  assertEq(r.summary.wouldRecord, 0, "이름이 다르면 기록하지 않는다");
  assertEq(r.summary.stillNeedsReview, 1, "검토 필요로 세어야 함");
}

// 5) 기준 확률을 넘는 상품은 제외된다(원래 업보가 아님).
{
  const r = collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid2", "배박수", 11) }],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
  });
  assertEq(r.summary.wouldRecord, 0, "기준 확률 초과는 기록하지 않는다");
  assertEq(r.summary.ignored, 1, "제외로 세어야 함");
}

// 6) 확정된 두배권 항목은 기록되지 않는다(기존 판정과 같은 취급).
{
  const doubleItem = item("다음 룰렛 2배", 1);
  const rules: SpecialItemRule[] = [
    {
      ruleKey: `33::${normalizeName("다음 룰렛 2배")}::1`,
      ruleType: "next_result_multiplier",
      status: "confirmed",
      multiplier: 2,
    },
  ];
  const r = collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid3", "다음 룰렛 2배", 1) }],
    catalogItems: [doubleItem],
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
    specialItemRules: rules,
  });
  assertEq(r.summary.wouldRecord, 0, "확정 두배권 항목 자체는 기록하지 않는다");
  assertEq(r.summary.ignored, 1, "두배권은 제외로 세어야 함");
}

// 7) ★두배권을 먼저 뽑았어도 뒤 결과에 배수가 붙지 않는다(재판정은 배수 미적용).
//    배수를 다시 계산하면 이미 소모된 두배가 두 번 적용될 수 있어서다.
{
  const doubleItem = item("다음 룰렛 2배", 1);
  const rules: SpecialItemRule[] = [
    {
      ruleKey: `33::${normalizeName("다음 룰렛 2배")}::1`,
      ruleType: "next_result_multiplier",
      status: "confirmed",
      multiplier: 2,
    },
  ];
  const r = collectRejudgeCandidates({
    batches: [
      { batchId: "b1", capture: capture("uid4", "다음 룰렛 2배", 1) },
      { batchId: "b2", capture: capture("uid5", "❤️A단컷", 1) },
    ],
    catalogItems: [doubleItem, item("❤️A단컷", 1)],
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
    specialItemRules: rules,
  });
  assertEq(r.summary.wouldRecord, 1, "두배권 다음 결과는 1건으로만 기록된다");
  assertEq(r.candidates[0].itemName, "❤️A단컷", "기록되는 건 두배권이 아니라 다음 결과");
}

// 8) 호출자가 넘긴 기존 키 집합을 오염시키지 않는다.
{
  const existing = new Set<string>();
  collectRejudgeCandidates({
    batches: [{ batchId: "b1", capture: capture("uid6", "❤️A단컷", 1) }],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: existing,
  });
  assertEq(existing.size, 0, "입력 Set은 그대로여야 함");
}

// 9) 원본이 깨진 배치가 섞여 있어도 나머지는 정상 처리된다.
{
  const r = collectRejudgeCandidates({
    batches: [
      { batchId: "bad", capture: null as unknown as RejudgeSourceBatch["capture"] },
      { batchId: "b1", capture: capture("uid7", "❤️A단컷", 1) },
    ],
    catalogItems: catalog,
    thresholdPercent: THRESHOLD,
    existingSourceKeys: new Set(),
  });
  assertEq(r.summary.wouldRecord, 1, "깨진 배치는 건너뛰고 나머지는 처리한다");
  assertEq(r.summary.batchCount, 1, "실제로 돌린 배치만 센다");
}

console.log("rejudge: 9개 통과");
