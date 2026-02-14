const path = require("path");
const {
  getRoot,
  getStateDir,
  getConfigPath,
  getWorkspaceDir,
} = require("./context.cjs");

const W = 40;

function runCheck() {
  const root = getRoot();
  const stateDir = getStateDir();
  const workspaceDir = getWorkspaceDir();
  const configPath = getConfigPath();
  const skillsDir = path.join(stateDir, "skills");

  const env = {
    OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
    RAILWAY_VOLUME_MOUNT_PATH: process.env.RAILWAY_VOLUME_MOUNT_PATH,
  };

  console.log("\n  convos paths");
  console.log("  " + "═".repeat(W));
  console.log("  ROOT              ", root);
  console.log("  STATE_DIR         ", stateDir);
  console.log("  WORKSPACE_DIR     ", workspaceDir);
  console.log("  CONFIG            ", configPath);
  console.log("  SKILLS_DIR        ", skillsDir);
  console.log("");
  console.log("  env overrides (set values)");
  console.log("  " + "─".repeat(W));
  for (const [k, v] of Object.entries(env)) {
    if (v) console.log("  ", k, "=", v);
  }
  console.log("");
}

module.exports = { runCheck };
