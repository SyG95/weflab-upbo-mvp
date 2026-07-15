"use client";
// 게시판 요청함(실험) 화면 — 나월 전용 임시 레인의 클라이언트 UI.
// 게시판 댓글은 이 브라우저(관리자)가 숲 공개 게시판에 직접 요청한다 — 숲 웹을 보는 것과 같은 경로.
// 저장은 "확인함" 체크(localStorage, 이 브라우저 한정)뿐. 업보 데이터에는 아무것도 쓰지 않는다.
import { useEffect, useMemo, useState } from "react";
import styles from "./boardRequests.module.css";

export type BoardReply = { nick: string; text: string; isStreamer: boolean };
export type BoardComment = {
  no: number;
  postNo: number;
  userId: string;
  nick: string;
  text: string;
  date: string;
  isStreamer: boolean;
  replies: BoardReply[];
};
export type SheetViewerLite = {
  nick: string;
  total: number;
  items: { name: string; qty: number }[];
};

type Props = {
  sheetViewers: Record<string, SheetViewerLite>;
  sheetOk: boolean;
  expiresAt: number;
  backHref: string;
};

// 나월 방송국의 업보·룰렛 공지 게시판 (soop-board-lab 실측과 동일 대상)
const BJ_ID = "moona00";
const BBS_NO = 116783847;
const CHAPI = "https://chapi.sooplive.co.kr/api";
const DONE_KEY = "upbo-board-requests-done-nawol";

function decodeEntities(s: string): string {
  const t = document.createElement("textarea");
  t.innerHTML = s || "";
  return t.value;
}

// 시트와 같은 규칙으로 계정ID 정규화: 겉 괄호 제거 (lib/api normalizeAccountId와 동일 취지).
function normId(raw: string): string {
  const v = (raw || "").trim();
  const m = v.match(/^\((.+)\)$/);
  return (m ? m[1] : v).trim();
}

async function loadBoard(): Promise<{ posts: Record<number, string>; comments: BoardComment[] }> {
  const posts: Record<number, string> = {};
  const comments: BoardComment[] = [];

  const boardRes = await fetch(
    `${CHAPI}/${BJ_ID}/board/${BBS_NO}?page=1&per_page=30&field=title,contents&keyword=&type=notice`,
  );
  if (!boardRes.ok) throw new Error(`게시판 목록 응답 ${boardRes.status}`);
  const board = await boardRes.json();
  for (const p of board?.data ?? []) posts[p.title_no] = decodeEntities(p.title_name);

  for (const titleNoStr of Object.keys(posts)) {
    const titleNo = Number(titleNoStr);
    let page = 1;
    for (;;) {
      const res = await fetch(`${CHAPI}/${BJ_ID}/title/${titleNo}/comment?page=${page}&orderby=reg_date`);
      if (!res.ok) throw new Error(`댓글 응답 ${res.status}`);
      const list = await res.json();
      const items = list?.data ?? [];
      for (const c of items) {
        const no = c.p_comment_no ?? 0;
        const entry: BoardComment = {
          no,
          postNo: titleNo,
          userId: normId(c.user_id),
          nick: c.user_nick,
          text: decodeEntities(c.comment).trim(),
          date: c.reg_date,
          isStreamer: c.user_id === BJ_ID,
          replies: [],
        };
        comments.push(entry);
        if ((c.c_comment_cnt ?? 0) > 0) {
          try {
            const repRes = await fetch(`${CHAPI}/${BJ_ID}/title/${titleNo}/comment/${no}/reply?page=1`);
            if (repRes.ok) {
              const rep = await repRes.json();
              for (const r of rep?.data ?? []) {
                entry.replies.push({
                  nick: r.user_nick,
                  text: decodeEntities(r.comment).trim(),
                  isStreamer: r.user_id === BJ_ID,
                });
              }
            }
          } catch {
            /* 답글 하나 실패는 무시 — 원댓글은 살린다 */
          }
        }
      }
      const last = list?.meta?.last_page ?? page;
      if (!items.length || page >= last) break;
      page += 1;
    }
  }
  return { posts, comments };
}

function chipTone(name: string): string {
  if (name.startsWith("💜")) return styles.chipP;
  if (name.startsWith("🍀")) return styles.chipG;
  if (name.startsWith("⭐") || name.startsWith("☆")) return styles.chipY;
  if (name.startsWith("🎀")) return styles.chipK;
  return "";
}

export default function BoardRequestsView({ sheetViewers, sheetOk, expiresAt, backHref }: Props) {
  const [board, setBoard] = useState<{ posts: Record<number, string>; comments: BoardComment[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copiedNo, setCopiedNo] = useState<number | null>(null);

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(DONE_KEY) || "{}"));
    } catch {
      /* 첫 방문 */
    }
    loadBoard()
      .then((b) => {
        setBoard(b);
        // 첫 시청자 줄은 펼쳐서 시작 — "줄을 클릭하면 펼쳐진다"를 보자마자 알 수 있게.
        const firstViewer = b.comments.find((c) => !c.isStreamer && c.text);
        if (firstViewer) setOpen({ [firstViewer.userId]: true });
      })
      .catch((e) => setLoadError(String(e?.message || e)));
  }, []);

  const setAllOpen = (want: boolean) => {
    const next: Record<string, boolean> = {};
    if (want) for (const c of board?.comments ?? []) if (!c.isStreamer && c.text) next[c.userId] = true;
    setOpen(next);
  };

  const toggleDone = (no: number) => {
    setDone((prev) => {
      const next = { ...prev, [String(no)]: !prev[String(no)] };
      if (!next[String(no)]) delete next[String(no)];
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify(next));
      } catch {
        /* 프라이빗 모드 등 — 체크가 새로고침에 안 남을 뿐 동작엔 지장 없음 */
      }
      return next;
    });
  };

  const hasSheet = sheetOk && Object.keys(sheetViewers).length > 0;

  // 시청자(계정ID) 단위 묶음 — 스트리머 본인 댓글과 빈(이모티콘) 댓글은 요청에서 제외.
  const grouped = useMemo(() => {
    const tops = (board?.comments ?? []).filter((c) => !c.isStreamer && c.text);
    const by: Record<string, BoardComment[]> = {};
    for (const c of tops) (by[c.userId] ||= []).push(c);
    const all = Object.entries(by);
    // 시트 데이터가 없으면(로드 실패) 전원을 매칭 없이 보여준다 — 빈 화면 금지.
    const matched = (hasSheet ? all.filter(([id]) => sheetViewers[id]) : all).sort(
      (a, b) => b[1].length - a[1].length,
    );
    const unmatched = hasSheet
      ? all.filter(([id]) => !sheetViewers[id]).flatMap(([, cs]) => cs)
      : [];
    return { matched, unmatched };
  }, [board, sheetViewers, hasSheet]);

  const expiresLabel = new Date(expiresAt - 1).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  });

  const copyToMemo = async (c: BoardComment) => {
    const line = `[게시판 ${c.date.slice(0, 10)}] ${c.text}`;
    try {
      await navigator.clipboard.writeText(line);
      setCopiedNo(c.no);
      setTimeout(() => setCopiedNo(null), 1600);
    } catch {
      window.prompt("복사가 막혀 있어요. 아래 내용을 직접 복사해 주세요:", line);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.banner}>
          <b>실험 화면</b> — 게시판 댓글이 업보시트 시청자와 자동으로 연결되면 어떤 모습인지 보는
          임시 페이지예요. <b>{expiresLabel}까지만</b> 열리고 자동으로 내려갑니다. 업보 기록은 읽기만
          하며, 여기서 바꾸는 것은 없어요.
        </div>

        <header className={styles.cover}>
          <div>
            <p className={styles.kicker}>임시 실험 · 게시판 연동</p>
            <h1 className={styles.title}>게시판 요청함</h1>
          </div>
          <a className={styles.backLink} href={backHref}>
            업보시트 관리자로
          </a>
        </header>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>시청자별 게시판 요청</h2>
          <p className={styles.hint}>
            업보·룰렛 공지 게시판의 댓글을 <b>숲 계정ID</b>로 시트 시청자와 자동 매칭했어요. 행을
            누르면 보유 업보와 요청이 함께 보입니다.
          </p>

          {!sheetOk ? (
            <p className={styles.hint}>
              ⚠️ 시트 보유업보를 불러오지 못해, 매칭 없이 게시판 댓글만 보여드려요.
            </p>
          ) : null}

          {board ? (
            <p className={styles.hint}>
              시청자 이름 줄을 클릭하면 펼쳐져요 ·{" "}
              <button type="button" className={styles.copyBtn} onClick={() => setAllOpen(true)}>
                모두 펼치기
              </button>{" "}
              <button type="button" className={styles.copyBtn} onClick={() => setAllOpen(false)}>
                모두 접기
              </button>
            </p>
          ) : null}

          {!board && !loadError ? <p className={styles.hint}>게시판 댓글 불러오는 중…</p> : null}
          {loadError ? (
            <p className={styles.hint}>
              ⚠️ 게시판을 불러오지 못했어요 ({loadError}). 새로고침 해도 안 되면 sy에게 알려주세요.
            </p>
          ) : null}

          <ul className={styles.list}>
            {grouped.matched.map(([id, cs]) => {
              const sheet = sheetViewers[id];
              const isOpen = open[id] ?? false;
              const doneCnt = cs.filter((c) => done[String(c.no)]).length;
              const displayNick = sheet?.nick ?? cs[cs.length - 1].nick;
              return (
                <li key={id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => setOpen((p) => ({ ...p, [id]: !isOpen }))}
                    aria-expanded={isOpen}
                  >
                    <span className={styles.caret}>{isOpen ? "▾" : "▸"}</span>
                    <span className={styles.name}>{displayNick}</span>
                    <span className={styles.id}>{id}</span>
                    {sheet ? <span className={styles.tag}>업보 {sheet.total}건</span> : null}
                    <span className={styles.tagNew}>💬 요청 {cs.length}</span>
                    {doneCnt > 0 ? <span className={styles.tagDone}>확인 {doneCnt}</span> : null}
                  </button>

                  {isOpen ? (
                    <div className={styles.panel}>
                      {sheet ? (
                        <>
                          <div className={styles.panelLabel}>보유 업보 — 시트 실데이터</div>
                          <div className={styles.chips}>
                            {sheet.items.map((it, i) => (
                              <span key={i} className={`${styles.chip} ${chipTone(it.name)}`}>
                                {it.name}
                                {it.qty > 1 ? <small>×{it.qty}</small> : null}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : null}

                      <div className={styles.panelLabel}>게시판에서 온 요청</div>
                      {cs.map((c) => (
                        <div key={c.no} className={done[String(c.no)] ? styles.reqDone : styles.req}>
                          <div className={styles.reqMeta}>
                            <label className={styles.check}>
                              <input
                                type="checkbox"
                                checked={!!done[String(c.no)]}
                                onChange={() => toggleDone(c.no)}
                              />
                              확인함
                            </label>
                            <span>{c.date.slice(0, 16)}</span>
                            <a
                              className={styles.postRef}
                              style={{ textDecoration: "underline", textUnderlineOffset: 2 }}
                              href={`https://www.sooplive.com/station/${BJ_ID}/post/${c.postNo}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              📌 {board?.posts[c.postNo] ?? "게시글"} 원문 ↗
                            </a>
                            {sheet && c.nick !== sheet.nick ? (
                              <span className={styles.nickNote}>작성 당시 닉: {c.nick}</span>
                            ) : null}
                          </div>
                          <div className={styles.reqText}>{c.text}</div>
                          {c.replies.map((r, i) => (
                            <div key={i} className={r.isStreamer ? styles.replyStreamer : styles.replyViewer}>
                              {r.isStreamer ? "🎙 나월 답변: " : `↳ ${r.nick}: `}
                              {r.text || "(이모티콘)"}
                            </div>
                          ))}
                          <button type="button" className={styles.copyBtn} onClick={() => copyToMemo(c)}>
                            {copiedNo === c.no ? "복사됨 ✓ 배송관리 메모에 붙여넣기" : "메모용 복사"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {grouped.unmatched.length > 0 ? (
            <details className={styles.unmatched}>
              <summary>
                시트에 없는 시청자의 댓글 {grouped.unmatched.length}건 — 업보와 무관해 따로 모아둠
              </summary>
              {grouped.unmatched.map((c) => (
                <div key={c.no} className={styles.req}>
                  <div className={styles.reqMeta}>
                    <span>
                      {c.nick} ({c.userId})
                    </span>
                    <span>{c.date.slice(0, 16)}</span>
                  </div>
                  <div className={styles.reqText}>{c.text}</div>
                </div>
              ))}
            </details>
          ) : null}
        </section>

        <footer className={styles.foot}>
          출처: 숲 공개 게시판(업보·룰렛 공지) 읽기 전용 · 매칭 기준: 숲 계정ID ↔ 시트 계정ID ·
          &quot;확인함&quot; 체크는 이 브라우저에만 저장 · {expiresLabel} 이후 자동 종료
        </footer>
      </div>
    </main>
  );
}
