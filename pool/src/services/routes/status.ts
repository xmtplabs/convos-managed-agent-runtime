import { Router } from "express";
import { fetchBatchStatus } from "../status";

export const statusRouter = Router();

/**
 * POST /status/batch
 * Returns deploy status for all (or filtered) agent services.
 */
statusRouter.post("/status/batch", async (req, res) => {
  try {
    const { instanceIds } = req.body as { instanceIds?: string[] };
    const response = await fetchBatchStatus(instanceIds);
    res.json(response);
  } catch (err: any) {
    console.error("[status] batch failed:", err);
    res.status(500).json({ error: err.message });
  }
});
