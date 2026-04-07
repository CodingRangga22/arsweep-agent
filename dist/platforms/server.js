"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachWebSocket = attachWebSocket;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const router_1 = require("../router");
const dotenv_1 = require("dotenv");
const express_2 = require("@x402/express");
const server_1 = require("@x402/svm/exact/server");
const server_2 = require("@x402/core/server");
const facilitator_1 = require("@payai/facilitator");
const x402Routes_1 = require("./x402Routes");
const apiRoutes_1 = require("./apiRoutes");
(0, dotenv_1.config)();
const app = (0, express_1.default)();
/** x402 v2 client sends PAYMENT-SIGNATURE; v1 used X-PAYMENT — allow both for CORS preflight. */
const corsOptions = {
    origin: true,
    credentials: true,
    allowedHeaders: [
        "Content-Type",
        "Authorization",
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
    ],
    exposedHeaders: [
        "PAYMENT-REQUIRED",
        "payment-required",
        "PAYMENT-RESPONSE",
        "payment-response",
    ],
};
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
const TREASURY_WALLET = "9wVfWxbWLpHwyxVVkBJkzjeabHkdfZG6zyraVoLLB7jv";
// PayAI docs: use @payai/facilitator + x402 middleware (no custom payment logic).
const facilitatorClient = new server_2.HTTPFacilitatorClient(facilitator_1.facilitator);
app.use((0, express_2.paymentMiddleware)({
    "POST /v1/x402/analyze": {
        accepts: [{ scheme: "exact", price: "$0.10", network: "solana", payTo: TREASURY_WALLET }],
        description: "AI Wallet Analysis",
        mimeType: "application/json",
    },
    "POST /v1/x402/report": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Wallet Sweep Report",
        mimeType: "application/json",
    },
    "POST /v1/x402/roast": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Wallet Roast",
        mimeType: "application/json",
    },
    "POST /v1/x402/rugcheck": {
        accepts: [{ scheme: "exact", price: "$0.10", network: "solana", payTo: TREASURY_WALLET }],
        description: "Rug Pull Detector",
        mimeType: "application/json",
    },
    "POST /v1/x402/planner": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Auto-Sweep Planner",
        mimeType: "application/json",
    },
    // GET variants (optional)
    "GET /v1/x402/analyze": {
        accepts: [{ scheme: "exact", price: "$0.10", network: "solana", payTo: TREASURY_WALLET }],
        description: "AI Wallet Analysis",
        mimeType: "application/json",
    },
    "GET /v1/x402/report": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Wallet Sweep Report",
        mimeType: "application/json",
    },
    "GET /v1/x402/roast": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Wallet Roast",
        mimeType: "application/json",
    },
    "GET /v1/x402/rugcheck": {
        accepts: [{ scheme: "exact", price: "$0.10", network: "solana", payTo: TREASURY_WALLET }],
        description: "Rug Pull Detector",
        mimeType: "application/json",
    },
    "GET /v1/x402/planner": {
        accepts: [{ scheme: "exact", price: "$0.05", network: "solana", payTo: TREASURY_WALLET }],
        description: "Auto-Sweep Planner",
        mimeType: "application/json",
    },
}, new express_2.x402ResourceServer(facilitatorClient).register("solana", new server_1.ExactSvmScheme())));
app.post("/v1/agent/chat", async (req, res) => {
    const { userId, message, walletAddress, apiKey } = req.body;
    if (process.env.REQUIRE_API_KEY === "true" && apiKey !== process.env.ARSWEEP_API_KEY) {
        return res.status(401).json({ error: "Invalid API key" });
    }
    if (!userId || !message)
        return res.status(400).json({ error: "userId and message required" });
    try {
        const result = await (0, router_1.handleMessage)({ platform: "api", userId: String(userId), message, walletAddress });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
app.get("/v1/health", (_req, res) => {
    res.json({ status: "ok", service: "arsweep-agent", version: "1.0.0" });
});
app.get("/v1/x402/health", x402Routes_1.x402Health);
app.post("/v1/x402/analyze", x402Routes_1.analyzeWallet);
app.post("/v1/x402/report", x402Routes_1.sweepReport);
app.post("/v1/x402/roast", x402Routes_1.walletRoast);
app.post("/v1/x402/rugcheck", x402Routes_1.rugPullDetector);
app.post("/v1/x402/planner", x402Routes_1.autoSweepPlanner);
function attachWebSocket(server) {
    const wss = new ws_1.WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (ws) => {
        console.log("[WS] New connection");
        ws.on("message", async (raw) => {
            let payload;
            try {
                payload = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (payload.type === "chat") {
                ws.send(JSON.stringify({ type: "typing" }));
                try {
                    const result = await (0, router_1.handleMessage)({
                        platform: "web",
                        userId: payload.userId,
                        message: payload.message,
                        walletAddress: payload.walletAddress,
                    });
                    ws.send(JSON.stringify({ type: "message", text: result.text, toolsUsed: result.toolsUsed }));
                }
                catch {
                    ws.send(JSON.stringify({ type: "error", text: "Agent error. Please try again." }));
                }
            }
        });
    });
    console.log("[WS] WebSocket attached at /ws");
}
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
app.get("/v1/x402/analyze", x402Routes_1.analyzeWalletGet);
app.get("/v1/x402/report", x402Routes_1.sweepReportGet);
app.get("/v1/x402/roast", x402Routes_1.walletRoastGet);
app.get("/v1/x402/rugcheck", x402Routes_1.rugPullDetectorGet);
app.get("/v1/x402/planner", x402Routes_1.autoSweepPlannerGet);
app.post("/v1/api/analyze", apiRoutes_1.analyzeWalletFree);
app.post("/v1/api/report", apiRoutes_1.sweepReportFree);
app.post("/v1/api/roast", apiRoutes_1.walletRoastFree);
app.post("/v1/api/rugcheck", apiRoutes_1.rugPullDetectorFree);
app.post("/v1/api/planner", apiRoutes_1.autoSweepPlannerFree);
app.get("/openapi.json", (_req, res) => {
    res.json({
        openapi: "3.1.0",
        info: {
            title: "Arsweep AI Agent API",
            version: "1.0.0",
            "x-guidance": "Arsweep is a Solana dust sweeper AI agent. Pay per request using USDC on Solana. Send walletAddress in the POST body to analyze, report, roast, rugcheck, or plan sweeps for any Solana wallet.",
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
exports.default = app;
