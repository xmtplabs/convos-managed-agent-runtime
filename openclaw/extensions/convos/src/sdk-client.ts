/**
 * ConvosInstance — wrapper around `convos agent serve`.
 *
 * 1 process = 1 conversation. All operations go through a single
 * long-lived child process using an ndjson stdin/stdout protocol.
 *
 * Stdout events: ready, message, member_joined, sent, heartbeat, error
 * Stdin commands: send, react, attach, remote-attach, rename, lock, unlock, explode, stop
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CreateConversationResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ---- Types ----

export interface ConvosInstanceOptions {
  onMessage?: (msg: InboundMessage) => void;
  onMemberJoined?: (info: { joinerInboxId: string; conversationId: string; catchup?: boolean }) => void;
  onReady?: (info: ReadyEvent) => void;
  onSent?: (info: SentEvent) => void;
  onHeartbeat?: (info: HeartbeatEvent) => void;
  onError?: (info: { message: string }) => void;
  onExit?: (code: number | null) => void;
  debug?: boolean;
  heartbeatSeconds?: number;
}

export interface InboundMessage {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  contentType?: string;
  timestamp: Date;
  catchup?: boolean;
}

export interface ReadyEvent {
  conversationId: string;
  identityId: string;
  inboxId: string;
  address: string;
  name: string;
  inviteUrl?: string;
  inviteSlug?: string;
  inviteTag?: string;
  qrCodePath?: string;
}

export interface SentEvent {
  id?: string;
  text?: string;
  type?: string;
  messageId?: string;
  emoji?: string;
  action?: string;
  name?: string;
  conversationId?: string;
  identityDestroyed?: string;
  membersRemoved?: number;
  expiresAt?: string;
  scheduled?: boolean;
}

export interface HeartbeatEvent {
  conversationId: string;
  activeStreams: number;
}

// ---- Binary resolution ----

let cachedBinPath: string | undefined;

/** Resolve the `convos` CLI binary from the installed @convos/cli package. */
function resolveConvosBin(): string {
  if (cachedBinPath) {
    return cachedBinPath;
  }

  // Strategy 1: createRequire from this file's URL
  try {
    const require = createRequire(import.meta.url);
    const mainPath = require.resolve("@xmtp/convos-cli");
    // mainPath = .../node_modules/@xmtp/convos-cli/dist/index.js → go up to package root
    const pkgRoot = path.resolve(path.dirname(mainPath), "..");
    const binPath = path.join(pkgRoot, "bin", "run.js");
    if (existsSync(binPath)) {
      cachedBinPath = binPath;
      return binPath;
    }
  } catch {
    // import.meta.url may not resolve when loaded via jiti
  }

  // Strategy 2: walk up from this file to find extension's node_modules
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const extRoot = path.resolve(thisDir, "..");
    const binPath = path.join(extRoot, "node_modules", "@xmtp", "convos-cli", "bin", "run.js");
    if (existsSync(binPath)) {
      cachedBinPath = binPath;
      return binPath;
    }
  } catch {
    // fileURLToPath may fail for non-file: URLs
  }

  // Strategy 3: check OPENCLAW_STATE_DIR/extensions/convos/node_modules
  {
    const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
    const binPath = path.join(stateDir, "extensions", "convos", "node_modules", "@xmtp", "convos-cli", "bin", "run.js");
    if (existsSync(binPath)) {
      cachedBinPath = binPath;
      return binPath;
    }
  }

  // Fallback: assume `convos` is on PATH
  cachedBinPath = "convos";
  return "convos";
}

// ---- Constants ----

/** Max number of automatic restarts for the agent serve process. */
const MAX_RESTARTS = 5;
/** Base delay between restarts (multiplied by attempt number). */
const RESTART_BASE_DELAY_MS = 2000;
/** After this many ms of sustained uptime, reset the restart counter. */
const RESTART_RESET_AFTER_MS = 60_000;

// ---- ConvosInstance ----

export class ConvosInstance {
  readonly conversationId: string;
  readonly identityId: string;
  readonly label: string | undefined;
  /** XMTP inbox ID — set from the `ready` event. */
  inboxId: string | null = null;

  private env: "production" | "dev";
  private child: ChildProcess | null = null;
  private running = false;
  private restartCount = 0;
  private lastStartTime = 0;
  private options: ConvosInstanceOptions;

  /** Resolves when the `ready` event is received after start(). */
  private readyPromiseResolve?: (info: ReadyEvent) => void;
  private readyPromiseReject?: (err: Error) => void;

  /** Pending sendMessage calls waiting for `sent` confirmation. */
  private pendingSends = new Map<string, {
    resolve: (result: { success: boolean; messageId?: string }) => void;
    reject: (err: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private sendCounter = 0;

  private constructor(params: {
    conversationId: string;
    identityId: string;
    label?: string;
    env: "production" | "dev";
    options?: ConvosInstanceOptions;
  }) {
    this.conversationId = params.conversationId;
    this.identityId = params.identityId;
    this.label = params.label;
    this.env = params.env;
    this.options = params.options ?? {};
  }

  // ---- CLI helpers ----

  /** Run a one-shot convos command and return raw stdout. */
  private async exec(args: string[]): Promise<string> {
    const bin = resolveConvosBin();
    const finalArgs = [...args, "--env", this.env];
    if (this.options.debug) {
      console.log(`[convos] exec: convos ${finalArgs.join(" ")}`);
    }
    const { stdout } = await execFileAsync(
      bin === "convos" ? bin : process.execPath,
      bin === "convos" ? finalArgs : [bin, ...finalArgs],
      { env: { ...process.env, CONVOS_ENV: this.env } },
    );
    return stdout;
  }

  /** Run a one-shot convos command with --json and parse the JSON output. */
  private async execJson<T>(args: string[]): Promise<T> {
    const stdout = await this.exec([...args, "--json"]);
    const lastBrace = stdout.lastIndexOf("}");
    if (lastBrace !== -1) {
      let depth = 0;
      for (let i = lastBrace; i >= 0; i--) {
        if (stdout[i] === "}") depth++;
        else if (stdout[i] === "{") depth--;
        if (depth === 0) {
          return JSON.parse(stdout.slice(i, lastBrace + 1)) as T;
        }
      }
    }
    return JSON.parse(stdout.trim()) as T;
  }

  // ==== Factory Methods ====

  /** Restore from config (gateway restart). No CLI call needed — just construct. */
  static fromExisting(
    conversationId: string,
    identityId: string,
    env: "production" | "dev",
    options?: ConvosInstanceOptions,
    label?: string,
  ): ConvosInstance {
    return new ConvosInstance({ conversationId, identityId, label, env, options });
  }

  /** Create a new conversation via `convos conversations create`. */
  static async create(
    env: "production" | "dev",
    params?: {
      name?: string;
      profileName?: string;
      description?: string;
      imageUrl?: string;
      permissions?: "all-members" | "admin-only";
    },
    options?: ConvosInstanceOptions,
  ): Promise<{ instance: ConvosInstance; result: CreateConversationResult }> {
    const args = ["conversations", "create"];
    if (params?.name) args.push("--name", params.name);
    if (params?.profileName) args.push("--profile-name", params.profileName);
    if (params?.description) args.push("--description", params.description);
    if (params?.imageUrl) args.push("--image-url", params.imageUrl);
    if (params?.permissions) args.push("--permissions", params.permissions);

    const tmp = new ConvosInstance({ conversationId: "", identityId: "", env, options });
    const data = await tmp.execJson<{
      conversationId: string;
      identityId: string;
      name?: string;
      inboxId: string;
      invite: { slug: string; url: string };
    }>(args);

    const instance = new ConvosInstance({
      conversationId: data.conversationId,
      identityId: data.identityId,
      label: params?.name,
      env,
      options,
    });
    instance.inboxId = data.inboxId;

    return {
      instance,
      result: {
        conversationId: data.conversationId,
        inviteSlug: data.invite.slug,
        inviteUrl: data.invite.url,
      },
    };
  }

  /** Join a conversation via `convos conversations join`. */
  static async join(
    env: "production" | "dev",
    invite: string,
    params?: { profileName?: string; timeout?: number },
    options?: ConvosInstanceOptions,
  ): Promise<{
    instance: ConvosInstance | null;
    status: "joined" | "waiting_for_acceptance";
    conversationId: string | null;
    identityId: string | null;
  }> {
    const args = ["conversations", "join", invite];
    if (params?.profileName) args.push("--profile-name", params.profileName);
    args.push("--timeout", String(params?.timeout ?? 60));

    const tmp = new ConvosInstance({ conversationId: "", identityId: "", env, options });

    let data: {
      status: string;
      conversationId?: string;
      identityId: string;
      inboxId?: string;
      tag?: string;
      name?: string;
    };

    try {
      data = await tmp.execJson<typeof data>(args);
    } catch (err) {
      const msg = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : String(err);
      const alreadyJoined = /Already joined this conversation/i.test(msg);
      if (alreadyJoined) {
        const identityMatch = msg.match(/Identity:\s*([a-f0-9]+)/);
        const conversationMatch = msg.match(/Conversation:\s*([a-f0-9]+)/);
        if (identityMatch && conversationMatch) {
          const identityId = identityMatch[1];
          const conversationId = conversationMatch[1];
          const instance = new ConvosInstance({ conversationId, identityId, env, options });
          return { instance, status: "joined", conversationId, identityId };
        }
      }
      throw err;
    }

    if (data.status === "joined" && data.conversationId) {
      const instance = new ConvosInstance({
        conversationId: data.conversationId,
        identityId: data.identityId,
        label: data.name,
        env,
        options,
      });
      if (data.inboxId) instance.inboxId = data.inboxId;
      return {
        instance,
        status: "joined",
        conversationId: data.conversationId,
        identityId: data.identityId,
      };
    }

    return {
      instance: null,
      status: "waiting_for_acceptance",
      conversationId: null,
      identityId: data.identityId,
    };
  }

  // ==== Lifecycle ====

  /** Start the agent serve process. Resolves when the `ready` event is received. */
  async start(): Promise<ReadyEvent> {
    if (this.running) {
      throw new Error("Instance already running");
    }
    this.running = true;
    this.restartCount = 0;
    const ready = await this.spawnAgentServe();
    if (this.options.debug) {
      console.log(`[convos] Started: ${this.conversationId.slice(0, 12)}... (inboxId: ${ready.inboxId?.slice(0, 12)}...)`);
    }
    return ready;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.child) {
      // Send graceful stop command
      this.writeCommand({ type: "stop" });
      // Give it 3 seconds to exit gracefully
      const child = this.child;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try { child.kill("SIGTERM"); } catch { /* ignore */ }
          resolve();
        }, 3000);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.child = null;
    }

    // Reject any pending sends
    for (const [, pending] of this.pendingSends) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Instance stopped"));
    }
    this.pendingSends.clear();

    if (this.options.debug) {
      console.log(`[convos] Stopped: ${this.conversationId.slice(0, 12)}...`);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  isStreaming(): boolean {
    return this.running && this.child !== null && this.child.exitCode === null;
  }

  get envName(): "production" | "dev" {
    return this.env;
  }

  // ==== Operations (via stdin commands) ====

  async sendMessage(text: string, replyTo?: string): Promise<{ success: boolean; messageId?: string }> {
    this.assertRunning();
    const cmd: Record<string, unknown> = { type: "send", text };
    if (replyTo) cmd.replyTo = replyTo;
    return this.sendAndWait(cmd);
  }

  async sendAttachment(file: string): Promise<{ success: boolean; messageId?: string }> {
    this.assertRunning();
    return this.sendAndWait({ type: "attach", file });
  }

  async downloadAttachment(messageId: string, outputPath: string): Promise<string> {
    await this.exec([
      "conversation", "download-attachment",
      this.conversationId, messageId,
      "--output", outputPath,
    ]);
    return outputPath;
  }

  async react(
    messageId: string,
    emoji: string,
    action: "add" | "remove" = "add",
  ): Promise<{ success: boolean; action: "added" | "removed" }> {
    this.assertRunning();
    this.writeCommand({ type: "react", messageId, emoji, action });
    // React doesn't need confirmation tracking — fire and forget
    return { success: true, action: action === "add" ? "added" : "removed" };
  }

  async rename(name: string): Promise<void> {
    this.assertRunning();
    this.writeCommand({ type: "rename", name });
  }

  async lock(): Promise<void> {
    this.assertRunning();
    this.writeCommand({ type: "lock" });
  }

  async unlock(): Promise<void> {
    this.assertRunning();
    this.writeCommand({ type: "unlock" });
  }

  async explode(): Promise<void> {
    this.assertRunning();
    this.writeCommand({ type: "explode" });
    // Explode triggers shutdown of the child process
  }

  /** One-shot: get invite info (not available via agent serve stdin). */
  async getInvite(): Promise<{ inviteSlug: string }> {
    const data = await this.execJson<{ slug: string; url: string }>([
      "conversation",
      "invite",
      this.conversationId,
      "--no-qr",
    ]);
    return { inviteSlug: data.slug };
  }

  // ==== Private: Agent Serve Process Management ====

  private spawnAgentServe(): Promise<ReadyEvent> {
    return new Promise<ReadyEvent>((resolve, reject) => {
      this.readyPromiseResolve = resolve;
      this.readyPromiseReject = reject;

      const bin = resolveConvosBin();
      const args = ["agent", "serve", this.conversationId, "--env", this.env, "--json"];
      if (this.options.heartbeatSeconds && this.options.heartbeatSeconds > 0) {
        args.push("--heartbeat", String(this.options.heartbeatSeconds));
      }

      if (this.options.debug) {
        console.log(`[convos] spawn: convos ${args.join(" ")}`);
      }

      const child = spawn(
        bin === "convos" ? bin : process.execPath,
        bin === "convos" ? args : [bin, ...args],
        {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, CONVOS_ENV: this.env },
        },
      );

      this.child = child;
      this.lastStartTime = Date.now();

      child.on("error", (err) => {
        console.error(`[convos] spawn error: ${String(err)}`);
        if (this.readyPromiseReject) {
          this.readyPromiseReject(err);
          this.readyPromiseResolve = undefined;
          this.readyPromiseReject = undefined;
        }
      });

      // Parse stdout as ndjson
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on("line", (line) => this.handleEvent(line));
      }

      // Always log stderr for diagnostics (crash messages, XMTP errors)
      if (child.stderr) {
        const rl = createInterface({ input: child.stderr });
        rl.on("line", (line) => {
          console.error(`[convos:stderr] ${line}`);
        });
      }

      child.on("exit", (code) => {
        this.child = null;

        // Reject pending sends
        for (const [, pending] of this.pendingSends) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`Process exited with code ${code}`));
        }
        this.pendingSends.clear();

        // Reject ready promise if still pending
        if (this.readyPromiseReject) {
          this.readyPromiseReject(new Error(`Process exited with code ${code} before ready`));
          this.readyPromiseResolve = undefined;
          this.readyPromiseReject = undefined;
        }

        // Notify callback
        this.options.onExit?.(code);

        // Auto-restart if still supposed to be running
        if (this.running) {
          // Reset counter if we had sustained uptime
          if (Date.now() - this.lastStartTime > RESTART_RESET_AFTER_MS) {
            this.restartCount = 0;
          }

          this.restartCount++;
          if (this.restartCount <= MAX_RESTARTS) {
            const delayMs = RESTART_BASE_DELAY_MS * this.restartCount;
            console.error(
              `[convos] Process exited with code ${code}, restarting in ${delayMs}ms (attempt ${this.restartCount}/${MAX_RESTARTS})`,
            );
            setTimeout(() => {
              if (!this.running) return;
              this.spawnAgentServe().catch((err) => {
                console.error(`[convos] Restart failed: ${String(err)}`);
              });
            }, delayMs);
          } else {
            console.error(`[convos] Max restarts reached (${MAX_RESTARTS}), giving up`);
            this.running = false;
          }
        }
      });
    });
  }

  private handleEvent(line: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      if (this.options.debug) {
        console.log(`[convos] non-JSON: ${line}`);
      }
      return;
    }

    const event = data.event as string;

    if (this.options.debug) {
      console.log(`[convos] event: ${event} ${JSON.stringify(data)}`);
    }

    switch (event) {
      case "ready": {
        const info: ReadyEvent = {
          conversationId: data.conversationId as string,
          identityId: data.identityId as string,
          inboxId: data.inboxId as string,
          address: data.address as string,
          name: (data.name as string) ?? "",
          inviteUrl: data.inviteUrl as string | undefined,
          inviteSlug: data.inviteSlug as string | undefined,
          inviteTag: data.inviteTag as string | undefined,
          qrCodePath: data.qrCodePath as string | undefined,
        };
        this.inboxId = info.inboxId;
        this.options.onReady?.(info);
        if (this.readyPromiseResolve) {
          this.readyPromiseResolve(info);
          this.readyPromiseResolve = undefined;
          this.readyPromiseReject = undefined;
        }
        break;
      }

      case "message": {
        const msg: InboundMessage = {
          conversationId: this.conversationId,
          messageId: (data.id as string) ?? "",
          senderId: (data.senderInboxId as string) ?? "",
          senderName: (data.senderProfile as { name?: string } | undefined)?.name ?? "",
          content: (data.content as string) ?? "",
          contentType: typeof data.contentType === "object" && data.contentType !== null
            ? ((data.contentType as Record<string, unknown>).typeId as string | undefined)
            : (data.contentType as string | undefined),
          timestamp: typeof data.sentAt === "string" ? new Date(data.sentAt) : new Date(),
          catchup: (data.catchup as boolean) ?? false,
        };
        this.options.onMessage?.(msg);
        break;
      }

      case "member_joined": {
        this.options.onMemberJoined?.({
          joinerInboxId: (data.inboxId as string) ?? "",
          conversationId: (data.conversationId as string) ?? this.conversationId,
          catchup: (data.catchup as boolean) ?? false,
        });
        break;
      }

      case "sent": {
        const info: SentEvent = {
          id: data.id as string | undefined,
          text: data.text as string | undefined,
          type: data.type as string | undefined,
          messageId: data.messageId as string | undefined,
          emoji: data.emoji as string | undefined,
          action: data.action as string | undefined,
          name: data.name as string | undefined,
          conversationId: data.conversationId as string | undefined,
          identityDestroyed: data.identityDestroyed as string | undefined,
          membersRemoved: data.membersRemoved as number | undefined,
          expiresAt: data.expiresAt as string | undefined,
          scheduled: data.scheduled as boolean | undefined,
        };

        // Resolve pending send — any confirmation with an id (text, attachment, reaction, etc.)
        if (info.id) {
          const firstKey = this.pendingSends.keys().next().value;
          if (firstKey !== undefined) {
            const pending = this.pendingSends.get(firstKey);
            if (pending) {
              this.pendingSends.delete(firstKey);
              clearTimeout(pending.timeout);
              pending.resolve({ success: true, messageId: info.id });
            }
          }
        }

        this.options.onSent?.(info);
        break;
      }

      case "heartbeat": {
        this.options.onHeartbeat?.({
          conversationId: (data.conversationId as string) ?? this.conversationId,
          activeStreams: (data.activeStreams as number) ?? 0,
        });
        break;
      }

      case "error": {
        const message = (data.message as string) ?? "Unknown error";
        console.error(`[convos] error event: ${message}`);
        this.options.onError?.({ message });
        break;
      }

      default: {
        if (this.options.debug) {
          console.log(`[convos] unknown event: ${event}`);
        }
      }
    }
  }

  private writeCommand(cmd: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) {
      throw new Error("Agent serve process not running or stdin not writable");
    }
    if (this.options.debug) {
      console.log(`[convos] stdin: ${JSON.stringify(cmd)}`);
    }
    this.child.stdin.write(JSON.stringify(cmd) + "\n");
  }

  /**
   * Send a command and wait for a `sent` confirmation event.
   * Used for sendMessage where we need the returned messageId.
   */
  private sendAndWait(cmd: Record<string, unknown>): Promise<{ success: boolean; messageId?: string }> {
    return new Promise((resolve, reject) => {
      const key = `send-${++this.sendCounter}`;
      const timeout = setTimeout(() => {
        this.pendingSends.delete(key);
        // Don't reject — the message was probably sent, we just didn't get confirmation
        resolve({ success: true, messageId: undefined });
      }, 30_000);

      this.pendingSends.set(key, { resolve, reject, timeout });
      this.writeCommand(cmd);
    });
  }

  private assertRunning(): void {
    if (!this.running) {
      throw new Error("Convos instance not running");
    }
  }
}
