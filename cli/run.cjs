const path = require("path");
const { spawnSync } = require("child_process");
const { getRoot, getEnv } = require("./context.cjs");

function runScript(scriptName, envOverrides = {}) {
  const root = getRoot();
  const scriptPath = path.join(root, "cli", "scripts", scriptName);
  const env = { ...getEnv(), ...envOverrides };
  const cmd = scriptName.endsWith(".mjs") ? "node" : "sh";
  const out = spawnSync(cmd, [scriptPath], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (out.status !== 0) {
    process.exit(out.status ?? 1);
  }
}

module.exports = { runScript };
