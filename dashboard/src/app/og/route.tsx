import { ImageResponse } from "@vercel/og";

export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f5f5f5",
          fontFamily: "Inter, sans-serif",
          padding: "48px 56px",
        }}
      >
        {/* Top bar: logo + branding */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "40px",
          }}
        >
          <svg viewBox="0 0 28 36" fill="none" width="24" height="30">
            <path
              d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z"
              fill="#FC4F37"
            />
            <path
              d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z"
              fill="#FC4F37"
            />
          </svg>
          <span
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "#333",
              letterSpacing: "-0.3px",
            }}
          >
            Convos{" "}
            <span style={{ fontWeight: 400, color: "#666666" }}>
              Assistants Preview
            </span>
          </span>
        </div>

        {/* Main content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: "52px",
              fontWeight: 700,
              color: "#111",
              letterSpacing: "-1.5px",
              lineHeight: 1.1,
              marginBottom: "16px",
              maxWidth: "700px",
            }}
          >
            Teach your assistant anything
          </span>

          <span
            style={{
              fontSize: "22px",
              color: "#555",
              lineHeight: 1.5,
              maxWidth: "600px",
              marginBottom: "32px",
            }}
          >
            Copy any skill link and text it to your Assistant to use it.
          </span>

          {/* CTA pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#FC4F37",
              color: "#fff",
              fontSize: "18px",
              fontWeight: 600,
              padding: "12px 24px",
              borderRadius: "12px",
              alignSelf: "flex-start",
            }}
          >
            Browse skills
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
    },
  );
}
