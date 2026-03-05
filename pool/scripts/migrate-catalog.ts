/**
 * One-time migration script: reads agents-data.json and inserts entries into
 * the agent_skills DB table. Optionally fetches prompts from Notion if
 * NOTION_API_KEY is set.
 *
 * Usage:
 *   CREATOR_ID="auth0|..." DATABASE_URL="..." [NOTION_API_KEY="..."] npx tsx pool/scripts/migrate-catalog.ts
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env ─────────────────────────────────────────────────────────────────────
const CREATOR_ID = process.env.CREATOR_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const NOTION_API_KEY = process.env.NOTION_API_KEY || "";

if (!CREATOR_ID) {
  console.error("CREATOR_ID env var is required (Auth0 sub, e.g. auth0|...)");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

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

async function fetchNotionPrompt(pageId: string): Promise<string> {
  if (!NOTION_API_KEY) return "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
  };
  try {
    let text = "";
    let cursor: string | undefined;
    do {
      const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamically import DB (needs DATABASE_URL to be set)
  const { db } = await import("../src/db/connection");
  const { agentSkills } = await import("../src/db/schema");

  const catalogPath = resolve(__dirname, "../data/catalog-seed.json");
  const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as any[];

  // Filter to entries with a name and a Notion page ID
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

  console.log(`Found ${entries.length} catalog entries (${entries.filter((e) => e.notionPageId).length} with Notion page IDs)`);
  if (NOTION_API_KEY) {
    console.log("NOTION_API_KEY is set — will fetch prompts from Notion");
  } else {
    console.log("NOTION_API_KEY not set — prompts will be empty");
  }

  let inserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    // Fetch prompt from Notion if available
    let prompt = "";
    if (entry.notionPageId && NOTION_API_KEY) {
      process.stdout.write(`  Fetching prompt for "${entry.name}"...`);
      prompt = await fetchNotionPrompt(entry.notionPageId);
      console.log(prompt ? ` ${prompt.length} chars` : " (empty)");
    }

    try {
      await db.insert(agentSkills).values({
        id: crypto.randomUUID(),
        creatorId: CREATOR_ID,
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
      console.log(`  [${inserted}] Inserted: ${entry.name} (${entry.slug})`);
    } catch (err: any) {
      if (err.message?.includes("duplicate") || err.code === "23505") {
        skipped++;
        console.log(`  SKIP (duplicate): ${entry.name} (${entry.slug})`);
      } else {
        console.error(`  ERROR inserting ${entry.name}:`, err.message);
      }
    }

    // Rate-limit Notion API calls
    if (entry.notionPageId && NOTION_API_KEY) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}, Total: ${entries.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
