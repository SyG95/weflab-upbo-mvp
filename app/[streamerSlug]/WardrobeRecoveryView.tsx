import type { WardrobeItem } from "../../lib/wardrobeShared";

// Emergency server-rendered view: retains every public item, including v2
// unclassified items. No editing, grouping, or client-side state is required.
export default function WardrobeRecoveryView({ items }: { items: WardrobeItem[] }) {
  const visible = items.filter((item) => !item.hidden);
  return (
    <section aria-label="옷장 임시 보기" data-wardrobe-recovery="read-only">
      <p role="status">옷장을 점검하고 있어요. 지금은 공개 이미지 보기만 이용할 수 있어요.</p>
      {visible.length === 0 ? <p>표시할 공개 이미지가 없어요.</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        {visible.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" data-wardrobe-item={item.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.name || "이름 없는 이미지"} loading="lazy"
              style={{ width: "100%", maxHeight: 400, objectFit: "contain" }} />
            <span>{[item.name, item.variant].filter(Boolean).join(" · ") || "이름 없는 이미지"}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
