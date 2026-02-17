#!/usr/bin/env node
const { Command } = require("commander");
const { runScript } = require("./run.cjs");
const { runCheck } = require("./check-paths.cjs");

const program = new Command();

program
  .name("runtime")
  .description("Local CLI: check, key-provision, apply, install-deps, gateway run, init, reset, qa")
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
  .command("apply")
  .description("Sync workspace/skills/extensions and copy config template to state dir")
  .action(() => runScript("apply-config.sh"));

program
  .command("install-deps")
  .description("Install extension and skill deps in OPENCLAW_STATE_DIR")
  .action(() => runScript("install-deps.sh"));

program
  .command("gateway run")
  .description("Start the gateway")
  .action(() => runScript("gateway.sh"));

program
  .command("init")
  .description("Provision keys (if missing), apply config, install deps, then start the gateway")
  .action(() => {
    runScript("keys.sh");
    runScript("apply-config.sh");
    runScript("install-deps.sh");
    runScript("gateway.sh");
  });

program
  .command("reset <target>")
  .description("Reset state. Target: sessions (clear session state), chrome (restart browser)")
  .action((target) => {
    const t = target.toLowerCase();
    if (t === "sessions") runScript("reset-sessions.sh");
    else if (t === "chrome") runScript("restart-chrome.sh");
    else {
      console.error("Unknown reset target: %s. Use: sessions | chrome", target);
      process.exit(1);
    }
  });

program
  .command("qa [suite]")
  .description("Run QA smoke test. Suites: email, sms, bankr, search, browser, all (default)")
  .action((suite) => runScript("qa.sh", { QA_SUITE: suite || "all" }));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
