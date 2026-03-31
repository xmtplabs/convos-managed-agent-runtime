import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load system prompt once at import time
const SYSTEM_PROMPT = (() => {
  try {
    return readFileSync(resolve(__dirname, "../../data/skill-generator-prompt.txt"), "utf8").trim();
  } catch (e: any) {
    console.warn("[skillGen] Could not load system prompt:", e.message);
    return "";
  }
})();

export interface GeneratedSkill {
  agentName: string;
  description: string;
  prompt: string;
  category: string;
  emoji: string;
  tools: string[];
}

export async function generateSkill(idea: string): Promise<GeneratedSkill> {
  if (!config.skillsOpenrouterApiKey) {
    throw new Error("SKILLS_OPENROUTER_API_KEY not configured");
  }
  if (!SYSTEM_PROMPT) {
    throw new Error("Skill generator system prompt not loaded");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.skillsOpenrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "@preset/assistants-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: idea },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${body}`);
  }

  const data = await res.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content in LLM response");
  }

  return parseSkillResponse(content);
}

/** Parse and validate LLM response into a GeneratedSkill. Exported for testing. */
export function parseSkillResponse(content: string): GeneratedSkill {
  const jsonStr = content.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed.agentName || typeof parsed.agentName !== "string") {
    throw new Error("LLM response missing agentName");
  }

  return {
    agentName: parsed.agentName,
    description: parsed.description || "",
    prompt: parsed.prompt || "",
    category: parsed.category || "",
    emoji: parsed.emoji || "",
    tools: Array.isArray(parsed.tools) ? parsed.tools : [],
  };
}
