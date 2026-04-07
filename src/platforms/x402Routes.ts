import { Request, Response } from "express";
const { X402PaymentHandler } = require("x402-solana/server");

const TREASURY_ADDRESS = "9wVfWxbWLpHwyxVVkBJkzjeabHkdfZG6zyraVoLLB7jv";
const FACILITATOR_URL = "https://facilitator.payai.network";
const BASE_URL = process.env.BASE_URL ?? "https://arsweep-agent.yourdomain.com";

// USDC mainnet mint
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const x402 = new X402PaymentHandler({
  network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  treasuryAddress: TREASURY_ADDRESS,
  facilitatorUrl: FACILITATOR_URL,
});

// ── Helper ─────────────────────────────────────────────────────────────────
async function handleX402<T>(
  req: Request,
  res: Response,
  endpoint: string,
  amount: string,
  description: string,
  handler: (req: Request) => Promise<T>
) {
  const resourceUrl = `${BASE_URL}${endpoint}`;
  const paymentHeader = x402.extractPayment(req.headers);
  console.log("RAW paymentHeader:", JSON.stringify(paymentHeader?.substring(0, 50)));

  const paymentRequirements = await x402.createPaymentRequirements(
    {
      amount,
      asset: { address: USDC_MINT, decimals: 6 },
      description,
    },
    resourceUrl
  );

  // No payment — return 402 (spec-compliant manual response)
  if (!paymentHeader) {
    res.setHeader("WWW-Authenticate", 'X-402 realm="Arsweep API"');
    return res.status(402).json({
      x402Version: 1,
      accepts: [{
        scheme: "exact",
        network: "solana:mainnet",
        maxAmountRequired: amount,
        resource: resourceUrl,
        description,
        mimeType: "application/json",
        payTo: TREASURY_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: USDC_MINT,
        inputSchema: {
          type: "object",
          properties: {
            walletAddress: {
              type: "string",
              description: "Solana wallet address to analyze",
            },
          },
          required: ["walletAddress"],
        },
        outputSchema: {
          type: "object",
          properties: {
            walletAddress: { type: "string" },
            emptyAccounts: { type: "number" },
            estimatedReclaimableSOL: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      }],
      error: "X-PAYMENT header is required",
    });
  }

  // Verify payment
  const verified = await x402.verifyPayment(paymentHeader, paymentRequirements);
  if (!verified.isValid) {
    console.error("Payment verification failed:", JSON.stringify(verified));
    return res.status(402).json({ error: "Invalid payment", reason: verified.invalidReason });
  }

  // Execute business logic
  try {
    const result = await handler(req);
    await x402.settlePayment(paymentHeader, paymentRequirements);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Endpoint 1: AI Wallet Analysis — $0.10 per scan ───────────────────────
export async function analyzeWallet(req: Request, res: Response) {
  await handleX402(
    req, res,
    "/v1/x402/analyze",
    "100000", // $0.10 USDC (atomic units, 6 decimals)
    "AI Wallet Analysis — Arsweep",
    async (req) => {
      const { walletAddress } = req.body;
      if (!walletAddress) throw new Error("walletAddress required");

      // Import Helius & Groq from existing agent
      const { Connection, PublicKey } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID, getAccount } = await import("@solana/spl-token");

      const connection = new Connection(
        process.env.HELIUS_RPC_URL
      );

      const pubkey = new PublicKey(walletAddress);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const emptyAccounts = tokenAccounts.value.filter(
        (acc) => Number(acc.account.data.parsed.info.tokenAmount.uiAmount) === 0
      );

      const totalReclaimable = emptyAccounts.length * 0.00203928;

      return {
        walletAddress,
        totalTokenAccounts: tokenAccounts.value.length,
        emptyAccounts: emptyAccounts.length,
        estimatedReclaimableSOL: totalReclaimable.toFixed(5),
        estimatedReclaimableUSD: (totalReclaimable * 130).toFixed(2),
        recommendation: emptyAccounts.length > 5
          ? "⚠️ Your wallet has significant locked SOL. Sweep recommended."
          : emptyAccounts.length > 0
          ? "✅ A few empty accounts found. Consider sweeping."
          : "🟢 Your wallet is clean!",
        sweepUrl: `https://arsweep.fun/dashboard?wallet=${walletAddress}`,
        analyzedAt: new Date().toISOString(),
      };
    }
  );
}

// ── Endpoint 2: Bulk Sweep Report — $0.05 per report ──────────────────────
export async function sweepReport(req: Request, res: Response) {
  await handleX402(
    req, res,
    "/v1/x402/report",
    "50000", // $0.05 USDC
    "Wallet Sweep Report — Arsweep",
    async (req) => {
      const { walletAddress } = req.body;
      if (!walletAddress) throw new Error("walletAddress required");

      const { Connection, PublicKey } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

      const connection = new Connection(
        process.env.HELIUS_RPC_URL
      );

      const pubkey = new PublicKey(walletAddress);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const accounts = tokenAccounts.value.map((acc) => ({
        mint: acc.account.data.parsed.info.mint,
        balance: acc.account.data.parsed.info.tokenAmount.uiAmount,
        isEmpty: Number(acc.account.data.parsed.info.tokenAmount.uiAmount) === 0,
        rentDeposit: 0.00203928,
      }));

      const emptyAccounts = accounts.filter((a) => a.isEmpty);

      return {
        walletAddress,
        summary: {
          totalAccounts: accounts.length,
          emptyAccounts: emptyAccounts.length,
          activeAccounts: accounts.length - emptyAccounts.length,
          totalReclaimableSOL: (emptyAccounts.length * 0.00203928).toFixed(5),
          totalReclaimableUSD: (emptyAccounts.length * 0.00203928 * 130).toFixed(2),
        },
        emptyAccountsList: emptyAccounts.slice(0, 20), // max 20
        generatedAt: new Date().toISOString(),
        sweepUrl: `https://arsweep.fun/dashboard?wallet=${walletAddress}`,
      };
    }
  );
}

// ── Endpoint 3: Health check (free) ───────────────────────────────────────
export async function x402Health(_req: Request, res: Response) {
  res.json({
    status: "ok",
    service: "arsweep-x402",
    version: "1.0.0",
    endpoints: [
      { path: "/v1/x402/analyze", price: "$0.10 USDC", description: "AI Wallet Analysis" },
      { path: "/v1/x402/report",  price: "$0.05 USDC", description: "Wallet Sweep Report" },
    ],
    treasury: TREASURY_ADDRESS,
    network: "solana-mainnet",
    paymentProtocol: "x402-v2",
  });
}

// ── Endpoint 4: Wallet Roast — $0.05 ─────────────────────────────────────
export async function walletRoast(req: Request, res: Response) {
  await handleX402(
    req, res,
    "/v1/x402/roast",
    "50000",
    "Wallet Roast — Arsweep",
    async (req) => {
      const { walletAddress } = req.body;
      if (!walletAddress) throw new Error("walletAddress required");

      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

      const connection = new Connection(process.env.HELIUS_RPC_URL!);
      const pubkey = new PublicKey(walletAddress);

      const [solBalance, tokenAccounts] = await Promise.all([
        connection.getBalance(pubkey),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
      ]);

      const solSOL = solBalance / LAMPORTS_PER_SOL;
      const total = tokenAccounts.value.length;
      const empty = tokenAccounts.value.filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0).length;
      const emptyRatio = total > 0 ? empty / total : 0;

      // Score calculation
      let score = 100;
      if (solSOL < 0.01) score -= 30;
      else if (solSOL < 0.1) score -= 15;
      if (emptyRatio > 0.7) score -= 30;
      else if (emptyRatio > 0.4) score -= 15;
      if (total > 50) score -= 10;
      if (total === 0) score -= 20;
      score = Math.max(0, Math.min(100, score));

      // Roast based on score
      const roasts: Record<string, string[]> = {
        legendary: [
          "Bro your wallet is cleaner than your room. Respect. 👑",
          "This wallet is a masterpiece. Are you even human? 🤖",
        ],
        good: [
          "Not bad, not bad. You clearly touched grass at least once. 🌿",
          "Your wallet is decent. Like a 6/10 restaurant — won't kill you. 🍽️",
        ],
        mid: [
          "Bro you have more ghost accounts than followers. 👻",
          "Your wallet looks like it went to a memecoin buffet and didn't leave. 🍔",
        ],
        bad: [
          "Sir this is a Wendy's. Your wallet is a disaster zone. 🚨",
          "You have more empty accounts than brain cells. Clean it up! 🧹",
        ],
        rekt: [
          "NGMI. This wallet is a war crime. HOW? 💀",
          "Bro you got rugged so hard even your empty accounts are crying. 😭",
        ],
      };

      const tier = score >= 85 ? "legendary" : score >= 65 ? "good" : score >= 45 ? "mid" : score >= 25 ? "bad" : "rekt";
      const roastList = roasts[tier];
      const roast = roastList[Math.floor(Math.random() * roastList.length)];

      return {
        walletAddress,
        score,
        tier: tier.toUpperCase(),
        roast,
        stats: {
          solBalance: solSOL.toFixed(4),
          totalAccounts: total,
          emptyAccounts: empty,
          emptyRatio: `${(emptyRatio * 100).toFixed(0)}%`,
          lockedSOL: (empty * 0.00203928).toFixed(5),
        },
        advice: score < 50
          ? "🧹 Seriously, sweep your wallet NOW at arsweep.fun"
          : score < 80
          ? "💡 A quick sweep would boost your score significantly!"
          : "✨ Keep it clean! Share your score on X.",
        shareText: `My Arsweep Wallet Score: ${score}/100 (${tier.toUpperCase()}) 🧹\n\n"${roast}"\n\nCheck yours: arsweep.fun/agent`,
      };
    }
  );
}

// ── Endpoint 5: Rug Pull Detector — $0.10 ────────────────────────────────
export async function rugPullDetector(req: Request, res: Response) {
  await handleX402(
    req, res,
    "/v1/x402/rugcheck",
    "100000",
    "Rug Pull Detector — Arsweep",
    async (req) => {
      const { walletAddress } = req.body;
      if (!walletAddress) throw new Error("walletAddress required");

      const { Connection, PublicKey } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
      const axios = (await import("axios")).default;

      const connection = new Connection(process.env.HELIUS_RPC_URL!);
      const pubkey = new PublicKey(walletAddress);

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const tokens = tokenAccounts.value
        .filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) > 0)
        .map(a => ({
          mint: a.account.data.parsed.info.mint,
          balance: a.account.data.parsed.info.tokenAmount.uiAmount,
        }));

      // Check each token via rugcheck.xyz API
      const results = await Promise.allSettled(
        tokens.slice(0, 10).map(async (token) => {
          try {
            const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${token.mint}/report/summary`, {
              timeout: 5000,
            });
            return {
              mint: token.mint,
              balance: token.balance,
              score: res.data.score ?? 0,
              risks: res.data.risks ?? [],
              name: res.data.tokenMeta?.name ?? "Unknown",
              symbol: res.data.tokenMeta?.symbol ?? "???",
              verdict: res.data.score > 500 ? "🔴 DANGER" : res.data.score > 200 ? "🟡 CAUTION" : "🟢 SAFE",
            };
          } catch {
            return {
              mint: token.mint,
              balance: token.balance,
              score: 0,
              risks: [],
              name: "Unknown",
              symbol: "???",
              verdict: "⚪ UNVERIFIED",
            };
          }
        })
      );

      const analyzed = results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as any).value);

      const dangerous = analyzed.filter(t => t.verdict.includes("DANGER"));
      const caution = analyzed.filter(t => t.verdict.includes("CAUTION"));

      return {
        walletAddress,
        summary: {
          tokensAnalyzed: analyzed.length,
          dangerous: dangerous.length,
          caution: caution.length,
          safe: analyzed.length - dangerous.length - caution.length,
        },
        tokens: analyzed,
        alert: dangerous.length > 0
          ? `🚨 ALERT: ${dangerous.length} potentially dangerous token(s) detected in your wallet!`
          : caution.length > 0
          ? `⚠️ ${caution.length} token(s) need your attention.`
          : "✅ No obvious rug pull risks detected.",
        analyzedAt: new Date().toISOString(),
      };
    }
  );
}

// ── Endpoint 6: Auto-Sweep Planner — $0.05 ───────────────────────────────
export async function autoSweepPlanner(req: Request, res: Response) {
  await handleX402(
    req, res,
    "/v1/x402/planner",
    "50000",
    "Auto-Sweep Planner — Arsweep",
    async (req) => {
      const { walletAddress } = req.body;
      if (!walletAddress) throw new Error("walletAddress required");

      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
      const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

      const connection = new Connection(process.env.HELIUS_RPC_URL!);
      const pubkey = new PublicKey(walletAddress);

      const [solBalance, tokenAccounts] = await Promise.all([
        connection.getBalance(pubkey),
        connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
      ]);

      const solSOL = solBalance / LAMPORTS_PER_SOL;
      const RENT = 0.00203928;
      const FEE = 0.015;

      const accounts = tokenAccounts.value.map(a => ({
        mint: a.account.data.parsed.info.mint,
        balance: Number(a.account.data.parsed.info.tokenAmount.uiAmount),
        isEmpty: Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0,
        rentDeposit: RENT,
      }));

      const sweepable = accounts.filter(a => a.isEmpty);
      const nonEmpty = accounts.filter(a => !a.isEmpty);

      const grossSOL = sweepable.length * RENT;
      const feeSOL = grossSOL * FEE;
      const gasSOL = sweepable.length * 0.000005;
      const netSOL = grossSOL - feeSOL - gasSOL;

      // Batch plan
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < sweepable.length; i += batchSize) {
        const batch = sweepable.slice(i, i + batchSize);
        batches.push({
          batchNumber: Math.floor(i / batchSize) + 1,
          accounts: batch.length,
          estimatedSOL: (batch.length * RENT * (1 - FEE)).toFixed(5),
          estimatedTime: "~5 seconds",
        });
      }

      return {
        walletAddress,
        currentSOLBalance: solSOL.toFixed(4),
        plan: {
          totalAccounts: accounts.length,
          sweepableAccounts: sweepable.length,
          activeAccounts: nonEmpty.length,
          grossReclaimableSOL: grossSOL.toFixed(5),
          platformFee: feeSOL.toFixed(5),
          networkGas: gasSOL.toFixed(6),
          netReclaimableSOL: netSOL.toFixed(5),
          netReclaimableUSD: (netSOL * 150).toFixed(2),
          totalBatches: batches.length,
          estimatedTotalTime: `~${batches.length * 5} seconds`,
        },
        batches,
        recommendation: sweepable.length === 0
          ? "🟢 Your wallet is already clean! Nothing to sweep."
          : sweepable.length < 5
          ? `💡 Sweep all ${sweepable.length} accounts in one click — quick win!`
          : `🚀 Sweep in ${batches.length} batch(es) to reclaim ${netSOL.toFixed(4)} SOL (~$${(netSOL * 150).toFixed(2)})`,
        sweepNow: `https://arsweep.fun/app`,
        generatedAt: new Date().toISOString(),
      };
    }
  );
}

// ── GET handlers for x402scan discovery ──────────────────────────────────
export async function analyzeWalletGet(req: Request, res: Response) {
  return analyzeWallet(req, res);
}
export async function sweepReportGet(req: Request, res: Response) {
  return sweepReport(req, res);
}
export async function walletRoastGet(req: Request, res: Response) {
  return walletRoast(req, res);
}
export async function rugPullDetectorGet(req: Request, res: Response) {
  return rugPullDetector(req, res);
}
export async function autoSweepPlannerGet(req: Request, res: Response) {
  return autoSweepPlanner(req, res);
}
