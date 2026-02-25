import { ImageResponse } from "@vercel/og";
import { getSkill } from "@/lib/api";
import { getSiteUrl } from "@/lib/url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const template = await getSkill(slug);

  if (!template) {
    return new Response("Template not found", { status: 404 });
  }

  // Truncate description to ~120 chars for readability on the card
  const description =
    template.description.length > 120
      ? template.description.slice(0, 117) + "..."
      : template.description;

  // Build QR code URL pointing to the template page
  const siteUrl = getSiteUrl(request);
  const templateUrl = `${siteUrl}/a/${encodeURIComponent(slug)}`;
  const qrUrl = `${siteUrl}/qr/${encodeURIComponent(slug)}`;

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
          {/* Convos logo — orange circle with triangle, inlined as SVG */}
          <svg
            viewBox="0 0 28 36"
            fill="none"
            width="24"
            height="30"
          >
            <path
              d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z"
              fill="#E54D00"
            />
            <path
              d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z"
              fill="#E54D00"
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
            Convos
          </span>
        </div>

        {/* Main content area */}
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: "48px",
          }}
        >
          {/* Left column: emoji, name, description, CTA */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              justifyContent: "center",
            }}
          >
            {/* Emoji */}
            <span style={{ fontSize: "72px", lineHeight: 1, marginBottom: "16px" }}>
              {template.emoji}
            </span>

            {/* Agent name */}
            <span
              style={{
                fontSize: "42px",
                fontWeight: 700,
                color: "#111",
                letterSpacing: "-0.5px",
                lineHeight: 1.15,
                marginBottom: "12px",
              }}
            >
              {template.name}
            </span>

            {/* Description */}
            <span
              style={{
                fontSize: "20px",
                color: "#555",
                lineHeight: 1.5,
                marginBottom: "28px",
              }}
            >
              {description}
            </span>

            {/* CTA pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#E54D00",
                color: "#fff",
                fontSize: "18px",
                fontWeight: 600,
                padding: "12px 24px",
                borderRadius: "12px",
                alignSelf: "flex-start",
              }}
            >
              {/* Chat bubble icon */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Add to your group chat
            </div>
          </div>

          {/* Right column: QR code + "No sign up required" */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "16px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrUrl}
              alt=""
              width={160}
              height={160}
              style={{
                borderRadius: "12px",
                border: "1px solid #e0e0e0",
              }}
            />
            <span
              style={{
                fontSize: "14px",
                color: "#888",
                fontWeight: 500,
              }}
            >
              No sign up required
            </span>
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
