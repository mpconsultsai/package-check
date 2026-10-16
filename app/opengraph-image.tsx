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
          justifyContent: "center",
          background: "#0f172a",
          color: "#f8fafc",
          padding: "72px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#93c5fd",
          }}
        >
          npm, PyPI and NuGet
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          Package Check
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 28,
            maxWidth: 860,
            fontSize: 36,
            lineHeight: 1.35,
            color: "#cbd5e1",
          }}
        >
          Review packages before you install them. Security, quality, and
          dependencies at a glance.
        </div>
      </div>
    ),
    { ...size },
  );
}
