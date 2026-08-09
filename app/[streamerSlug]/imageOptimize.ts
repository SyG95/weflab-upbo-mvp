"use client";

// 관리자 업로드 공용 이미지 최적화(쇼케이스·옷장 공유).
// 캔버스로 다운스케일해서 webp(실패 시 jpeg)로 압축한다.
// 원본이 이미 목표 크기 이하이고 1MB 미만이면 원본 그대로 반환한다.

const SKIP_RESIZE_MAX_BYTES = 1024 * 1024; // 1MB 미만이면 원본 그대로

export async function optimizeImage(file: File, maxWidth: number): Promise<File> {
  if (file.size < SKIP_RESIZE_MAX_BYTES) {
    const dims = await readImageDimensions(file).catch(() => null);
    if (dims && dims.width <= maxWidth) return file;
  }

  const dims = await readImageDimensions(file);
  const scale = dims.width > maxWidth ? maxWidth / dims.width : 1;
  const targetWidth = Math.max(1, Math.round(dims.width * scale));
  const targetHeight = Math.max(1, Math.round(dims.height * scale));

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

  const webpBlob = await canvasToBlob(canvas, "image/webp", 0.85);
  if (webpBlob) {
    return new File([webpBlob], renameWithExt(file.name, "webp"), { type: "image/webp" });
  }

  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (jpegBlob) {
    return new File([jpegBlob], renameWithExt(file.name, "jpg"), { type: "image/jpeg" });
  }

  return file;
}

// ── 시그 이미지 전용: 투명/흰 테두리 여백 자동 트리밍(2026-08-09, sy 확인 건) ──
// 숲 시그 규격 파일은 위쪽에 큰 빈 여백이 박혀 있는 경우가 많다(아이코 6종 실측: 위 83~84px).
// 쇼케이스·옷장은 흰 배경이 의도일 수 있어 여기서는 쓰지 않는다 — 정가 설정 업로드에서만 호출.
// 실패하거나 애매하면 조용히 원본을 그대로 반환한다(트리밍이 업로드를 막지 않게).
const TRIM_ALPHA_MAX = 16; // 이하 = 투명 취급
const TRIM_WHITE_MIN = 245; // r·g·b 전부 이상 = 흰색 취급
const TRIM_BLANK_ROW_RATIO = 0.99; // 줄의 99% 이상이 빈 픽셀이면 빈 줄
const TRIM_KEEP_PADDING = 4; // 내용 주변 여유(px)
const TRIM_MIN_CONTENT_RATIO = 0.2; // 남는 내용이 한 변의 20% 미만이면 트리밍 포기(과절단 안전장치)

export async function trimImageMargins(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    if (w < 20 || h < 20) return file;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    const isBlank = (x: number, y: number): boolean => {
      const i = (y * w + x) * 4;
      if (data[i + 3] <= TRIM_ALPHA_MAX) return true;
      return data[i] >= TRIM_WHITE_MIN && data[i + 1] >= TRIM_WHITE_MIN && data[i + 2] >= TRIM_WHITE_MIN;
    };
    const rowBlank = (y: number): boolean => {
      let blank = 0;
      for (let x = 0; x < w; x++) if (isBlank(x, y)) blank++;
      return blank >= w * TRIM_BLANK_ROW_RATIO;
    };
    const colBlank = (x: number): boolean => {
      let blank = 0;
      for (let y = 0; y < h; y++) if (isBlank(x, y)) blank++;
      return blank >= h * TRIM_BLANK_ROW_RATIO;
    };

    let top = 0;
    while (top < h && rowBlank(top)) top++;
    if (top >= h) return file; // 전부 빈 이미지 — 건드리지 않는다
    let bottom = h - 1;
    while (bottom > top && rowBlank(bottom)) bottom--;
    let left = 0;
    while (left < w && colBlank(left)) left++;
    let right = w - 1;
    while (right > left && colBlank(right)) right--;

    top = Math.max(0, top - TRIM_KEEP_PADDING);
    bottom = Math.min(h - 1, bottom + TRIM_KEEP_PADDING);
    left = Math.max(0, left - TRIM_KEEP_PADDING);
    right = Math.min(w - 1, right + TRIM_KEEP_PADDING);

    const cw = right - left + 1;
    const ch = bottom - top + 1;
    if (cw >= w - 2 && ch >= h - 2) return file; // 자를 여백이 사실상 없음
    if (cw < w * TRIM_MIN_CONTENT_RATIO || ch < h * TRIM_MIN_CONTENT_RATIO) return file;

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const outCtx = out.getContext("2d");
    if (!outCtx) return file;
    outCtx.drawImage(bitmap, left, top, cw, ch, 0, 0, cw, ch);
    // png 으로 보존(투명 유지) — 이후 optimizeImage 가 필요하면 webp 로 줄인다.
    const blob = await canvasToBlob(out, "image/png", 1);
    if (!blob) return file;
    return new File([blob], renameWithExt(file.name, "png"), { type: "image/png" });
  } catch {
    return file;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했어요."));
    };
    img.src = url;
  });
}

function renameWithExt(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "image"}.${ext}`;
}
