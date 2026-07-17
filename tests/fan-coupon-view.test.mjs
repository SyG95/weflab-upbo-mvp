import { groupFanCoupons, filterFanCoupons } from "../lib/fanCouponView.ts";

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

const b = (viewerKey, nickname, accountId, itemName, balance) => ({
  viewerKey,
  nickname,
  accountId,
  itemName,
  balance,
});

// 1) 같은 시청자로 묶고, 종류는 잔액 많은 순, 시청자는 합계 많은 순.
{
  const rows = [
    b("v1", "가나", "id_a", "치킨쿠폰", 2),
    b("v1", "가나", "id_a", "커피쿠폰", 5),
    b("v2", "다라", "id_b", "치킨쿠폰", 3),
  ];
  const grouped = groupFanCoupons(rows);
  assertEq(
    grouped.map((v) => [v.key, v.total, v.coupons.map((c) => `${c.itemName}x${c.balance}`)]),
    [
      ["v1", 7, ["커피쿠폰x5", "치킨쿠폰x2"]],
      ["v2", 3, ["치킨쿠폰x3"]],
    ],
    "시청자별 묶기 + 잔액순/합계순 정렬",
  );
}

// 2) 잔액 0(다 쓴 쿠폰)은 유지하고(화면에서 "사용완료" 표기), 음수만 방어적으로 제외한다.
//    전부 0인 시청자는 합계 0이라 정렬에서 뒤로 간다.
{
  const rows = [
    b("v1", "가나", "id_a", "치킨쿠폰", 0),
    b("v1", "가나", "id_a", "커피쿠폰", -3),
    b("v2", "다라", "id_b", "치킨쿠폰", 1),
  ];
  const grouped = groupFanCoupons(rows);
  assertEq(
    grouped.map((v) => [v.key, v.total, v.coupons]),
    [
      ["v2", 1, [{ itemName: "치킨쿠폰", balance: 1 }]],
      ["v1", 0, [{ itemName: "치킨쿠폰", balance: 0 }]],
    ],
    "0은 유지(사용완료 표기용)·음수만 제외, 전부 0인 시청자는 뒤로",
  );
}

// 3) 같은 (시청자,종류)가 여러 행으로 와도 방어적으로 합산.
{
  const rows = [
    b("v1", "가나", "id_a", "치킨쿠폰", 2),
    b("v1", "가나", "id_a", "치킨쿠폰", 3),
  ];
  const grouped = groupFanCoupons(rows);
  assertEq(
    [grouped[0].total, grouped[0].coupons],
    [5, [{ itemName: "치킨쿠폰", balance: 5 }]],
    "같은 종류 중복 행 합산",
  );
}

// 4) 닉네임이 빈 행이 먼저 와도, 뒤 행의 닉네임으로 채운다.
{
  const rows = [
    b("v1", "", "id_a", "치킨쿠폰", 1),
    b("v1", "가나", "id_a", "커피쿠폰", 1),
  ];
  assertEq(groupFanCoupons(rows)[0].nickname, "가나", "빈 닉네임은 뒤 행 값으로 보정");
}

// 5) 검색: 닉네임/계정ID 부분일치, 대소문자 무시. 빈 검색어는 전체.
{
  const grouped = groupFanCoupons([
    b("v1", "AikoFan", "id_apple", "치킨쿠폰", 1),
    b("v2", "다라", "id_banana", "치킨쿠폰", 1),
  ]);
  assertEq(filterFanCoupons(grouped, "").length, 2, "빈 검색어는 전체 반환");
  assertEq(filterFanCoupons(grouped, "aiko").map((v) => v.key), ["v1"], "닉네임 대소문자 무시 부분일치");
  assertEq(filterFanCoupons(grouped, "banana").map((v) => v.key), ["v2"], "계정ID 부분일치");
  assertEq(filterFanCoupons(grouped, "zzz").length, 0, "일치 없음");
}

console.log("fan coupon view: 5개 그룹 통과");
