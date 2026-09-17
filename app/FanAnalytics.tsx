"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

// Vercel Web Analytics — 팬 화면 방문만 보낸다(sy 결정 2026-09-17).
// 무료 플랜 월 5만 이벤트를 팬 방문 집계에만 쓰고, 관리 화면·미리보기·운영 화면은 세지 않는다.
//
// 통과: /[slug]            (admin·미리보기 쿼리 없음)
//       /[slug]/wardrobe   (팬 옷장)
// 제외: ?admin= ?design= ?preview= ?layout= ?theme= 가 붙은 로드(관리·시안·테마 미리보기),
//       /admin/*(검증실) /[slug]/settings /[slug]/donations(운영실) /[slug]/board-requests(실험) / (안내 페이지)
// 보낼 때 쿼리는 전부 떼어 경로만 남긴다(개인 식별 가능 값 유출 방지, 대시보드 경로별 집계 단순화).

const EXCLUDED_QUERY_KEYS = ["admin", "design", "preview", "layout", "theme"];
const EXCLUDED_FIRST_SEGMENTS = new Set(["admin", "api", "_next", "s"]);
const FAN_SUB_PAGES = new Set(["wardrobe"]);
// 스트리머 슬러그 형식(영문·숫자·_·-)만 인정. 그 밖의 경로(정적 파일·이상한 문자열)는 팬 화면이 아니다.
const SLUG_PATTERN = /^[a-z0-9_-]+$/i;

export function isFanPageUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl, "https://weflab-upbo-mvp.vercel.app");
  } catch {
    return false;
  }
  for (const key of EXCLUDED_QUERY_KEYS) {
    if (url.searchParams.has(key)) return false;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return false;
  const [slug, sub] = segments;
  if (EXCLUDED_FIRST_SEGMENTS.has(slug) || !SLUG_PATTERN.test(slug)) return false;
  if (segments.length === 2 && !FAN_SUB_PAGES.has(sub)) return false;
  return true;
}

export function fanOnlyBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== "pageview") return null;
  if (!isFanPageUrl(event.url)) return null;
  const url = new URL(event.url, "https://weflab-upbo-mvp.vercel.app");
  return { ...event, url: `${url.origin}${url.pathname}` };
}

export default function FanAnalytics() {
  return <Analytics beforeSend={fanOnlyBeforeSend} />;
}
