"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillActionsProps {
  slug: string;
  prompt: string;
  agentName: string;
  siteUrl: string;
}

// ---------------------------------------------------------------------------
// Styles (inline to override homepage.css global reset)
// ---------------------------------------------------------------------------

const btnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  fontFamily: "'Inter', -apple-system, sans-serif",
  fontWeight: 600,
  fontSize: "14px",
  lineHeight: "1",
  borderRadius: "10px",
  cursor: "pointer",
  textDecoration: "none",
  transition: "all 0.15s ease",
  border: "none",
  whiteSpace: "nowrap",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  padding: "12px 20px",
  backgroundColor: "#FC4F37",
  color: "#FFFFFF",
};

const btnSecondary: React.CSSProperties = {
  ...btnBase,
  padding: "10px 16px",
  backgroundColor: "#FFFFFF",
  color: "#666666",
  border: "1px solid #EBEBEB",
  fontWeight: 500,
};

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillActions({ slug, prompt, siteUrl }: SkillActionsProps) {
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const [promptState, setPromptState] = useState<"idle" | "copied" | "error">("idle");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (shareTimer.current) clearTimeout(shareTimer.current);
      if (promptTimer.current) clearTimeout(promptTimer.current);
    };
  }, []);

  const handleShare = useCallback(async () => {
    const url = `${siteUrl}/${encodeURIComponent(slug)}`;

    // Try native share first (mobile), fall back to clipboard
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      if (!mountedRef.current) return;
      setShareState("copied");
      if (shareTimer.current) clearTimeout(shareTimer.current);
      shareTimer.current = setTimeout(() => {
        if (mountedRef.current) setShareState("idle");
      }, 2000);
    } catch {}
  }, [slug, siteUrl]);

  const handleCopyPrompt = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      if (!mountedRef.current) return;
      setPromptState("copied");
      if (promptTimer.current) clearTimeout(promptTimer.current);
      promptTimer.current = setTimeout(() => {
        if (mountedRef.current) setPromptState("idle");
      }, 2000);
    } catch {
      if (!mountedRef.current) return;
      setPromptState("error");
      if (promptTimer.current) clearTimeout(promptTimer.current);
      promptTimer.current = setTimeout(() => {
        if (mountedRef.current) setPromptState("idle");
      }, 2000);
    }
  }, [prompt]);

  return (
    <div style={{ display: "flex", gap: "8px", marginBottom: "0" }}>
      <button onClick={handleShare} style={btnPrimary}>
        <ShareIcon />
        {shareState === "copied" ? "Link copied!" : "Share"}
      </button>
      {prompt && (
        <button onClick={handleCopyPrompt} style={btnSecondary}>
          <CopyIcon />
          {promptState === "copied" ? "Copied!" : promptState === "error" ? "Failed" : "Copy prompt"}
        </button>
      )}
    </div>
  );
}
