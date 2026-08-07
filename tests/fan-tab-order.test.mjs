import { matchFanTabOrderIndex } from "../lib/api.ts";

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 저장된 팬 탭 순서(드래그) — 이름과 같은 지문 매칭 규칙(전체 커버 + 자카드 ≥ 0.5).
const order = [
  { kind: "fixed" },
  { kind: "tab", groups: [["곰인형", "쿠션"]] },
  { kind: "tab", groups: [["키링", "스티커"], ["포토카드"]] },
  { kind: "other" },
];

// 같은 지문의 탭은 저장된 자리를 그대로 찾는다.
assertEq(matchFanTabOrderIndex([["곰인형", "쿠션"]], order), 1, "동일 지문 → 저장 자리");
assertEq(
  matchFanTabOrderIndex([["키링", "스티커"], ["포토카드"]], order),
  2,
  "멤버 그룹 여러 개인 탭도 전체 커버로 매칭",
);

// 상품이 절반 이상 겹치면(자카드 ≥ 0.5) 새 캡처에도 자리가 따라온다.
assertEq(
  matchFanTabOrderIndex([["곰인형", "쿠션", "신상굿즈"]], order),
  1,
  "구성이 비슷하면(2/3 겹침) 자리 유지",
);

// 절반 이상 바뀌면 순서가 풀린다(이름과 같은 규칙) → 미배치로 뒤(가나다순)로 간다.
assertEq(
  matchFanTabOrderIndex([["전혀", "다른", "상품", "들"]], order),
  undefined,
  "구성이 절반 이상 바뀌면 미배치",
);

// 일부 멤버 그룹만 덮는 항목은 whole 이 아니므로 매칭하지 않는다.
assertEq(
  matchFanTabOrderIndex([["곰인형", "쿠션"], ["전혀다른"]], order),
  undefined,
  "부분 커버는 매칭 안 함",
);

// 여러 항목이 덮으면 지문 그룹 수가 많은(더 구체적인) 항목 우선 — matchFanTabLabelWhole 과 동일.
const dupOrder = [
  { kind: "tab", groups: [["포토카드"]] },
  { kind: "tab", groups: [["키링", "스티커"], ["포토카드"]] },
];
assertEq(
  matchFanTabOrderIndex([["포토카드"]], dupOrder),
  1,
  "여러 항목이 덮으면 지문 그룹 수 많은 항목 우선(이름 규칙과 동일)",
);
assertEq(
  matchFanTabOrderIndex([["키링", "스티커"], ["포토카드"]], dupOrder),
  1,
  "전체를 덮는 더 구체적인 항목 우선",
);

// kind: fixed/other 항목은 지문 매칭 대상이 아니다(빈 순서/비룰렛만 있는 순서 → 미배치).
assertEq(matchFanTabOrderIndex([["곰인형"]], []), undefined, "빈 순서 → 미배치");
assertEq(
  matchFanTabOrderIndex([["곰인형"]], [{ kind: "fixed" }, { kind: "other" }]),
  undefined,
  "정가/기타만 있는 순서 → 룰렛 탭은 미배치",
);

console.log("fan tab order: 9개 통과");
