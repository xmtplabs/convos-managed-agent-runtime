const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });

const stateDir =
  process.env.OPENCLAW_STATE_DIR ||
  path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");
const workspaceDir = path.join(stateDir, "workspace");

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
  };
}

module.exports = {
  getRoot,
  getStateDir,
  getConfigPath,
  getWorkspaceDir,
  getEnv,
};
