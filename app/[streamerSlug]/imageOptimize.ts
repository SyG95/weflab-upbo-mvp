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
