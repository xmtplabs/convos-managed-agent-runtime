"use client";

import { useState } from "react";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://convos.org/assistants";

export function ShareButton({ slug, size = "sm" }: { slug: string; size?: "sm" | "lg" }) {
  const [copied, setCopied] = useState(false);
  const url = `${siteUrl}/${slug}`;

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <button
      onClick={handleCopy}
      className={`share-pill ${size === "lg" ? "share-pill-lg" : ""} ${copied ? "share-pill-copied" : ""}`}
    >
      <svg width={size === "lg" ? 13 : 12} height={size === "lg" ? 13 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
        <polyline points="16 6 12 2 8 6"/>
        <line x1="12" y1="2" x2="12" y2="15"/>
      </svg>
      {copied ? "Link copied!" : "Share"}
    </button>
  );
}
