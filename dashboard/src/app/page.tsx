"use client";

import { useRef, useState } from "react";
import { ConvosLogo } from "@/components/convos-logo";
import { JoinFlow } from "@/components/join-flow";

const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL || "http://localhost:3001";
const POOL_ENVIRONMENT =
  process.env.NEXT_PUBLIC_POOL_ENVIRONMENT || "staging";

export default function Home() {
  const skillBrowserRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(1);

  return (
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
          poolApiUrl={POOL_API_URL}
          poolEnvironment={POOL_ENVIRONMENT}
          skillBrowserRef={skillBrowserRef}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
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

        {/* Prompt store placeholder (Task 4: skill-browser component) */}
        {/* <div className="prompt-store" id="prompt-store" ref={skillBrowserRef}>...</div> */}

        {/* Modals placeholder (Task 5: prompt-modal + qr-modal) */}
        {/* <div className="ps-modal-overlay" id="ps-modal">...</div> */}
        {/* <div className="modal-overlay" id="qr-modal">...</div> */}
      </div>
    </div>
  );
}
