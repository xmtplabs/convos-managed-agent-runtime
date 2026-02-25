import express from "express";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { requireAuth } from "./middleware/auth.js";
import { infraRouter } from "./routes/infra.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { configureRouter } from "./routes/configure.js";
import { registryRouter } from "./routes/registry.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Public
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// All service routes require auth
app.use(requireAuth);
app.use(infraRouter);
app.use(statusRouter);
app.use(toolsRouter);
app.use(configureRouter);
app.use(registryRouter);

async function start() {
  console.log("[services] Running migrations...");
  await migrate();

  app.listen(config.port, () => {
    console.log(`[services] Listening on :${config.port}`);
  });
}

start().catch((err) => {
  console.error("[services] Failed to start:", err);
  process.exit(1);
});
