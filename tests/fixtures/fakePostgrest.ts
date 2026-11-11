// 시험용 가짜 PostgREST(node:http, 메모리) — 관문 2 넣기·되돌리기 계약 시험(PHASE1-TEST-PLAN §0 "새로 만들 가짜 PostgREST 기능").
//   - 요청당 1,000행 상한(운영 max-rows) + 키셋 커서(or=) + count=exact + JSON 경로 필터·select(별칭 포함)
//   - unique 제약(표별 열 묶음): 겹치면 409(23505), 한 요청은 통째로 실패(부분 삽입 없음)
//   - on_conflict + resolution=ignore-duplicates(ON CONFLICT DO NOTHING) + return=representation → 실제로 들어간 행만 돌려준다
//   - 쓰기는 전부 writes 에 남긴다(부수 쓰기 0 검사용). PATCH·DELETE 는 기록만 하고 데이터는 안 바꾼다.
// 실제 계정·닉네임은 쓰지 않는다(시험 데이터는 전부 합성).
import http from "node:http";
import crypto from "node:crypto";

type Row = Record<string, unknown>;

export type FakeWrite = { method: string; table: string; query: string; body: unknown; inserted: Row[] };

export type FakePostgrest = {
  db: Record<string, Row[]>;
  writes: FakeWrite[];
  gets: string[];
  url: string;
  reset(tables: Record<string, unknown[]>): void;
  // 동시성 시험: 이 표로 오는 POST 를 count 개가 모일 때까지 붙잡았다가 한꺼번에 놓는다(앞 요청의 확인 읽기가 끝난 뒤 쓰기가 겹치게).
  setPostBarrier(table: string, count: number): void;
  // 실패 흉내: 참을 돌려주는 POST 는 500 으로 실패한다(아무것도 안 들어감). n = 그 표로 온 POST 의 순번(1부터).
  setPostFailure(fail: ((table: string, body: unknown, n: number) => boolean) | null): void;
  // GET 을 처리하기 직전에 부른다(그 사이 다른 쓰기가 생기는 경쟁 흉내). n = 그 표로 온 GET 의 순번(1부터).
  // Promise 를 돌려주면 그동안 응답을 붙잡는다(동시 요청 수 측정용).
  setBeforeGet(hook: ((table: string, query: URLSearchParams, n: number) => void | Promise<void>) | null): void;
  close(): Promise<void>;
};

const CAP = 1000;

function col(row: Row, path: string): unknown {
  if (!path.includes("->")) return row[path];
  let cur: unknown = row;
  for (const part of path.split(/->>?/)) {
    // text 열(admin_note 등)은 JSON 경로로 못 읽는다 — 실제 PostgREST 와 같게 null.
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Row)[part];
  }
  return path.includes("->>") && cur !== null && typeof cur === "object" ? JSON.stringify(cur) : cur;
}

function cmp(a: unknown, b: string): number {
  const y = Number(b);
  if (typeof a === "number" && Number.isFinite(y)) return a - y;
  const s = String(a);
  return s < b ? -1 : s > b ? 1 : 0;
}

function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function cond(text: string): (row: Row) => boolean {
  const and = text.match(/^and\((.*)\)$/);
  if (and) {
    const parts = splitTop(and[1]).map(cond);
    return (row) => parts.every((f) => f(row));
  }
  const m = text.match(/^([A-Za-z0-9_>-]+)\.(.+)$/)!;
  return filter(m[1], m[2]);
}

function filter(key: string, expr: string): (row: Row) => boolean {
  const neg = expr.startsWith("not.");
  const body = neg ? expr.slice(4) : expr;
  const dot = body.indexOf(".");
  const op = body.slice(0, dot);
  const value = body.slice(dot + 1);
  let f: (v: unknown) => boolean;
  if (op === "eq") f = (v) => v !== null && v !== undefined && String(v) === value;
  else if (op === "neq") f = (v) => !(v !== null && v !== undefined && String(v) === value);
  else if (op === "in") {
    const set = new Set(value.slice(1, -1).split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1")));
    f = (v) => v !== null && v !== undefined && set.has(String(v));
  } else if (op === "like" || op === "ilike") {
    const re = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, op === "ilike" ? "i" : "");
    f = (v) => typeof v === "string" && re.test(v);
  } else if (op === "is") f = (v) => (value === "null" ? v === null || v === undefined : false);
  else if (["lt", "gt", "lte", "gte"].includes(op)) {
    f = (v) => {
      if (v === null || v === undefined) return false;
      const c = cmp(v, value);
      return op === "lt" ? c < 0 : op === "gt" ? c > 0 : op === "lte" ? c <= 0 : c >= 0;
    };
  } else throw new Error(`fake postgrest: unsupported ${key}=${expr}`);
  return (row) => (neg ? !f(col(row, key)) : f(col(row, key)));
}

function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === "*") return rows;
  return rows.map((row) =>
    Object.fromEntries(
      select.split(",").map((s) => {
        const m = s.match(/^([A-Za-z0-9_]+):(.+)$/);
        const expr = m ? m[2] : s;
        const name = m ? m[1] : expr.split(/->>?/).at(-1)!;
        return [name, col(row, expr) ?? null];
      }),
    ),
  );
}

// unique: 표 이름 → 겹치면 안 되는 열 묶음들(기본키 id 는 모든 표에 자동).
export async function startFakePostgrest(unique: Record<string, string[][]> = {}): Promise<FakePostgrest> {
  const db: Record<string, Row[]> = {};
  const writes: FakeWrite[] = [];
  const gets: string[] = [];
  const constraintsOf = (table: string) => [["id"], ...(unique[table] ?? [])];
  let barrier: { table: string; count: number; waiting: Array<() => void> } | null = null;
  let postFailure: ((table: string, body: unknown, n: number) => boolean) | null = null;
  let beforeGet: ((table: string, query: URLSearchParams, n: number) => void | Promise<void>) | null = null;
  const postCount = new Map<string, number>();
  const getCount = new Map<string, number>();
  const sameOn = (a: Row, b: Row, cols: string[]) => cols.every((c) => a[c] !== undefined && a[c] !== null && String(a[c]) === String(b[c]));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString("utf8");
    const prefer = String(req.headers.prefer ?? "");
    res.setHeader("content-type", "application/json");
    if (req.method === "POST") {
      if (barrier && barrier.table === table) {
        const gate = barrier;
        await new Promise<void>((release) => {
          gate.waiting.push(release);
          if (gate.waiting.length >= gate.count) {
            barrier = null;
            for (const go of gate.waiting) go();
          }
        });
      }
      const parsed = text ? JSON.parse(text) : null;
      const nth = (postCount.get(table) ?? 0) + 1;
      postCount.set(table, nth);
      if (postFailure && postFailure(table, parsed, nth)) {
        writes.push({ method: "POST", table, query: url.search, body: parsed, inserted: [] });
        res.statusCode = 500;
        return res.end(JSON.stringify({ message: "fake failure" }));
      }
      const incoming = (Array.isArray(parsed) ? parsed : [parsed]).filter((r) => r && typeof r === "object") as Row[];
      const rows = (db[table] ??= []);
      const conflictCols = (url.searchParams.get("on_conflict") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const ignoreDup = prefer.includes("ignore-duplicates");
      const merge = prefer.includes("merge-duplicates");
      const staged: Row[] = [];
      const inserted: Row[] = [];
      for (const raw of incoming) {
        const row: Row = { ...raw };
        if (row.id === undefined) row.id = crypto.randomUUID();
        if (row.created_at === undefined) row.created_at = new Date().toISOString();
        const pool = [...rows, ...staged];
        const onTarget = conflictCols.length ? pool.find((r) => sameOn(r, row, conflictCols)) : undefined;
        if (onTarget && (ignoreDup || merge)) {
          if (merge) Object.assign(onTarget, row);
          continue;
        }
        const violated = constraintsOf(table).find((cols) => pool.some((r) => sameOn(r, row, cols)));
        if (violated) {
          // 실제 Postgres 처럼 한 요청 전체가 실패한다(앞서 준비한 행도 안 들어감).
          writes.push({ method: "POST", table, query: url.search, body: parsed, inserted: [] });
          res.statusCode = 409;
          return res.end(JSON.stringify({ code: "23505", message: `duplicate key value violates unique constraint (${violated.join(",")})` }));
        }
        staged.push(row);
        inserted.push(row);
      }
      rows.push(...staged);
      writes.push({ method: "POST", table, query: url.search, body: parsed, inserted });
      res.statusCode = 201;
      return res.end(prefer.includes("return=representation") ? JSON.stringify(project(inserted, url.searchParams.get("select"))) : "");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      writes.push({ method: req.method ?? "", table, query: url.search, body: text ? JSON.parse(text) : null, inserted: [] });
      res.statusCode = 204;
      return res.end();
    }
    gets.push(`${table}?${url.searchParams.toString()}`);
    const getNth = (getCount.get(table) ?? 0) + 1;
    getCount.set(table, getNth);
    if (beforeGet) await beforeGet(table, url.searchParams, getNth);
    let rows = [...(db[table] ?? [])];
    for (const [key, value] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      if (key === "or") {
        const parts = splitTop(value.slice(1, -1)).map(cond);
        rows = rows.filter((row) => parts.some((f) => f(row)));
        continue;
      }
      rows = rows.filter(filter(key, value));
    }
    const total = rows.length;
    const order = url.searchParams.get("order");
    if (order) {
      const keys = order.split(",").map((p) => ({ c: p.split(".")[0], desc: p.includes(".desc") }));
      rows.sort((a, b) => {
        for (const k of keys) {
          const va = col(a, k.c);
          const vb = col(b, k.c);
          const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
          if (c !== 0) return k.desc ? -c : c;
        }
        return 0;
      });
    }
    const limit = Math.min(Number(url.searchParams.get("limit") || CAP), CAP);
    const projected = project(rows.slice(0, limit), url.searchParams.get("select"));
    if (prefer.includes("count=exact")) res.setHeader("content-range", `0-${Math.max(0, projected.length - 1)}/${total}`);
    res.statusCode = 200;
    res.end(req.method === "HEAD" ? "" : JSON.stringify(projected));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake postgrest: no address");
  return {
    db,
    writes,
    gets,
    url: `http://127.0.0.1:${address.port}`,
    reset(tables) {
      barrier = null;
      postFailure = null;
      beforeGet = null;
      postCount.clear();
      getCount.clear();
      for (const key of Object.keys(db)) delete db[key];
      for (const [k, v] of Object.entries(tables)) db[k] = structuredClone(v) as Row[];
      writes.length = 0;
      gets.length = 0;
    },
    setPostBarrier(table, count) {
      barrier = { table, count, waiting: [] };
    },
    setPostFailure(fail) {
      postFailure = fail;
    },
    setBeforeGet(hook) {
      beforeGet = hook;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
