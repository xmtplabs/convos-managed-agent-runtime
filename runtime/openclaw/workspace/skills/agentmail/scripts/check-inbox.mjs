#!/usr/bin/env node
/**
 * Alias for poll-inbox.mjs. Same env and args.
 * Usage: node scripts/check-inbox.mjs [--limit 20] [--labels unread]
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const script = join(__dirname, "poll-inbox.mjs");
const child = spawn(node, [script, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
