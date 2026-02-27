// @ts-nocheck
/**
 * Pool Admin — self-contained HTML admin page for pool management.
 * Password-protected via ADMIN_PASSWORD env var + session cookie.
 */

import crypto from "node:crypto";

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
  <title>Pool Admin — Login</title>
  <link rel="icon" href="/favicon.ico">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: #FAFAFA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-box {
      max-width: 360px;
      width: 100%;
      padding: 40px 32px;
      background: #fff;
      border-radius: 16px;
      border: 1px solid #EBEBEB;
      box-shadow: 0 2px 12px rgba(0,0,0,0.04);
    }
    .login-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.4px;
      margin-bottom: 4px;
    }
    .login-sub {
      font-size: 13px;
      color: #999;
      margin-bottom: 24px;
    }
    .login-input {
      width: 100%;
      padding: 12px 16px;
      border: 1.5px solid #EBEBEB;
      border-radius: 10px;
      font-size: 15px;
      font-family: inherit;
      background: #fff;
      transition: border-color 0.2s;
    }
    .login-input:focus { outline: none; border-color: #000; }
    .login-btn {
      width: 100%;
      padding: 12px;
      margin-top: 12px;
      background: #000;
      color: #fff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .login-btn:hover { opacity: 0.85; }
    .login-error {
      color: #DC2626;
      font-size: 13px;
      margin-top: 12px;
      display: ${error ? "block" : "none"};
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="login-title">Pool Admin</div>
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
  const railwayLink = "";
  const railwayProjectLink = "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pool Admin — ${poolEnvironment}</title>
  <link rel="icon" href="/favicon.ico">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: #FAFAFA;
      color: #000;
      -webkit-font-smoothing: antialiased;
    }

    /* --- Header --- */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      background: #fff;
      border-bottom: 1px solid #EBEBEB;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .env-switcher {
      position: relative;
      display: inline-flex;
    }
    .env-switcher-btn {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 10px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .env-switcher-btn::after {
      content: '';
      border-left: 3px solid transparent;
      border-right: 3px solid transparent;
      border-top: 4px solid currentColor;
      opacity: 0.6;
    }
    .env-switcher-btn.env-dev { background: #DBEAFE; color: #1D4ED8; }
    .env-switcher-btn.env-staging { background: #FEF3C7; color: #92400E; }
    .env-switcher-btn.env-scaling { background: #E0E7FF; color: #3730A3; }
    .env-switcher-btn.env-vibe { background: #F3E8FF; color: #6B21A8; }
    .env-switcher-btn.env-production { background: #FEE2E2; color: #991B1B; }
    .env-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      background: #fff;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      min-width: 140px;
      z-index: 100;
      overflow: hidden;
    }
    .env-switcher.open .env-dropdown { display: block; }
    .env-dropdown a {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      color: #374151;
      transition: background 0.1s;
    }
    .env-dropdown a:hover { background: #F9FAFB; }
    .env-dropdown a.current { background: #F3F4F6; cursor: default; }
    .env-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .env-dot.dev { background: #1D4ED8; }
    .env-dot.staging { background: #92400E; }
    .env-dot.scaling { background: #3730A3; }
    .env-dot.vibe { background: #6B21A8; }
    .env-dot.production { background: #991B1B; }
    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .chip {
      font-size: 11px;
      font-weight: 500;
      color: #999;
      padding: 3px 8px;
      background: #F5F5F5;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
    }
    .chip a { color: #007AFF; text-decoration: none; }
    .chip a:hover { text-decoration: underline; }
    .logout-btn {
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      background: #fff;
      color: #999;
      cursor: pointer;
      font-family: inherit;
      margin-left: 8px;
    }
    .logout-btn:hover { background: #F5F5F5; color: #666; }

    /* --- Content --- */
    .content { max-width: 960px; margin: 0 auto; padding: 24px; }

    /* --- Stat cards --- */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 12px;
    }
    .stats-credits {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 12px;
      padding: 16px 20px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    /* --- Filter pills --- */
    .filter-pills {
      display: flex;
      gap: 6px;
    }
    .filter-pill {
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid #EBEBEB;
      background: #fff;
      color: #666;
      transition: all 0.15s;
    }
    .filter-pill:hover { background: #F5F5F5; border-color: #CCC; }
    .filter-pill.active { background: #000; color: #fff; border-color: #000; }
    .filter-pill .pill-count {
      display: inline-block;
      margin-left: 4px;
      font-size: 10px;
      min-width: 16px;
      text-align: center;
      padding: 0 4px;
      border-radius: 4px;
      background: #F0F0F0;
      color: #999;
    }
    .filter-pill.active .pill-count { background: rgba(255,255,255,0.2); color: rgba(255,255,255,0.7); }
    .stat-dot { width: 8px; height: 8px; border-radius: 50%; }
    .stat-dot.green { background: #34C759; }
    .stat-dot.orange { background: #FF9500; }
    .stat-dot.blue { background: #007AFF; }
    .stat-dot.red { background: #DC2626; }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -1px;
    }

    /* --- Controls --- */
    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .control-group {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 10px;
      padding: 8px 12px;
    }
    .control-group label {
      font-size: 12px;
      font-weight: 600;
      color: #666;
    }
    .control-input {
      width: 48px;
      padding: 4px 8px;
      text-align: center;
      font-size: 13px;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      font-family: inherit;
    }
    .control-input:focus { outline: none; border-color: #999; }
    select.control-input { width: 64px; }
    .btn {
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid;
      transition: all 0.15s;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: #000;
      color: #fff;
      border-color: #000;
    }
    .btn-primary:hover:not(:disabled) { opacity: 0.85; }
    .btn-danger {
      background: #fff;
      color: #DC2626;
      border-color: #FECACA;
    }
    .btn-danger:hover:not(:disabled) { background: #FEF2F2; }
    .controls-spacer { flex: 1; }
    .last-updated {
      font-size: 11px;
      color: #CCC;
    }

    /* --- Table --- */
    /* --- Launch/Join card --- */
    .launch-card {
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .launch-card-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.2px;
      margin-bottom: 16px;
    }
    .launch-fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 12px;
    }
    .launch-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .launch-field.full { grid-column: 1 / -1; }
    .launch-field label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
    }
    .launch-field label .opt {
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
      color: #CCC;
    }
    .launch-field input,
    .launch-field textarea {
      padding: 10px 14px;
      border: 1px solid #EBEBEB;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
      background: #fff;
      transition: border-color 0.2s;
    }
    .launch-field input:focus,
    .launch-field textarea:focus { outline: none; border-color: #999; }
    .launch-field textarea { resize: vertical; min-height: 60px; }
    .launch-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .launch-msg {
      font-size: 13px;
      font-weight: 500;
    }
    .launch-msg.success { color: #16A34A; }
    .launch-msg.error { color: #DC2626; }

    .table-card {
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 12px;
      overflow: hidden;
    }
    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid #EBEBEB;
    }
    .table-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }
    .table-count {
      font-size: 12px;
      color: #999;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    col.col-name { width: 22%; }
    col.col-status { width: 11%; }
    col.col-instance { width: 20%; }
    col.col-usage { width: 18%; }
    col.col-uptime { width: 10%; }
    col.col-actions { width: 19%; }
    th {
      text-align: left;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #999;
      padding: 10px 20px;
      border-bottom: 1px solid #F5F5F5;
      background: #FAFAFA;
    }
    td {
      font-size: 13px;
      padding: 12px 20px;
      border-bottom: 1px solid #F5F5F5;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr.crashed td { background: #FFF5F5; }
    td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-name-cell {
      font-weight: 600;
      letter-spacing: -0.2px;
    }
    .status-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .status-running { background: #D1FAE5; color: #065F46; }
    .status-crashed { background: #FEE2E2; color: #991B1B; }
    .status-idle { background: #DBEAFE; color: #1D4ED8; }
    .status-starting { background: #FEF3C7; color: #92400E; }
    tr.idle td, tr.starting td { color: #999; }
    tr.starting td { font-style: italic; }
    tr.starting .agent-name-cell { font-weight: 400; }
    tr.starting { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .instance-link {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 11px;
      color: #007AFF;
      text-decoration: none;
    }
    .instance-link:hover { text-decoration: underline; }
    .uptime {
      font-size: 12px;
      color: #999;
      font-variant-numeric: tabular-nums;
    }
    .action-btns {
      display: flex;
      gap: 6px;
    }
    .action-btn {
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 10px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid #EBEBEB;
      background: #fff;
      color: #666;
      transition: all 0.15s;
    }
    .action-btn:hover { background: #F5F5F5; border-color: #CCC; }
    .action-btn.kill { color: #DC2626; border-color: #FECACA; }
    .action-btn.kill:hover { background: #FEF2F2; }
    .action-btn.dismiss { color: #F59E0B; border-color: #FDE68A; }
    .action-btn.dismiss:hover { background: #FFFBEB; }
    .action-btn.drain { color: #2563EB; border-color: #BFDBFE; }
    .action-btn.drain:hover { background: #EFF6FF; }
    tr.destroying td { opacity: 0.4; }
    .empty-row {
      text-align: center;
      color: #CCC;
      padding: 40px 20px;
      font-size: 14px;
    }

    /* --- QR Modal --- */
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
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      padding: 24px;
      max-width: 320px;
      width: 100%;
      text-align: center;
    }
    .modal h3 {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .modal img {
      width: 100%;
      border-radius: 8px;
      display: block;
    }
    .modal .invite-url-row {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #F5F5F5;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .modal .invite-url-row:hover { background: #EBEBEB; }
    .modal .invite-url-text {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 11px;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .modal .copy-label {
      font-size: 11px;
      font-weight: 500;
      color: #007AFF;
      white-space: nowrap;
    }
    .modal .invite-url-row.copied { background: #D1FAE5; }
    .modal .invite-url-row.copied .invite-url-text { color: #065F46; }
    .modal .invite-url-row.copied .copy-label { color: #065F46; }

    .usage-bar-wrap {
      width: 100%;
      height: 4px;
      background: #F0F0F0;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .usage-bar {
      height: 100%;
      border-radius: 2px;
      background: #34C759;
      transition: width 0.3s;
    }
    .usage-bar.warn { background: #FF9500; }
    .usage-bar.danger { background: #DC2626; }
    .usage-cell {
      font-size: 11px;
      color: #666;
    }

    /* --- Row expand indicator --- */
    tr[data-expand] td:first-child::before {
      content: '\\25B8';
      color: #C0C0C0;
      font-size: 9px;
      margin-right: 6px;
      display: inline-block;
      transition: transform 0.15s ease;
    }
    tr[data-expand].expanded td:first-child::before {
      transform: rotate(90deg);
      color: #666;
    }
    tr[data-expand]:hover td { background: #FAFBFC; }

    /* --- Expand row (inline detail below agent) --- */
    .expand-row td {
      padding: 0 !important;
      border-bottom: 1px solid #EBEBEB;
      background: #F8F8FA;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.04);
    }
    .expand-inner {
      display: flex;
      align-items: stretch;
      padding: 0;
    }
    .expand-col {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .expand-col-left {
      flex: 0 0 50%;
      border-right: 1px solid #EBEBEB;
    }
    .expand-col-right {
      flex: 1;
    }
    .expand-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 16px;
      font-size: 11px;
      min-width: 0;
      border-right: 1px solid #EBEBEB;
    }
    .expand-col-left .expand-section { border-right: none; flex: none; }
    .expand-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 2px;
    }
    .expand-section-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #9CA3AF;
      white-space: nowrap;
    }
    .expand-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .expand-status-dot.active { background: #34C759; }
    .expand-status-dot.inactive { background: #DC2626; }
    .expand-kv-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .expand-kv {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #374151;
      white-space: nowrap;
      min-width: 0;
    }
    .expand-label {
      font-size: 10px;
      color: #B0B0B0;
      font-weight: 500;
    }
    .expand-link {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 10px;
      color: #007AFF;
      text-decoration: none;
    }
    .expand-link:hover { text-decoration: underline; }
    .expand-val {
      font-size: 11px;
      font-weight: 600;
      color: #111827;
    }
    .expand-val.mono {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 10px;
      font-weight: 500;
      color: #555;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .expand-val.active { color: #059669; }
    .expand-val.inactive { color: #DC2626; }
    .expand-bar-wrap {
      width: 100%;
      height: 3px;
      background: #F0F0F0;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 2px;
    }
    .expand-bar-wrap > div {
      height: 100%;
      border-radius: 2px;
      background: #34C759;
    }
    .expand-bar-wrap > div.warn { background: #FF9500; }
    .expand-bar-wrap > div.danger { background: #DC2626; }
    .expand-topup {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
    }
    .expand-topup input {
      width: 56px;
      padding: 2px 6px;
      font-size: 11px;
      font-family: inherit;
      border: 1px solid #E5E7EB;
      border-radius: 4px;
      text-align: center;
      background: #fff;
    }
    .expand-topup input:focus { outline: none; border-color: #999; }
    .expand-topup button {
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid #E5E7EB;
      background: #fff;
      color: #374151;
      transition: all 0.15s;
    }
    .expand-topup button:hover:not(:disabled) { background: #F5F5F5; border-color: #CCC; }
    .expand-topup button:disabled { opacity: 0.5; cursor: not-allowed; }
    .expand-topup .topup-msg {
      font-size: 10px;
      font-weight: 500;
    }
    .expand-topup .topup-msg.success { color: #059669; }
    .expand-topup .topup-msg.error { color: #DC2626; }
    .expand-empty {
      font-size: 11px;
      color: #9CA3AF;
      padding: 12px 16px;
    }
    .search-input {
      padding: 6px 12px;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid #EBEBEB;
      border-radius: 6px;
      background: #fff;
      min-width: 180px;
      transition: border-color 0.2s;
    }
    .search-input:focus { outline: none; border-color: #999; }

    /* --- Provision Log Panel --- */
    .provision-log {
      background: #fff;
      border: 1px solid #EBEBEB;
      border-radius: 12px;
      margin-bottom: 24px;
      overflow: hidden;
      display: none;
    }
    .provision-log.visible { display: block; }
    .provision-log-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid #EBEBEB;
      cursor: pointer;
      user-select: none;
    }
    .provision-log-header:hover { background: #FAFAFA; }
    .provision-log-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.2px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .provision-log-title .prov-count {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: #F5F5F5;
      color: #999;
    }
    .provision-log-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .provision-log-toggle {
      font-size: 11px;
      font-weight: 500;
      color: #999;
      background: none;
      border: none;
      cursor: pointer;
      font-family: inherit;
    }
    .provision-log-toggle:hover { color: #666; }
    .provision-log-close {
      font-size: 16px;
      line-height: 1;
      color: #CCC;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0 4px;
    }
    .provision-log-close:hover { color: #999; }
    .provision-log-body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .provision-log.collapsed .provision-log-body { display: none; }
    .provision-instance {
      background: #FAFAFA;
      border: 1px solid #F0F0F0;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .provision-instance-header {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: -0.2px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .provision-instance-header .prov-status {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .provision-instance-header .prov-status.in-progress { background: #FEF3C7; color: #92400E; }
    .provision-instance-header .prov-status.success { background: #D1FAE5; color: #065F46; }
    .provision-instance-header .prov-status.failed { background: #FEE2E2; color: #991B1B; }
    .prov-railway-link {
      font-size: 10px;
      font-weight: 600;
      color: #007AFF;
      text-decoration: none;
      padding: 1px 6px;
      border-radius: 4px;
      background: #EFF6FF;
      margin-left: auto;
    }
    .prov-railway-link:hover { text-decoration: underline; background: #DBEAFE; }
    .drain-inst-name { font-size: 10px; font-weight: 400; color: #999; }
    .provision-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .provision-step {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #999;
    }
    .provision-step.active { color: #92400E; font-weight: 500; }
    .provision-step.ok { color: #065F46; }
    .provision-step.fail { color: #991B1B; }
    .provision-step.skip { color: #999; }
    .provision-step-icon {
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 12px;
    }
    .provision-step.pending .provision-step-icon::after { content: '\\25CB'; color: #DDD; }
    .provision-step.active .provision-step-icon { animation: prov-spin 0.8s linear infinite; }
    .provision-step.active .provision-step-icon::after { content: '\\25E0'; color: #F59E0B; }
    .provision-step.ok .provision-step-icon::after { content: '\\2713'; color: #16A34A; font-weight: 700; }
    .provision-step.fail .provision-step-icon::after { content: '\\2717'; color: #DC2626; font-weight: 700; }
    .provision-step.skip .provision-step-icon::after { content: '\\2014'; color: #CCC; }
    @keyframes prov-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .provision-step-label { flex: 1; }
    .provision-step-msg {
      font-size: 11px;
      color: #999;
      font-style: italic;
    }

    /* --- Responsive --- */
    @media (max-width: 640px) {
      .stats, .stats-credits { grid-template-columns: repeat(2, 1fr); }
      .header { flex-wrap: wrap; gap: 8px; }
      .header-right { flex-wrap: wrap; }
      .controls { flex-wrap: wrap; }
      .content { padding: 16px; }
      th, td { padding: 10px 12px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">Pool Admin</span>
      <div class="env-switcher" onclick="this.classList.toggle('open')">
        <button class="env-switcher-btn env-${poolEnvironment}">${poolEnvironment}</button>
        <div class="env-dropdown">
          ${adminUrls.length ? adminUrls.map((e) =>
            e.env === poolEnvironment
              ? `<a class="current"><span class="env-dot ${e.env}"></span>${e.env}</a>`
              : `<a href="${e.url}/admin"><span class="env-dot ${e.env}"></span>${e.env}</a>`
          ).join("") : `<a class="current"><span class="env-dot ${poolEnvironment}"></span>${poolEnvironment}</a>`}
        </div>
      </div>
    </div>
    <div class="header-right">
      <span class="chip">model: ${instanceModel}</span>
      ${railwayLink ? `<span class="chip"><a href="${railwayLink}" target="_blank" rel="noopener">service: ${railwayServiceId.slice(0, 8)}</a></span>` : ""}
      ${railwayProjectLink ? `<span class="chip"><a href="${railwayProjectLink}" target="_blank" rel="noopener">Railway</a></span>` : ""}
      <form method="POST" action="/admin/logout" style="display:inline">
        <button class="logout-btn" type="submit">Logout</button>
      </form>
    </div>
  </div>

  <div class="content">
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label"><span class="stat-dot green"></span> Ready</div>
        <div class="stat-value" id="s-idle">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><span class="stat-dot orange"></span> Starting</div>
        <div class="stat-value" id="s-starting">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><span class="stat-dot blue"></span> Claimed</div>
        <div class="stat-value" id="s-claimed">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label"><span class="stat-dot red"></span> Crashed</div>
        <div class="stat-value" id="s-crashed">-</div>
      </div>
    </div>
    <div class="stats-credits">
      <div class="stat-card">
        <div class="stat-label">Credits</div>
        <div class="stat-value" id="s-credits">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">OR Keys</div>
        <div class="stat-value" id="s-or-keys">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Inboxes</div>
        <div class="stat-value" id="s-inboxes">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Phones</div>
        <div class="stat-value" id="s-phones">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Templates</div>
        <div class="stat-value" id="s-templates">-</div>
      </div>
    </div>

    <div class="controls">
      <div class="control-group">
        <label>Max parallel</label>
        <select class="control-input" id="max-parallel">
          <option value="5" selected>5</option>
          <option value="10">10</option>
        </select>
      </div>
      <div class="control-group">
        <label>Replenish</label>
        <input class="control-input" id="replenish-count" type="number" min="1" max="20" value="1" />
        <button class="btn btn-primary" id="replenish-btn">+ Add</button>
      </div>
      <div class="control-group">
        <label>Drain unclaimed</label>
        <button class="btn btn-danger" id="drain-btn">Drain</button>
      </div>
      <div class="controls-spacer"></div>
      <span class="last-updated" id="last-updated"></span>
    </div>

    <div class="provision-log" id="provision-log">
      <div class="provision-log-header" onclick="toggleProvisionLog()">
        <span class="provision-log-title">Provisioning <span class="prov-count" id="prov-count">0/0</span></span>
        <div class="provision-log-actions">
          <button class="provision-log-toggle" id="prov-toggle">Collapse</button>
          <button class="provision-log-close" onclick="event.stopPropagation(); closeProvisionLog()">&times;</button>
        </div>
      </div>
      <div class="provision-log-body" id="provision-log-body"></div>
    </div>

    <div class="provision-log" id="drain-log">
      <div class="provision-log-header" onclick="toggleDrainLog()">
        <span class="provision-log-title">Draining <span class="prov-count" id="drain-count">0/0</span></span>
        <div class="provision-log-actions">
          <button class="provision-log-toggle" id="drain-toggle">Collapse</button>
          <button class="provision-log-close" onclick="event.stopPropagation(); closeDrainLog()">&times;</button>
        </div>
      </div>
      <div class="provision-log-body" id="drain-log-body"></div>
    </div>

    <div class="launch-card">
      <div class="launch-card-title">Launch / Join</div>
      <div class="launch-fields">
        <div class="launch-field">
          <label>Invite URL <span class="opt">(paste to join existing convo)</span></label>
          <input id="launch-url" placeholder="${poolEnvironment === "production" ? "popup.convos.org/..." : "dev.convos.org/..."}" />
        </div>
        <div class="launch-field">
          <label>Name <span class="opt">(optional when joining)</span></label>
          <input id="launch-name" placeholder="Assistant" />
        </div>
        <div class="launch-field full">
          <label>Instructions <span class="opt">(optional when joining)</span></label>
          <textarea id="launch-instructions" placeholder="You are a helpful AI assistant."></textarea>
        </div>
      </div>
      <div class="launch-actions">
        <button class="btn btn-primary" id="launch-btn">Launch</button>
        <span class="launch-msg" id="launch-msg"></span>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <div>
          <span class="table-title">Agents</span>
          <span class="table-count" id="table-count"></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <input class="search-input" id="search-input" type="text" placeholder="Search instances..." />
          <div class="filter-pills" id="filter-pills">
            <button class="filter-pill active" data-filter="">All <span class="pill-count">-</span></button>
            <button class="filter-pill" data-filter="running">Running <span class="pill-count">-</span></button>
            <button class="filter-pill" data-filter="idle">Ready <span class="pill-count">-</span></button>
            <button class="filter-pill" data-filter="starting">Starting <span class="pill-count">-</span></button>
            <button class="filter-pill" data-filter="crashed">Crashed <span class="pill-count">-</span></button>
          </div>
        </div>
      </div>
      <table>
          <colgroup>
            <col class="col-name">
            <col class="col-status">
            <col class="col-instance">
            <col class="col-usage">
            <col class="col-uptime">
            <col class="col-actions">
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Instance</th>
              <th>Usage</th>
              <th>Uptime</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="agents-body">
            <tr><td class="empty-row" colspan="6">Loading...</td></tr>
          </tbody>
        </table>
    </div>

  </div>

  <!-- QR Modal -->
  <div class="modal-overlay" id="qr-modal">
    <div class="modal">
      <h3 id="modal-title"></h3>
      <img id="modal-qr" src="" alt="QR Code" />
      <div class="invite-url-row" id="invite-row">
        <span class="invite-url-text" id="modal-invite"></span>
        <span class="copy-label" id="copy-label">Copy</span>
      </div>
    </div>
  </div>

  <script>
    var POOL_ENV = ${JSON.stringify(poolEnvironment)};
    var BANKR_KEY = ${JSON.stringify(bankrConfigured)};
    var INSTANCE_MODEL = ${JSON.stringify(instanceModel)};
    var authHeaders = { 'Content-Type': 'application/json' };

    var claimedCache = [], crashedCache = [], idleCache = [], startingCache = [];
    var svcKeyMap = {}; // keyed by key name e.g. 'convos-agent-xxxxx'
    var svcToolsMap = {}; // keyed by instance_id → tools array from instance_services
    var infraMap = {}; // keyed by instance_id → infra row from instance_infra
    var statusFilter = null; // null = show all, 'idle' | 'starting' | 'running' | 'crashed'
    var searchQuery = '';
    var searchTimer = null;
    var expandedInstanceId = null; // track currently expanded row

    function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    // --- Search input (debounced) ---
    document.getElementById('search-input').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        searchQuery = e.target.value.trim().toLowerCase();
        renderAgents();
      }, 200);
    });

    // --- Filter pills ---
    document.getElementById('filter-pills').addEventListener('click', function (e) {
      var pill = e.target.closest('.filter-pill');
      if (!pill) return;
      statusFilter = pill.getAttribute('data-filter') || null;
      document.querySelectorAll('.filter-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      renderAgents();
    });

    function timeAgo(dateStr) {
      if (!dateStr) return '';
      var ms = Date.now() - new Date(dateStr).getTime();
      var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
      if (d > 0) return d + 'd ' + h % 24 + 'h';
      if (h > 0) return h + 'h ' + m % 60 + 'm';
      if (m > 0) return m + 'm';
      return '<1m';
    }

    function railwayUrl(serviceId, instanceId) {
      if (!serviceId) return null;
      var infra = instanceId ? (infraMap[instanceId] || {}) : {};
      var projectId = infra.provider_project_id;
      if (!projectId) return null;
      var envId = infra.provider_env_id;
      return 'https://railway.com/project/' + projectId + '/service/' + serviceId + (envId ? '?environmentId=' + envId : '');
    }

    // --- Refresh counts ---
    async function refreshCounts() {
      try {
        var res = await fetch('/api/pool/counts');
        var c = await res.json();
        document.getElementById('s-idle').textContent = c.idle;
        document.getElementById('s-starting').textContent = c.starting;
        document.getElementById('s-claimed').textContent = c.claimed;
        document.getElementById('s-crashed').textContent = c.crashed;
        document.getElementById('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
      } catch (e) {}
    }

    // --- Refresh agents ---
    async function refreshAgents() {
      try {
        var res = await fetch('/api/pool/agents');
        var data = await res.json();
        claimedCache = (data.claimed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
        crashedCache = (data.crashed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
        idleCache = (data.idle || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        startingCache = (data.starting || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        renderAgents();
      } catch (e) {}
    }

    function updatePillCounts() {
      var total = claimedCache.length + crashedCache.length + idleCache.length + startingCache.length;
      var counts = { '': total, running: claimedCache.length, idle: idleCache.length, starting: startingCache.length, crashed: crashedCache.length };
      document.querySelectorAll('.filter-pill').forEach(function (pill) {
        var f = pill.getAttribute('data-filter');
        var span = pill.querySelector('.pill-count');
        if (span) span.textContent = counts[f] || 0;
      });
    }

    function renderAgents() {
      var body = document.getElementById('agents-body');
      var count = document.getElementById('table-count');
      var all = crashedCache.concat(claimedCache).concat(idleCache).concat(startingCache);
      updatePillCounts();
      count.textContent = '';

      // Apply filter
      var showCrashed = !statusFilter || statusFilter === 'crashed';
      var showClaimed = !statusFilter || statusFilter === 'running';
      var showIdle = !statusFilter || statusFilter === 'idle';
      var showStarting = !statusFilter || statusFilter === 'starting';
      var filtered = (showCrashed ? crashedCache : [])
        .concat(showClaimed ? claimedCache : [])
        .concat(showIdle ? idleCache : [])
        .concat(showStarting ? startingCache : []);

      // Apply search filter
      if (searchQuery) {
        filtered = filtered.filter(function (a) {
          var text = ((a.agentName || '') + ' ' + (a.name || '') + ' ' + (a.id || '')).toLowerCase();
          return text.indexOf(searchQuery) !== -1;
        });
      }

      if (!all.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="6">No instances</td></tr>';
        return;
      }
      if (!filtered.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="6">No matching instances</td></tr>';
        return;
      }

      var html = '';
      function renderRow(a, status, badge, actions) {
        var isKilling = !!killingSet[a.id];
        var rUrl = railwayUrl(a.serviceId, a.id);
        var key = svcKeyMap['convos-agent-' + a.id];
        var usageCell = '';
        if (key) {
          var usage = key.usage || 0;
          var limit = key.limit || 0;
          var pct = limit > 0 ? Math.min(100, (usage / limit) * 100) : 0;
          var barClass = pct > 90 ? 'danger' : pct > 70 ? 'warn' : '';
          usageCell = '<td class="usage-cell">'
            + fmtDollars(usage) + ' / ' + fmtDollars(limit)
            + '<div class="usage-bar-wrap"><div class="usage-bar ' + barClass + '" style="width:' + pct + '%"></div></div></td>';
        } else {
          usageCell = '<td class="usage-cell" style="color:#CCC">-</td>';
        }
        var rowClass = status + (isKilling ? ' destroying' : '');
        var rowBadge = isKilling ? '<span class="status-badge" style="background:#FEE2E2;color:#991B1B">Destroying...</span>' : '<span class="status-badge status-' + status + '">' + badge + '</span>';
        var rowActions = isKilling ? '<span style="font-size:11px;color:#999">Destroying...</span>' : actions;
        html += '<tr class="' + rowClass + '" id="row-' + a.id + '" data-expand="' + a.id + '" style="cursor:pointer">'
          + '<td class="agent-name-cell">' + esc(a.agentName || a.name || a.id) + '</td>'
          + '<td>' + rowBadge + '</td>'
          + '<td>' + (rUrl ? '<a class="instance-link" href="' + rUrl + '" target="_blank">' + esc(a.id) + '</a>' : esc(a.id)) + '</td>'
          + usageCell
          + '<td class="uptime">' + timeAgo(a.claimedAt || a.createdAt) + '</td>'
          + '<td><div class="action-btns">' + rowActions + '</div></td></tr>';
      }

      filtered.forEach(function (a) {
        var isCrashed = crashedCache.indexOf(a) !== -1;
        var isClaimed = claimedCache.indexOf(a) !== -1;
        var isIdle = idleCache.indexOf(a) !== -1;
        if (isCrashed) {
          renderRow(a, 'crashed', 'Crashed',
            '<button class="action-btn" data-qr="' + a.id + '">QR</button>'
            + '<button class="action-btn dismiss" data-dismiss="' + a.id + '">Dismiss</button>');
        } else if (isClaimed) {
          renderRow(a, 'running', 'Running',
            '<button class="action-btn" data-qr="' + a.id + '">QR</button>'
            + '<button class="action-btn kill" data-kill="' + a.id + '">Kill</button>');
        } else if (isIdle) {
          renderRow(a, 'idle', 'Ready',
            '<button class="action-btn kill" data-kill="' + a.id + '">Kill</button>');
        } else {
          renderRow(a, 'starting', 'Starting',
            '<button class="action-btn kill" data-kill="' + a.id + '">Kill</button>');
        }
      });
      body.innerHTML = html;
      // Re-expand previously open row
      if (expandedInstanceId) toggleExpand(expandedInstanceId, true);
    }

    // --- Actions ---
    document.getElementById('agents-body').addEventListener('click', function (e) {
      var qrId = e.target.getAttribute('data-qr');
      if (qrId) {
        var a = claimedCache.concat(crashedCache).find(function (x) { return x.id === qrId; });
        if (a) showQr(a.agentName || a.id, a.inviteUrl || '');
        return;
      }
      var killId = e.target.getAttribute('data-kill');
      if (killId) { killAgent(killId); return; }
      var dismissId = e.target.getAttribute('data-dismiss');
      if (dismissId) { dismissAgent(dismissId); return; }

      // Row click → toggle expand row (ignore if clicking a button/link)
      if (e.target.closest('button') || e.target.closest('a')) return;
      var expandRow = e.target.closest('[data-expand]');
      if (expandRow) {
        toggleExpand(expandRow.getAttribute('data-expand'));
      }
    });

    var killingSet = {};

    function markDestroying(id) {
      var row = document.getElementById('row-' + id);
      if (row) row.classList.add('destroying');
      // Disable all buttons in this row
      if (row) row.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      // Also collapse expand row
      var expand = document.getElementById('expand-' + id);
      if (expand) expand.remove();
    }

    async function killAgent(id) {
      if (killingSet[id]) return;
      var row = document.getElementById('row-' + id);
      var name = row ? row.querySelector('.agent-name-cell').textContent.trim() : id;
      var msg = (POOL_ENV === 'production' ? '[PRODUCTION] ' : '') + 'Kill "' + name + '"? This deletes the Railway service.';
      if (!confirm(msg)) return;
      killingSet[id] = true;
      markDestroying(id);
      try {
        var res = await fetch('/api/pool/instances/' + id, { method: 'DELETE', headers: authHeaders });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Kill failed');
        refreshCounts();
        refreshAgents();
      } catch (err) {
        alert('Failed to kill: ' + err.message);
        var r = document.getElementById('row-' + id);
        if (r) r.classList.remove('destroying');
        if (r) r.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      } finally {
        delete killingSet[id];
      }
    }

    async function drainAgent(id) {
      var a = idleCache.concat(startingCache).find(function (x) { return x.id === id; });
      var name = a ? (a.agentName || a.name || a.id) : id;
      var msg = (POOL_ENV === 'production' ? '[PRODUCTION] ' : '') + 'Drain "' + name + '"? This deletes the Railway service.';
      if (!confirm(msg)) return;
      markDestroying(id);
      try {
        var res = await fetch('/api/pool/instances/' + id, { method: 'DELETE', headers: authHeaders });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Drain failed');
        refreshCounts();
        refreshAgents();
      } catch (err) {
        alert('Failed to drain: ' + err.message);
        var r = document.getElementById('row-' + id);
        if (r) r.classList.remove('destroying');
      }
    }

    async function dismissAgent(id) {
      var a = crashedCache.find(function (x) { return x.id === id; });
      var name = a ? (a.agentName || a.id) : id;
      var msg = (POOL_ENV === 'production' ? '[PRODUCTION] ' : '') + 'Dismiss crashed "' + name + '"?';
      if (!confirm(msg)) return;
      markDestroying(id);
      try {
        var res = await fetch('/api/pool/crashed/' + id, { method: 'DELETE', headers: authHeaders });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Dismiss failed');
        refreshCounts();
        refreshAgents();
      } catch (err) {
        alert('Failed to dismiss: ' + err.message);
        var r = document.getElementById('row-' + id);
        if (r) r.classList.remove('destroying');
      }
    }

    // --- Provision log helpers ---
    var PROV_STEPS = [
      { key: 'openrouter', label: 'OpenRouter key' },
      { key: 'agentmail', label: 'AgentMail inbox' },
      { key: 'telnyx', label: 'Telnyx phone' },
      { key: 'railway-project', label: 'Railway project' },
      { key: 'railway-service', label: 'Railway service + volume' },
      { key: 'railway-domain', label: 'Railway domain' },
      { key: 'deploy', label: 'Deploy + health check' },
    ];

    var provisionTotal = 0;
    var provisionDone = 0;

    function showProvisionLog(count) {
      provisionTotal = count;
      provisionDone = 0;
      var panel = document.getElementById('provision-log');
      var body = document.getElementById('provision-log-body');
      body.innerHTML = '';
      panel.classList.add('visible');
      panel.classList.remove('collapsed');
      document.getElementById('prov-toggle').textContent = 'Collapse';
      document.getElementById('prov-count').textContent = '0/' + count;

      for (var i = 1; i <= count; i++) {
        var card = document.createElement('div');
        card.className = 'provision-instance';
        card.id = 'prov-inst-' + i;
        var stepsHtml = '';
        PROV_STEPS.forEach(function (s) {
          stepsHtml += '<div class="provision-step pending" id="prov-step-' + i + '-' + s.key + '">'
            + '<span class="provision-step-icon"></span>'
            + '<span class="provision-step-label">' + s.label + '</span>'
            + '<span class="provision-step-msg"></span>'
            + '</div>';
        });
        card.innerHTML = '<div class="provision-instance-header">Instance ' + i
          + ' <span class="prov-status in-progress" id="prov-inst-status-' + i + '">Pending</span></div>'
          + '<div class="provision-steps">' + stepsHtml + '</div>';
        body.appendChild(card);
      }
    }

    function updateProvisionStep(instanceNum, step, status, message) {
      var el = document.getElementById('prov-step-' + instanceNum + '-' + step);
      if (!el) return;
      el.className = 'provision-step ' + status;
      var msgEl = el.querySelector('.provision-step-msg');
      if (msgEl && message && step !== 'railway-project') msgEl.textContent = message;

      // When railway-project succeeds, message contains the projectId — add deeplink to instance header
      if (step === 'railway-project' && status === 'ok' && message) {
        var header = document.querySelector('#prov-inst-' + instanceNum + ' .provision-instance-header');
        if (header && !header.querySelector('.prov-railway-link')) {
          var link = document.createElement('a');
          link.className = 'prov-railway-link';
          link.href = 'https://railway.com/project/' + message;
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = 'Railway';
          header.appendChild(link);
        }
      }
    }

    // Map instanceNum → instanceId for deploy polling
    var provisionInstanceIds = {};

    function markProvisionInstance(instanceNum, success, instanceId) {
      if (!success) {
        provisionDone++;
        document.getElementById('prov-count').textContent = provisionDone + '/' + provisionTotal;
        var statusEl = document.getElementById('prov-inst-status-' + instanceNum);
        if (statusEl) {
          statusEl.className = 'prov-status failed';
          statusEl.textContent = 'Failed';
        }
        return;
      }
      // Infra created — start deploy polling
      updateProvisionStep(instanceNum, 'deploy', 'active', 'Building...');
      var statusEl2 = document.getElementById('prov-inst-status-' + instanceNum);
      if (statusEl2) {
        statusEl2.className = 'prov-status in-progress';
        statusEl2.textContent = 'Deploying';
      }
      if (instanceId) provisionInstanceIds[instanceNum] = instanceId;
    }

    function markProvisionDeploy(instanceNum, status, message) {
      provisionDone++;
      document.getElementById('prov-count').textContent = provisionDone + '/' + provisionTotal;
      updateProvisionStep(instanceNum, 'deploy', status, message || '');
      var statusEl = document.getElementById('prov-inst-status-' + instanceNum);
      if (statusEl) {
        if (status === 'ok') {
          statusEl.className = 'prov-status success';
          statusEl.textContent = 'Ready';
        } else {
          statusEl.className = 'prov-status failed';
          statusEl.textContent = 'Deploy failed';
        }
      }
    }

    function pollDeployStatus() {
      var pending = Object.keys(provisionInstanceIds);
      if (pending.length === 0) return;

      var pollInterval = setInterval(async function () {
        try {
          var res = await fetch('/api/pool/agents');
          var data = await res.json();
          var allInstances = [].concat(data.idle || [], data.claimed || [], data.crashed || [], data.starting || []);

          var remaining = 0;
          pending.forEach(function (num) {
            var id = provisionInstanceIds[num];
            if (!id) return;
            var inst = allInstances.find(function (a) { return a.id === id; });
            if (!inst) { remaining++; return; }

            if (inst.status === 'idle') {
              markProvisionDeploy(num, 'ok', 'Ready');
              delete provisionInstanceIds[num];
            } else if (inst.status === 'crashed' || inst.status === 'dead') {
              markProvisionDeploy(num, 'fail', 'Deploy crashed');
              delete provisionInstanceIds[num];
            } else {
              remaining++;
            }
          });

          // Refresh the agents table while we wait
          claimedCache = (data.claimed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
          crashedCache = (data.crashed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
          idleCache = (data.idle || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
          startingCache = (data.starting || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
          renderAgents();
          refreshCounts();

          if (remaining === 0) clearInterval(pollInterval);
        } catch (e) {}
      }, 10000); // poll every 10s
    }

    function toggleProvisionLog() {
      var panel = document.getElementById('provision-log');
      panel.classList.toggle('collapsed');
      document.getElementById('prov-toggle').textContent = panel.classList.contains('collapsed') ? 'Expand' : 'Collapse';
    }

    function closeProvisionLog() {
      var panel = document.getElementById('provision-log');
      panel.classList.remove('visible');
    }

    // --- Replenish (SSE streaming) ---
    document.getElementById('replenish-btn').addEventListener('click', function () {
      var btn = this;
      var n = parseInt(document.getElementById('replenish-count').value) || 1;
      var parallel = parseInt(document.getElementById('max-parallel').value) || 5;
      btn.disabled = true; btn.textContent = 'Adding...';
      showProvisionLog(n);

      var lastInstanceId = {};
      var es = new EventSource('/api/pool/replenish/stream?count=' + n + '&concurrency=' + parallel);
      es.onmessage = function (ev) {
        try {
          var data = JSON.parse(ev.data);

          if (data.type === 'step') {
            if (data.step === 'done') {
              markProvisionInstance(data.instanceNum, true, lastInstanceId[data.instanceNum]);
            } else if (data.step === 'error') {
              markProvisionInstance(data.instanceNum, false);
            } else {
              updateProvisionStep(data.instanceNum, data.step, data.status, data.message);
            }
          } else if (data.type === 'instance') {
            var inst = data.instance;
            if (inst) {
              lastInstanceId[data.instanceNum] = inst.id;
              var exists = startingCache.some(function (a) { return a.id === inst.id; });
              if (!exists) {
                startingCache.unshift({
                  id: inst.id,
                  name: inst.name,
                  url: inst.url,
                  serviceId: inst.serviceId,
                  status: 'starting',
                  createdAt: new Date().toISOString(),
                });
                renderAgents();
              }
            }
          } else if (data.type === 'complete') {
            es.close();
            btn.disabled = false;
            btn.textContent = '+ Add';
            refreshCounts();
            refreshCredits();
            refreshInstances();
            // Start polling for deploy completion
            pollDeployStatus();
          }
        } catch (e) {}
      };
      es.onerror = function () {
        es.close();
        btn.disabled = false;
        btn.textContent = '+ Add';
        refreshCounts();
        refreshCredits();
        refreshInstances();
        pollDeployStatus();
      };
    });

    // --- Drain log helpers ---
    var DRAIN_STEPS = [
      { key: 'openrouter', label: 'OpenRouter key' },
      { key: 'agentmail', label: 'AgentMail inbox' },
      { key: 'telnyx', label: 'Telnyx phone' },
      { key: 'railway', label: 'Railway project' },
      { key: 'db', label: 'DB cleanup' },
    ];

    var drainTotal = 0;
    var drainDone = 0;

    function showDrainLog(count) {
      drainTotal = count;
      drainDone = 0;
      var panel = document.getElementById('drain-log');
      var body = document.getElementById('drain-log-body');
      body.innerHTML = '';
      panel.classList.add('visible');
      panel.classList.remove('collapsed');
      document.getElementById('drain-toggle').textContent = 'Collapse';
      document.getElementById('drain-count').textContent = '0/' + count;

      for (var i = 1; i <= count; i++) {
        var card = document.createElement('div');
        card.className = 'provision-instance';
        card.id = 'drain-inst-' + i;
        var stepsHtml = '';
        DRAIN_STEPS.forEach(function (s) {
          stepsHtml += '<div class="provision-step pending" id="drain-step-' + i + '-' + s.key + '">'
            + '<span class="provision-step-icon"></span>'
            + '<span class="provision-step-label">' + s.label + '</span>'
            + '<span class="provision-step-msg"></span>'
            + '</div>';
        });
        card.innerHTML = '<div class="provision-instance-header">Instance ' + i
          + ' <span class="prov-status in-progress" id="drain-inst-status-' + i + '">Pending</span>'
          + ' <span class="drain-inst-name" id="drain-inst-name-' + i + '"></span></div>'
          + '<div class="provision-steps">' + stepsHtml + '</div>';
        body.appendChild(card);
      }
    }

    function updateDrainStep(instanceNum, step, status, message) {
      var el = document.getElementById('drain-step-' + instanceNum + '-' + step);
      if (!el) return;
      el.className = 'provision-step ' + status;
      var msgEl = el.querySelector('.provision-step-msg');
      if (msgEl && message) msgEl.textContent = message;
    }

    function updateDrainInstanceName(instanceNum, name) {
      var el = document.getElementById('drain-inst-name-' + instanceNum);
      if (el && !el.textContent) el.textContent = '(' + name + ')';
    }

    function markDrainInstance(instanceNum, success) {
      drainDone++;
      document.getElementById('drain-count').textContent = drainDone + '/' + drainTotal;
      var statusEl = document.getElementById('drain-inst-status-' + instanceNum);
      if (statusEl) {
        statusEl.className = 'prov-status ' + (success ? 'success' : 'failed');
        statusEl.textContent = success ? 'Done' : 'Failed';
      }
    }

    function toggleDrainLog() {
      var panel = document.getElementById('drain-log');
      panel.classList.toggle('collapsed');
      document.getElementById('drain-toggle').textContent = panel.classList.contains('collapsed') ? 'Expand' : 'Collapse';
    }

    function closeDrainLog() {
      var panel = document.getElementById('drain-log');
      panel.classList.remove('visible');
    }

    // --- Drain (SSE streaming) ---
    document.getElementById('drain-btn').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      var n = 0;
      try {
        var cr = await fetch('/api/pool/counts');
        var c = await cr.json();
        n = Math.min((c.idle || 0) + (c.starting || 0), 20);
      } catch (e) {}
      btn.disabled = false;
      if (n === 0) { alert('No unclaimed instances to drain.'); return; }
      var msg = (POOL_ENV === 'production' ? '[PRODUCTION] ' : '') + 'Drain ' + n + ' unclaimed instance(s)?';
      if (!confirm(msg)) return;
      btn.disabled = true; btn.textContent = 'Draining...';
      // Mark all unclaimed rows as destroying
      idleCache.concat(startingCache).forEach(function (a) { killingSet[a.id] = true; });
      renderAgents();
      showDrainLog(n);

      var drainParallel = parseInt(document.getElementById('max-parallel').value) || 5;
      var es = new EventSource('/api/pool/drain/stream?count=' + n + '&concurrency=' + drainParallel);
      es.onmessage = function (ev) {
        try {
          var data = JSON.parse(ev.data);

          if (data.type === 'step') {
            updateDrainInstanceName(data.instanceNum, data.instanceName || data.instanceId);
            if (data.step === 'done') {
              markDrainInstance(data.instanceNum, true);
            } else if (data.step === 'error') {
              markDrainInstance(data.instanceNum, false);
            } else if (data.step === 'skip') {
              markDrainInstance(data.instanceNum, true);
              var statusEl = document.getElementById('drain-inst-status-' + data.instanceNum);
              if (statusEl) { statusEl.className = 'prov-status'; statusEl.textContent = 'Skipped'; }
            } else {
              updateDrainStep(data.instanceNum, data.step, data.status, data.message);
            }
          } else if (data.type === 'complete') {
            es.close();
            btn.disabled = false;
            btn.textContent = 'Drain';
            // Clear killing state
            (data.drainedIds || []).forEach(function (id) { delete killingSet[id]; });
            idleCache.concat(startingCache).forEach(function (a) { delete killingSet[a.id]; });
            refreshCounts();
            refreshAgents();
          }
        } catch (e) {}
      };
      es.onerror = function () {
        es.close();
        btn.disabled = false;
        btn.textContent = 'Drain';
        idleCache.concat(startingCache).forEach(function (a) { delete killingSet[a.id]; });
        refreshCounts();
        refreshAgents();
      };
    });

    // --- QR Modal ---
    var modal = document.getElementById('qr-modal');
    var currentInviteUrl = '';

    function showQr(name, url) {
      document.getElementById('modal-title').textContent = name;
      document.getElementById('modal-qr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(url);
      document.getElementById('modal-invite').textContent = url;
      document.getElementById('copy-label').textContent = 'Copy';
      document.getElementById('invite-row').classList.remove('copied');
      currentInviteUrl = url;
      modal.classList.add('active');
    }

    document.getElementById('invite-row').addEventListener('click', function () {
      var row = this;
      navigator.clipboard.writeText(currentInviteUrl).then(function () {
        row.classList.add('copied');
        document.getElementById('copy-label').textContent = 'Copied!';
        setTimeout(function () {
          row.classList.remove('copied');
          document.getElementById('copy-label').textContent = 'Copy';
        }, 1500);
      });
    });

    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('active'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') modal.classList.remove('active'); });

    // --- Launch / Join ---
    var launchBtn = document.getElementById('launch-btn');
    var launchUrl = document.getElementById('launch-url');
    var launchName = document.getElementById('launch-name');
    var launchInstructions = document.getElementById('launch-instructions');
    var launchMsg = document.getElementById('launch-msg');

    function updateLaunchBtn() {
      launchBtn.textContent = launchUrl.value.trim() ? 'Join' : 'Launch';
    }
    launchUrl.addEventListener('input', updateLaunchBtn);

    launchBtn.addEventListener('click', async function () {
      var url = launchUrl.value.trim();
      var name = launchName.value.trim();
      var instructions = launchInstructions.value.trim();
      var payload = {};
      if (url) payload.joinUrl = url;
      if (name) payload.agentName = name;
      if (instructions) payload.instructions = instructions;

      launchBtn.disabled = true;
      launchBtn.textContent = url ? 'Joining...' : 'Launching...';
      launchMsg.textContent = '';

      try {
        var res = await fetch('/api/pool/claim', { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        if (data.joined) {
          launchMsg.className = 'launch-msg success';
          launchMsg.textContent = (name || 'Assistant') + ' joined the conversation';
        } else if (data.inviteUrl) {
          showQr(name || data.agentName || 'Assistant', data.inviteUrl);
          launchMsg.className = 'launch-msg success';
          launchMsg.textContent = 'Launched — invite URL ready';
        }
        launchUrl.value = '';
        refreshCounts();
        refreshAgents();
      } catch (err) {
        launchMsg.className = 'launch-msg error';
        launchMsg.textContent = err.message;
      } finally {
        launchBtn.disabled = false;
        updateLaunchBtn();
      }
    });

    // --- Templates count (one-time, static data) ---
    fetch('/api/pool/templates').then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById('s-templates').textContent = Array.isArray(d) ? d.length : '-';
    }).catch(function () {});

    // --- OR Keys count ---
    function refreshORKeys() {
      fetch('/dashboard/keys/count', { headers: authHeaders }).then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('s-or-keys').textContent = d.count != null ? d.count : '-';
      }).catch(function () {});
    }

    // --- Inboxes count ---
    function refreshInboxes() {
      fetch('/dashboard/inboxes', { headers: authHeaders }).then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('s-inboxes').textContent = d.count != null ? d.count : '-';
      }).catch(function () {});
    }

    // --- Phones count ---
    function refreshPhones() {
      fetch('/dashboard/phones', { headers: authHeaders }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.total != null) {
          document.getElementById('s-phones').innerHTML = d.total + '<div style="font-size:0.5em;opacity:0.6;margin-top:2px">' + (d.available || 0) + ' free</div>';
        } else {
          document.getElementById('s-phones').textContent = '-';
        }
      }).catch(function () {});
    }

    // --- Credits ---
    function fmtDollars(n) {
      if (n == null) return '-';
      return '$' + Math.round(Number(n));
    }

    async function refreshCredits() {
      try {
        var res = await fetch('/dashboard/credits', { headers: authHeaders });
        var data = await res.json();
        var credits = data.credits || {};
        var keys = data.keys || [];

        // Build lookup map
        svcKeyMap = {};
        keys.forEach(function (k) { if (k.name) svcKeyMap[k.name] = k; });

        var total = credits.totalCredits || 0;
        var used = credits.totalUsage || 0;
        var remaining = total - used;
        document.getElementById('s-credits').innerHTML = fmtDollars(remaining) + '<div style="font-size:0.5em;opacity:0.6;margin-top:2px">' + fmtDollars(used) + ' used</div>';

        // Re-render agents table so usage column picks up fresh data
        renderAgents();
      } catch (e) {
        document.getElementById('s-credits').textContent = '-';
      }
    }

    async function refreshInstances() {
      try {
        var res = await fetch('/dashboard/instances', { headers: authHeaders });
        var data = await res.json();
        svcToolsMap = {};
        infraMap = {};
        (Array.isArray(data) ? data : []).forEach(function (inst) {
          if (inst.instance_id) {
            if (Array.isArray(inst.tools)) svcToolsMap[inst.instance_id] = inst.tools;
            infraMap[inst.instance_id] = inst;
          }
        });
      } catch (e) {}
    }

    // --- Expand row (inline details below agent) ---
    function toggleExpand(instanceId, force) {
      var existing = document.getElementById('expand-' + instanceId);
      if (existing && !force) {
        existing.remove();
        var prev = document.getElementById('row-' + instanceId);
        if (prev) prev.classList.remove('expanded');
        expandedInstanceId = null;
        return;
      }
      if (existing) existing.remove();

      // Close any other open expand row
      document.querySelectorAll('.expand-row').forEach(function (r) { r.remove(); });
      document.querySelectorAll('tr.expanded').forEach(function (r) { r.classList.remove('expanded'); });

      var tools = svcToolsMap[instanceId] || [];
      var key = svcKeyMap['convos-agent-' + instanceId];
      var infra = infraMap[instanceId] || {};
      var agent = claimedCache.concat(crashedCache).concat(idleCache).concat(startingCache).find(function (a) { return a.id === instanceId; });

      var html = '<td colspan="6"><div class="expand-inner">';
      var mailTool = tools.find(function (t) { return t.tool_id === 'agentmail'; });
      var telnyxTool = tools.find(function (t) { return t.tool_id === 'telnyx'; });
      var hasSections = key || mailTool || telnyxTool;

      // LEFT COLUMN — Instance + AgentMail (50%)
      var instanceUrl = (agent && agent.url) || infra.url || '';
      html += '<div class="expand-col expand-col-left">';
      html += '<div class="expand-section">'
        + '<div class="expand-section-header"><span class="expand-section-title">Instance</span>'
        + (instanceUrl ? '<span class="expand-status-dot active"></span>' : '<span class="expand-status-dot inactive"></span>') + '</div>'
        + (instanceUrl ? '<div class="expand-kv"><span class="expand-label">URL</span> <a class="expand-link" href="' + esc(instanceUrl) + '" target="_blank" rel="noopener">' + esc(instanceUrl.replace(/^https?:\\/\\//, '')) + '</a></div>' : '')
        + '<div class="expand-kv"><span class="expand-label">Model</span> <span class="expand-val mono">' + esc(INSTANCE_MODEL) + '</span></div>'
        + (infra.runtime_image ? '<div class="expand-kv"><span class="expand-label">Image</span> <span class="expand-val mono">' + esc(infra.runtime_image.split('/').pop() || infra.runtime_image) + '</span></div>' : '')
        + (infra.provider_service_id ? '<div class="expand-kv"><span class="expand-label">Railway</span> '
          + (railwayUrl(infra.provider_service_id, instanceId)
            ? '<a class="expand-link" href="' + railwayUrl(infra.provider_service_id, instanceId) + '" target="_blank" rel="noopener">convos-agent-' + esc(instanceId) + '</a>'
            : '<span class="expand-val mono">convos-agent-' + esc(instanceId) + '</span>')
          + '</div>' : '')
        + '</div>';

      // AgentMail (below Instance)
      if (mailTool) {
        html += '<div class="expand-section" style="border-top:1px solid #EBEBEB">'
          + '<div class="expand-section-header"><span class="expand-section-title">AgentMail</span>'
          + '<span class="expand-status-dot ' + (mailTool.status === 'active' ? 'active' : 'inactive') + '"></span></div>'
          + '<div class="expand-kv"><span class="expand-val mono">' + esc(mailTool.env_value || mailTool.resource_id || '-') + '</span></div>'
          + '</div>';
      }

      html += '</div>'; // close left column

      // RIGHT COLUMN — OpenRouter, Bankr, Telnyx (stacked)
      html += '<div class="expand-col expand-col-right">';

      // OpenRouter credits
      if (key) {
        var usage = key.usage || 0;
        var limit = key.limit || 0;
        var remaining = limit > 0 ? Math.max(0, limit - usage) : null;
        var pct = limit > 0 ? Math.min(100, (usage / limit) * 100) : 0;
        var barClass = pct > 90 ? 'danger' : pct > 70 ? 'warn' : '';
        var keyHash = key.hash || '';
        html += '<div class="expand-section" style="border-right:none">'
          + '<div class="expand-section-header">'
          + '<a class="expand-link" href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">OpenRouter</a>'
          + '</div>'
          + '<div class="expand-kv-row">'
          + '<div class="expand-kv"><span class="expand-label">Used</span> <span class="expand-val">' + fmtDollars(usage) + '</span></div>'
          + '<div class="expand-kv"><span class="expand-label">Limit</span> <span class="expand-val">' + fmtDollars(limit) + '</span></div>'
          + '<div class="expand-kv"><span class="expand-label">Left</span> <span class="expand-val">' + (remaining != null ? fmtDollars(remaining) : '-') + '</span></div>'
          + '</div>'
          + '<div class="expand-bar-wrap"><div class="' + barClass + '" style="width:' + pct + '%"></div></div>'
          + '<div class="expand-topup">'
          + '<input type="number" min="1" placeholder="20" value="20" data-topup-input="' + esc(keyHash) + '" data-current-limit="' + limit + '" />'
          + '<button data-topup-btn="' + esc(keyHash) + '" data-instance="' + esc(instanceId) + '">Top up</button>'
          + '<span class="topup-msg" data-topup-msg="' + esc(keyHash) + '"></span>'
          + '</div>'
          + '</div>';
      }

      // Bankr
      html += '<div class="expand-section" style="border-top:1px solid #EBEBEB;border-right:none">'
        + '<div class="expand-section-header"><span class="expand-section-title">Bankr</span>'
        + '<span class="expand-status-dot ' + (BANKR_KEY ? 'active' : 'inactive') + '"></span></div>'
        + '<div class="expand-kv"><span class="expand-val" style="color:#9CA3AF">' + (BANKR_KEY ? 'Configured' : 'Not set') + '</span></div>'
        + '</div>';

      // Telnyx
      html += '<div class="expand-section" style="border-top:1px solid #EBEBEB;border-right:none">'
        + '<div class="expand-section-header"><span class="expand-section-title">Telnyx</span>'
        + (telnyxTool
          ? '<span class="expand-status-dot ' + (telnyxTool.status === 'active' ? 'active' : 'inactive') + '"></span></div>'
            + '<div class="expand-kv"><span class="expand-val mono">' + esc(telnyxTool.resource_id || '-') + '</span></div>'
          : '<span class="expand-status-dot inactive"></span></div>'
            + '<div class="expand-kv"><span class="expand-val" style="color:#9CA3AF">Not provisioned</span></div>')
        + '</div>';

      html += '</div>'; // close right column

      if (!hasSections) {
        html += '<div class="expand-empty">No service details available</div>';
      }

      html += '</div></td>';

      var tr = document.createElement('tr');
      tr.id = 'expand-' + instanceId;
      tr.className = 'expand-row';
      tr.innerHTML = html;

      expandedInstanceId = instanceId;
      var parentRow = document.getElementById('row-' + instanceId);
      if (parentRow) {
        parentRow.classList.add('expanded');
        parentRow.after(tr);
      }
    }

    // --- Close env dropdown on outside click ---
    document.addEventListener('click', function (e) {
      var switcher = document.querySelector('.env-switcher');
      if (switcher && !switcher.contains(e.target)) switcher.classList.remove('open');
    });

    // --- Top-up handler (delegated) ---
    document.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-topup-btn]');
      if (!btn) return;
      var hash = btn.getAttribute('data-topup-btn');
      var instanceId = btn.getAttribute('data-instance');
      var input = document.querySelector('[data-topup-input="' + hash + '"]');
      var msgEl = document.querySelector('[data-topup-msg="' + hash + '"]');
      var addAmount = parseFloat(input && input.value);
      if (!addAmount || addAmount <= 0) {
        if (msgEl) { msgEl.className = 'topup-msg error'; msgEl.textContent = 'Enter an amount'; }
        return;
      }
      var currentLimit = parseFloat(input.getAttribute('data-current-limit')) || 0;
      var newLimit = currentLimit + addAmount;
      btn.disabled = true;
      btn.textContent = 'Adding...';
      if (msgEl) msgEl.textContent = '';
      try {
        var res = await fetch('/dashboard/topup/' + hash, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ limit: newLimit }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        await refreshCredits();
        toggleExpand(instanceId, true);
        var newMsg = document.querySelector('[data-topup-msg="' + hash + '"]');
        if (newMsg) { newMsg.className = 'topup-msg success'; newMsg.textContent = '+$' + addAmount + ' added'; }
      } catch (err) {
        if (msgEl) { msgEl.className = 'topup-msg error'; msgEl.textContent = err.message; }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Top up';
      }
    });

    // --- Init + polling ---
    refreshCounts();
    refreshAgents();
    refreshCredits();
    refreshInstances();
    refreshInboxes();
    refreshORKeys();
    refreshPhones();
    setInterval(function () { refreshCounts(); refreshAgents(); }, 15000);
    setInterval(function () { refreshCredits(); refreshInstances(); refreshInboxes(); refreshORKeys(); refreshPhones(); }, 60000);
  </script>
</body>
</html>`;
}
