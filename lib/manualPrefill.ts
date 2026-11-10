// 누락 후보 줄의 값을 수동기록 화면으로 넘기는 다리(관문 1, 브라우저 전용).
// 시청자 ID·닉네임을 주소창에 싣지 않으려고 sessionStorage 를 쓴다. 한 번 읽으면 지운다.
export type ManualPrefill = {
  fanId: string;
  fanNickname: string;
  itemName: string;
  probability: number | null;
  date: string | null; // YYYY-MM-DD(KST)
};

const keyOf = (slug: string) => `upbo:manual-prefill:${slug}`;

export function prefillDateOf(donateTimeText: string): string | null {
  const m = String(donateTimeText || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function stashManualPrefill(slug: string, value: ManualPrefill): boolean {
  try {
    window.sessionStorage.setItem(keyOf(slug), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function takeManualPrefill(slug: string): ManualPrefill | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(slug));
    if (!raw) return null;
    window.sessionStorage.removeItem(keyOf(slug));
    const v = JSON.parse(raw) as Partial<ManualPrefill>;
    if (typeof v.itemName !== "string" || !v.itemName) return null;
    return {
      fanId: typeof v.fanId === "string" ? v.fanId : "",
      fanNickname: typeof v.fanNickname === "string" ? v.fanNickname : "",
      itemName: v.itemName,
      probability: typeof v.probability === "number" && Number.isFinite(v.probability) ? v.probability : null,
      date: typeof v.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null,
    };
  } catch {
    return null;
  }
}
