import { ImageResponse } from "next/og";

export const alt = "Package Check, npm, PyPI and NuGet package reviews";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f3f0e8",
          color: "#1a1916",
          padding: "64px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "4px solid #1a1916",
            paddingBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <svg width="56" height="56" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="3" fill="#1a1916" />
              <path
                fill="none"
                stroke="#f3f0e8"
                strokeWidth="3.4"
                strokeLinecap="square"
                d="M8.5 16.5 13.5 21.5 23.5 10.5"
              />
              <rect x="23" y="23" width="5" height="5" fill="#c8431b" />
            </svg>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 600 }}>
              Package Check
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#7a7569" }}>
            npm · PyPI · NuGet
          </div>
        </div>
        <div
          style={{
            display: "flex",
            maxWidth: 980,
            fontSize: 64,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
          }}
        >
          Package reviews for npm, PyPI and NuGet: security, upkeep and
          dependencies in one place.
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#5d5951" }}>
          Review a package before you install it.
        </div>
      </div>
    ),
    { ...size },
  );
}
