"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachWebSocket = attachWebSocket;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const router_1 = require("../router");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
// ── x402 Premium Routes ───────────────────────────────────────────────────
const x402Routes_1 = require("./x402Routes");
app.get("/v1/x402/health", x402Routes_1.x402Health);
app.post("/v1/x402/analyze", x402Routes_1.analyzeWallet);
app.post("/v1/x402/report", x402Routes_1.sweepReport);
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
                    const result = await (0, router_1.handleMessage)({ platform: "web", userId: payload.userId, message: payload.message, walletAddress: payload.walletAddress });
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
exports.default = app;
// ── New x402 Premium Routes ───────────────────────────────────────────────
const x402Routes_2 = require("./x402Routes");
app.post("/v1/x402/roast", x402Routes_2.walletRoast);
app.post("/v1/x402/rugcheck", x402Routes_2.rugPullDetector);
app.post("/v1/x402/planner", x402Routes_2.autoSweepPlanner);
// ── Payment Proxy Route ───────────────────────────────────────────────────
const SIGNATURE_POLL_INTERVAL_MS = 1500;
const SIGNATURE_POLL_TIMEOUT_MS = 90_000;
async function waitForSignatureConfirmation(connection, signature, timeoutMs = SIGNATURE_POLL_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const st = value[0];
        if (st) {
            if (st.err)
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
            if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")
                return;
        }
        await new Promise((r) => setTimeout(r, SIGNATURE_POLL_INTERVAL_MS));
    }
    throw new Error(`Transaction was not confirmed in ${timeoutMs / 1000} seconds. Check signature ${signature} on Solana Explorer.`);
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
        const { Connection, VersionedTransaction, Transaction } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const connection = new Connection(rpc, "confirmed");
        const txBuffer = Buffer.from(signedTx, "base64");
        const legacySendOpts = { skipPreflight: false, maxRetries: 5, preflightCommitment: "confirmed" };
        const versionedSendOpts = { skipPreflight: true, maxRetries: 5 };
        let signature;
        try {
            const vtx = VersionedTransaction.deserialize(txBuffer);
            signature = await connection.sendRawTransaction(vtx.serialize(), versionedSendOpts);
        }
        catch {
            const tx = Transaction.from(txBuffer);
            signature = await connection.sendRawTransaction(tx.serialize(), legacySendOpts);
        }
        const hasLifetime = typeof blockhash === "string" &&
            blockhash.length > 0 &&
            typeof lastValidBlockHeight === "number" &&
            Number.isFinite(lastValidBlockHeight);
        if (hasLifetime) {
            try {
                await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
            }
            catch {
                await waitForSignatureConfirmation(connection, signature);
            }
        }
        else {
            await waitForSignatureConfirmation(connection, signature);
        }
        return res.json({ success: true, signature });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
});
// ── Treasury Info (public, no sensitive data) ─────────────────────────────
app.get("/v1/payment/info", (_req, res) => {
    res.json({
        treasury: process.env.TREASURY_WALLET,
        usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        network: "solana-mainnet",
    });
});
// ── x402 Discovery Document ───────────────────────────────────────────────
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
                accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }]
            },
            {
                resource: "https://api.arsweep.fun/v1/x402/report",
                type: "http",
                description: "Get a full sweep report for a wallet",
                accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "2000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }]
            },
            {
                resource: "https://api.arsweep.fun/v1/x402/roast",
                type: "http",
                description: "Roast a wallet's portfolio with AI humor",
                accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "500000", asset: "SOL", payTo: process.env.TREASURY_WALLET }]
            },
            {
                resource: "https://api.arsweep.fun/v1/x402/rugcheck",
                type: "http",
                description: "Detect potential rug pull tokens in a wallet",
                accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1000000", asset: "SOL", payTo: process.env.TREASURY_WALLET }]
            },
            {
                resource: "https://api.arsweep.fun/v1/x402/planner",
                type: "http",
                description: "Auto sweep planner - optimize dust sweep strategy",
                accepts: [{ scheme: "exact", network: "solana:mainnet", amount: "1500000", asset: "SOL", payTo: process.env.TREASURY_WALLET }]
            }
        ]
    });
});
// ── GET routes for x402scan discovery ────────────────────────────────────
const x402Routes_3 = require("./x402Routes");
app.get("/v1/x402/analyze", x402Routes_3.analyzeWalletGet);
app.get("/v1/x402/report", x402Routes_3.sweepReportGet);
app.get("/v1/x402/roast", x402Routes_3.walletRoastGet);
app.get("/v1/x402/rugcheck", x402Routes_3.rugPullDetectorGet);
app.get("/v1/x402/planner", x402Routes_3.autoSweepPlannerGet);
// ── Corbits-compatible routes (no x402 logic) ────────────────────────────
const apiRoutes_1 = require("./apiRoutes");
app.post("/v1/api/analyze", apiRoutes_1.analyzeWalletFree);
app.post("/v1/api/report", apiRoutes_1.sweepReportFree);
app.post("/v1/api/roast", apiRoutes_1.walletRoastFree);
app.post("/v1/api/rugcheck", apiRoutes_1.rugPullDetectorFree);
app.post("/v1/api/planner", apiRoutes_1.autoSweepPlannerFree);
// ── OpenAPI Discovery for x402scan ───────────────────────────────────────
app.get("/openapi.json", (_req, res) => {
    res.json({
        openapi: "3.1.0",
        info: {
            title: "Arsweep AI Agent API",
            version: "1.0.0",
            "x-guidance": "Arsweep is a Solana dust sweeper AI agent. Pay per request using USDC on Solana. Send walletAddress in the POST body to analyze, report, roast, rugcheck, or plan sweeps for any Solana wallet."
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
                                        walletAddress: { type: "string", description: "Solana wallet address" }
                                    },
                                    required: ["walletAddress"]
                                }
                            }
                        }
                    },
                    responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
                    "x-payment-info": {
                        price: { mode: "fixed", currency: "USD", amount: "0.10" },
                        protocols: [{ "x402": {} }]
                    }
                }
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
                                        walletAddress: { type: "string", description: "Solana wallet address" }
                                    },
                                    required: ["walletAddress"]
                                }
                            }
                        }
                    },
                    responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
                    "x-payment-info": {
                        price: { mode: "fixed", currency: "USD", amount: "0.05" },
                        protocols: [{ "x402": {} }]
                    }
                }
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
                                        walletAddress: { type: "string", description: "Solana wallet address" }
                                    },
                                    required: ["walletAddress"]
                                }
                            }
                        }
                    },
                    responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
                    "x-payment-info": {
                        price: { mode: "fixed", currency: "USD", amount: "0.05" },
                        protocols: [{ "x402": {} }]
                    }
                }
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
                                        walletAddress: { type: "string", description: "Solana wallet address" }
                                    },
                                    required: ["walletAddress"]
                                }
                            }
                        }
                    },
                    responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
                    "x-payment-info": {
                        price: { mode: "fixed", currency: "USD", amount: "0.10" },
                        protocols: [{ "x402": {} }]
                    }
                }
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
                                        walletAddress: { type: "string", description: "Solana wallet address" }
                                    },
                                    required: ["walletAddress"]
                                }
                            }
                        }
                    },
                    responses: { "402": { description: "Payment Required" }, "200": { description: "OK" } },
                    "x-payment-info": {
                        price: { mode: "fixed", currency: "USD", amount: "0.05" },
                        protocols: [{ "x402": {} }]
                    }
                }
            }
        }
    });
});
