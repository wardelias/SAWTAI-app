import { ImageResponse } from "next/og";

export const alt = "Sawt AI — AI voice agents that call every lead in seconds";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social share card for the landing page, in the same "liquid glass on white" look.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          backgroundColor: "#faf8ff",
          backgroundImage:
            "radial-gradient(circle at 8% 10%, rgba(139,92,246,0.32), transparent 45%), radial-gradient(circle at 92% 18%, rgba(192,132,252,0.30), transparent 42%), radial-gradient(circle at 18% 95%, rgba(129,140,248,0.22), transparent 45%), radial-gradient(circle at 88% 92%, rgba(217,70,239,0.18), transparent 40%)",
          color: "#1d1d1f",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#8b5cf6" }} />
          Sawt AI
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 40,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
          }}
        >
          <span>Call every lead in seconds.</span>
          <span style={{ color: "#8e84b8" }}>Close more without dialing.</span>
        </div>
        <div style={{ display: "flex", marginTop: 36, fontSize: 30, color: "#6e6e73" }}>
          AI voice agents that qualify and book your leads — 24/7.
        </div>
      </div>
    ),
    size,
  );
}
