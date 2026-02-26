"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  BalloonSvg,
  BalloonStringUpper,
  BalloonStringLower,
} from "./balloon-scene";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JoinState = "idle" | "joining" | "success" | "post-success" | "error";

interface ConfettiPiece {
  left: string;
  background: string;
  animationDelay: string;
  width: string;
  height: string;
  borderRadius: string;
}

interface JoinFlowProps {
  /** e.g. "production" | "staging" | "development" */
  poolEnvironment: string;
  /** Ref to the skill browser element for scroll-to on post-success */
  skillBrowserRef?: React.RefObject<HTMLDivElement | null>;
  /** Callback to expose activeStep to parent/siblings */
  activeStep: number;
  setActiveStep: (step: number) => void;
  /** Callback when QR modal should open */
  onShowQr?: (agentName: string, inviteUrl: string) => void;
}

// ---------------------------------------------------------------------------
// URL validation (same logic as original pool/src/index.js)
// ---------------------------------------------------------------------------

function validateJoinUrl(input: string): { valid: boolean; message?: string } {
  if (!input) return { valid: true };
  if (/^https?:\/\/(popup\.convos\.org|dev\.convos\.org)\/v2\?.+$/i.test(input))
    return { valid: true };
  if (/^https?:\/\/convos\.app\/join\/.+$/i.test(input))
    return { valid: true };
  if (/^convos:\/\/join\/.+$/i.test(input)) return { valid: true };
  if (/^[A-Za-z0-9+/=*_-]+$/.test(input) && input.length > 20)
    return { valid: true };
  return {
    valid: false,
    message: "Enter a valid Convos invite URL or invite slug",
  };
}

function checkEnvUrl(
  url: string,
  env: string,
): { valid: boolean; message?: string } {
  if (!url) return { valid: true };
  if (env === "production" && /dev\.convos\.org/i.test(url))
    return {
      valid: false,
      message: "dev.convos.org links cannot be used in production",
    };
  if (env !== "production" && /popup\.convos\.org/i.test(url))
    return {
      valid: false,
      message: `popup.convos.org links cannot be used in ${env}`,
    };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Confetti generation
// ---------------------------------------------------------------------------

const CONFETTI_COLORS = [
  "#FC4F37",
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#A855F7",
];

function generateConfetti(): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = [];
  for (let i = 0; i < 20; i++) {
    pieces.push({
      left: `${10 + Math.random() * 80}%`,
      background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      animationDelay: `${(Math.random() * 0.3).toFixed(3)}s`,
      width: `${4 + Math.random() * 4}px`,
      height: `${4 + Math.random() * 4}px`,
      borderRadius: Math.random() > 0.5 ? "50%" : "2px",
    });
  }
  return pieces;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JoinFlow({
  poolEnvironment,
  skillBrowserRef,
  activeStep,
  setActiveStep,
  onShowQr,
}: JoinFlowProps) {
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [available, setAvailable] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);

  const joiningAutoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Track all subsidiary timeouts so they can be cleared on unmount
  const pendingTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const launchingRef = useRef(launching);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep ref in sync so the polling closure reads the latest value
  useEffect(() => {
    launchingRef.current = launching;
  }, [launching]);

  // -----------------------------------------------------------------------
  // Pool availability polling (15s interval)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/pool/counts");
        const counts = await res.json();
        if (!launchingRef.current) {
          setAvailable(counts.idle > 0);
        }
      } catch {
        // Silently ignore fetch errors during polling
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, []);

  // Helper: schedule a timeout that auto-removes itself and is cleared on unmount
  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pendingTimers.current.delete(id);
      fn();
    }, ms);
    pendingTimers.current.add(id);
    return id;
  }, []);

  // -----------------------------------------------------------------------
  // Cleanup all timers on unmount
  // -----------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (joiningAutoHideTimer.current) {
        clearTimeout(joiningAutoHideTimer.current);
      }
      for (const id of pendingTimers.current) {
        clearTimeout(id);
      }
      pendingTimers.current.clear();
    };
  }, []);

  // -----------------------------------------------------------------------
  // hideJoiningOverlay
  // -----------------------------------------------------------------------

  const hideJoiningOverlay = useCallback(
    (skipFocus?: boolean) => {
      if (joiningAutoHideTimer.current) {
        clearTimeout(joiningAutoHideTimer.current);
        joiningAutoHideTimer.current = null;
      }
      setJoinState("idle");
      setToastVisible(false);
      setActiveStep(1);
      setInputValue("");
      setInputError(null);
      setConfettiPieces([]);
      if (!skipFocus) {
        // Focus the input on next render
        scheduleTimer(() => inputRef.current?.focus(), 0);
      }
    },
    [setActiveStep, scheduleTimer],
  );

  // -----------------------------------------------------------------------
  // handlePasteUrl
  // -----------------------------------------------------------------------

  const handlePasteUrl = useCallback(
    async (url: string) => {
      // Validate
      let result = validateJoinUrl(url);
      if (result.valid) result = checkEnvUrl(url, poolEnvironment);
      if (!result.valid) {
        setInputError(result.message || "Invalid URL");
        return;
      }

      // Clear errors, start joining
      setInputError(null);
      setLaunching(true);
      setInputValue("");
      setJoinState("joining");

      try {
        const res = await fetch(`/api/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinUrl: url }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to join");
        }

        if (data.joined) {
          // --- Success state ---
          setJoinState("success");
          setConfettiPieces(generateConfetti());

          // Keep launching=true until success animation finishes (1800ms),
          // so refreshStatus won't flash the empty state during the transition.
          scheduleTimer(() => {
            setLaunching(false);
          }, 1800);

          // After 1500ms, transition to post-success
          joiningAutoHideTimer.current = setTimeout(() => {
            // T=0: dismiss overlay, show toast, highlight step 2
            setJoinState("idle");
            setToastVisible(true);
            setActiveStep(2);
            setInputValue("");
            setConfettiPieces([]);

            // T=300: scroll to skills
            scheduleTimer(() => {
              if (skillBrowserRef?.current) {
                skillBrowserRef.current.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }
            }, 300);

            // T=3000: hide toast
            scheduleTimer(() => setToastVisible(false), 3000);
          }, 1500);
        } else {
          // --- QR modal flow (joined: false) ---
          hideJoiningOverlay();
          setLaunching(false);
          if (onShowQr) {
            onShowQr(data.agentName || "Assistant", data.inviteUrl);
          }
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Check the link and try again";
        setJoinState("error");
        setErrorMsg(message);
        setLaunching(false);
      }
    },
    [poolEnvironment, skillBrowserRef, setActiveStep, hideJoiningOverlay, onShowQr, scheduleTimer],
  );

  // -----------------------------------------------------------------------
  // Input event handlers
  // -----------------------------------------------------------------------

  const handlePaste = useCallback(() => {
    // Read value after the paste event populates it
    setTimeout(() => {
      const url = inputRef.current?.value.trim();
      if (url) handlePasteUrl(url);
    }, 0);
  }, [handlePasteUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const url = inputValue.trim();
        if (url) handlePasteUrl(url);
      }
    },
    [inputValue, handlePasteUrl],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      if (!val.trim()) {
        setInputError(null);
      }
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------------

  const showEmptyState = !available && joinState === "idle";
  const showPasteView = available || joinState !== "idle";
  const showPasteInputWrap = joinState === "idle";
  const showSteps = joinState === "idle";
  const joiningInlineClass =
    joinState !== "idle"
      ? `joining-inline active ${joinState}`
      : "joining-inline";

  const placeholder =
    poolEnvironment === "production"
      ? "popup.convos.org/..."
      : "dev.convos.org/...";

  // -----------------------------------------------------------------------
  // Joining overlay text
  // -----------------------------------------------------------------------

  let joiningText = "";
  let joiningSub = "";
  let showDismiss = false;
  let dismissText = "";

  if (joinState === "joining") {
    joiningText = "Your assistant is on the way";
    joiningSub = "Setting up a secure connection";
  } else if (joinState === "success") {
    joiningText = "Your assistant has arrived!";
    joiningSub = "They\u2019re now in your conversation";
  } else if (joinState === "error") {
    joiningText = "Couldn\u2019t reach your conversation";
    joiningSub = errorMsg || "Check the link and try again";
    showDismiss = true;
    dismissText = "Try again";
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {/* Empty state */}
      <div
        id="empty-state"
        className="empty-state"
        style={{ display: showEmptyState ? "block" : "none" }}
      >
        <div className="empty-scene">
          <div className="empty-balloon-group">
            <BalloonSvg width={64} height={82} className="balloon-logo" />
            <div className="balloon-string-upper">
              <BalloonStringUpper />
              <div className="balloon-string-lower">
                <BalloonStringLower />
              </div>
            </div>
          </div>
        </div>
        <div className="empty-text">Hang in there</div>
        <div className="empty-sub">
          No assistants available right now.
          <br />
          Check back a little later.
        </div>
      </div>

      {/* Paste view */}
      <div
        id="paste-view"
        style={{ display: showPasteView ? "" : "none" }}
      >
        {/* Success toast */}
        <div
          className={`success-toast${toastVisible ? " visible" : ""}`}
          id="success-toast"
          aria-live="polite"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Assistant joined!
        </div>

        {/* Paste input wrap */}
        <div
          className="paste-input-wrap"
          id="paste-input-wrap"
          style={{ display: showPasteInputWrap ? "" : "none" }}
        >
          <input
            ref={inputRef}
            id="paste-input"
            className={`paste-input${inputError ? " invalid" : ""}`}
            placeholder={placeholder}
            value={inputValue}
            disabled={joinState !== "idle"}
            onChange={handleInputChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
          />
          <span className="paste-input-label">
            Paste the invite link for your convo
          </span>
          <div
            className={`paste-error${inputError ? " visible" : ""}`}
            id="paste-error"
          >
            {inputError || ""}
          </div>
          <div className="paste-hint">
            To get your invite link, tap Share in the app
          </div>
        </div>

        {/* Joining inline animation */}
        <div
          className={joiningInlineClass}
          id="joining-inline"
          aria-live="polite"
        >
          <div className="joining-scene">
            {/* 6 particles */}
            <div className="joining-particle" />
            <div className="joining-particle" />
            <div className="joining-particle" />
            <div className="joining-particle" />
            <div className="joining-particle" />
            <div className="joining-particle" />
            <div className="joining-balloon-group">
              <BalloonSvg
                width={72}
                height={92}
                className="joining-balloon-svg"
              />
              <div className="joining-string-upper">
                <BalloonStringUpper />
                <div className="joining-string-lower">
                  <BalloonStringLower />
                </div>
              </div>
            </div>
            <div className="joining-confetti" id="joining-confetti">
              {/* 8 static pieces */}
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`static-${i}`} className="joining-confetti-piece" />
              ))}
              {/* Dynamic confetti on success */}
              {confettiPieces.map((piece, i) => (
                <div
                  key={`dynamic-${i}`}
                  className="joining-confetti-piece"
                  style={{
                    left: piece.left,
                    background: piece.background,
                    animationDelay: piece.animationDelay,
                    width: piece.width,
                    height: piece.height,
                    borderRadius: piece.borderRadius,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="joining-status-text" id="joining-text">
            {joiningText}
          </div>
          <div className="joining-status-sub" id="joining-sub">
            {joiningSub}
          </div>
          <button
            className="joining-dismiss-btn"
            id="joining-dismiss"
            style={{ display: showDismiss ? "" : "none" }}
            onClick={() => hideJoiningOverlay()}
          >
            {dismissText}
          </button>
        </div>

        {/* Steps */}
        <div
          className="steps"
          id="joining-steps"
          style={{ display: showSteps ? "" : "none" }}
        >
          <div className={`step${activeStep === 1 ? " highlight" : ""}`}>
            <span className="step-num">1</span>
            <span className="step-text">
              Paste your invite link above to add an assistant.
            </span>
          </div>
          <div className={`step${activeStep === 2 ? " highlight" : ""}`}>
            <span className="step-num">2</span>
            <span className="step-text">
              Copy a skill below and send it in your chat to give it
              superpowers.
            </span>
          </div>
          <div className={`step${activeStep === 3 ? " highlight" : ""}`}>
            <span className="step-num">3</span>
            <span className="step-text">
              Talk to it. Tell it what you like, what to change — it learns
              from you.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
