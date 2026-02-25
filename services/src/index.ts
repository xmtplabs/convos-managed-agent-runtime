import express from "express";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { infraRouter } from "./routes/infra.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { configureRouter } from "./routes/configure.js";
import { registryRouter } from "./routes/registry.js";
import { dashboardRouter } from "./routes/dashboard.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Public
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.use(dashboardRouter);
app.get("/", (_req, res) => {
  res.type("html").send(dashboardHtml());
});

// All service routes require auth
app.use(requireAuth);
app.use(infraRouter);
app.use(statusRouter);
app.use(toolsRouter);
app.use(configureRouter);
app.use(registryRouter);

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Convos Services</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    background: #FFF;
    height: 100vh;
    color: #000;
    -webkit-font-smoothing: antialiased;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Top bar ── */
  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid #EBEBEB;
    flex-shrink: 0;
    gap: 16px;
    flex-wrap: wrap;
  }

  .logo-text { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; }

  .credits-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .credits-label {
    font-size: 11px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
  }

  .credit-stat {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 500;
    padding: 3px 9px;
    background: #FAFAFA;
    border-radius: 8px;
    color: #666;
    border: 1px solid #EBEBEB;
  }

  .credit-stat .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .dot.green { background: #34C759; }
  .dot.orange { background: #FF9500; }
  .dot.blue { background: #007AFF; }

  /* ── Main layout ── */
  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Left panel ── */
  .list-panel {
    width: 320px;
    min-width: 320px;
    border-right: 1px solid #EBEBEB;
    display: flex;
    flex-direction: column;
    background: #FAFAFA;
  }

  .list-header {
    padding: 12px 16px;
    border-bottom: 1px solid #EBEBEB;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .list-title {
    font-size: 12px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    background: #EBEBEB;
    border-radius: 10px;
    color: #666;
  }

  .filter-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #EBEBEB;
    border-radius: 8px;
    font-size: 12px;
    font-family: inherit;
    background: #FFF;
    outline: none;
    transition: border-color 0.15s;
  }

  .filter-input:focus { border-color: #007AFF; }
  .filter-input::placeholder { color: #BBB; }

  .list-scroll {
    flex: 1;
    overflow-y: auto;
  }

  .instance-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 1px solid #F0F0F0;
    transition: background 0.1s;
  }

  .instance-item:hover { background: #F0F0F0; }
  .instance-item.active { background: #E8E8E8; }

  .instance-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .instance-dot.success { background: #34C759; }
  .instance-dot.building { background: #FF9500; }
  .instance-dot.error { background: #DC2626; }
  .instance-dot.removed { background: #CCC; }
  .instance-dot.unknown { background: #999; }

  .instance-info { flex: 1; min-width: 0; }

  .instance-id {
    font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    color: #333;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .instance-meta {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }

  .instance-credits {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }

  .mini-bar {
    flex: 1;
    height: 4px;
    background: #E8E8E8;
    border-radius: 2px;
    overflow: hidden;
    max-width: 100px;
  }

  .mini-bar-fill {
    height: 100%;
    border-radius: 2px;
    background: #007AFF;
  }

  .mini-bar-fill.warn { background: #FF9500; }
  .mini-bar-fill.danger { background: #DC2626; }

  .mini-credits-text {
    font-size: 10px;
    color: #AAA;
    white-space: nowrap;
    font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
  }

  /* ── Right panel ── */
  .detail-panel {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }

  .empty-detail {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #BBB;
    font-size: 14px;
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 24px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .detail-instance-id {
    font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
    font-size: 16px;
    font-weight: 600;
    color: #000;
    word-break: break-all;
  }

  .detail-time {
    font-size: 12px;
    color: #999;
    margin-top: 4px;
  }

  .status-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 3px 10px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .status-badge.SUCCESS, .status-badge.SLEEPING { background: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; }
  .status-badge.BUILDING, .status-badge.DEPLOYING, .status-badge.INITIALIZING { background: #FEF3C7; border: 1px solid #FDE68A; color: #92400E; }
  .status-badge.CRASHED, .status-badge.FAILED { background: #FEE2E2; border: 1px solid #FECACA; color: #991B1B; }
  .status-badge.REMOVED, .status-badge.REMOVING { background: #F5F5F5; border: 1px solid #EBEBEB; color: #999; }

  .section {
    margin-bottom: 24px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid #F0F0F0;
  }

  .info-grid {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 6px 12px;
    font-size: 13px;
  }

  .info-label {
    color: #999;
    font-weight: 500;
    font-size: 12px;
  }

  .info-value {
    color: #333;
    font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    word-break: break-all;
  }

  .info-value a { color: #007AFF; text-decoration: none; }
  .info-value a:hover { text-decoration: underline; }

  .service-card {
    background: #FAFAFA;
    border: 1px solid #EBEBEB;
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 10px;
  }

  .service-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .service-tool-id {
    font-size: 13px;
    font-weight: 600;
    color: #333;
  }

  .service-status {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 5px;
    background: #F0FDF4;
    border: 1px solid #BBF7D0;
    color: #166534;
  }

  .service-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 4px;
  }

  .service-row-label {
    color: #999;
    min-width: 80px;
  }

  .service-row-value {
    color: #333;
    font-family: 'SF Mono', 'Monaco', 'Courier New', monospace;
    font-size: 11px;
    word-break: break-all;
  }

  .progress-wrap { display: flex; align-items: center; gap: 8px; margin-top: 6px; }

  .progress-bar {
    flex: 1;
    height: 6px;
    background: #E8E8E8;
    border-radius: 3px;
    overflow: hidden;
    max-width: 180px;
  }

  .progress-fill { height: 100%; background: #007AFF; border-radius: 3px; transition: width 0.3s; }
  .progress-fill.warn { background: #FF9500; }
  .progress-fill.danger { background: #DC2626; }

  .progress-text { font-size: 11px; color: #999; white-space: nowrap; }

  .btn-topup {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid #EBEBEB;
    border-radius: 6px;
    cursor: pointer;
    background: #FFF;
    color: #666;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .btn-topup:hover { background: #F0F0F0; border-color: #CCC; color: #007AFF; }

  .btn-kill {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 12px;
    border: 1px solid #FECACA;
    border-radius: 6px;
    cursor: pointer;
    background: #FFF;
    color: #DC2626;
    transition: all 0.15s ease;
  }

  .btn-kill:hover { background: #FEE2E2; border-color: #DC2626; }
  .btn-kill:disabled { opacity: 0.5; cursor: not-allowed; }

  .error-msg {
    background: #FEE2E2;
    color: #DC2626;
    padding: 10px 16px;
    border-radius: 10px;
    margin: 12px 24px 0;
    font-size: 13px;
    display: none;
  }

  .updated {
    font-size: 10px;
    color: #CCC;
    padding: 6px 16px 10px;
    text-align: center;
  }

  @media (max-width: 768px) {
    .main { flex-direction: column; }
    .list-panel { width: 100%; min-width: 0; max-height: 40vh; border-right: none; border-bottom: 1px solid #EBEBEB; }
    .top-bar { padding: 12px 16px; }
    .detail-panel { padding: 16px; }
  }
</style>
</head>
<body>

<div class="top-bar">
  <span class="logo-text">Convos Services</span>
  <div id="credits-bar" class="credits-bar">
    <span class="credits-label">Loading credits...</span>
  </div>
</div>

<div id="error" class="error-msg"></div>

<div class="main">
  <div class="list-panel">
    <div class="list-header">
      <div class="list-header-row">
        <span class="list-title">Instances</span>
        <span id="count-badge" class="count-badge">0</span>
      </div>
      <input id="filter" class="filter-input" type="text" placeholder="Filter by instance ID..." />
    </div>
    <div id="instance-list" class="list-scroll"></div>
    <div id="updated" class="updated"></div>
  </div>

  <div id="detail-panel" class="detail-panel">
    <div class="empty-detail">Select an instance</div>
  </div>
</div>

<script>
var REFRESH_MS = 30000;
var keysByName = {};
var instances = [];
var selectedId = null;

function $(id) { return document.getElementById(id); }

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function fmt(n) {
  if (n == null) return '-';
  return '$' + Number(n).toFixed(2);
}

function pct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, (used / limit) * 100);
}

function barClass(p) {
  if (p >= 90) return 'danger';
  if (p >= 70) return 'warn';
  return '';
}

/* Get per-instance OpenRouter credits (real or faked) */
function getInstanceCredits(instanceId) {
  var keyName = 'convos-agent-' + instanceId;
  var keyInfo = keysByName[keyName];
  if (keyInfo) return { used: keyInfo.usage || 0, limit: keyInfo.limit || 0 };
  /* Fake: $20 used of account-level total, or $100 default */
  var totalCredits = 100;
  try { totalCredits = parseFloat($('credits-bar').querySelector('.credit-stat').textContent.replace(/[^0-9.]/g,'')) || 100; } catch(e) {}
  return { used: 20, limit: totalCredits };
}

function statusClass(s) {
  return (s || 'UNKNOWN').toUpperCase().replace(/[^A-Z]/g, '');
}

function dotClass(s) {
  var sc = (s || '').toUpperCase();
  if (sc === 'SUCCESS' || sc === 'SLEEPING') return 'success';
  if (sc === 'BUILDING' || sc === 'DEPLOYING' || sc === 'INITIALIZING') return 'building';
  if (sc === 'CRASHED' || sc === 'FAILED') return 'error';
  if (sc === 'REMOVED' || sc === 'REMOVING') return 'removed';
  return 'unknown';
}

function timeAgo(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  var diff = Date.now() - d.getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function topUp(instanceId) {
  alert('Top-up for ' + instanceId + ' \\u2014 not implemented yet.\\nThis will increase the OpenRouter key limit.');
}

async function killInstance(instanceId) {
  if (!confirm('Kill instance ' + instanceId + '?\\nThis will destroy the Railway service, all tools, and remove it from the database.')) return;
  var btn = document.querySelector('.btn-kill');
  if (btn) { btn.disabled = true; btn.textContent = 'Killing...'; }
  try {
    var res = await fetch('/dashboard/kill/' + encodeURIComponent(instanceId), { method: 'DELETE' });
    if (!res.ok) {
      var data = await res.json().catch(function() { return {}; });
      throw new Error(data.error || res.status);
    }
    selectedId = null;
    await refresh();
  } catch (e) {
    alert('Kill failed: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Kill'; }
  }
}

/* ── Render list ── */
function renderList() {
  var filter = ($('filter').value || '').toLowerCase();
  var filtered = instances.filter(function(r) {
    return r.instance_id.toLowerCase().indexOf(filter) !== -1;
  });

  $('count-badge').textContent = filtered.length;

  if (!filtered.length) {
    $('instance-list').innerHTML =
      '<div style="padding:24px;text-align:center;color:#BBB;font-size:13px;">' +
      (instances.length ? 'No matches' : 'No instances') + '</div>';
    return;
  }

  $('instance-list').innerHTML = filtered.map(function(r) {
    var active = r.instance_id === selectedId ? ' active' : '';
    var dc = dotClass(r.deploy_status);
    var toolCount = (r.tools || []).length;

    /* OpenRouter credits for this instance */
    var cred = getInstanceCredits(r.instance_id);
    var p = pct(cred.used, cred.limit);
    var creditsHtml = '<div class="instance-credits">' +
      '<div class="mini-bar"><div class="mini-bar-fill ' + barClass(p) + '" style="width:' + p + '%"></div></div>' +
      '<span class="mini-credits-text">' + fmt(cred.used) + ' / ' + fmt(cred.limit) + '</span>' +
    '</div>';

    return '<div class="instance-item' + active + '" data-id="' + esc(r.instance_id) + '">' +
      '<span class="instance-dot ' + dc + '"></span>' +
      '<div class="instance-info">' +
        '<div class="instance-id">' + esc(r.instance_id) + '</div>' +
        '<div class="instance-meta">' + esc(r.deploy_status || 'UNKNOWN') + ' &middot; ' + timeAgo(r.created_at) +
          (toolCount ? ' &middot; ' + toolCount + ' tool' + (toolCount > 1 ? 's' : '') : '') +
        '</div>' +
        creditsHtml +
      '</div>' +
    '</div>';
  }).join('');

  /* click handlers */
  var items = $('instance-list').querySelectorAll('.instance-item');
  items.forEach(function(el) {
    el.addEventListener('click', function() {
      selectedId = el.getAttribute('data-id');
      renderList();
      renderDetail();
    });
  });
}

/* ── Render detail ── */
function renderDetail() {
  var panel = $('detail-panel');
  if (!selectedId) {
    panel.innerHTML = '<div class="empty-detail">Select an instance</div>';
    return;
  }

  var r = instances.find(function(i) { return i.instance_id === selectedId; });
  if (!r) {
    panel.innerHTML = '<div class="empty-detail">Instance not found</div>';
    return;
  }

  var sc = statusClass(r.deploy_status);
  var html = '';

  /* Header */
  html += '<div class="detail-header">' +
    '<div>' +
      '<div class="detail-instance-id">' + esc(r.instance_id) + '</div>' +
      '<div class="detail-time">Created ' + timeAgo(r.created_at) + '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span class="status-badge ' + sc + '">' + esc(r.deploy_status || 'UNKNOWN') + '</span>' +
      '<button class="btn-kill" onclick="killInstance(\\''+r.instance_id+'\\')">Kill</button>' +
    '</div>' +
  '</div>';

  /* Railway deeplinks */
  var serviceUrl = '';
  var poolUrl = '';
  if (r.provider === 'railway' && r.provider_project_id) {
    poolUrl = 'https://railway.com/project/' + encodeURIComponent(r.provider_project_id);
    if (r.provider_service_id) {
      serviceUrl = poolUrl + '/service/' + encodeURIComponent(r.provider_service_id);
    }
  }

  /* Extract env name from URL: ...{slug}-{envName}.up.railway.app */
  var envName = '-';
  if (r.url) {
    var m = r.url.match(/\\.up\\.railway\\.app/);
    if (m) {
      var host = new URL(r.url).hostname.replace('.up.railway.app', '');
      var lastDash = host.lastIndexOf('-');
      if (lastDash !== -1) envName = host.substring(lastDash + 1);
    }
  }

  html += '<div class="section">' +
    '<div class="section-title">Infrastructure</div>';

  /* Railway card */
  html += '<div class="service-card">' +
    '<div class="service-card-header"><span class="service-tool-id">Railway</span></div>' +
    '<div class="service-row"><span class="service-row-label">Instance</span><span class="service-row-value">' +
      (serviceUrl
        ? '<a href="' + serviceUrl + '" target="_blank">convos-agent-' + esc(r.instance_id) + ' &#8599;</a>'
        : 'convos-agent-' + esc(r.instance_id)) +
    '</span></div>' +
    '<div class="service-row"><span class="service-row-label">Environment</span><span class="service-row-value">' +
      (poolUrl
        ? '<a href="' + poolUrl + '" target="_blank">' + esc(envName) + ' &#8599;</a>'
        : esc(envName)) +
    '</span></div>' +
    '<div class="service-row"><span class="service-row-label">URL</span><span class="service-row-value">' +
      (r.url
        ? '<a href="' + esc(r.url) + '" target="_blank">' + esc(r.url) + '</a>'
        : '-') +
    '</span></div>' +
    '<div class="service-row"><span class="service-row-label">Resources</span><span class="service-row-value">4 vCPU &middot; 8 GB RAM</span></div>' +
  '</div>';

  /* Runtime card */
  html += '<div class="service-card">' +
    '<div class="service-card-header"><span class="service-tool-id">Runtime</span></div>' +
    '<div class="service-row"><span class="service-row-label">Image</span><span class="service-row-value">' + esc(r.runtime_image || '-') + '</span></div>' +
  '</div>';

  html += '</div>';

  /* Services / Tools */
  var tools = r.tools || [];
  var serviceCount = tools.length + 1; /* +1 for OpenRouter (always shown) */
  html += '<div class="section">' +
    '<div class="section-title">Services (' + serviceCount + ')</div>';

  /* OpenRouter card — always shown */
  var cred = getInstanceCredits(r.instance_id);
  var credP = pct(cred.used, cred.limit);
  html += '<div class="service-card">' +
    '<div class="service-card-header">' +
      '<span class="service-tool-id">openrouter</span>' +
      '<span class="service-status">active</span>' +
    '</div>' +
    '<div class="progress-wrap">' +
      '<div class="progress-bar"><div class="progress-fill ' + barClass(credP) + '" style="width:' + credP + '%"></div></div>' +
      '<span class="progress-text">' + fmt(cred.used) + ' / ' + fmt(cred.limit) + '</span>' +
      '<button class="btn-topup" onclick="topUp(\\''+r.instance_id+'\\')"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-1px;"><path d="M6 10V2M6 2L3 5M6 2l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '</div>' +
  '</div>';

  /* Other tools */
  tools.forEach(function(t) {
    if (t.tool_id === 'openrouter') return; /* already rendered above */

    html += '<div class="service-card">';
    html += '<div class="service-card-header">' +
      '<span class="service-tool-id">' + esc(t.tool_id) + '</span>' +
      '<span class="service-status">' + esc(t.status || 'active') + '</span>' +
    '</div>';

    html += '<div class="service-row"><span class="service-row-label">Resource</span>' +
      '<span class="service-row-value">' + esc(t.resource_id) + '</span></div>';

    html += '<div class="service-row"><span class="service-row-label">Env Key</span>' +
      '<span class="service-row-value">' + esc(t.env_key) + '</span></div>';

    if (t.tool_id === 'telnyx' && t.resource_meta) {
      var meta = typeof t.resource_meta === 'string' ? JSON.parse(t.resource_meta) : t.resource_meta;
      if (meta.messaging_profile_id) {
        html += '<div class="service-row"><span class="service-row-label">Msg Profile</span>' +
          '<span class="service-row-value">' + esc(meta.messaging_profile_id) + '</span></div>';
      }
    }

    html += '</div>'; /* service-card */
  });

  html += '</div>'; /* section */

  panel.innerHTML = html;
}

/* ── Data fetching ── */
async function fetchCredits() {
  try {
    var res = await fetch('/dashboard/credits');
    if (!res.ok) throw new Error(res.status);
    var data = await res.json();
    var c = data.credits || {};
    var remaining = (c.totalCredits || 0) - (c.totalUsage || 0);

    $('credits-bar').innerHTML =
      '<span class="credits-label">Credits</span>' +
      '<span class="credit-stat"><span class="dot green"></span>Total ' + fmt(c.totalCredits) + '</span>' +
      '<span class="credit-stat"><span class="dot orange"></span>Used ' + fmt(c.totalUsage) + '</span>' +
      '<span class="credit-stat"><span class="dot blue"></span>Remaining ' + fmt(remaining) + '</span>';

    keysByName = {};
    (data.keys || []).forEach(function(k) { keysByName[k.name] = k; });

    $('error').style.display = 'none';
  } catch (e) {
    $('credits-bar').innerHTML = '<span class="credits-label">Credits unavailable</span>';
    console.warn('Credits fetch failed:', e);
  }
}

async function fetchInstances() {
  try {
    var res = await fetch('/dashboard/instances');
    if (!res.ok) throw new Error(res.status);
    instances = await res.json();
    renderList();
    renderDetail();
    $('error').style.display = 'none';
  } catch (e) {
    $('error').textContent = 'Failed to load instances: ' + e.message;
    $('error').style.display = 'block';
  }
}

async function refresh() {
  await fetchCredits();
  await fetchInstances();
  $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

/* Filter input */
$('filter').addEventListener('input', function() { renderList(); });

refresh();
setInterval(refresh, REFRESH_MS);
</script>
</body>
</html>`;
}

async function start() {
  app.listen(config.port, () => {
    console.log(`[services] Listening on :${config.port}`);
  });
}

start().catch((err) => {
  console.error("[services] Failed to start:", err);
  process.exit(1);
});
