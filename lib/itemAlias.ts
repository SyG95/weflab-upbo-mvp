// ---------- 이름 연결(별칭) — 순수 로직 ----------
//
// 왜 필요한가:
//   룰렛표에서 상품 이름이 바뀌면(예: 💙얼낙즉방 → 💜얼낙즉방) 판정이 옛 결과를 못 찾는다.
//   판정은 (금액대 + 상품명 + 확률)이 전부 정확히 맞아야 성립하므로, 이모지 한 글자만
//   달라도 전부 "검토 필요"로 빠진다. 실제로 채루 시트에서 7월 14건이 이 이유로 누락됐다.
//   → "예전 이 상품 = 지금 표의 이 상품"을 사람이 한 번 이어주면, 재판정이 알아서 찾는다.
//
// 설계 원칙:
//   - 원본(raw_imports)과 확률표(catalogs)는 절대 건드리지 않는다. 그 위에 얹는 연결표다.
//   - 자동 연결은 하지 않는다. 추천만 하고, 최종 확정은 항상 사람이 누른다.
//     (이름이 비슷하다고 자동으로 이으면 다른 상품을 잘못 기록할 수 있다)
//   - 판정 엔진(reconcileResults/findCatalogMatch)은 수정하지 않는다. 판정에 넣기 직전
//     결과의 상품명·확률만 "지금 표의 값"으로 바꿔서 넘긴다.

import { cleanText, normalizeName, type NormalizedCatalogItem, type NormalizedResult } from "./upboCore";

// 이름 하나를 "이모지·기호·공백 뺀 알맹이"로 줄인다. 추천용 비교에만 쓴다.
// 💙얼낙즉방 → 얼낙즉방, ☁️애교/매도 → 애교/매도
export function itemNameCore(value: unknown): string {
  const text = cleanText(value)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "");
  return normalizeName(text);
}

// 연결 키: 어떤 금액대의 어떤 이름·확률이었는지로 특정한다.
// 같은 이름이라도 룰렛(금액대)이나 확률이 다르면 다른 상품이므로 전부 키에 넣는다.
export function aliasKey(amountLabel: string, itemName: string, probability: number | null): string {
  const prob = probability === null || probability === undefined ? "" : String(probability);
  return `${cleanText(amountLabel)}::${normalizeName(itemName)}::${prob}`;
}

export type ItemAlias = {
  // 연결 대상 = 지금 확률표의 상품(그 상품의 이름과 확률로 판정한다)
  itemName: string;
  probability: number;
  // "업보 아님"으로 덮어둔 것(연결하지 않고 목록에서 치운다)
  ignored?: boolean;
};

export type ItemAliasMap = Record<string, ItemAlias>;

// 미기록 결과 한 묶음(같은 금액대·이름·확률끼리 묶어 보여준다).
export type AliasCandidate = {
  key: string;
  amountLabel: string;
  itemName: string;
  probability: number | null;
  count: number; // 이 이름으로 빠진 결과가 몇 건인지
  firstAt: string;
  lastAt: string;
  // 지금 표에서 고를 수 있는 상품들(같은 금액대, 켜져 있는 것만)
  // thresholdOverridePercent: 이 상품이 속한 룰렛표의 기준확률 예외(applyThresholdOverrides가 얹은 값).
  options: Array<{ itemName: string; probability: number; recommended: boolean; reason?: string; thresholdOverridePercent?: number | null }>;
  linked?: ItemAlias; // 이미 연결해 둔 것
  // 추천대로 연결하면 실제로 업보로 기록되는가(추천 상품 확률이 기준 이하인가).
  // 확률이 높은 리액션(뽀뽀·사랑해 등)은 연결해도 기록되지 않으므로 뒤로 보낸다.
  wouldRecord: boolean;
};

function amountLabelOf(result: NormalizedResult, catalogItems: NormalizedCatalogItem[]): string {
  const amount = result.donationAmount;
  if (amount === null || amount === undefined) return "";
  const hit = catalogItems.find(
    (item) => item.amountMin !== null && item.amountMax !== null && amount >= item.amountMin && amount <= item.amountMax,
  );
  return hit?.amountRangeLabel || String(amount);
}

// 추천은 "그림문자·공백만 다른 완전 일치"에만 붙인다.
// ★부분 일치(뽀뽀 ⊂ 채루 뽀뽀 폭탄)는 추천하지 않는다 — 다른 상품을 잘못 잇게 만든다.
//   선택지에는 남겨 두어 스트리머가 직접 고를 수는 있게 한다.
function buildOptions(
  result: NormalizedResult,
  catalogItems: NormalizedCatalogItem[],
): AliasCandidate["options"] {
  const amount = result.donationAmount;
  const sameAmount = catalogItems.filter(
    (item) =>
      item.enabled !== false &&
      item.amountMin !== null &&
      item.amountMax !== null &&
      amount !== null &&
      amount >= item.amountMin &&
      amount <= item.amountMax,
  );
  const core = itemNameCore(result.itemName);
  const options = sameAmount.map((item) => {
    const itemCore = itemNameCore(item.itemName);
    let recommended = false;
    let reason: string | undefined;
    if (core && itemCore === core) {
      recommended = true;
      reason = normalizeName(item.itemName) === normalizeName(result.itemName)
        ? "이름이 같아요 (확률만 바뀜)"
        : "이름이 같아요 (그림문자만 다름)";
    } else if (core && itemCore && (itemCore.includes(core) || core.includes(itemCore))) {
      // 비슷하긴 하나 다른 상품일 수 있다 → 추천하지 않고 순서만 위로 올린다.
      reason = "이름이 비슷해요 (직접 확인하세요)";
    }
    return { itemName: item.itemName, probability: item.probability, recommended, reason, thresholdOverridePercent: item.thresholdOverridePercent };
  });
  // 추천 → 비슷한 것 → 나머지, 각 그룹 안에서는 확률 낮은 순(업보일 가능성이 높은 것부터)
  options.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    if (!!a.reason !== !!b.reason) return a.reason ? -1 : 1;
    return a.probability - b.probability;
  });
  return options;
}

// 아직 시트에 안 들어간 결과들을 "이름 묶음"으로 정리한다.
// 이미 지금 표로 정확히 매칭되는 것은 연결이 필요 없으므로 호출자가 미리 걸러서 넘긴다.
export function buildAliasCandidates({
  results,
  catalogItems,
  aliases = {},
  maxGroups = 200,
  thresholdPercent = 2,
}: {
  results: NormalizedResult[];
  catalogItems: NormalizedCatalogItem[];
  aliases?: ItemAliasMap;
  maxGroups?: number;
  thresholdPercent?: number;
}): AliasCandidate[] {
  const byKey = new Map<string, AliasCandidate>();
  // ★같은 당첨이 여러 배치에 중복 캡처돼 있다. 건수는 반드시 sourceKey 기준으로 센다.
  //   행 수로 세면 "4건 들어와요"라고 해놓고 1건만 들어가는 일이 생긴다.
  const countedSourceKeys = new Set<string>();
  for (const result of results) {
    if (countedSourceKeys.has(result.sourceKey)) continue;
    countedSourceKeys.add(result.sourceKey);
    const amountLabel = amountLabelOf(result, catalogItems);
    const key = aliasKey(amountLabel, result.itemName, result.probability);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (result.donateTimeText && result.donateTimeText < existing.firstAt) existing.firstAt = result.donateTimeText;
      if (result.donateTimeText && result.donateTimeText > existing.lastAt) existing.lastAt = result.donateTimeText;
      continue;
    }
    const options = buildOptions(result, catalogItems);
    const best = options.find((option) => option.recommended);
    byKey.set(key, {
      key,
      amountLabel,
      itemName: result.itemName,
      probability: result.probability,
      count: 1,
      firstAt: result.donateTimeText || "",
      lastAt: result.donateTimeText || "",
      options,
      linked: aliases[key],
      // 룰렛표별 기준확률 예외가 있으면 그 기준으로(판정과 동일 규칙: override ?? 전역).
      wouldRecord: best ? best.probability <= (best.thresholdOverridePercent ?? thresholdPercent) : false,
    });
  }
  // ★"연결하면 실제로 업보가 되는 것"을 맨 위로. 그다음 추천 있는 것, 그다음 건수 순.
  //   건수만으로 줄 세우면 뽀뽀·사랑해 같은 고확률 리액션이 위를 다 차지해서
  //   정작 고쳐야 할 단컷·네컷이 아래로 밀린다(실제로 그렇게 됐었다).
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.wouldRecord !== b.wouldRecord) return a.wouldRecord ? -1 : 1;
      const aRec = a.options.some((option) => option.recommended);
      const bRec = b.options.some((option) => option.recommended);
      if (aRec !== bRec) return aRec ? -1 : 1;
      return b.count - a.count || a.itemName.localeCompare(b.itemName);
    })
    .slice(0, maxGroups);
}

// 판정에 넣기 직전, 연결해 둔 결과의 상품명·확률을 "지금 표의 값"으로 바꾼다.
// ★sourceKey 는 절대 바꾸지 않는다(이미 계산돼 있고, 바뀌면 중복 방지가 깨진다).
export function applyItemAliases(
  results: NormalizedResult[],
  catalogItems: NormalizedCatalogItem[],
  aliases: ItemAliasMap,
): NormalizedResult[] {
  const keys = Object.keys(aliases);
  if (keys.length === 0) return results; // 연결이 없으면 원본 배열 그대로(기존 동작과 100% 동일)
  return results.map((result) => {
    const amountLabel = amountLabelOf(result, catalogItems);
    const alias = aliases[aliasKey(amountLabel, result.itemName, result.probability)];
    if (!alias || alias.ignored) return result;
    return {
      ...result,
      itemName: alias.itemName,
      normalizedName: normalizeName(alias.itemName),
      probability: alias.probability,
    };
  });
}

// 저장 전 검증: 키 형식과 값이 멀쩡한 것만 남긴다.
export function cleanAliasMap(value: unknown, maxKeys = 500): ItemAliasMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ItemAliasMap = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= maxKeys) break;
    if (!key || key.length > 300 || !key.includes("::")) continue;
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (entry.ignored === true) {
      out[key] = { itemName: "", probability: 0, ignored: true };
      count += 1;
      continue;
    }
    const itemName = cleanText(entry.itemName);
    const probability = Number(entry.probability);
    if (!itemName || !Number.isFinite(probability) || probability < 0) continue;
    out[key] = { itemName, probability };
    count += 1;
  }
  return out;
}
