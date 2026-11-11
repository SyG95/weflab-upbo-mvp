// 시트 관리자 세션이 sy 마스터키로 연 것인지(관문 2: 다시판정 "그때 표로" 넣기·되돌리기 전용 문).
//
// 인증 동작은 바꾸지 않는다 — sheetAdminAuth.ts·adminAuth.ts 는 그대로 두고, 거기서 export 한 함수만 쓴다.
// 판별은 sheetAdminAccessState 의 첫 분기와 같다: 이 슬러그의 시트 쿠키 == sheetSessionValue(slug, masterPinHash()).
// 스트리머 개인 비밀번호로 연 세션·로컬 미설정(open-unconfigured)·마스터키 환경변수 없는 환경은 전부 false.
// 쓰는 곳은 requireSheetAdmin 을 먼저 통과시킨 뒤 이걸 추가로 본다(401 → 403 순서).

import { cookies } from "next/headers";
import { masterPinHash, sessionMatches } from "./adminAuth";
import { sheetAdminCookieName, sheetSessionValue } from "./sheetAdminAuth";

export async function isSheetMasterSession(slug: string): Promise<boolean> {
  const master = masterPinHash();
  if (!master) return false;
  const cookie = (await cookies()).get(sheetAdminCookieName(slug))?.value;
  return sessionMatches(cookie, sheetSessionValue(slug, master));
}
