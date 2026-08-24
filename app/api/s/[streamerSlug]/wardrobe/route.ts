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
// 목록용 썸네일(~320px)은 수십 KB 가 정상 — 2MB 넘으면 썸네일이 아니라 실수다.
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_NAME_LENGTH = 60;
const MAX_MEMO_LENGTH = 200;
const MAX_THEME_NAME_LENGTH = 30;
const MAX_VARIANT_LENGTH = 20;
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

// 멤버가 1장만 남은 색상 세트는 자동 해체 — 삭제·풀기·부분 재묶기 뒤 "혼자 남은 세트"가
// 팬 화면에 칩 없는 세트로 어정쩡하게 남지 않게 한다.
function dissolveLonelySets(items: WardrobeItem[]): WardrobeItem[] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.setId) counts.set(i.setId, (counts.get(i.setId) ?? 0) + 1);
  return items.map((i) => (i.setId && (counts.get(i.setId) ?? 0) < 2 ? { ...i, setId: "" } : i));
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
      const formData = await request.formData();

      // ── thumbFor: 기존 컷에 목록용 썸네일 부착(구버전 컷 마이그레이션·재생성 전용) ──
      // 보관 상한과 무관(새 컷이 아니라 파생본 추가). 옛 썸네일은 교체 후 모범 노력으로 정리.
      const thumbFor = formData.get("thumbFor");
      if (typeof thumbFor === "string" && thumbFor) {
        const target = state.items.find((i) => i.id === thumbFor);
        if (!target) badRequest("없는 컷이에요 — 새로고침 후 다시 시도해 주세요");
        const file = formData.get("file");
        if (!(file instanceof File) || file.size === 0) badRequest("썸네일 파일이 없어요");
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) badRequest("jpg/png/webp 이미지만 올릴 수 있어요");
        if (file.size > MAX_THUMB_BYTES) badRequest("썸네일은 2MB 이하여야 해요");
        const url = await uploadWardrobeImage(streamerSlug, {
          bytes: await file.arrayBuffer(),
          contentType: file.type,
        });
        const oldThumb = target.thumbUrl;
        const items = state.items.map((i) => (i.id === thumbFor ? { ...i, thumbUrl: url } : i));
        const next: WardrobeState = { themes: state.themes, items };
        await setWardrobe(streamer, next);
        if (oldThumb) await deleteWardrobeImages([oldThumb]);
        return jsonOk({ ok: true, wardrobe: next });
      }

      // ── add: 이미지 1장 등록(클라이언트 업로드 큐가 한 장씩 보낸다 — 장별 실패 재시도용) ──
      if (state.items.length >= WARDROBE_MAX_ITEMS) {
        badRequest(`옷장은 숨김 포함 최대 ${WARDROBE_MAX_ITEMS}장까지 보관할 수 있어요`);
      }
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
      // 업로드 시 색상 지정(8/12 sy 지시) — 큐에서 장별로 적은 색상 라벨. 빈 값 허용.
      const variantRaw = formData.get("variant");
      const variant = (typeof variantRaw === "string" ? variantRaw : "").trim().slice(0, MAX_VARIANT_LENGTH);

      // 목록용 썸네일(선택) — 클라이언트가 ~320px 파생본을 함께 보낸다. 없으면 원본 폴백("").
      const thumbFile = formData.get("thumb");
      let thumbUrl = "";
      if (thumbFile instanceof File && thumbFile.size > 0) {
        if (!ALLOWED_IMAGE_TYPES.has(thumbFile.type)) badRequest("썸네일은 jpg/png/webp 만 돼요");
        if (thumbFile.size > MAX_THUMB_BYTES) badRequest("썸네일은 2MB 이하여야 해요");
      }

      const url = await uploadWardrobeImage(streamerSlug, {
        bytes: await file.arrayBuffer(),
        contentType: file.type,
      });
      if (thumbFile instanceof File && thumbFile.size > 0) {
        thumbUrl = await uploadWardrobeImage(streamerSlug, {
          bytes: await thumbFile.arrayBuffer(),
          contentType: thumbFile.type,
        });
      }
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
        setId: "",
        variant,
        featured: false,
        thumbUrl,
      };
      const next: WardrobeState = { themes: state.themes, items: [...state.items, item] };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next, addedId: item.id });
    }

    // ── JSON 액션 ──
    const body = await readJson<{
      action?: string;
      ids?: string[];
      set?: Partial<Pick<WardrobeItem, "name" | "memo" | "themeId" | "part" | "month" | "hidden" | "variant" | "featured">>;
      themeId?: string;
      orderedIds?: string[];
      themes?: Array<{ id?: string; name?: string }>;
      name?: string;
      variants?: Record<string, string>;
    }>(request);
    const action = body.action ?? "";

    if (action === "patch") {
      const ids = new Set((body.ids ?? []).filter((id) => typeof id === "string"));
      if (ids.size === 0) badRequest("수정할 항목이 없어요");
      const set = body.set ?? {};
      if (set.themeId !== undefined && !state.themes.some((t) => t.id === set.themeId)) {
        badRequest("없는 테마예요 — 새로고침 후 다시 시도해 주세요");
      }
      // 세트에 묶인 컷의 테마 이동은 세트 전체가 함께일 때만 — 부분 이동은 "세트=같은 테마"
      // 불변식을 깨므로 명시적으로 막는다(조용한 자동 해체보다 안내가 낫다).
      if (set.themeId !== undefined) {
        const bySet = new Map<string, { total: number; moving: number }>();
        for (const item of state.items) {
          if (!item.setId) continue;
          const c = bySet.get(item.setId) ?? { total: 0, moving: 0 };
          c.total += 1;
          if (ids.has(item.id)) c.moving += 1;
          bySet.set(item.setId, c);
        }
        for (const c of bySet.values()) {
          if (c.moving > 0 && c.moving < c.total) {
            badRequest("색상 세트로 묶인 컷은 세트 전체를 함께 옮기거나, 먼저 세트를 풀어 주세요");
          }
        }
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
        // 색상 라벨은 빈 값 저장 허용(라벨 지우기) — 이름과 달리 기본값 폴백이 없다.
        if (typeof set.variant === "string") next.variant = set.variant.trim().slice(0, MAX_VARIANT_LENGTH);
        if (typeof set.featured === "boolean") next.featured = set.featured;
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

    if (action === "group") {
      // ── 색상 세트 묶기: 같은 의상의 색상 변형들을 한 세트로(이름 통일 + 컷별 색상 라벨) ──
      const ids = [...new Set((body.ids ?? []).filter((id): id is string => typeof id === "string"))];
      if (ids.length < 2) badRequest("색상 세트는 2장 이상 골라야 묶을 수 있어요");
      const members = state.items.filter((i) => ids.includes(i.id));
      if (members.length !== ids.length) badRequest("없는 컷이 있어요 — 새로고침 후 다시 시도해 주세요");
      if (new Set(members.map((i) => i.part)).size > 1) badRequest("파츠가 다른 컷은 한 세트로 묶을 수 없어요");
      if (new Set(members.map((i) => i.themeId)).size > 1) {
        badRequest("테마가 다른 컷은 먼저 같은 테마로 옮긴 뒤 묶어 주세요");
      }
      // 선택 안에 기존 세트가 정확히 하나면 그 세트에 흡수(세트에 컷 추가), 아니면 새 세트.
      const existing = [...new Set(members.map((i) => i.setId).filter(Boolean))];
      const setId = existing.length === 1 ? existing[0] : `set-${randomBytes(6).toString("hex")}`;
      const setName = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
      const variants = body.variants && typeof body.variants === "object" ? body.variants : {};
      let items = state.items.map((item) => {
        if (!ids.includes(item.id)) return item;
        const v = (variants as Record<string, unknown>)[item.id];
        return {
          ...item,
          setId,
          name: setName || item.name,
          variant: typeof v === "string" ? v.trim().slice(0, MAX_VARIANT_LENGTH) : item.variant,
        };
      });
      // 두 세트에서 일부씩 꺼내 새로 묶으면 원래 세트에 1장씩 남을 수 있다 — 자동 해체.
      items = dissolveLonelySets(items);
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next });
    }

    if (action === "ungroup") {
      const ids = new Set((body.ids ?? []).filter((id) => typeof id === "string"));
      if (ids.size === 0) badRequest("세트에서 풀 컷을 골라 주세요");
      const items = dissolveLonelySets(
        state.items.map((i) => (ids.has(i.id) ? { ...i, setId: "" } : i)),
      );
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      return jsonOk({ ok: true, wardrobe: next });
    }

    if (action === "delete") {
      const ids = new Set((body.ids ?? []).filter((id) => typeof id === "string"));
      if (ids.size === 0) badRequest("삭제할 항목이 없어요");
      const removed = state.items.filter((i) => ids.has(i.id));
      const items = dissolveLonelySets(state.items.filter((i) => !ids.has(i.id)));
      const next: WardrobeState = { themes: state.themes, items };
      await setWardrobe(streamer, next);
      // 저장 성공 후 파일 정리(모범 노력 — 실패해도 삭제는 이미 반영됨). 썸네일도 함께.
      await deleteWardrobeImages(removed.flatMap((i) => [i.url, i.thumbUrl].filter(Boolean)));
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
