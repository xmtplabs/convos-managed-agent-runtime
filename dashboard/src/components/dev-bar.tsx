"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { PoolCounts } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  id: string;
  agentName?: string;
  claimedAt?: string;
  inviteUrl?: string;
  serviceId?: string;
  sourceBranch?: string;
}

interface AgentsResponse {
  claimed: Agent[];
  crashed: Agent[];
}

interface DevBarProps {
  onShowQr: (agentName: string, inviteUrl: string) => void;
}

// ---------------------------------------------------------------------------
// Environment config (NEXT_PUBLIC_ vars available at build time)
// ---------------------------------------------------------------------------

const POOL_ENVIRONMENT =
  process.env.NEXT_PUBLIC_POOL_ENVIRONMENT || "staging";
const DEPLOY_BRANCH =
  process.env.NEXT_PUBLIC_DEPLOY_BRANCH || "unknown";
const INSTANCE_MODEL =
  process.env.NEXT_PUBLIC_INSTANCE_MODEL || "unknown";
const RAILWAY_PROJECT_ID =
  process.env.NEXT_PUBLIC_RAILWAY_PROJECT_ID || "";
const RAILWAY_SERVICE_ID =
  process.env.NEXT_PUBLIC_RAILWAY_SERVICE_ID || "";
const RAILWAY_ENVIRONMENT_ID =
  process.env.NEXT_PUBLIC_RAILWAY_ENVIRONMENT_ID || "";

const POOL_API_URL =
  process.env.NEXT_PUBLIC_POOL_API_URL || "http://localhost:3001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

function railwayUrl(serviceId?: string): string | null {
  if (!RAILWAY_PROJECT_ID || !serviceId) return null;
  const base = `https://railway.com/project/${RAILWAY_PROJECT_ID}/service/${serviceId}`;
  return RAILWAY_ENVIRONMENT_ID ? `${base}?environmentId=${RAILWAY_ENVIRONMENT_ID}` : base;
}

function railwayProjectUrl(): string | null {
  if (!RAILWAY_PROJECT_ID) return null;
  return `https://railway.com/project/${RAILWAY_PROJECT_ID}`;
}

function serviceLink(): { href: string; label: string } | null {
  if (!RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID) {
    return RAILWAY_SERVICE_ID
      ? { href: "#", label: RAILWAY_SERVICE_ID.slice(0, 8) }
      : null;
  }
  const base = `https://railway.com/project/${RAILWAY_PROJECT_ID}/service/${RAILWAY_SERVICE_ID}`;
  const href = RAILWAY_ENVIRONMENT_ID ? `${base}?environmentId=${RAILWAY_ENVIRONMENT_ID}` : base;
  return { href, label: RAILWAY_SERVICE_ID.slice(0, 8) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DevBar({ onShowQr }: DevBarProps) {
  // State
  const [collapsed, setCollapsed] = useState(true);
  const [counts, setCounts] = useState<PoolCounts>({ idle: 0, starting: 0, claimed: 0, crashed: 0 });
  const [claimedAgents, setClaimedAgents] = useState<Agent[]>([]);
  const [crashedAgents, setCrashedAgents] = useState<Agent[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [replenishCount, setReplenishCount] = useState(1);
  const [replenishing, setReplenishing] = useState(false);
  const [draining, setDraining] = useState(false);
  const [destroyingIds, setDestroyingIds] = useState<Set<string>>(new Set());

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const refreshCounts = useCallback(async () => {
    try {
      const res = await fetch(`${POOL_API_URL}/api/pool/counts`);
      if (res.ok) {
        const data: PoolCounts = await res.json();
        setCounts(data);
      }
    } catch {
      // silently ignore
    }
  }, []);

  const refreshAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/pool/agents");
      if (res.ok) {
        const data: AgentsResponse = await res.json();
        setClaimedAgents(
          (data.claimed || []).sort(
            (a, b) => new Date(b.claimedAt || 0).getTime() - new Date(a.claimedAt || 0).getTime(),
          ),
        );
        setCrashedAgents(
          (data.crashed || []).sort(
            (a, b) => new Date(b.claimedAt || 0).getTime() - new Date(a.claimedAt || 0).getTime(),
          ),
        );
      }
    } catch {
      // silently ignore
    }
  }, []);

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  useEffect(() => {
    refreshCounts();
    refreshAgents();
    pollRef.current = setInterval(() => {
      refreshCounts();
      refreshAgents();
    }, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshCounts, refreshAgents]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleKill = useCallback(
    async (id: string, name: string) => {
      const prefix = POOL_ENVIRONMENT === "production" ? "[PRODUCTION] " : "";
      const msg = `${prefix}Kill "${name}"? This deletes the Railway service.`;
      if (!window.confirm(msg)) return;

      setDestroyingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/pool/instances/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Kill failed");
        // Remove from local state
        setClaimedAgents((prev) => prev.filter((a) => a.id !== id));
        refreshCounts();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Failed to kill: ${message}`);
        setDestroyingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refreshCounts],
  );

  const handleDismiss = useCallback(
    async (id: string, name: string) => {
      const prefix = POOL_ENVIRONMENT === "production" ? "[PRODUCTION] " : "";
      const msg = `${prefix}Dismiss crashed "${name}"?`;
      if (!window.confirm(msg)) return;

      setDestroyingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/pool/crashed/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Dismiss failed");
        setCrashedAgents((prev) => prev.filter((a) => a.id !== id));
        refreshCounts();
        refreshAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        window.alert(`Failed to dismiss: ${message}`);
        setDestroyingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refreshCounts, refreshAgents],
  );

  const handleReplenish = useCallback(async () => {
    setReplenishing(true);
    try {
      const res = await fetch("/api/pool/replenish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: replenishCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      refreshCounts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      window.alert(`Failed: ${message}`);
    } finally {
      setReplenishing(false);
    }
  }, [replenishCount, refreshCounts]);

  const handleDrain = useCallback(async () => {
    setDraining(true);
    try {
      // First fetch current counts to know how many to drain
      const countsRes = await fetch(`${POOL_API_URL}/api/pool/counts`);
      const c: PoolCounts = await countsRes.json();
      const n = Math.min((c.idle || 0) + (c.starting || 0), 20);

      if (n === 0) {
        window.alert("No unclaimed instances to drain.");
        setDraining(false);
        return;
      }

      const prefix = POOL_ENVIRONMENT === "production" ? "[PRODUCTION] " : "";
      const msg = `${prefix}Drain ${n} unclaimed instance(s)?`;
      if (!window.confirm(msg)) {
        setDraining(false);
        return;
      }

      const res = await fetch("/api/pool/drain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      refreshCounts();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      window.alert(`Failed: ${message}`);
    } finally {
      setDraining(false);
    }
  }, [refreshCounts]);

  // -----------------------------------------------------------------------
  // Dropdown helpers
  // -----------------------------------------------------------------------

  const closeDropdown = useCallback(() => setDropdownOpen(false), []);

  const handleClaimedToggleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't toggle if clicking inside the dropdown itself
      if ((e.target as HTMLElement).closest(".agents-dropdown")) return;
      setDropdownOpen((prev) => !prev);
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Dropdown content helpers
  // -----------------------------------------------------------------------

  const total = claimedAgents.length + crashedAgents.length;
  const countParts: string[] = [];
  if (claimedAgents.length) countParts.push(`${claimedAgents.length} running`);
  if (crashedAgents.length) countParts.push(`${crashedAgents.length} crashed`);

  const svcLink = serviceLink();
  const projectUrl = railwayProjectUrl();

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      {/* Backdrop for closing dropdown */}
      <div
        className={`dropdown-backdrop${dropdownOpen ? " open" : ""}`}
        onClick={closeDropdown}
      />

      {/* Dev bar */}
      <div className={`dev-bar${collapsed ? " collapsed" : ""}`}>
        {/* Environment tag (always visible, click to expand/collapse) */}
        <span
          className={`env-tag env-${POOL_ENVIRONMENT}`}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {POOL_ENVIRONMENT}
        </span>

        {/* Bar content (hidden when collapsed) */}
        <div className="bar-content">
          <span className="sep" />

          {/* Idle */}
          <span className="bar-stat">
            <span className="dot green" /> {counts.idle} ready
          </span>

          {/* Starting */}
          <span className="bar-stat">
            <span className="dot orange" /> {counts.starting} starting
          </span>

          {/* Claimed (clickable - opens dropdown) */}
          <span
            className={`bar-stat clickable${dropdownOpen ? " open" : ""}`}
            onClick={handleClaimedToggleClick}
          >
            <span className="dot blue" /> {counts.claimed} claimed{" "}
            <span className="chevron">&#9660;</span>

            {/* Agents dropdown */}
            <div
              className={`agents-dropdown${dropdownOpen ? " open" : ""}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="dropdown-header">
                <span className="dropdown-title">Live Assistants</span>
                <span className="dropdown-count">
                  {countParts.join(" \u00B7 ")}
                </span>
              </div>
              <div className="dropdown-list">
                {total === 0 ? (
                  <div className="dropdown-empty">No live assistants yet.</div>
                ) : (
                  <>
                    {/* Crashed agents first */}
                    {crashedAgents.map((a) => {
                      const name = a.agentName || a.id;
                      const rUrl = railwayUrl(a.serviceId);
                      const isDestroying = destroyingIds.has(a.id);
                      return (
                        <div
                          key={a.id}
                          className={`agent-card crashed${isDestroying ? " destroying" : ""}`}
                        >
                          <div className="agent-top">
                            <div className="agent-top-left">
                              <span className="agent-name">
                                {name}
                                <span className="agent-status-badge">Crashed</span>
                              </span>
                              <span className="agent-uptime">
                                {isDestroying ? "Destroying..." : timeAgo(a.claimedAt)}
                              </span>
                            </div>
                            <div className="agent-actions">
                              <button
                                className="agent-btn"
                                onClick={() => onShowQr(name, a.inviteUrl || "")}
                              >
                                QR
                              </button>
                              <button
                                className="agent-btn warn"
                                onClick={() => handleDismiss(a.id, name)}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                          <div className="agent-meta">
                            {rUrl ? (
                              <a href={rUrl} target="_blank" rel="noopener noreferrer">
                                {a.id}
                              </a>
                            ) : (
                              a.id
                            )}
                            {a.sourceBranch ? ` \u00B7 ${a.sourceBranch}` : ""}
                          </div>
                        </div>
                      );
                    })}

                    {/* Live (claimed) agents */}
                    {claimedAgents.map((a) => {
                      const name = a.agentName || a.id;
                      const rUrl = railwayUrl(a.serviceId);
                      const isDestroying = destroyingIds.has(a.id);
                      return (
                        <div
                          key={a.id}
                          className={`agent-card${isDestroying ? " destroying" : ""}`}
                        >
                          <div className="agent-top">
                            <div className="agent-top-left">
                              <span className="agent-name">{name}</span>
                              <span className="agent-uptime">
                                {isDestroying ? "Destroying..." : timeAgo(a.claimedAt)}
                              </span>
                            </div>
                            <div className="agent-actions">
                              <button
                                className="agent-btn"
                                onClick={() => onShowQr(name, a.inviteUrl || "")}
                              >
                                QR
                              </button>
                              <button
                                className="agent-btn danger"
                                onClick={() => handleKill(a.id, name)}
                              >
                                Kill
                              </button>
                            </div>
                          </div>
                          <div className="agent-meta">
                            {rUrl ? (
                              <a href={rUrl} target="_blank" rel="noopener noreferrer">
                                {a.id}
                              </a>
                            ) : (
                              a.id
                            )}
                            {a.sourceBranch ? ` \u00B7 ${a.sourceBranch}` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </span>

          {/* Crashed count (only shown if > 0) */}
          {counts.crashed > 0 && (
            <span className="bar-stat">
              <span className="dot red" /> {counts.crashed} crashed
            </span>
          )}

          <span className="sep" />

          {/* Replenish controls */}
          <input
            type="number"
            min={1}
            max={20}
            value={replenishCount}
            onChange={(e) => setReplenishCount(parseInt(e.target.value) || 1)}
          />
          <button
            className="bar-btn"
            onClick={handleReplenish}
            disabled={replenishing}
          >
            {replenishing ? "Adding..." : "+ Add"}
          </button>

          {/* Drain button */}
          <button
            className="bar-btn danger"
            onClick={handleDrain}
            disabled={draining}
          >
            {draining ? "Draining..." : "Drain"}
          </button>

          <span className="spacer" />

          {/* Info chips */}
          <span className="chip">branch: {DEPLOY_BRANCH}</span>
          <span className="chip">model: {INSTANCE_MODEL}</span>
          {svcLink && (
            <span className="chip">
              service:{" "}
              <a href={svcLink.href} target="_blank" rel="noopener noreferrer">
                {svcLink.label}
              </a>
            </span>
          )}
          {projectUrl && (
            <span className="chip">
              <a href={projectUrl} target="_blank" rel="noopener noreferrer">
                Railway &#8599;
              </a>
            </span>
          )}
        </div>
      </div>
    </>
  );
}
