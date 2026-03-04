import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./connection";
import { agentSkills } from "./schema";
import { eq, count } from "drizzle-orm";
import { slugify } from "./skills";
import { config } from "../config";

const __dirname = dirname(fileURLToPath(import.meta.url));

function cleanCategory(raw: string): { category: string; emoji: string } {
  const catParts = (raw || "").split(" — ");
  const emoji = catParts[0].trim().split(" ")[0];
  let catName = catParts[0].trim().replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
  if (catName === "Superpower Agents") catName = "Superpowers";
  if (catName === "Neighborhood") catName = "Local";
  if (catName === "Professional") catName = "Work";
  return { category: catName, emoji };
}

function blockToText(block: any): string {
  if (block.type === "heading_1" || block.type === "heading_2" || block.type === "heading_3") {
    const prefix = block.type === "heading_1" ? "# " : block.type === "heading_2" ? "## " : "### ";
    const ht = block[block.type]?.rich_text;
    return ht ? prefix + ht.map((t: any) => t.plain_text).join("") + "\n" : "";
  } else if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
    const lt = block[block.type]?.rich_text;
    return lt ? "- " + lt.map((t: any) => t.plain_text).join("") + "\n" : "";
  } else if (block.type === "divider") {
    return "---\n";
  } else {
    const rt = block[block.type]?.rich_text;
    return rt ? rt.map((t: any) => t.plain_text).join("") + "\n" : "";
  }
}

async function fetchNotionPrompt(pageId: string, apiKey: string): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
  };
  try {
    let text = "";
    let cursor: string | undefined;
    do {
      const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
      const blocksRes = await fetch(url, { headers });
      if (!blocksRes.ok) {
        console.warn(`  Notion API returned ${blocksRes.status} for ${pageId}`);
        return text.trim();
      }
      const blocksData = (await blocksRes.json()) as any;
      for (const block of blocksData.results || []) {
        text += blockToText(block);
      }
      cursor = blocksData.has_more ? blocksData.next_cursor : undefined;
    } while (cursor);
    return text.trim();
  } catch (err: any) {
    console.warn(`  Failed to fetch Notion prompt for ${pageId}: ${err.message}`);
    return "";
  }
}

/**
 * Seeds the catalog from catalog-seed.json if no public skills exist yet.
 * Safe to call on every startup — skips if already seeded.
 */
export async function seedCatalog(): Promise<void> {
  const creatorId = config.seedCreatorId;
  if (!creatorId) {
    console.log("[seed] SEED_CREATOR_ID not set, skipping catalog seed");
    return;
  }

  // Guard: skip if public skills already exist
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(agentSkills)
    .where(eq(agentSkills.visibility, "public"));

  if (existing > 0) {
    console.log(`[seed] Catalog already seeded (${existing} public skills), skipping`);
    return;
  }

  const catalogPath = resolve(__dirname, "../../data/catalog-seed.json");
  let raw: any[];
  try {
    raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    console.warn(`[seed] Could not read ${catalogPath}, skipping catalog seed`);
    return;
  }

  const notionApiKey = process.env.NOTION_API_KEY || "";

  const entries = raw
    .filter((a) => a.name)
    .map((a) => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const { category, emoji } = cleanCategory(a.category || "");
      return {
        name: a.name as string,
        description: (a.description || "") as string,
        category,
        emoji,
        tools: (a.skills || []) as string[],
        slug: slugify(a.name),
        notionPageId: m ? m[1] : null,
      };
    });

  console.log(`[seed] Seeding ${entries.length} catalog entries...`);

  let inserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    let prompt = "";
    if (entry.notionPageId && notionApiKey) {
      prompt = await fetchNotionPrompt(entry.notionPageId, notionApiKey);
      if (prompt) console.log(`[seed]   Fetched prompt for "${entry.name}" (${prompt.length} chars)`);
      await new Promise((r) => setTimeout(r, 350)); // rate-limit Notion
    }

    try {
      await db.insert(agentSkills).values({
        id: crypto.randomUUID(),
        creatorId,
        slug: entry.slug,
        agentName: entry.name,
        description: entry.description,
        prompt,
        category: entry.category,
        emoji: entry.emoji,
        tools: entry.tools,
        visibility: "public",
      });
      inserted++;
    } catch (err: any) {
      if (err.message?.includes("duplicate") || err.code === "23505") {
        skipped++;
      } else {
        console.error(`[seed] ERROR inserting ${entry.name}:`, err.message);
      }
    }
  }

  console.log(`[seed] Done! Inserted: ${inserted}, Skipped: ${skipped}`);
}
