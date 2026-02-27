/**
 * Quick test: send a test metric to Datadog and flush.
 * Usage: pnpm datadog:test
 */
import metrics from "datadog-metrics";

const apiKey = process.env.DATADOG_API_KEY;
if (!apiKey) {
  console.error("Set DATADOG_API_KEY");
  process.exit(1);
}

async function main() {
  console.log("Initializing datadog-metrics...");
  metrics.init({
    apiKey,
    prefix: "convos.pool.",
    defaultTags: [`env:test`],
  });

  console.log("Sending test gauge: convos.pool.test.ping = 1");
  metrics.gauge("test.ping", 1, ["source:test_script"]);

  console.log("Flushing...");
  await new Promise<void>((resolve, reject) => {
    metrics.flush(resolve, reject);
  });

  console.log("Done — check Datadog metric explorer for convos.pool.test.ping");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
