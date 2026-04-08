import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { handleMessage } from "../router";
import { getConversationHistory } from "../agent/memory";
import { config } from "dotenv";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@payai/facilitator";
import { callWithX402Payment } from "./paymentAgent";
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

config();

const app = express();

/** x402 v2 client sends PAYMENT-SIGNATURE; v1 used X-PAYMENT — allow both for CORS preflight. */
const corsOptions: cors.CorsOptions = {
  origin: true,
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Accept-Language",
    "PAYMENT-REQUIRED",
    "payment-required",
    "PAYMENT-RESPONSE",
    "payment-response",
    "PAYMENT-SIGNATURE",
    "payment-signature",
    "X-PAYMENT",
    "x-payment",
    "X-Payment-Signature",
    "x-payment-signature",
    "X-PAYMENT-RESPONSE",
    "x-payment-response",
    // @x402/fetch may set this on the request (should be stripped client-side; allow for older builds)
    "Access-Control-Expose-Headers",
    "access-control-expose-headers",
  ],
  exposedHeaders: [
    "PAYMENT-REQUIRED",
    "payment-required",
    "PAYMENT-RESPONSE",
    "payment-response",
    "X-PAYMENT-RESPONSE",
    "x-payment-response",
  ],
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.use(express.json());

const TREASURY_WALLET =
  process.env.TREASURY_WALLET?.trim() || "9wVfWxbWLpHwyxVVkBJkzjeabHkdfZG6zyraVoLLB7jv";
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// PayAI docs: use @payai/facilitator + x402 middleware (no custom payment logic).
const facilitatorClient = new HTTPFacilitatorClient(facilitator);
app.use(
  paymentMiddleware(
    {
      "POST /v1/x402/analyze": {
        accepts: [{ scheme: "exact", price: "$0.10", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "AI Wallet Analysis",
        mimeType: "application/json",
      },
      "POST /v1/x402/report": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Wallet Sweep Report",
        mimeType: "application/json",
      },
      "POST /v1/x402/roast": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Wallet Roast",
        mimeType: "application/json",
      },
      "POST /v1/x402/rugcheck": {
        accepts: [{ scheme: "exact", price: "$0.10", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Rug Pull Detector",
        mimeType: "application/json",
      },
      "POST /v1/x402/planner": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Auto-Sweep Planner",
        mimeType: "application/json",
      },
      // GET variants (optional)
      "GET /v1/x402/analyze": {
        accepts: [{ scheme: "exact", price: "$0.10", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "AI Wallet Analysis",
        mimeType: "application/json",
      },
      "GET /v1/x402/report": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Wallet Sweep Report",
        mimeType: "application/json",
      },
      "GET /v1/x402/roast": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Wallet Roast",
        mimeType: "application/json",
      },
      "GET /v1/x402/rugcheck": {
        accepts: [{ scheme: "exact", price: "$0.10", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Rug Pull Detector",
        mimeType: "application/json",
      },
      "GET /v1/x402/planner": {
        accepts: [{ scheme: "exact", price: "$0.05", network: SOLANA_MAINNET_CAIP2, payTo: TREASURY_WALLET }],
        description: "Auto-Sweep Planner",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient).register(SOLANA_MAINNET_CAIP2 as any, new ExactSvmScheme()),
  ),
);

app.post("/v1/agent/chat", async (req, res) => {
  const { userId, message, walletAddress, apiKey } = req.body;
  if (process.env.REQUIRE_API_KEY === "true" && apiKey !== process.env.ARSWEEP_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  if (!userId || !message) return res.status(400).json({ error: "userId and message required" });
  try {
    const result = await handleMessage({
      platform: "web",
      userId: String(userId),
      message: String(message),
      walletAddress: walletAddress != null ? String(walletAddress) : undefined,
    });
    res.json({ text: result.text, toolsUsed: result.toolsUsed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/** Same user key as handleMessage + runAgent: `web:${userId}` */
app.post("/v1/agent/history/:userId", async (req, res) => {
  const raw = req.params.userId;
  if (!raw) return res.status(400).json({ error: "userId required" });
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* use raw */
  }
  try {
    const messages = await getConversationHistory(`web:${decoded}`);
    res.json({ messages });
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

// Premium proxy endpoints (frontend calls these, no x402 on the frontend)
app.post("/v1/premium/analyze", async (req, res) => {
  try {
    const body = JSON.stringify(req.body ?? {});
    const port = process.env.PORT ?? "3001";
    const url = `http://127.0.0.1:${port}/v1/x402/analyze`;
    const r = await callWithX402Payment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    forwardX402Headers(r, res);
    const text = await r.text().catch(() => "");
    if (!text) return res.sendStatus(r.status);
    // Try JSON first, otherwise send raw text.
    try {
      return res.status(r.status).json(withX402Meta(JSON.parse(text), r));
    } catch {
      return res.status(r.status).type("text/plain").send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/premium/report", async (req, res) => {
  try {
    const body = JSON.stringify(req.body ?? {});
    const port = process.env.PORT ?? "3001";
    const url = `http://127.0.0.1:${port}/v1/x402/report`;
    const r = await callWithX402Payment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    forwardX402Headers(r, res);
    const text = await r.text().catch(() => "");
    if (!text) return res.sendStatus(r.status);
    try {
      return res.status(r.status).json(withX402Meta(JSON.parse(text), r));
    } catch {
      return res.status(r.status).type("text/plain").send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/premium/roast", async (req, res) => {
  try {
    const body = JSON.stringify(req.body ?? {});
    const port = process.env.PORT ?? "3001";
    const url = `http://127.0.0.1:${port}/v1/x402/roast`;
    const r = await callWithX402Payment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    forwardX402Headers(r, res);
    const text = await r.text().catch(() => "");
    if (!text) return res.sendStatus(r.status);
    try {
      return res.status(r.status).json(withX402Meta(JSON.parse(text), r));
    } catch {
      return res.status(r.status).type("text/plain").send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/premium/rugcheck", async (req, res) => {
  try {
    const body = JSON.stringify(req.body ?? {});
    const port = process.env.PORT ?? "3001";
    const url = `http://127.0.0.1:${port}/v1/x402/rugcheck`;
    const r = await callWithX402Payment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    forwardX402Headers(r, res);
    const text = await r.text().catch(() => "");
    if (!text) return res.sendStatus(r.status);
    try {
      return res.status(r.status).json(withX402Meta(JSON.parse(text), r));
    } catch {
      return res.status(r.status).type("text/plain").send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/premium/planner", async (req, res) => {
  try {
    const body = JSON.stringify(req.body ?? {});
    const port = process.env.PORT ?? "3001";
    const url = `http://127.0.0.1:${port}/v1/x402/planner`;
    const r = await callWithX402Payment(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    forwardX402Headers(r, res);
    const text = await r.text().catch(() => "");
    if (!text) return res.sendStatus(r.status);
    try {
      return res.status(r.status).json(withX402Meta(JSON.parse(text), r));
    } catch {
      return res.status(r.status).type("text/plain").send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

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

app.get("/.well-known/x402.json", (_req, res) => {
  res.json({
    // x402 protocol is v2 (CAIP-2 networks) per PayAI reference.
    x402Version: 2,
    name: "Arsweep AI Agent",
    description: "AI-powered Solana wallet analyzer and dust sweeper",
    resources: [
      {
        resource: "https://api.arsweep.fun/v1/x402/analyze",
        type: "http",
        description: "Analyze a Solana wallet for dust tokens and sweep opportunities",
        // The authoritative payment requirements are served via the x402 middleware's 402 response.
        // This discovery doc is kept consistent with the middleware config (CAIP-2 network + payTo).
        accepts: [{ scheme: "exact", network: SOLANA_MAINNET_CAIP2, price: "$0.10", payTo: TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/report",
        type: "http",
        description: "Get a full sweep report for a wallet",
        accepts: [{ scheme: "exact", network: SOLANA_MAINNET_CAIP2, price: "$0.05", payTo: TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/roast",
        type: "http",
        description: "Roast a wallet's portfolio with AI humor",
        accepts: [{ scheme: "exact", network: SOLANA_MAINNET_CAIP2, price: "$0.05", payTo: TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/rugcheck",
        type: "http",
        description: "Detect potential rug pull tokens in a wallet",
        accepts: [{ scheme: "exact", network: SOLANA_MAINNET_CAIP2, price: "$0.10", payTo: TREASURY_WALLET }],
      },
      {
        resource: "https://api.arsweep.fun/v1/x402/planner",
        type: "http",
        description: "Auto sweep planner - optimize dust sweep strategy",
        accepts: [{ scheme: "exact", network: SOLANA_MAINNET_CAIP2, price: "$0.05", payTo: TREASURY_WALLET }],
      },
    ],
  });
});

app.get("/v1/x402/analyze", analyzeWalletGet);
app.get("/v1/x402/report", sweepReportGet);
app.get("/v1/x402/roast", walletRoastGet);
app.get("/v1/x402/rugcheck", rugPullDetectorGet);
app.get("/v1/x402/planner", autoSweepPlannerGet);

function getFirstHeader(r: Response, names: string[]): string | undefined {
  for (const n of names) {
    const v = r.headers.get(n);
    if (v) return v;
  }
  return undefined;
}

function forwardX402Headers(r: Response, res: express.Response) {
  // Preserve x402 headers so clients can debug/handle 402 flows.
  for (const name of ["payment-required", "payment-response", "x-payment-response", "payment-signature", "x-payment"]) {
    const v = r.headers.get(name);
    if (v) res.setHeader(name, v);
    const vUpper = r.headers.get(name.toUpperCase());
    if (vUpper) res.setHeader(name.toUpperCase(), vUpper);
  }
}

function withX402Meta<T extends object>(data: T, r: Response): T & { paymentRequiredB64?: string; paymentResponseB64?: string } {
  const paymentRequiredB64 = getFirstHeader(r, ["payment-required", "PAYMENT-REQUIRED"]);
  const paymentResponseB64 = getFirstHeader(r, ["payment-response", "PAYMENT-RESPONSE", "x-payment-response", "X-PAYMENT-RESPONSE"]);
  return {
    ...data,
    ...(paymentRequiredB64 ? { paymentRequiredB64 } : {}),
    ...(paymentResponseB64 ? { paymentResponseB64 } : {}),
  };
}

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
