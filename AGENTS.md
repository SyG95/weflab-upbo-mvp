# weflab-upbo-mvp — 작업 규칙 (사람·Claude·Codex 공통)

## 줄기는 하나: main = 운영본
- 배포는 **main 에서만**, 반드시 `scripts/deploy-prod.sh` 로 한다. 스크립트가 main 이 아니거나 커밋 안 한 변경이 있으면 거부하고, GitHub 푸시 뒤에 배포하며, 라이브 커밋에 `prod-live` 태그를 남긴다.
- 지금 라이브가 무슨 코드인지는 `git tag` 의 `prod-live` 와 `deploy-YYYYMMDD-HHMM(SS)` 태그로 확인한다. 사람 기억이나 메모에 의존하지 않는다.
- 실행은 `DEPLOY_BY="누가(세션·사람)" scripts/deploy-prod.sh`. 스크립트가 타입·lint·테스트를 먼저 돌려 하나라도 실패하면 push·배포 없이 멈추고, 한 번에 한 배포만 허용한다(`.git/deploy-prod.lock`).
- 배포 대장: `git tag -n1 -l 'deploy-*'`(언제·누가·라이브 커밋·새 커밋 수·롤백 대상) 또는 `.git/deploy-ledger.tsv`. 배포 전에 마지막 줄을 보고 다른 세션 배포와 겹치지 않는지 확인한다.
- 작업은 main 에서 브랜치를 따서(워크트리 권장: `git worktree add /Users/sy/weflab-worktrees/<이름> -b <브랜치> main`) 검증한 뒤 **main 에 합치고**(`git checkout main && git merge --ff-only <브랜치>`) main 에서 배포한다. 다른 브랜치에서 `vercel deploy` 하지 않는다.
- 테스트용 시안·실험 코드는 main 에 넣지 않는다. 자기 브랜치에 두고, 채택되면 그때 main 에 합친다. (2026-08~09 에 main 에 미배포 시안이 들어가 배포 줄기가 갈라졌던 사고의 재발 방지 규칙.)
- 2026-09-17 이전의 옛 main(P1 시안 포함)은 `archive/main-p1-2026-09-17` 브랜치에 있다.

## 건드리면 안 되는 곳 (sy 명시 승인 없이는 수정 금지)
- DB 스키마·마이그레이션, 인증(관리자 PIN·확장 토큰), 환경변수·시크릿, 위플랩 수집(extension)·판정 core 로직, 원본 데이터(raw_imports·audit_logs 삭제/변조).
- 운영 DB 에 쓰는 스크립트는 dry-run 결과를 sy 가 확인한 뒤에만 `--execute`.

## 검증 레인
- 로컬 미러: `/Users/sy/weflab-upbo-mirror` (라이브 스냅샷을 메모리 가짜 DB 로, 관리자 PIN 1234, 운영에 쓰기 0). `run-mirror*.sh` 로 워크트리별 포트에 띄운다.
- 완료 주장 전 최소: `npx tsc --noEmit`, `npm run lint`, `npx tsx --test tests/*.test.ts tests/*.test.mjs`, `npx next build`, 미러 실측(채루·포로미), 375px 가로 넘침 0.
- 화면 변경은 스크린샷을 남긴다(`/Users/sy/weflab-upbo-mirror/shots/<날짜-주제>/`).
