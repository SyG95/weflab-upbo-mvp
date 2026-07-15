// 확률표 vs 실제 당첨 통계 (읽기 전용, 파생 계산).
//
// A안(sy 지침 2026-07-09): 룰렛 "결과" 데이터는 업보 파이프라인(upbo_entries=드롭 1건/행)에 있으므로
// 후원 레인이 아니라 검증실(/admin)에서 만든다. 여기서는 이미 읽어온 AdminDashboardData 만 쓰고,
// core 판정 로직·스키마·수집기·인증은 건드리지 않는다(순수 파생).
//
// 통계 원칙:
// - 확률은 "금액대(그룹)"마다 다르다(예: 꽝이 1000그룹 60% / 5000그룹 95%). 그래서 실제 당첨률은
//   반드시 같은 그룹 안에서(그룹 내 드롭 ÷ 그룹 총 드롭) 계산해 선언 확률과 1:1로 비교한다.
// - 표본이 작으면 편차가 크다 → 각 그룹·항목의 표본 수(n)를 항상 함께 노출한다(과대해석 방지).

import type { AdminDashboardData } from "./adminDashboard";

// 유의성 판정: 각 스핀이 확률표대로 독립 추첨이면 그룹 n스핀 중 해당 항목 관측수는 이항분포.
// 정규근사 조건(기대수 np≥5, n(1-p)≥5)을 만족할 때만 z-검정을 쓰고, |z|≥2면 "우연으로 보기
// 어려운 차이"로 본다. 조건 미달(주로 소표본)은 판단 보류 — 소표본의 출렁임을 이상으로 오인 금지.
export type ItemVerdict = "normal" | "high" | "low" | "insufficient";

export type ItemAccuracy = {
  itemName: string;
  declaredProb: number; // 확률표 선언 확률(%)
  actualCount: number; // 이 그룹에서 실제로 뜬 횟수
  actualPct: number; // actualCount ÷ 그룹 총 드롭 × 100
  deviation: number; // actualPct - declaredProb (%p, +면 더 잘 나옴)
  expected: number; // 확률표대로면 기대 횟수 (n × p)
  zScore: number; // 표준화 편차(정규근사). 판단 보류면 0.
  verdict: ItemVerdict; // 유의 판정
};

export type Anomaly = {
  groupLabel: string;
  itemName: string;
  declaredProb: number;
  actualPct: number;
  actualCount: number;
  totalDrops: number;
  zScore: number;
  direction: "high" | "low"; // high=실제가 유의하게 많음, low=적음
};

export type GroupAccuracy = {
  label: string; // 금액대 라벨(예: "1000")
  totalDrops: number; // 이 그룹의 총 드롭 수(표본)
  items: ItemAccuracy[]; // 확률표에 있는 항목(선언 vs 실제)
  unlisted: ItemAccuracy[]; // 확률표엔 없는데 실제로 뜬 항목
};

export type LuckRow = {
  fanKey: string;
  fanNickname: string;
  fanId: string;
  drops: number; // 확률이 있는 드롭 수
  avgProb: number; // 뽑은 상품들의 평균 선언 확률(낮을수록 귀한 것)
  rarest: { itemName: string; prob: number } | null; // 가장 귀한(최저 확률) 한 방
};

export type AccuracyStats = {
  available: boolean;
  catalogVersion: number | null;
  totalDrops: number;
  matchedDrops: number; // 확률표 그룹과 매칭된 드롭 수
  unmatchedDrops: number; // 금액대가 확률표에 없어 비교 못 한 드롭 수
  groups: GroupAccuracy[];
  luck: LuckRow[];
  anomalies: Anomaly[]; // 표본 충분 + |z|≥2 인 항목만(우연으로 보기 어려운 차이). |z| 큰 순.
};

const Z_THRESHOLD = 2; // |z|≥2 ≈ 유의수준 5% 양측

// 항목 하나의 유의성 판정. n=그룹 총 드롭, count=관측 횟수, declaredProb=선언 확률(%).
function judgeItem(count: number, n: number, declaredProb: number): { expected: number; zScore: number; verdict: ItemVerdict } {
  const p = declaredProb / 100;
  const expected = n * p;
  if (p <= 0 || p >= 1 || expected < 5 || n * (1 - p) < 5) {
    return { expected, zScore: 0, verdict: "insufficient" };
  }
  const z = (count - expected) / Math.sqrt(n * p * (1 - p));
  const verdict: ItemVerdict = z >= Z_THRESHOLD ? "high" : z <= -Z_THRESHOLD ? "low" : "normal";
  return { expected, zScore: z, verdict };
}

export function computeAccuracyStats(data: AdminDashboardData): AccuracyStats {
  const current = data.catalogs.find((c) => c.isCurrent) ?? data.catalogs[0] ?? null;
  const reflections = data.reflections;

  if (!current || reflections.length === 0) {
    return {
      available: false,
      catalogVersion: current?.version ?? null,
      totalDrops: reflections.length,
      matchedDrops: 0,
      unmatchedDrops: reflections.length,
      groups: [],
      luck: [],
      anomalies: [],
    };
  }

  // 금액대 라벨 → (아이템명 → 실제 드롭 수).
  const dropsByLabel = new Map<string, Map<string, number>>();
  for (const r of reflections) {
    const label = r.amountRangeLabel || "";
    if (!dropsByLabel.has(label)) dropsByLabel.set(label, new Map());
    const bucket = dropsByLabel.get(label)!;
    bucket.set(r.itemName, (bucket.get(r.itemName) ?? 0) + 1);
  }

  const groups: GroupAccuracy[] = [];
  let matchedDrops = 0;

  for (const g of current.groups) {
    const bucket = dropsByLabel.get(g.amountRangeLabel);
    if (!bucket) continue;
    const totalDrops = [...bucket.values()].reduce((sum, n) => sum + n, 0);
    if (totalDrops === 0) continue;
    matchedDrops += totalDrops;

    const declaredNames = new Set(g.items.map((it) => it.itemName));
    const items: ItemAccuracy[] = g.items
      .filter((it) => it.enabled)
      .map((it) => {
        const actualCount = bucket.get(it.itemName) ?? 0;
        const actualPct = (actualCount / totalDrops) * 100;
        const judged = judgeItem(actualCount, totalDrops, it.probability);
        return {
          itemName: it.itemName,
          declaredProb: it.probability,
          actualCount,
          actualPct,
          deviation: actualPct - it.probability,
          expected: judged.expected,
          zScore: judged.zScore,
          verdict: judged.verdict,
        };
      })
      .sort((a, b) => b.declaredProb - a.declaredProb);

    const unlisted: ItemAccuracy[] = [...bucket.entries()]
      .filter(([name]) => !declaredNames.has(name))
      .map(([name, count]) => ({
        itemName: name,
        declaredProb: 0,
        actualCount: count,
        actualPct: (count / totalDrops) * 100,
        deviation: (count / totalDrops) * 100,
        expected: 0,
        zScore: 0,
        verdict: "insufficient" as ItemVerdict,
      }))
      .sort((a, b) => b.actualCount - a.actualCount);

    groups.push({ label: g.amountRangeLabel || `그룹 ${g.groupIndex}`, totalDrops, items, unlisted });
  }

  // 행운 순위: 후원자별 "뽑은 상품들의 평균 선언 확률"(확률 있는 드롭만). 낮을수록 귀한 걸 뽑음.
  type FanAcc = { nickname: string; fanId: string; probs: number[]; rarest: { itemName: string; prob: number } | null };
  const byFan = new Map<string, FanAcc>();
  for (const r of reflections) {
    const key = r.fanId || r.fanNickname;
    if (!key) continue;
    const prob = Number(r.probability);
    if (!byFan.has(key)) byFan.set(key, { nickname: r.fanNickname, fanId: r.fanId, probs: [], rarest: null });
    const fan = byFan.get(key)!;
    if (Number.isFinite(prob) && prob > 0) {
      fan.probs.push(prob);
      if (!fan.rarest || prob < fan.rarest.prob) fan.rarest = { itemName: r.itemName, prob };
    }
  }
  const luck: LuckRow[] = [...byFan.entries()]
    .filter(([, fan]) => fan.probs.length > 0)
    .map(([key, fan]) => ({
      fanKey: key,
      fanNickname: fan.nickname,
      fanId: fan.fanId,
      drops: fan.probs.length,
      avgProb: fan.probs.reduce((sum, p) => sum + p, 0) / fan.probs.length,
      rarest: fan.rarest,
    }))
    .sort((a, b) => a.avgProb - b.avgProb || b.drops - a.drops);

  // 이상 항목: 표본 충분 + 유의(high/low)인 것만. |z| 큰 순으로.
  const anomalies: Anomaly[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (item.verdict === "high" || item.verdict === "low") {
        anomalies.push({
          groupLabel: group.label,
          itemName: item.itemName,
          declaredProb: item.declaredProb,
          actualPct: item.actualPct,
          actualCount: item.actualCount,
          totalDrops: group.totalDrops,
          zScore: item.zScore,
          direction: item.verdict,
        });
      }
    }
  }
  anomalies.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  return {
    available: groups.length > 0,
    catalogVersion: current.version,
    totalDrops: reflections.length,
    matchedDrops,
    unmatchedDrops: reflections.length - matchedDrops,
    groups,
    luck,
    anomalies,
  };
}
