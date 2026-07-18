import { parseWeflabTables } from "../lib/weflabPublicCatalog";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 위플랩 공개 페이지는 1,000 이상 금액을 쉼표로 렌더한다("1,000"). 쉼표 금액 표가
// min 토큰에서 빠지면 그 표의 상품들이 앞 표에 합쳐진다(파깡 실사고: 5표→2표).
function table(amountText: string, names: string[]): string {
  const items = names
    .map(
      (n) =>
        `<input type="text" value="${n}" class="input_text input_roulette_name" readonly>` +
        `<input type="text" value="1" class="input_text decimal right input_roulette_percent" readonly>`,
    )
    .join("");
  return `<p class="count"><span class='value min'>${amountText}</span>개</p>${items}`;
}

const html =
  table("100", ["a1", "a2"]) +
  table("1,000", ["b1", "b2", "b3"]) +
  table("300", ["c1"]) +
  table("3,000", ["d1"]) +
  table("5,000", ["e1"]);

const tables = parseWeflabTables(html);
assertEq(tables.length, 5, "쉼표 금액 포함 5개 표 전부 인식");
assertEq(
  tables.map((t) => t.amountMin),
  [100, 1000, 300, 3000, 5000],
  "쉼표 제거된 숫자 금액",
);
assertEq(
  tables.map((t) => t.items.length),
  [2, 3, 1, 1, 1],
  "상품이 자기 표에만 소속",
);

// min~max 범위 표기(쉼표 포함)도 같은 규칙으로 읽힌다.
const rangeHtml =
  `<p class="count"><span class='value min'>1,000</span>~<span class='value max'>4,999</span>개</p>` +
  `<input type="text" value="r1" class="input_text input_roulette_name" readonly>` +
  `<input type="text" value="1" class="input_text decimal right input_roulette_percent" readonly>`;
const rangeTables = parseWeflabTables(rangeHtml);
assertEq(rangeTables.length, 1, "범위 표 인식");
assertEq(rangeTables[0].amountMin, 1000, "범위 min");
assertEq(rangeTables[0].amountMax, 4999, "범위 max");

console.log("weflab-public-catalog-comma.test.ts OK");
