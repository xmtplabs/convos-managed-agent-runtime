/**
 * Runtime-state: OpenClaw plugin runtime reference and setup lock.
 * Owned by the Convos runtime artifact; used by channel, outbound, and gateway start/stop.
 */
import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

/** Set once at plugin register; used by channel, outbound, and gateway. */
export function setConvosRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getConvosRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Convos runtime not initialized");
  }
  return runtime;
}

/** When true, probes are skipped to avoid burning XMTP installation slots during setup/reset. */
let setupActive = false;

export function isConvosSetupActive(): boolean {
  return setupActive;
}

export function setConvosSetupActive(active: boolean) {
  setupActive = active;
}
