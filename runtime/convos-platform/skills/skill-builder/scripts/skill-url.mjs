#!/usr/bin/env node
/**
 * Returns the public URL for a skill page.
 *
 * Usage: node skill-url.mjs <slug>
 *   → https://<domain>/web-tools/skills/<slug>
 */

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: skill-url.mjs <slug>");
  process.exit(1);
}

const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
const port = process.env.POOL_SERVER_PORT || process.env.PORT || "18789";
const base = domain ? `https://${domain}` : `http://127.0.0.1:${port}`;

console.log(`${base}/web-tools/skills/${slug}`);
