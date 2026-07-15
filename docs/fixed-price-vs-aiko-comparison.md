# 정가기록 비교분석 — 원본(아이코 업보) vs weflab-upbo-mvp

작성: 2026-07-06 · 상태: **분석 보고서(구현 아님)** · 읽기 전용 비교

## 0. 질문
"포로미 정가 설정은 됐는데 실제 정가 후원이 어디에도 안 잡힌다." 원류인 **아이코 업보시트(upbo-pipeline-lab, aiko-upbo.vercel.app)**는 정가를 어떻게 잡는지 비교해서 weflab의 갭을 규명한다.

## 1. 결론 (한 줄)
원본은 **정가 후원을 "룰렛과 무관한 독립 이벤트"로 수집·판정**한다. weflab은 포팅하면서 그 독립 통로를 없애고 **"룰렛 결과 캡처" 하나에 정가를 얹으려** 해서, 룰렛을 안 돌린 순수 정가 후원이 **구조적으로 못 들어온다.** → 0건.

## 2. 원본(아이코)이 정가를 잡는 법 — 후보(candidate) 단위 + 정책 매칭
- 확장이 보내는 후보가 **두 종류로 분리**돼 있다(payload split):
  `ROULETTE_CANDIDATE` / **`PRICED_DONATION_CANDIDATE`**
  ([types/raw-events.ts:3](../../upbo-pipeline-lab/types/raw-events.ts), 설계: `docs/PHASE_2_2_EXTENSION_PAYLOAD_SPLIT_DESIGN.md` — "Upbo API: 10% 이하 룰렛 후보 + 기본/이벤트 정가 후보 전송")
- **정가 후보는 `amount`만 있으면 성립**한다. 상품·확률·룰렛 결과가 전혀 필요 없다
  ([lib/raw-dedupe.ts:106-134](../../upbo-pipeline-lab/lib/raw-dedupe.ts) — priced 분기: `amount` 없으면 MISSING_AMOUNT, 그 외 prize/probability는 null 허용).
- 판정은 정책 규칙으로: 정가 후보의 `amount`가 **`priced_amount` 규칙 값과 일치**하면 포함
  ([lib/policy.ts:109-114](../../upbo-pipeline-lab/lib/policy.ts) — `rule_type==="priced_amount" && rule.value_numeric === candidate.amount`).
- 즉 **정가 = 후원 금액(갯수) 단위 매칭**이고 룰렛 여부와 완전히 독립. 순수 대형 후원이 1급 이벤트로 들어온다.

## 3. weflab-upbo-mvp가 정가를 잡는 법 — 룰렛 결과에 종속
- 확장이 보내는 건 **룰렛 결과 캡처 하나**뿐. 룰렛 결과(`results[]`)가 없는 후원 행은 전송 전에 버려진다
  ([upbo-beta/extension/content.js:330](../../upbo-beta/extension/content.js) — `.filter(row => row.results.length > 0)`).
- 서버 정규화도 **`row.results[]` 단위로만** NormalizedResult를 만든다 → results가 비면 그 후원은 아예 생성 안 됨
  ([lib/upboCore.ts `normalizeResultCapture`](../lib/upboCore.ts)).
- 정가 매칭(`buildFixedPriceCandidates`)은 그렇게 만들어진 **`normalized.results`만** 훑는다
  ([lib/upboSupabase.ts:2022](../lib/upboSupabase.ts)). → 룰렛을 같이 돌린 후원만 정가 매칭 가능, 순수 정가 후원은 볼 수 없음.

## 4. 핵심 차이 표
| | 원본 아이코 (upbo-pipeline-lab) | weflab-upbo-mvp |
|---|---|---|
| 정가의 지위 | **독립 이벤트 타입** `PRICED_DONATION_CANDIDATE` | 룰렛 결과 캡처의 부산물(사후 필터) |
| 정가 성립 조건 | `amount`만 있으면 됨(룰렛 불필요) | 룰렛 결과(`results[]`)가 있어야 후원이 존재 |
| 매칭 방식 | 정책 규칙 `priced_amount` = amount 일치 | `signatureCounts`에 amount 포함 여부 |
| 순수 대형 후원 | 1급으로 수집·판정됨 | **확장+서버 양쪽에서 탈락 → 못 잡음** |
| 확장 전송 | 룰렛 후보 + 정가 후보 **분리 전송** | 룰렛 결과 행만 전송 |

## 5. 그래서 weflab에서 무엇이 빠졌나 (원본 대비)
원본의 **"정가 후원 = 독립 candidate로 수집"** 단계가 weflab에는 **아예 없다.** weflab의 `buildFixedPriceCandidates`는 "이미 들어온 룰렛 결과"에서 정가를 사후에 골라내려는 접근인데, 정가 후원(순수 대형 후원)은 애초에 룰렛 결과가 아니라서 그 목록에 존재하지 않는다. 설계문서(fixed-price-records-design.md §2)가 "순수 후원도 이미 수집된다"고 **가정**했지만, 그 가정이 성립하는 통로(원본의 PRICED_DONATION_CANDIDATE)가 포팅 과정에서 누락됐다.

## 6. 원본을 따르는 수정 방향 (구현 아님 — 승인 후 별도 진행)
원본 구조를 그대로 참고하면:
1. **확장(upbo-beta)**: 룰렛 결과가 없어도 **후원 행(금액+계정+시간)을 별도로 전송**한다(원본의 payload split처럼 "정가 후보" 스트림 추가, 또는 순수 후원 행을 버리지 않기). ← 별도 코드/보호 경계
2. **서버(weflab)**: 정가 매칭을 **후원 행(row) 단위**로 올린다 — `normalized.results`가 아니라 캡처의 후원 행에서 `donationAmount ∈ signatureCounts`를 직접 판정. `reconcileResults`(룰렛 판정)는 무수정.
3. (선택) 원본처럼 정가를 **금액 규칙**으로 관리하면 이벤트 한정 정가까지 확장 가능(원본 `EventLimitedPricedForm`/`priced_amount` 참고).

## 7. 안 건드린 것 / 범위
- 이 문서는 **읽기 전용 비교분석**이다. 아이코 원본(upbo-pipeline-lab = 운영/canonical)은 **조회만** 했고 수정하지 않았다.
- 실제 수정은 확장(별도 코드)까지 걸쳐서, 원인분석처럼 **설계안 → sy 승인 → 구현** 순서로 진행해야 한다.
