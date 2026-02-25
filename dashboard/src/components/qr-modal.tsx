"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QrModalProps {
  /** Agent name shown in the modal title. Null when closed. */
  agentName: string | null;
  /** The invite URL to display as QR code and copy link. */
  inviteUrl: string;
  /** Called when the modal should close. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

function CopyIcon() {
  return (
    <svg
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
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ConvosQrLogo() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <style>{`.s0{fill:#000}.s1{fill:#fff}.s2{fill:none;stroke:#000;stroke-width:7.2}`}</style>
      <path
        fillRule="evenodd"
        className="s0"
        d="m24 0h72c13.25 0 24 10.75 24 24v72c0 13.25-10.75 24-24 24h-72c-13.25 0-24-10.75-24-24v-72c0-13.25 10.75-24 24-24z"
      />
      <path
        fillRule="evenodd"
        className="s1"
        d="m60 30c16.57 0 30 13.43 30 30 0 16.57-13.43 30-30 30-16.57 0-30-13.43-30-30 0-16.57 13.43-30 30-30z"
      />
      <path className="s2" d="m40 60h40" />
      <path className="s2" d="m50 60h40" />
      <path className="s2" d="m60 40v40" />
      <path className="s2" d="m45.9 45.86l28.28 28.28" />
      <path className="s2" d="m45.9 74.14l28.28-28.28" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QrModal({ agentName, inviteUrl, onClose }: QrModalProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = agentName !== null;

  // Reset copied state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Backdrop click handler
  // -----------------------------------------------------------------------

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // -----------------------------------------------------------------------
  // Copy invite URL
  // -----------------------------------------------------------------------

  const handleCopyInvite = useCallback(async () => {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);

      // Clear any existing timer
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }

      copyTimer.current = setTimeout(() => {
        setCopied(false);
        copyTimer.current = null;
      }, 1500);
    } catch {
      // Clipboard write failed silently
    }
  }, [inviteUrl]);

  // -----------------------------------------------------------------------
  // QR code image URL
  // -----------------------------------------------------------------------

  const qrSrc = inviteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(inviteUrl)}`
    : "";

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className={`modal-overlay${isOpen ? " active" : ""}`}
      id="qr-modal"
      onClick={handleBackdropClick}
    >
      <div className="modal">
        <h3 id="modal-title">{agentName || "QR Code"}</h3>
        <a
          className="qr-wrap"
          id="qr-wrap"
          href={inviteUrl || "#"}
          target="_blank"
          rel="noopener"
        >
          <img id="modal-qr" src={qrSrc} alt="Scan to connect" />
          <div className="icon-center" aria-hidden="true">
            <ConvosQrLogo />
          </div>
        </a>
        <div
          className={`invite-row${copied ? " copied" : ""}`}
          id="invite-row"
          title="Click to copy"
          onClick={handleCopyInvite}
        >
          <span className="invite-url" id="modal-invite">
            {copied ? "Copied!" : inviteUrl}
          </span>
          <span id="copy-icon-wrap" className="copy-icon">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </span>
        </div>
      </div>
    </div>
  );
}
