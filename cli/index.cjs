#!/usr/bin/env node
const { Command } = require("commander");
const { runScript } = require("./run.cjs");

const program = new Command();

program
  .name("convos")
  .description("Local CLI for convos-concierge: keys, config, gateway, upgrade")
  .version(require("../package.json").version);

program
  .command("keys")
  .description("Generate OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD; create or reuse OpenRouter key and write .env")
  .action(() => runScript("keys.sh"));

program
  .command("apply")
  .description("Apply .env to config template, copy skills and workspace bootstrap files")
  .action(() => runScript("apply-config.sh"));

program
  .command("gateway")
  .description("Start the gateway")
  .action(() => runScript("gateway.sh"));

program
  .command("start")
  .description("Apply config then start the gateway (apply + gateway)")
  .action(() => {
    runScript("apply-config.sh");
    runScript("gateway.sh");
  });

program
  .command("dev")
  .description("Start gateway (uses ./extensions from repo root)")
  .action(() => runScript("gateway.sh"));

program
  .command("upgrade")
  .description("Clone or pull openclaw repo and build (for local openclaw development)")
  .action(() => runScript("upgrade-openclaw.sh"));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
