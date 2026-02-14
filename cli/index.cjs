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
  .description("Generate OPENCLAW_GATEWAY_TOKEN, SETUP_PASSWORD; create or reuse OpenRouter key and write .env")
  .action(() => runScript("keys.sh"));

program
  .command("apply-config")
  .description("Apply .env to config template, copy skills and workspace bootstrap files")
  .action(() => runScript("apply-config.sh"));

program
  .command("gateway run")
  .description("Start the gateway")
  .action(() => runScript("gateway.sh"));

program
  .command("start")
  .description("Apply config then start the gateway (apply-config + gateway run)")
  .action(() => {
    runScript("apply-config.sh");
    runScript("gateway.sh");
  });

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
