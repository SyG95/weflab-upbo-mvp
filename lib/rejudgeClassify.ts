// ---------- 후원 시점 근사 판정 결과 분류(1단계 묶음 3) — 순수 로직 ----------
//
// 🟢 = 아래 G1~G13 이 전부 참일 때만(PHASE1-DESIGN.md §5-3, 헤르메스 "착수 전 고칠 것 1"). 하나라도 거짓이거나
//      불명확하면 🟡 + 이유 한 줄. 🟢 도 1단계에서는 "기본 선택"일 뿐이고 넣기는 사람이 누른다(D1).
// ⚪ = 제외(그때 기준 초과·그때 꺼진 칸·두배권 칸·미션 정산). 판정 엔진(reconcileResults)의 결정은 바꾸지 않는다.
// 기준% 근사·두배권 꼬리표는 판정이 뒤집힐 수 있을 때만 단다(G6·G7 규칙, 조사 1 함정 5 — 꼬리표 남발 방지).

export type DonationTimeExcludeKind = "over_threshold" | "disabled_then" | "modifier" | "mission" | "policy";

export type DonationTimeFacts = {
  decision: "record" | "ignore" | "needs_review";
  excludeKind: DonationTimeExcludeKind | null;
  exactName: boolean; // G1 원문 상품명이 그때 칸 이름과 글자 그대로 같음
  probabilityKnown: boolean; // G2 확률이 1e-6 안에서 같음(원문 확률이 비면 엔진이 이름만으로 맞춤)
  amountKnown: boolean; // G3 후원 금액을 읽음(비면 엔진이 금액 범위 없이 맞춤)
  tableAmbiguity: "window" | "next_version" | "next_conflict" | "before_first" | null; // G4
  usageApproximate: boolean; // G5
  thresholdSafe: boolean; // G6
  multiplierRisk: boolean; // G7 이 시청자의 바로 앞 결과가 두배권이거나 앞 결과·순서를 확정할 수 없음, 또는 이름이 두배권 같음
  multiplierReason?: string | null; // G7 이유 문구(없으면 기본 문구)
  usageNotOwn: boolean; // G13a 그 표 자체의 저장 설정이 아니라 승계·기본값으로 계산됨
  laterTurnedOff: boolean; // G13b 후원 뒤 저장 설정에서 같은 칸(뒤 버전은 같은 금액대·이름)을 껐음
  fixedPriceCandidate: boolean; // G8
  timeKnown: boolean; // G9
  preReset: boolean; // G9
  keyUnstable: boolean; // G10
  fallbackKey: boolean; // G10 보강: 원본 고유번호 없는 결과(같은 초 같은 후원 2건이 1건으로 합쳐질 수 있음)
  manualOverlapSummary: string | null; // G11
  aliasUsed: boolean; // G12
  hiddenOnFan: boolean; // 꼬리표(분류는 안 바꿈)
};

export type DonationTimeClass = "green" | "yellow" | "grey" | "orange";

export type ClassifiedRow = {
  cls: DonationTimeClass;
  reasons: string[]; // 🟡 이유 전부(G 순서)
  reasonText: string; // 화면 한 줄
  tags: string[];
};

export const HIDDEN_ON_FAN_TAG = "넣어도 팬 화면엔 안 보여요(이 표 버전에서 꺼진 상품)";
const GREEN_TEXT = "그때 표·기준과 정확히 맞아요";

const AMBIGUITY_TEXT: Record<NonNullable<DonationTimeFacts["tableAmbiguity"]>, string> = {
  window: "그 무렵 룰렛표가 바뀌는 중이었어요",
  next_version: "그때 표엔 없고 다음 표와 맞아요(표가 바뀌는 중이었을 수 있어요)",
  next_conflict: "바로 다음 표로 판정하면 결과가 달라요(표가 바뀌던 때일 수 있어요)",
  before_first: "그때 룰렛표가 아직 저장돼 있지 않았어요",
};

const EXCLUDE_TEXT: Record<DonationTimeExcludeKind, string> = {
  over_threshold: "그때 기준확률보다 높아서 제외예요",
  disabled_then: "그때 '사용 안 함'으로 꺼 둔 상품이라 제외예요",
  modifier: "두배권 칸이라 제외예요",
  mission: "미션 정산 묶음(계정 없음)이라 제외예요",
  policy: "앞으로 제외하기로 정한 종류예요",
};

export function excludeReasonText(kind: DonationTimeExcludeKind): string {
  return EXCLUDE_TEXT[kind];
}

export function classifyDonationTimeRow(facts: DonationTimeFacts): ClassifiedRow {
  const tags = facts.hiddenOnFan ? [HIDDEN_ON_FAN_TAG] : [];
  if (facts.decision !== "record") {
    const reasonText = facts.excludeKind ? EXCLUDE_TEXT[facts.excludeKind] : "그때 표에서도 맞는 상품을 못 찾았어요";
    return { cls: "grey", reasons: [], reasonText, tags };
  }
  const reasons: string[] = [];
  // G13b 는 가짜 후보일 가능성이 가장 커서 맨 앞에 보여 준다(화면은 첫 이유만 크게 보인다).
  if (facts.laterTurnedOff) reasons.push("나중에 같은 이름 칸을 껐어요");
  // G12 를 쓴 건 이름이 원래 다르니 G1 을 따로 세지 않는다(같은 이유 두 번 방지).
  if (!facts.exactName && !facts.aliasUsed) reasons.push("상품 이름 표기가 표와 조금 달라요(띄어쓰기 등)");
  if (!facts.probabilityKnown) reasons.push("확률이 표와 달라요(원본에 확률이 없어요)");
  if (!facts.amountKnown) reasons.push("후원 금액을 읽지 못했어요");
  if (facts.tableAmbiguity) reasons.push(AMBIGUITY_TEXT[facts.tableAmbiguity]);
  if (facts.usageApproximate) reasons.push("그때 사용 설정을 정확히 알 수 없어요(승계 규칙 바뀐 배포 확인 전)");
  if (facts.usageNotOwn) reasons.push("이 표의 사용 설정이 저장되기 전이라 앞 표 설정으로 판단했어요");
  if (!facts.thresholdSafe) reasons.push("그때 기준확률이 확실하지 않아요");
  if (facts.multiplierRisk) reasons.push(facts.multiplierReason || "두배권이 있는 룰렛이라 2배 여부 확인이 필요해요");
  if (facts.fixedPriceCandidate) reasons.push("정가 금액과 같아요");
  if (!facts.timeKnown) reasons.push("후원 시각을 읽지 못했어요");
  else if (facts.preReset) reasons.push("데이터 초기화 전 기록이라 그때 설정 이력이 없을 수 있어요");
  if (facts.keyUnstable) reasons.push("같은 기록이 다른 상품으로 잡힌 적이 있어요");
  if (facts.fallbackKey) reasons.push("원본 고유번호가 없는 기록이에요(같은 시각 같은 후원이 합쳐졌을 수 있어요)");
  if (facts.manualOverlapSummary) reasons.push(`수동기록과 같은 건일 수 있어요: ${facts.manualOverlapSummary}`);
  if (facts.aliasUsed) reasons.push("이름 연결로 맞춘 상품이에요");
  return {
    cls: reasons.length === 0 ? "green" : "yellow",
    reasons,
    reasonText: reasons[0] ?? GREEN_TEXT,
    tags,
  };
}
