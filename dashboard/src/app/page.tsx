"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConvosLogo } from "@/components/convos-logo";
import { JoinFlow } from "@/components/join-flow";
import { SkillBrowser } from "@/components/skill-browser";
import { PromptModal } from "@/components/prompt-modal";
import { QrModal } from "@/components/qr-modal";
import type { AgentSkill } from "@/lib/types";

export default function Home() {
  const skillBrowserRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(1);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [poolEnvironment, setPoolEnvironment] = useState("production");

  // Prompt modal state
  const [promptModalPageId, setPromptModalPageId] = useState<string | null>(
    null,
  );
  const [promptModalName, setPromptModalName] = useState("");

  // QR modal state
  const [qrAgentName, setQrAgentName] = useState<string | null>(null);
  const [qrInviteUrl, setQrInviteUrl] = useState("");

  // Fetch skills catalog on mount
  useEffect(() => {
    async function loadSkills() {
      try {
        const res = await fetch("/api/pool/templates");
        if (!res.ok) return;
        const data: AgentSkill[] = await res.json();
        setSkills(data);
      } catch {
        // Silently ignore fetch errors
      }
    }
    async function loadPoolInfo() {
      try {
        const res = await fetch("/api/pool/info");
        if (!res.ok) return;
        const data = await res.json();
        if (data.environment) setPoolEnvironment(data.environment);
      } catch {
        // Silently ignore
      }
    }
    loadSkills();
    loadPoolInfo();
  }, []);

  // -----------------------------------------------------------------------
  // Modal callbacks
  // -----------------------------------------------------------------------

  const handleOpenPromptModal = useCallback(
    (pageId: string, name: string) => {
      setPromptModalPageId(pageId);
      setPromptModalName(name);
    },
    [],
  );

  const handleClosePromptModal = useCallback(() => {
    setPromptModalPageId(null);
    setPromptModalName("");
  }, []);

  const handleShowQr = useCallback(
    (agentName: string, inviteUrl: string) => {
      setQrAgentName(agentName);
      setQrInviteUrl(inviteUrl);
    },
    [],
  );

  const handleCloseQr = useCallback(() => {
    setQrAgentName(null);
    setQrInviteUrl("");
  }, []);

  return (
    <>
      <div className="form-wrapper">
      <div className="form-center">
        {/* Brand */}
        <div className="brand">
          <div className="brand-icon">
            <ConvosLogo />
          </div>
          <span className="brand-name">Convos</span>
        </div>

        {/* Hero */}
        <h1 className="page-title" id="page-title">
          Invite an assistant to a private group chat
        </h1>
        <p className="page-subtitle" id="page-subtitle">
          Paste a Convos Invite Link and an AI assistant will join your convo
        </p>

        {/* Join flow: empty state + paste input + joining animation + steps */}
        <JoinFlow
          poolEnvironment={poolEnvironment}
          skillBrowserRef={skillBrowserRef}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
          onShowQr={handleShowQr}
        />

        {/* Get Convos strip */}
        <div className="get-convos">
          <div className="get-convos-left">
            <div className="get-convos-text">
              <div className="get-convos-tagline">Get the Convos app</div>
              <div className="get-convos-sub">
                Everyday private chat for the AI world
              </div>
            </div>
          </div>
          <a
            className="get-convos-btn"
            href="https://convos.org/app"
            target="_blank"
            rel="noopener"
          >
            Get
          </a>
        </div>

        {/* Stories */}
        <div className="stories">
          <div>
            <div className="story-label">Built in</div>
            <p className="story-text">
              Convos AI Assistants can browse the web and use email, SMS, and
              crypto wallets to help your group with scheduling, reservations,
              payments, and more.
              <br />
              <a href="#">Built with OpenClaw 🦞</a>
            </p>
          </div>
          <div>
            <div className="story-label">Safe by default</div>
            <p className="story-text">
              Convos keeps conversations separate and encrypted by default. Each
              assistant you add is unique to that conversation and can never
              access other chats, contacts, or profiles.
              <br />
              <a href="#">Learn more</a>
            </p>
          </div>
        </div>

        {/* Skill browser */}
        <SkillBrowser
          ref={skillBrowserRef}
          skills={skills}
          onOpenModal={handleOpenPromptModal}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
        />

        {/* Prompt modal */}
        <PromptModal
          pageId={promptModalPageId}
          agentName={promptModalName}
          onClose={handleClosePromptModal}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
        />

        {/* QR modal */}
        <QrModal
          agentName={qrAgentName}
          inviteUrl={qrInviteUrl}
          onClose={handleCloseQr}
        />
      </div>
    </div>
    </>
  );
}
