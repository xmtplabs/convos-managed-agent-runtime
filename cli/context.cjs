const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const root = path.resolve(__dirname, "..");

const VALID_ENVS = ["dev", "staging", "production"];
const PROTECTED_ENVS = ["staging", "production"];

let _envName = "dev";

function loadEnv(envName) {
  envName = envName || "dev";
  if (!VALID_ENVS.includes(envName)) {
    console.error(`Invalid environment "${envName}". Must be one of: ${VALID_ENVS.join(", ")}`);
    process.exit(1);
  }

  const envFile = path.join(root, `.env.${envName}`);
  if (!fs.existsSync(envFile)) {
    console.error(`Environment file not found: .env.${envName}`);
    process.exit(1);
  }

  _envName = envName;
  require("dotenv").config({ path: envFile });
}

function confirmProtectedEnv() {
  if (!PROTECTED_ENVS.includes(_envName)) return Promise.resolve();

  const label = _envName.toUpperCase();
  console.log(`\n  \x1b[1;${_envName === "production" ? "31" : "33"}m⚠  ENVIRONMENT: ${label}\x1b[0m\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  You are targeting ${label}. Continue? (y/N) `, (answer) => {
      rl.close();
      if (!answer.trim().toLowerCase().startsWith("y")) {
        console.log("  Aborted.");
        process.exit(0);
      }
      resolve();
    });
  });
}

function getRoot() {
  return root;
}

function getEnvName() {
  return _envName;
}

function getStateDir() {
  return process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
}

function getConfigPath() {
  return path.join(getStateDir(), "openclaw.json");
}

function getWorkspaceDir() {
  return path.join(getStateDir(), "workspace");
}

function getEnv() {
  return {
    ...process.env,
    ROOT: root,
    OPENCLAW_ENV: _envName,
    OPENCLAW_STATE_DIR: getStateDir(),
  };
}

module.exports = {
  getRoot,
  getEnvName,
  getStateDir,
  getConfigPath,
  getWorkspaceDir,
  getEnv,
  loadEnv,
  confirmProtectedEnv,
};
