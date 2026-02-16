#!/usr/bin/env node
const { Command } = require("commander");
const { runScript } = require("./run.cjs");
const { runCheck } = require("./check-paths.cjs");

const program = new Command();

program
  .name("convos")
  .description("Local CLI for convos-concierge: key-provision, apply-config, gateway run")
  .version(require("../package.json").version);

program
  .command("check")
  .description("Log root, workspace, state dir, config and openclaw paths")
  .action(runCheck);

program
  .command("key-provision")
  .description("Generate OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD, WALLET_PRIVATE_KEY; create or reuse OpenRouter key and write .env")
  .action(() => runScript("keys.sh"));

program
  .command("apply-config")
  .description("Sync workspace/skills/extensions and copy config template to state dir")
  .action(() => runScript("apply-config.sh"));

program
  .command("install-state-deps")
  .description("Install extension and skill deps in OPENCLAW_STATE_DIR")
  .action(() => runScript("install-state-deps.sh"));

program
  .command("gateway run")
  .description("Start the gateway")
  .action(() => runScript("gateway.sh"));

program
  .command("start")
  .description("Provision keys (if missing), apply config, install deps, then start the gateway")
  .action(() => {
    runScript("keys.sh");
    runScript("apply-config.sh");
    runScript("install-state-deps.sh");
    runScript("gateway.sh");
  });

program
  .command("prompt-qa")
  .description("QA: run one agent prompt to verify email, SMS, and BTC search. Gateway must be running.")
  .action(() => runScript("prompt-qa.sh"));

program
  .command("prompt-qa-browser")
  .description("QA: run one agent prompt to verify browser (form fill + submit). Gateway must be running.")
  .action(() => runScript("prompt-qa-browser.sh"));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
