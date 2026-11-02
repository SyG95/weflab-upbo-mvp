// 실제 목록/상세 TSX 분기와 방문자 DTO를 메모리에서 함께 실행한다.
// 인증/데이터 I/O와 클라이언트 컴포넌트 경계만 대체하고, 페이지·방문자 화면·DTO는 실제 소스를 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = "PRIVATE-RENDER-CANARY";
const PRIVATE = {
  fanNickname: CANARY, fanId: CANARY, rawText: CANARY, sourceKey: CANARY,
  token: CANARY, password: CANARY, ip: CANARY, currentUrl: CANARY,
  raw: { payload: CANARY }, deliveryProgress: [{ fanId: CANARY }],
};

function rawIndex() {
  return { ok: true, streamers: [{
    ...PRIVATE, slug: "demo", displayName: "공개 시트", thresholdPercent: 2,
    recordSum: 4, needsReviewSum: 1, batchCount: 2, lastAppliedAt: "2026-11-02T03:30:00Z",
    extensionConfig: { secret: CANARY }, extension: { notes: [CANARY], screenSummary: CANARY },
  }] };
}

function rawDashboard() {
  return { ok: true, data: {
    ...PRIVATE, source: "live", slug: "demo", displayName: "공개 시트", thresholdPercent: 2,
    currentCatalogVersion: 3, rederiveAvailable: true,
    counts: { batches: 2, catalogs: 1, rawResults: 9, record: 4, ignore: 2, duplicate: 2, needsReview: 1, reflections: 4 },
    batches: [{ ...PRIVATE, id: CANARY, catalogVersion: 3, entryCount: 4, appliedAt: "2026-11-02T03:30:00Z",
      officialSummary: { ...PRIVATE, totalResults: 9, recordCount: 4, ignoreCount: 2, duplicateCount: 2, needsReviewCount: 1 },
      rawAvailable: true, rederivedSummary: PRIVATE }],
    catalogs: [{ ...PRIVATE, version: 3, isCurrent: true, capturedAt: "2026-11-01T00:00:00Z", groupCount: 2,
      itemCount: 7, warnings: [CANARY], probabilitySums: [], groups: [{ fanNickname: CANARY }] }],
    rawResults: [PRIVATE], decisions: [PRIVATE], needsReview: [PRIVATE], reflections: [PRIVATE],
  } };
}

function harness({ access = "locked", visitor = false } = {}) {
  const calls = [];
  function load(relative, mocks) {
    const filename = path.join(root, relative);
    const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const box = { exports: {} };
    vm.runInNewContext(js, {
      module: box, exports: box.exports, Date, Map, Set, Intl, URLSearchParams, console,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name === "react/jsx-runtime") return require(name);
        if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        throw new Error(`Unexpected dependency in ${relative}: ${name}`);
      },
      fetch() { throw new Error("Network access is forbidden in render tests"); },
    }, { filename });
    return box.exports;
  }

  const safeData = load("lib/adminVisitorData.ts", {
    "./adminDashboard": {
      getAdminIndex: async () => { calls.push("safe-source-index"); return rawIndex(); },
      getAdminDashboardData: async () => { calls.push("safe-source-dashboard"); return rawDashboard(); },
    },
  });
  function StreamerListBoundary(props) {
    // 그대로 직렬화해 SSR 경계에 잘못 넘어온 비공개 값도 HTML canary 검사로 잡는다.
    return React.createElement("pre", { "data-testid": "streamer-list" }, JSON.stringify(props));
  }
  function AddStreamerBoundary() { return React.createElement("div", null, "ADD_STREAMER_OPERATOR_ONLY"); }
  function AdminGateBoundary() { return React.createElement("div", null, "AUTH_GATE"); }
  const auth = { adminAccessState: async () => access };
  const visitorAuth = { adminVisitorAccessState: async () => visitor };
  const actions = { lockAdminOrVisitor() { throw new Error("Unexpected mutation"); } };
  const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  const operatorData = {
    getAdminIndex: async () => { calls.push("operator-index"); return rawIndex(); },
    getAdminDashboardData: async () => { calls.push("operator-dashboard"); return rawDashboard(); },
  };
  const mockData = {
    getMockAdminIndex: () => { calls.push("mock-index"); return rawIndex().streamers; },
    getMockAdminDashboardData: () => { calls.push("mock-dashboard"); return rawDashboard().data; },
  };
  const shared = {
    "next/link": link, "@/lib/adminAuth": auth, "@/lib/adminVisitorAccess": visitorAuth,
    "@/lib/adminDashboard": operatorData, "@/lib/adminVisitorData": safeData,
    "@/lib/adminDashboardMock": mockData,
  };
  const visitorPage = load("app/admin/[streamerSlug]/VisitorDashboard.tsx", {
    ...shared, "../visitorActions": actions,
  }).default;
  const indexPage = load("app/admin/page.tsx", {
    ...shared, "./visitorActions": actions, "./StreamerList": { __esModule: true, default: StreamerListBoundary },
    "./AddStreamerForm": { __esModule: true, default: AddStreamerBoundary },
    "./AdminGate": { __esModule: true, default: AdminGateBoundary },
  }).default;
  const detailPage = load("app/admin/[streamerSlug]/page.tsx", {
    ...shared, "../visitorActions": actions,
    "../AdminGate": { __esModule: true, default: AdminGateBoundary },
    "./VisitorDashboard": { __esModule: true, default: visitorPage },
    "./FilterableTable": { __esModule: true, default() { return null; } },
    "@/lib/accuracyStats": { computeAccuracyStats() { throw new Error("Visitor must not compute private accuracy data"); } },
  }).default;
  return { calls, indexPage, detailPage, visitorPage, StreamerListBoundary, AddStreamerBoundary, AdminGateBoundary };
}

function elements(tree) {
  const result = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!React.isValidElement(value)) return;
    result.push(value);
    walk(value.props.children);
  }
  walk(tree);
  return result;
}

function assertNoPrivateProps(value, seen = new WeakSet()) {
  if (typeof value === "string") assert.ok(!value.includes(CANARY), "private canary reached rendered props");
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!Object.hasOwn(PRIVATE, key), `private field reached rendered props: ${key}`);
    assertNoPrivateProps(nested, seen);
  }
}

const queries = [{}, { mock: "1" }, { tab: "raw" }, { tab: "raw", mock: "1" }, { tab: "reflection", mock: "1" }];

test("locked/unconfigured pages render only the gate; query parameters cannot trigger any source loader", async () => {
  for (const access of ["locked", "blocked-unconfigured"]) {
    for (const query of queries) {
      const h = harness({ access });
      const index = await h.indexPage({ searchParams: Promise.resolve(query) });
      const detail = await h.detailPage({ params: Promise.resolve({ streamerSlug: "demo" }), searchParams: Promise.resolve(query) });
      assert.ok(elements(index).some((el) => el.type === h.AdminGateBoundary));
      assert.ok(elements(detail).some((el) => el.type === h.AdminGateBoundary));
      assert.deepEqual(h.calls, [], "unauthenticated requests must not load even safe summaries");
    }
  }
});

test("visitor index uses the actual whitelist DTO at the client boundary, including mock/raw query attempts", async () => {
  for (const access of ["locked", "blocked-unconfigured", "open-unconfigured"]) {
    for (const query of queries) {
      const h = harness({ access, visitor: true });
      const tree = await h.indexPage({ searchParams: Promise.resolve(query) });
      const list = elements(tree).find((el) => el.type === h.StreamerListBoundary);
      assert.ok(list);
      assert.equal(list.props.readOnly, true);
      assert.equal(list.props.isMock, false, "visitor query must never enter the operator mock branch");
      assert.deepEqual(Object.keys(list.props.streamers[0]).sort(), ["displayName", "lastAppliedAt", "needsReviewSum", "recordSum", "slug"]);
      assert.ok(!elements(tree).some((el) => el.type === h.AddStreamerBoundary));
      assertNoPrivateProps(tree);
      const html = renderToStaticMarkup(tree);
      assert.match(html, /방문자 · 읽기 전용/);
      assert.ok(!html.includes(CANARY));
      assert.ok(!html.includes("ADD_STREAMER_OPERATOR_ONLY"));
      assert.deepEqual(h.calls, ["safe-source-index"]);
    }
  }
});

test("visitor detail short-circuits to the real restricted server component before full/mock loading", async () => {
  for (const access of ["locked", "blocked-unconfigured", "open-unconfigured"]) {
    for (const query of [...queries, { tab: "catalog", mock: "1" }]) {
      const h = harness({ access, visitor: true });
      const entry = await h.detailPage({ params: Promise.resolve({ streamerSlug: "demo" }), searchParams: Promise.resolve(query) });
      assert.equal(entry.type, h.visitorPage);
      assert.deepEqual(h.calls, [], "route must delegate without loading operator data");
      const tree = await entry.type(entry.props);
      assertNoPrivateProps(tree);
      const html = renderToStaticMarkup(tree);
      assert.match(html, /방문자 · 읽기 전용/);
      assert.match(html, /공개 시트/);
      assert.ok(!html.includes(CANARY));
      assert.deepEqual(h.calls, ["safe-source-dashboard"]);
      if (query.tab === "raw" || query.tab === "reflection") assert.match(html, /요청한 탭은 운영자 전용/);
      assert.ok(!elements(tree).some((el) => typeof el.props?.data?.rawResults !== "undefined"));
    }
  }
});

test("operator authentication retains precedence over visitor session and the original full/mock branches", async () => {
  for (const query of [{}, { mock: "1", tab: "raw" }]) {
    const h = harness({ access: "authed", visitor: true });
    const index = await h.indexPage({ searchParams: Promise.resolve(query) });
    const list = elements(index).find((el) => el.type === h.StreamerListBoundary);
    assert.equal(list.props.readOnly, false);
    assert.equal(list.props.streamers[0].fanId, CANARY, "operator data must not be replaced by visitor summaries");
    assert.equal(elements(index).some((el) => el.type === h.AddStreamerBoundary), !query.mock);
    const detail = await h.detailPage({ params: Promise.resolve({ streamerSlug: "demo" }), searchParams: Promise.resolve(query) });
    assert.notEqual(detail.type, h.visitorPage);
    assert.ok(elements(detail).some((el) => el.props.data?.fanId === CANARY));
    assert.deepEqual(h.calls, query.mock ? ["mock-index", "mock-dashboard"] : ["operator-index", "operator-dashboard"]);
  }
});
