import type { Metadata } from "next";
import PlausibleProvider from "next-plausible";
import "./globals.css";

export const dynamic = "force-dynamic";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://convos.org/assistants";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Convos Assistants Preview",
  description: "Copy any skill link and paste it into the chat with your Assistant.",
  openGraph: {
    title: "Convos Assistants Preview",
    description: "Copy any skill link and paste it into the chat with your Assistant.",
    type: "website",
    siteName: "Convos Assistants",
    images: [
      {
        url: `${siteUrl}/og`,
        width: 1200,
        height: 630,
        alt: "Convos Assistants Preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Convos Assistants Preview",
    description: "Copy any skill link and paste it into the chat with your Assistant.",
    images: [`${siteUrl}/og`],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <PlausibleProvider
          domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "convos.org"}
          enabled={!!process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
        >
          {children}
        </PlausibleProvider>
      </body>
    </html>
  );
}
