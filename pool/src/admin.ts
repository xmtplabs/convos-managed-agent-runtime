// @ts-nocheck
/**
 * Pool Admin — self-contained HTML admin page for pool management.
 * Password-protected via ADMIN_PASSWORD env var + session cookie.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __adminDir = path.dirname(fileURLToPath(import.meta.url));
const adminHtmlTemplate = fs.readFileSync(
  path.join(__adminDir, "..", "frontend", "admin.html"),
  "utf-8",
);

const COOKIE_NAME = "pool_admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Stateless token: HMAC of the API key + expiry. Survives server restarts. */
function makeToken(expiry) {
  const secret = process.env.POOL_API_KEY || "";
  return crypto.createHmac("sha256", secret).update(String(expiry)).digest("hex") + "." + expiry;
}

function verifyToken(token) {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const expiry = Number(token.slice(dot + 1));
  if (!expiry || Date.now() > expiry) return false;
  const expected = makeToken(expiry);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function adminLogin(password, res) {
  const adminPassword = process.env.POOL_API_KEY;
  if (!adminPassword || password !== adminPassword) {
    return false;
  }
  const token = makeToken(Date.now() + SESSION_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    secure: process.env.NODE_ENV === "production",
  });
  return true;
}

export function isAuthenticated(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  return verifyToken(match[1]);
}

export function adminLogout(req, res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

// --- Login page HTML ---
export function loginPage(error) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Convos Pool — Login</title>
  <link rel="icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --color-brand: #FC4F37;
      --color-foreground: #000000;
      --color-foreground-secondary: #666666;
      --color-foreground-inverted: #FFFFFF;
      --color-surface: #FFFFFF;
      --color-surface-muted: #F5F5F5;
      --color-edge: #EBEBEB;
      --color-error: #DC2626;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: var(--color-surface-muted);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-foreground);
      -webkit-font-smoothing: antialiased;
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
    .brand-icon { display: flex; align-items: center; justify-content: center; }
    .brand-icon svg { width: 22px; height: 28px; }
    .brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
    .brand-name-labs { font-weight: 400; color: var(--color-foreground-secondary); }
    .login-box {
      max-width: 360px;
      width: 100%;
      padding: 40px 32px;
      background: var(--color-surface);
      border-radius: 16px;
      border: 1px solid var(--color-edge);
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
    }
    .login-title { font-size: 20px; font-weight: 700; letter-spacing: -0.4px; margin-bottom: 4px; }
    .login-sub { font-size: 13px; color: var(--color-foreground-secondary); margin-bottom: 24px; }
    .login-input {
      width: 100%;
      padding: 12px 16px;
      border: 1.5px solid var(--color-edge);
      border-radius: 10px;
      font-size: 15px;
      font-family: inherit;
      background: var(--color-surface);
      transition: border-color 0.2s;
    }
    .login-input:focus { outline: none; border-color: var(--color-brand); }
    .login-btn {
      width: 100%;
      padding: 12px;
      margin-top: 12px;
      background: var(--color-brand);
      color: var(--color-foreground-inverted);
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .login-btn:hover { opacity: 0.9; }
    .login-error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 12px;
      display: ${error ? "block" : "none"};
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="brand">
      <div class="brand-icon">
        <svg viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="28">
          <path d="M27.7736 13.8868C27.7736 21.5563 21.5563 27.7736 13.8868 27.7736C6.21733 27.7736 0 21.5563 0 13.8868C0 6.21733 6.21733 0 13.8868 0C21.5563 0 27.7736 6.21733 27.7736 13.8868Z" fill="var(--color-brand)"/>
          <path d="M13.8868 27.7736L18.0699 35.0189H9.70373L13.8868 27.7736Z" fill="var(--color-brand)"/>
        </svg>
      </div>
      <span class="brand-name">Convos <span class="brand-name-labs">Pool</span></span>
    </div>
    <div class="login-title">Sign in</div>
    <div class="login-sub">Enter API key to continue</div>
    <form method="POST" action="/admin/login">
      <input class="login-input" type="password" name="password" placeholder="API key" autofocus required />
      <button class="login-btn" type="submit">Sign in</button>
      <div class="login-error">${error || ""}</div>
    </form>
  </div>
</body>
</html>`;
}

// --- Admin dashboard HTML ---
export function adminPage({
  poolEnvironment,
  deployBranch,
  instanceModel,
  railwayServiceId,
  bankrConfigured = false,
  adminUrls = [],
}) {
  const config = JSON.stringify({ poolEnvironment, instanceModel, bankrConfigured, adminUrls });
  return adminHtmlTemplate.replace(
    "<!--__POOL_CONFIG__-->",
    `<script>window.__POOL_CONFIG__=${config}</script>`,
  );
}

