"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalState = "closed" | "loading" | "loaded" | "error" | "copy-feedback";

interface PromptModalProps {
  /** The Notion page ID to fetch the prompt for, or null when closed. */
  pageId: string | null;
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
// Prompt cache (shared across component lifetime, avoids re-fetching)
// ---------------------------------------------------------------------------

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const promptCache: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptModal({
  pageId,
  agentName,
  onClose,
  activeStep,
  setActiveStep,
}: PromptModalProps) {
  const [state, setState] = useState<ModalState>("closed");
  const [promptText, setPromptText] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Whether the modal is open (pageId is set)
  const isOpen = pageId !== null;

  // -----------------------------------------------------------------------
  // Fetch prompt when pageId changes (modal opens)
  // -----------------------------------------------------------------------

  useEffect(() => {
    // Clear any pending copy timer when pageId changes to prevent stale setState
    if (copyTimer.current) {
      clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }

    if (!pageId) {
      setState("closed");
      setPromptText("");
      return;
    }

    // Check cache first
    if (promptCache[pageId]) {
      setPromptText(promptCache[pageId]);
      setState("loaded");
      return;
    }

    setState("loading");
    setPromptText("");

    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${basePath}/api/prompts/${pageId}`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        const text = data.prompt || "(No prompt content found)";
        promptCache[pageId!] = text;
        if (!cancelled) {
          setPromptText(text);
          setState("loaded");
        }
      } catch {
        if (!cancelled) {
          setState("error");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [pageId]);

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
    if (state !== "loaded" && state !== "copy-feedback") return;
    if (!promptText) return;

    try {
      await navigator.clipboard.writeText(promptText);
      setState("copy-feedback");

      // Advance step 2 -> 3
      if (activeStep === 2) {
        setActiveStep(3);
      }

      // Clear any existing timer
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
  }, [state, promptText, activeStep, setActiveStep]);

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

  let bodyText = "";
  if (state === "loading") {
    bodyText = "Loading...";
  } else if (state === "error") {
    bodyText = "Failed to load prompt. Try again later.";
  } else {
    bodyText = promptText;
  }

  const copyButtonText =
    state === "copy-feedback" ? "Copied!" : "Copy full prompt";
  const copyButtonDisabled = state === "error" || state === "loading";

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
            className={`ps-modal-copy${state === "copy-feedback" ? " copied" : ""}`}
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
