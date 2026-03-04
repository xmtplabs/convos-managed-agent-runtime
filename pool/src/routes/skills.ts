import { Router } from "express";
import { requireUserAuth } from "../middleware/userAuth";
import * as skills from "../db/skills";
import type { SkillVisibility } from "../db/schema";

export const skillsRouter = Router();

const MAX_AGENT_NAME_LEN = 200;
const MAX_PROMPT_LEN = 50_000;
const MAX_DESCRIPTION_LEN = 1_000;
const VALID_VISIBILITY: SkillVisibility[] = ["private", "public"];

// UUID v4 pattern for distinguishing IDs from slugs
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Public ---

/** List public skills. */
skillsRouter.get("/api/skills", async (_req, res) => {
  try {
    const rows = await skills.listPublic();
    res.json(rows);
  } catch (err: any) {
    console.error("[skills] listPublic failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** List current user's skills. Must be before /:id to avoid matching "mine" as id. */
skillsRouter.get("/api/skills/mine", requireUserAuth, async (req, res) => {
  try {
    const rows = await skills.listByCreator((req as any).userId);
    res.json(rows);
  } catch (err: any) {
    console.error("[skills] listByCreator failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Get a single skill (by UUID or slug). Public if public, or owned by authed user. */
skillsRouter.get("/api/skills/:idOrSlug", async (req, res) => {
  try {
    const param = req.params.idOrSlug as string;
    const skill = UUID_RE.test(param)
      ? await skills.findById(param)
      : await skills.findBySlug(param);
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }

    // If private, only the owner can see it
    if (skill.visibility === "private") {
      const userId = (req as any).userId;
      if (!userId || skill.creatorId !== userId) {
        res.status(404).json({ error: "Skill not found" });
        return;
      }
    }
    res.json(skill);
  } catch (err: any) {
    console.error("[skills] find failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- User-auth protected ---

/** Create a skill. */
skillsRouter.post("/api/skills", requireUserAuth, async (req, res) => {
  try {
    const { agentName, prompt, description, category, emoji, tools, visibility } = req.body || {};

    if (!agentName || typeof agentName !== "string") {
      res.status(400).json({ error: "agentName is required" }); return;
    }
    if (agentName.length > MAX_AGENT_NAME_LEN) {
      res.status(400).json({ error: `agentName must be at most ${MAX_AGENT_NAME_LEN} characters` }); return;
    }
    const promptValue = prompt ?? "";
    if (typeof promptValue !== "string") {
      res.status(400).json({ error: "prompt must be a string" }); return;
    }
    if (promptValue.length > MAX_PROMPT_LEN) {
      res.status(400).json({ error: `prompt must be at most ${MAX_PROMPT_LEN} characters` }); return;
    }
    if (description !== undefined && typeof description !== "string") {
      res.status(400).json({ error: "description must be a string" }); return;
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      res.status(400).json({ error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` }); return;
    }
    if (visibility !== undefined && !VALID_VISIBILITY.includes(visibility)) {
      res.status(400).json({ error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}` }); return;
    }

    const skill = await skills.createSkill({
      creatorId: (req as any).userId,
      agentName,
      prompt: promptValue,
      description,
      category,
      emoji,
      tools: Array.isArray(tools) ? tools : undefined,
      visibility,
    });
    res.status(201).json(skill);
  } catch (err: any) {
    console.error("[skills] create failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Update a skill (fetch-then-check authorization). */
skillsRouter.put("/api/skills/:id", requireUserAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await skills.findById(id);
    if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
    if (existing.creatorId !== (req as any).userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { agentName, prompt, description, category, emoji, tools, visibility } = req.body || {};
    const updates: Partial<{
      agentName: string;
      prompt: string;
      description: string;
      category: string;
      emoji: string;
      tools: string[];
      visibility: SkillVisibility;
    }> = {};

    if (agentName !== undefined) {
      if (typeof agentName !== "string" || agentName.length === 0) {
        res.status(400).json({ error: "agentName must be a non-empty string" }); return;
      }
      if (agentName.length > MAX_AGENT_NAME_LEN) {
        res.status(400).json({ error: `agentName must be at most ${MAX_AGENT_NAME_LEN} characters` }); return;
      }
      updates.agentName = agentName;
    }
    if (prompt !== undefined) {
      if (typeof prompt !== "string") {
        res.status(400).json({ error: "prompt must be a string" }); return;
      }
      if (prompt.length > MAX_PROMPT_LEN) {
        res.status(400).json({ error: `prompt must be at most ${MAX_PROMPT_LEN} characters` }); return;
      }
      updates.prompt = prompt;
    }
    if (description !== undefined) {
      if (typeof description !== "string") {
        res.status(400).json({ error: "description must be a string" }); return;
      }
      updates.description = description;
    }
    if (category !== undefined) {
      if (typeof category !== "string") {
        res.status(400).json({ error: "category must be a string" }); return;
      }
      updates.category = category;
    }
    if (emoji !== undefined) {
      if (typeof emoji !== "string") {
        res.status(400).json({ error: "emoji must be a string" }); return;
      }
      updates.emoji = emoji;
    }
    if (tools !== undefined) {
      if (!Array.isArray(tools)) {
        res.status(400).json({ error: "tools must be an array" }); return;
      }
      updates.tools = tools;
    }
    if (visibility !== undefined) {
      if (!VALID_VISIBILITY.includes(visibility)) {
        res.status(400).json({ error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}` }); return;
      }
      updates.visibility = visibility;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" }); return;
    }

    const updated = await skills.updateSkill(id, updates);
    res.json(updated);
  } catch (err: any) {
    console.error("[skills] update failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Delete a skill (fetch-then-check authorization). */
skillsRouter.delete("/api/skills/:id", requireUserAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await skills.findById(id);
    if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
    if (existing.creatorId !== (req as any).userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    await skills.deleteSkill(id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[skills] delete failed:", err);
    res.status(500).json({ error: err.message });
  }
});
