import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type PluginRuntime,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
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
import { getConvosRuntime } from "./runtime.js";
import { ConvosInstance, type InboundMessage } from "./sdk-client.js";

type RuntimeLogger = {
  info: (msg: string) => void;
  error: (msg: string) => void;
  warn?: (msg: string) => void;
};

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
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("convos:")) {
    normalized = normalized.slice("convos:".length).trim();
  }
  return normalized || undefined;
}

export const convosPlugin: ChannelPlugin<ResolvedConvosAccount> = {
  id: "convos",
  meta,
  capabilities: {
    chatTypes: ["group"],
    reactions: true,
    threads: false,
    media: true,
  },
  reload: { configPrefixes: ["channels.convos"] },
  configSchema: convosChannelConfigSchema,
  onboarding: convosOnboardingAdapter,
  actions: convosMessageActions,
  agentPrompt: {
    messageToolHints: () => [
      "- To send a Convos message: use `action=send` with `message`. To reply to a specific message, include `replyTo` with the message ID.",
      "- For reactions: use `action=react` with `messageId` and `emoji`.",
      "- To send a file: use `action=sendAttachment` with `file` (local path).",
    ],
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
        clearBaseFields: ["name", "identityId", "env", "debug", "ownerConversationId"],
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
    listGroups: async ({ query }) => {
      const inst = getConvosInstance();
      if (!inst) {
        return [];
      }
      const name = inst.label ?? inst.conversationId.slice(0, 8);
      const q = query?.trim().toLowerCase() ?? "";
      if (q && !name.toLowerCase().includes(q)) {
        return [];
      }
      return [{ kind: "group" as const, id: inst.conversationId, name }];
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
          },
          onHeartbeat: (info) => {
            if (account.debug) {
              log?.info(`[${account.accountId}] Heartbeat: ${info.activeStreams} active streams`);
            }
          },
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

      // Block until abort signal fires
      await new Promise<void>((resolve) => {
        const onAbort = () => {
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
) {
  const inst = getConvosInstance();
  const debugLog = (msg: string) => log ? log.info(msg) : console.log(msg);
  const errorLog = (msg: string) => log ? log.error(msg) : console.error(msg);

  // Self-echo filtering is handled by `convos agent serve` — messages from
  // our own inboxId are never emitted. No filtering needed here.

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
  // Download image before finalizeInboundContext so MediaPath/MediaType are
  // included in the finalized context and picked up by the media pipeline.
  //
  // Content format from the CLI:
  //   remoteStaticAttachment: "[remote attachment: filename (-1 bytes) https://...encrypted.bin]"
  //   attachment:             "[attachment: filename (size bytes)]"
  //
  // The URL points to an encrypted blob — we must always download via the CLI
  // which handles decryption. Detect image type from the filename extension.
  let mediaPath: string | undefined;
  if (msg.contentType === "remoteStaticAttachment" || msg.contentType === "attachment") {
    try {
      const filenameMatch = msg.content.match(/:\s+(\S+\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif|svg))\s/i);
      const ext = filenameMatch?.[2] ? `.${filenameMatch[2].toLowerCase()}` : "";

      if (filenameMatch && inst) {
        const safeId = msg.messageId.replace(/[^a-zA-Z0-9-]/g, "");
        mediaPath = path.join(os.tmpdir(), `convos-img-${safeId}${ext}`);
        await inst.downloadAttachment(msg.messageId, mediaPath);

        if (account.debug) {
          debugLog(`[${account.accountId}] Image attachment downloaded: ${mediaPath}`);
        }
      }
    } catch (err) {
      errorLog(`[${account.accountId}] Failed to process image attachment: ${String(err)}`);
      mediaPath = undefined;
    }
  }

  // Map file extension to MIME type for the media pipeline
  const extToMime: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".heic": "image/heic",
    ".heif": "image/heif", ".bmp": "image/bmp",
    ".tif": "image/tiff", ".tiff": "image/tiff",
    ".avif": "image/avif", ".svg": "image/svg+xml",
  };
  const mediaMime = mediaPath ? extToMime[path.extname(mediaPath).toLowerCase()] ?? "image/jpeg" : undefined;

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
    ...(mediaPath ? { MediaPath: mediaPath, MediaType: mediaMime } : {}),
  });

  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      errorLog(`[${account.accountId}] Failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "convos",
    accountId: account.accountId,
  });

  try {
    await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        deliver: async (payload: ReplyPayload) => {
          await deliverConvosReply({
            payload,
            accountId: account.accountId,
            runtime,
            log,
            tableMode,
            triggerMessageId: msg.contentType === "text" || msg.contentType === "reply"
              ? msg.messageId
              : undefined,
          });
        },
        onError: (err, info) => {
          errorLog(`[${account.accountId}] Convos ${info.kind} reply failed: ${String(err)}`);
        },
      },
    });
  } finally {
    // Clean up temp image file after the reply pipeline is done with it
    if (mediaPath) {
      fs.unlink(mediaPath, () => {});
    }
  }
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

  const inst = ConvosInstance.fromExisting(params.conversationId, params.identityId, params.env, {
    debug: params.debug ?? account.debug,
    onMessage: (msg: InboundMessage) => {
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
    },
  });

  setConvosInstance(inst);
  await inst.start();
}

async function stopInstance(accountId: string, log?: RuntimeLogger) {
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
