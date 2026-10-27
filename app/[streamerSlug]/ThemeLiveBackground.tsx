"use client";

// 테마의 fx.background 를 실제 배경 부품으로 연결하는 어댑터.
// dynamic import(ssr:false) 라서 살아있는 배경을 쓰는 테마에서만 코드가 내려간다.

import dynamic from "next/dynamic";
import type { NebulaPalette } from "../../lib/themes";

const NebulaBackground = dynamic(() => import("./NebulaBackground"), { ssr: false });

export default function ThemeLiveBackground({
  fx,
  palette,
  contained,
}: {
  fx?: string;
  palette?: NebulaPalette;
  contained?: boolean;
}) {
  if (fx === "nebula") return <NebulaBackground palette={palette} contained={contained} />;
  return null;
}
