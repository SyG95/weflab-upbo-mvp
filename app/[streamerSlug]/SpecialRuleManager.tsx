"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import type { SpecialItemRule } from "../../lib/api";

type Props = {
  slug: string;
  rules: SpecialItemRule[];
};

function ruleStatusLabel(status: SpecialItemRule["status"]): string {
  if (status === "confirmed") return "적용 중";
  if (status === "rejected") return "아님";
  return "확인 필요";
}

export default function SpecialRuleManager({ slug, rules }: Props) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");

  async function save(rule: SpecialItemRule, status: "confirmed" | "rejected") {
    setBusyKey(rule.ruleKey);
    setMessage("");
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/special-rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleKey: rule.ruleKey, status, multiplier: 2 }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMessage(status === "confirmed" ? "두배권 규칙으로 저장됐어요." : "두배권 후보에서 제외했어요.");
      router.refresh();
    } catch {
      setMessage("저장 실패. API 연결/권한을 확인해 주세요.");
    } finally {
      setBusyKey(null);
    }
  }

  if (rules.length === 0) {
    return <p className={styles.fieldHint}>현재 룰렛표에서 두배권 후보를 찾지 못했어요.</p>;
  }

  return (
    <div className={styles.specialRules}>
      <p className={styles.fieldHint}>
        자동 감지는 후보만 찾습니다. &quot;두배권 맞음&quot;으로 확인한 칸만 같은 시청자의 다음 룰렛 배수권으로 적용돼요.
        룰렛 상품 사용여부에서 &quot;사용 안 함&quot;으로 꺼 둔 칸이어도 여기서 확인돼 있으면 두배권은 적용됩니다.
      </p>
      {message ? <p className={styles.fieldOk}>{message}</p> : null}
      <div className={styles.specialRuleList}>
        {rules.map((rule) => (
          <div key={rule.ruleKey} className={styles.specialRuleCard}>
            <div>
              <div className={styles.specialRuleTitle}>{rule.itemName}</div>
              <div className={styles.metaRow}>
                <span className={styles.tagMuted}>룰렛 {rule.amountRangeLabel || "—"}</span>
                <span className={styles.tagMuted}>확률 {rule.probability ?? "—"}%</span>
                {rule.itemEnabled === false ? <span className={styles.tagMuted}>사용 안 함 칸</span> : null}
                <span className={rule.status === "confirmed" ? styles.tagActive : rule.status === "rejected" ? styles.tagMuted : styles.tagWarn}>
                  {ruleStatusLabel(rule.status)}
                </span>
              </div>
            </div>
            <div className={styles.specialRuleActions}>
              <button
                type="button"
                disabled={busyKey === rule.ruleKey || rule.status === "confirmed"}
                onClick={() => save(rule, "confirmed")}
              >
                두배권 맞음
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={busyKey === rule.ruleKey || rule.status === "rejected"}
                onClick={() => save(rule, "rejected")}
              >
                아님
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
