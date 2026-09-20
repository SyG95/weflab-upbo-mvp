'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { AggItem, ViewerSummary } from '../../lib/api';
import { monthLabel } from '../../lib/designPreview';
import { resolveBucketId } from '../../lib/deliveryPeriod';
import { AGE_OLD_DAYS, ageDaysFrom } from '../../lib/deliveryAge';
import { soopStationUrl } from '../../lib/soopStation';
import s from './FinalDelivery.module.css';

export type FinalDeliveryRow = {
  v: ViewerSummary;
  it: AggItem;
  ref: NonNullable<AggItem['refs']>[number];
  alloc: { allocated: number; state: 'done' | 'part' | 'pending'; doneAt: string | null };
  aKey: string;
};

type PeopleSort = 'overdue' | 'remaining' | 'name';

// 시각 출처 배지 — 후원 원문 시각(donate)은 배지 없음.
const KIND_BADGE: Record<string, { label: string; title: string } | undefined> = {
  manual: { label: '수동', title: '수동기록 — 원문 후원 시각이 없어 기록 생성 시각' },
  manual_dated: { label: '수동', title: '수동기록 — 위플랩 원문이 아니라 스트리머가 적은 후원 날짜' },
  exchange: { label: '교환', title: '교환으로 받은 기록 — 교환된 시각이라 실제 대기 기간보다 짧아 보일 수 있어요' },
  created: { label: '반영', title: '원문 후원 시각을 해석하지 못해 시트 반영 시각' },
};

// Use identical ordering in Node and browser, including equal-date rows.
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const monthOf = (r: FinalDeliveryRow) =>
  resolveBucketId({ mode: 'monthly', cutoffs: [] }, r.ref.recordedAtMs ?? null, r.ref.recordedKind ?? null).replace(/^m:/, '');
const dayOf = (r: FinalDeliveryRow) =>
  monthOf(r) === 'etc' ? '기타' : new Date((r.ref.recordedAtMs ?? 0) + 9 * 3600000).toISOString().slice(0, 10);
const qty = (rs: FinalDeliveryRow[]) => rs.reduce((n, r) => n + r.ref.quantity, 0);
const done = (rs: FinalDeliveryRow[]) => rs.reduce((n, r) => n + r.alloc.allocated, 0);
const isPending = (r: FinalDeliveryRow) => r.alloc.state !== 'done';
// 시각 없는 조각(기타)은 어느 방향이든 맨 뒤.
const tsOf = (r: FinalDeliveryRow) => (typeof r.ref.recordedAtMs === 'number' ? r.ref.recordedAtMs : null);
const oldestFirst = (a: FinalDeliveryRow, b: FinalDeliveryRow) => {
  const ta = tsOf(a), tb = tsOf(b);
  if (ta === null || tb === null) return ta === tb ? compareText(a.aKey, b.aKey) : ta === null ? 1 : -1;
  return ta - tb || compareText(a.aKey, b.aKey);
};
const newestFirst = (a: FinalDeliveryRow, b: FinalDeliveryRow) => {
  const ta = tsOf(a), tb = tsOf(b);
  if (ta === null || tb === null) return ta === tb ? compareText(a.aKey, b.aKey) : ta === null ? 1 : -1;
  return tb - ta || compareText(a.aKey, b.aKey);
};
// 처리 대기열 순서: 미완료(오래된 순) → 완료(최근 순). 포로미 "오래된 업보부터" + 완료분은 최근 보낸 것 확인용.
// isPend 는 "이번 세션에 손댄 줄은 아직 미완료 자리에 둔다" 같은 예외를 끼워 넣기 위한 판정 함수.
const makeQueueOrder = (isPend: (r: FinalDeliveryRow) => boolean) => (a: FinalDeliveryRow, b: FinalDeliveryRow) => {
  const pa = isPend(a), pb = isPend(b);
  if (pa !== pb) return pa ? -1 : 1;
  return pa ? oldestFirst(a, b) : newestFirst(a, b);
};
function groups(rs: FinalDeliveryRow[], key: (r: FinalDeliveryRow) => string) {
  const m = new Map<string, FinalDeliveryRow[]>();
  for (const r of rs) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return [...m];
}
// 시청자 한 묶음의 "가장 밀린" 미완료 조각 경과일(시각 있는 조각 기준). 미완료가 없으면 null.
function oldestPendingDays(rs: FinalDeliveryRow[], nowMs: number, isPend: (r: FinalDeliveryRow) => boolean = isPending): number | null {
  let oldest: number | null = null;
  for (const r of rs) {
    if (!isPend(r)) continue;
    const t = tsOf(r);
    if (t !== null && (oldest === null || t < oldest)) oldest = t;
  }
  return oldest === null ? null : ageDaysFrom(oldest, nowMs);
}

export default function FinalDeliveryView({
  rows,
  initialMonth,
  disabled,
  onChange,
  onNote,
  design = 'final',
}: {
  design?: string;
  rows: FinalDeliveryRow[];
  initialMonth: string;
  disabled: boolean;
  onChange: (r: FinalDeliveryRow, n: number) => void;
  onNote: (v: ViewerSummary) => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<'viewers' | 'days' | 'sheet'>('viewers');
  const [search, setSearch] = useState('');
  // 기본 = 미완료. 배송 화면의 일은 "남은 것"이라 잔여 0 시청자를 목록에서 뺀다(전체 상태는 선택).
  const [status, setStatus] = useState('pending');
  // 이번 세션에 손댄 줄(aKey) — 미완료 필터에서도 저장 전까지 자리 유지(완료 누르는 순간 줄이 사라져
  // 입력 포커스가 끊기고 되돌릴 대상이 없어지는 문제 방지). 상태·월·검색을 바꾸면 비운다.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [peopleSort, setPeopleSort] = useState<PeopleSort>('overdue');
  const [viewer, setViewer] = useState('');
  const [review, setReview] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [unreviewed, setUnreviewed] = useState(false);
  // 경과일 기준 시각 — 세션 고정(DeliveryManager 와 동일 관례).
  const [nowMs] = useState(() => Date.now());
  const currentYear = new Date(nowMs + 9 * 3600000).getUTCFullYear();

  const refined = design.startsWith('ref-');
  const reviewView = view === 'sheet' || (refined && view === 'days');
  const monthGroups = useMemo(
    () => groups(rows, monthOf).sort(([a], [b]) => (a === 'etc' ? 1 : b === 'etc' ? -1 : compareText(a, b))),
    [rows],
  );
  const monthRows = useMemo(() => rows.filter((r) => month === 'all' || monthOf(r) === month), [rows, month]);
  const filtered = useMemo(
    () =>
      monthRows.filter(
        (r) =>
          (!search || `${r.v.fanNickname} ${r.v.fanId} ${r.it.itemName}`.toLowerCase().includes(search.toLowerCase())) &&
          (status === 'all' || touched.has(r.aKey) || (status === 'pending' ? isPending(r) : !isPending(r))) &&
          (!(reviewView && review && unreviewed) || !checked.has(r.aKey)),
      ),
    [monthRows, search, status, touched, reviewView, review, unreviewed, checked],
  );
  // 이번 세션에 손댄 줄은 완료로 바꿔도 자리를 지킨다(줄·시청자가 목록 아래로 튀어 입력 포커스가 끊기지 않게).
  // 저장·필터 변경 뒤 다시 계산되면 그때 완료 자리로 내려간다.
  const pendingOrTouched = useMemo(() => (r: FinalDeliveryRow) => isPending(r) || touched.has(r.aKey), [touched]);
  // 시청자별·시트 = 대기열 순서, 월별 기록(날짜 구분선) = 날짜 오름차순 한 줄기(기타는 맨 뒤 묶음).
  const queueRows = useMemo(() => [...filtered].sort(makeQueueOrder(pendingOrTouched)), [filtered, pendingOrTouched]);
  const ledgerRows = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const ea = dayOf(a) === '기타', eb = dayOf(b) === '기타';
        if (ea !== eb) return ea ? 1 : -1;
        return oldestFirst(a, b);
      }),
    [filtered],
  );
  const viewers = useMemo(
    () =>
      groups(queueRows, (r) => r.v.key)
        .map(([id, rs]) => ({
          id,
          rs,
          nick: rs[0].v.fanNickname || rs[0].v.fanId,
          remain: qty(rs) - done(rs),
          doneQty: done(rs),
          age: oldestPendingDays(rs, nowMs),
          // 정렬 키는 "손댄 줄=아직 미완료" 기준 — 완료 누른 시청자가 목록 아래로 튀지 않게.
          sortRemain: rs.reduce((n, r) => n + (touched.has(r.aKey) ? r.ref.quantity : r.ref.quantity - r.alloc.allocated), 0),
          sortAge: oldestPendingDays(rs, nowMs, pendingOrTouched),
        }))
        .sort((a, b) => {
          if (peopleSort === 'name') return compareText(a.nick, b.nick);
          if (peopleSort === 'remaining') return b.sortRemain - a.sortRemain || compareText(a.nick, b.nick);
          // overdue: 오래 밀린 시청자 먼저, 미완료 없는 시청자는 뒤로.
          if (a.sortAge !== b.sortAge) return a.sortAge === null ? 1 : b.sortAge === null ? -1 : b.sortAge - a.sortAge;
          return b.sortRemain - a.sortRemain || compareText(a.nick, b.nick);
        }),
    [queueRows, peopleSort, nowMs, touched, pendingOrTouched],
  );
  const selected = viewers.find((p) => p.id === viewer) ?? viewers[0];
  // 옛 시청자별 목록의 "방송국 ↗" 와 같은 링크. 계정ID가 없으면 null → 그리지 않는다.
  const stationUrl = selected ? soopStationUrl(selected.rs[0].v.fanId) : null;
  // 선택한 시청자가 목록에서 사라지면(필터·검색·저장) 선택을 비워 첫 시청자로 돌아간다.
  // 폴백(viewers[0])을 state 에 확정하지는 않는다 — 운영 저장값 로딩 전 임시 목록의 1번을 굳혀 버리는 경합 방지.
  useEffect(() => {
    if (viewer && !viewers.some((p) => p.id === viewer)) setViewer('');
  }, [viewers, viewer]);
  const changeMonth = (m: string) => {
    setMonth(m);
    setTouched(new Set());
    const p = new URLSearchParams(window.location.search);
    p.set('month', m);
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  };
  const changeStatus = (v: string) => {
    setStatus(v);
    setTouched(new Set());
  };
  const changeSearch = (v: string) => {
    setSearch(v);
    setTouched(new Set());
  };
  const edit = (r: FinalDeliveryRow, n: number) => {
    onChange(r, n);
    setTouched((prev) => (prev.has(r.aKey) ? prev : new Set(prev).add(r.aKey)));
  };
  // 날짜 칸: 시각이 있으면 출처(후원 원문/수동/교환/반영)와 무관하게 날짜를 보여주고 출처만 배지로 구분한다.
  // (옛 시청자별 목록과 같은 규칙. "날짜 미확인"은 시각 자체가 없는 조각만.) 월 묶음(기타)은 그대로 둔다.
  const dateText = (r: FinalDeliveryRow) => {
    const t = tsOf(r);
    if (t === null) return '날짜 미확인';
    const d = new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    return d.slice(0, 4) === String(currentYear) ? d.slice(5).replace('-', '.') : d.replaceAll('-', '.');
  };
  const kindBadge = (r: FinalDeliveryRow) => KIND_BADGE[r.ref.recordedKind ?? 'donate'];
  const rowAge = (r: FinalDeliveryRow) => {
    const t = tsOf(r);
    return isPending(r) && t !== null ? ageDaysFrom(t, nowMs) : null;
  };

  const table = (rs: FinalDeliveryRow[], showViewer = true, byDay = false) => (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <colgroup>
          {reviewView && review && <col style={{ width: 42 }} />}
          <col className={s.whenCol} />
          {showViewer && <col style={{ width: 125 }} />}
          <col />
          {[52, 62, 52, 90].map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {reviewView && review && <th>검토</th>}
            <th>후원일</th>
            {showViewer && <th>시청자</th>}
            <th>상품</th>
            <th>수량</th>
            <th>완료</th>
            <th>잔여</th>
            <th>배송 상태</th>
          </tr>
        </thead>
        <tbody>
          {rs.map((r, i) => {
            const age = rowAge(r);
            return (
              <Fragment key={r.aKey}>
                {byDay && (i === 0 || dayOf(rs[i - 1]) !== dayOf(r)) && (
                  <tr className={s.dateDivider}>
                    <th colSpan={(showViewer ? 7 : 6) + (reviewView && review ? 1 : 0)}>
                      {dayOf(r).replaceAll('-', '.')}
                      <span>{rs.filter((x) => dayOf(x) === dayOf(r)).length}건</span>
                    </th>
                  </tr>
                )}
                <tr data-entry={r.ref.entryId} data-state={r.alloc.state}>
                  {reviewView && review && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${r.v.fanNickname} ${r.it.itemName} 검토 표시`}
                        checked={checked.has(r.aKey)}
                        onChange={(e) =>
                          setChecked((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(r.aKey);
                            else n.delete(r.aKey);
                            return n;
                          })
                        }
                      />
                    </td>
                  )}
                  <td className={s.when}>
                    {dateText(r)}
                    {kindBadge(r) && (
                      <span className={s.kind} title={kindBadge(r)?.title}>
                        {kindBadge(r)?.label}
                      </span>
                    )}
                    {age !== null && (
                      <em className={s.age} data-old={age >= AGE_OLD_DAYS || undefined} title="후원일부터 오늘까지(그날=1일째)">
                        {age}일째
                      </em>
                    )}
                  </td>
                  {showViewer && (
                    <td>
                      {r.v.fanNickname || r.v.fanId}
                      <small>{r.v.fanId}</small>
                    </td>
                  )}
                  <td className={s.product}>
                    {r.it.itemName}
                    <span className={s.tag}>{r.it.amountRangeLabel || '분류 없음'}</span>
                  </td>
                  <td>{r.ref.quantity}</td>
                  <td>
                    <input
                      className={s.count}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={r.ref.quantity}
                      step={1}
                      value={r.alloc.allocated}
                      disabled={disabled || !r.v.fanId.trim()}
                      aria-label={`${r.v.fanNickname} ${r.it.itemName} ${dateText(r)} 완료 수량`}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) edit(r, Math.max(0, Math.min(r.ref.quantity, Math.trunc(n))));
                      }}
                    />
                  </td>
                  <td className={r.alloc.allocated < r.ref.quantity ? s.remaining : undefined}>{r.ref.quantity - r.alloc.allocated}</td>
                  <td>
                    <button
                      className={r.alloc.state === 'done' ? s.done : s.pending}
                      disabled={disabled || !r.v.fanId.trim()}
                      onClick={() => edit(r, r.alloc.state === 'done' ? 0 : r.ref.quantity)}
                      aria-label={`${r.v.fanNickname} ${r.it.itemName} ${dateText(r)} ${r.alloc.state === 'done' ? '배송 중으로 변경' : '완료 처리'}`}
                    >
                      {r.alloc.state === 'done' ? '완료 ✓' : r.alloc.state === 'part' ? '일부 완료' : '배송 중'}
                    </button>
                    {!r.v.fanId.trim() && <small>ID 필요</small>}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const monthButton = (m: string, rs: FinalDeliveryRow[]) => (
    <button key={m} aria-pressed={month === m} onClick={() => changeMonth(m)}>
      {monthLabel(m)}
      <small>{qty(rs)}개</small>
    </button>
  );
  const viewTabs = refined
    ? ([['viewers', '시청자별 목록'], ['days', '월별 기록']] as const)
    : ([['viewers', '시청자별 목록'], ['days', '월별 · 일별 기록'], ['sheet', '시트 보기']] as const);

  return (
    <div className={s.workspace}>
      <nav className={s.views} aria-label="관리 보기">
        {viewTabs.map(([id, label]) => (
          <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
      <nav className={s.months} aria-label="발생 월 선택">
        {monthButton('all', rows)}
        {monthGroups.map(([m, rs]) => monthButton(m, rs))}
        {month !== 'all' && !monthGroups.some(([m]) => m === month) && monthButton(month, [])}
      </nav>
      <div className={s.toolbar}>
        <input
          type="search"
          aria-label="시청자 또는 상품 검색"
          placeholder="시청자 · 아이디 · 상품 검색"
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
        />
        <select aria-label="배송 상태 필터" value={status} onChange={(e) => changeStatus(e.target.value)}>
          <option value="pending">미완료</option>
          <option value="done">완료</option>
          <option value="all">전체 상태</option>
        </select>
        {view === 'viewers' && (
          <select aria-label="시청자 정렬" value={peopleSort} onChange={(e) => setPeopleSort(e.target.value as PeopleSort)}>
            <option value="overdue">오래 밀린 순</option>
            <option value="remaining">잔여 많은 순</option>
            <option value="name">이름순</option>
          </select>
        )}
        <span>
          {monthLabel(month)} · {qty(monthRows)}개 <span className={s.muted}>중</span> 잔여 <b>{qty(monthRows) - done(monthRows)}</b>
        </span>
      </div>
      {reviewView && (
        <div className={s.review}>
          <label>
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> 검토 표시
          </label>
          {review && (
            <>
              <label>
                <input type="checkbox" checked={unreviewed} onChange={(e) => setUnreviewed(e.target.checked)} /> 미검토만
              </label>
              <span>현재 화면 확인용 · 배송 상태와 별개 · 새로고침 시 초기화</span>
            </>
          )}
        </div>
      )}
      {!filtered.length ? (
        <p className={s.empty}>
          {status === 'pending' && monthRows.length > 0
            ? `남은 배송이 없어요 — ${monthLabel(month)} ${qty(monthRows)}개 모두 완료.`
            : '이 조건에 해당하는 기록이 없습니다.'}
          {status !== 'all' && (
            <>
              {' '}
              <button type="button" className={s.emptyAction} onClick={() => changeStatus('all')}>
                전체 상태 보기
              </button>
            </>
          )}
        </p>
      ) : view === 'viewers' ? (
        <div className={s.split}>
          <nav className={s.people} aria-label="시청자 색인">
            {viewers.map((p) => (
              <button key={p.id} aria-pressed={selected?.id === p.id} data-old={p.age !== null && p.age >= AGE_OLD_DAYS ? 'true' : undefined} onClick={() => setViewer(p.id)}>
                <span className={s.who}>
                  <span className={s.nick}>{p.nick}</span>
                  <small>{p.rs[0].v.fanId}</small>
                </span>
                <span className={s.nums}>
                  <b>{status === 'done' ? p.doneQty : p.remain}</b>
                  <small>{p.age !== null ? `${p.age}일째` : status === 'done' || p.remain === 0 ? '완료' : '날짜 미확인'}</small>
                </span>
              </button>
            ))}
          </nav>
          <section className={s.detail}>
            {selected && (
              <>
                <header className={s.personHead}>
                  <div>
                    <h3>{selected.rs[0].v.fanNickname}</h3>
                    <small>
                      {selected.rs[0].v.fanId} · {monthLabel(month)}
                    </small>
                  </div>
                  <div className={s.personActions}>
                    <button disabled={disabled} onClick={() => onNote(selected.rs[0].v)}>
                      메모
                    </button>
                    {stationUrl && (
                      <a
                        href={stationUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={`${selected.rs[0].v.fanNickname || selected.rs[0].v.fanId} 방송국 열기 (새 탭)`}
                      >
                        방송국 ↗
                      </a>
                    )}
                  </div>
                </header>
                {table(selected.rs, false)}
              </>
            )}
          </section>
        </div>
      ) : view === 'days' && refined ? (
        table(ledgerRows, true, design === 'ref-c' || design === 'ref-u')
      ) : view === 'days' ? (
        <div className={s.days}>
          {groups(ledgerRows, dayOf).map(([day, rs]) => (
            <details key={`${month}:${day}`} open className={s.day}>
              <summary>
                <strong>{day === '기타' ? '날짜 미확인' : day.replaceAll('-', '.')}</strong>
                <span>
                  {rs.length}건 · {qty(rs)}개 <b>잔여 {qty(rs) - done(rs)}</b>
                </span>
              </summary>
              {table(rs)}
            </details>
          ))}
        </div>
      ) : (
        table(queueRows)
      )}
      <p className={s.foot}>
        후원 발생일 · 한국 시간 기준. 완료 수량은 현재 처리 결과입니다. 보기나 월을 바꿔도 입력한 변경은 유지되며, 아래 저장을 눌러 반영합니다.
      </p>
    </div>
  );
}
