"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateActionsProps {
  slug: string;
  notionPageId: string | null;
  agentName: string;
  /** Base site URL passed from the server to avoid hardcoding in SSR fallback. */
  siteUrl: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateActions({
  slug,
  notionPageId,
  agentName,
  siteUrl,
}: TemplateActionsProps) {
  const [copyState, setCopyState] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Copy prompt handler
  // -----------------------------------------------------------------------

  const handleCopyPrompt = useCallback(async () => {
    if (!notionPageId || copyState === "loading") return;

    setCopyState("loading");
    try {
      const res = await fetch(`/api/prompts/${notionPageId}`);
      if (!res.ok) throw new Error("Failed to fetch prompt");
      const data = await res.json();
      await navigator.clipboard.writeText(data.prompt);
      setCopyState("copied");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [notionPageId, copyState]);

  // -----------------------------------------------------------------------
  // QR code via external API (same provider as QrModal).
  // A dedicated /qr/:slug route is created in Task 10.
  // -----------------------------------------------------------------------

  const templateUrl = typeof window !== "undefined"
    ? `${window.location.origin}/a/${encodeURIComponent(slug)}`
    : `${siteUrl}/a/${encodeURIComponent(slug)}`;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(templateUrl)}`;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Add to group chat button */}
        <a
          href={`/?agent=${encodeURIComponent(slug)}`}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white bg-[#E54D00] rounded-xl no-underline hover:bg-[#cc4400] transition-colors"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Add to group chat
        </a>

        {/* Copy prompt button */}
        {notionPageId && (
          <button
            onClick={handleCopyPrompt}
            disabled={copyState === "loading"}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-medium text-[#555] bg-white rounded-xl border border-[#ddd] hover:bg-[#f9f9f9] transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copyState === "loading"
              ? "Loading..."
              : copyState === "copied"
                ? "Copied!"
                : copyState === "error"
                  ? "Failed"
                  : "Copy prompt"}
          </button>
        )}
      </div>

      {/* QR code section */}
      <div className="pt-6 border-t border-[#eee]">
        <h2 className="text-xs font-semibold text-[#999] uppercase tracking-wider mb-3">
          Share this assistant
        </h2>
        <div className="flex items-center gap-4">
          <img
            src={qrImageUrl}
            alt={`QR code for ${agentName}`}
            width={96}
            height={96}
            className="rounded-lg border border-[#e5e5e5]"
          />
          <p className="text-sm text-[#666] leading-relaxed">
            Scan this QR code to open this assistant page on another device.
          </p>
        </div>
      </div>
    </div>
  );
}
