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
        setMsg({ kind: "err", text: data?.error || "저장 실패 — 다시 시도해 주세요." });
      } else {
        setMsg({ kind: "ok", text: "저장됐어요! 업보시트에 바로 적용됩니다." });
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
          ← 업보시트 관리자 설정으로
        </a>
        <h1 className={styles.title}>업보시트 테마 고르기</h1>
        <p className={styles.sub}>
          <b>{slug}</b> 업보시트의 전체 분위기를 골라보세요. 표·기능은 그대로, 색·느낌만 바뀝니다.
        </p>
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
              <span className={styles.cardBlurb}>{t.blurb}</span>
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
          <div><span className={styles.paletteEyebrow}>MY PALETTE</span><h2>내 색상으로 꾸미기<span className={styles.paletteDot} /></h2><p>좋아하는 세 가지 색으로, 나만의 시트를 완성해 보세요.</p></div>
          <label className={styles.paletteToggle}><input type="checkbox" role="switch" aria-label="직접 색상 사용" checked={Boolean(custom)} onChange={e=>setCustom(e.target.checked?colors:null)}/><span className={styles.toggleTrack} aria-hidden="true"/><span>{custom?'사용 중':'사용 안 함'}</span></label>
        </div>
        {custom ? <>
          <div className={styles.colorFields}>{(['background','surface','accent'] as const).map((key,i)=><div className={styles.colorTile} key={key}>
            <label className={styles.colorWell} style={{background:/^#[0-9a-f]{6}$/i.test(colors[key])?colors[key]:'#eeeeee'}}>
              <input aria-label={['배경색 선택','카드색 선택','포인트색 선택'][i]} type="color" value={/^#[0-9a-f]{6}$/i.test(colors[key])?colors[key]:'#ffffff'} onChange={e=>setColors({...colors,[key]:e.target.value})}/>
              <span className={styles.editColor} aria-hidden="true">↗ 색상 선택</span>
            </label>
            <div className={styles.colorMeta}><div><label htmlFor={`palette-${key}`}>{['배경색','카드색','포인트색'][i]}</label><span>{['시트 전체의 분위기','내용이 담기는 바탕','버튼과 강조에 쓰는 색'][i]}</span></div><input id={`palette-${key}`} aria-label={['배경색 HEX','카드색 HEX','포인트색 HEX'][i]} spellCheck={false} autoComplete="off" value={colors[key]} maxLength={7} aria-invalid={!/^#[0-9a-f]{6}$/i.test(colors[key])} onChange={e=>setColors({...colors,[key]:e.target.value})}/></div>
          </div>)}</div>
          <div className={styles.paletteFooter}>
            <div className={styles.paletteStatus} role="status" data-valid={safe && valid}><span className={styles.statusMark} aria-hidden="true">{safe && valid?'✓':'!'}</span><div><strong>{!valid?'색상 코드를 확인해 주세요':!safe?'배경과 카드의 밝기를 맞춰 주세요':'편안하게 읽을 수 있는 조합이에요'}</strong><span>{!valid?'#RRGGBB 형식으로 입력할 수 있어요.':!safe?'둘 다 밝게 또는 어둡게 바꾸면 글자가 선명해져요.':'글자와 버튼의 명도는 자동으로 맞춰드려요.'}</span></div></div>
            <button className={styles.paletteReset} type="button" onClick={()=>{setCustom(null);setMsg(null);}}>↶ 기본 테마로 복원</button>
          </div>
          {safe && valid && palette && <details className={styles.paletteDetails}><summary>색상 적용 정보</summary><p>본문 최소 대비 {palette.ratio.toFixed(2)}:1 · 포인트 적용색 <span style={{background:palette.accent}} aria-hidden="true"/> {palette.accent.toUpperCase()}<br/>가독성을 위해 입력한 포인트색의 명도가 보정될 수 있어요. 커스텀 배경은 정적으로 표시됩니다.</p></details>}
        </> : <div className={styles.paletteOff}><span aria-hidden="true">◯ ◯ ◯</span><p>지금은 선택한 기본 테마를 사용하고 있어요.<br/>스위치를 켜면 직접 색상을 조합할 수 있어요.</p></div>}
        <p className={styles.paletteHint}>변경한 색상은 미리보기에만 적용돼요. 마음에 들면 아래에서 저장해 주세요.</p>
      </section>
      <div className={styles.saveBar}>
        <button className={styles.saveBtn} type="button" onClick={save} disabled={saving || !safe}>
          {saving ? "저장 중…" : `${theme.emoji} 이 테마로 저장`}
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
