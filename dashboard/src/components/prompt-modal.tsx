"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptModalProps {
  /** The prompt text to display, or null when closed. */
  prompt: string | null;
  /** Agent name shown in the modal title. */
  agentName: string;
  /** Called when the modal should close. */
  onClose: () => void;
  /** Current active step for step highlight advancement. */
  activeStep: number;
  /** Callback to advance step highlight. */
  setActiveStep: (step: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptModal({
  prompt,
  agentName,
  onClose,
  activeStep,
  setActiveStep,
}: PromptModalProps) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpen = prompt !== null;

  // -----------------------------------------------------------------------
  // Lock body scroll when open
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // -----------------------------------------------------------------------
  // Escape key closes modal
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // -----------------------------------------------------------------------
  // Cleanup copy timer on unmount
  // -----------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Copy handler
  // -----------------------------------------------------------------------

  const handleCopy = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      if (activeStep === 2) setActiveStep(3);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [prompt, activeStep, setActiveStep]);

  // -----------------------------------------------------------------------
  // Backdrop click handler
  // -----------------------------------------------------------------------

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      // Only close if clicking the overlay itself, not the modal content
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // -----------------------------------------------------------------------
  // Derive display text
  // -----------------------------------------------------------------------

  const bodyText = prompt || "";
  const copyButtonText = copied ? "Copied!" : "Copy full prompt";
  const copyButtonDisabled = !prompt;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className={`ps-modal-overlay${isOpen ? " open" : ""}`}
      id="ps-modal"
      onClick={handleBackdropClick}
    >
      <div className="ps-modal">
        <div className="ps-modal-head">
          <span className="ps-modal-title" id="ps-modal-name">
            {agentName}
          </span>
          <button
            className="ps-modal-close"
            id="ps-modal-close"
            aria-label="Close modal"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div className="ps-modal-body">
          <div className="ps-modal-text" id="ps-modal-text">
            {bodyText}
          </div>
        </div>
        <div className="ps-modal-footer">
          <button
            className={`ps-modal-copy${copied ? " copied" : ""}`}
            id="ps-modal-copy"
            onClick={handleCopy}
            disabled={copyButtonDisabled}
          >
            {copyButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}
