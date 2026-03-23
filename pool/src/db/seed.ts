import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config";
import { agentSkills } from "./schema";
import { db } from "./connection";
import { hasAnySkills, slugify } from "./skills";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  skills: string[];
  subPageUrl: string | null;
}

/** Normalize category string using the same logic as the old AGENT_CATALOG builder. */
function normalizeCategory(raw: string): { category: string; emoji: string } {
  const catParts = raw.split(" — ");
  const firstPart = catParts[0].trim();
  const emoji = firstPart.split(" ")[0]; // leading emoji
  let catName = firstPart.replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
  if (catName === "Superpower Agents") catName = "Superpowers";
  if (catName === "Neighborhood") catName = "Local";
  if (catName === "Professional") catName = "Work";
  return { category: catName, emoji };
}

/** Fetch prompt text from a Notion page. */
async function fetchNotionPrompt(pageId: string): Promise<string> {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.notionApiKey}`,
    "Notion-Version": "2022-06-28",
  };

  const blocksRes = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
    { headers },
  );
  if (!blocksRes.ok) throw new Error(`Notion API ${blocksRes.status}`);
  const blocksData = await blocksRes.json() as any;

  let text = "";
  for (const block of blocksData.results || []) {
    if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
      const prefix = block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : "### ";
      const ht = block[block.type]?.rich_text;
      if (ht) text += prefix + ht.map((t: any) => t.plain_text).join("") + "\n";
    } else if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const lt = block[block.type]?.rich_text;
      if (lt) text += "- " + lt.map((t: any) => t.plain_text).join("") + "\n";
    } else if (block.type === "divider") {
      text += "---\n";
    } else {
      const rt = block[block.type]?.rich_text;
      if (rt) text += rt.map((t: any) => t.plain_text).join("") + "\n";
    }
  }
  return text.trim();
}

export async function seedCatalog(): Promise<void> {
  // Guard: skip if skills already exist
  if (await hasAnySkills()) {
    console.log("[seed] Skills table already populated, skipping");
    return;
  }

  // Load catalog JSON
  let catalog: CatalogEntry[];
  try {
    const catalogPath = resolve(__dirname, "../agents-data.json");
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (e: any) {
    console.warn("[seed] Could not load agents-data.json:", e.message);
    return;
  }

  // Filter to entries with Notion pages
  const entries = catalog.filter((e) => e.subPageUrl);
  console.log(`[seed] Seeding ${entries.length} catalog entries...`);

  let seeded = 0;
  for (const entry of entries) {
    try {
      const { category, emoji } = normalizeCategory(entry.category || "");
      const pageIdMatch = (entry.subPageUrl || "").match(/([a-f0-9]{32})/);
      const pageId = pageIdMatch?.[1];

      let prompt = "";
      if (pageId && config.notionApiKey) {
        try {
          prompt = await fetchNotionPrompt(pageId);
          // Rate limit: Notion allows 3 req/s, we add a small delay
          await new Promise((r) => setTimeout(r, 400));
        } catch (e: any) {
          console.warn(`[seed] Failed to fetch prompt for "${entry.name}": ${e.message}`);
        }
      }

      await db.insert(agentSkills).values({
        id: crypto.randomUUID(),
        slug: slugify(entry.name),
        agentName: entry.name,
        description: entry.description || "",
        prompt,
        category,
        emoji,
        tools: entry.skills || [],
        published: true,
      });
      seeded++;
    } catch (e: any) {
      console.warn(`[seed] Failed to seed "${entry.name}": ${e.message}`);
    }
  }

  console.log(`[seed] Seeded ${seeded}/${entries.length} catalog entries`);
}
