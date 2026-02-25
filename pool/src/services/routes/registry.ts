import { Router } from "express";
import type { ToolRegistryEntry } from "../../types.js";

export const registryRouter = Router();

const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    mode: "per-instance-key",
    envKeys: ["OPENROUTER_API_KEY"],
  },
  {
    id: "agentmail",
    name: "AgentMail",
    mode: "per-instance-inbox",
    envKeys: ["AGENTMAIL_INBOX_ID"],
  },
  {
    id: "telnyx",
    name: "Telnyx",
    mode: "per-instance-phone",
    envKeys: ["TELNYX_PHONE_NUMBER", "TELNYX_MESSAGING_PROFILE_ID"],
  },
];

/**
 * GET /registry
 * Returns the list of available tools and their provisioning modes.
 */
registryRouter.get("/registry", (_req, res) => {
  res.json({ tools: TOOL_REGISTRY });
});
