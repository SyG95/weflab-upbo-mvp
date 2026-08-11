import {
  WARDROBE_MAX_ITEMS,
  WARDROBE_PARTS,
  deleteWardrobeImages,
  getStreamerRowBySlug,
  getWardrobeBySlug,
  setWardrobe,
  uploadWardrobeImage,
  type WardrobeItem,
  type WardrobePart,
  type WardrobeState,
  type WardrobeTheme,
} from "@/lib/upboSupabase";
import { jsonError, jsonOk, readJson } from "@/lib/upboRoute";
import { requireSheetAdmin } from "@/lib/sheetAdminAuth";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ streamerSlug: string }> };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_NAME_LENGTH = 60;
const MAX_MEMO_LENGTH = 200;
const MAX_THEME_NAME_LENGTH = 30;
const MAX_THEMES = 20;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function badRequest(message: string): never {
  const error = new Error(message);
  (error as Error & { status?: number }).status = 400;
  throw error;
}

function cleanMonth(value: unknown): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!MONTH_PATTERN.test(s)) badRequest("적용 월 형식이 잘못됐어요 (예: 2026-08)");
  return s;
}

function cleanPart(value: unknown): WardrobePart {
  if (typeof value === "string" && (WARDROBE_PARTS as readonly string[]).includes(value)) {
    return value as WardrobePart;
  }
  badRequest("파츠는 의상·헤어·눈색·악세서리 중에서만 고를 수 있어요");
}

// 저장된 상태가 없으면 빈 옷장으로 시작한다 — 기본 테마 없음(테마는 스트리머가 직접 생성).
async function loadState(slug: string): Promise<WardrobeState> {
  const state = await getWardrobeBySlug(slug);
  return state ?? { themes: [], items: [] };
}

// 옷장(의상) 탭 편집. 관리자 로그인 세션(스트리머별 비밀번호)으로 인증한다.
// multipart = 이미지 1장 등록(add), JSON = 항목 수정/순서/삭제/테마 관리.
export async function POST(request: Request, context: RouteContext) {
  try {
    const { streamerSlug } = await context.params;
    await requireSheetAdmin(streamerSlug);
    const streamer = await getStreamerRowBySlug(streamerSlug);

    const contentType = request.headers.get("content-type") ?? "";
    const state = await loadState(streamerSlug);

    if (contentType.includes("multipart/form-data")) {
      // ── add: 이미지 1장 등록(클라이언트 업로드 큐가 한 장씩 보낸다 — 장별 실패 재시도용) ──
      if (state.items.length >= WARDROBE_MAX_ITEMS) {
        badRequest(`옷장은 숨김 포함 최대 ${WARDROBE_MAX_ITEMS}장까지 보관할 수 있어요`);
      }
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) badRequest("이미지 파일이 없어요");
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) badRequest("jpg/png/webp 이미지만 올릴 수 있어요");
      if (file.size > MAX_IMAGE_BYTES) badRequest("이미지는 8MB 이하만 올릴 수 있어요");

      const themeId = typeof formData.get("themeId") === "string" ? (formData.get("themeId") as string) : "";
      if (!state.themes.some((t) => t.id === themeId)) badRequest("없는 테마예요 — 새로고침 후 다시 시도해 주세요");
      const part = cleanPart(formData.get("part"));
      const month = cleanMonth(formData.get("month"));
      const nameRaw = formData.get("name");
      const name = (typeof nameRaw === "string" ? nameRaw : "").trim().slice(0, MAX_NAME_LENGTH);

      const url = await uploadWardrobeImage(streamerSlug, {
        bytes: await file.arrayBuffer(),
        contentType: file.type,
      });
      const maxOrder = state.items
        .filter((i) => i.themeId === themeId)
        .reduce((max, i) => Math.max(max, i.order), 0);
      const item: WardrobeItem = {
        id: randomBytes(8).toString("hex"),
        url,
        name: name || "이름 없음",
        themeId,
        part,
        month,
        memo: "",
        hidden: false,
        publishedAt: new Date().toISOString(),
        order: maxOrder + 1,
      };
      const next: WardrobeState = { themes: state.themes, items: [...state.items, item] };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next, addedId: item.id });
    }

    // ── JSON 액션 ──
    const body = await readJson<{
      action?: string;
      ids?: string[];
      set?: Partial<Pick<WardrobeItem, "name" | "memo" | "themeId" | "part" | "month" | "hidden">>;
      themeId?: string;
      orderedIds?: string[];
      themes?: Array<{ id?: string; name?: string }>;
    }>(request);
    const action = body.action ?? "";

    if (action === "patch") {
      const ids = new Set((body.ids ?? []).filter((id) => typeof id === "string"));
      if (ids.size === 0) badRequest("수정할 항목이 없어요");
      const set = body.set ?? {};
      if (set.themeId !== undefined && !state.themes.some((t) => t.id === set.themeId)) {
        badRequest("없는 테마예요 — 새로고침 후 다시 시도해 주세요");
      }
      const part = set.part !== undefined ? cleanPart(set.part) : undefined;
      const month = set.month !== undefined ? cleanMonth(set.month) : undefined;
      const nowIso = new Date().toISOString();
      // 테마 이동 시 order 재부여 — 기존 order 를 들고 가면 대상 테마 항목들과 값이 겹쳐
      // 정렬이 예측 불가하게 끼어든다. 이동한 항목은 대상 테마 맨 뒤에 순서대로 붙인다.
      let moveOrder =
        set.themeId !== undefined
          ? state.items
              .filter((i) => i.themeId === set.themeId)
              .reduce((max, i) => Math.max(max, i.order), 0)
          : 0;
      const items = state.items.map((item) => {
        if (!ids.has(item.id)) return item;
        const next = { ...item };
        if (typeof set.name === "string") next.name = set.name.trim().slice(0, MAX_NAME_LENGTH) || item.name;
        if (typeof set.memo === "string") next.memo = set.memo.trim().slice(0, MAX_MEMO_LENGTH);
        if (set.themeId !== undefined && set.themeId !== item.themeId) {
          next.themeId = set.themeId;
          moveOrder += 1;
          next.order = moveOrder;
        }
        if (part !== undefined) next.part = part;
        if (month !== undefined) next.month = month;
        if (typeof set.hidden === "boolean") {
          next.hidden = set.hidden;
          // 처음 공개되는 순간에만 NEW 기준 시각을 채운다(재공개는 NEW 아님).
          if (!set.hidden && !next.publishedAt) next.publishedAt = nowIso;
        }
        return next;
      });
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next });
    }

    if (action === "reorder") {
      const themeId = typeof body.themeId === "string" ? body.themeId : "";
      if (!state.themes.some((t) => t.id === themeId)) badRequest("없는 테마예요");
      // 중복 id 는 첫 등장만 인정(중복이 마지막 인덱스로 덮어쓰는 것 방지).
      const orderedIds = [...new Set((body.orderedIds ?? []).filter((id) => typeof id === "string"))];
      const orderOf = new Map(orderedIds.map((id, i) => [id, i + 1] as const));
      const items = state.items.map((item) =>
        item.themeId === themeId && orderOf.has(item.id) ? { ...item, order: orderOf.get(item.id)! } : item,
      );
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next });
    }

    if (action === "delete") {
      const ids = new Set((body.ids ?? []).filter((id) => typeof id === "string"));
      if (ids.size === 0) badRequest("삭제할 항목이 없어요");
      const removed = state.items.filter((i) => ids.has(i.id));
      const items = state.items.filter((i) => !ids.has(i.id));
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      // 저장 성공 후 파일 정리(모범 노력 — 실패해도 삭제는 이미 반영됨).
      await deleteWardrobeImages(removed.map((i) => i.url));
      return jsonOk({ ok: true, wardrobe: next });
    }

    if (action === "themes") {
      const raw = body.themes ?? [];
      if (raw.length === 0) badRequest("테마는 최소 1개 필요해요");
      if (raw.length > MAX_THEMES) badRequest(`테마는 최대 ${MAX_THEMES}개까지예요`);
      const themes: WardrobeTheme[] = raw.map((t) => {
        const name = (typeof t.name === "string" ? t.name : "").trim().slice(0, MAX_THEME_NAME_LENGTH);
        if (!name) badRequest("테마 이름이 비어 있어요");
        return { id: typeof t.id === "string" && t.id ? t.id : `t-${randomBytes(6).toString("hex")}`, name };
      });
      const keptIds = new Set(themes.map((t) => t.id));
      if (keptIds.size !== themes.length) badRequest("같은 테마 id 가 중복됐어요 — 새로고침 후 다시 시도해 주세요");
      // 항목이 남아있는 테마는 삭제 불가(고아 항목 방지) — 먼저 옮기거나 비워야 한다.
      // 이미 고아인 항목(themeId 가 애초에 목록에 없던 손상 데이터)은 이 검사로 테마 편집을
      // 영구히 막지 않도록, "지금 존재하는 테마를 지우려는 경우"만 본다.
      const prevIds = new Set(state.themes.map((t) => t.id));
      const orphan = state.items.find((i) => prevIds.has(i.themeId) && !keptIds.has(i.themeId));
      if (orphan) badRequest("항목이 남아있는 테마는 삭제할 수 없어요 — 항목을 먼저 옮기거나 지워 주세요");
      const next: WardrobeState = { themes, items: state.items };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next });
    }

    badRequest("알 수 없는 요청이에요");
  } catch (error) {
    return jsonError(error);
  }
}
