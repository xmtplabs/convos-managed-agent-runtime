import type { Metadata } from "next";
import PlausibleProvider from "next-plausible";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://assistants.convos.org",
  ),
  title: "Convos Assistants",
  description: "AI assistants for your group chats",
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
