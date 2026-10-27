"use client";

// 스트리머가 자기 업보시트 테마를 직접 고르는 화면.
// 고르는 축은 둘: 색(프리셋 또는 직접 만들기) × 질감(카드 표면). 저장은 기존 두 칸
// (streamers.accent_color = 프리셋 id, custom_theme = 직접 만든 색·질감 JSON)만 쓴다.

import { useState, type CSSProperties } from "react";
import { THEMES, resolveTheme, type Theme } from "../../../lib/themes";
import {
  parseCustomTheme,
  customThemeIsSafe,
  customThemeColors,
  previewCustomTheme,
  toneFromTheme,
  defaultTone,
  type CustomTheme,
  type CustomThemeV1,
  type ToneSpec,
} from "../../../lib/customTheme";
import { buildTone, isHex, relativeLuminance, TONE_MODES, MIN_TEXT_RATIO } from "../../../lib/toneTheme";
import { MATERIALS, materialVars, withoutMaterialVars, type MaterialId } from "../../../lib/materials";
import ThemeLiveBackground from "../ThemeLiveBackground";
import FinalDeliveryView, { type FinalDeliveryRow } from "../FinalDeliveryView";
import styles from "./settings.module.css";

type Override = "bg" | "card" | "cover" | "accent";
const OVERRIDES: { key: Override; label: string }[] = [
  { key: "bg", label: "배경" },
  { key: "card", label: "카드" },
  { key: "cover", label: "표지" },
  { key: "accent", label: "포인트" },
];

// 예전 방식(v1)으로 저장된 색을 새 방식 세부 조정 값으로 옮긴다(사용자가 손대는 순간에만).
// 표지는 예전 화면에 실제로 보이던 색(글자용으로 진하게 바뀐 포인트색)을 그대로 옮겨 첫 조작에 확 바뀌지 않게 한다.
function toneFromV1(v1: CustomThemeV1): ToneSpec {
  return {
    mode: relativeLuminance(v1.background) < 0.18 ? "dark" : "pastel",
    main: v1.accent,
    sub: null,
    motion: v1.motion,
    bg: v1.background,
    card: v1.surface,
    cover: customThemeColors(v1).accent,
    accent: customThemeColors(v1).accent,
  };
}

function initialState(raw: unknown) {
  let parsed: CustomTheme | null = null;
  try {
    parsed = parseCustomTheme(raw);
  } catch {
    parsed = null;
  }
  if (parsed?.version === 1) return { custom: true, tone: toneFromV1(parsed), legacy: parsed, material: null };
  return {
    custom: Boolean(parsed?.tone),
    tone: parsed?.tone ?? defaultTone,
    legacy: null as CustomThemeV1 | null,
    material: (parsed?.version === 2 ? parsed.material : undefined) ?? null,
  };
}

const ratioText = (n: number) => `${(Math.floor(n * 10) / 10).toFixed(1)} : 1`;

export default function ThemePicker({ slug, initialThemeId, initialCustom }: { slug: string; initialThemeId: string; initialCustom?: unknown }) {
  const [init] = useState(() => initialState(initialCustom));
  const [selected, setSelected] = useState(initialThemeId || "paper");
  const [custom, setCustom] = useState(init.custom);
  const [tone, setTone] = useState<ToneSpec>(init.tone);
  // 예전 방식 색: 색을 하나도 안 건드렸고 질감도 안 골랐으면 보던 모습 그대로 미리보기·저장한다.
  // (질감은 새 방식에만 얹을 수 있어 질감을 고르면 새 방식으로 보이고, "테마 기본"으로 돌아가면 다시 예전 모습)
  const [touched, setTouched] = useState(false);
  const [material, setMaterial] = useState<MaterialId | null>(init.material);
  const legacy = init.legacy && !touched && material === null ? init.legacy : null;
  const [lastSub, setLastSub] = useState(init.tone.sub ?? "#9ccfff");
  // 어느 예시 테마에서 시작했는지(안내용, 저장 안 함)
  const [startedFrom, setStartedFrom] = useState<{ label: string; handmade: boolean } | null>(null);
  const [hexDraft, setHexDraft] = useState<Record<string, string>>({});
  const [previewTab, setPreviewTab] = useState("fan");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const palette = buildTone(tone);
  const colorValue: CustomTheme | null = custom ? (legacy ?? { version: 2, tone }) : null;
  // 질감을 얹으면 v2 로만 저장된다(예전 방식 색은 고르는 순간 새 방식으로 옮김 — onPick 참고).
  const value: CustomTheme | null = material ? { version: 2, ...(custom ? { tone } : {}), material } : colorValue;
  const safe = !value || customThemeIsSafe(value);
  const baseTheme = resolveTheme(selected);
  const colorTheme = previewCustomTheme(baseTheme, colorValue);
  const theme = previewCustomTheme(baseTheme, value);
  // 질감 견본: "테마 기본" 칸은 지금 색 그대로, 질감 칸은 고르면 실제로 적용될 색(예전 방식이면 새 방식으로 옮긴 색) 기준
  const toneTheme = previewCustomTheme(baseTheme, custom ? { version: 2, tone } : null);

  function editTone(next: Partial<ToneSpec>) {
    setTouched(true);
    if (next.sub) setLastSub(next.sub);
    setTone((t) => ({ ...t, ...next }));
    setMsg(null);
  }
  function setOverride(key: Override, v: string | undefined) {
    setTouched(true);
    setTone((t) => {
      const n = { ...t };
      if (v === undefined) delete n[key];
      else n[key] = v.toLowerCase();
      return n;
    });
    setMsg(null);
  }
  // 색 입력칸: 6자리가 완성될 때만 반영하고, 입력 중 글자는 따로 들고 있는다.
  function hexField(id: string, current: string, apply: (v: string) => void, label: string) {
    const shown = hexDraft[id] ?? current;
    return (
      <input
        className={styles.hexInput}
        aria-label={`${label} HEX`}
        spellCheck={false}
        autoComplete="off"
        maxLength={7}
        value={shown}
        aria-invalid={!isHex(shown) && !/^[0-9a-f]{6}$/i.test(shown)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          // "ffb3d1" 처럼 # 없이 넣어도 받아 준다
          const v = /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}` : raw;
          setHexDraft((d) => ({ ...d, [id]: raw }));
          if (isHex(v)) apply(v);
        }}
        onBlur={() => setHexDraft((d) => {
          const n = { ...d };
          delete n[id];
          return n;
        })}
      />
    );
  }
  function colorWell(id: string, current: string, apply: (v: string) => void, label: string) {
    return (
      <label className={styles.well} style={{ background: current }}>
        <input
          type="color"
          aria-label={`${label} 고르기`}
          value={current}
          onChange={(e) => {
            setHexDraft((d) => {
              const n = { ...d };
              delete n[id];
              return n;
            });
            apply(e.target.value);
          }}
        />
      </label>
    );
  }

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: selected, custom: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setMsg({ kind: "err", text: data?.error || "저장하지 못했어요. 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장했어요." });
      }
    } catch {
      setMsg({ kind: "err", text: "네트워크 오류로 저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const basic = THEMES.filter((t) => !t.group);
  const pastel = THEMES.filter((t) => t.group === "pastel");
  const themeCard = (t: Theme) => (
    <button
      key={t.id}
      type="button"
      className={`${styles.card} ${!custom && t.id === selected ? styles.cardOn : ""}`}
      onClick={() => { setSelected(t.id); setCustom(false); setMsg(null); }}
      aria-pressed={!custom && t.id === selected}
    >
      <span className={styles.swatch} aria-hidden style={swatchStyle(t)} />
      <span className={styles.cardLabel}>{t.label}</span>
    </button>
  );
  const checks = legacy ? null : palette.checks;
  const lowest = checks ? Math.min(...Object.values(checks)) : null;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <a href={`/${slug}?admin=1&atab=settings`} style={{ fontSize: 13, opacity: 0.7, textDecoration: "none", color: "inherit" }}>
          ← 관리자 설정
        </a>
        <h1 className={styles.title}>테마 설정</h1>
      </header>

      <div className={styles.layout}>
        <div className={styles.controls}>
          <section aria-labelledby="pick-color">
            <h2 id="pick-color" className={styles.stepTitle}><span className={styles.stepNo}>1</span>색</h2>
            <h3 className={styles.groupTitle}>기본 테마</h3>
            <div className={styles.grid}>{basic.map(themeCard)}</div>
            <h3 className={styles.groupTitle}>파스텔 · 투톤</h3>
            <div className={styles.grid}>{pastel.map(themeCard)}</div>
            <h3 className={styles.groupTitle}>직접 만들기</h3>
            <button
              type="button"
              className={`${styles.card} ${styles.makeCard} ${custom ? styles.cardOn : ""}`}
              aria-pressed={custom}
              aria-controls={custom ? "tone-panel" : undefined}
              onClick={() => { setCustom(true); setMsg(null); }}
            >
              <span className={styles.swatch} aria-hidden style={swatchStyle(previewCustomTheme(baseTheme, legacy ?? { version: 2, tone }))} />
              <span className={styles.cardLabel}>내 색상</span>
            </button>
            {!custom ? (
              <button
                type="button"
                className={styles.startFrom}
                onClick={() => {
                  const t = resolveTheme(selected);
                  const next = toneFromTheme(t);
                  setTone(next);
                  if (next.sub) setLastSub(next.sub);
                  setStartedFrom({ label: t.label, handmade: !t.tone });
                  setTouched(true);
                  setCustom(true);
                  setMsg(null);
                }}
              >
                ‘{resolveTheme(selected).label}’에서 시작해 직접 수정
              </button>
            ) : null}

            {custom ? (
              <div id="tone-panel" className={styles.tonePanel}>
                {legacy ? <p className={styles.legacyNote}>예전 방식으로 저장된 색이에요. 아래에서 하나라도 바꾸면 새 방식으로 저장돼요.</p> : null}
                {startedFrom ? (
                  <p className={styles.fieldHint}>
                    ‘{startedFrom.label}’에서 시작했어요.{startedFrom.handmade ? " 기본 테마는 배경·카드·표지·포인트 색을 그대로 옮기고 나머지는 다시 계산해서, 비슷하지만 똑같지는 않을 수 있어요." : ""}
                  </p>
                ) : null}

                <div className={styles.toneRow}>
                  <span className={styles.toneLabel} id="tone-mode-label">톤</span>
                  <div className={styles.modeGroup} role="group" aria-labelledby="tone-mode-label">
                    {TONE_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={!legacy && tone.mode === m.id}
                        className={styles.modeBtn}
                        onClick={() => {
                          // 톤이 배경 밝기를 정하므로, 배경·카드를 직접 지정해 둔 값은 자동으로 되돌린다.
                          setTone((t) => { const n = { ...t }; delete n.bg; delete n.card; return n; });
                          editTone({ mode: m.id });
                        }}
                      >
                        <b>{m.label}</b>
                        <span>{m.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.toneRow}>
                  <span className={styles.toneLabel}>주색</span>
                  <div className={styles.colorLine}>
                    {colorWell("main", tone.main, (v) => editTone({ main: v.toLowerCase() }), "주색")}
                    {hexField("main", tone.main, (v) => editTone({ main: v.toLowerCase() }), "주색")}
                    <span className={styles.fieldHint}>배경 · 표지 계열</span>
                  </div>
                </div>

                <div className={styles.toneRow}>
                  <span className={styles.toneLabel}>투톤</span>
                  <div className={styles.colorLine}>
                    <label className={styles.switch}>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label="투톤 사용"
                        checked={tone.sub !== null}
                        onChange={(e) => editTone({ sub: e.target.checked ? lastSub : null })}
                      />
                      <span className={styles.switchTrack} aria-hidden="true" />
                      <span>{tone.sub !== null ? "켬" : "끔"}</span>
                    </label>
                    {tone.sub !== null ? (
                      <>
                        {colorWell("sub", tone.sub, (v) => editTone({ sub: v.toLowerCase() }), "보조색")}
                        {hexField("sub", tone.sub, (v) => editTone({ sub: v.toLowerCase() }), "보조색")}
                        <span className={styles.fieldHint}>버튼 · 칩 · 포인트 글자 계열</span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className={styles.toneRow}>
                  <span className={styles.toneLabel}>배경</span>
                  <label className={styles.switch}>
                    <input type="checkbox" role="switch" aria-label="흐르는 배경" checked={tone.motion} onChange={(e) => editTone({ motion: e.target.checked })} />
                    <span className={styles.switchTrack} aria-hidden="true" />
                    <span>{tone.motion ? "흐르는 빛 켬" : "멈춘 배경"}</span>
                  </label>
                </div>

                {tone.bg || tone.card ? <p className={styles.fieldHint}>톤을 바꾸면 세부 조정의 배경·카드는 자동으로 돌아가요.</p> : null}
                <details className={styles.fine}>
                  <summary>세부 조정 <span>{OVERRIDES.filter((o) => tone[o.key]).length ? `${OVERRIDES.filter((o) => tone[o.key]).length}칸 직접 지정` : "모두 자동"}</span></summary>
                  <div className={styles.fineGrid}>
                    {OVERRIDES.map((o) => {
                      const auto = (palette.vars[o.key === "bg" ? "--paper" : o.key === "card" ? "--surface" : o.key === "cover" ? "--cover" : "--stamp"] ?? "#ffffff").slice(0, 7);
                      const cur = tone[o.key] ?? auto;
                      return (
                        <div key={o.key} className={styles.fineRow}>
                          <span className={styles.toneLabel}>{o.label}</span>
                          {colorWell(`ov-${o.key}`, cur, (v) => setOverride(o.key, v), o.label)}
                          {hexField(`ov-${o.key}`, cur, (v) => setOverride(o.key, v), o.label)}
                          {tone[o.key] ? (
                            <button type="button" className={styles.autoBtn} onClick={() => setOverride(o.key, undefined)}>자동으로</button>
                          ) : (
                            <span className={styles.fieldHint}>자동</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>

                {lowest !== null && checks ? (
                  <div className={styles.checkLine} role="status" data-ok={lowest >= MIN_TEXT_RATIO ? "1" : undefined}>
                    <b>{lowest >= MIN_TEXT_RATIO ? "글자가 잘 보여요" : "글자가 잘 안 보여요"}</b>
                    <span>
                      가장 낮은 글자 대비 {ratioText(lowest)} (기준 4.5 : 1)
                      {lowest < MIN_TEXT_RATIO ? " — 세부 조정의 배경·카드를 둘 다 밝게 또는 둘 다 어둡게 맞춰 주세요." : ""}
                    </span>
                  </div>
                ) : null}
                {!legacy && safe && palette.accentText ? (
                  <p className={styles.fieldHint}>포인트 글자는 잘 읽히도록 {palette.accentText.toUpperCase()}로 표시돼요. 옅은 강조 칸은 고른 색 그대로예요.</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="pick-material" className={styles.materialSection}>
            <h2 id="pick-material" className={styles.stepTitle}><span className={styles.stepNo}>2</span>질감</h2>
            <div className={styles.matGrid}>
              <MaterialTile theme={colorTheme} id={null} label="테마 기본" blurb={colorTheme.fx?.material === "acrylic" ? "옅은 색 테두리·바닥판(이 테마 모양)" : colorTheme.fx?.glass ? "테마에 들어 있는 유리" : "질감 없이 평평하게"} on={material === null} onPick={() => { setMaterial(null); setMsg(null); }} />
              {MATERIALS.map((m) => (
                <MaterialTile key={m.id} theme={toneTheme} id={m.id} label={m.label} blurb={m.blurb} on={material === m.id} onPick={() => { setMaterial(m.id); setMsg(null); }} />
              ))}
            </div>
          </section>
        </div>

        <aside className={styles.previewCol}>
          <p className={styles.previewLabel}>미리보기</p>
          <div className={styles.previewSwitch}>
            <button type="button" aria-pressed={previewTab === "fan"} onClick={() => setPreviewTab("fan")}>팬 화면</button>
            <button type="button" aria-pressed={previewTab === "delivery"} onClick={() => setPreviewTab("delivery")}>배송관리</button>
          </div>
          <ThemePreview theme={theme} slug={slug} delivery={previewTab === "delivery"} />
          {!custom ? (
            <a className={styles.fullLink} href={`/${encodeURIComponent(slug)}?theme=${encodeURIComponent(selected)}${material ? `&material=${material}` : ""}`} target="_blank" rel="noreferrer">
              실제 시트에서 보기 ↗ <span>저장 안 됨</span>
            </a>
          ) : (
            <p className={styles.fieldHint}>직접 만든 색은 저장한 뒤 시트에서 확인할 수 있어요.</p>
          )}
        </aside>
      </div>

      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving || !safe}>
          {saving ? "저장 중…" : "저장"}
        </button>
        {!safe ? <span className={styles.saveHint}>글자가 잘 안 보이는 조합이라 저장할 수 없어요.</span> : null}
      </div>
      <p className={msg ? (msg.kind === "ok" ? styles.ok : styles.err) : styles.srOnly} role="status" aria-live="polite">{msg?.text ?? ""}</p>
    </div>
  );
}

function swatchStyle(t: Theme): CSSProperties {
  const v = t.vars;
  return {
    background: `linear-gradient(135deg, ${v["--cover"]} 0 38%, ${v["--stamp"]} 38% 68%, ${v["--surface"]} 68% 100%)`,
  };
}

function themeAttrs(theme: Theme) {
  return {
    style: theme.vars as CSSProperties,
    "data-fx": theme.fx?.background,
    "data-glass": theme.fx?.glass ? "1" : undefined,
    "data-material": theme.fx?.material,
  };
}

// 질감 칸: 고른 색 테마 위에 그 질감을 얹은 작은 견본. 뒤에 표지색·포인트색 띠를 깔아 투명도·흐림이 보이게 한다.
function MaterialTile({ theme, id, label, blurb, on, onPick }: { theme: Theme; id: MaterialId | null; label: string; blurb: string; on: boolean; onPick: () => void }) {
  const vars = id ? { ...withoutMaterialVars(theme.vars), ...materialVars(theme, id) } : theme.vars;
  const glassy = id !== null || theme.fx?.glass;
  return (
    <button type="button" className={`${styles.matTile} ${on ? styles.cardOn : ""}`} aria-pressed={on} onClick={onPick}>
      <span className={styles.matStage} style={vars as CSSProperties} data-glass={glassy ? "1" : undefined} data-material={id ?? theme.fx?.material} aria-hidden="true">
        <span className={styles.matBand} />
        <span className={styles.matCard}><span /><span /></span>
      </span>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardBlurb}>{blurb}</span>
    </button>
  );
}

function ThemePreview({ theme, slug, delivery }: { theme: Theme; slug: string; delivery: boolean }) {
  return (
    <div className={styles.preview} {...themeAttrs(theme)}>
      <ThemeLiveBackground fx={theme.fx?.background} palette={theme.fx?.nebulaPalette} contained />
      <div className={styles.pvInner}>
        {delivery ? <FinalDeliveryView rows={previewRows} initialMonth="all" disabled onChange={() => {}} onNote={() => {}} design="ref-u" /> : <>
          <div className={styles.pvCover}>{slug} 업보시트</div>
          <div className={styles.pvCard}>
            <div className={styles.pvRow}>
              <span className={styles.pvName}>달빛여우</span>
              <span className={styles.pvChip}>
                <b className={styles.pvItem}>스벅콘</b>
                <b className={styles.pvProb}>1.5%</b>
              </span>
            </div>
            <div className={styles.pvRow}>
              <span className={styles.pvName}>별헤는밤</span>
              <span className={styles.pvMuted}>3일 전</span>
            </div>
            <div className={styles.pvTabs}>
              <span className={styles.pvTabOn}>전체</span>
              <span>룰렛</span>
            </div>
            <div className={styles.pvBtnRow}>
              <span className={styles.pvBtn}>찾기</span>
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}

const previewRows = ['달빛여우','별헤는밤'].map((name,i)=>({v:{key:String(i),fanId:'viewer'+i,fanNickname:name},it:{itemName:i?'치킨':'스벅콘',amountRangeLabel:'선물'},ref:{entryId:String(i),quantity:3,recordedAtMs:Date.UTC(2026,8-i,5),recordedKind:'donate'},alloc:{allocated:i,state:i?'part':'pending',doneAt:null},aKey:String(i)})) as FinalDeliveryRow[];
