import type { NextConfig } from "next";
import { buildSlugRedirects } from "./lib/slugRedirects";

const nextConfig: NextConfig = {
  // 시트 주소를 바꾼 스트리머의 옛 주소 → 새 주소(308). 표는 lib/slugRedirects.ts, /api 는 제외.
  async redirects() {
    return buildSlugRedirects();
  },
};

export default nextConfig;
