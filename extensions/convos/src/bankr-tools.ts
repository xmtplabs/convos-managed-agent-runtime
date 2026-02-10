import { getBankrConfig } from "./bankr-config.js";
import { Wallet } from "ethers";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

export function registerBankrTools(api: { registerTool: (tool: unknown, opts?: { optional?: boolean }) => void }) {
  api.registerTool(
    {
      name: "bankr_deposit_address",
      description:
        "Get the Bankr wallet deposit address (public 0x address) so the user can fund it. The private key is already in config; never ask the user to paste it. Use when the user asks for 'your bankr address', 'check your address', 'my address', deposit address, or where to send funds. Always call this tool for such requests—do not say you have no wallet.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_id: string) {
        const config = getBankrConfig();
        if (!config) {
          return jsonContent({
            error: "Bankr not configured",
            hint: "Set BANKR_API_KEY and run skill-setup, or add BANKR_WALLET_PRIVATE_KEY to env.",
          });
        }
        let address: string;
        if (config.address && ETH_ADDRESS_REGEX.test(config.address)) {
          address = config.address;
        } else {
          try {
            const wallet = new Wallet(config.privateKey);
            address = wallet.address;
          } catch (err) {
            return jsonContent({
              error: "Failed to derive address",
              details: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return jsonContent({ address, message: "Share this address with the user so they can send funds." });
      },
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "bankr_query",
      description:
        "Run a natural-language request against the Bankr agent (balance, trade, portfolio, prices, etc.). Use when the user asks to check balance, buy/sell/swap, show portfolio, get prices, to check if funds arrived or confirm a deposit after sending (e.g. 'I just sent USDC, can you check?'), or any other Bankr capability. Submit the user's request as the prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The user's request in natural language, e.g. 'What is my ETH balance on Base?'" },
        },
        required: ["prompt"],
      },
      async execute(_id: string, params: { prompt?: string }) {
        const config = getBankrConfig();
        if (!config) {
          return jsonContent({
            error: "Bankr not configured",
            hint: "Set BANKR_API_KEY and run skill-setup (or add BANKR_WALLET_PRIVATE_KEY).",
          });
        }
        const prompt = typeof params?.prompt === "string" ? params.prompt.trim() : "";
        if (!prompt) {
          return jsonContent({ error: "prompt is required" });
        }

        const baseUrl = config.apiUrl.replace(/\/$/, "");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-API-Key": config.apiKey,
        };

        let jobId: string;
        try {
          const submitRes = await fetch(`${baseUrl}/agent/prompt`, {
            method: "POST",
            headers,
            body: JSON.stringify({ prompt }),
          });
          if (!submitRes.ok) {
            const text = await submitRes.text();
            return jsonContent({
              error: "Bankr submit failed",
              status: submitRes.status,
              body: text.slice(0, 500),
            });
          }
          const submitJson = (await submitRes.json()) as Record<string, unknown>;
          jobId = typeof submitJson.jobId === "string" ? submitJson.jobId : String(submitJson.jobId ?? submitJson.id ?? "");
          if (!jobId) {
            return jsonContent({ error: "No jobId in Bankr response", response: submitJson });
          }
        } catch (err) {
          return jsonContent({
            error: "Bankr submit request failed",
            details: err instanceof Error ? err.message : String(err),
          });
        }

        const deadline = Date.now() + POLL_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          try {
            const pollRes = await fetch(`${baseUrl}/agent/job/${jobId}`, {
              headers: { "X-API-Key": config.apiKey },
            });
            if (!pollRes.ok) {
              return jsonContent({ error: "Bankr poll failed", status: pollRes.status, jobId });
            }
            const pollJson = (await pollRes.json()) as Record<string, unknown>;
            const status = pollJson.status ?? pollJson.state;
            if (status === "completed" || status === "done" || status === "success") {
              const response = pollJson.response ?? pollJson.result ?? pollJson.output;
              const richData = pollJson.richData;
              return jsonContent({ jobId, status, response, ...(richData != null ? { richData } : {}) });
            }
            if (status === "failed" || status === "error") {
              return jsonContent({
                jobId,
                status,
                error: pollJson.error ?? pollJson.message ?? "Job failed",
              });
            }
          } catch (err) {
            return jsonContent({
              error: "Bankr poll request failed",
              jobId,
              details: err instanceof Error ? err.message : String(err),
            });
          }
        }

        return jsonContent({ error: "Bankr job timed out", jobId });
      },
    },
    { optional: true },
  );
}
