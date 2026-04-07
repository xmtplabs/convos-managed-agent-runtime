"use client";

import { useState, useCallback, useRef } from "react";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://convos.org/assistants";

export function ShareButton({ slug, size = "sm" }: { slug: string; size?: "sm" | "lg" }) {
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const url = `${siteUrl}/${slug}`;
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShowToast(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      toastTimer.current = setTimeout(() => setShowToast(false), 3000);
    } catch {}
  }, [url]);

  return (
    <>
      <button
        onClick={handleCopy}
        className={`share-pill ${size === "lg" ? "share-pill-lg" : ""} ${copied ? "share-pill-copied" : ""}`}
      >
        <svg width={size === "lg" ? 13 : 12} height={size === "lg" ? 13 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {copied ? "Copied!" : "Copy"}
      </button>
      {showToast && (
        <div className="copy-toast">
          Paste this in the chat with your assistant
        </div>
      )}
    </>
  );
}
