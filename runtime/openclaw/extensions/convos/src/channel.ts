import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type PluginRuntime,
  type ReplyPayload,
} from "openclaw/plugin-sdk/core";
import {
  listConvosAccountIds,
  resolveConvosAccount,
  resolveDefaultConvosAccountId,
  type CoreConfig,
  type ResolvedConvosAccount,
} from "./accounts.js";
import { convosMessageActions } from "./actions.js";
import { convosChannelConfigSchema } from "./config-schema.js";
import { convosOnboardingAdapter } from "./onboarding.js";
import { convosOutbound, getConvosInstance, setConvosInstance } from "./outbound.js";
import { applyOutboundTextPolicy } from "./outbound-policy.js";
import { getConvosRuntime } from "./runtime.js";
import { ConvosInstance, type InboundMessage } from "./sdk-client.js";
import { clearConvosCredentials } from "./credentials.js";
import { stats } from "./stats.js";

let _cachedMessagingHints: string[] | null = null;

function loadConvosMessagingHints(): string[] {
  if (_cachedMessagingHints) return _cachedMessagingHints;
  let thisDir: string | undefined;
  try {
    thisDir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // jiti or non-file: URL — skip this candidate
  }
  const candidates = [
    path.resolve(process.env.OPENCLAW_STATE_DIR || ".", "workspace", "INJECTED_CONTEXT.md"),
    ...(thisDir ? [path.resolve(thisDir, "..", "..", "workspace", "INJECTED_CONTEXT.md")] : []),
  ];
  for (const hintsPath of candidates) {
    try {
      const content = fs.readFileSync(hintsPath, "utf-8");
      _cachedMessagingHints = content
        .split("\n---\n")
        .map((s) => s.split("\n").filter((line) => !line.startsWith("#")).join("\n").trim())
        .filter((s) => s.length > 0);
      return _cachedMessagingHints;
    } catch {
      continue;
    }
  }
  console.warn("INJECTED_CONTEXT.md not found — agent will lack messaging hints");
  _cachedMessagingHints = [];
  return _cachedMessagingHints;
}

/** Sender ID for synthetic system messages (greeting dispatch, etc.). */
const SYSTEM_SENDER_ID = "system" as const;

const GROUP_EXPIRATION_UPDATE_RE = /\bset conversation expiration to ([^;]+)(?:;|$)/i;
const GROUP_EXPIRATION_CLEARED_RE = /\bcleared conversation expiration(?:;|$)/i;
const EXPLOSION_IMMEDIATE_SKEW_MS = 3_000;
const GROUP_UPDATE_SEPARATOR_RE = /\s*;\s*/;

type RuntimeLogger = {
  info: (msg: string) => void;
  error: (msg: string) => void;
  warn?: (msg: string) => void;
};

// Captured resolve function from the startAccount blocking promise.
// selfDestruct() calls this to unblock startAccount after stopping the instance,
// preventing the gateway from becoming a zombie process.
let resolveStartAccountBlock: (() => void) | null = null;
let nextExpirationCheckTimer: ReturnType<typeof setTimeout> | null = null;
let nextExpirationCheckAtMs: number | null = null;

const meta = {
  id: "convos",
  label: "Convos",
  selectionLabel: "Convos (XMTP)",
  docsPath: "/channels/convos",
  docsLabel: "convos",
  blurb: "E2E encrypted messaging via XMTP",
  systemImage: "lock.shield.fill",
  order: 75,
  quickstartAllowFrom: false,
};

function normalizeConvosMessagingTarget(raw: string): string | undefined {
  let normalized = raw.trim();
  if (!normalized) {
    // No explicit target — fall back to the bound conversation so cron jobs
    // (and other callers) that omit delivery.to still route correctly.
    const inst = getConvosInstance();
    return inst?.conversationId;
  }
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("convos:")) {
    normalized = normalized.slice("convos:".length).trim();
  }
  if (!normalized) {
    const inst = getConvosInstance();
    return inst?.conversationId;
  }
  // Single-conversation process: if the target isn't already a conversation ID,
  // resolve it to the bound conversation so the framework's looksLikeId check
  // passes and we skip directory name-matching (which would reject arbitrary
  // strings like "heartbeat" or "last").
  const inst = getConvosInstance();
  if (inst && !isConvosId(normalized)) {
    return inst.conversationId;
  }
  return normalized;
}

/** Check if a string looks like a Convos conversation ID (hex-32 or UUID). */
function isConvosId(s: string): boolean {
  return /^[0-9a-f]{32}$/i.test(s) || /^[0-9a-f-]{36}$/i.test(s);
}

const CONVOS_IMG_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve the media directory for downloaded image attachments.
 * Uses {stateDir}/media instead of os.tmpdir() to avoid macOS symlink mismatch:
 * os.tmpdir() returns /var/folders/... but realpath resolves to /private/var/folders/...
 * and openclaw's allowed-directory check realpaths the file but not the root, causing
 * a startsWith failure. {stateDir}/media is an allowed root without symlink issues.
 */
let cachedMediaDir: string | undefined;
function resolveMediaDir(): string {
  if (cachedMediaDir) return cachedMediaDir;
  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const mediaDir = path.join(stateDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  cachedMediaDir = mediaDir;
  return mediaDir;
}

/** Remove convos-img-* temp files older than CONVOS_IMG_MAX_AGE_MS. Throttled to at most once per 5 minutes. */
const PRUNE_THROTTLE_MS = 5 * 60 * 1000;
let lastPruneAt = 0;
function pruneStaleConvosImages() {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_THROTTLE_MS) return;
  lastPruneAt = now;
  const tmpDir = resolveMediaDir();
  fs.readdir(tmpDir, (err, entries) => {
    if (err) return;
    for (const entry of entries) {
      if (!entry.startsWith("convos-img-")) continue;
      const fullPath = path.join(tmpDir, entry);
      fs.stat(fullPath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > CONVOS_IMG_MAX_AGE_MS) {
          fs.unlink(fullPath, () => {});
        }
      });
    }
  });
}

/** Map file extension to MIME type for the media pipeline. */
const extToMime: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic",
  ".heif": "image/heif", ".bmp": "image/bmp",
  ".tif": "image/tiff", ".tiff": "image/tiff",
  ".avif": "image/avif", ".svg": "image/svg+xml",
};

/**
 * Pending image attachment downloads waiting for a companion text message.
 * XMTP sends image+text as separate protocol messages. The image arrives first
 * but takes seconds to download, while the text arrives almost immediately.
 * We hold the image and merge it with the companion text when it arrives.
 */
const COMPANION_SETTLE_MS = 1500;
const pendingCompanionImage = new Map<string, {
  downloadPromise: Promise<string | undefined>;
  originalMsg: InboundMessage;
  timer: ReturnType<typeof setTimeout>;
}>();

export const convosPlugin: ChannelPlugin<ResolvedConvosAccount> = {
  id: "convos",
  meta,
  capabilities: {
    chatTypes: ["group"],
    reactions: true,
    threads: false,
    media: true,
  },
  groups: {
    resolveRequireMention: () => false,
  },
  reload: { configPrefixes: ["channels.convos"] },
  configSchema: convosChannelConfigSchema,
  onboarding: convosOnboardingAdapter,
  actions: convosMessageActions,
  agentPrompt: {
    messageToolHints: () => loadConvosMessagingHints(),
  },
  config: {
    listAccountIds: (cfg) => listConvosAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveConvosAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultConvosAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "convos",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "convos",
        accountId,
        clearBaseFields: ["name", "identityId", "env", "debug", "systemPrompt", "ownerConversationId"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      env: account.env,
    }),
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.convos.dmPolicy",
      allowFromPath: "channels.convos.allowFrom",
    }),
  },
  pairing: {
    idLabel: "inbox ID",
    normalizeAllowEntry: (entry) => {
      const trimmed = entry.trim();
      if (!trimmed) {
        return trimmed;
      }
      if (trimmed.toLowerCase().startsWith("convos:")) {
        return trimmed.slice("convos:".length).trim();
      }
      return trimmed;
    },
    notifyApproval: async ({ id }) => {
      const inst = getConvosInstance();
      if (!inst) {
        return;
      }
      try {
        await inst.sendMessage(`Device paired successfully (inbox: ${id.slice(0, 12)}...)`);
      } catch {
        // Ignore notification errors
      }
    },
  },
  messaging: {
    normalizeTarget: normalizeConvosMessagingTarget,
    targetResolver: {
      looksLikeId: (_raw, normalized) => {
        const trimmed = (normalized ?? _raw).trim();
        if (!trimmed) {
          return false;
        }
        // Convos conversation IDs are hex strings (32 chars) or UUIDs (36 chars with dashes)
        return (
          /^[0-9a-f]{32}$/i.test(trimmed) ||
          /^[0-9a-f-]{36}$/i.test(trimmed) ||
          trimmed.includes("/")
        );
      },
      hint: "<conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => {
      // Single-conversation process — always return the bound conversation.
      // This lets the heartbeat (and any other caller) resolve any target string
      // to the active conversation without knowing the ID upfront.
      const inst = getConvosInstance();
      if (!inst) {
        return [];
      }
      return [{ kind: "group" as const, id: inst.conversationId, name: inst.label ?? inst.conversationId.slice(0, 8) }];
    },
  },
  outbound: convosOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) {
          return [];
        }
        return [
          {
            channel: "convos",
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      env: snapshot.env ?? "production",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      if (!account.ownerConversationId) {
        return {
          ok: false,
          error: "Not configured. Run 'openclaw configure' to set up Convos.",
        };
      }
      const inst = getConvosInstance();
      if (inst?.isRunning()) {
        return { ok: true };
      }
      return {
        ok: false,
        error: "Convos instance not running. Restart the gateway.",
      };
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      env: account.env,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastProbeAt: runtime?.lastProbeAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { account, abortSignal, setStatus, log } = ctx;
      const runtime = getConvosRuntime();

      if (!account.ownerConversationId) {
        throw new Error("Convos not configured. Run 'openclaw configure' to set up.");
      }

      setStatus({
        accountId: account.accountId,
        env: account.env,
      });

      log?.info(`[${account.accountId}] starting Convos provider (env: ${account.env})`);

      // Clear the OpenClaw delivery queue on restart. XMTP messages are
      // durable on the network once sent — replaying "pending" deliveries
      // after a container restart causes verbatim duplicate messages because
      // the queue entry survived a SIGKILL but the send had already succeeded.
      const stateDir = process.env.OPENCLAW_STATE_DIR || "";
      if (stateDir) {
        const queueDir = path.join(stateDir, "delivery-queue");
        if (fs.existsSync(queueDir)) {
          try {
            const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
            if (files.length > 0) {
              for (const f of files) {
                fs.unlinkSync(path.join(queueDir, f));
              }
              log?.info(`[${account.accountId}] Cleared ${files.length} stale delivery queue entries`);
            }
          } catch (err) {
            log?.error(`[${account.accountId}] Failed to clear delivery queue: ${String(err)}`);
          }
        }
      }

      // Inherit env so exec tool CLI commands use the correct XMTP network
      process.env.CONVOS_ENV = account.env;
      // Expose conversation ID so the agent's exec tool can use $CONVOS_CONVERSATION_ID
      process.env.CONVOS_CONVERSATION_ID = account.ownerConversationId;


      // Restore instance from config — the CLI manages identities on disk
      const inst = ConvosInstance.fromExisting(
        account.ownerConversationId,
        account.identityId ?? "",
        account.env,
        {
          debug: account.debug,
          heartbeatSeconds: 30,
          onMessage: (msg: InboundMessage) => {
            handleInboundMessage(account, msg, runtime, log).catch((err) => {
              log?.error(`[${account.accountId}] Message handling failed: ${String(err)}`);
            });
          },
          onMemberJoined: (info) => {
            log?.info(`[${account.accountId}] Join accepted: ${info.joinerInboxId}${info.catchup ? " (catchup)" : ""}`);
            // Member name cache is updated by profile_snapshot messages
            // (sent automatically after adding members), not here.
          },
          // onHeartbeat: (info) => {
          //   if (account.debug) {
          //     log?.info(`[${account.accountId}] Heartbeat: ${info.activeStreams} active streams`);
          //   }
          // },
          onExit: (code) => {
            log?.error(`[${account.accountId}] Agent serve process exited with code ${code}`);
          },
        },
      );

      setConvosInstance(inst);
      await inst.start();

      log?.info(
        `[${account.accountId}] Convos provider started (conversation: ${inst.conversationId.slice(0, 12)}...)`,
      );

      try {
        await dispatchWorkspaceRefresh(account, runtime, log);
      } catch (err) {
        log?.error(`[${account.accountId}] Workspace refresh dispatch failed: ${String(err)}`);
      }

      // Block until abort signal fires or selfDestruct() resolves the promise.
      await new Promise<void>((resolve) => {
        resolveStartAccountBlock = resolve;
        const onAbort = () => {
          resolveStartAccountBlock = null;
          void stopInstance(account.accountId, log).finally(resolve);
        };
        if (abortSignal?.aborted) {
          onAbort();
          return;
        }
        abortSignal?.addEventListener("abort", onAbort, { once: true });
      });
    },
    stopAccount: async (ctx) => {
      const { account, log } = ctx;
      log?.info(`[${account.accountId}] stopping Convos provider`);
      await stopInstance(account.accountId, log);
    },
  },
};

/**
 * Handle inbound messages from CLI stream — dispatches to the reply pipeline
 */
async function handleInboundMessage(
  account: ResolvedConvosAccount,
  msg: InboundMessage,
  runtime: PluginRuntime,
  log?: RuntimeLogger,
  /** Pre-resolved media path for held attachments re-entering via timeout/flush. */
  preResolvedMediaPath?: string,
  suppressOutboundReply = false,
) {
  const inst = getConvosInstance();
  const debugLog = (msg: string) => log ? log.info(msg) : console.log(msg);
  const errorLog = (msg: string) => log ? log.error(msg) : console.error(msg);

  // Self-echo filtering is handled by `convos agent serve` — messages from
  // our own inboxId are never emitted. No filtering needed here.

  // Keep member name cache current from inbound messages (skip synthetic system sender)
  if (inst && msg.senderName && msg.senderId && msg.senderId !== SYSTEM_SENDER_ID) {
    inst.setMemberName(msg.senderId, msg.senderName);
  }

  if (account.debug) {
    debugLog(
      `[${account.accountId}] Inbound message from ${msg.senderId}: ${msg.content.slice(0, 50)}${msg.catchup ? " (catchup)" : ""}`,
    );
  }

  // Safety assertion: all messages should be from our bound conversation
  if (msg.conversationId !== inst?.conversationId) {
    log?.warn?.(
      `[${account.accountId}] Message from unexpected conversation: ${msg.conversationId}`,
    );
    return;
  }

  // Telemetry: count inbound messages (skip catchup, group_updated, reactions)
  if (inst && !msg.catchup && msg.contentType !== "group_updated" && msg.contentType !== "reaction") {
    stats.increment("messages_in");
    const members = inst.getGroupMembers();
    if (members) {
      stats.set("group_member_count", members.split(", ").length);
    }
  }

  if (
    inst &&
    !msg.catchup &&
    msg.contentType !== "group_updated" &&
    msg.contentType !== "reaction"
  ) {
    try {
      await inst.renewProfileImageOnActivity();
    } catch (err) {
      errorLog(`[${account.accountId}] Failed to renew profile image on activity: ${String(err)}`);
    }

    // TEMPORARILY DISABLED — read receipts causing issues
    // inst.sendReadReceipt().catch(() => {});
  }

  const cfg = runtime.config.loadConfig();
  const rawBody = msg.content;

  const route = runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "convos",
    accountId: account.accountId,
    peer: {
      kind: "group",
      id: msg.conversationId,
    },
  });

  const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });

  const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const body = runtime.channel.reply.formatAgentEnvelope({
    channel: "Convos",
    from: msg.senderName || msg.senderId.slice(0, 12),
    timestamp: msg.timestamp.getTime(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  // --- Image attachment handling ---
  // XMTP sends image+text as two separate protocol messages. The image arrives
  // first but takes seconds to download, while the companion text arrives almost
  // immediately after. Without coordination the text races ahead (no download
  // needed) and the agent responds to text alone, then responds again to the
  // image — producing two replies instead of one.
  //
  // Fix: hold image attachments briefly. If a text from the same sender arrives
  // within the settle window, merge them into one dispatch (text body + image).
  // If no text follows, dispatch the image alone after timeout.
  //
  // Content format from the CLI:
  //   remoteStaticAttachment: "[remote attachment: filename (-1 bytes) https://...encrypted.bin]"
  //   attachment:             "[attachment: filename (size bytes)]"
  let mediaPath: string | undefined = preResolvedMediaPath;

  // Check for a pending companion image to merge with this text message
  if (!mediaPath && (msg.contentType === "text" || msg.contentType === "reply")) {
    const pendingKey = `${msg.conversationId}:${msg.senderId}`;
    const pending = pendingCompanionImage.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCompanionImage.delete(pendingKey);
      mediaPath = await pending.downloadPromise;
      if (account.debug) {
        debugLog(`[${account.accountId}] Merged companion image with text message`);
      }
    }
  }

  // Hold new image attachment for companion text
  if (!mediaPath && (msg.contentType === "remoteStaticAttachment" || msg.contentType === "attachment")) {
    try {
      const filenameMatch = msg.content.match(/:\s+(\S+\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|svg))\s/i);
      const ext = filenameMatch?.[2] ? `.${filenameMatch[2].toLowerCase()}` : "";

      if (filenameMatch && inst) {
        const safeId = msg.messageId.replace(/[^a-zA-Z0-9-]/g, "");
        const imgPath = path.join(resolveMediaDir(), `convos-img-${safeId}${ext}`);

        const downloadPromise: Promise<string | undefined> = inst
          .downloadAttachment(msg.messageId, imgPath)
          .then(() => {
            pruneStaleConvosImages();
            if (account.debug) {
              debugLog(`[${account.accountId}] Image attachment downloaded: ${imgPath}`);
            }
            return imgPath;
          })
          .catch((err) => {
            errorLog(`[${account.accountId}] Failed to download attachment: ${String(err)}`);
            return undefined;
          });

        // Hold — wait for companion text from the same sender
        const holdKey = `${msg.conversationId}:${msg.senderId}`;
        const existing = pendingCompanionImage.get(holdKey);
        if (existing) {
          // A previous image is already held (e.g. multiple photos in quick
          // succession). Dispatch it now so it isn't silently dropped.
          clearTimeout(existing.timer);
          pendingCompanionImage.delete(holdKey);
          existing.downloadPromise.then((resolvedPath) => {
            if (!resolvedPath) return; // Download failed — don't retry
            handleInboundMessage(account, existing.originalMsg, runtime, log, resolvedPath).catch((err) => {
              errorLog(`[${account.accountId}] Failed to flush held attachment: ${String(err)}`);
            });
          });
        }

        const timer = setTimeout(async () => {
          const entry = pendingCompanionImage.get(holdKey);
          if (!entry) return; // Already merged with companion text
          pendingCompanionImage.delete(holdKey);
          // No companion text arrived — dispatch attachment alone via re-entry
          const resolvedPath = await entry.downloadPromise;
          if (!resolvedPath) return; // Download failed — don't retry
          handleInboundMessage(account, msg, runtime, log, resolvedPath).catch((err) => {
            errorLog(`[${account.accountId}] Failed to process held attachment: ${String(err)}`);
          });
        }, COMPANION_SETTLE_MS);

        pendingCompanionImage.set(holdKey, { downloadPromise, originalMsg: msg, timer });
        return; // Don't dispatch yet — wait for companion text or timeout
      }
    } catch (err) {
      errorLog(`[${account.accountId}] Failed to process image attachment: ${String(err)}`);
      mediaPath = undefined;
    }
  }

  const mediaMime = mediaPath ? extToMime[path.extname(mediaPath).toLowerCase()] ?? "image/jpeg" : undefined;

  // Inject current wall-clock time as per-turn system context so the agent
  // always knows "now" without calling session_status. Uses the same timezone
  // as the envelope timestamps for consistency. (#306)
  const tz = envelopeOptions.userTimezone || envelopeOptions.timezone || "UTC";
  const currentTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz === "local" || tz === "user" ? undefined : tz,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(Date.now());

  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `convos:${msg.senderId}`,
    To: `convos:${msg.conversationId}`,
    ConversationId: msg.conversationId,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: inst?.label ?? "chat",
    SenderName: msg.senderName || undefined,
    SenderId: msg.senderId,
    Provider: "convos",
    Surface: "convos",
    MessageSid: msg.messageId,
    OriginatingChannel: "convos",
    OriginatingTo: `convos:${msg.conversationId}`,
    GroupSubject: inst?.label ?? undefined,
    GroupMembers: inst?.getGroupMembers() ?? undefined,
    GroupSystemPrompt: [
      account.config?.systemPrompt?.trim(),
      `Current time: ${currentTime}`,
    ].filter(Boolean).join("\n\n"),
    ...(mediaPath ? { MediaPath: mediaPath, MediaType: mediaMime } : {}),
  });

  // Skip session recording for synthetic system messages (e.g. greeting trigger)
  // so the prompt doesn't appear in session history. The agent's response is
  // recorded normally by the reply pipeline.
  if (msg.senderId !== SYSTEM_SENDER_ID) {
    await runtime.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        errorLog(`[${account.accountId}] Failed updating session meta: ${String(err)}`);
      },
    });
  }

  const expirationUpdate = detectConversationExpirationUpdate(msg);
  if (expirationUpdate?.kind === "set") {
    const expirationReachedReason = checkAndRescheduleConversationExpiration(
      expirationUpdate.expiresAtMs,
      account.accountId,
      log,
    );
    if (expirationReachedReason) {
      log?.info(`[${account.accountId}] Conversation exploded, self-destructing (${expirationReachedReason})`);
      await selfDestruct(expirationReachedReason);
      return;
    }
  }
  if (expirationUpdate?.kind === "cleared") {
    clearConversationExpirationCheck(account.accountId, log);
  }

  const membershipTerminationReason = await detectMembershipTerminationReason(msg, inst, log);
  if (membershipTerminationReason) {
    log?.info(`[${account.accountId}] Membership ended, self-destructing (${membershipTerminationReason})`);
    await selfDestruct(membershipTerminationReason);
    return;
  }

  // Group updates are recorded in the session above but should not trigger a reply.
  // Name changes are handled by profile_update messages, not here.
  if (msg.contentType === "group_updated") {
    if (account.debug) {
      debugLog(`[${account.accountId}] Skipping reply dispatch for group_updated message`);
    }
    return;
  }

  // Profile snapshots (sent after adding members) and profile updates (sent when
  // a member changes their name) contain structured member data. Update the cache
  // directly and suppress — these aren't chat messages.
  if ((msg.contentType === "profile_snapshot" || msg.contentType === "profile_update") && inst) {
    try {
      const data = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
      if (msg.contentType === "profile_snapshot") {
        for (const p of data.profiles ?? []) {
          if (p.inboxId && p.name) {
            inst.setMemberName(p.inboxId, p.name);
          }
        }
      } else if (msg.contentType === "profile_update" && msg.senderId) {
        // profile_update is self-authored — senderId is the member
        if (data.name) {
          inst.setMemberName(msg.senderId, data.name);
        }
      }
    } catch {
      // Non-fatal: cache will catch up on next message or refresh
    }
    return;
  }

  // Reactions to the agent's own messages trigger a full agent turn (e.g. thumbs-up
  // to answer a yes/no question). Reactions to other users' messages are already
  // recorded in the session above as passive context — no turn needed.
  if (msg.contentType === "reaction") {
    const targetMatch = msg.content.match(/^(?:reacted|removed)\s+\S+\s+to\s+(\S+)$/);
    const targetId = targetMatch?.[1];
    if (!targetId || !inst?.hasSentMessage(targetId)) {
      if (account.debug) {
        debugLog(`[${account.accountId}] Skipping reply dispatch for non-own reaction`);
      }
      return;
    }
    if (account.debug) {
      debugLog(`[${account.accountId}] Own-message reaction — dispatching agent turn`);
    }
  }

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "convos",
    accountId: account.accountId,
  });

  if (suppressOutboundReply) {
    if (account.debug) {
      debugLog(`[${account.accountId}] Suppressing outbound reply for synthetic system refresh`);
    }

    await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        deliver: async (_payload: ReplyPayload) => {},
        onError: async (err, info) => {
          errorLog(`[${account.accountId}] Convos ${info.kind} refresh failed: ${String(err)}`);
        },
      },
    });
    return;
  }

  // -- Reasoning lane state --
  // Buffer text blocks and classify them by turn context.
  // Text from turns that also call tools = reasoning (suppressed).
  // Text from the final turn (no tools) = answer (delivered).
  //
  // To expose reasoning in the UI instead of suppressing it, replace
  // the isReasoning branch below with delivery using either:
  //
  //   (a) <think> tags — wrap text so the Convos client can parse and
  //       render differently (collapsible, dimmed, italic, etc.):
  //         payload.text = `<think>${p.text}</think>`;
  //         await deliverConvosReply({ payload, ... });
  //
  //   (b) XMTP content type — send as a distinct content type so the
  //       client can render a dedicated reasoning bubble:
  //         await inst.sendContentType("reasoning", p.text);
  //       (requires Convos client + protocol support for the new type)
  //
  let pendingBlocks: ReplyPayload[] = [];
  let currentTurnHasTools = false;

  const flushPending = async (isReasoning: boolean) => {
    if (pendingBlocks.length === 0) return;
    const blocks = pendingBlocks;
    pendingBlocks = [];
    if (isReasoning) {
      for (const p of blocks) {
        if (account.debug) {
          debugLog(`[${account.accountId}] Suppressed reasoning: ${p.text?.substring(0, 80)}`);
        }
      }
      return;
    }
    for (const p of blocks) {
      const policy = await applyOutboundTextPolicy(p.text || "");
      if (policy.suppress) {
        log?.info(`[${account.accountId}] Suppressed outbound text reply`);
        continue;
      }
      const delivered = { ...p, text: policy.text };
      await deliverConvosReply({
        payload: delivered,
        accountId: account.accountId,
        runtime,
        log,
        tableMode,
        triggerMessageId: msg.contentType === "text" || msg.contentType === "reply"
          ? msg.messageId
          : undefined,
      });
    }
  };

  await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: async (payload: ReplyPayload) => {
        // Buffer every block — we don't know yet if this turn has tools.
        pendingBlocks.push(payload);
      },
      onError: async (err, info) => {
        errorLog(`[${account.accountId}] Convos ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onAssistantMessageStart: async () => {
        // New turn starting — flush the previous turn's buffer.
        // If the previous turn had tools, its text was reasoning.
        await flushPending(currentTurnHasTools);
        currentTurnHasTools = false;
      },
      onToolStart: () => {
        currentTurnHasTools = true;
      },
    },
  });

  // Dispatch ended — flush any remaining buffer.
  // The last turn (no more onAssistantMessageStart to trigger flush).
  await flushPending(currentTurnHasTools);
}

function detectConversationExpirationUpdate(msg: InboundMessage):
  | { kind: "set"; expiresAtMs: number }
  | { kind: "cleared" }
  | null {
  if (msg.contentType !== "group_updated") {
    return null;
  }

  if (GROUP_EXPIRATION_CLEARED_RE.test(msg.content)) {
    return { kind: "cleared" };
  }

  const match = msg.content.match(GROUP_EXPIRATION_UPDATE_RE);
  if (!match) {
    return null;
  }

  const expiresAtRaw = match[1]?.trim();
  if (!expiresAtRaw) {
    return null;
  }

  const expiresAtMs = Date.parse(expiresAtRaw);
  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  return { kind: "set", expiresAtMs };
}

function checkAndRescheduleConversationExpiration(
  expiresAtMs: number,
  accountId: string,
  log?: RuntimeLogger,
): string | null {
  const reason = getConversationExpirationReachedReason(expiresAtMs);
  if (reason) {
    clearConversationExpirationCheck(accountId, log, false);
    return reason;
  }

  if (nextExpirationCheckAtMs === expiresAtMs && nextExpirationCheckTimer) {
    return null;
  }

  clearConversationExpirationCheck(accountId, log, false);

  nextExpirationCheckAtMs = expiresAtMs;
  const delayMs = Math.max(0, expiresAtMs - Date.now());
  log?.info(
    `[${accountId}] Scheduled conversation expiration check for ${new Date(expiresAtMs).toISOString()}`,
  );

  nextExpirationCheckTimer = setTimeout(() => {
    nextExpirationCheckTimer = null;
    nextExpirationCheckAtMs = null;

    const expirationReachedReason = getConversationExpirationReachedReason(expiresAtMs);
    if (!expirationReachedReason) {
      return;
    }

    void selfDestruct(expirationReachedReason);
  }, delayMs);
  nextExpirationCheckTimer.unref?.();
  return null;
}

function getConversationExpirationReachedReason(expiresAtMs: number): string | null {
  if (expiresAtMs > Date.now() + EXPLOSION_IMMEDIATE_SKEW_MS) {
    return null;
  }
  return `expiration reached at ${new Date(expiresAtMs).toISOString()}`;
}

function clearConversationExpirationCheck(
  accountId: string,
  log?: RuntimeLogger,
  announce = true,
): void {
  if (nextExpirationCheckTimer) {
    clearTimeout(nextExpirationCheckTimer);
    nextExpirationCheckTimer = null;
  }
  if (nextExpirationCheckAtMs !== null && announce) {
    log?.info(`[${accountId}] Cleared scheduled conversation expiration check`);
  }
  nextExpirationCheckAtMs = null;
}

async function detectMembershipTerminationReason(
  msg: InboundMessage,
  inst: ConvosInstance | null,
  log?: RuntimeLogger,
): Promise<string | null> {
  if (!inst || msg.contentType !== "group_updated" || !isMemberRemovalGroupUpdate(msg.content)) {
    return null;
  }

  let profiles;
  try {
    profiles = await inst.refreshMemberNamesStrict();
  } catch (err) {
    if (isInactiveGroupError(err)) {
      return "removed from group";
    }
    log?.error(`[convos] Unexpected error checking membership: ${String(err)}`);
    return null;
  }

  if (profiles.length === 0) {
    return null;
  }

  const agentStillPresent = profiles.some((profile) =>
    profile.isMe === true || (Boolean(inst.inboxId) && profile.inboxId === inst.inboxId)
  );

  if (!agentStillPresent) {
    return "removed from group";
  }

  if (profiles.length !== 1) {
    return null;
  }

  return "last member in group";
}

function isMemberRemovalGroupUpdate(content: string): boolean {
  for (const segment of splitGroupUpdateSegments(content)) {
    if (!segment) {
      continue;
    }
    if (/\bleft the group$/i.test(segment)) {
      return true;
    }
    if (
      /^[^;]+ removed [^;]+$/i.test(segment) &&
      !/\bwas removed$/i.test(segment) &&
      !/\bremoved .+ as admin$/i.test(segment) &&
      !/\bremoved .+ as super admin$/i.test(segment) &&
      !/\bremoved their profile photo$/i.test(segment)
    ) {
      return true;
    }
  }

  return false;
}

function splitGroupUpdateSegments(content: string): string[] {
  return content.split(GROUP_UPDATE_SEPARATOR_RE).map((segment) => segment.trim()).filter(Boolean);
}

function isInactiveGroupError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\bgroup is inactive\b/i.test(message);
}

/**
 * Strip Markdown formatting so outgoing messages read as plain text.
 * Removes bold/italic markers, inline code backticks, and converts
 * [text](url) links to just the text.
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Code fences first: ```lang\n...\n``` → just the content
      .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
      // Inline code: `code` → code
      .replace(/`([^`]+)`/g, "$1")
      // Links: [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Bold/italic: ***, **, *
      .replace(/\*{1,3}(.*?)\*{1,3}/g, "$1")
      // Strikethrough: ~~text~~
      .replace(/~~(.*?)~~/g, "$1")
      // Heading markers: # at line start
      .replace(/^#{1,6}\s+/gm, "")
  );
}

/**
 * Deliver a reply to the Convos conversation
 */
async function deliverConvosReply(params: {
  payload: ReplyPayload;
  accountId: string;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  tableMode?: "off" | "plain" | "markdown" | "bullets" | "code";
  triggerMessageId?: string;
}): Promise<void> {
  const { payload, accountId, runtime, log, tableMode = "code", triggerMessageId } = params;

  const inst = getConvosInstance();
  if (!inst) {
    throw new Error("Convos instance not available");
  }

  // Resolve replyTo from reply tags: [[reply_to:<id>]] or [[reply_to_current]]
  const replyTo = payload.replyToId ?? (payload.replyToCurrent ? triggerMessageId : undefined);

  const raw = runtime.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);
  const text = stripMarkdown(raw);

  if (text) {
    const cfg = runtime.config.loadConfig();
    const chunkLimit = runtime.channel.text.resolveTextChunkLimit({
      cfg,
      channel: "convos",
      accountId,
    });

    const chunks = runtime.channel.text.chunkMarkdownText(text, chunkLimit);

    for (let i = 0; i < chunks.length; i++) {
      try {
        // Only apply replyTo on the first chunk
        await inst.sendMessage(chunks[i], i === 0 ? replyTo : undefined);
      } catch (err) {
        log?.error(`[${accountId}] Send failed: ${String(err)}`);
        throw err;
      }
    }
  }
}

/**
 * Send a static welcome message directly via XMTP — no LLM, no gate.
 * Skill-builder context is injected lazily on the first real user message
 * (see _skillBuilderPending flag in startWiredInstance).
 */
/** Read an onboarding prompt from $STATE_DIR/onboarding/ or convos-platform/onboarding/. */
function readOnboardingPrompt(filename: string): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR || "";
  const candidates = [
    stateDir ? path.join(stateDir, "onboarding", filename) : "",
    path.resolve(__dirname, "..", "..", "..", "..", "..", "convos-platform", "onboarding", filename),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf-8").trim();
    } catch {}
  }
  throw new Error(`[convos] Onboarding prompt ${filename} not found`);
}

/** Check if the agent has an active skill configured. */
function hasActiveSkill(): boolean {
  const skillsRoot = process.env.SKILLS_ROOT || "";
  if (!skillsRoot) return false;
  try {
    const raw = fs.readFileSync(path.join(skillsRoot, "generated", "skills.json"), "utf-8");
    const data = JSON.parse(raw);
    return !!data.active;
  } catch {
    return false;
  }
}

/** Whether the skill-builder kickoff still needs to be injected into the first real user message. */
let _skillBuilderPending = false;

async function dispatchGreeting(
  _account: ResolvedConvosAccount,
  _runtime: PluginRuntime,
): Promise<void> {
  const inst = getConvosInstance();
  if (!inst) {
    console.error("[convos] No instance available for greeting dispatch");
    return;
  }

  const skillActive = hasActiveSkill();

  // Static greeting — sent directly via XMTP, no LLM involved.
  const greeting = "Hey! What would you like to build today?";
  console.log(`[convos] Sending static greeting (skill-active=${skillActive})`);
  try {
    await inst.sendMessage(greeting);
  } catch (err) {
    console.error(`[convos] Static greeting send failed: ${String(err)}`);
  }

  // Skill-builder context is injected lazily: if no active skill, the first
  // real user message will be prefixed with the skill-builder kickoff prompt
  // so the agent learns the onboarding flow alongside the user's first reply.
  _skillBuilderPending = !skillActive;
  if (_skillBuilderPending) {
    console.log("[convos] Skill-builder context will be injected on first user message");
  }
}

/**
 * Dispatch a background notification (email/SMS) as a synthetic system message.
 * Called by POST /convos/notify — the pool forwards AgentMail/Telnyx webhooks
 * here. In CI, the runtime is reachable via ngrok tunnel (see lib/ngrok.sh).
 */
export async function dispatchNotification(text: string): Promise<void> {
  const inst = getConvosInstance();
  if (!inst) {
    throw new Error("No active conversation");
  }

  const runtime = getConvosRuntime();
  if (!runtime) {
    throw new Error("No runtime available");
  }

  const cfg = runtime.config.loadConfig() as CoreConfig;
  const account = resolveConvosAccount({ cfg });

  const syntheticMsg: InboundMessage = {
    conversationId: inst.conversationId,
    messageId: `system-notify-${crypto.randomUUID()}`,
    senderId: SYSTEM_SENDER_ID,
    senderName: "System",
    content: text,
    contentType: "text",
    timestamp: new Date(),
  };

  console.log("[convos] Dispatching notification message");
  await handleInboundMessage(account, syntheticMsg, runtime);
}

async function dispatchWorkspaceRefresh(
  account: ResolvedConvosAccount,
  runtime: PluginRuntime,
  log?: RuntimeLogger,
): Promise<void> {
  const inst = getConvosInstance();
  if (!inst) {
    log?.warn?.(`[${account.accountId}] No instance available for workspace refresh dispatch`);
    return;
  }

  const syntheticMsg: InboundMessage = {
    conversationId: inst.conversationId,
    messageId: `system-refresh-${crypto.randomUUID()}`,
    senderId: SYSTEM_SENDER_ID,
    senderName: "System",
    content:
      "[System: Gateway restart detected. This is an internal refresh only. Re-read AGENTS.md, IDENTITY.md, SOUL.md, USER.md, MEMORY.md, and current memory files now. Do not send a reply or call tools unless strictly required to refresh your workspace context.]",
    contentType: "text",
    timestamp: new Date(),
  };

  log?.info(`[${account.accountId}] Dispatching silent workspace refresh`);
  await handleInboundMessage(account, syntheticMsg, runtime, log, undefined, true);
}

/**
 * Create a fully-wired ConvosInstance and start it.
 * Used by HTTP routes to start message handling immediately after creating/joining.
 */
export async function startWiredInstance(params: {
  conversationId: string;
  identityId: string;
  env: "production" | "dev";
  debug?: boolean;
  /** If set, rename the conversation profile when a joiner is accepted. */
  name?: string;
  /** Skip the LLM-generated greeting dispatch (used by evals). */
  skipGreeting?: boolean;
}): Promise<void> {
  const runtime = getConvosRuntime();
  const cfg = runtime.config.loadConfig();
  const account = resolveConvosAccount({ cfg: cfg as CoreConfig });

  // Clear all previous session state so the agent starts fresh for this conversation.
  const route = runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "convos",
    accountId: account.accountId,
    peer: { kind: "group", id: params.conversationId },
  });
  const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });
  const sessionsDir = path.dirname(storePath);
  if (fs.existsSync(sessionsDir)) {
    try {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
      console.log(`[convos] Cleared session state: ${sessionsDir}`);
    } catch (err) {
      console.error(`[convos] Failed to clear sessions: ${String(err)}`);
    }
  }

  // Expose conversation ID so the agent's exec tool can use $CONVOS_CONVERSATION_ID
  process.env.CONVOS_CONVERSATION_ID = params.conversationId;

  const inst = ConvosInstance.fromExisting(params.conversationId, params.identityId, params.env, {
    debug: params.debug ?? account.debug,
    heartbeatSeconds: 30,
    onMessage: (msg: InboundMessage) => {
      // Inject skill-builder context on the first real user message so the
      // agent learns the onboarding flow alongside the user's first reply —
      // no separate LLM turn needed (replaces the old Phase 2 greeting gate).
      if (_skillBuilderPending && msg.senderId !== SYSTEM_SENDER_ID) {
        _skillBuilderPending = false;
        try {
          const kickoff = readOnboardingPrompt("skill-builder-kickoff.md");
          msg = { ...msg, content: `${kickoff}\n\n${msg.content}` };
          console.log("[convos] Injected skill-builder context into first user message");
        } catch (err) {
          console.error(`[convos] Failed to read skill-builder kickoff: ${String(err)}`);
        }
      }
      handleInboundMessage(account, msg, runtime).catch((err) => {
        console.error(`[convos] Message handling failed: ${String(err)}`);
      });
    },
    onMemberJoined: (info) => {
      console.log(`[convos] Join accepted: ${info.joinerInboxId}`);
      if (params.name) {
        inst.rename(params.name).catch((err) => {
          console.error(`[convos] Rename after join failed: ${String(err)}`);
        });
      }
      // Member name cache is updated by profile_snapshot messages
      // (sent automatically after adding members), not here.
    },
  });

  setConvosInstance(inst);
  await inst.start();

  const posthogApiKey = process.env.POSTHOG_API_KEY || "";
  const posthogHost = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  const instanceId = process.env.INSTANCE_ID || "";
  if (posthogApiKey && instanceId) {
    const environment = process.env.POOL_ENVIRONMENT || "";
    const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
    const cronJobsFile = path.join(stateDir, "cron", "jobs.json");
    const skillsDir = process.env.SKILLS_ROOT || path.join(stateDir, "skills");
    stats.start({ posthogApiKey, posthogHost, instanceId, agentName: params.name || "", environment, version: process.env.RUNTIME_VERSION || "", cronJobsFile, skillsDir });
  }

  // Fire-and-forget: send static welcome message directly via XMTP.
  // No LLM involved, no greeting gate needed — completes in <500ms.
  if (params.skipGreeting) {
    console.log("[convos] Greeting dispatch skipped (skipGreeting=true)");
    // Still set the skill-builder pending flag so the kickoff context is
    // injected on the first user message — even without a greeting.
    _skillBuilderPending = !hasActiveSkill();
    if (_skillBuilderPending) {
      console.log("[convos] Skill-builder context will be injected on first user message");
    }
  } else {
    dispatchGreeting(account, runtime).catch((err) => {
      console.error(`[convos] Greeting dispatch failed: ${String(err)}`);
    });
  }
}

async function stopInstance(accountId: string, log?: RuntimeLogger) {
  clearConversationExpirationCheck(accountId, log, false);
  await stats.shutdown();
  const inst = getConvosInstance();
  if (inst) {
    try {
      await inst.stop();
    } catch (err) {
      log?.error(`[${accountId}] Error stopping instance: ${String(err)}`);
    }
    setConvosInstance(null);
  }
}

/**
 * Request self-destruction of this pool-managed instance.
 * Calls pool-server's /pool/self-destruct endpoint (which relays to the pool
 * manager), stops the Convos instance, and unblocks the startAccount promise
 * so the gateway can exit cleanly.
 */
export async function selfDestruct(reason?: string): Promise<void> {
  clearConversationExpirationCheck(DEFAULT_ACCOUNT_ID, undefined, false);
  await stats.shutdown();
  const port = process.env.POOL_SERVER_PORT || process.env.PORT || "8080";
  const gatewayToken = process.env.GATEWAY_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gatewayToken) headers["Authorization"] = `Bearer ${gatewayToken}`;
  let poolSelfDestructAck = false;

  console.log(`[convos] Self-destruct requested${reason ? `: ${reason}` : ""}`);

  try {
    const res = await fetch(`http://localhost:${port}/pool/self-destruct`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    console.log(`[convos] Self-destruct response:`, data);
    poolSelfDestructAck = data?.ok === true;
  } catch (err) {
    console.error(`[convos] Self-destruct call failed: ${String(err)}`);
  }

  if (!poolSelfDestructAck) {
    await disableConvosAccountAfterSelfDestruct(reason);
  }

  // Clear persisted credentials so /convos/status reports conversationId=null
  clearConvosCredentials();

  // Stop the Convos instance and unblock startAccount so the gateway exits
  const inst = getConvosInstance();
  if (inst) {
    try {
      await inst.stop();
    } catch (err) {
      console.error(`[convos] Error stopping instance during self-destruct: ${String(err)}`);
    }
    setConvosInstance(null);
  }

  if (resolveStartAccountBlock) {
    const resolve = resolveStartAccountBlock;
    resolveStartAccountBlock = null;
    resolve();
  }
}

async function disableConvosAccountAfterSelfDestruct(reason?: string): Promise<void> {
  try {
    const runtime = getConvosRuntime();
    const cfg = runtime.config.loadConfig() as CoreConfig;
    const nextCfg: CoreConfig = {
      ...cfg,
      channels: {
        ...(cfg.channels ?? {}),
        convos: {
          ...(cfg.channels?.convos ?? {}),
          enabled: false,
        },
      },
    };
    await runtime.config.writeConfigFile(nextCfg);
    console.log(`[convos] Disabled Convos account after self-destruct${reason ? `: ${reason}` : ""}`);
  } catch (err) {
    console.error(`[convos] Failed to disable Convos account after self-destruct: ${String(err)}`);
  }
}
