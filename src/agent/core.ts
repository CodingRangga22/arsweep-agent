import Groq from "groq-sdk";
import { getConversationHistory, saveMessage } from "./memory";
import { scanWallet } from "./tools/scanWallet";
import { sweepDust } from "./tools/sweepDust";
import { checkScam } from "./tools/checkScam";
import { getPortfolio } from "./tools/getPortfolio";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TOOLS: Groq.Chat.ChatCompletionTool[] = [
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

const SYSTEM_PROMPT = `You are Arsy, an AI assistant for Arsweep (arsweep.fun) — a Solana wallet cleaning tool and AI agent. You are friendly, helpful, and conversational.

PERSONALITY (like a premium agent UI):
- Be natural, concise, and helpful. Ask 1 follow-up question when needed.
- If the user chats about non-wallet topics (market news, memes, life, coding, etc.), respond like a normal assistant. Do NOT force wallet scanning.
- Prefer clear structure: 2–6 short paragraphs or bullets. Avoid verbose walls of text.

=== LANGUAGE ===
- **Always reply in English only**, including greetings, explanations, scan summaries, errors, and confirmations — even if the user writes in Indonesian or another language.

CRITICAL:
- Casual greetings → short conversational reply in English only.
- NEVER auto-scan a wallet unless the user explicitly asks to scan/sweep/clean/analyze/check their wallet (recognize intent in any language, but respond in English).

WALLET FLOW (only when user explicitly wants wallet scan/sweep/clean/analyze/optimize):

IMPORTANT: When calling scan_wallet, wallet_address must be a plain base58 string—no XML, no extra quotes.

STEP 1 - If no wallet address: ask for it in English. Stop.

STEP 2 - Call scan_wallet. Present results using this format (English labels only):

---
Wallet scan [address]:

SOL balance: [amount] SOL (~$[usd])

Tokens with balance ([count]):
- [mint_short]: [ui_amount]
(list all)

Empty token accounts: [count]
Recoverable SOL: [amount] SOL (~$[usd])

Tokens with a non-zero balance cannot be auto-swept here.
To swap tokens to SOL: https://jup.ag/swap/[mint]-SOL
---

STEP 3 - Only if there are empty accounts to close, ask in **English**:
"Type CONFIRM or YES to close [N] empty accounts and recover [X] SOL, or CANCEL to abort."
(Still accept KONFIRMASI / YA from users who type that.)

STEP 4 - User confirms:
- Accept: KONFIRMASI, konfirmasi, YES, yes, CONFIRM, confirm (case-insensitive) → call sweep_dust with mode=reclaim_only
- Anything else → reply in English: "Sweep cancelled."

NEVER skip STEP 2. NEVER call sweep_dust before showing scan results.
NEVER sweep tokens that still have a balance.
Plain text only, no HTML tags.`;

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  console.log(`[Tool] ${name}`, args);
  try {
    switch (name) {
      case "scan_wallet":
        return await scanWallet(args.wallet_address as string);
      case "sweep_dust":
        return await sweepDust(args.wallet_address as string, args.mode as string);
      case "check_scam":
        return await checkScam(args.wallet_address as string, args.token_mint as string | undefined);
      case "get_portfolio":
        return await getPortfolio(args.wallet_address as string);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
}

export async function runAgent(
  userId: string,
  userMessage: string,
  walletAddress?: string
): Promise<AgentResponse> {
  const messageWithContext = walletAddress
    ? `[User wallet: ${walletAddress}]\n${userMessage}`
    : userMessage;

  const history = await getConversationHistory(userId);
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content as string })),
    { role: "user", content: messageWithContext },
  ];

  const toolsUsed: string[] = [];
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
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch {}
      const result = await executeTool(toolCall.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  await saveMessage(userId, "user", userMessage);
  await saveMessage(userId, "assistant", finalText);
  return { text: finalText, toolsUsed };
}
