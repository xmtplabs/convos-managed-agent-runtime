import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import * as skills from "../db/skills";
import { isAuthenticated } from "../admin";
import { config } from "../config";
import { generateSkill } from "../services/skillGen";

export const skillsRouter = Router();

const MAX_AGENT_NAME_LEN = 200;
const MAX_PROMPT_LEN = 50_000;
const MAX_DESCRIPTION_LEN = 1_000;

// UUID v4 pattern for distinguishing IDs from slugs
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Helper: check if request is authenticated (Bearer token or session). */
function isAuthed(req: any): boolean {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1] && match[1] === config.poolApiKey) return true;
  return isAuthenticated(req);
}

// --- Public reads ---

/** List skills. Public callers get published only. ?all=true with auth gets everything. */
skillsRouter.get("/api/skills", async (req, res) => {
  try {
    const wantAll = req.query.all === "true";
    if (wantAll && !isAuthed(req)) {
      res.status(401).json({ error: "Auth required for ?all=true" });
      return;
    }
    const rows = wantAll ? await skills.listAll() : await skills.listPublished();
    res.json(rows);
  } catch (err: any) {
    console.error("[skills] list failed:", err);
    res.status(500).json({ error: err.message });
  }
});

const MAX_IDEA_LEN = 500;

/** Generate a full skill from a one-sentence idea via LLM. */
skillsRouter.post("/api/skills/generate", requireAuth, async (req, res) => {
  try {
    const { idea } = req.body || {};
    if (!idea || typeof idea !== "string") {
      res.status(400).json({ error: "idea is required" }); return;
    }
    if (idea.length > MAX_IDEA_LEN) {
      res.status(400).json({ error: `idea must be at most ${MAX_IDEA_LEN} characters` }); return;
    }

    const generated = await generateSkill(idea);
    res.json(generated);
  } catch (err: any) {
    console.error("[skills] generate failed:", err);
    res.status(502).json({ error: "Generation failed", details: err.message });
  }
});

/** Get a single skill by UUID or slug. Unpublished requires auth. */
skillsRouter.get("/api/skills/:idOrSlug", async (req, res) => {
  try {
    const param = req.params.idOrSlug as string;
    const skill = UUID_RE.test(param)
      ? await skills.findById(param)
      : await skills.findBySlug(param);
    if (!skill) { res.status(404).json({ error: "Skill not found" }); return; }

    if (!skill.published && !isAuthed(req)) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }
    res.json(skill);
  } catch (err: any) {
    console.error("[skills] find failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Auth-protected writes ---

/** Create a skill. */
skillsRouter.post("/api/skills", requireAuth, async (req, res) => {
  try {
    const { agentName, prompt, description, category, emoji, tools, published, featured } = req.body || {};

    if (!agentName || typeof agentName !== "string") {
      res.status(400).json({ error: "agentName is required" }); return;
    }
    if (agentName.length > MAX_AGENT_NAME_LEN) {
      res.status(400).json({ error: `agentName must be at most ${MAX_AGENT_NAME_LEN} characters` }); return;
    }
    if (prompt !== undefined && typeof prompt !== "string") {
      res.status(400).json({ error: "prompt must be a string" }); return;
    }
    if (prompt && prompt.length > MAX_PROMPT_LEN) {
      res.status(400).json({ error: `prompt must be at most ${MAX_PROMPT_LEN} characters` }); return;
    }
    if (description !== undefined && typeof description !== "string") {
      res.status(400).json({ error: "description must be a string" }); return;
    }
    if (description && description.length > MAX_DESCRIPTION_LEN) {
      res.status(400).json({ error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` }); return;
    }

    // Check slug collision (including fallback slug for special-char-only names)
    let slug = skills.slugify(agentName);
    if (!slug) slug = `skill-${crypto.randomUUID().slice(0, 8)}`;
    const existing = await skills.findBySlug(slug);
    if (existing) {
      res.status(409).json({ error: "A skill with this name already exists" }); return;
    }

    const skill = await skills.createSkill({
      agentName,
      slug,
      prompt: prompt ?? "",
      description,
      category,
      emoji,
      tools: Array.isArray(tools) ? tools : undefined,
      published: published === true,
      featured: featured === true,
    });
    res.status(201).json(skill);
  } catch (err: any) {
    console.error("[skills] create failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Update a skill. */
skillsRouter.put("/api/skills/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await skills.findById(id);
    if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }

    const { agentName, prompt, description, category, emoji, tools, published, featured } = req.body || {};
    const updates: Record<string, any> = {};

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
      if (description.length > MAX_DESCRIPTION_LEN) {
        res.status(400).json({ error: `description must be at most ${MAX_DESCRIPTION_LEN} characters` }); return;
      }
      updates.description = description;
    }
    if (category !== undefined) updates.category = String(category);
    if (emoji !== undefined) updates.emoji = String(emoji);
    if (tools !== undefined) {
      if (!Array.isArray(tools)) {
        res.status(400).json({ error: "tools must be an array" }); return;
      }
      updates.tools = tools;
    }
    if (published !== undefined) updates.published = published === true;
    if (featured !== undefined) updates.featured = featured === true;

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

/** Delete a skill. */
skillsRouter.delete("/api/skills/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await skills.findById(id);
    if (!existing) { res.status(404).json({ error: "Skill not found" }); return; }
    await skills.deleteSkill(id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[skills] delete failed:", err);
    res.status(500).json({ error: err.message });
  }
});
