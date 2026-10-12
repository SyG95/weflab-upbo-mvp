// 스트리머 관리자 화면 상단 "확프 상태" 한 줄(수집 레인 1단계, 2026-10-12) — 서버 컴포넌트, 사실만 적는다.
// 예: 확프 ● 3분 전 · v0.4.0 · 화면 100행(10-05~10-12) · 더보기 있음 · 되읽기 꺼짐 — 검색어 걸림
// 점 색·사유는 /admin 목록과 같은 trafficLight 규칙. 하트비트는 확프 0.4.0 이상만 보낸다(팬 화면에는 안 나옴).
import styles from "./extensionStatus.module.css";
import {
  formatElapsed,
  screenRangeLabel,
  trafficLight,
  type ExtensionConfig,
  type ExtensionLightColor,
  type ExtensionStatus,
} from "@/lib/extensionStatus";

const LIGHT_NAME: Record<ExtensionLightColor, string> = {
  green: "정상",
  yellow: "주의",
  red: "이상",
  gray: "상태 없음",
};

export default function ExtensionStatusLine({
  status,
  config,
  serverNewestCaptureAt,
  now,
  loadFailed = false,
}: {
  status: ExtensionStatus | null;
  config: ExtensionConfig;
  serverNewestCaptureAt: string | null;
  now: Date;
  loadFailed?: boolean;
}) {
  if (loadFailed || !status) {
    return (
      <p className={styles.line} data-light="gray">
        <span className={styles.label}>확프</span>
        <span className={styles.dot} data-light="gray" aria-hidden />
        <span className={styles.muted}>
          {loadFailed ? "확프 상태를 불러오지 못했어요" : "확프 상태 정보 없음(0.4.0 이상에서 표시)"}
        </span>
      </p>
    );
  }
  const light = trafficLight({ status, now, serverNewestCaptureAt });
  const { payload } = status;
  const facts = [`${formatElapsed(now.getTime() - Date.parse(status.updatedAt))} 전`];
  if (status.clientVersion) facts.push(`v${status.clientVersion}`);
  if (payload.page.onAlertList) {
    const range = screenRangeLabel(payload.screen);
    facts.push(`화면 ${payload.screen.rowCount}행${range ? `(${range})` : ""}`);
    if (payload.screen.moreButtonVisible) facts.push("더보기 있음");
  }
  facts.push(`되읽기 ${config.catchupEnabled ? "켜짐" : "꺼짐"}`);
  if (config.paused) facts.push("서버 일시정지");
  const reasonText = light.reasons.join(" · ");
  return (
    <p className={styles.line} data-light={light.color}>
      <span className={styles.label}>확프</span>
      <span
        className={styles.dot}
        data-light={light.color}
        role="img"
        aria-label={`확프 ${LIGHT_NAME[light.color]}`}
        title={reasonText || "정상"}
      />
      <span className={styles.facts}>{facts.join(" · ")}</span>
      {reasonText ? <span className={styles.reasons}>— {reasonText}</span> : null}
    </p>
  );
}
