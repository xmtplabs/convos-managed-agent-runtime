const path = require("path");
const os = require("os");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });

// Align with cli/scripts/lib/paths.sh: prefer repo .openclaw when present
const repoStateDir = path.join(root, ".openclaw");
const stateDir =
  process.env.OPENCLAW_STATE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  (fs.existsSync(repoStateDir) ? repoStateDir : path.join(os.homedir(), ".openclaw"));
const configPath =
  process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
const workspaceDir =
  process.env.OPENCLAW_WORKSPACE_DIR || path.join(stateDir, "workspace");

function getRoot() {
  return root;
}

function getStateDir() {
  return stateDir;
}

function getConfigPath() {
  return configPath;
}

function getWorkspaceDir() {
  return workspaceDir;
}

function getEnv() {
  return {
    ...process.env,
    ROOT: root,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_WORKSPACE_DIR: workspaceDir,
    OPENCLAW_CONFIG_PATH: configPath,
  };
}

module.exports = {
  getRoot,
  getStateDir,
  getConfigPath,
  getWorkspaceDir,
  getEnv,
};
