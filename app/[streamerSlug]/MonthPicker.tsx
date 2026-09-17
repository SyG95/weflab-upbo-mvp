'use client';
import styles from './MonthPicker.module.css';
import { monthLabel, monthsForSelect, type DesignId } from '../../lib/designPreview';
import type { MonthlyTotal } from '../../lib/fanMonthly';
export default function MonthPicker({months,selected,reflect,total,etcCount,unavailable,design='c1',products=[],product=''}:{slug:string;months:string[];selected:string;reflect:boolean;total:MonthlyTotal;etcCount:number;unavailable:boolean;query:Record<string,string>;design?:DesignId;products?:string[];product?:string}){
 const change=(key:string,value:string)=>{const p=new URLSearchParams(window.location.search);p.set(key,value);p.delete('tab');window.location.href=`${window.location.pathname}?${p}`;};
 const selectMonths=monthsForSelect(months);
 const select=<select aria-label="발생 월 선택" value={selected} onChange={e=>change('month',e.target.value)}><option value="all">전체 기간</option>{selectMonths.map(m=><option value={m} key={m}>{monthLabel(m)}{!months.includes(m)?' · 기록 없음':''}</option>)}{selected!=='all'&&selected!=='etc'&&!selectMonths.includes(selected)&&<option value={selected}>{monthLabel(selected)} · 기록 없음</option>}<option value="etc">기타 · 날짜 미확인 ({etcCount})</option></select>;
 const selectedIndex=months.indexOf(selected);
 const rail=<nav className={styles.rail} aria-label="월 선택">{(design==='final'||design.startsWith('ref-'))&&<button aria-label="이전 기록 월" disabled={selectedIndex<0||selectedIndex>=months.length-1} onClick={()=>change('month',months[selectedIndex+1])}>‹</button>}{['all',...months.slice(0,4),'etc'].map(m=><button key={m} title={monthLabel(m)} aria-pressed={m===selected} onClick={()=>change('month',m)}>{m==='all'?'전체':m==='etc'?'기타':`${m.slice(0,4)!==months[0]?.slice(0,4)?m.slice(0,4)+'.':''}${Number(m.slice(5))}월`}</button>)}{months.length>4&&select}{(design==='final'||design.startsWith('ref-'))&&<button aria-label="다음 기록 월" disabled={selectedIndex<=0} onClick={()=>change('month',months[selectedIndex-1])}>›</button>}</nav>;
 return <section className={styles.panel} data-design={design} aria-label="발생 월별 업보">
  <div className={styles.controls}>
   {design==='c2'||design==='l2'||(design==='final'||design.startsWith('ref-'))?rail:<>{design==='l1'?null:<span className={styles.label}>발생 월</span>}{select}</>}
   {design==='h2'&&<select aria-label="상품 선택" value={product} onChange={e=>change('product',e.target.value)}><option value="">상품 전체</option>{product&&!products.includes(product)&&<option value={product}>{product} · 기록 없음</option>}{products.map(p=><option key={p}>{p}</option>)}</select>}
   <span className={styles.totals} data-month-summary={selected} title="선택한 월의 모든 룰렛 수량. 완료는 현재까지의 처리 결과입니다.">{reflect?<>월 전체 잔여 <b>{total.remaining.toLocaleString()}</b><span className={styles.secondary}> / {total.quantity.toLocaleString()}개</span></>:<>업보 <b>{total.quantity.toLocaleString()}</b>개</>}</span>
   <details className={styles.help}><summary aria-label="월별 집계 안내">ⓘ</summary><p>후원 발생일 · 한국 시간 기준. 날짜가 없는 기록은 기타에 모입니다. 수량은 이 월의 모든 룰렛 기준이며{reflect?' 완료는 현재까지의 처리 결과입니다.':' 완료 반영이 꺼져 있습니다.'}{reflect?` 완료 ${total.delivered}개.`:''}<label className={styles.otherMonth}>다른 월 조회<input type="month" aria-label="다른 발생 월" onChange={e=>e.target.value&&change('month',e.target.value)} /></label></p></details>
  </div>
  {design==='h2'&&product?<p className={styles.note}>상품: {product} <button onClick={()=>change('product','')}>해제</button></p>:null}
  {unavailable?<p className={styles.note}>완료 정보를 불러오지 못했습니다. 새로고침해 주세요.</p>:null}
  {selected==='etc'?<p className={styles.note}>후원 날짜를 확인할 수 없는 기록입니다.</p>:null}
  {total.quantity===0?<p className={styles.note}>이 월에는 기록이 없습니다. <button onClick={()=>change('month','all')}>전체 기간 보기</button></p>:null}
 </section>;
}
