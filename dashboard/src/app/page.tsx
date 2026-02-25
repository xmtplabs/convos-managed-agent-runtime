"use client";

import { useEffect, useState } from "react";
import type { PoolCounts } from "@/lib/types";

const POOL_API_URL =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_POOL_API_URL || "http://localhost:3001")
    : "http://localhost:3001";

export default function Home() {
  const [counts, setCounts] = useState<PoolCounts | null>(null);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch(`${POOL_API_URL}/api/pool/counts`);
        if (res.ok) {
          setCounts(await res.json());
        }
      } catch {
        // Silently fail on fetch errors during initial load
      }
    }
    fetchCounts();
  }, []);

  const hasIdle = counts !== null && counts.idle > 0;
  const isEmpty = counts !== null && counts.idle === 0;

  return (
    <main className="form-wrapper">
      <div className="form-center">
        {/* Paste input area - shown when pool has idle instances */}
        {hasIdle && (
          <div className="paste-input-wrap">
            <input
              className="paste-input"
              type="text"
              placeholder="Paste a group chat link to add an assistant"
              disabled
            />
          </div>
        )}

        {/* Empty state - shown when pool has no idle instances.
            The CSS sets display:none by default; override with inline style
            to match how the original Pool page toggles visibility. */}
        {isEmpty && (
          <div className="empty-state" style={{ display: "block" }}>
            <div className="empty-scene">
              <p>No assistants available right now</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
