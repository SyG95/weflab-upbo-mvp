"use client";

// 스트리머가 자기 업보시트 테마를 직접 고르는 화면.
// 기존 extension 토큰으로 인증한다(새 로그인 없음). 전용 링크 #토큰 으로 들어오면 자동 입력.

import { useState, type CSSProperties } from "react";
import { THEMES, resolveTheme, type Theme } from "../../../lib/themes";
import {parseCustomTheme,defaultCustomTheme,customThemeColors} from "../../../lib/customTheme";
import FinalDeliveryView, {type FinalDeliveryRow} from "../FinalDeliveryView";
import styles from "./settings.module.css";

export default function ThemePicker({ slug, initialThemeId, initialCustom }: { slug: string; initialThemeId: string; initialCustom?: unknown }) {
  const [selected, setSelected] = useState(initialThemeId || "paper");
  const [custom, setCustom] = useState(()=>{try{return parseCustomTheme(initialCustom);}catch{return null;}});
  const [colors,setColors]=useState(()=>custom ?? defaultCustomTheme);
  const [previewTab,setPreviewTab]=useState("fan");
  const valid = Object.values(colors).filter(v=>typeof v==="string").every(v=>/^#[0-9a-f]{6}$/i.test(String(v)));
  const palette = valid ? customThemeColors(colors) : null;
  const safe = !custom || Boolean(palette && palette.ratio>=4.5);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const theme = resolveTheme(selected, custom && safe ? colors : null);

  async function save() {
    // 인증은 관리자 로그인 세션(쿠키)으로 처리 — 토큰 붙여넣기 불필요.
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(slug)}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: selected, custom:custom ? colors : null }),
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

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <a
          href={`/${slug}?admin=1&atab=settings`}
          style={{ fontSize: 13, opacity: 0.7, textDecoration: "none", color: "inherit" }}
        >
          ← 관리자 설정
        </a>
        <h1 className={styles.title}>테마 설정</h1>

      </header>

      <div className={styles.layout}>
        <div className={styles.grid}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.card} ${t.id === selected ? styles.cardOn : ""}`}
              onClick={() => {setSelected(t.id);setCustom(null);setMsg(null);}}
              aria-pressed={t.id === selected}
            >
              <span className={styles.swatch} aria-hidden style={swatchStyle(t)} />
              <span className={styles.cardLabel}>
                {t.emoji} {t.label}
              </span>

            </button>
          ))}
        </div>

        <aside className={styles.previewCol}>
          <p className={styles.previewLabel}>미리보기</p>
          <div className={styles.previewSwitch}><button type="button" aria-pressed={previewTab==='fan'} onClick={()=>setPreviewTab('fan')}>팬 화면</button><button type="button" aria-pressed={previewTab==='delivery'} onClick={()=>setPreviewTab('delivery')}>배송관리</button></div>
          <ThemePreview theme={theme} slug={slug} delivery={previewTab==='delivery'} />
        </aside>
      </div>

      <section className={styles.customPanel} aria-label="직접 색상 설정">
        <div className={styles.paletteHeader}>
          <div><h2>직접 색상 고르기</h2></div>
          <label className={styles.paletteToggle}><input type="checkbox" role="switch" aria-label="직접 색상 사용" checked={Boolean(custom)} onChange={e=>setCustom(e.target.checked?colors:null)}/><span className={styles.toggleTrack} aria-hidden="true"/><span>{custom?'사용 중':'사용 안 함'}</span></label>
        </div>
        {custom ? <>
          <div className={styles.colorFields}>{(['background','surface','accent'] as const).map((key,i)=><div className={styles.colorTile} key={key}>
            <label className={styles.colorWell} style={{background:/^#[0-9a-f]{6}$/i.test(colors[key])?colors[key]:'#eeeeee'}}>
              <input aria-label={['배경색 선택','카드색 선택','포인트색 선택'][i]} type="color" value={/^#[0-9a-f]{6}$/i.test(colors[key])?colors[key]:'#ffffff'} onChange={e=>setColors({...colors,[key]:e.target.value})}/>
              <span className={styles.editColor} aria-hidden="true">↗ 색상 선택</span>
            </label>
            <div className={styles.colorMeta}><div><label htmlFor={`palette-${key}`}>{['배경색','카드색','포인트색'][i]}</label></div><input id={`palette-${key}`} aria-label={['배경색 HEX','카드색 HEX','포인트색 HEX'][i]} spellCheck={false} autoComplete="off" value={colors[key]} maxLength={7} aria-invalid={!/^#[0-9a-f]{6}$/i.test(colors[key])} onChange={e=>setColors({...colors,[key]:e.target.value})}/></div>
          </div>)}</div>
          <div className={styles.paletteFooter}>
            {(!valid || !safe) && <div className={styles.paletteStatus} role="status"><span className={styles.statusMark} aria-hidden="true">!</span><div><strong>{!valid?'색상 코드를 확인해 주세요.':'글자가 잘 안 보여요.'}</strong><span>{!valid?'#FFFFFF처럼 6자리로 입력해 주세요.':'배경과 카드를 둘 다 밝게 또는 어둡게 바꿔 주세요.'}</span></div></div>}
            <button className={styles.paletteReset} type="button" onClick={()=>{setCustom(null);setMsg(null);}}>↶ 기본 테마로 복원</button>
          </div>
          {safe && valid && palette && palette.accent.toLowerCase() !== colors.accent.toLowerCase() && <p className={styles.paletteHint}>글자가 잘 보이도록 포인트색을 <b>{palette.accent.toUpperCase()}</b>로 조정했어요.</p>}
        </> : <div className={styles.paletteOff}><p>기본 테마를 사용 중이에요.</p></div>}
        <p className={styles.paletteHint}>저장을 눌러야 시트에 반영돼요.</p>
      </section>
      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving || !safe}>
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
      {msg ? <p className={msg.kind === "ok" ? styles.ok : styles.err}>{msg.text}</p> : null}
    </div>
  );
}

function swatchStyle(t: Theme): CSSProperties {
  const v = t.vars;
  return {
    background: `linear-gradient(135deg, ${v["--cover"]} 0 38%, ${v["--stamp"]} 38% 68%, ${v["--surface"]} 68% 100%)`,
  };
}

function ThemePreview({ theme, slug, delivery }: { theme: Theme; slug: string; delivery: boolean }) {
  return (
    <div
      className={styles.preview}
      style={theme.vars as CSSProperties}
      data-glass={theme.fx?.glass ? "1" : undefined}
    >
      {delivery ? <FinalDeliveryView rows={previewRows} initialMonth="all" disabled onChange={()=>{}} onNote={()=>{}} design="ref-u"/> : <>
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
          <span className={styles.pvChip}>
            <b className={styles.pvItem}>치킨</b>
            <b className={styles.pvProb}>2%</b>
          </span>
        </div>
        <div className={styles.pvBtnRow}>
          <span className={styles.pvBtn}>찾기</span>
        </div>
      </div></>}
    </div>
  );
}

const previewRows = ['달빛여우','별헤는밤'].map((name,i)=>({v:{key:String(i),fanId:'viewer'+i,fanNickname:name},it:{itemName:i?'치킨':'스벅콘',amountRangeLabel:'선물'},ref:{entryId:String(i),quantity:3,recordedAtMs:Date.UTC(2026,8-i,5),recordedKind:'donate'},alloc:{allocated:i,state:i?'part':'pending',doneAt:null},aKey:String(i)})) as FinalDeliveryRow[];
