#!/usr/bin/env node
/**
 * Unified services dispatcher.
 * Usage: node services.mjs <service> <action> [options]
 *
 * Services: info, email, sms, credits
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [service, ...rest] = process.argv.slice(2);

if (!service) {
  console.error("Usage: node services.mjs <service> <action> [options]");
  console.error("Services: info, email, sms, credits");
  process.exit(1);
}

const handlers = {
  info: () => import(join(__dirname, "handlers", "info.mjs")),
  email:    () => import(join(__dirname, "handlers", "email.mjs")),
  sms:      () => import(join(__dirname, "handlers", "sms.mjs")),
  credits:  () => import(join(__dirname, "handlers", "credits.mjs")),
};

const loader = handlers[service];
if (!loader) {
  console.error(`Unknown service: ${service}`);
  console.error("Available: info, email, sms, credits");
  process.exit(1);
}

// Set remaining args so handlers can parse them via process.argv.slice(2)
process.argv = [process.argv[0], process.argv[1], ...rest];

try {
  const mod = await loader();
  await mod.default(rest);
} catch (err) {
  console.error(`[services/${service}] ${err.message}`);
  process.exit(1);
}
