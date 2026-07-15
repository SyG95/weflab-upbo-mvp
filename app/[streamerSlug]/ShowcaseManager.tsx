"use client";

// 스트리머 관리자용 "홍보(쇼케이스)" 편집 화면.
// 배너 1장 + 포스터 2장 + 공지사항을 관리자 토큰으로 저장한다.
// 기존 extension 토큰으로 인증(새 로그인 없음). 전용 링크 #토큰 으로 들어오면 자동 입력.
// UX 패턴은 ThemePicker.tsx(토큰 입력/hash 자동채움/저장 상태 문구/fetch 패턴)를 그대로 따른다.

import { useEffect, useRef, useState } from "react";
import type { ShowcaseState } from "../../lib/upboSupabase";
import { NOTICE_FONTS, noticeFontCss, noticeFontsPreviewHref } from "../../lib/noticeFonts";
import styles from "./showcase.module.css";

type SlotKey = "banner" | "poster0" | "poster1" | "poster2";

const SLOT_DEFS: { key: SlotKey; label: string }[] = [
  { key: "banner", label: "배너(가로형 권장)" },
  { key: "poster0", label: "포스터 1" },
  { key: "poster1", label: "포스터 2" },
  { key: "poster2", label: "포스터 3" },
];

const MAX_NOTICE_LEN = 2000;
const BANNER_MAX_WIDTH = 1920;
const POSTER_MAX_WIDTH = 1200;
const SKIP_RESIZE_MAX_BYTES = 1024 * 1024; // 1MB 미만이면 원본 그대로

// 공지에 자주 쓰는 특수문자·이모지. 맥/윈도우 상관없이 클릭 한 번으로 커서 위치에 삽입.
const NOTICE_CHARS = ["★", "☆", "♥", "♡", "●", "◆", "■", "▶", "✔", "※", "♪", "♬", "【", "】", "「", "」", "·", "…", "→", "✿"];
const NOTICE_EMOJIS = ["🔥", "✨", "🎉", "🎁", "📢", "📌", "⏰", "⭐", "💜", "💙", "💛", "❤️", "😊", "🥳", "👑", "💫", "✅", "⚠️", "📅", "🙏"];

function slotAccept() {
  return "image/png,image/jpeg,image/webp";
}

function currentUrlFor(initial: ShowcaseState | null, key: SlotKey): string | null {
  if (!initial) return null;
  if (key === "banner") return initial.bannerUrl;
  if (key === "poster0") return initial.posterUrls[0];
  if (key === "poster1") return initial.posterUrls[1];
  return initial.posterUrls[2] ?? null;
}

function removeFieldFor(key: SlotKey): "removeBanner" | "removePoster0" | "removePoster1" | "removePoster2" {
  if (key === "banner") return "removeBanner";
  if (key === "poster0") return "removePoster0";
  if (key === "poster1") return "removePoster1";
  return "removePoster2";
}

// 이미지를 캔버스로 다운스케일해서 webp(실패 시 jpeg)로 압축한다.
// 원본이 이미 목표 크기 이하이고 1MB 미만이면 원본 그대로 반환한다.
async function optimizeImage(file: File, maxWidth: number): Promise<File> {
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

export default function ShowcaseManager({ slug, initial }: { slug: string; initial: ShowcaseState | null }) {
  const [state, setState] = useState<ShowcaseState | null>(initial);
  const [files, setFiles] = useState<Record<SlotKey, File | null>>({ banner: null, poster0: null, poster1: null, poster2: null });
  const [previews, setPreviews] = useState<Record<SlotKey, string | null>>({ banner: null, poster0: null, poster1: null, poster2: null });
  const [removed, setRemoved] = useState<Record<SlotKey, boolean>>({ banner: false, poster0: false, poster1: false, poster2: false });
  const [notice, setNotice] = useState(initial?.noticeText ?? "");
  const [noticeFont, setNoticeFont] = useState(initial?.noticeFont ?? "");
  const noticeRef = useRef<HTMLTextAreaElement>(null);
  const [links, setLinks] = useState<Record<SlotKey, string>>({
    banner: initial?.bannerLink ?? "",
    poster0: initial?.posterLinks?.[0] ?? "",
    poster1: initial?.posterLinks?.[1] ?? "",
    poster2: initial?.posterLinks?.[2] ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    // 로컬 미리보기 objectURL 정리.
    return () => {
      for (const key of Object.keys(previews) as SlotKey[]) {
        const url = previews[key];
        if (url) URL.revokeObjectURL(url);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 폰트 미리보기용 구글폰트를 관리자 화면에 1회만 로드(팬 화면 성능과 무관).
    const id = "notice-fonts-preview";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = noticeFontsPreviewHref();
    document.head.appendChild(link);
  }, []);

  // 특수문자·이모지를 공지 입력창의 커서 위치에 삽입(선택 영역은 대체). 길이 제한 준수.
  function insertToken(token: string) {
    const el = noticeRef.current;
    const start = el?.selectionStart ?? notice.length;
    const end = el?.selectionEnd ?? notice.length;
    const next = (notice.slice(0, start) + token + notice.slice(end)).slice(0, MAX_NOTICE_LEN);
    setNotice(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = Math.min(start + token.length, MAX_NOTICE_LEN);
      el.setSelectionRange(pos, pos);
    });
  }

  function onPickFile(key: SlotKey, file: File | null) {
    if (!file) return;
    setFiles((prev) => ({ ...prev, [key]: file }));
    setRemoved((prev) => ({ ...prev, [key]: false }));
    setPreviews((prev) => {
      const nextUrl = URL.createObjectURL(file);
      if (prev[key]) URL.revokeObjectURL(prev[key] as string);
      return { ...prev, [key]: nextUrl };
    });
  }

  function onRemoveSlot(key: SlotKey) {
    setRemoved((prev) => ({ ...prev, [key]: true }));
    setFiles((prev) => ({ ...prev, [key]: null }));
    setPreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key] as string);
      return { ...prev, [key]: null };
    });
  }

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    setSaving(true);
    setMsg(null);
    try {
      setStep("이미지 최적화 중…");
      const formData = new FormData();
      formData.set("noticeText", notice);
      formData.set("noticeFont", noticeFont);

      for (const { key } of SLOT_DEFS) {
        const file = files[key];
        if (file) {
          const maxWidth = key === "banner" ? BANNER_MAX_WIDTH : POSTER_MAX_WIDTH;
          const optimized = await optimizeImage(file, maxWidth);
          formData.set(key, optimized);
        } else if (removed[key]) {
          formData.set(removeFieldFor(key), "1");
        }
        // 링크는 항상 전송(빈값이면 서버에서 해제). 필드명: bannerLink / poster0Link ...
        formData.set(`${key}Link`, links[key].trim());
      }

      setStep("업로드 중…");
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/showcase`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
        return;
      }

      const nextState: ShowcaseState | null = data?.showcase ?? null;
      setState(nextState);
      setNotice(nextState?.noticeText ?? notice);
      setNoticeFont(nextState?.noticeFont ?? noticeFont);
      setLinks({
        banner: nextState?.bannerLink ?? "",
        poster0: nextState?.posterLinks?.[0] ?? "",
        poster1: nextState?.posterLinks?.[1] ?? "",
        poster2: nextState?.posterLinks?.[2] ?? "",
      });
      setFiles({ banner: null, poster0: null, poster1: null, poster2: null });
      setRemoved({ banner: false, poster0: false, poster1: false, poster2: false });
      setPreviews((prev) => {
        for (const key of Object.keys(prev) as SlotKey[]) {
          if (prev[key]) URL.revokeObjectURL(prev[key] as string);
        }
        return { banner: null, poster0: null, poster1: null, poster2: null };
      });
      setMsg({ kind: "ok", text: "적용됐어요! 팬 화면에 바로 반영됩니다." });
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
      setStep(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <h1 className={styles.title}>포스터·배너(쇼케이스) 관리</h1>
        <p className={styles.sub}>
          <b>{slug}</b> 팬 화면 상단에 노출되는 배너·포스터·공지사항을 관리해요.
        </p>
      </header>

      <div className={styles.slotGrid}>
        {SLOT_DEFS.map(({ key, label }) => {
          const savedUrl = currentUrlFor(state, key);
          const previewUrl = previews[key];
          const isRemoved = removed[key];
          const displayUrl = previewUrl ?? (isRemoved ? null : savedUrl);
          return (
            <div key={key} className={styles.slotCard}>
              <p className={styles.slotLabel}>{label}</p>
              <div className={styles.previewFrame}>
                {displayUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayUrl} alt={label} className={styles.previewImg} />
                ) : (
                  <span className={styles.previewEmpty}>이미지 없음</span>
                )}
                {isRemoved ? <span className={styles.removeBadge}>제거 예정</span> : null}
              </div>
              <div className={styles.slotActions}>
                <label className={styles.fileBtn}>
                  새 파일 선택
                  <input
                    type="file"
                    accept={slotAccept()}
                    className={styles.fileInput}
                    onChange={(e) => onPickFile(key, e.target.files?.[0] ?? null)}
                  />
                </label>
                {displayUrl ? (
                  <button type="button" className={styles.removeBtn} onClick={() => onRemoveSlot(key)}>
                    이미지 제거
                  </button>
                ) : null}
              </div>
              <input
                type="url"
                value={links[key]}
                placeholder="링크 URL (선택 · 클릭 시 새 탭 이동)"
                onChange={(e) => setLinks((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{
                  marginTop: 8,
                  width: "100%",
                  height: 34,
                  padding: "0 10px",
                  border: "1px solid var(--paper-line)",
                  borderRadius: 8,
                  fontSize: 12.5,
                  background: "var(--surface)",
                  color: "var(--ink)",
                }}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.noticeBlock}>
        <label className={styles.noticeLabel} htmlFor="showcase-notice">
          공지사항
        </label>

        {/* 공지 전용 글씨체: 고른 폰트는 팬 화면 공지에만 적용됨. 기본=사이트 글씨체. */}
        <div className={styles.fontPicker}>
          <span className={styles.pickerLabel}>공지 글씨체</span>
          <div className={styles.fontChips}>
            {NOTICE_FONTS.map((f) => (
              <button
                key={f.key || "default"}
                type="button"
                className={noticeFont === f.key ? styles.fontChipOn : styles.fontChip}
                style={{ fontFamily: noticeFontCss(f.key) }}
                onClick={() => setNoticeFont(f.key)}
                aria-pressed={noticeFont === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 특수문자·이모지 빠른 입력(맥/윈도우 공통). 커서 위치에 삽입됨. */}
        <div className={styles.palette}>
          <span className={styles.pickerLabel}>빠른 입력</span>
          <div className={styles.paletteRow}>
            {NOTICE_CHARS.map((c) => (
              <button key={c} type="button" className={styles.paletteBtn} onClick={() => insertToken(c)} tabIndex={-1}>
                {c}
              </button>
            ))}
          </div>
          <div className={styles.paletteRow}>
            {NOTICE_EMOJIS.map((c) => (
              <button key={c} type="button" className={styles.paletteBtn} onClick={() => insertToken(c)} tabIndex={-1}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <textarea
          id="showcase-notice"
          ref={noticeRef}
          className={styles.noticeArea}
          value={notice}
          maxLength={MAX_NOTICE_LEN}
          placeholder="팬 화면 상단에 보여줄 공지예요. 방송 일정, 이벤트 안내 등에 활용하세요."
          onChange={(e) => setNotice(e.target.value)}
          style={{ fontFamily: noticeFontCss(noticeFont) }}
        />
        <p className={styles.noticeCount}>
          {notice.length}/{MAX_NOTICE_LEN}
        </p>
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving}>
          {saving ? step ?? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}
