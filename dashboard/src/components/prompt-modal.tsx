"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalState = "closed" | "loaded" | "copy-feedback";

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
  const [state, setState] = useState<ModalState>("closed");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOpen = prompt !== null;

  // -----------------------------------------------------------------------
  // Reset state when prompt changes
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }

    if (!prompt) {
      setState("closed");
      return;
    }

    setState("loaded");
  }, [prompt]);

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
      setState("copy-feedback");

      // Advance step 2 -> 3
      if (activeStep === 2) {
        setActiveStep(3);
      }

      if (copyTimer.current) {
        clearTimeout(copyTimer.current);
      }

      copyTimer.current = setTimeout(() => {
        setState("loaded");
        copyTimer.current = null;
      }, 1500);
    } catch {
      // Clipboard write failed silently
    }
  }, [prompt, activeStep, setActiveStep]);

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
  // Render
  // -----------------------------------------------------------------------

  const bodyText = prompt || "";
  const copyButtonText =
    state === "copy-feedback" ? "Copied!" : "Copy full prompt";

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
            className={`ps-modal-copy${state === "copy-feedback" ? " copied" : ""}`}
            id="ps-modal-copy"
            onClick={handleCopy}
            disabled={!prompt}
          >
            {copyButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}
