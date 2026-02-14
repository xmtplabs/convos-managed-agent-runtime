const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });

function getRoot() {
  return root;
}

function getStateDir() {
  return (
    process.env.OPENCLAW_STATE_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    path.join(os.homedir(), ".openclaw")
  );
}

function getConfigPath() {
  return path.join(getStateDir(), "openclaw.json");
}

function getWorkspaceDir() {
  return (
    process.env.OPENCLAW_WORKSPACE_DIR ||
    path.join(getStateDir(), "workspace")
  );
}

function getEnv() {
  const stateDir = getStateDir();
  const workspaceDir = getWorkspaceDir();
  const configPath = getConfigPath();
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
