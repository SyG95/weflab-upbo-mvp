import nextVitals from "eslint-config-next/core-web-vitals";

// .claude(다른 세션의 워크트리가 main 폴더 안에 생긴다)·.omc(작업 상태)는 앱 코드가 아니다.
// 배포 스크립트가 main 폴더에서 lint 를 돌리므로 여기서 빼 둔다(tsc 는 점 폴더를 원래 건너뛴다).
const eslintConfig = [...nextVitals, { ignores: [".claude/**", "**/.omc/**"] }];

export default eslintConfig;
