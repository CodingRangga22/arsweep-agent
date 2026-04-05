"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = runAgent;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const memory_1 = require("./memory");
const scanWallet_1 = require("./tools/scanWallet");
const sweepDust_1 = require("./tools/sweepDust");
const checkScam_1 = require("./tools/checkScam");
const getPortfolio_1 = require("./tools/getPortfolio");
const groq = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
const TOOLS = [
    {
        type: "function",
        function: {
            name: "scan_wallet",
            description: "Scan a Solana wallet. Returns SOL balance, all tokens with balance, and empty accounts. ALWAYS call this first before any sweep.",
            parameters: {
                type: "object",
                properties: {
                    wallet_address: { type: "string", description: "Solana wallet public key" },
                },
                required: ["wallet_address"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "sweep_dust",
            description: "Close empty token accounts to reclaim rent SOL. ONLY call after showing scan results AND user explicitly typed KONFIRMASI or YES.",
            parameters: {
                type: "object",
                properties: {
                    wallet_address: { type: "string", description: "Solana wallet public key" },
                    mode: { type: "string", enum: ["simulation", "reclaim_only"], description: "simulation = preview, reclaim_only = execute" },
                },
                required: ["wallet_address", "mode"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "check_scam",
            description: "Check tokens in wallet for scam risk, rug pull, phishing airdrops.",
            parameters: {
                type: "object",
                properties: {
                    wallet_address: { type: "string", description: "Wallet address" },
                    token_mint: { type: "string", description: "Specific token mint (optional)" },
                },
                required: ["wallet_address"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_portfolio",
            description: "Get sweep history, leaderboard rank, referral stats from Arsweep database.",
            parameters: {
                type: "object",
                properties: {
                    wallet_address: { type: "string", description: "Solana wallet public key" },
                },
                required: ["wallet_address"],
            },
        },
    },
];
const SYSTEM_PROMPT = `You are Arsy, an AI assistant for Arsweep (arsweep.fun) - a Solana wallet cleaning tool. You are friendly, helpful, and conversational.

PERSONALITY: Friendly, concise, knowledgeable about Solana and crypto. You can chat naturally about any topic.

LANGUAGE: Always reply in the same language as the user. Indonesian = Indonesian, English = English.

CRITICAL: If user says "halo", "hi", "hello", "siapa namamu", "apa kabar", or any casual greeting - just reply conversationally. NEVER auto-scan wallet unless user EXPLICITLY uses words: scan, sweep, clean, bersihkan, cek wallet.

WALLET FLOW - Only trigger when user explicitly asks to "scan", "sweep", "clean", "optimize", "analyze" wallet:

IMPORTANT: When calling scan_wallet tool, the wallet_address parameter must be a plain string with no XML tags, no quotes inside, just the raw address.

STEP 1 - If no wallet address provided: ask for it. Stop here.

STEP 2 - Call scan_wallet tool. Then show this EXACT format:
---
Hasil scan wallet [address]:

SOL Balance: [amount] SOL (~$[usd])

Token dengan balance ([count] token):
- [mint_short]: [ui_amount] token
(list semua tokens)

Akun kosong: [count] akun
SOL yang bisa direcovery: [amount] SOL (~$[usd])

Token dengan balance TIDAK bisa di-sweep otomatis.
Untuk swap token ke SOL, gunakan: https://jup.ag/swap/[mint]-SOL
---

STEP 3 - Only if there are zero_balance_accounts > 0, ask:
"Ketik KONFIRMASI untuk close [N] akun kosong dan recover [X] SOL, atau BATAL untuk membatalkan."

STEP 4 - Wait for user response:
- If user types exactly "KONFIRMASI" or "konfirmasi" or "YES" or "yes": call sweep_dust with mode=reclaim_only
- ANY other response: say "Sweep dibatalkan." and stop

NEVER skip STEP 2. NEVER call sweep_dust before showing scan results.
NEVER sweep tokens that have balance - those require user to sign in the dApp.
Keep responses plain text, no HTML tags.`;
async function executeTool(name, args) {
    console.log(`[Tool] ${name}`, args);
    try {
        switch (name) {
            case "scan_wallet":
                return await (0, scanWallet_1.scanWallet)(args.wallet_address);
            case "sweep_dust":
                return await (0, sweepDust_1.sweepDust)(args.wallet_address, args.mode);
            case "check_scam":
                return await (0, checkScam_1.checkScam)(args.wallet_address, args.token_mint);
            case "get_portfolio":
                return await (0, getPortfolio_1.getPortfolio)(args.wallet_address);
            default:
                return JSON.stringify({ error: `Unknown tool: ${name}` });
        }
    }
    catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
}
async function runAgent(userId, userMessage, walletAddress) {
    const messageWithContext = walletAddress
        ? `[User wallet: ${walletAddress}]\n${userMessage}`
        : userMessage;
    const history = await (0, memory_1.getConversationHistory)(userId);
    const messages = [
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: messageWithContext },
    ];
    const toolsUsed = [];
    let finalText = "";
    while (true) {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            max_tokens: 1024,
            messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
            tools: TOOLS,
            tool_choice: "auto",
        });
        const choice = response.choices[0];
        const assistantMessage = choice.message;
        messages.push(assistantMessage);
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            finalText = assistantMessage.content ?? "";
            break;
        }
        for (const toolCall of assistantMessage.tool_calls) {
            toolsUsed.push(toolCall.function.name);
            let args = {};
            try {
                args = JSON.parse(toolCall.function.arguments);
            }
            catch { }
            const result = await executeTool(toolCall.function.name, args);
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result,
            });
        }
    }
    await (0, memory_1.saveMessage)(userId, "user", userMessage);
    await (0, memory_1.saveMessage)(userId, "assistant", finalText);
    return { text: finalText, toolsUsed };
}
