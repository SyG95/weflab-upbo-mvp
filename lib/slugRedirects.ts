// 시트 주소(슬러그)를 바꾼 뒤 옛 주소로 들어온 사람을 새 주소로 보내는 표.
// 결정: AI-Sessions/wiki/decisions/weflab-item-display-name-slug-rename-2026-11-02.md §A "교체할 때 순서" 3번.
//
// - 팬 화면·옷장·후원·설정·관리자 페이지만 보낸다(주소창에 보이는 길). 물음표 뒤(?admin=1 등)는 Next 가 그대로 붙여 준다.
// - /api/s/{옛 슬러그}/... 는 일부러 안 보낸다. 확장프로그램은 옛 슬러그를 저장해 두고 보내는데,
//   주소만 몰래 바꿔 주면 "연결됨"으로 보이면서 토큰 슬러그 불일치(403)가 가려진다. 끊긴 걸 알고 "연결하기"를 다시 하게 둔다.
// - 옛 슬러그를 다시 누군가에게 주면 이 표에서 그 줄을 지운다(지우기 전까지 옛 주소는 늘 새 주소로 간다).
export const SLUG_REDIRECTS: Readonly<Record<string, string>> = {
  // 2026-11 땜밍이 → 유이비 개명. DB 한 칸(upbo_alpha_streamers.slug) 교체와 같은 배포에 넣는다.
  ddamming: "yuibi",
};

export type SlugRedirectRule = { source: string; destination: string; permanent: boolean };

const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// next.config redirects 에 그대로 넣는 모양. 옛/새 슬러그가 소문자·숫자·하이픈이 아니면 표 자체를 거부한다(경로 패턴 깨짐 방지).
export function buildSlugRedirects(map: Readonly<Record<string, string>> = SLUG_REDIRECTS): SlugRedirectRule[] {
  const rules: SlugRedirectRule[] = [];
  for (const [from, to] of Object.entries(map)) {
    if (!SLUG_SHAPE.test(from) || !SLUG_SHAPE.test(to)) throw new Error(`slug redirect 모양 오류: ${from} -> ${to}`);
    if (from === to) throw new Error(`slug redirect 같은 값: ${from}`);
    if (map[to]) throw new Error(`slug redirect 사슬 금지: ${from} -> ${to} -> ${map[to]}`);
    for (const prefix of ["", "/admin"]) {
      rules.push({ source: `${prefix}/${from}`, destination: `${prefix}/${to}`, permanent: true });
      rules.push({ source: `${prefix}/${from}/:path*`, destination: `${prefix}/${to}/:path*`, permanent: true });
    }
  }
  return rules;
}
