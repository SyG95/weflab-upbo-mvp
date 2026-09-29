// 쿠폰 시청자 합치기 계획 (순수 함수) — 닉네임만 있는 줄에 계정 ID를 붙이는 순간 그 ID 줄로 합친다.
//
// 배경(꾸야 디스코드 건의 2026-09-29): 처음엔 닉네임만 알고 수기로 적었다가 나중에 계정 ID를
// 알게 된 시청자가 잔액표에 두 줄(viewer_key=닉네임 / viewer_key=ID)로 갈라진다. 기록 폼은
// "ID 우선 + 닉네임→ID 자동 찾기" 규약이라 닉네임 줄을 겨냥할 방법이 없어 영구 동결됐다.
// sy 결정: 닉네임만 있는 상태는 임시이고, ID를 알게 되는 순간 ID 계정으로 합쳐지는 게 맞다.
//
// 이 파일은 couponAggregate.ts 와 같은 이유로 Node 전용 의존성을 import 하지 않는다(테스트·클라 공유 가능).
// 실제 저장은 upboSupabase.mergeCouponViewerIntoAccount 가 이 계획을 그대로 실행한다:
//   1) upserts + sourceZeroUpserts 를 한 번의 upsert 로(같은 문장 안 = 원자적) — ID 줄은 합산값, 닉네임 줄은 0
//   2) events insert
//   3) 닉네임 줄 DELETE(id 지정 + balance=0 조건)
// 1)이 끝난 뒤 어디서 실패해도 닉네임 줄 잔액은 이미 0 이라, 재시도 때 amount=0 → 이중 합산이 나지 않는다.

export type CouponMergeRow = {
  id: string;
  viewerKey: string;
  nickname: string;
  accountId: string;
  itemKey: string;
  itemName: string;
  balance: number;
};

export type CouponMergeMove = {
  itemKey: string;
  itemName: string;
  // 닉네임 줄에서 옮기는 양(= 닉네임 줄 잔액). 상한을 넘기면 계획 자체를 거부하므로 조용히 깎이는 일은 없다.
  amount: number;
  targetPrev: number;
  targetNext: number;
};

export type CouponMergeUpsert = {
  viewer_key: string;
  nickname: string | null;
  account_id: string | null;
  item_key: string;
  item_name: string;
  balance: number;
};

export type CouponMergeEvent = {
  viewer_key: string;
  nickname: string | null;
  item_key: string;
  item_name: string;
  delta: number;
  action_type: "adjust";
  previous_count: number;
  next_count: number;
  note: string;
};

export type CouponMergePlan = {
  nickname: string;
  accountId: string;
  // 지울 닉네임 줄의 id(정확히 그 줄만 — viewer_key 문자열 필터 대신 id 로 지운다).
  deleteIds: string[];
  moves: CouponMergeMove[];
  // ID 줄(합산값). 없던 종류는 새로 만든다(잔액 0 이어도 — "받았고 썼다"가 ID 줄로 따라가게).
  upserts: CouponMergeUpsert[];
  // 닉네임 줄을 0 으로 내리는 upsert — upserts 와 같은 요청에 실어 원자적으로 처리한다(재시도 안전).
  sourceZeroUpserts: CouponMergeUpsert[];
  events: CouponMergeEvent[];
  // 실제로 ID 줄에 더해진 합계(= 옮긴 잔액 합계).
  movedTotal: number;
};

export class CouponMergeError extends Error {
  status = 400;
}

export function planCouponViewerMerge(
  rows: readonly CouponMergeRow[],
  nicknameRaw: string,
  accountIdRaw: string,
  maxBalance: number,
): CouponMergePlan {
  const nickname = String(nicknameRaw ?? "").trim();
  const accountId = String(accountIdRaw ?? "").trim();
  if (!nickname) throw new CouponMergeError("합칠 닉네임이 비어 있어요.");
  if (!accountId) throw new CouponMergeError("붙일 계정 ID를 입력해 주세요.");
  if (nickname === accountId) throw new CouponMergeError("닉네임과 계정 ID가 같아 합칠 것이 없어요.");

  // 닉네임 키 줄만 대상(ID 가 이미 있는 줄은 절대 건드리지 않는다).
  const sources = rows.filter((r) => r.viewerKey === nickname && !r.accountId);
  if (sources.length === 0) {
    throw new CouponMergeError("닉네임만 있는 줄을 찾지 못했어요. 이미 합쳐졌거나 새로고침이 필요해요.");
  }

  // 닉네임과 ID 는 같은 열쇠 칸(viewer_key)을 쓴다. 입력한 "ID"가 실은 다른 시청자의 닉네임 줄이면
  // 두 사람이 섞이므로 거부한다(계정 ID 칸은 자유 입력이라 이 실수가 가능하다).
  const targetRows = rows.filter((r) => r.viewerKey === accountId);
  if (targetRows.some((r) => !r.accountId)) {
    throw new CouponMergeError(
      `'${accountId}'는 계정 ID가 아니라 다른 시청자의 닉네임 줄이에요. 계정 ID를 다시 확인해 주세요.`,
    );
  }
  const targetsByItem = new Map<string, CouponMergeRow>();
  for (const r of targetRows) targetsByItem.set(r.itemKey, r);
  // ID 줄이 이미 쓰는 닉네임이 있으면 그걸 따른다(같은 계정이 두 이름으로 갈라져 보이지 않게).
  const targetNickname = targetRows.find((r) => r.nickname)?.nickname || nickname;

  const moves: CouponMergeMove[] = [];
  const upserts: CouponMergeUpsert[] = [];
  const sourceZeroUpserts: CouponMergeUpsert[] = [];
  const events: CouponMergeEvent[] = [];
  let movedTotal = 0;

  // 같은 닉네임 줄이 쿠폰 종류마다 하나씩 있으므로 종류별로 접는다(같은 종류 중복은 방어적으로 합산).
  const byItem = new Map<string, { itemName: string; amount: number }>();
  for (const s of sources) {
    const cur = byItem.get(s.itemKey) ?? { itemName: s.itemName, amount: 0 };
    cur.amount += Math.max(0, Number(s.balance) || 0);
    byItem.set(s.itemKey, cur);
    sourceZeroUpserts.push({
      viewer_key: s.viewerKey,
      nickname: s.nickname || null,
      account_id: null,
      item_key: s.itemKey,
      item_name: s.itemName || s.itemKey,
      balance: 0,
    });
  }

  for (const [itemKey, src] of byItem) {
    const target = targetsByItem.get(itemKey);
    const targetPrev = target?.balance ?? 0;
    const targetNext = targetPrev + src.amount;
    if (targetNext > maxBalance) {
      throw new CouponMergeError(
        `'${src.itemName || itemKey}' 잔액이 상한(${maxBalance.toLocaleString()})을 넘어 합칠 수 없어요. 먼저 값을 정리해 주세요.`,
      );
    }
    const itemName = target?.itemName || src.itemName || itemKey;
    moves.push({ itemKey, itemName, amount: src.amount, targetPrev, targetNext });
    movedTotal += targetNext - targetPrev;
    upserts.push({
      viewer_key: accountId,
      nickname: targetNickname,
      account_id: accountId,
      item_key: itemKey,
      item_name: itemName,
      balance: targetNext,
    });
    if (src.amount > 0) {
      events.push({
        viewer_key: nickname,
        nickname,
        item_key: itemKey,
        item_name: itemName,
        delta: -src.amount,
        action_type: "adjust",
        previous_count: src.amount,
        next_count: 0,
        note: `계정 ID 붙이기 — ${accountId} 줄로 합침`,
      });
      events.push({
        viewer_key: accountId,
        nickname: targetNickname,
        item_key: itemKey,
        item_name: itemName,
        delta: targetNext - targetPrev,
        action_type: "adjust",
        previous_count: targetPrev,
        next_count: targetNext,
        note: `닉네임 '${nickname}' 줄에서 합침`,
      });
    }
  }

  return {
    nickname,
    accountId,
    deleteIds: sources.map((s) => s.id),
    moves,
    upserts,
    sourceZeroUpserts,
    events,
    movedTotal,
  };
}
