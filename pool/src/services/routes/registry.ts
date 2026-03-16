import { Router } from "express";
import type { ToolRegistryEntry } from "../../types";

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
    envKeys: [],
  },
  {
    id: "telnyx",
    name: "Telnyx",
    mode: "per-instance-phone",
    envKeys: [],
  },
];

/**
 * GET /registry
 * Returns the list of available tools and their provisioning modes.
 */
registryRouter.get("/registry", (_req, res) => {
  res.json({ tools: TOOL_REGISTRY });
});
