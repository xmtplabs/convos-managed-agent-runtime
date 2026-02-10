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

fs.writeFileSync(outputPath, template, "utf8");
console.log("[concierge] Applied env to config → " + outputPath);
