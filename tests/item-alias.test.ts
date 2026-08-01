import {
  aliasKey,
  applyItemAliases,
  buildAliasCandidates,
  cleanAliasMap,
  itemNameCore,
} from "../lib/itemAlias";
import { collectRejudgeCandidates } from "../lib/rejudge";
import { normalizeName, normalizeResultCapture, type NormalizedCatalogItem } from "../lib/upboCore";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function item(itemName: string, probability: number, amount = 175): NormalizedCatalogItem {
  return {
    groupIndex: 0, amountMin: amount, amountMax: amount, amountRangeLabel: String(amount),
    enabled: true, doubleEnabled: false, itemName, normalizedName: normalizeName(itemName),
    probability, sortOrder: 0, raw: null,
  };
}
function capture(uid: string, itemName: string, probability: number, amount = 175) {
  return {
    capturedAt: "2026-07-05T00:00:00.000Z",
    rows: [{
      sourceUid: uid, donateTimeText: "2026-07-05 16:45:29", donationType: "별풍선",
      donationAmount: amount, fanNickname: "흑설", fanId: "n11appless",
      results: [{ name: itemName, probability, index: 0, total: 1 }],
    }],
  };
}

// 1) 그림문자만 다른 이름은 같은 알맹이로 읽힌다 — 추천의 근거.
assertEq(itemNameCore("💙얼낙즉방"), itemNameCore("💜얼낙즉방"), "이모지만 다른 이름은 같은 알맹이여야 함");
assertEq(itemNameCore("❤️A단컷"), "a단컷", "이모지·공백 제거");
assertEq(itemNameCore("☁️애교/매도"), "애교/매도", "슬래시는 남긴다(다른 상품과 구분)");
if (itemNameCore("💙C단컷") === itemNameCore("💙D단컷")) throw new Error("다른 상품이 같은 알맹이면 안 됨");

// 2) 연결 키는 금액대·이름·확률을 모두 담는다(같은 이름 다른 룰렛/확률 구분).
if (aliasKey("175", "💙C단컷", 1) === aliasKey("175", "💙C단컷", 3.5)) throw new Error("확률이 다르면 다른 키여야 함");
if (aliasKey("175", "💙C단컷", 1) === aliasKey("100", "💙C단컷", 1)) throw new Error("금액대가 다르면 다른 키여야 함");

const catalog = [item("💜얼낙즉방", 5), item("💜C단컷", 3.5), item("💜손편지", 0.1)];

// 3) 못 찾은 결과를 이름 묶음으로 모으고, 그림문자만 다른 상품을 추천한다.
{
  const results = [
    ...normalizeResultCapture(capture("u1", "💙얼낙즉방", 5)).results,
    ...normalizeResultCapture(capture("u2", "💙얼낙즉방", 5)).results,
    ...normalizeResultCapture(capture("u3", "💙C단컷", 1)).results,
  ];
  const groups = buildAliasCandidates({ results, catalogItems: catalog });
  assertEq(groups.length, 2, "같은 이름·확률끼리 한 묶음이어야 함");
  assertEq(groups[0].count, 2, "건수 많은 묶음이 먼저");
  assertEq(groups[0].itemName, "💙얼낙즉방", "원래 이름을 그대로 보여준다");
  const rec = groups[0].options.find((o) => o.recommended);
  assertEq(rec?.itemName, "💜얼낙즉방", "그림문자만 다른 상품을 추천해야 함");
  assertEq(groups[0].options[0].recommended, true, "추천이 목록 맨 위");
  const cRec = groups[1].options.find((o) => o.recommended);
  assertEq(cRec?.itemName, "💜C단컷", "확률이 달라도 이름이 같으면 추천한다");
}

// 4) 연결하면 판정에 넘길 때 이름·확률이 지금 표 값으로 바뀐다. sourceKey 는 그대로.
{
  const results = normalizeResultCapture(capture("u9", "💙C단컷", 1)).results;
  const before = results[0].sourceKey;
  const aliases = { [aliasKey("175", "💙C단컷", 1)]: { itemName: "💜C단컷", probability: 3.5 } };
  const after = applyItemAliases(results, catalog, aliases);
  assertEq(after[0].itemName, "💜C단컷", "이름이 바뀌어야 함");
  assertEq(after[0].probability, 3.5, "확률도 지금 표 값으로");
  assertEq(after[0].sourceKey, before, "★sourceKey 는 절대 바뀌면 안 됨(중복 방지가 깨진다)");
  assertEq(results[0].itemName, "💙C단컷", "원본 배열은 그대로(불변)");
}

// 5) 연결이 없으면 원본 배열을 그대로 돌려준다(기존 동작과 100% 동일).
{
  const results = normalizeResultCapture(capture("u8", "💙C단컷", 1)).results;
  if (applyItemAliases(results, catalog, {}) !== results) throw new Error("빈 연결표는 원본 참조 그대로여야 함");
}

// 6) "업보 아님"으로 덮은 것은 치환하지 않는다.
{
  const results = normalizeResultCapture(capture("u7", "💙C단컷", 1)).results;
  const aliases = { [aliasKey("175", "💙C단컷", 1)]: { itemName: "", probability: 0, ignored: true } };
  assertEq(applyItemAliases(results, catalog, aliases)[0].itemName, "💙C단컷", "무시한 것은 그대로 둔다");
}

// 7) ★통합: 연결 전에는 못 찾고, 연결 후에는 기록된다.
{
  const batches = [{ batchId: "b1", capture: capture("uX", "💙C단컷", 1) }];
  const before = collectRejudgeCandidates({
    batches, catalogItems: catalog, thresholdPercent: 5, existingSourceKeys: new Set(),
  });
  assertEq(before.summary.wouldRecord, 0, "연결 전에는 못 찾는다");
  assertEq(before.summary.stillNeedsReview, 1, "검토 필요로 남는다");
  assertEq(before.unmatched[0].itemName, "💙C단컷", "연결 화면에는 원래 이름을 넘긴다");

  const after = collectRejudgeCandidates({
    batches, catalogItems: catalog, thresholdPercent: 5, existingSourceKeys: new Set(),
    aliases: { [aliasKey("175", "💙C단컷", 1)]: { itemName: "💜C단컷", probability: 3.5 } },
  });
  assertEq(after.summary.wouldRecord, 1, "연결하면 기록 대상이 된다");
  assertEq(after.candidates[0].itemName, "💜C단컷", "지금 표 이름으로 기록된다");
  assertEq(after.candidates[0].probability, 3.5, "확률도 지금 표 값");
  assertEq(after.candidates[0].sourceKey, "uX::0", "sourceKey 는 원본 그대로");
}

// 8) 연결해도 기준 확률을 넘으면 기록하지 않는다(연결이 판정 규칙을 우회하지 않는다).
{
  const batches = [{ batchId: "b1", capture: capture("uY", "💙배박수", 10) }];
  const r = collectRejudgeCandidates({
    batches, catalogItems: [item("💜배박수", 11)], thresholdPercent: 5, existingSourceKeys: new Set(),
    aliases: { [aliasKey("175", "💙배박수", 10)]: { itemName: "💜배박수", probability: 11 } },
  });
  assertEq(r.summary.wouldRecord, 0, "기준 초과는 연결해도 기록하지 않는다");
  assertEq(r.summary.ignored, 1, "제외로 센다");
}

// 9) ★건수는 sourceKey 기준으로 센다 — 같은 당첨이 여러 배치에 중복 캡처돼 있기 때문.
//    행 수로 세면 "4건 들어와요" 해놓고 1건만 들어가는 일이 생긴다.
{
  const one = normalizeResultCapture(capture("dup1", "💙얼낙즉방", 5)).results;
  const results = [...one, ...one, ...one, ...normalizeResultCapture(capture("dup2", "💙얼낙즉방", 5)).results];
  const groups = buildAliasCandidates({ results, catalogItems: catalog, thresholdPercent: 5 });
  assertEq(groups[0].count, 2, "중복 캡처는 한 건으로 세어야 함(행 4개 → 당첨 2건)");
}

// 10) 정렬: 이어 주면 업보가 되는 것이 건수 많은 리액션보다 위로 온다.
{
  const many = Array.from({ length: 50 }, (_, i) => normalizeResultCapture(capture(`hi${i}`, "채루 뽀뽀 폭탄", 16)).results[0]);
  const few = normalizeResultCapture(capture("low1", "💙손편지", 0.1)).results;
  const groups = buildAliasCandidates({ results: [...many, ...few], catalogItems: catalog, thresholdPercent: 5 });
  assertEq(groups[0].itemName, "💙손편지", "업보가 될 것이 맨 위여야 함");
  assertEq(groups[0].wouldRecord, true, "업보 여부 표시");
  assertEq(groups[1].wouldRecord, false, "고확률 리액션은 뒤로");
  // 부분 일치(뽀뽀 ⊂ 채루 뽀뽀 폭탄)는 추천하지 않는다 — 다른 상품을 잘못 잇게 된다.
  assertEq(groups[1].options.some((o) => o.recommended), false, "부분 일치는 추천하지 않는다");
}

// 11) 저장 전 검증: 망가진 값은 버린다.
{
  const cleaned = cleanAliasMap({
    "175::a::1": { itemName: "💜A", probability: 2 },
    "나쁜키": { itemName: "X", probability: 1 },
    "175::b::1": { itemName: "", probability: 1 },
    "175::c::1": { itemName: "Y", probability: -3 },
    "175::d::1": { ignored: true },
  });
  assertEq(Object.keys(cleaned).sort(), ["175::a::1", "175::d::1"], "형식이 맞는 것만 남긴다");
  assertEq(cleaned["175::d::1"].ignored, true, "무시 표시는 보존");
}

console.log("item-alias: 11개 통과");
