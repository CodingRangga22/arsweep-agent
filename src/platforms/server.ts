import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { handleMessage } from "../router";
import {
  analyzeWallet,
  sweepReport,
  x402Health,
  walletRoast,
  rugPullDetector,
  autoSweepPlanner,
  analyzeWalletGet,
  sweepReportGet,
  walletRoastGet,
  rugPullDetectorGet,
  autoSweepPlannerGet,
} from "./x402Routes";
import {
  analyzeWalletFree,
  sweepReportFree,
  walletRoastFree,
  rugPullDetectorFree,
  autoSweepPlannerFree,
} from "./apiRoutes";

const app = express();

/** x402 v2 client sends PAYMENT-SIGNATURE; v1 used X-PAYMENT — allow both for CORS preflight. */
const corsOptions: cors.CorsOptions = {
  origin: true,
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "PAYMENT-SIGNATURE",
    "payment-signature",
    "X-PAYMENT",
    "x-payment",
    "X-Payment-Signature",
    "x-payment-signature",
  ],
};

app.use(cors(corsOptions));
app.use(express.json());

app.post("/v1/agent/chat", async (req, res) => {
  const { userId, message, walletAddress, apiKey } = req.body;
  if (process.env.REQUIRE_API_KEY === "true" && apiKey !== process.env.ARSWEEP_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  if (!userId || !message) return res.status(400).json({ error: "userId and message required" });
  try {
    const result = await handleMessage({ platform: "api", userId: String(userId), message, walletAddress });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "arsweep-agent", version: "1.0.0" });
});

app.get("/v1/x402/health", x402Health);
app.post("/v1/x402/analyze", analyzeWallet);
app.post("/v1/x402/report", sweepReport);
app.post("/v1/x402/roast", walletRoast);
app.post("/v1/x402/rugcheck", rugPullDetector);
app.post("/v1/x402/planner", autoSweepPlanner);

export function attachWebSocket(server: any) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    console.log("[WS] New connection");
    ws.on("message", async (raw) => {
      let payload: any;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (payload.type === "chat") {
        ws.send(JSON.stringify({ type: "typing" }));
        try {
          const result = await handleMessage({
            platform: "web",
            userId: payload.userId,
            message: payload.message,
            walletAddress: payload.walletAddress,
          });
          ws.send(JSON.stringify({ type: "message", text: result.text, toolsUsed: result.toolsUsed }));
        } catch {
          ws.send(JSON.stringify({ type: "error", text: "Agent error. Please try again." }));
        }
      }
    });
  });
  console.log("[WS] WebSocket attached at /ws");
}

const SIGNATURE_POLL_INTERVAL_MS = 1500;
const SIGNATURE_POLL_TIMEOUT_MS = 90_000;

async function waitForSignatureConfirmation(
  connection: import("@solana/web3.js").Connection,
  signature: string,
  timeoutMs: number = SIGNATURE_POLL_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return;
    }
    await new Promise((r) => setTimeout(r, SIGNATURE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Transaction was not confirmed in ${timeoutMs / 1000} seconds. Check signature ${signature} on Solana Explorer.`
  );
}

app.post("/v1/payment/usdc", async (req, res) => {
  const { fromWallet, amountUSDC, signedTx, blockhash, lastValidBlockHeight } = req.body;
  if (!fromWallet || !amountUSDC || !signedTx) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const rpc = process.env.HELIUS_RPC_URL;
  if (!rpc) {
    return res.status(500).json({ error: "Server misconfigured: HELIUS_RPC_URL is not set" });
  }
  try {
    const { Connection, VersionedTransaction, Transaction } = await import("@solana/web3.js");
    const connection = new Connection(rpc, "confirmed");

    const txBuffer = Buffer.from(signedTx, "base64");
    const legacySendOpts = { skipPreflight: false, maxRetries: 5, preflightCommitment: "confirmed" as const };
    const versionedSendOpts = { skipPreflight: true, maxRetries: 5 };

    let signature: string;
    try {
      const vtx = VersionedTransaction.deserialize(txBuffer);
      signature = await connection.sendRawTransaction(vtx.serialize(), versionedSendOpts);
    } catch {
      const tx = Transaction.from(txBuffer);
      signature = await connection.sendRawTransaction(tx.serialize(), legacySendOpts);
    }

    const hasLifetime =
      typeof blockhash === "string" &&
      blockhash.length > 0 &&
      typeof lastValidBlockHeight === "number" &&
      Number.isFinite(lastValidBlockHeight);

    if (hasLifetime) {
      try {
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      } catch {
        await waitForSignatureConfirmation(connection, signature);
      }
    } else {
      await waitForSignatureConfirmation(connection, signature);
    }

    return res.json({ success: true, signature });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/v1/payment/info", (_req, res) => {
  res.json({
    treasury: process.env.TREASURY_WALLET,
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    network: "solana",
  });
});

app.get("/.well-known/x402.json", (_req, res) => {
  res.json({
    x402Version: 1,
    name: "Arsweep AI Agent",
    description: "AI-powered Solana wallet analyzer and dust sweeper",
    resources: [
      {
        resource: "https://api.arsweep.fun/v1/x402/analyze",
        type: "http",
        description: "Analyze a Solana wallet for dust tokens and sweep opportunities",
        accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/report",
        type: "http",
        description: "Get a full sweep report for a wallet",
        accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "2000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/roast",
        type: "http",
        description: "Roast a wallet's portfolio with AI humor",
        accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "500000", asset: "SOL", payTo: process.env.TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/rugcheck",
        type: "http",
        description: "Detect potential rug pull tokens in a wallet",
        accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/planner",
        type: "http",
        description: "Auto sweep planner - optimize dust sweep strategy",
        accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1500000", asset: "SOL", payTo: process.env.TREASURY_WALLET }],
      },
    ],
  });
});

app.get("/v1/x402/analyze", analyzeWalletGet);
app.get("/v1/x402/report", sweepReportGet);
app.get("/v1/x402/roast", walletRoastGet);
app.get("/v1/x402/rugcheck", rugPullDetectorGet);
app.get("/v1/x402/planner", autoSweepPlannerGet);

app.post("/v1/api/analyze", analyzeWalletFree);
app.post("/v1/api/report", sweepReportFree);
app.post("/v1/api/roast", walletRoastFree);
app.post("/v1/api/rugcheck", rugPullDetectorFree);
app.post("/v1/api/planner", autoSweepPlannerFree);

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Arsweep AI Agent API",
      version: "1.0.0",
      "x-guidance":
        "Arsweep is a Solana dust sweeper AI agent. Pay per request using USDC on Solana. Send walletAddress in the POST body to analyze, report, roast, rugcheck, or plan sweeps for any Solana wallet.",
    },
    paths: {
      "/v1/x402/analyze": {
        post: {
          summary: "AI Wallet Analysis",
          description: "Analyze a Solana wallet for dust tokens and reclaimable SOL",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletAddress: { type: "string", description: "Solana wallet address" },
                  },
                  required: ["walletAddress"],
                },
              },
            },
          },
          responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.10" },
            protocols: [{ "x402": {} }],
          },
        },
      },
      "/v1/x402/report": {
        post: {
          summary: "Wallet Sweep Report",
          description: "Full sweep report with all empty token accounts",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletAddress: { type: "string", description: "Solana wallet address" },
                  },
                  required: ["walletAddress"],
                },
              },
            },
          },
          responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.05" },
            protocols: [{ "x402": {} }],
          },
        },
      },
      "/v1/x402/roast": {
        post: {
          summary: "Wallet Roast",
          description: "AI roast of your wallet portfolio with score",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletAddress: { type: "string", description: "Solana wallet address" },
                  },
                  required: ["walletAddress"],
                },
              },
            },
          },
          responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.05" },
            protocols: [{ "x402": {} }],
          },
        },
      },
      "/v1/x402/rugcheck": {
        post: {
          summary: "Rug Pull Detector",
          description: "Detect potentially dangerous tokens in a wallet",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletAddress: { type: "string", description: "Solana wallet address" },
                  },
                  required: ["walletAddress"],
                },
              },
            },
          },
          responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.10" },
            protocols: [{ "x402": {} }],
          },
        },
      },
      "/v1/x402/planner": {
        post: {
          summary: "Auto Sweep Planner",
          description: "Optimize dust sweep strategy with batch planning",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    walletAddress: { type: "string", description: "Solana wallet address" },
                  },
                  required: ["walletAddress"],
                },
              },
            },
          },
          responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.05" },
            protocols: [{ "x402": {} }],
          },
        },
      },
    },
  });
});

export default app;
