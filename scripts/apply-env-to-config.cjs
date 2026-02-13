const fs = require("fs");
const path = require("path");

const templatePath = process.env.TEMPLATE_PATH || process.argv[2];
const envPath = process.env.ENV_FILE || process.argv[3];
const outputPath = process.env.CONFIG_OUTPUT || process.argv[4];

if (!templatePath || !outputPath) {
  console.error("[apply-env-to-config] TEMPLATE_PATH and CONFIG_OUTPUT (or argv[2] and argv[4]) required");
  process.exit(1);
}

let template = fs.readFileSync(templatePath, "utf8");
try {
  JSON.parse(template);
} catch (err) {
  console.error("[apply-env-to-config] Template is invalid JSON:", err.message);
  process.exit(1);
}
const env = {};

if (envPath && fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
      }
      env[m[1]] = val;
    }
  }
}

for (const [key, value] of Object.entries(env)) {
  const escaped = JSON.stringify(value).slice(1, -1);
  const pattern = new RegExp("\\$\\{" + key + "\\}", "g");
  template = template.replace(pattern, escaped);
}

let config;
try {
  config = JSON.parse(template);
} catch (err) {
  console.error("[apply-env-to-config] Invalid JSON after env substitution:", err.message);
  process.exit(1);
}

// Coerce string "true"/"false" to boolean for known boolean keys (env substitution is always string)
const booleanPaths = ["browser.headless"];
for (const dotPath of booleanPaths) {
  const parts = dotPath.split(".");
  let o = config;
  for (let i = 0; i < parts.length - 1 && o != null; i++) o = o[parts[i]];
  const key = parts[parts.length - 1];
  if (o != null && key in o) {
    const raw = o[key];
    if (typeof raw === "string") {
      const v = raw.toLowerCase();
      o[key] = v === "true";
    }
  }
}

fs.writeFileSync(outputPath, JSON.stringify(config, null, 0), "utf8");
console.log("  config written → " + outputPath);
