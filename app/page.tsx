// app/page.tsx
export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>ยินดีต้อนรับสู่ i LexXa</h1>
      <p>ศูนย์บริการและรับประกันสินค้าผ่านออนไลน์</p>

      <a
        href="/warranty"
        style={{
          display: "inline-block",
          marginTop: "1.5rem",
          padding: "0.75rem 1.5rem",
          background: "#fe7300",
          color: "white",
          borderRadius: "10px",
          textDecoration: "none",
          fontWeight: 800,
        }}
      >
        ลงทะเบียนรับประกันสินค้า
      </a>
    </main>
  );
}
