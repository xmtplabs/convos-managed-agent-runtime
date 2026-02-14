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
  .action(() => runScript("apply-env-to-config.sh"));

program
  .command("start")
  .description("Apply config then start the gateway (apply + entrypoint)")
  .action(() => {
    runScript("apply-env-to-config.sh");
    runScript("entrypoint.sh");
  });

program
  .command("dev")
  .description("Start gateway with local extensions (OPENCLAW_CUSTOM_PLUGINS_DIR=./extensions)")
  .action(() => {
    const path = require("path");
    const { getRoot } = require("./context.cjs");
    runScript("entrypoint.sh", {
      OPENCLAW_CUSTOM_PLUGINS_DIR: path.join(getRoot(), "extensions"),
    });
  });

program
  .command("upgrade")
  .description("Clone or pull openclaw repo and build (for local openclaw development)")
  .action(() => runScript("upgrade-openclaw.sh"));

program
  .command("skill-setup")
  .description("Merge .env keys into skills.entries and related config")
  .action(() => runScript("skill-setup.sh"));

if (process.argv.length <= 2) {
  program.outputHelp();
  process.exit(0);
}

program.parse();
