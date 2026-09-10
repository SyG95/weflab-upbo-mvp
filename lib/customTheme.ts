import type { Theme } from './themes';

export type CustomTheme = { version: 1; background: string; surface: string; accent: string; motion: boolean };
export const defaultCustomTheme: CustomTheme = { version: 1, background: '#fff4f8', surface: '#ffffff', accent: '#cd477d', motion: false };
export function parseCustomTheme(value: unknown): CustomTheme | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('색상 설정 형식이 올바르지 않아요.');
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.motion !== 'boolean' || Object.keys(v).some(k => !['version','background','surface','accent','motion'].includes(k))) throw new Error('지원하지 않는 색상 설정이에요.');
  for (const k of ['background','surface','accent']) if (typeof v[k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(v[k] as string)) throw new Error('색상은 #RRGGBB 형식으로 입력해 주세요.');
  return {version:1, background:(v.background as string).toLowerCase(),surface:(v.surface as string).toLowerCase(),accent:(v.accent as string).toLowerCase(),motion:v.motion};
}
function luminance(hex: string) { const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722; }
export function contrast(a: string,b: string) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function mix(a:string,b:string,t:number) { return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join(''); }
export function customThemeColors(c:CustomTheme) {
  const score=(v:string)=>Math.min(contrast(v,c.background),contrast(v,c.surface));
  const ink=score('#111111')>=score('#ffffff')?'#111111':'#ffffff';
  let accent=c.accent;
  for(let i=0;i<=100;i++){accent=mix(c.accent,ink,i/100);if(score(accent)>=4.5)break;}
  const onAccent=contrast('#111111',accent)>=contrast('#ffffff',accent)?'#111111':'#ffffff';
  return {ink,accent,onAccent,ratio:score(ink),accentRatio:score(accent)};
}
export function applyCustomTheme(base:Theme,value:unknown):Theme {
  let c:CustomTheme|null;try{c=parseCustomTheme(value);}catch{return base;}
  if(!c)return base;const p=customThemeColors(c);if(p.ratio<4.5)return base;
  return {...base,label:'내 색상',vars:{...base.vars,'--page-bg':c.background,'--paper':c.background,'--surface':c.surface,'--ink':p.ink,'--muted':p.ink,'--stamp':p.accent,'--stamp-soft':mix(c.surface,p.accent,.12),'--paper-line':mix(c.surface,p.ink,.3),'--rule-line':mix(c.background,p.ink,.1),'--cover':p.accent,'--on-cover':p.onAccent,'--on-accent':p.onAccent,'--modal-bg':c.surface,'--glass-border':mix(c.surface,p.ink,.25),'--glass-shadow':'transparent'},fx:{glass:false,...(c.motion?{background:'nebula' as const,nebulaPalette:{base:[c.background,c.background] as [string,string],clouds:[c.background,c.background,c.background] as [string,string,string]}}:{})}};
}
