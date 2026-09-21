export const designConcepts = [
 {id:'ref-c',agent:'Codex',name:'밀도 조정안',fan:'검색·상태 한 줄 축소',admin:'좁은 색인 · 단일 날짜 장부',tradeoff:''},
 {id:'ref-l',agent:'Claude',name:'비율 조정안',fan:'간결한 검색과 월 선택',admin:'Claude 제안 반영',tradeoff:''},
 {id:'ref-h',agent:'Hermes',name:'시청자 중심 조정안',fan:'간결한 검색과 월 선택',admin:'Hermes 제안 반영',tradeoff:''},
 {id:'ref-u',agent:'합의',name:'공동 수정안',fan:'작은 검색·한 줄 정보 · 빈 탭 숨김',admin:'시청자별 / 월별 기록 · 본문 저장',tradeoff:''},
 {id:'final',agent:'통합',name:'최종 마감안',fan:'작은 월 버튼 · 기존 시트 유지',admin:'시청자 색인 · 월별 일자 장부 · 시트 검토',tradeoff:''},
 {id:'c1',agent:'Codex',name:'익숙한 시트',fan:'표 위 작은 공통 월 선택',admin:'시청자 중심의 접이식 장부',tradeoff:'변화가 작고 익숙합니다. 많은 기록을 훑으려면 펼쳐야 합니다.'},
 {id:'c2',agent:'Codex',name:'월별 원장',fan:'표 위 얇은 월 탭',admin:'후원일 순 원장을 기본 화면으로',tradeoff:'월 마감 검토에 유리합니다. 팬별 응대는 시청자 보기로 전환합니다.'},
 {id:'l1',agent:'Claude',name:'장부 각주',fan:'기존 인원 표시 옆 작은 월 선택',admin:'시청자 요약을 한 행에 담은 표',tradeoff:'추가 면적이 가장 작습니다. 월 선택의 발견성은 낮습니다.'},
 {id:'l2',agent:'Claude',name:'색인 탭',fan:'검색 아래 월 색인 · 표는 그대로',admin:'긴 목록에서도 월·검색 도구를 고정',tradeoff:'조회 범위가 명확합니다. 모바일에서 도구막대가 차지하는 높이를 살펴보세요.'},
 {id:'h1',agent:'Hermes',name:'시청자 먼저',fan:'검색 옆 기간 선택 · 사람부터 찾기',admin:'시청자 명단에서 선택한 사람의 상세 보기',tradeoff:'팬별 응대가 빠릅니다. 전체 기록 비교에는 원장 보기를 사용합니다.'},
 {id:'h2',agent:'Hermes',name:'상품 먼저',fan:'룰렛 아래 월·상품으로 범위 좁히기',admin:'상품별 수량과 해당 시청자부터 확인',tradeoff:'같은 상품을 모아 보기 좋습니다. 상품 필터가 걸렸는지 확인해야 합니다.'},
 {id:'c3',agent:'Codex',name:'월 넘김 장부',fan:'이전·다음 버튼으로 월 이동',admin:'후원일별로 묶은 펼침 원장',tradeoff:''},
 {id:'c4',agent:'Codex',name:'연간 색인',fan:'연도와 숫자 월 색인',admin:'시청자 × 발생 월 수량표',tradeoff:''},
 {id:'l3',agent:'Claude',name:'각주 월주석',fan:'표 아래 월 텍스트 선택 · 해당 기록 강조',admin:'기록별 확인 표시가 있는 검수 목록',tradeoff:''},
 {id:'l4',agent:'Claude',name:'행내 월 셀',fan:'행 안의 월 값을 눌러 범위 선택',admin:'월 소계와 해당 월 상세를 나란히 표시',tradeoff:''},
 {id:'h3',agent:'Hermes',name:'월 명령줄',fan:'표 아래에서 월을 직접 입력',admin:'확인 항목별로 원본 내역 펼치기',tradeoff:''},
 {id:'h4',agent:'Hermes',name:'월 체크 필터',fan:'발생월 열에서 복수 월 선택',admin:'후원 내역과 완료 배분 내역 대조',tradeoff:''},
] as const;
export type DesignId = typeof designConcepts[number]['id'];
export function designId(value?:string):DesignId { return designConcepts.find(d=>d.id===value)?.id ?? 'c1'; }
export const monthLabel = (m:string) => m==='all'?'전체 기간':m==='etc'?'날짜 없음':`${m.slice(0,4)}.${m.slice(5)}`;
export type DesignRow = {id:string; ownerId:string; ownerName:string; item:string; group:string; month:string; date:string; timestamp:number|null; quantity:number; done:number};
export function monthsForSelect(months:string[]){
 const newest=months[0];if(!newest)return months;
 const [year,month]=newest.split('-').map(Number);
 return [...new Set([...months,...Array.from({length:12},(_,i)=>new Date(Date.UTC(year,month-1-i,1)).toISOString().slice(0,7))])].sort().reverse();
}

export const isRefinedDesign=(id:string)=>id.startsWith('ref-');
