import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import * as pool from "./pool.js";
import * as cache from "./cache.js";
import { deleteOrphanAgentVolumes } from "./volumes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || "3001", 10);
const POOL_API_KEY = process.env.POOL_API_KEY;
const POOL_ENVIRONMENT = process.env.POOL_ENVIRONMENT || "staging";
// Deploy context shown in dashboard info tags
const DEPLOY_BRANCH = process.env.RAILWAY_SOURCE_BRANCH || process.env.RAILWAY_GIT_BRANCH || "unknown";
const INSTANCE_MODEL = process.env.INSTANCE_OPENCLAW_PRIMARY_MODEL || "unknown";
const RAILWAY_PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "";
const RAILWAY_SERVICE_ID = process.env.RAILWAY_SERVICE_ID || "";
const RAILWAY_ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || "";
const NOTION_API_KEY = process.env.NOTION_API_KEY || "";

// --- Notion prompt cache (1 hour TTL) ---
const promptCache = new Map();
const PROMPT_CACHE_TTL = 60 * 60 * 1000;

// --- Agent catalog for prompt store ---
const AGENT_CATALOG_JSON = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    const compact = raw.map(a => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const catParts = (a.category || "").split(" — ");
      const emoji = catParts[0].trim().split(" ")[0];
      const catName = catParts[0].trim().replace(/^\S+\s/, "");
      return { n: a.name, d: a.description, c: catName, e: emoji, p: m ? m[1] : "", s: a.status };
    }).filter(a => a.n && a.p);
    return JSON.stringify(compact);
  } catch (e) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return "[]";
  }
})();

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// --- Auth middleware ---
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== POOL_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  return next();
}

// --- Routes ---

app.get("/favicon.ico", (_req, res) => res.sendFile(join(__dirname, "favicon.ico")));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Version — check this to verify what code is deployed.
const BUILD_VERSION = "2026-02-12T01:cache-v1";
app.get("/version", (_req, res) => res.json({ version: BUILD_VERSION, environment: POOL_ENVIRONMENT }));

// Pool counts (no auth — used by the launch form)
app.get("/api/pool/counts", (_req, res) => {
  res.json(cache.getCounts());
});

// List launched agents (no auth — used by the page)
app.get("/api/pool/agents", (_req, res) => {
  const claimed = cache.getByStatus("claimed");
  const crashed = cache.getByStatus("crashed");
  res.json({ claimed, crashed });
});

// Kill a launched instance
app.delete("/api/pool/instances/:id", requireAuth, async (req, res) => {
  try {
    await pool.killInstance(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Kill failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Dismiss a crashed agent
app.delete("/api/pool/crashed/:id", requireAuth, async (req, res) => {
  try {
    await pool.dismissCrashed(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] Dismiss failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard page — mode determined by POOL_ENVIRONMENT + ?mode= query param
app.get("/", (req, res) => {
  const showDevTools = POOL_ENVIRONMENT !== "production";
  const serviceLink = RAILWAY_PROJECT_ID && RAILWAY_SERVICE_ID
    ? `<a href="https://railway.com/project/${RAILWAY_PROJECT_ID}/service/${RAILWAY_SERVICE_ID}${RAILWAY_ENVIRONMENT_ID ? "?environmentId=" + RAILWAY_ENVIRONMENT_ID : ""}" target="_blank" rel="noopener">${RAILWAY_SERVICE_ID.slice(0, 8)}</a>`
    : RAILWAY_SERVICE_ID ? RAILWAY_SERVICE_ID.slice(0, 8) : "";

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Convos${showDevTools ? " Assistant Pool" : ""}</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" as="style">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: #FFF;
      min-height: 100vh;
      color: #000;
      -webkit-font-smoothing: antialiased;
    }

    /* --- Layout wrapper --- */
    .form-wrapper {
      padding: 80px 32px;
      background: #fff;
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }

    .form-center {
      max-width: 640px;
      width: 100%;
      position: relative;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 56px;
    }

    .brand-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .brand-icon svg { width: 22px; height: 28px; }

    .brand-name {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }

    .page-title {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.8px;
      line-height: 1.2;
      margin-bottom: 8px;
    }

    .page-subtitle {
      font-size: 16px;
      color: #999;
      margin-bottom: 32px;
      line-height: 1.5;
    }

    /* --- Paste input (end-user mode) --- */
    .paste-input-wrap {
      max-width: 460px;
      width: 100%;
      position: relative;
      margin-bottom: 56px;
    }

    .paste-input {
      width: 100%;
      padding: 18px 24px 18px 48px;
      border: 1.5px solid #EBEBEB;
      border-radius: 14px;
      font-size: 15px;
      font-family: inherit;
      color: #000;
      background: #fff;
      box-shadow: 0 1px 8px rgba(0,0,0,0.03);
      transition: all 0.25s ease;
    }

    .paste-input:focus {
      outline: none;
      border-color: #FC4F37;
      box-shadow: 0 2px 16px rgba(252,79,55,0.06);
    }

    .paste-input::placeholder { color: #D4D4D4; }
    .paste-input.invalid { border-color: #DC2626; }
    .paste-input.invalid:focus { border-color: #DC2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.06); }

    .paste-input-icon {
      position: absolute;
      left: 18px;
      top: 50%;
      transform: translateY(-50%);
      color: #D4D4D4;
      pointer-events: none;
    }

    .paste-input-icon svg { width: 16px; height: 16px; }

    .paste-error {
      color: #DC2626;
      font-size: 13px;
      margin-top: 8px;
      display: none;
    }

    .paste-error.visible { display: block; }

    /* --- Stories (end-user mode) --- */
    .stories {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 48px;
    }

    .story-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #D4D4D4;
      margin-bottom: 12px;
    }

    .story-text {
      font-size: 13px;
      color: #B2B2B2;
      line-height: 1.6;
    }

    .story-text a {
      display: inline-block;
      margin-top: 8px;
      color: #B2B2B2;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .field-group { margin-bottom: 28px; }

    .field-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .field-label .opt {
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      color: #CCC;
    }

    .field-input {
      width: 100%;
      padding: 16px 20px;
      border: 1px solid #E5E5E5;
      border-radius: 16px;
      font-size: 16px;
      font-family: inherit;
      color: #000;
      background: #fff;
      transition: all 0.2s;
    }

    .field-input:focus {
      outline: none;
      border-color: #000;
      box-shadow: 0 0 0 3px rgba(0,0,0,0.04);
    }

    .field-input::placeholder { color: #D4D4D4; }
    .field-input.invalid { border-color: #DC2626; }
    .field-input.invalid:focus { border-color: #DC2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.06); }

    textarea.field-input { resize: vertical; min-height: 120px; }

    .field-hint {
      font-size: 12px;
      color: #CCC;
      margin-top: 6px;
    }

    .field-error {
      color: #DC2626;
      font-size: 13px;
      margin-top: 6px;
      display: none;
    }

    .field-error.visible { display: block; }

    .template-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .template-pill {
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border: 1px dashed #D4D4D4;
      border-radius: 20px;
      color: #999;
      cursor: default;
    }

    .template-pill:hover { border-color: #999; color: #666; }

    .template-soon {
      font-size: 11px;
      color: #CCC;
      font-style: italic;
    }

    .btn-launch {
      width: 100%;
      padding: 18px;
      background: #FC4F37;
      color: #fff;
      border: none;
      border-radius: 16px;
      font-size: 17px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      letter-spacing: -0.2px;
      transition: all 0.2s;
      margin-top: 8px;
    }

    .btn-launch:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-launch:active { transform: scale(0.98); }
    .btn-launch:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    .footer-note {
      text-align: center;
      margin-top: 24px;
      font-size: 12px;
      color: #CCC;
    }

    /* --- Empty pool state (sad balloon) --- */
    .empty-state {
      text-align: center;
      padding: 40px 16px;
      display: none;
    }

    .empty-scene {
      position: relative;
      width: 160px;
      height: 200px;
      margin: 0 auto 20px;
    }

    .empty-balloon-group {
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) rotate(10deg);
      transform-origin: center 70px;
      animation: balloon-droop 5s ease-in-out infinite;
    }

    @keyframes balloon-droop {
      0%, 100% { transform: translateX(-50%) rotate(10deg); }
      30% { transform: translateX(-50%) rotate(6deg); }
      60% { transform: translateX(-50%) rotate(13deg); }
    }

    .empty-balloon-group svg.balloon-logo {
      display: block;
      filter: drop-shadow(0 4px 12px rgba(229,77,0,0.15));
    }

    .balloon-string-upper {
      transform-origin: top center;
      animation: string-top-sway 3.5s ease-in-out infinite;
      margin: -2px auto 0;
      width: 20px;
    }

    .balloon-string-upper svg { display: block; }

    @keyframes string-top-sway {
      0%, 100% { transform: rotate(0deg); }
      40% { transform: rotate(4deg); }
      70% { transform: rotate(-3deg); }
    }

    .balloon-string-lower {
      transform-origin: top center;
      animation: string-btm-sway 2.8s ease-in-out infinite;
      width: 20px;
    }

    .balloon-string-lower svg { display: block; }

    @keyframes string-btm-sway {
      0%, 100% { transform: rotate(0deg); }
      35% { transform: rotate(-5deg); }
      65% { transform: rotate(4deg); }
    }

    .empty-text {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }

    .empty-sub {
      font-size: 14px;
      color: #B0B0B0;
      line-height: 1.5;
    }

    /* --- Joining overlay (balloon scene) --- */
    .joining-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.97);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.4s ease;
      z-index: 10;
    }

    .joining-overlay.active { opacity: 1; pointer-events: auto; }

    .joining-scene {
      position: relative;
      width: 200px;
      height: 240px;
      margin-bottom: 24px;
    }

    .joining-balloon-group {
      position: absolute;
      top: 40px;
      left: 50%;
      transform: translateX(-50%);
      transform-origin: center bottom;
    }

    .joining-balloon-group svg.joining-balloon-svg {
      display: block;
      filter: drop-shadow(0 6px 20px rgba(229,77,0,0.2));
    }

    .joining-string-upper {
      transform-origin: top center;
      animation: joining-string-top-sway 3.5s ease-in-out infinite;
      margin: -2px auto 0;
      width: 20px;
    }

    .joining-string-upper svg { display: block; }

    @keyframes joining-string-top-sway {
      0%, 100% { transform: rotate(0deg); }
      40% { transform: rotate(4deg); }
      70% { transform: rotate(-3deg); }
    }

    .joining-string-lower {
      transform-origin: top center;
      animation: joining-string-btm-sway 2.8s ease-in-out infinite;
      width: 20px;
    }

    .joining-string-lower svg { display: block; }

    @keyframes joining-string-btm-sway {
      0%, 100% { transform: rotate(0deg); }
      35% { transform: rotate(-5deg); }
      65% { transform: rotate(4deg); }
    }

    /* Floating particles */
    .joining-particle {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #FC4F37;
      opacity: 0;
    }

    .joining-particle:nth-child(1) { left: 20%; top: 30%; }
    .joining-particle:nth-child(2) { left: 75%; top: 40%; }
    .joining-particle:nth-child(3) { left: 15%; top: 60%; }
    .joining-particle:nth-child(4) { left: 80%; top: 55%; }
    .joining-particle:nth-child(5) { left: 40%; top: 20%; }
    .joining-particle:nth-child(6) { left: 60%; top: 70%; }

    /* Joining state: inflate + float + particles */
    .joining-overlay.joining .joining-balloon-group {
      animation: joining-inflate 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                 joining-float 3s 1.5s ease-in-out infinite;
    }

    @keyframes joining-inflate {
      0% { transform: translateX(-50%) scale(0.3); opacity: 0.5; }
      60% { transform: translateX(-50%) scale(1.05); opacity: 1; }
      100% { transform: translateX(-50%) scale(1); opacity: 1; }
    }

    @keyframes joining-float {
      0%, 100% { transform: translateX(-50%) translateY(0) rotate(2deg); }
      25% { transform: translateX(-50%) translateY(-8px) rotate(-1deg); }
      50% { transform: translateX(-50%) translateY(-4px) rotate(3deg); }
      75% { transform: translateX(-50%) translateY(-10px) rotate(0deg); }
    }

    .joining-overlay.joining .joining-particle {
      animation: joining-particle-float 3s ease-in-out infinite;
    }

    .joining-particle:nth-child(1) { animation-delay: 0s; }
    .joining-particle:nth-child(2) { animation-delay: 0.5s; }
    .joining-particle:nth-child(3) { animation-delay: 1s; }
    .joining-particle:nth-child(4) { animation-delay: 1.5s; }
    .joining-particle:nth-child(5) { animation-delay: 0.3s; }
    .joining-particle:nth-child(6) { animation-delay: 0.8s; }

    @keyframes joining-particle-float {
      0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
      20% { opacity: 0.6; }
      50% { opacity: 0.4; transform: translateY(-20px) scale(1); }
      80% { opacity: 0.2; }
    }

    /* Success state: bounce + confetti */
    .joining-overlay.success .joining-balloon-group {
      animation: joining-success-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                 joining-float 3s 0.6s ease-in-out infinite;
    }

    @keyframes joining-success-bounce {
      0% { transform: translateX(-50%) scale(1); }
      40% { transform: translateX(-50%) scale(1.2) translateY(-16px); }
      70% { transform: translateX(-50%) scale(0.95); }
      100% { transform: translateX(-50%) scale(1); }
    }

    .joining-overlay.success .joining-balloon-group svg.joining-balloon-svg {
      filter: drop-shadow(0 8px 32px rgba(229,77,0,0.35));
    }

    .joining-overlay.success .joining-particle { animation: none; opacity: 0; }

    .joining-confetti {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .joining-confetti-piece {
      position: absolute;
      top: -10px;
      opacity: 0;
    }

    .joining-overlay.success .joining-confetti-piece {
      animation: joining-confetti-rain 1.5s ease-out forwards;
    }

    @keyframes joining-confetti-rain {
      0% { opacity: 1; transform: translateY(0) rotate(0deg); }
      100% { opacity: 0; transform: translateY(300px) rotate(720deg); }
    }

    /* Error state: gentle droop */
    .joining-overlay.error .joining-balloon-group {
      animation: joining-error-droop 1.2s ease-out forwards;
      transform-origin: center 70px;
    }

    @keyframes joining-error-droop {
      0% { transform: translateX(-50%) scale(1) rotate(0deg); }
      40% { transform: translateX(-50%) scale(0.95, 0.88) rotate(4deg); }
      100% { transform: translateX(-50%) scale(0.9, 0.82) rotate(8deg) translateY(10px); opacity: 0.75; }
    }

    .joining-overlay.error .joining-balloon-group svg.joining-balloon-svg {
      filter: drop-shadow(0 3px 10px rgba(220,38,38,0.18));
    }

    .joining-overlay.error .joining-particle { animation: none; opacity: 0; }

    /* Status text */
    .joining-status-text {
      font-size: 20px;
      font-weight: 600;
      color: #333;
      margin-bottom: 6px;
      text-align: center;
    }

    .joining-status-sub {
      font-size: 14px;
      color: #B2B2B2;
      text-align: center;
    }

    .joining-overlay.success .joining-status-text { color: #16A34A; }
    .joining-overlay.error .joining-status-text { color: #DC2626; }

    /* Dismiss button */
    .joining-dismiss-btn {
      margin-top: 20px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 500;
      padding: 10px 24px;
      border: 1.5px solid #EBEBEB;
      border-radius: 12px;
      cursor: pointer;
      background: #fff;
      color: #666;
      transition: all 0.2s;
      opacity: 0;
      transform: translateY(8px);
    }

    .joining-dismiss-btn:hover { background: #F5F5F5; border-color: #CCC; }

    .joining-overlay.success .joining-dismiss-btn,
    .joining-overlay.error .joining-dismiss-btn {
      animation: joining-btn-in 0.3s 0.6s ease-out forwards;
    }

    @keyframes joining-btn-in {
      to { opacity: 1; transform: translateY(0); }
    }

    .joining-overlay.error .joining-dismiss-btn {
      border-color: #FECACA;
      color: #DC2626;
    }

    .joining-overlay.error .joining-dismiss-btn:hover { background: #FEF2F2; }

    /* Reduced motion: disable animations, show static states */
    @media (prefers-reduced-motion: reduce) {
      .joining-overlay.joining .joining-balloon-group,
      .joining-overlay.success .joining-balloon-group,
      .joining-overlay.error .joining-balloon-group {
        animation: none;
        transform: translateX(-50%) scale(1);
        opacity: 1;
      }
      .joining-particle { animation: none !important; opacity: 0 !important; }
      .joining-confetti-piece { animation: none !important; opacity: 0 !important; }
      .joining-string-upper, .joining-string-lower { animation: none; }
      .joining-dismiss-btn { animation: none; opacity: 1; transform: none; }
      .joining-overlay { transition: none; }
    }

    .error-message {
      color: #DC2626;
      font-size: 14px;
      margin-top: 12px;
      padding: 12px 16px;
      background: #FEE2E2;
      border-radius: 12px;
      display: none;
    }

    .success-banner {
      display: none;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      background: #F0FDF4;
      border: 1px solid #BBF7D0;
      border-radius: 16px;
      margin-top: 16px;
    }

    .success-banner.active { display: flex; }
    .success-banner svg { flex-shrink: 0; }
    .success-banner .success-text { font-size: 14px; font-weight: 500; color: #166534; }
    .success-banner .success-sub { font-size: 13px; color: #15803D; margin-top: 2px; }

    /* --- QR modal --- */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }

    .modal-overlay.active { display: flex; }

    .modal {
      background: #FFF;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      padding: 1.25rem;
      max-width: 320px;
      width: 100%;
      text-align: center;
    }

    .modal h3 {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: 0 0 0.75rem;
      color: #000;
    }

    .qr-wrap {
      position: relative;
      width: 100%;
      margin: 0 auto;
      display: block;
      color: inherit;
      text-decoration: none;
    }

    .qr-wrap img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 12px;
    }

    .qr-wrap .icon-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 9%;
      height: 9%;
      background: #fff;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .qr-wrap .icon-center svg { width: 100%; height: 100%; }

    .modal .invite-row {
      margin: 0.75rem 0 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #F5F5F5;
      border-radius: 8px;
      width: 100%;
      box-sizing: border-box;
      cursor: pointer;
      transition: background 0.2s;
    }

    .modal .invite-row:hover { background: #EBEBEB; }

    .modal .invite-url {
      font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
      font-size: 11px;
      color: #666;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }

    .modal .copy-icon {
      flex-shrink: 0;
      display: inline-flex;
      width: 16px;
      height: 16px;
      color: #999;
      transition: color 0.2s;
    }

    .modal .copy-icon svg { width: 100%; height: 100%; }
    .modal .invite-row:hover .copy-icon { color: #666; }
    .modal .invite-row.copied { background: #D4EDDA; }
    .modal .invite-row.copied .invite-url { color: #155724; }
    .modal .invite-row.copied .copy-icon { color: #155724; }

    /* --- Dev status bar --- */
    .dev-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 998;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      font-size: 12px;
      color: #999;
    }

    .dev-bar.collapsed {
      right: auto;
    }

    .dev-bar .bar-content {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      margin-left: 40px;
    }

    .dev-bar.collapsed .bar-content { display: none; }

    .dev-bar .env-tag {
      position: fixed;
      top: 11px;
      left: 16px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 6px;
      border-radius: 4px;
      background: #DBEAFE;
      color: #1D4ED8;
      cursor: pointer;
      user-select: none;
      transition: opacity 0.15s;
      z-index: 999;
    }

    .dev-bar .env-tag:hover { opacity: 0.8; }


    .dev-bar .env-tag.env-staging { background: #FEF3C7; color: #92400E; }
    .dev-bar .env-tag.env-production { background: #FEE2E2; color: #991B1B; }

    .dev-bar .sep { width: 1px; height: 16px; background: #E5E5E5; }

    .dev-bar .bar-stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
    }

    .dev-bar .bar-stat.clickable {
      cursor: pointer;
      padding: 2px 8px;
      border-radius: 6px;
      transition: background 0.15s;
      position: relative;
    }

    .dev-bar .bar-stat.clickable:hover { background: #EBEBEB; }
    .dev-bar .bar-stat.clickable.open { background: #E5E5E5; }

    .dev-bar .chevron {
      display: inline-block;
      font-size: 8px;
      margin-left: 2px;
      transition: transform 0.15s;
    }

    .dev-bar .bar-stat.open .chevron { transform: rotate(180deg); }

    .dev-bar .dot { width: 6px; height: 6px; border-radius: 50%; }
    .dev-bar .dot.green { background: #34C759; }
    .dev-bar .dot.orange { background: #FF9500; }
    .dev-bar .dot.blue { background: #007AFF; }
    .dev-bar .dot.red { background: #DC2626; }

    .dev-bar .spacer { flex: 1; }

    .dev-bar .bar-btn {
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      cursor: pointer;
      background: #fff;
      color: #666;
      transition: all 0.15s;
    }

    .dev-bar .bar-btn:hover { background: #F5F5F5; border-color: #CCC; }
    .dev-bar .bar-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .dev-bar .bar-btn.danger { color: #DC2626; border-color: #FECACA; }
    .dev-bar .bar-btn.danger:hover { background: #FEF2F2; }

    .dev-bar input[type="number"] {
      width: 36px;
      padding: 2px 4px;
      text-align: center;
      font-size: 11px;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      font-family: inherit;
      color: #000;
      background: #fff;
    }

    .dev-bar input[type="number"]:focus { outline: none; border-color: #999; }

    .dev-bar .chip {
      font-size: 10px;
      font-weight: 500;
      color: #B2B2B2;
      padding: 2px 6px;
      background: #F5F5F5;
      border: 1px solid #EBEBEB;
      border-radius: 4px;
    }

    .dev-bar .chip a { color: #007AFF; text-decoration: none; }

    /* --- Agents dropdown --- */
    .agents-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: 380px;
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.04);
      z-index: 100;
      padding: 4px;
    }

    .agents-dropdown.open { display: block; animation: dropIn 0.15s ease-out; }

    @keyframes dropIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .dropdown-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px 6px;
    }

    .dropdown-title {
      font-size: 11px;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .dropdown-count {
      font-size: 11px;
      color: #CCC;
      font-weight: 500;
    }

    .dropdown-list {
      max-height: 360px;
      overflow-y: auto;
      padding: 0 4px 4px;
    }

    .agent-card {
      background: #fff;
      border: 1px solid #F0F0F0;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 4px;
      transition: background 0.1s;
    }

    .agent-card:hover { background: #FAFAFA; }
    .agent-card:last-child { margin-bottom: 0; }
    .agent-card.crashed { border-color: #FECACA; background: #FEF2F2; }
    .agent-card.crashed:hover { background: #FEE2E2; }

    .agent-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2px;
    }

    .agent-top-left {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .agent-name { font-size: 13px; font-weight: 600; }
    .agent-uptime { font-size: 11px; color: #999; }

    .agent-status-badge {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 2px 5px;
      border-radius: 4px;
      background: #FEE2E2;
      color: #DC2626;
      margin-left: 4px;
    }

    .agent-meta {
      font-size: 10px;
      color: #CCC;
      font-family: monospace;
    }

    .agent-meta a { color: #007AFF; text-decoration: none; }

    .agent-actions { display: flex; gap: 3px; }

    .agent-btn {
      font-family: inherit;
      font-size: 10px;
      font-weight: 500;
      padding: 3px 7px;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      cursor: pointer;
      background: #fff;
      color: #666;
      transition: all 0.15s;
    }

    .agent-btn:hover { background: #F5F5F5; }
    .agent-btn.danger { color: #DC2626; border-color: #FECACA; }
    .agent-btn.danger:hover { background: #FEF2F2; }
    .agent-btn.warn { color: #92400E; border-color: #FDE68A; }
    .agent-btn.warn:hover { background: #FEF3C7; }

    .agent-card.destroying { opacity: 0.5; pointer-events: none; animation: destroyPulse 1.5s ease-in-out infinite; }
    @keyframes destroyPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.3; } }

    .dropdown-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 99;
    }

    .dropdown-backdrop.open { display: block; }

    .dropdown-empty {
      text-align: center;
      padding: 16px;
      color: #CCC;
      font-size: 12px;
    }

    /* --- Prompt Store --- */
    .prompt-store {
      margin-top: 48px;
      padding-top: 32px;
      border-top: 1px solid #F5F5F5;
    }

    .ps-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
      margin-bottom: 8px;
    }

    .ps-intro {
      font-size: 13px;
      color: #B2B2B2;
      line-height: 1.5;
      margin-bottom: 20px;
    }

    .ps-search-wrap {
      position: relative;
      margin-bottom: 12px;
    }

    .ps-search {
      width: 100%;
      padding: 10px 12px 10px 36px;
      border: 1px solid #EBEBEB;
      border-radius: 10px;
      font-size: 13px;
      font-family: inherit;
      color: #000;
      background: #FAFAFA;
      transition: all 0.15s;
    }

    .ps-search:focus {
      outline: none;
      border-color: #E54D00;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(229,77,0,0.06);
    }

    .ps-search::placeholder { color: #D4D4D4; }

    .ps-search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #D4D4D4;
      pointer-events: none;
    }

    .ps-search-icon svg { width: 14px; height: 14px; }

    .ps-filters {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .ps-filter-pill {
      padding: 4px 12px;
      border: 1px solid #EBEBEB;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 500;
      color: #999;
      cursor: pointer;
      background: #fff;
      font-family: inherit;
      transition: all 0.15s;
    }

    .ps-filter-pill:hover { border-color: #999; color: #666; }
    .ps-filter-pill.active { background: #000; color: #fff; border-color: #000; }

    .ps-cat-header {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #D4D4D4;
      padding: 20px 0 8px;
      border-bottom: 1px solid #F5F5F5;
    }

    .ps-cat-header:first-child { padding-top: 4px; }

    .ps-agent-row {
      display: flex;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #F5F5F5;
      cursor: pointer;
      transition: background 0.1s;
      gap: 12px;
    }

    .ps-agent-row:hover {
      background: #FAFAFA;
      margin: 0 -8px;
      padding: 12px 8px;
      border-radius: 8px;
    }

    .ps-agent-info { flex: 1; min-width: 0; }

    .ps-agent-name {
      font-size: 14px;
      font-weight: 600;
      color: #000;
      margin-bottom: 2px;
    }

    .ps-agent-desc {
      font-size: 12px;
      color: #B2B2B2;
      line-height: 1.4;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ps-agent-actions { display: flex; gap: 6px; flex-shrink: 0; }

    .ps-btn {
      padding: 6px 12px;
      border: 1px solid #EBEBEB;
      border-radius: 8px;
      background: #fff;
      font-size: 12px;
      font-weight: 500;
      color: #666;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }

    .ps-btn:hover { border-color: #999; color: #333; }

    .ps-btn.primary {
      background: #E54D00;
      color: #fff;
      border-color: #E54D00;
    }

    .ps-btn.primary:hover { opacity: 0.9; }
    .ps-btn.copied { background: #16A34A; color: #fff; border-color: #16A34A; }
    .ps-btn.loading { opacity: 0.6; cursor: wait; }

    .ps-show-more {
      display: block;
      width: 100%;
      padding: 14px;
      margin-top: 16px;
      background: none;
      border: 1px dashed #EBEBEB;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      color: #999;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .ps-show-more:hover { border-color: #999; color: #666; }

    .ps-no-results {
      text-align: center;
      padding: 32px 16px;
      color: #CCC;
      font-size: 13px;
      display: none;
    }

    /* --- Prompt Modal --- */
    .ps-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 200;
      padding: 24px;
    }

    .ps-modal-overlay.open { display: flex; }

    .ps-modal {
      background: #fff;
      border-radius: 16px;
      max-width: 560px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 48px rgba(0,0,0,0.15);
    }

    .ps-modal-head {
      padding: 20px 24px;
      border-bottom: 1px solid #EBEBEB;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .ps-modal-title { font-size: 16px; font-weight: 600; }

    .ps-modal-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #999;
      font-size: 20px;
      padding: 4px;
      line-height: 1;
    }

    .ps-modal-close:hover { color: #000; }

    .ps-modal-body {
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
    }

    .ps-modal-text {
      font-size: 13px;
      line-height: 1.7;
      color: #333;
      white-space: pre-wrap;
    }

    .ps-modal-footer {
      padding: 16px 24px;
      border-top: 1px solid #EBEBEB;
      flex-shrink: 0;
    }

    .ps-modal-copy {
      width: 100%;
      padding: 12px;
      background: #E54D00;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
    }

    .ps-modal-copy:hover { opacity: 0.9; }

    /* --- Responsive --- */
    @media (max-width: 640px) {
      .ps-filters { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; }
      .ps-agent-actions { gap: 4px; }
      .ps-btn { padding: 5px 8px; font-size: 11px; }
      .ps-modal { max-width: 100%; margin: 0 8px; }
    }

    @media (max-width: 640px) {
      .dev-bar { flex-wrap: wrap; gap: 6px; }
      .dev-bar .spacer { display: none; }
      .form-wrapper { padding: 32px 16px; }
      .page-title { font-size: 24px; }
      .agents-dropdown { width: calc(100vw - 32px); left: -8px; }
      .stories { grid-template-columns: 1fr; gap: 32px; }
      .paste-input-wrap { margin-bottom: 40px; }
    }
  </style>
</head>
<body>
  ${showDevTools ? `
  <div class="dropdown-backdrop" id="dropdown-backdrop"></div>
  <div class="dev-bar${showDevTools ? "" : " collapsed"}" id="dev-bar">
    <span class="env-tag env-${POOL_ENVIRONMENT}" id="env-toggle">${POOL_ENVIRONMENT}</span>
    <div class="bar-content">
      <span class="sep"></span>
      <span class="bar-stat"><span class="dot green"></span> <span id="s-idle">-</span> ready</span>
      <span class="bar-stat"><span class="dot orange"></span> <span id="s-starting">-</span> starting</span>
      <span class="bar-stat clickable" id="claimed-toggle">
        <span class="dot blue"></span> <span id="s-claimed">-</span> claimed <span class="chevron">&#9660;</span>
        <div class="agents-dropdown" id="agents-dropdown">
          <div class="dropdown-header">
            <span class="dropdown-title">Live Assistants</span>
            <span class="dropdown-count" id="dropdown-count"></span>
          </div>
          <div class="dropdown-list" id="feed"></div>
        </div>
      </span>
      <span class="bar-stat" id="s-crashed-wrap" style="display:none"><span class="dot red"></span> <span id="s-crashed">0</span> crashed</span>
      <span class="sep"></span>
      <input id="replenish-count" type="number" min="1" max="20" value="1" />
      <button class="bar-btn" id="replenish-btn">+ Add</button>
      <button class="bar-btn danger" id="drain-btn">Drain</button>
      <span class="spacer"></span>
      <span class="chip">branch: ${DEPLOY_BRANCH}</span>
      <span class="chip">model: ${INSTANCE_MODEL}</span>
      ${serviceLink ? `<span class="chip">service: ${serviceLink}</span>` : ""}
      ${RAILWAY_PROJECT_ID ? `<span class="chip"><a href="https://railway.com/project/${RAILWAY_PROJECT_ID}" target="_blank" rel="noopener">Railway ↗</a></span>` : ""}
    </div>
  </div>
  ` : ""}

  <div class="form-wrapper">
    <div class="form-center">
      <div class="brand">
        <div class="brand-icon">
          <svg viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z" fill="#E54D00"/><path d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z" fill="#E54D00"/></svg>
        </div>
        <span class="brand-name">Convos</span>
      </div>
      <h1 class="page-title" id="page-title">${showDevTools ? "Launch your assistant" : "Invite an assistant"}</h1>
      <p class="page-subtitle" id="page-subtitle">${showDevTools ? "Create an AI assistant and drop it into any Convos conversation." : "Paste a link and an AI assistant will join your Convos conversation."}</p>

      <div id="empty-state" class="empty-state">
        <div class="empty-scene">
          <div class="empty-balloon-group">
            <svg class="balloon-logo" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="64" height="82">
              <path d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z" fill="#E54D00"/>
              <path d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z" fill="#E54D00"/>
            </svg>
            <div class="balloon-string-upper">
              <svg width="20" height="40" viewBox="0 0 20 40" fill="none">
                <path d="M10 0 Q13 14 8 25 Q6 33 10 40" stroke="#D4D4D4" stroke-width="1.5" fill="none" stroke-linecap="round"/>
              </svg>
              <div class="balloon-string-lower">
                <svg width="20" height="35" viewBox="0 0 20 35" fill="none">
                  <path d="M10 0 Q14 15 8 35" stroke="#D4D4D4" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div class="empty-text">Hang in there</div>
        <div class="empty-sub">No assistants available right now.<br>Check back a little later.</div>
      </div>

      ${showDevTools ? `
      <form id="f">
        <div class="field-group">
          <label class="field-label" for="name">Assistant Name</label>
          <input id="name" name="name" class="field-input" placeholder="Give your assistant a name" required />
        </div>
        <div class="field-group">
          <label class="field-label" for="join-url">Invite URL <span class="opt">(optional)</span></label>
          <input id="join-url" name="joinUrl" class="field-input" placeholder="Paste a Convos invite link to join an existing conversation" />
          <div class="field-hint" id="join-url-hint">Leave empty to create a new conversation</div>
          <div class="field-error" id="join-url-error"></div>
        </div>
        <div class="field-group">
          <label class="field-label" for="instructions">Instructions</label>
          <textarea id="instructions" name="instructions" class="field-input" placeholder="Tell the assistant who it is and what it should do..." required></textarea>
        </div>
        <button type="submit" id="btn" class="btn-launch" disabled>Launch Assistant</button>
      </form>
      ` : ''}

      <div id="paste-view"${showDevTools ? ' style="display:none"' : ''}>
        <div class="joining-overlay" id="joining-overlay" aria-live="polite">
          <div class="joining-scene">
            <div class="joining-particle"></div>
            <div class="joining-particle"></div>
            <div class="joining-particle"></div>
            <div class="joining-particle"></div>
            <div class="joining-particle"></div>
            <div class="joining-particle"></div>
            <div class="joining-balloon-group">
              <svg class="joining-balloon-svg" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="72" height="92">
                <path d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z" fill="#E54D00"/>
                <path d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z" fill="#E54D00"/>
              </svg>
              <div class="joining-string-upper">
                <svg width="20" height="40" viewBox="0 0 20 40" fill="none">
                  <path d="M10 0 Q13 14 8 25 Q6 33 10 40" stroke="#D4D4D4" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                </svg>
                <div class="joining-string-lower">
                  <svg width="20" height="35" viewBox="0 0 20 35" fill="none">
                    <path d="M10 0 Q14 15 8 35" stroke="#D4D4D4" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                  </svg>
                </div>
              </div>
            </div>
            <div class="joining-confetti" id="joining-confetti">
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
              <div class="joining-confetti-piece"></div>
            </div>
          </div>
          <div class="joining-status-text" id="joining-text"></div>
          <div class="joining-status-sub" id="joining-sub"></div>
          <button class="joining-dismiss-btn" id="joining-dismiss" style="display:none"></button>
        </div>
        <div class="paste-input-wrap">
          <span class="paste-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </span>
          <input id="paste-input" class="paste-input" placeholder="${POOL_ENVIRONMENT === "production" ? "popup.convos.org/..." : "dev.convos.org/..."}" />
          <div class="paste-error" id="paste-error"></div>
        </div>
        <div class="stories">
          <div>
            <div class="story-label">Built in</div>
            <p class="story-text">Convos AI Assistants can browse the web and use email, SMS, and crypto wallets to help your group with scheduling, reservations, payments, and more.<br><a href="#">Built with OpenClaw 🦞</a></p>
          </div>
          <div>
            <div class="story-label">Safe by default</div>
            <p class="story-text">Convos keeps conversations separate and encrypted by default. Each assistant you add is unique to that conversation and can never access other chats, contacts, or profiles.<br><a href="#">Learn more</a></p>
          </div>
        </div>

        <div class="prompt-store" id="prompt-store">
          <div class="ps-header">
            <span class="ps-title">Try an assistant</span>
          </div>
          <p class="ps-intro">Below find our 100+ favorite group agent skills &mdash; Simply copy and paste any instructions into the chat and you now have an incredibly powerful new group agent.</p>
          <div class="ps-search-wrap">
            <span class="ps-search-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>
            <input class="ps-search" placeholder="Search assistants..." id="ps-search" aria-label="Search assistants" />
          </div>
          <div class="ps-filters" id="ps-filters"></div>
          <div class="ps-no-results" id="ps-no-results">No assistants match your search</div>
          <div class="ps-list" id="ps-list"></div>
          <button class="ps-show-more" id="ps-show-more">Show all assistants</button>
        </div>
      </div>

      <div class="ps-modal-overlay" id="ps-modal">
        <div class="ps-modal">
          <div class="ps-modal-head">
            <span class="ps-modal-title" id="ps-modal-name"></span>
            <button class="ps-modal-close" id="ps-modal-close" aria-label="Close modal">&times;</button>
          </div>
          <div class="ps-modal-body">
            <div class="ps-modal-text" id="ps-modal-text">Loading...</div>
          </div>
          <div class="ps-modal-footer">
            <button class="ps-modal-copy" id="ps-modal-copy">Copy full prompt</button>
          </div>
        </div>
      </div>

      <div class="error-message" id="error"></div>
      <div class="success-banner" id="success">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        <div>
          <div class="success-text" id="success-text"></div>
          <div class="success-sub" id="success-sub">The assistant is now active in the conversation.</div>
        </div>
      </div>

      ${showDevTools ? '<div class="footer-note" id="footer-note">Your assistant will be live in about 30 seconds</div>' : ''}
    </div>
  </div>

  <div class="modal-overlay" id="qr-modal">
    <div class="modal">
      <h3 id="modal-title">QR Code</h3>
      <a class="qr-wrap" id="qr-wrap" href="#" target="_blank" rel="noopener">
        <img id="modal-qr" alt="Scan to connect" />
        <div class="icon-center" aria-hidden="true">
          <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            <style>.s0{fill:#000}.s1{fill:#fff}.s2{fill:none;stroke:#000;stroke-width:7.2}</style>
            <path fill-rule="evenodd" class="s0" d="m24 0h72c13.25 0 24 10.75 24 24v72c0 13.25-10.75 24-24 24h-72c-13.25 0-24-10.75-24-24v-72c0-13.25 10.75-24 24-24z"/>
            <path fill-rule="evenodd" class="s1" d="m60 30c16.57 0 30 13.43 30 30 0 16.57-13.43 30-30 30-16.57 0-30-13.43-30-30 0-16.57 13.43-30 30-30z"/>
            <path class="s2" d="m40 60h40"/>
            <path class="s2" d="m50 60h40"/>
            <path class="s2" d="m60 40v40"/>
            <path class="s2" d="m45.9 45.86l28.28 28.28"/>
            <path class="s2" d="m45.9 74.14l28.28-28.28"/>
          </svg>
        </div>
      </a>
      <div class="invite-row" id="invite-row" onclick="copyInvite()" title="Click to copy">
        <span class="invite-url" id="modal-invite"></span>
        <span id="copy-icon-wrap" class="copy-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg></span>
      </div>
    </div>
  </div>

  <script>
    var SHOW_DEV_TOOLS=${showDevTools};
    var API_KEY='${POOL_API_KEY}';
    var POOL_ENV='${POOL_ENVIRONMENT}';
    var RAILWAY_PROJECT='${process.env.RAILWAY_PROJECT_ID || ""}';
    var RAILWAY_ENV='${process.env.RAILWAY_ENVIRONMENT_ID || ""}';
    var authHeaders={'Authorization':'Bearer '+API_KEY,'Content-Type':'application/json'};

    function railwayUrl(serviceId){
      if(!RAILWAY_PROJECT||!serviceId)return null;
      return 'https://railway.com/project/'+RAILWAY_PROJECT+'/service/'+serviceId+(RAILWAY_ENV?'?environmentId='+RAILWAY_ENV:'');
    }

    function timeAgo(dateStr){
      if(!dateStr)return '';
      var ms=Date.now()-new Date(dateStr).getTime();
      var s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
      if(d>0)return d+'d '+h%24+'h';
      if(h>0)return h+'h '+m%60+'m';
      if(m>0)return m+'m';
      return '<1m';
    }

    function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}

    // Pool status
    var emptyState=document.getElementById('empty-state');
    var formEl=document.getElementById('f');
    var btn=document.getElementById('btn');
    var footerNote=document.getElementById('footer-note');
    var pasteView=document.getElementById('paste-view');
    var pasteInput=document.getElementById('paste-input');
    var pasteError=document.getElementById('paste-error');
    var joiningOverlay=document.getElementById('joining-overlay');
    var joiningText=document.getElementById('joining-text');
    var joiningSub=document.getElementById('joining-sub');
    var joiningDismiss=document.getElementById('joining-dismiss');
    var joiningConfetti=document.getElementById('joining-confetti');
    var joiningAutoHideTimer=null;
    var pageTitle=document.getElementById('page-title');
    var pageSubtitle=document.getElementById('page-subtitle');
    var launching=false;
    var devToolsActive=SHOW_DEV_TOOLS;

    function setDevToolsActive(active){
      devToolsActive=active;
      if(formEl)formEl.style.display=active?'':'none';
      if(footerNote)footerNote.style.display=active?'':'none';
      if(pasteView)pasteView.style.display=active?'none':'';
      pageTitle.textContent=active?'Launch your assistant':'Invite an assistant';
      pageSubtitle.textContent=active?'Create an AI assistant and drop it into any Convos conversation.':'Paste a link and an AI assistant will join your Convos conversation.';
      refreshStatus();
    }

    async function refreshStatus(){
      try{
        var res=await fetch('/api/pool/counts');
        var c=await res.json();
        if(SHOW_DEV_TOOLS){
          document.getElementById('s-idle').textContent=c.idle;
          document.getElementById('s-starting').textContent=c.starting;
          document.getElementById('s-claimed').textContent=c.claimed;
          var sw=document.getElementById('s-crashed-wrap');
          if(c.crashed>0){document.getElementById('s-crashed').textContent=c.crashed;sw.style.display='';}
          else{sw.style.display='none';}
        }
        if(!launching){
          if(devToolsActive){
            if(c.idle>0){if(btn)btn.disabled=false;emptyState.style.display='none';if(formEl)formEl.style.display='';if(footerNote)footerNote.style.display=''}
            else{if(btn)btn.disabled=true;emptyState.style.display='block';if(formEl)formEl.style.display='none';if(footerNote)footerNote.style.display='none'}
          }else{
            if(c.idle>0){emptyState.style.display='none';if(pasteView)pasteView.style.display='';}
            else{emptyState.style.display='block';if(pasteView)pasteView.style.display='none';}
          }
        }
      }catch{}
    }

    // Agent feed (dev mode only)
    var claimedCache=[],crashedCache=[];

    async function refreshFeed(){
      if(!SHOW_DEV_TOOLS)return;
      try{
        var res=await fetch('/api/pool/agents');
        var data=await res.json();
        claimedCache=(data.claimed||[]).sort(function(a,b){return new Date(b.claimedAt)-new Date(a.claimedAt);});
        crashedCache=(data.crashed||[]).sort(function(a,b){return new Date(b.claimedAt)-new Date(a.claimedAt);});
        renderFeed();
      }catch{}
    }

    function renderFeed(){
      if(!SHOW_DEV_TOOLS)return;
      var feed=document.getElementById('feed');
      var dc=document.getElementById('dropdown-count');
      var total=claimedCache.length+crashedCache.length;
      var parts=[];
      if(claimedCache.length)parts.push(claimedCache.length+' running');
      if(crashedCache.length)parts.push(crashedCache.length+' crashed');
      dc.textContent=parts.join(' · ')||'';
      if(!total){
        feed.innerHTML='<div class="dropdown-empty">No live assistants yet.</div>';
        return;
      }
      var html='';
      crashedCache.forEach(function(a){
        var name=esc(a.agentName||a.id);
        var rUrl=railwayUrl(a.serviceId);
        var branchTag=a.sourceBranch?' · '+esc(a.sourceBranch):'';
        var idPart=rUrl?'<a href="'+rUrl+'" target="_blank" rel="noopener">'+esc(a.id)+'</a>':esc(a.id);
        html+='<div class="agent-card crashed" id="agent-'+a.id+'">'+
          '<div class="agent-top">'+
            '<div class="agent-top-left">'+
              '<span class="agent-name">'+name+'<span class="agent-status-badge">Crashed</span></span>'+
              '<span class="agent-uptime">'+timeAgo(a.claimedAt)+'</span>'+
            '</div>'+
            '<div class="agent-actions">'+
              '<button class="agent-btn" data-qr="'+a.id+'">QR</button>'+
              '<button class="agent-btn warn" data-dismiss="'+a.id+'">Dismiss</button>'+
            '</div>'+
          '</div>'+
          '<div class="agent-meta">'+idPart+branchTag+'</div>'+
        '</div>';
      });
      claimedCache.forEach(function(a){
        var name=esc(a.agentName||a.id);
        var rUrl=railwayUrl(a.serviceId);
        var branchTag=a.sourceBranch?' · '+esc(a.sourceBranch):'';
        var idPart=rUrl?'<a href="'+rUrl+'" target="_blank" rel="noopener">'+esc(a.id)+'</a>':esc(a.id);
        html+='<div class="agent-card" id="agent-'+a.id+'">'+
          '<div class="agent-top">'+
            '<div class="agent-top-left">'+
              '<span class="agent-name">'+name+'</span>'+
              '<span class="agent-uptime">'+timeAgo(a.claimedAt)+'</span>'+
            '</div>'+
            '<div class="agent-actions">'+
              '<button class="agent-btn" data-qr="'+a.id+'">QR</button>'+
              '<button class="agent-btn danger" data-kill="'+a.id+'">Kill</button>'+
            '</div>'+
          '</div>'+
          '<div class="agent-meta">'+idPart+branchTag+'</div>'+
        '</div>';
      });
      feed.innerHTML=html;
    }

    // Join URL validation
    function validateJoinUrl(input){
      if(!input)return {valid:true};
      if(/^https?:\\/\\/(popup\\.convos\\.org|dev\\.convos\\.org)\\/v2\\?.+$/i.test(input))return {valid:true};
      if(/^https?:\\/\\/convos\\.app\\/join\\/.+$/i.test(input))return {valid:true};
      if(/^convos:\\/\\/join\\/.+$/i.test(input))return {valid:true};
      if(/^[A-Za-z0-9+/=*_-]+$/.test(input)&&input.length>20)return {valid:true};
      return {valid:false,message:'Enter a valid Convos invite URL or invite slug'};
    }
    function checkEnvUrl(url){
      if(!url)return {valid:true};
      if(POOL_ENV==='production'&&/dev\\.convos\\.org/i.test(url))
        return {valid:false,message:'dev.convos.org links cannot be used in production'};
      if(POOL_ENV!=='production'&&/popup\\.convos\\.org/i.test(url))
        return {valid:false,message:'popup.convos.org links cannot be used in '+POOL_ENV};
      return {valid:true};
    }

    if(SHOW_DEV_TOOLS){
    // Dynamic button text based on invite URL
    var joinUrlInput=document.getElementById('join-url');
    var joinUrlError=document.getElementById('join-url-error');
    var joinUrlHint=document.getElementById('join-url-hint');
    var nameInput=document.getElementById('name');
    function updateButtonText(){
      if(launching)return;
      var hasJoinUrl=joinUrlInput.value.trim().length>0;
      btn.textContent=hasJoinUrl?'Join Conversation':'Launch Assistant';
      if(hasJoinUrl){
        nameInput.removeAttribute('required');
        nameInput.placeholder='e.g. My Assistant (optional for join)';
      }else{
        nameInput.setAttribute('required','');
        nameInput.placeholder='Give your assistant a name';
        joinUrlHint.style.display='';
      }
    }

    joinUrlInput.addEventListener('input',function(){
      var val=joinUrlInput.value.trim();
      var result=validateJoinUrl(val);
      if(result.valid)result=checkEnvUrl(val);
      if(!result.valid){
        joinUrlError.textContent=result.message;
        joinUrlError.classList.add('visible');
        joinUrlInput.classList.add('invalid');
        joinUrlHint.style.display='none';
      }else{
        joinUrlError.textContent='';
        joinUrlError.classList.remove('visible');
        joinUrlInput.classList.remove('invalid');
        joinUrlHint.style.display=val?'none':'';
      }
      updateButtonText();
    });
    } // end SHOW_DEV_TOOLS join-url handling

    // QR modal
    var modal=document.getElementById('qr-modal');
    var qrWrap=document.getElementById('qr-wrap');
    var inviteRow=document.getElementById('invite-row');
    var inviteEl=document.getElementById('modal-invite');
    var copyIconWrap=document.getElementById('copy-icon-wrap');
    var currentInviteUrl='';
    var checkSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M20 6L9 17l-5-5"/></svg>';
    var copySvg=copyIconWrap.innerHTML;
    function showQr(name,url){
      document.getElementById('modal-title').textContent=name;
      document.getElementById('modal-qr').src='https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='+encodeURIComponent(url);
      qrWrap.href=url;
      currentInviteUrl=url;
      inviteEl.textContent=url;
      inviteRow.classList.remove('copied');
      copyIconWrap.innerHTML=copySvg;
      modal.classList.add('active');
    }
    function copyInvite(){
      navigator.clipboard.writeText(currentInviteUrl).then(function(){
        inviteRow.classList.add('copied');
        inviteEl.textContent='Copied!';
        copyIconWrap.innerHTML=checkSvg;
        setTimeout(function(){
          inviteRow.classList.remove('copied');
          inviteEl.textContent=currentInviteUrl;
          copyIconWrap.innerHTML=copySvg;
        },1500);
      });
    }
    function closeModal(){modal.classList.remove('active');}
    modal.onclick=function(e){if(e.target===modal)closeModal();};

    // Shared elements
    var errorEl=document.getElementById('error');
    var successEl=document.getElementById('success'),successTextEl=document.getElementById('success-text');

    // Launch form (dev mode)
    if(SHOW_DEV_TOOLS){
    var f=document.getElementById('f');
    f.onsubmit=async function(e){
      e.preventDefault();
      var agentName=f.name.value.trim();
      var joinUrl=joinUrlInput.value.trim();
      var urlResult=validateJoinUrl(joinUrl);
      if(urlResult.valid)urlResult=checkEnvUrl(joinUrl);
      if(!urlResult.valid){
        joinUrlError.textContent=urlResult.message;
        joinUrlError.classList.add('visible');
        joinUrlInput.classList.add('invalid');
        joinUrlInput.focus();
        return;
      }
      var payload={agentName:agentName||(joinUrl?'Assistant':''),instructions:f.instructions.value.trim()};
      if(joinUrl)payload.joinUrl=joinUrl;
      var isJoin=!!joinUrl;
      launching=true;btn.disabled=true;btn.textContent=isJoin?'Joining...':'Launching...';
      errorEl.style.display='none';successEl.classList.remove('active');
      try{
        var res=await fetch('/api/pool/claim',{method:'POST',headers:authHeaders,body:JSON.stringify(payload)});
        var data=await res.json();
        if(!res.ok)throw new Error(data.error||'Launch failed');
        f.reset();
        updateButtonText();
        if(data.joined){
          successTextEl.textContent=(agentName||'Assistant')+' joined the conversation';
          successEl.classList.add('active');
          setTimeout(function(){successEl.classList.remove('active');},8000);
        }else{
          showQr(agentName||data.instanceId,data.inviteUrl);
        }
        refreshFeed();
      }catch(err){
        errorEl.textContent=err.message;
        errorEl.style.display='block';
      }finally{launching=false;btn.textContent=joinUrlInput.value.trim()?'Join Conversation':'Launch Assistant';refreshStatus();}
    };
    } // end SHOW_DEV_TOOLS form

    // Paste auto-launch (always wired up since paste-view is always in DOM)
    if(pasteInput){
    pasteInput.addEventListener('paste',function(){
      setTimeout(function(){
        var url=pasteInput.value.trim();
        if(url)handlePasteUrl(url);
      },0);
    });
    pasteInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){
        e.preventDefault();
        var url=pasteInput.value.trim();
        if(url)handlePasteUrl(url);
      }
    });
    pasteInput.addEventListener('input',function(){
      var val=pasteInput.value.trim();
      if(!val){
        pasteError.classList.remove('visible');
        pasteInput.classList.remove('invalid');
        errorEl.style.display='none';
      }
    });
    function showJoiningOverlay(state,text,sub){
      if(joiningAutoHideTimer){clearTimeout(joiningAutoHideTimer);joiningAutoHideTimer=null;}
      joiningOverlay.className='joining-overlay active '+state;
      joiningText.textContent=text;
      joiningSub.textContent=sub;
      joiningDismiss.style.display=(state==='success'||state==='error')?'':'none';
      joiningDismiss.textContent=state==='success'?'Paste another link':'Try again';
      if(state==='success'){
        // Generate dynamic confetti particles
        var colors=['#FC4F37','#FBBF24','#34D399','#60A5FA','#E54D00'];
        joiningConfetti.innerHTML='';
        for(var i=0;i<20;i++){
          var p=document.createElement('div');
          p.className='joining-confetti-piece';
          p.style.left=(10+Math.random()*80)+'%';
          p.style.background=colors[i%colors.length];
          p.style.animationDelay=(Math.random()*0.3)+'s';
          p.style.width=(4+Math.random()*4)+'px';
          p.style.height=(4+Math.random()*4)+'px';
          p.style.borderRadius=Math.random()>0.5?'50%':'2px';
          joiningConfetti.appendChild(p);
        }
      }
    }

    function hideJoiningOverlay(){
      if(joiningAutoHideTimer){clearTimeout(joiningAutoHideTimer);joiningAutoHideTimer=null;}
      joiningOverlay.className='joining-overlay';
      joiningDismiss.style.display='none';
      pasteInput.value='';
      pasteInput.disabled=false;
      pasteInput.focus();
    }

    if(joiningDismiss){
      joiningDismiss.addEventListener('click',function(){hideJoiningOverlay();});
    }

    function handlePasteUrl(url){
      var result=validateJoinUrl(url);
      if(result.valid)result=checkEnvUrl(url);
      if(!result.valid){
        pasteError.textContent=result.message;
        pasteError.classList.add('visible');
        pasteInput.classList.add('invalid');
        return;
      }
      pasteError.classList.remove('visible');
      pasteInput.classList.remove('invalid');
      launching=true;
      pasteInput.disabled=true;
      pasteInput.value='';
      errorEl.style.display='none';successEl.classList.remove('active');
      showJoiningOverlay('joining','Your assistant is on the way','Setting up a secure connection');
      fetch('/api/pool/claim',{method:'POST',headers:authHeaders,body:JSON.stringify({joinUrl:url})})
        .then(function(res){return res.json().then(function(data){return {ok:res.ok,data:data};});})
        .then(function(r){
          if(!r.ok)throw new Error(r.data.error||'Failed to join');
          if(r.data.joined){
            showJoiningOverlay('success','Your assistant has arrived!','They\u2019re now in your conversation');
            joiningAutoHideTimer=setTimeout(function(){hideJoiningOverlay();},2500);
          }else{
            hideJoiningOverlay();
            showQr(r.data.agentName||'Assistant',r.data.inviteUrl);
          }
          refreshFeed();
        })
        .catch(function(err){
          showJoiningOverlay('error','Couldn\u2019t reach your conversation',err.message||'Check the link and try again');
        })
        .then(function(){
          launching=false;
          refreshStatus();
        });
    }
    } // end paste auto-launch

    // Dev bar: env toggle, dropdown, pool controls, agent actions
    if(SHOW_DEV_TOOLS){
      // Env tag toggles the bar
      var devBar=document.getElementById('dev-bar');
      var envToggle=document.getElementById('env-toggle');
      envToggle.addEventListener('click',function(){
        var collapsed=!devBar.classList.contains('collapsed');
        devBar.classList.toggle('collapsed');
        setDevToolsActive(!collapsed);
      });

      var toggle=document.getElementById('claimed-toggle');
      var dropdown=document.getElementById('agents-dropdown');
      var backdrop=document.getElementById('dropdown-backdrop');

      function openDropdown(){dropdown.classList.add('open');backdrop.classList.add('open');toggle.classList.add('open');}
      function closeDropdown(){dropdown.classList.remove('open');backdrop.classList.remove('open');toggle.classList.remove('open');}

      toggle.addEventListener('click',function(e){
        if(e.target.closest('.agents-dropdown'))return;
        dropdown.classList.contains('open')?closeDropdown():openDropdown();
      });
      backdrop.addEventListener('click',closeDropdown);
      dropdown.addEventListener('click',function(e){e.stopPropagation();});

      // Agent actions (event delegation on feed)
      var feed=document.getElementById('feed');
      feed.onclick=function(e){
        var qrId=e.target.getAttribute('data-qr');
        if(qrId){
          var a=claimedCache.concat(crashedCache).find(function(x){return x.id===qrId;});
          if(a)showQr(a.agentName||a.id,a.inviteUrl||'');
          return;
        }
        var killId=e.target.getAttribute('data-kill');
        if(killId){killAgent(killId);return;}
        var dismissId=e.target.getAttribute('data-dismiss');
        if(dismissId){dismissAgent(dismissId);}
      };

      function markDestroying(id){
        var card=document.getElementById('agent-'+id);
        if(card){card.classList.add('destroying');var u=card.querySelector('.agent-uptime');if(u)u.textContent='Destroying...';}
      }

      async function killAgent(id){
        var card=document.getElementById('agent-'+id);
        var name=card?card.querySelector('.agent-name').textContent.trim():id;
        var msg=(POOL_ENV==='production'?'[PRODUCTION] ':'')+'Kill "'+name+'"? This deletes the Railway service.';
        if(!confirm(msg))return;
        markDestroying(id);
        try{
          var res=await fetch('/api/pool/instances/'+id,{method:'DELETE',headers:authHeaders});
          var data=await res.json();
          if(!res.ok)throw new Error(data.error||'Kill failed');
          if(card)card.remove();
          refreshStatus();
        }catch(err){
          alert('Failed to kill: '+err.message);
          if(card)card.classList.remove('destroying');
        }
      }

      async function dismissAgent(id){
        var a=crashedCache.find(function(x){return x.id===id;});
        var name=a?(a.agentName||a.id):id;
        var msg=(POOL_ENV==='production'?'[PRODUCTION] ':'')+'Dismiss crashed "'+name+'"?';
        if(!confirm(msg))return;
        markDestroying(id);
        try{
          var res=await fetch('/api/pool/crashed/'+id,{method:'DELETE',headers:authHeaders});
          var data=await res.json();
          if(!res.ok)throw new Error(data.error||'Dismiss failed');
          var card=document.getElementById('agent-'+id);
          if(card)card.remove();
          refreshStatus();refreshFeed();
        }catch(err){
          alert('Failed to dismiss: '+err.message);
          var card=document.getElementById('agent-'+id);
          if(card)card.classList.remove('destroying');
        }
      }

      // Pool controls
      var replenishBtn=document.getElementById('replenish-btn');
      var replenishCount=document.getElementById('replenish-count');
      replenishBtn.onclick=async function(){
        var n=parseInt(replenishCount.value)||1;
        replenishBtn.disabled=true;replenishBtn.textContent='Adding...';
        try{
          var res=await fetch('/api/pool/replenish',{method:'POST',headers:authHeaders,body:JSON.stringify({count:n})});
          var data=await res.json();
          if(!res.ok)throw new Error(data.error||'Failed');
          refreshStatus();
        }catch(err){alert('Failed: '+err.message);}
        finally{replenishBtn.disabled=false;replenishBtn.textContent='+ Add';}
      };

      var drainBtn=document.getElementById('drain-btn');
      drainBtn.onclick=async function(){
        drainBtn.disabled=true;
        var n=0;
        try{var cr=await fetch('/api/pool/counts');var c=await cr.json();n=Math.min((c.idle||0)+(c.starting||0),20);}catch(e){}
        drainBtn.disabled=false;
        if(n===0){alert('No unclaimed instances to drain.');return;}
        var msg=(POOL_ENV==='production'?'[PRODUCTION] ':'')+'Drain '+n+' unclaimed instance(s)?';
        if(!confirm(msg))return;
        drainBtn.disabled=true;drainBtn.textContent='Draining...';
        try{
          var res=await fetch('/api/pool/drain',{method:'POST',headers:authHeaders,body:JSON.stringify({count:n})});
          var data=await res.json();
          if(!res.ok)throw new Error(data.error||'Failed');
          refreshStatus();
        }catch(err){alert('Failed: '+err.message);}
        finally{drainBtn.disabled=false;drainBtn.textContent='Drain';}
      };
    }

    // Initial load + polling
    refreshStatus();refreshFeed();
    setInterval(function(){refreshStatus();refreshFeed();},15000);

    // ===== Prompt Store =====
    (function(){
      var CATALOG=${AGENT_CATALOG_JSON};

      var PS_LIMIT=10;
      var psExpanded=false;
      var psActiveCategory='All';
      var psSearchText='';
      var psPromptCache={};
      var psEl=document.getElementById('prompt-store');
      var psSearch=document.getElementById('ps-search');
      var psFilters=document.getElementById('ps-filters');
      var psList=document.getElementById('ps-list');
      var psShowMore=document.getElementById('ps-show-more');
      var psNoResults=document.getElementById('ps-no-results');
      var psModal=document.getElementById('ps-modal');
      var psModalName=document.getElementById('ps-modal-name');
      var psModalText=document.getElementById('ps-modal-text');
      var psModalCopy=document.getElementById('ps-modal-copy');
      var psModalClose=document.getElementById('ps-modal-close');

      if(!psEl||!CATALOG.length)return;

      // Get unique categories in order
      var cats=[];var catSet={};
      CATALOG.forEach(function(a){
        if(!catSet[a.c]){catSet[a.c]=true;cats.push({name:a.c,emoji:a.e});}
      });

      // Render filter pills
      function renderFilters(){
        var h='<button class="ps-filter-pill'+(psActiveCategory==='All'?' active':'')+'" data-cat="All">All</button>';
        cats.forEach(function(c){
          h+='<button class="ps-filter-pill'+(psActiveCategory===c.name?' active':'')+'" data-cat="'+esc(c.name)+'">'+c.emoji+' '+esc(c.name)+'</button>';
        });
        psFilters.innerHTML=h;
      }

      // Filter agents
      function getFiltered(){
        var q=psSearchText.toLowerCase();
        return CATALOG.filter(function(a){
          if(psActiveCategory!=='All'&&a.c!==psActiveCategory)return false;
          if(q&&a.n.toLowerCase().indexOf(q)===-1&&a.d.toLowerCase().indexOf(q)===-1)return false;
          return true;
        });
      }

      // Render agent list
      function renderList(){
        var filtered=getFiltered();
        var shown=psExpanded||psSearchText||psActiveCategory!=='All'?filtered:filtered.slice(0,PS_LIMIT);
        if(!shown.length){
          psList.innerHTML='';
          psNoResults.style.display='block';
          psShowMore.style.display='none';
          return;
        }
        psNoResults.style.display='none';
        var html='';var lastCat='';
        shown.forEach(function(a){
          if(a.c!==lastCat){
            lastCat=a.c;
            html+='<div class="ps-cat-header">'+a.e+' '+esc(a.c)+'</div>';
          }
          html+='<div class="ps-agent-row" data-pid="'+esc(a.p)+'" data-name="'+esc(a.n)+'">';
          html+='<div class="ps-agent-info"><div class="ps-agent-name">'+esc(a.n)+'</div><div class="ps-agent-desc">'+esc(a.d)+'</div></div>';
          html+='<div class="ps-agent-actions">';
          if(a.p){
            html+='<button class="ps-btn ps-view-btn" data-pid="'+esc(a.p)+'" data-name="'+esc(a.n)+'">View</button>';
            html+='<button class="ps-btn primary ps-copy-btn" data-pid="'+esc(a.p)+'" data-name="'+esc(a.n)+'">Copy</button>';
          }
          html+='</div></div>';
        });
        psList.innerHTML=html;

        // Show more button
        if(!psSearchText&&psActiveCategory==='All'&&!psExpanded&&filtered.length>PS_LIMIT){
          psShowMore.style.display='block';
          psShowMore.textContent='Show all '+filtered.length+' assistants';
        }else if(psExpanded&&!psSearchText&&psActiveCategory==='All'){
          psShowMore.style.display='block';
          psShowMore.textContent='Show less';
        }else{
          psShowMore.style.display='none';
        }
      }

      // Fetch prompt from API
      function fetchPrompt(pageId,cb){
        if(psPromptCache[pageId])return cb(null,psPromptCache[pageId]);
        fetch('/api/prompts/'+pageId).then(function(r){
          if(!r.ok)throw new Error('Failed');
          return r.json();
        }).then(function(d){
          psPromptCache[pageId]=d;
          cb(null,d);
        }).catch(function(e){cb(e);});
      }

      // Copy to clipboard
      function copyToClipboard(text,btn,label){
        navigator.clipboard.writeText(text).then(function(){
          btn.classList.add('copied');
          btn.textContent='Copied!';
          setTimeout(function(){btn.classList.remove('copied');btn.textContent=label||'Copy';},1500);
        });
      }

      // Open modal
      function openModal(pageId,name){
        psModalName.textContent=name;
        psModalText.textContent='Loading...';
        psModalCopy.textContent='Copy full prompt';
        psModalCopy.classList.remove('copied');
        psModal.classList.add('open');
        document.body.style.overflow='hidden';
        fetchPrompt(pageId,function(err,data){
          if(err){psModalText.textContent='Failed to load prompt. Try again later.';return;}
          psModalText.textContent=data.prompt||'(No prompt content found)';
          psModalCopy.onclick=function(){copyToClipboard(data.prompt,psModalCopy,'Copy full prompt');};
        });
      }

      function closeModal(){
        psModal.classList.remove('open');
        document.body.style.overflow='';
      }

      // Event: search
      psSearch.addEventListener('input',function(){
        psSearchText=this.value.trim();
        renderList();
      });

      // Event: filter pills
      psFilters.addEventListener('click',function(e){
        var pill=e.target.closest('.ps-filter-pill');
        if(!pill)return;
        psActiveCategory=pill.dataset.cat;
        renderFilters();
        renderList();
      });

      // Event: show more/less
      psShowMore.addEventListener('click',function(){
        psExpanded=!psExpanded;
        renderList();
      });

      // Event: agent row clicks (view/copy buttons)
      psList.addEventListener('click',function(e){
        var viewBtn=e.target.closest('.ps-view-btn');
        var copyBtn=e.target.closest('.ps-copy-btn');
        if(viewBtn){
          e.stopPropagation();
          openModal(viewBtn.dataset.pid,viewBtn.dataset.name);
          return;
        }
        if(copyBtn){
          e.stopPropagation();
          copyBtn.classList.add('loading');
          copyBtn.textContent='...';
          fetchPrompt(copyBtn.dataset.pid,function(err,data){
            copyBtn.classList.remove('loading');
            if(err){copyBtn.textContent='Error';setTimeout(function(){copyBtn.textContent='Copy';},1500);return;}
            copyToClipboard(data.prompt,copyBtn);
          });
          return;
        }
        // Click on row opens modal
        var row=e.target.closest('.ps-agent-row');
        if(row&&row.dataset.pid){
          openModal(row.dataset.pid,row.dataset.name);
        }
      });

      // Event: modal close
      psModalClose.addEventListener('click',closeModal);
      psModal.addEventListener('click',function(e){if(e.target===psModal)closeModal();});
      document.addEventListener('keydown',function(e){if(e.key==='Escape'&&psModal.classList.contains('open'))closeModal();});

      // Init
      renderFilters();
      renderList();
    })();
  </script>
</body>
</html>`);
});

// Pool status overview
app.get("/api/pool/status", requireAuth, (_req, res) => {
  const counts = cache.getCounts();
  const instances = cache.getAll();
  res.json({ counts, instances });
});

// Launch an agent — claim an idle instance and provision it with instructions.
app.post("/api/pool/claim", requireAuth, async (req, res) => {
  const { agentName, instructions, joinUrl } = req.body || {};
  if (!joinUrl && (!instructions || typeof instructions !== "string")) {
    return res.status(400).json({ error: "instructions (string) is required" });
  }
  if (!joinUrl && (!agentName || typeof agentName !== "string")) {
    return res.status(400).json({ error: "agentName (string) is required" });
  }
  if (joinUrl && typeof joinUrl !== "string") {
    return res.status(400).json({ error: "joinUrl must be a string if provided" });
  }
  if (joinUrl && POOL_ENVIRONMENT === "production" && /dev\.convos\.org/i.test(joinUrl)) {
    return res.status(400).json({ error: "dev.convos.org links cannot be used in the production environment" });
  }
  if (joinUrl && POOL_ENVIRONMENT !== "production" && /popup\.convos\.org/i.test(joinUrl)) {
    return res.status(400).json({ error: `popup.convos.org links cannot be used in the ${POOL_ENVIRONMENT} environment` });
  }

  try {
    const result = await pool.provision({
      agentName: agentName || "Assistant",
      instructions: instructions || "You are a helpful AI assistant.",
      joinUrl: joinUrl || undefined,
    });
    if (!result) {
      return res.status(503).json({
        error: "No idle instances available. Try again in a few minutes.",
      });
    }
    res.json(result);
  } catch (err) {
    console.error("[api] Launch failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a replenish cycle, optionally creating N instances
app.post("/api/pool/replenish", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 0, 20);
    if (count > 0) {
      const results = [];
      for (let i = 0; i < count; i++) {
        try {
          const inst = await pool.createInstance();
          results.push(inst);
        } catch (err) {
          console.error(`[pool] Failed to create instance:`, err);
        }
      }
      return res.json({ ok: true, created: results.length, counts: cache.getCounts() });
    }
    await pool.tick();
    res.json({ ok: true, counts: cache.getCounts() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger a tick (replaces old reconcile endpoint)
app.post("/api/pool/reconcile", requireAuth, async (_req, res) => {
  try {
    await pool.tick();
    res.json({ ok: true, counts: cache.getCounts() });
  } catch (err) {
    console.error("[api] Tick failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Drain unclaimed instances from the pool
app.post("/api/pool/drain", requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body?.count) || 1, 20);
    const drained = await pool.drainPool(count);
    res.json({ ok: true, drained: drained.length, counts: cache.getCounts() });
  } catch (err) {
    console.error("[api] Drain failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Notion prompt fetching ---
async function fetchNotionPrompt(pageId) {
  const cached = promptCache.get(pageId);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.data;
  const headers = { "Authorization": `Bearer ${NOTION_API_KEY}`, "Notion-Version": "2022-06-28" };
  const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, { headers });
  if (!blocksRes.ok) throw new Error(`Notion API ${blocksRes.status}`);
  const blocksData = await blocksRes.json();
  let text = "";
  for (const block of blocksData.results || []) {
    const rt = block[block.type]?.rich_text;
    if (rt) text += rt.map(t => t.plain_text).join("") + "\n";
    else if (block.type === "divider") text += "---\n";
    else if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
      const prefix = block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : "### ";
      const ht = block[block.type]?.rich_text;
      if (ht) text += prefix + ht.map(t => t.plain_text).join("") + "\n";
    } else if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const lt = block[block.type]?.rich_text;
      if (lt) text += "- " + lt.map(t => t.plain_text).join("") + "\n";
    }
  }
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers });
  let name = "";
  if (pageRes.ok) {
    const pageData = await pageRes.json();
    const titleProp = Object.values(pageData.properties || {}).find(p => p.type === "title");
    if (titleProp) name = titleProp.title?.map(t => t.plain_text).join("") || "";
  }
  const result = { name, prompt: text.trim() };
  promptCache.set(pageId, { data: result, ts: Date.now() });
  return result;
}

// Prefetch all agent prompts in background (3 concurrent)
async function prefetchAllPrompts() {
  if (!NOTION_API_KEY) return;
  const catalog = JSON.parse(AGENT_CATALOG_JSON);
  const ids = catalog.map(a => a.p).filter(Boolean);
  const uncached = ids.filter(id => !promptCache.has(id));
  if (!uncached.length) return;
  console.log(`[prompts] Prefetching ${uncached.length} prompts...`);
  let done = 0;
  for (let i = 0; i < uncached.length; i += 3) {
    const batch = uncached.slice(i, i + 3);
    await Promise.allSettled(batch.map(async id => {
      try { await fetchNotionPrompt(id); done++; } catch {}
    }));
  }
  console.log(`[prompts] Prefetched ${done}/${uncached.length} prompts`);
}

app.get("/api/prompts/:pageId", async (req, res) => {
  const { pageId } = req.params;
  if (!pageId || !/^[a-f0-9]{32}$/.test(pageId)) {
    return res.status(400).json({ error: "Invalid page ID" });
  }
  if (!NOTION_API_KEY) {
    return res.status(503).json({ error: "Notion API not configured" });
  }
  try {
    res.json(await fetchNotionPrompt(pageId));
  } catch (err) {
    console.error("[api] Notion fetch failed:", err);
    res.status(502).json({ error: "Failed to fetch prompt from Notion" });
  }
});

// --- Background tick ---
// Rebuild cache from Railway + health checks every 30 seconds.
const TICK_INTERVAL = parseInt(process.env.TICK_INTERVAL_MS || "30000", 10);
setInterval(() => {
  pool.tick().catch((err) => console.error("[tick] Error:", err));
}, TICK_INTERVAL);

// One-time orphan volume cleanup, then run initial tick
deleteOrphanAgentVolumes()
  .catch((err) => console.warn("[startup] Orphan volume cleanup failed:", err.message))
  .then(() => pool.tick())
  .catch((err) => console.error("[tick] Initial tick error:", err));

// Prefetch all Notion prompts in background so Copy is instant
setTimeout(() => prefetchAllPrompts().catch(() => {}), 5000);

app.listen(PORT, () => {
  console.log(`Pool manager listening on :${PORT}`);
});
