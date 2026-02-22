#!/usr/bin/env node
const { Command } = require("commander");
const { runScript } = require("./run.cjs");
const { runCheck } = require("./check-paths.cjs");

const program = new Command();

program
  .name("runtime")
  .description("Local CLI: check, key-provision, apply, install-deps, gateway run, init, clean-providers, qa")
  .version(require("../package.json").version);

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

program
  .command("clean-providers [target]")
  .description("Delete orphaned provider resources. Target: email, openrouter, all (default)")
  .action((target) => runScript("tools/clean-providers.mjs", { CLEAN_TARGET: target || "all" }));

program
  .command("openrouter-clean")
  .description("Alias for clean-providers openrouter")
  .action(() => runScript("tools/clean-providers.mjs", { CLEAN_TARGET: "openrouter" }));

program
  .command("qa [suite]")
  .description("Run QA smoke test. Suites: email, sms, bankr, search, browser, all (default)")
  .action((suite) => runScript("tools/qa.sh", { QA_SUITE: suite || "all" }));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
