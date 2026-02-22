#!/usr/bin/env node
const { Command } = require("commander");
const { runScript } = require("./run.cjs");
const { runCheck } = require("./check-paths.cjs");
const { loadEnv, confirmProtectedEnv, getEnvName } = require("./context.cjs");

const program = new Command();

program
  .name("runtime")
  .description("Local CLI: check, key-provision, apply, install-deps, gateway run, init, services, qa")
  .version(require("../package.json").version)
  .option("-e, --env <name>", "Environment to use (dev, staging, production)", "dev")
  .hook("preAction", async (thisCommand) => {
    const envName = thisCommand.opts().env;
    loadEnv(envName);
    await confirmProtectedEnv();
  });

program
  .command("check")
  .description("Log root, workspace, state dir, config and openclaw paths")
  .action(runCheck);

program
  .command("key-provision")
  .description("Generate OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, WALLET_PRIVATE_KEY; create or reuse OpenRouter key and write .env")
  .action(() => runScript("init/keys.sh"));

program
  .command("apply")
  .description("Sync workspace/skills/extensions and copy config template to state dir")
  .action(() => runScript("init/apply-config.sh"));

program
  .command("install-deps")
  .description("Install extension and skill deps in OPENCLAW_STATE_DIR")
  .action(() => runScript("init/install-deps.sh"));

program
  .command("gateway run")
  .description("Start the gateway")
  .action(() => runScript("runtime/gateway.sh"));

program
  .command("browser")
  .description("Browser pre-flight (profile lock, device scopes, config validation)")
  .action(() => runScript("runtime/browser.sh"));

program
  .command("init")
  .description("Provision keys (if missing), apply config, install deps, then start the gateway")
  .action(() => {
    runScript("init/keys.sh");
    runScript("init/apply-config.sh");
    runScript("init/install-deps.sh");
    runScript("runtime/gateway.sh");
  });

const services = program
  .command("services")
  .description("Manage provider resources (OpenRouter keys, AgentMail inboxes, etc.)");

services
  .command("list")
  .description("List all provider resources and their Railway instance association")
  .action(() => runScript("services/list-resources.mjs"));

services
  .command("clean-agentmail")
  .description("Find and delete orphaned AgentMail inboxes across ALL Railway environments")
  .action(() => runScript("services/clean-agentmail.mjs"));

services
  .command("clean-openrouter")
  .description("Find and delete orphaned OpenRouter API keys across ALL Railway environments")
  .action(() => runScript("services/clean-openrouter.mjs"));

program
  .command("qa [suite]")
  .description("Run QA smoke test. Suites: email, sms, bankr, search, browser, all (default)")
  .action((suite) => runScript("tools/qa.sh", { QA_SUITE: suite || "all" }));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
