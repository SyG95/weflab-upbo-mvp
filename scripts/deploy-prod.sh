#!/bin/bash
# 운영 배포 가드 — 규칙: ① main 에서만 ② 커밋 안 한 변경 없이 ③ GitHub 에 먼저 올린 뒤 ④ vercel deploy --prod.
# 배포가 끝나면 git 태그 prod-live 가 라이브 커밋을 가리키고(GitHub 에도 푸시), deploy-YYYYMMDD-HHMM 태그로 이력을 남긴다.
# 사용: scripts/deploy-prod.sh   (프로젝트 루트나 워크트리 어디서 실행해도 됨)
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

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

git fetch -q origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"
if [ "$LOCAL" != "$REMOTE" ]; then
  if git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
    echo "[deploy] GitHub main 에 먼저 올립니다."
    git push origin main
  else
    echo "[deploy] GitHub main 이 로컬보다 앞서 있습니다. git pull --ff-only 로 맞춘 뒤 다시 실행하세요."
    exit 1
  fi
fi

SHORT="$(git rev-parse --short HEAD)"
echo "[deploy] main $SHORT 운영 배포 시작"
npx vercel deploy --prod --yes

STAMP="$(date +%Y%m%d-%H%M)"
git tag -f prod-live "$LOCAL" >/dev/null
git tag -f "deploy-$STAMP" "$LOCAL" >/dev/null
git push -f origin prod-live "deploy-$STAMP" >/dev/null 2>&1 || echo "[deploy] 태그 푸시 실패 — 나중에 git push -f origin prod-live 로 다시 올리세요."

echo "[deploy] 완료. 라이브 = $SHORT (태그 prod-live, deploy-$STAMP)"
for p in /rudy /chaeru /api/extension/whoami; do
  printf "  %s -> " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" "https://weflab-upbo-mvp.vercel.app$p"
done
echo "[deploy] 기대값: /rudy 200, /chaeru 200, whoami 401"
