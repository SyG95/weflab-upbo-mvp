#!/bin/bash
# 운영 배포 가드 — 규칙: ① main 에서만 ② 커밋 안 한 변경 없이 ③ 한 번에 한 배포(잠금)
#   ④ 타입·lint·테스트 통과 ⑤ GitHub 에 먼저 올린 뒤 ⑥ vercel deploy --prod ⑦ 배포 대장 1줄.
# 배포가 끝나면 git 태그 prod-live 가 라이브 커밋을 가리키고(GitHub 에도 푸시), deploy-YYYYMMDD-HHMMSS 태그로 이력을 남긴다.
# 사용: DEPLOY_BY="누가(세션·사람 이름)" scripts/deploy-prod.sh   (프로젝트 루트나 워크트리 어디서 실행해도 됨)
# 배포 대장: deploy-* 태그 메시지(git tag -n1 -l 'deploy-*', GitHub 에도 남음) + 이 맥의 .git/deploy-ledger.tsv
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
GIT_COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"

if [ -z "${DEPLOY_BY:-}" ]; then
  echo "[deploy] 누가 배포하는지 적어 주세요(배포 대장용). 예: DEPLOY_BY=\"보안 줄② 세션\" scripts/deploy-prod.sh"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "[deploy] main 에서만 배포합니다. 현재 브랜치: $BRANCH"
  echo "[deploy] 작업 브랜치는 검증 뒤 main 에 합치고(git checkout main && git merge --ff-only <브랜치>) 다시 실행하세요."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "[deploy] 커밋하지 않은 변경이 있습니다. 커밋하거나 되돌린 뒤 다시 실행하세요."
  git status --short | head -20
  exit 1
fi

# ③ 한 번에 한 배포. 이 맥의 모든 워크트리·세션이 같은 .git 을 쓰므로 거기에 잠금을 둔다(mkdir 은 원자적).
# 2026-10-25~27 사흘 동안 서로 다른 세션이 4번 배포했다 — 겹치면 prod-live 태그와 라이브가 어긋난다.
LOCK="$GIT_COMMON/deploy-prod.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  OWNER_PID="$(sed -n 's/^pid=\([0-9]*\).*/\1/p' "$LOCK/owner" 2>/dev/null || true)"
  if [ -n "$OWNER_PID" ] && ! kill -0 "$OWNER_PID" 2>/dev/null; then
    # 잠금을 잡은 프로세스가 이미 없다(강제 종료 등) → 남은 잠금만 치우고 다시 잡는다.
    echo "[deploy] 끝난 배포(pid $OWNER_PID)가 남긴 잠금을 치웁니다: $(cat "$LOCK/owner" 2>/dev/null)"
    rm -rf "$LOCK"
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "[deploy] 다른 배포가 진행 중입니다: $(cat "$LOCK/owner" 2>/dev/null || echo '정보 없음')"
    echo "[deploy] 그 배포 프로세스가 이미 끝났는데 잠금만 남았다면: rm -rf \"$LOCK\""
    exit 1
  fi
fi
trap 'rm -rf "$LOCK"' EXIT
echo "pid=$$ by=$DEPLOY_BY at=$(date '+%Y-%m-%d %H:%M:%S') head=$(git rev-parse --short HEAD)" > "$LOCK/owner"

git fetch -q origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" != "$REMOTE" ] && ! git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
  echo "[deploy] GitHub main 이 로컬보다 앞서 있습니다. git pull --ff-only 로 맞춘 뒤 다시 실행하세요."
  exit 1
fi

# ④ 배포 전 검사. Vercel 빌드는 빌드·타입 오류만 막고 테스트·lint 회귀는 못 막는다 → 여기서 먼저 막는다.
# GitHub 에 올리기 "전에" 돌려서, 실패한 커밋이 원격 main 에 올라가지도 않게 한다.
echo "[deploy] 배포 전 검사: 타입 → lint → 테스트"
if ! npx tsc --noEmit; then echo "[deploy] 타입 검사 실패 — 배포 중단"; exit 1; fi
if ! npm run lint --silent; then echo "[deploy] lint 실패 — 배포 중단"; exit 1; fi
if ! npx tsx --test tests/*.test.ts tests/*.test.mjs; then echo "[deploy] 테스트 실패 — 배포 중단"; exit 1; fi
for t in tests/*.cjs; do
  if ! node "$t" >/dev/null; then echo "[deploy] 테스트 실패($t) — 배포 중단"; exit 1; fi
done
echo "[deploy] 검사 통과"

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[deploy] GitHub main 에 먼저 올립니다."
  git push origin main
fi

# 배포 대장에 남길 것: 롤백 대상(직전 prod-live), 이번에 새로 나가는 커밋.
PREV="$(git rev-parse -q --verify 'prod-live^{commit}' 2>/dev/null || true)"
PREV_SHORT="${PREV:0:7}"
SHORT="$(git rev-parse --short HEAD)"
if [ -n "$PREV" ]; then
  NEW_COUNT="$(git rev-list --count "$PREV..$LOCAL")"
else
  NEW_COUNT="?"
fi
SUBJECT="$(git log -1 --format=%s "$LOCAL")"

echo "[deploy] main $SHORT 운영 배포 시작 (새 커밋 ${NEW_COUNT}개, 롤백 대상 ${PREV_SHORT:-없음})"
# 2026-09-22 함정: npx 는 최신 vercel(59.x)을 받아 "Not authorized" 로 실패했다(npx 캐시에 59.24.0).
# 로그인된 설치본(전역 nvm v24 vercel 54.7.1)이 있으면 그걸 쓰고, 없을 때만 npx 로 간다.
if command -v vercel >/dev/null 2>&1; then
  vercel deploy --prod --yes
else
  npx vercel deploy --prod --yes
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
WHEN="$(date '+%Y-%m-%d %H:%M')"
# ⑦ 배포 대장 1줄: 언제 · 누가 · 무엇(라이브 커밋, 새 커밋 수, 마지막 커밋 제목) · 롤백 대상
LEDGER_LINE="$WHEN	by=$DEPLOY_BY	live=$SHORT	new=$NEW_COUNT	rollback=${PREV_SHORT:-none}	$SUBJECT"
git tag -f prod-live "$LOCAL" >/dev/null
git tag -a "deploy-$STAMP" -m "$LEDGER_LINE" "$LOCAL" >/dev/null
git push -f origin prod-live >/dev/null 2>&1 && git push origin "deploy-$STAMP" >/dev/null 2>&1 \
  || echo "[deploy] 태그 푸시 실패 — 나중에 git push -f origin prod-live && git push origin deploy-$STAMP 로 다시 올리세요."
LEDGER="$GIT_COMMON/deploy-ledger.tsv"
[ -f "$LEDGER" ] || printf 'when\tby\tlive\tnew\trollback\tsubject\n' > "$LEDGER"
printf '%s\n' "$LEDGER_LINE" >> "$LEDGER"

echo "[deploy] 완료. 라이브 = $SHORT (태그 prod-live, deploy-$STAMP)"
echo "[deploy] 대장: $LEDGER_LINE"
echo "[deploy] 되돌리기: 롤백 대상 ${PREV_SHORT:-없음} — Vercel 대시보드에서 그 배포를 Promote 하거나, main 을 되돌린 뒤 이 스크립트로 다시 배포"
for p in /rudy /chaeru /api/extension/whoami; do
  printf "  %s -> " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "https://weflab-upbo-mvp.vercel.app$p"
done
echo "[deploy] 기대값: /rudy 200, /chaeru 200, whoami 401"
