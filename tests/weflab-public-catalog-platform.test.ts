import { parseWeflabTables } from "../lib/weflabPublicCatalog";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// 숲+치지직 동시송출 계정의 공개 페이지는 표마다 "후원 개수"를 플랫폼별로 나란히 렌더한다:
// 숲(platform_afreeca, 별풍선) 다음에 치지직(platform_naver, 치즈=별풍선×100).
// 치지직 값을 min 으로 읽으면 표가 쪼개지고 상품들이 치즈 단위(100배) 표에 붙는
// 대형 오류가 난다(리루리 실사고 2026-08-03: 표 8개 전부 치즈 단위로 저장).
function items(names: string[]): string {
  return names
    .map(
      (n) =>
        `<input type="text" value="${n}" class="input_text input_roulette_name" readonly>` +
        `<input type="text" value="1" class="input_text decimal right input_roulette_percent" readonly>`,
    )
    .join("");
}

function platformCount(platform: string, amountText: string): string {
  return (
    `<p class="count platform_area platform_${platform}">` +
    `<span class="icon_platform ${platform}"></span><span class='value min'>${amountText}</span>개</p>`
  );
}

// 리루리형: 숲/치지직 쌍 표기 표 2개. 숲 값만 기준값으로 채택돼야 한다.
const dualHtml =
  platformCount("afreeca", "33") + platformCount("naver", "3,300") + items(["a1", "a2"]) +
  platformCount("afreeca", "1,620") + platformCount("naver", "162,000") + items(["b1"]);
const dualTables = parseWeflabTables(dualHtml);
assertEq(dualTables.length, 2, "동시송출: 쌍 표기가 표를 쪼개지 않는다");
assertEq(dualTables.map((t) => t.amountMin), [33, 1620], "동시송출: 숲(별풍선) 값 채택");
assertEq(dualTables.map((t) => t.items.length), [2, 1], "동시송출: 상품이 자기 표에 소속");

// 포로미형: 숲 단독 계정도 platform_afreeca 라벨은 붙는다 — 기존과 동일하게 동작해야 한다.
const soopOnlyHtml = platformCount("afreeca", "1,000") + items(["p1", "p2"]);
const soopOnlyTables = parseWeflabTables(soopOnlyHtml);
assertEq(soopOnlyTables.length, 1, "숲 단독: 표 인식");
assertEq(soopOnlyTables[0].amountMin, 1000, "숲 단독: min 값");

// 치지직 전용 표가 숲 표 뒤에 오는 경우: 그 표의 상품이 앞 숲 표로 새면 안 된다.
const naverOnlyAfterHtml =
  platformCount("afreeca", "100") + items(["s1"]) +
  platformCount("naver", "5,000") + items(["c1", "c2"]);
const naverOnlyTables = parseWeflabTables(naverOnlyAfterHtml);
assertEq(naverOnlyTables.length, 1, "치지직 전용 표는 채택 안 됨");
assertEq(naverOnlyTables[0].items.length, 1, "치지직 표 상품이 앞 숲 표에 안 붙음");

// 라벨 있는 범위 표기(min~max)도 숲 값은 그대로 읽힌다.
const rangeHtml =
  `<p class="count platform_area platform_afreeca"><span class="icon_platform afreeca"></span>` +
  `<span class='value min'>1,000</span>~<span class='value max'>4,999</span>개</p>` +
  `<p class="count platform_area platform_naver"><span class="icon_platform naver"></span>` +
  `<span class='value min'>100,000</span>~<span class='value max'>499,900</span>개</p>` +
  items(["r1"]);
const rangeTables = parseWeflabTables(rangeHtml);
assertEq(rangeTables.length, 1, "범위 쌍 표기: 표 1개");
assertEq(rangeTables[0].amountMin, 1000, "범위: 숲 min");
assertEq(rangeTables[0].amountMax, 4999, "범위: 숲 max (치지직 max 무시)");

console.log("weflab-public-catalog-platform.test.ts OK");
