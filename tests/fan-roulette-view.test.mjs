import {
  shouldShowRouletteTabs,
  splitProbabilityFamilies,
} from "../lib/fanRouletteView.ts";

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 일반 룰렛 하나뿐이면 기존처럼 단순한 전체 화면을 유지한다.
assertEq(
  shouldShowRouletteTabs([{ key: "named:0" }]),
  false,
  "일반 룰렛 하나만 있으면 하위 탭을 숨김",
);

// 일반 룰렛이 하나여도 정가/기타가 함께 있으면 섞지 않고 별도 탭으로 보여야 한다.
assertEq(
  shouldShowRouletteTabs([{ key: "named:0" }, { key: "__fixed__" }]),
  true,
  "일반 룰렛 하나와 정가는 별도 탭으로 분리",
);
assertEq(
  shouldShowRouletteTabs([{ key: "named:0" }, { key: "__other__" }]),
  true,
  "일반 룰렛 하나와 기타는 별도 탭으로 분리",
);

// 기존 다중 룰렛 탭 동작은 유지한다.
assertEq(
  shouldShowRouletteTabs([{ key: "named:0" }, { key: "named:1" }]),
  true,
  "일반 룰렛 둘 이상이면 기존처럼 탭 표시",
);

// 실제 룰렛 없이 정가/기타만 있는 경우에는 불필요한 하위 탭을 만들지 않는다.
assertEq(
  shouldShowRouletteTabs([{ key: "__fixed__" }, { key: "__other__" }]),
  false,
  "정가와 기타만 있으면 기존 전체 화면 유지",
);

const groups = [
  {
    amountRangeLabel: "33~50",
    items: [
      { itemName: "A", probability: 1, enabled: true },
      { itemName: "B", probability: 2, enabled: true },
    ],
  },
  {
    amountRangeLabel: "330",
    enabled: false,
    items: [
      { itemName: "B", probability: 2, enabled: false },
      { itemName: "A", probability: 1, enabled: false },
    ],
  },
  {
    amountRangeLabel: "500",
    items: [
      { itemName: "A", probability: 3 },
      { itemName: "C", probability: 5 },
    ],
  },
  {
    amountRangeLabel: "300",
    items: [{ itemName: "D", probability: 7 }],
  },
];

const families = splitProbabilityFamilies(groups);
assertEq(
  families.map((family) => family.amountLabels),
  [["33~50", "330"], ["500"], ["300"]],
  "같은 전체 상품·확률표만 한 확률군으로 합침",
);
assertEq(
  families.map((family) => family.groups.length),
  [2, 1, 1],
  "33~50과 330만 같은 확률군",
);

// 금액명, 상품 순서, 사용 on/off는 확률군 경계를 바꾸지 않지만 확률 변경은 분리해야 한다.
assertEq(
  splitProbabilityFamilies([
    { amountRangeLabel: "33", items: [{ itemName: "A", probability: 1 }] },
    { amountRangeLabel: "330", items: [{ itemName: "A", probability: 9 }] },
  ]).length,
  2,
  "확률이 다르면 별도 확률군",
);

// 로케일 정렬에서 같게 취급되는 서로 다른 유니코드 이름도 입력 순서와 무관해야 한다.
assertEq(
  splitProbabilityFamilies([
    {
      amountRangeLabel: "33",
      items: [
        { itemName: "é", probability: 1 },
        { itemName: "é", probability: 1 },
      ],
    },
    {
      amountRangeLabel: "330",
      items: [
        { itemName: "é", probability: 1 },
        { itemName: "é", probability: 1 },
      ],
    },
  ]).length,
  1,
  "유니코드 이름도 상품 순서와 무관하게 같은 확률군",
);

console.log("fan roulette view: 9개 통과");
