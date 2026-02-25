import QRCode from "qrcode";
import { getSkill } from "@/lib/api";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** QR code size in pixels. */
const QR_SIZE = 400;

/** Cache duration: 24 hours. */
const CACHE_MAX_AGE = 86400;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const template = await getSkill(slug);

  if (!template) {
    return new Response("Template not found", { status: 404 });
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org";
  const templateUrl = `${siteUrl}/a/${encodeURIComponent(slug)}`;

  const pngBuffer = await QRCode.toBuffer(templateUrl, {
    type: "png",
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  return new Response(new Uint8Array(pngBuffer), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}`,
    },
  });
}
