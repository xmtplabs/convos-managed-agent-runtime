/**
 * Pool Admin — self-contained HTML admin page for pool management.
 * Password-protected via ADMIN_PASSWORD env var + session cookie.
 */

import crypto from "node:crypto";

const COOKIE_NAME = "pool_admin_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Simple in-memory session store (survives restarts via fresh login)
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function adminLogin(password, res) {
  const adminPassword = process.env.POOL_API_KEY;
  if (!adminPassword || password !== adminPassword) {
    return false;
  }
  const token = generateToken();
  sessions.set(token, Date.now() + SESSION_TTL_MS);
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
  const token = match[1];
  const expiry = sessions.get(token);
  if (!expiry || Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function adminLogout(req, res) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match) sessions.delete(match[1]);
  res.clearCookie(COOKIE_NAME);
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
  railwayProjectId,
  railwayServiceId,
  railwayEnvironmentId,
  poolApiKey,
  adminUrls = [],
}) {
  const railwayLink = railwayProjectId && railwayServiceId
    ? `https://railway.com/project/${railwayProjectId}/service/${railwayServiceId}${railwayEnvironmentId ? "?environmentId=" + railwayEnvironmentId : ""}`
    : "";
  const railwayProjectLink = railwayProjectId
    ? `https://railway.com/project/${railwayProjectId}`
    : "";

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
    .env-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .env-dev { background: #DBEAFE; color: #1D4ED8; }
    .env-staging { background: #FEF3C7; color: #92400E; }
    .env-production { background: #FEE2E2; color: #991B1B; }
    a.env-tag { text-decoration: none; opacity: 0.45; transition: opacity 0.15s; }
    a.env-tag:hover { opacity: 0.85; }
    .env-tag.active { opacity: 1; cursor: default; }
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
    }
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
    .instance-link {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 11px;
      color: #007AFF;
      text-decoration: none;
    }
    .instance-link:hover { text-decoration: underline; }
    .branch-tag {
      font-size: 11px;
      color: #999;
    }
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

    /* --- Responsive --- */
    @media (max-width: 640px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
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
      ${adminUrls.length ? adminUrls.map((e) =>
        e.env === poolEnvironment
          ? `<span class="env-tag env-${e.env} active">${e.env}</span>`
          : `<a class="env-tag env-${e.env}" href="${e.url}/admin">${e.env}</a>`
      ).join("") : `<span class="env-tag env-${poolEnvironment}">${poolEnvironment}</span>`}
    </div>
    <div class="header-right">
      <span class="chip">branch: ${deployBranch}</span>
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
      <div class="stat-card">
        <div class="stat-label">Templates</div>
        <div class="stat-value" id="s-templates">-</div>
      </div>
    </div>

    <div class="controls">
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
        <span class="table-title">Agents</span>
        <span class="table-count" id="table-count"></span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Instance</th>
            <th>Branch</th>
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
    var API_KEY = '${poolApiKey}';
    var POOL_ENV = '${poolEnvironment}';
    var RAILWAY_PROJECT = '${railwayProjectId}';
    var RAILWAY_ENV = '${railwayEnvironmentId}';
    var authHeaders = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' };

    var claimedCache = [], crashedCache = [];

    function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    function timeAgo(dateStr) {
      if (!dateStr) return '';
      var ms = Date.now() - new Date(dateStr).getTime();
      var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
      if (d > 0) return d + 'd ' + h % 24 + 'h';
      if (h > 0) return h + 'h ' + m % 60 + 'm';
      if (m > 0) return m + 'm';
      return '<1m';
    }

    function railwayUrl(serviceId) {
      if (!RAILWAY_PROJECT || !serviceId) return null;
      return 'https://railway.com/project/' + RAILWAY_PROJECT + '/service/' + serviceId + (RAILWAY_ENV ? '?environmentId=' + RAILWAY_ENV : '');
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
        renderAgents();
      } catch (e) {}
    }

    function renderAgents() {
      var body = document.getElementById('agents-body');
      var count = document.getElementById('table-count');
      var all = crashedCache.concat(claimedCache);
      var parts = [];
      if (claimedCache.length) parts.push(claimedCache.length + ' running');
      if (crashedCache.length) parts.push(crashedCache.length + ' crashed');
      count.textContent = parts.join(', ') || '';

      if (!all.length) {
        body.innerHTML = '<tr><td class="empty-row" colspan="6">No agents running</td></tr>';
        return;
      }

      var html = '';
      crashedCache.forEach(function (a) {
        var rUrl = railwayUrl(a.serviceId);
        html += '<tr class="crashed" id="row-' + a.id + '">'
          + '<td class="agent-name-cell">' + esc(a.agentName || a.id) + '</td>'
          + '<td><span class="status-badge status-crashed">Crashed</span></td>'
          + '<td>' + (rUrl ? '<a class="instance-link" href="' + rUrl + '" target="_blank">' + esc(a.id) + '</a>' : esc(a.id)) + '</td>'
          + '<td class="branch-tag">' + esc(a.sourceBranch || '') + '</td>'
          + '<td class="uptime">' + timeAgo(a.claimedAt) + '</td>'
          + '<td><div class="action-btns">'
          + '<button class="action-btn" data-qr="' + a.id + '">QR</button>'
          + '<button class="action-btn dismiss" data-dismiss="' + a.id + '">Dismiss</button>'
          + '</div></td></tr>';
      });
      claimedCache.forEach(function (a) {
        var rUrl = railwayUrl(a.serviceId);
        html += '<tr id="row-' + a.id + '">'
          + '<td class="agent-name-cell">' + esc(a.agentName || a.id) + '</td>'
          + '<td><span class="status-badge status-running">Running</span></td>'
          + '<td>' + (rUrl ? '<a class="instance-link" href="' + rUrl + '" target="_blank">' + esc(a.id) + '</a>' : esc(a.id)) + '</td>'
          + '<td class="branch-tag">' + esc(a.sourceBranch || '') + '</td>'
          + '<td class="uptime">' + timeAgo(a.claimedAt) + '</td>'
          + '<td><div class="action-btns">'
          + '<button class="action-btn" data-qr="' + a.id + '">QR</button>'
          + '<button class="action-btn kill" data-kill="' + a.id + '">Kill</button>'
          + '</div></td></tr>';
      });
      body.innerHTML = html;
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
      if (dismissId) dismissAgent(dismissId);
    });

    function markDestroying(id) {
      var row = document.getElementById('row-' + id);
      if (row) row.classList.add('destroying');
    }

    async function killAgent(id) {
      var row = document.getElementById('row-' + id);
      var name = row ? row.querySelector('.agent-name-cell').textContent.trim() : id;
      var msg = (POOL_ENV === 'production' ? '[PRODUCTION] ' : '') + 'Kill "' + name + '"? This deletes the Railway service.';
      if (!confirm(msg)) return;
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

    // --- Replenish ---
    document.getElementById('replenish-btn').addEventListener('click', async function () {
      var btn = this;
      var n = parseInt(document.getElementById('replenish-count').value) || 1;
      btn.disabled = true; btn.textContent = 'Adding...';
      try {
        var res = await fetch('/api/pool/replenish', { method: 'POST', headers: authHeaders, body: JSON.stringify({ count: n }) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        refreshCounts();
      } catch (err) { alert('Failed: ' + err.message); }
      finally { btn.disabled = false; btn.textContent = '+ Add'; }
    });

    // --- Drain ---
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
      try {
        var res = await fetch('/api/pool/drain', { method: 'POST', headers: authHeaders, body: JSON.stringify({ count: n }) });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        refreshCounts();
      } catch (err) { alert('Failed: ' + err.message); }
      finally { btn.disabled = false; btn.textContent = 'Drain'; }
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

    // --- Init + polling ---
    refreshCounts();
    refreshAgents();
    setInterval(function () { refreshCounts(); refreshAgents(); }, 15000);
  </script>
</body>
</html>`;
}
