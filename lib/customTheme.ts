import type { Theme } from './themes';
import { buildTone, isHex, mixHex, MIN_TEXT_RATIO, nebulaBackdrops, readableAlpha, relativeLuminance, rgba, type ToneMode } from './toneTheme';
import { applyMaterial, isMaterialId, type MaterialId } from './materials';

// streamers.custom_theme(jsonb, 1KB 제한)에 저장되는 값.
// v1 = 예전 직접 색상(배경·카드·포인트 3칸). 저장돼 있는 시트가 있어 보던 그대로 그린다.
// v2 = 톤 생성기(tone) + 질감(material). 둘 다 선택 — 프리셋 테마에 질감만 얹을 땐 tone 없이 material 만.
export type CustomThemeV1 = { version: 1; background: string; surface: string; accent: string; motion: boolean };
export type ToneSpec = { mode: ToneMode; main: string; sub: string | null; motion: boolean; bg?: string; card?: string; cover?: string; accent?: string };
export type CustomThemeV2 = { version: 2; tone?: ToneSpec; material?: MaterialId };
export type CustomTheme = CustomThemeV1 | CustomThemeV2;

export const defaultCustomTheme: CustomThemeV1 = { version: 1, background: '#fff4f8', surface: '#ffffff', accent: '#cd477d', motion: false };
export const defaultTone: ToneSpec = { mode: 'pastel', main: '#ffb3d1', sub: null, motion: true };
const TONE_MODE_IDS: string[] = ['pastel', 'vivid', 'deep', 'dark'];
const TONE_OVERRIDES = ['bg', 'card', 'cover', 'accent'] as const;

function parseV1(v: Record<string, unknown>): CustomThemeV1 {
  if (typeof v.motion !== 'boolean' || Object.keys(v).some(k => !['version','background','surface','accent','motion'].includes(k))) throw new Error('지원하지 않는 색상 설정이에요.');
  for (const k of ['background','surface','accent']) if (!isHex(v[k])) throw new Error('색상은 #RRGGBB 형식으로 입력해 주세요.');
  return {version:1, background:(v.background as string).toLowerCase(),surface:(v.surface as string).toLowerCase(),accent:(v.accent as string).toLowerCase(),motion:v.motion};
}

function parseTone(value: unknown): ToneSpec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('색상 설정 형식이 올바르지 않아요.');
  const t = value as Record<string, unknown>;
  if (Object.keys(t).some(k => !['mode','main','sub','motion',...TONE_OVERRIDES].includes(k))) throw new Error('지원하지 않는 색상 설정이에요.');
  if (typeof t.mode !== 'string' || !TONE_MODE_IDS.includes(t.mode) || typeof t.motion !== 'boolean') throw new Error('지원하지 않는 색상 설정이에요.');
  if (!isHex(t.main) || !(t.sub === null || isHex(t.sub))) throw new Error('색상은 #RRGGBB 형식으로 입력해 주세요.');
  const spec: ToneSpec = { mode: t.mode as ToneMode, main: t.main.toLowerCase(), sub: t.sub === null ? null : (t.sub as string).toLowerCase(), motion: t.motion };
  for (const k of TONE_OVERRIDES) {
    if (t[k] === undefined) continue;
    if (!isHex(t[k])) throw new Error('색상은 #RRGGBB 형식으로 입력해 주세요.');
    spec[k] = (t[k] as string).toLowerCase();
  }
  return spec;
}

export function parseCustomTheme(value: unknown): CustomTheme | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('색상 설정 형식이 올바르지 않아요.');
  const v = value as Record<string, unknown>;
  if (v.version === 1) return parseV1(v);
  if (v.version !== 2 || Object.keys(v).some(k => !['version','tone','material'].includes(k))) throw new Error('지원하지 않는 색상 설정이에요.');
  if (v.material !== undefined && !isMaterialId(v.material)) throw new Error('지원하지 않는 질감이에요.');
  return { version: 2, ...(v.tone !== undefined ? { tone: parseTone(v.tone) } : {}), ...(v.material !== undefined ? { material: v.material as MaterialId } : {}) };
}

// ---------- v1 (예전 직접 색상) — 저장된 시트가 보던 모습 그대로 유지 ----------

function luminance(hex: string) { const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
export function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function mix(a:string,b:string,t:number) { return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join(''); }
export function customThemeColors(c:CustomThemeV1) {
  const score=(v:string)=>Math.min(contrast(v,c.background),contrast(v,c.surface));
  const ink=score('#111111')>=score('#ffffff')?'#111111':'#ffffff';
  let accent=c.accent;
  for(let i=0;i<=100;i++){accent=mix(c.accent,ink,i/100);if(score(accent)>=4.5)break;}
  const onAccent=contrast('#111111',accent)>=contrast('#ffffff',accent)?'#111111':'#ffffff';
  return {ink,accent,onAccent,ratio:score(ink),accentRatio:score(accent)};
}
// 바탕 테마의 색에 맞춰 계산된 변수 — 직접 색상(v1·톤)은 색을 새로 정하므로 바탕 테마 것을 물려받으면 안 된다.
// (예: 파스텔 프리셋의 옅은 버튼 바탕 --accent-fill 이 남으면 v1 의 흰 버튼 글자가 옅은 바탕 위에 놓인다)
const DERIVED_VARS=['--cover-ink','--cover-on-white','--tab-hover','--accent-fill','--accent-edge'];
const ownColorVars=(vars:Theme['vars'])=>Object.fromEntries(Object.entries(vars).filter(([k])=>!DERIVED_VARS.includes(k)&&!k.startsWith('--mat-')));
function applyV1(base:Theme,c:CustomThemeV1):Theme {
  const p=customThemeColors(c);if(p.ratio<4.5)return base;
  const inherited=ownColorVars(base.vars);
  return {...base,label:'내 색상',vars:{...inherited,'--page-bg':c.background,'--paper':c.background,'--surface':c.surface,'--ink':p.ink,'--muted':p.ink,'--stamp':p.accent,'--stamp-soft':mix(c.surface,p.accent,.12),'--paper-line':mix(c.surface,p.ink,.3),'--rule-line':mix(c.background,p.ink,.1),'--cover':p.accent,'--on-cover':p.onAccent,'--on-accent':p.onAccent,'--modal-bg':c.surface,'--glass-border':mix(c.surface,p.ink,.25),'--glass-shadow':'transparent'},fx:{glass:false,...(c.motion?{background:'nebula' as const,nebulaPalette:{base:[c.background,c.background] as [string,string],clouds:[c.background,c.background,c.background] as [string,string,string]}}:{})}};
}

// ---------- v2 (톤 생성기 + 질감) ----------

export function toneIsSafe(tone: ToneSpec): boolean {
  return buildTone(tone).minRatio >= MIN_TEXT_RATIO;
}

// 저장 전 검사용: 글자가 읽히지 않는 조합이면 false (v1 은 예전 기준 그대로)
export function customThemeIsSafe(c: CustomTheme): boolean {
  if (c.version === 1) return customThemeColors(c).ratio >= 4.5;
  return c.tone ? toneIsSafe(c.tone) : true;
}

// 톤 → 테마 한 벌. 파스텔·투톤 예시 테마와 "내 색상"이 같은 조립을 쓴다(예시에서 시작해 고쳐도 모습이 이어지게):
// 유리 카드(글자 대비가 버티는 만큼만 비침) + 흐르는 배경(선택) + 파스텔은 내장 모양(옅은 색 테두리·색 바닥판).
export function themeFromTone(base: Theme, tone: ToneSpec, force = false): Theme {
  const p = buildTone(tone);
  if (p.minRatio < MIN_TEXT_RATIO && !force) return base;
  const texts = [p.vars['--ink'], p.vars['--muted'], p.vars['--stamp']];
  const alpha = readableAlpha(p.vars['--surface'], p.dark ? 0.8 : 0.86, [p.vars['--paper'], ...nebulaBackdrops(p.nebula)], texts, texts.map(() => 4.5));
  const theme: Theme = {
    ...base,
    vars: { ...ownColorVars(base.vars), ...p.vars, '--surface': rgba(p.vars['--surface'], alpha) },
    fx: { glass: true, ...(tone.motion ? { background: 'nebula' as const, nebulaPalette: p.nebula } : {}) },
  };
  return tone.mode === 'pastel' ? applyMaterial(theme, 'acrylic') : theme;
}

function applyTone(base: Theme, tone: ToneSpec, force = false): Theme {
  const t = themeFromTone(base, tone, force);
  return t === base ? base : { ...t, label: '내 색상' };
}

// 설정 화면 미리보기 전용: 글자가 안 보이는 조합도 그대로 그려서 "왜 저장이 막혔는지" 보이게 한다.
// (시트·저장 경로는 applyCustomTheme 만 쓴다 — 안전하지 않으면 기본 테마 유지)
export function previewCustomTheme(base:Theme,value:CustomTheme|null):Theme {
  if(!value||value.version===1)return applyCustomTheme(base,value);
  return applyMaterial(value.tone?applyTone(base,value.tone,true):base,value.material);
}

export function applyCustomTheme(base:Theme,value:unknown):Theme {
  // 화면 그리기: 모르는 질감 이름(예: 없앤 질감)만 빼고 색 설정은 살린다. 저장 검사(parseCustomTheme)는 그대로 거부.
  if(value&&typeof value==='object'&&!Array.isArray(value)&&(value as Record<string,unknown>).version===2&&'material' in value&&!isMaterialId((value as Record<string,unknown>).material)){
    const rest={...(value as Record<string,unknown>)};delete rest.material;value=rest;
  }
  let c:CustomTheme|null;try{c=parseCustomTheme(value);}catch{return base;}
  if(!c)return base;
  if(c.version===1)return applyV1(base,c);
  const toned=c.tone?applyTone(base,c.tone):base;
  return applyMaterial(toned,c.material);
}

// 테마 값("#hex" 또는 "rgba(...)")을 바탕색 위에 올린 불투명 #hex 로
function solid(value: string | undefined, under: string): string {
  const v = (value ?? "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!m) return under;
  const hex = "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return m[4] === undefined ? hex : mixHex(under, hex, Number(m[4]));
}

// "이 테마에서 시작해 직접 수정": 톤 생성기로 만든 예시 테마는 씨앗을 그대로 넘겨 모습이 똑같이 이어지고,
// 손으로 만든 기본 테마는 배경·카드·표지·포인트 네 칸을 세부 조정으로 옮긴다(글자·선은 다시 계산 → 비슷한 모습).
// 옮긴 결과가 글자 대비 기준에 못 미치면 포인트·카드 순으로 자동 계산에 맡겨 저장 가능한 조합으로 만든다.
export function toneFromTheme(t: Theme): ToneSpec {
  const motion = t.fx?.background === "nebula";
  if (t.tone) return { ...t.tone, motion };
  const bg = solid(t.vars["--paper"], "#ffffff");
  const card = solid(t.vars["--surface"], bg);
  const cover = solid(t.vars["--cover"], bg);
  const accent = solid(t.vars["--stamp"], bg);
  const mode = relativeLuminance(bg) < 0.18 ? "dark" : relativeLuminance(cover) > 0.3 ? "pastel" : "vivid";
  const full: ToneSpec = { mode, main: cover, sub: null, motion, bg, card, cover, accent };
  const tries: ToneSpec[] = [full, { ...full, accent: undefined }, { ...full, accent: undefined, card: undefined }];
  return tries.find((x) => buildTone(x).minRatio >= MIN_TEXT_RATIO) ?? { mode, main: cover, sub: null, motion };
}
