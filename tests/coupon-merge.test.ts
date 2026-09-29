// 쿠폰 시청자 합치기 계획(lib/couponMerge.ts) 검증 — 닉네임 줄에 계정 ID를 붙이면 ID 줄로 합쳐지는가.
// 배경: 꾸야 디스코드 건의 2026-09-29(닉네임만 있는 옛 줄 + ID 줄 2개가 동일인물인데 합칠 방법이 없음).

import { planCouponViewerMerge, CouponMergeError } from "../lib/couponMerge";
import type { CouponMergeRow } from "../lib/couponMerge";

function assertEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function assertThrows(fn: () => unknown, needle: string, label: string) {
  try {
    fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof CouponMergeError)) throw new Error(`${label}: expected CouponMergeError, got ${msg}`);
    if (!msg.includes(needle)) throw new Error(`${label}: expected message containing "${needle}", got "${msg}"`);
    return;
  }
  throw new Error(`${label}: expected to throw`);
}

const MAX = 1_000_000;
let seq = 0;
const row = (
  viewerKey: string,
  nickname: string,
  accountId: string,
  itemKey: string,
  itemName: string,
  balance: number,
): CouponMergeRow => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  viewerKey,
  nickname,
  accountId,
  itemKey,
  itemName,
  balance,
});

// 1) 꾸야 상황: 닉네임 줄(잔액 3) + ID 줄(잔액 5, 사용 1 차감 후) → ID 줄 8, 닉네임 줄 0→삭제, 조정 2건.
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 3);
  const idRow = row("star_id", "별사탕", "star_id", "chicken", "치킨쿠폰", 5);
  const other = row("other_id", "다른사람", "other_id", "chicken", "치킨쿠폰", 9);
  const plan = planCouponViewerMerge([nickRow, idRow, other], "별사탕", "star_id", MAX);
  assertEq(plan.deleteIds, [nickRow.id], "1 deleteIds = 닉네임 줄만");
  assertEq(
    plan.moves,
    [{ itemKey: "chicken", itemName: "치킨쿠폰", amount: 3, targetPrev: 5, targetNext: 8 }],
    "1 moves",
  );
  assertEq(
    plan.upserts,
    [{ viewer_key: "star_id", nickname: "별사탕", account_id: "star_id", item_key: "chicken", item_name: "치킨쿠폰", balance: 8 }],
    "1 upserts = ID 줄 합산",
  );
  // 닉네임 줄은 같은 upsert 요청에서 0 으로 내려간다(재시도 안전).
  assertEq(
    plan.sourceZeroUpserts,
    [{ viewer_key: "별사탕", nickname: "별사탕", account_id: null, item_key: "chicken", item_name: "치킨쿠폰", balance: 0 }],
    "1 sourceZeroUpserts",
  );
  assertEq(
    plan.events.map((e) => [e.viewer_key, e.delta, e.previous_count, e.next_count, e.action_type]),
    [
      ["별사탕", -3, 3, 0, "adjust"],
      ["star_id", 3, 5, 8, "adjust"],
    ],
    "1 events = 닉네임 줄 −3 / ID 줄 +3",
  );
  assertEq(plan.movedTotal, 3, "1 movedTotal");
  // 다른 사람 줄은 계획 어디에도 안 나온다.
  assertEq(plan.deleteIds.includes(other.id), false, "1 다른 사람 줄 미삭제");
}

// 1b) 재시도 안전: 1단계(upsert)만 끝나고 실패한 뒤 다시 계획하면 옮길 양이 0 — 이중 합산 없음.
{
  const nickRowZero = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 0);
  const idRowMerged = row("star_id", "별사탕", "star_id", "chicken", "치킨쿠폰", 8);
  const plan = planCouponViewerMerge([nickRowZero, idRowMerged], "별사탕", "star_id", MAX);
  assertEq(plan.movedTotal, 0, "1b 재시도 movedTotal 0");
  assertEq(plan.events, [], "1b 재시도 이벤트 없음");
  assertEq(plan.upserts.map((u) => u.balance), [8], "1b ID 줄 그대로 8");
  assertEq(plan.deleteIds, [nickRowZero.id], "1b 0 줄은 지운다");
}

// 2) ID 줄이 아직 없을 때: 닉네임 줄을 ID 줄로 "이동"(새 줄 생성, 닉네임 줄 삭제).
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 2);
  const plan = planCouponViewerMerge([nickRow], "별사탕", "star_id", MAX);
  assertEq(
    plan.upserts,
    [{ viewer_key: "star_id", nickname: "별사탕", account_id: "star_id", item_key: "chicken", item_name: "치킨쿠폰", balance: 2 }],
    "2 새 ID 줄 생성",
  );
  assertEq(plan.deleteIds, [nickRow.id], "2 닉네임 줄 삭제");
  assertEq(plan.events.length, 2, "2 조정 2건");
}

// 3) 닉네임 줄이 쿠폰 여러 종류면 종류별로 각각 합친다.
{
  const a = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 1);
  const b = row("별사탕", "별사탕", "", "coffee", "커피쿠폰", 4);
  const t = row("star_id", "별사탕", "star_id", "coffee", "커피쿠폰", 1);
  const plan = planCouponViewerMerge([a, b, t], "별사탕", "star_id", MAX);
  assertEq(plan.deleteIds.sort(), [a.id, b.id].sort(), "3 두 줄 모두 삭제");
  assertEq(
    plan.upserts.map((u) => [u.item_key, u.balance]).sort(),
    [
      ["chicken", 1],
      ["coffee", 5],
    ],
    "3 종류별 합산",
  );
  assertEq(plan.sourceZeroUpserts.length, 2, "3 닉네임 줄 2개 모두 0 으로");
  assertEq(plan.movedTotal, 5, "3 movedTotal");
}

// 4) 잔액 0인 닉네임 줄("사용완료" 표시 줄)도 ID 줄로 따라간다 — 이벤트는 없고 줄만 이동.
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 0);
  const plan = planCouponViewerMerge([nickRow], "별사탕", "star_id", MAX);
  assertEq(plan.events, [], "4 잔액 0 → 이벤트 없음");
  assertEq(plan.upserts.map((u) => [u.viewer_key, u.balance]), [["star_id", 0]], "4 ID 줄 0 생성");
  assertEq(plan.deleteIds, [nickRow.id], "4 닉네임 줄 삭제");
}

// 5) 상한 초과는 조용히 깎지 않고 거부한다(쿠폰이 소리 없이 사라지지 않게).
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 10);
  const idRow = row("star_id", "별사탕", "star_id", "chicken", "치킨쿠폰", 95);
  assertThrows(() => planCouponViewerMerge([nickRow, idRow], "별사탕", "star_id", 100), "상한", "5 상한 초과 거부");
  // 딱 상한까지는 허용.
  const ok = planCouponViewerMerge([nickRow, row("star_id", "별사탕", "star_id", "chicken", "치킨쿠폰", 90)], "별사탕", "star_id", 100);
  assertEq(ok.upserts[0].balance, 100, "5 상한 정확히 도달은 허용");
}

// 6) ID 가 이미 있는 줄은 절대 대상이 아니다(viewerKey 가 닉네임과 같아도 accountId 가 있으면 제외).
{
  const weird = row("별사탕", "별사탕", "someone", "chicken", "치킨쿠폰", 7);
  assertThrows(() => planCouponViewerMerge([weird], "별사탕", "star_id", MAX), "찾지 못했어요", "6 ID 있는 줄 제외");
}

// 7) 입력 검증.
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 1);
  assertThrows(() => planCouponViewerMerge([nickRow], "", "star_id", MAX), "닉네임", "7a 빈 닉네임");
  assertThrows(() => planCouponViewerMerge([nickRow], "별사탕", "  ", MAX), "계정 ID", "7b 빈 ID");
  assertThrows(() => planCouponViewerMerge([nickRow], "별사탕", "별사탕", MAX), "같아", "7c 닉네임=ID");
  assertThrows(() => planCouponViewerMerge([nickRow], "없는닉", "star_id", MAX), "찾지 못했어요", "7d 없는 닉네임");
  // 앞뒤 공백은 정리한다.
  const plan = planCouponViewerMerge([nickRow], " 별사탕 ", " star_id ", MAX);
  assertEq([plan.nickname, plan.accountId], ["별사탕", "star_id"], "7e trim");
}

// 8) 입력한 "ID"가 실은 다른 시청자의 닉네임 줄(ID 없는 열쇠)이면 두 사람이 섞이므로 거부.
{
  const nickRow = row("별사탕", "별사탕", "", "chicken", "치킨쿠폰", 1);
  const otherNickOnly = row("다라", "다라", "", "chicken", "치킨쿠폰", 4);
  assertThrows(() => planCouponViewerMerge([nickRow, otherNickOnly], "별사탕", "다라", MAX), "닉네임 줄이에요", "8 다른 사람 닉네임 줄 오합 거부");
}

// 9) ID 줄이 이미 다른 닉네임(개명 등)을 쓰고 있으면 새로 만드는 종류도 그 닉네임을 따른다.
{
  const nickRow = row("옛이름", "옛이름", "", "coffee", "커피쿠폰", 2);
  const idRow = row("star_id", "새이름", "star_id", "chicken", "치킨쿠폰", 1);
  const plan = planCouponViewerMerge([nickRow, idRow], "옛이름", "star_id", MAX);
  assertEq(plan.upserts.map((u) => [u.item_key, u.nickname, u.balance]), [["coffee", "새이름", 2]], "9 ID 줄 닉네임 승계");
  assertEq(plan.events.map((e) => [e.viewer_key, e.nickname]), [["옛이름", "옛이름"], ["star_id", "새이름"]], "9 이벤트 닉네임");
}

console.log("coupon-merge: all tests passed");
