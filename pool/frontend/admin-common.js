// admin-common.js — Shared state, data fetching, and helpers for all admin pages.
// Loaded via <script src="/admin/assets/admin-common.js"></script>
// All exports are assigned to window.* (no build step, vanilla JS).

(function () {
  var C = window.__POOL_CONFIG__ || {};
  window.C = C;
  window.POOL_ENV = C.poolEnvironment;
  window.PROTECTED_INSTANCES = C.protectedInstances || [];
  window.authHeaders = { 'Content-Type': 'application/json' };

  // --- Shared data caches ---
  window.claimedCache = [];
  window.pendingCache = [];
  window.taintedCache = [];
  window.crashedCache = [];
  window.idleCache = [];
  window.startingCache = [];
  window.svcKeyMap = {};
  window.svcToolsMap = {};
  window.infraMap = {};

  // --- Utility functions ---
  window.esc = function (s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };

  window.timeAgo = function (dateStr) {
    if (!dateStr) return '';
    var ms = Date.now() - new Date(dateStr).getTime();
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return d + 'd ' + h % 24 + 'h';
    if (h > 0) return h + 'h ' + m % 60 + 'm';
    if (m > 0) return m + 'm';
    return '<1m';
  };

  window.railwayUrl = function (serviceId, instanceId) {
    if (!serviceId) return null;
    var infra = instanceId ? (window.infraMap[instanceId] || {}) : {};
    var projectId = infra.provider_project_id;
    if (!projectId) return null;
    var envId = infra.provider_env_id;
    return 'https://railway.com/project/' + projectId + '/service/' + serviceId + (envId ? '?environmentId=' + envId : '');
  };

  window.fmtDollars = function (n) {
    if (n == null) return '-';
    return '$' + Number(n).toFixed(2);
  };

  // --- Data fetching ---

  window.refreshCounts = async function () {
    try {
      var res = await fetch('/api/pool/counts');
      var c = await res.json();
      var el;
      if ((el = document.getElementById('s-idle'))) el.textContent = c.idle;
      if ((el = document.getElementById('s-starting'))) el.textContent = c.starting;
      if ((el = document.getElementById('s-claimed'))) el.textContent = c.claimed;
      if ((el = document.getElementById('s-crashed'))) el.textContent = c.crashed;
      var drainable = (c.idle || 0) + (c.starting || 0);
      if ((el = document.getElementById('s-drainable'))) el.textContent = drainable;
      if ((el = document.getElementById('drain-btn'))) el.disabled = drainable === 0;
      if ((el = document.getElementById('last-updated'))) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) { console.warn('[pool] refreshCounts failed:', e); }
  };

  window.refreshAgents = async function () {
    try {
      var res = await fetch('/api/pool/agents');
      var data = await res.json();
      window.claimedCache = (data.claimed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
      window.pendingCache = (data.pendingAcceptance || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
      window.taintedCache = (data.tainted || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
      window.crashedCache = (data.crashed || []).sort(function (a, b) { return new Date(b.claimedAt) - new Date(a.claimedAt); });
      window.idleCache = (data.idle || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      window.startingCache = (data.starting || []).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
      if (typeof window.renderAgents === 'function') window.renderAgents();
    } catch (e) { console.warn('[pool] refreshAgents failed:', e); }
  };

  window.refreshInstances = async function () {
    try {
      var res = await fetch('/dashboard/instances', { headers: window.authHeaders });
      var data = await res.json();
      window.svcToolsMap = {};
      window.infraMap = {};
      (Array.isArray(data) ? data : []).forEach(function (inst) {
        if (inst.instance_id) {
          if (Array.isArray(inst.tools)) window.svcToolsMap[inst.instance_id] = inst.tools;
          window.infraMap[inst.instance_id] = inst;
        }
      });
    } catch (e) {}
  };

  // Serialized refresh (prevent overlapping fetches)
  var _refreshing = false;
  var _refreshQueued = false;
  window.refresh = async function () {
    if (_refreshing) { _refreshQueued = true; return; }
    _refreshing = true;
    console.log('[pool] refresh start');
    try {
      await Promise.all([window.refreshCounts(), window.refreshAgents(), window.refreshInstances()]);
      console.log('[pool] refresh done — claimed:%d pending:%d idle:%d starting:%d tainted:%d crashed:%d',
        window.claimedCache.length, window.pendingCache.length, window.idleCache.length, window.startingCache.length, window.taintedCache.length, window.crashedCache.length);
    } finally {
      _refreshing = false;
      if (_refreshQueued) { _refreshQueued = false; window.refresh(); }
    }
  };

  // --- Confirm Modal ---
  window.showConfirm = function (opts) {
    var confirmModal = document.getElementById('confirm-modal');
    document.getElementById('confirm-icon').textContent = opts.icon || '';
    document.getElementById('confirm-title').textContent = opts.title || 'Are you sure?';
    document.getElementById('confirm-message').textContent = opts.message || '';
    var proceedBtn = document.getElementById('confirm-proceed');
    proceedBtn.textContent = opts.confirmLabel || 'Confirm';
    proceedBtn.className = 'confirm-btn proceed' + (opts.danger ? ' danger' : '');
    confirmModal.classList.add('active');
    return new Promise(function (resolve) {
      window._confirmResolve = resolve;
    });
  };

  // --- Info Modal ---
  window.showInfo = function (opts) {
    var infoModal = document.getElementById('info-modal');
    document.getElementById('info-icon').textContent = opts.icon || '';
    document.getElementById('info-title').textContent = opts.title || '';
    document.getElementById('info-message').textContent = opts.message || '';
    infoModal.classList.add('active');
  };

  // --- Init shared UI (env switcher, railway link, modals, etc.) ---
  window.initAdminCommon = function () {
    // Title
    document.title = 'Pool Admin \u2014 ' + (C.poolEnvironment || '');

    // Env switcher
    var env = C.poolEnvironment || '';
    var btn = document.getElementById('env-switcher-btn');
    if (btn) {
      btn.className = 'env-switcher-btn env-' + env;
      btn.textContent = env;
    }
    var dropdown = document.getElementById('env-dropdown');
    if (dropdown) {
      var urls = C.adminUrls || [];
      var currentPath = window.location.pathname;
      var h = '';
      if (urls.length) {
        urls.forEach(function (e) {
          h += e.env === env
            ? '<a class="current"><span class="env-dot ' + e.env + '"></span>' + e.env + '</a>'
            : '<a href="' + e.url + currentPath + '"><span class="env-dot ' + e.env + '"></span>' + e.env + '</a>';
        });
      } else {
        h = '<a class="current"><span class="env-dot ' + env + '"></span>' + env + '</a>';
      }
      dropdown.innerHTML = h;
    }

    // Railway project deeplink
    if (C.railwayProjectId) {
      var rl = document.getElementById('railway-link');
      if (rl) {
        rl.href = 'https://railway.com/project/' + C.railwayProjectId + (C.railwayEnvironmentId ? '?environmentId=' + C.railwayEnvironmentId : '');
        rl.style.display = '';
      }
    }

    // Close env dropdown on outside click
    document.addEventListener('click', function (e) {
      var switcher = document.querySelector('.env-switcher');
      if (switcher && !switcher.contains(e.target)) switcher.classList.remove('open');
    });

    // Confirm modal wiring
    var confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) {
      document.getElementById('confirm-proceed').addEventListener('click', function () {
        confirmModal.classList.remove('active');
        if (window._confirmResolve) { window._confirmResolve(true); window._confirmResolve = null; }
      });
      document.getElementById('confirm-cancel').addEventListener('click', function () {
        confirmModal.classList.remove('active');
        if (window._confirmResolve) { window._confirmResolve(false); window._confirmResolve = null; }
      });
      confirmModal.addEventListener('click', function (e) {
        if (e.target === confirmModal) {
          confirmModal.classList.remove('active');
          if (window._confirmResolve) { window._confirmResolve(false); window._confirmResolve = null; }
        }
      });
    }

    // Info modal wiring
    var infoModal = document.getElementById('info-modal');
    if (infoModal) {
      document.getElementById('info-dismiss').addEventListener('click', function () { infoModal.classList.remove('active'); });
      infoModal.addEventListener('click', function (e) { if (e.target === infoModal) infoModal.classList.remove('active'); });
    }

    // Escape key closes modals
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var qm = document.getElementById('qr-modal');
        if (qm) qm.classList.remove('active');
        if (confirmModal && confirmModal.classList.contains('active')) {
          confirmModal.classList.remove('active');
          if (window._confirmResolve) { window._confirmResolve(false); window._confirmResolve = null; }
        }
      }
    });
  };
})();
