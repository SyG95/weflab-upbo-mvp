"use client";

// 관리자 머리 알림: 놓쳤을 수 있는 기록(관문 1). 시범 스위치를 켠 스트리머에게만 뜨고, 숫자는 배치 요약만 읽어 만든다.
// 탭을 옮길 때마다 전체 새로고침이라 10분 동안은 브라우저에 저장한 값을 쓴다.
import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Suspect = { remaining: number; newSince: number; numberHidden: boolean };

const TTL_MS = 10 * 60_000;
const cacheKeyOf = (slug: string) => `upbo:missing-suspect:${slug}`;

// 미리보기를 돌리거나 제외를 바꾸면 숫자가 달라지므로 저장해 둔 값을 버린다.
export function forgetMissingSuspectCache(slug: string) {
  try {
    window.sessionStorage.removeItem(cacheKeyOf(slug));
  } catch {
    /* 못 지워도 10분 뒤 새로 읽는다 */
  }
}

function readCache(key: string): Suspect | null | undefined {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at: number; value: Suspect | null };
    return Date.now() - parsed.at < TTL_MS ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(key: string, value: Suspect | null) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* 저장 못 해도 알림은 그대로 보여 준다 */
  }
}

export default function MissingSuspectNotice({ slug }: { slug: string }) {
  const [suspect, setSuspect] = useState<Suspect | null>(null);

  useEffect(() => {
    const cacheKey = cacheKeyOf(slug);
    let alive = true;
    const cached = readCache(cacheKey);
    if (cached !== undefined) {
      queueMicrotask(() => {
        if (alive) setSuspect(cached);
      });
      return () => {
        alive = false;
      };
    }
    fetch(`/api/s/${encodeURIComponent(slug)}/rejudge?suspect=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return; // 일시 실패를 "없음"으로 10분 동안 기억하지 않는다.
        const value = (data.suspect ?? null) as Suspect | null;
        writeCache(cacheKey, value);
        if (alive) setSuspect(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug]);

  const total = suspect ? suspect.remaining + suspect.newSince : 0;
  if (!suspect || total <= 0) return null;
  return (
    <div className={styles.sigAlertBox}>
      <p className={styles.sigAlertLine}>
        🔎 {suspect.numberHidden ? "확인해 볼 룰렛 결과가 있어요." : `놓쳤을 수 있는 기록 ${total.toLocaleString()}건이 있어요.`}{" "}
        <a href={`/${encodeURIComponent(slug)}?admin=1&atab=roulettes`}>룰렛 관리에서 확인하기</a>
      </p>
    </div>
  );
}
