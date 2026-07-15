export type RouletteTabPart = { key: string };

// 일반 룰렛이 둘 이상이면 기존처럼 탭을 보여준다.
// 일반 룰렛이 하나뿐이어도 정가/기타가 함께 있으면 한 화면에 섞지 않고 분리한다.
export function shouldShowRouletteTabs(parts: readonly RouletteTabPart[]): boolean {
  const realCount = parts.filter((part) => part.key !== "__fixed__" && part.key !== "__other__").length;
  const hasSupplemental = parts.some((part) => part.key === "__fixed__" || part.key === "__other__");
  return realCount >= 2 || (realCount === 1 && hasSupplemental);
}

export type ProbabilityFamilyItem = {
  itemName: string;
  probability: number;
};

export type ProbabilityFamilyGroup = {
  amountRangeLabel?: string;
  items?: readonly ProbabilityFamilyItem[];
};

export type ProbabilityFamily<G extends ProbabilityFamilyGroup = ProbabilityFamilyGroup> = {
  signature: string;
  amountLabels: string[];
  groups: G[];
};

// 금액명·순서·사용 on/off가 아니라 전체 상품명+확률 구성이 같을 때만 같은 실제 확률군이다.
export function probabilityFamilySignature(group: ProbabilityFamilyGroup): string {
  const rows = (group.items ?? [])
    .filter((item) => Boolean(item.itemName))
    .map((item) => [item.itemName, Number(item.probability)] as const)
    .sort(([nameA, probA], [nameB, probB]) =>
      nameA < nameB ? -1 : nameA > nameB ? 1 : probA - probB,
    );
  return JSON.stringify(rows);
}

export function splitProbabilityFamilies<G extends ProbabilityFamilyGroup>(
  groups: readonly G[],
): ProbabilityFamily<G>[] {
  const bySignature = new Map<string, ProbabilityFamily<G>>();
  for (const group of groups) {
    const signature = probabilityFamilySignature(group);
    let family = bySignature.get(signature);
    if (!family) {
      family = { signature, amountLabels: [], groups: [] };
      bySignature.set(signature, family);
    }
    family.groups.push(group);
    const amountLabel = group.amountRangeLabel ? String(group.amountRangeLabel) : "";
    if (amountLabel && !family.amountLabels.includes(amountLabel)) family.amountLabels.push(amountLabel);
  }
  return Array.from(bySignature.values());
}
