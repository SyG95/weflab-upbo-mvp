export default function RootPage() {
  return (
    <main style={{ padding: 48, fontFamily: "var(--font-base)" }}>
      <p style={{ color: "var(--color-muted)", fontSize: 14 }}>
        스트리머 페이지는 <code>/[스트리머 슬러그]</code> 경로에서 확인할 수 있어요. 예: <code>/demo</code>
      </p>
    </main>
  );
}
