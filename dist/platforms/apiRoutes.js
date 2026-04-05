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
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWalletFree = analyzeWalletFree;
exports.sweepReportFree = sweepReportFree;
exports.walletRoastFree = walletRoastFree;
exports.rugPullDetectorFree = rugPullDetectorFree;
exports.autoSweepPlannerFree = autoSweepPlannerFree;
async function getConnection() {
    const { Connection } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
    return new Connection(process.env.HELIUS_RPC_URL);
}
// ── 1: Analyze Wallet ─────────────────────────────────────────────────────
async function analyzeWalletFree(req, res) {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress)
            return res.status(400).json({ error: "walletAddress required" });
        const { Connection, PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const connection = new Connection(process.env.HELIUS_RPC_URL);
        const pubkey = new PublicKey(walletAddress);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });
        const emptyAccounts = tokenAccounts.value.filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0);
        const totalReclaimable = emptyAccounts.length * 0.00203928;
        return res.json({
            success: true,
            data: {
                walletAddress,
                totalTokenAccounts: tokenAccounts.value.length,
                emptyAccounts: emptyAccounts.length,
                estimatedReclaimableSOL: totalReclaimable.toFixed(5),
                estimatedReclaimableUSD: (totalReclaimable * 130).toFixed(2),
                recommendation: emptyAccounts.length > 5
                    ? "Your wallet has significant locked SOL. Sweep recommended."
                    : emptyAccounts.length > 0
                        ? "A few empty accounts found. Consider sweeping."
                        : "Your wallet is clean!",
                sweepUrl: `https://arsweep.fun/dashboard?wallet=${walletAddress}`,
                analyzedAt: new Date().toISOString(),
            }
        });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
// ── 2: Sweep Report ───────────────────────────────────────────────────────
async function sweepReportFree(req, res) {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress)
            return res.status(400).json({ error: "walletAddress required" });
        const { Connection, PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const connection = new Connection(process.env.HELIUS_RPC_URL);
        const pubkey = new PublicKey(walletAddress);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });
        const accounts = tokenAccounts.value.map(a => ({
            mint: a.account.data.parsed.info.mint,
            balance: a.account.data.parsed.info.tokenAmount.uiAmount,
            isEmpty: Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0,
            rentDeposit: 0.00203928,
        }));
        const emptyAccounts = accounts.filter(a => a.isEmpty);
        return res.json({
            success: true,
            data: {
                walletAddress,
                summary: {
                    totalAccounts: accounts.length,
                    emptyAccounts: emptyAccounts.length,
                    activeAccounts: accounts.length - emptyAccounts.length,
                    totalReclaimableSOL: (emptyAccounts.length * 0.00203928).toFixed(5),
                    totalReclaimableUSD: (emptyAccounts.length * 0.00203928 * 130).toFixed(2),
                },
                emptyAccountsList: emptyAccounts.slice(0, 20),
                generatedAt: new Date().toISOString(),
                sweepUrl: `https://arsweep.fun/dashboard?wallet=${walletAddress}`,
            }
        });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
// ── 3: Wallet Roast ───────────────────────────────────────────────────────
async function walletRoastFree(req, res) {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress)
            return res.status(400).json({ error: "walletAddress required" });
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const connection = new Connection(process.env.HELIUS_RPC_URL);
        const pubkey = new PublicKey(walletAddress);
        const [solBalance, tokenAccounts] = await Promise.all([
            connection.getBalance(pubkey),
            connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
        ]);
        const solSOL = solBalance / LAMPORTS_PER_SOL;
        const total = tokenAccounts.value.length;
        const empty = tokenAccounts.value.filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0).length;
        const emptyRatio = total > 0 ? empty / total : 0;
        let score = 100;
        if (solSOL < 0.01)
            score -= 30;
        else if (solSOL < 0.1)
            score -= 15;
        if (emptyRatio > 0.7)
            score -= 30;
        else if (emptyRatio > 0.4)
            score -= 15;
        if (total > 50)
            score -= 10;
        if (total === 0)
            score -= 20;
        score = Math.max(0, Math.min(100, score));
        const roasts = {
            legendary: ["Bro your wallet is cleaner than your room. Respect.", "This wallet is a masterpiece. Are you even human?"],
            good: ["Not bad. You clearly touched grass at least once.", "Your wallet is decent. Like a 6/10 restaurant."],
            mid: ["Bro you have more ghost accounts than followers.", "Your wallet looks like it went to a memecoin buffet."],
            bad: ["Sir this is a Wendy's. Your wallet is a disaster zone.", "You have more empty accounts than brain cells."],
            rekt: ["NGMI. This wallet is a war crime. HOW?", "Bro you got rugged so hard even your empty accounts are crying."],
        };
        const tier = score >= 85 ? "legendary" : score >= 65 ? "good" : score >= 45 ? "mid" : score >= 25 ? "bad" : "rekt";
        const roastList = roasts[tier];
        const roast = roastList[Math.floor(Math.random() * roastList.length)];
        return res.json({
            success: true,
            data: {
                walletAddress, score, tier: tier.toUpperCase(), roast,
                stats: { solBalance: solSOL.toFixed(4), totalAccounts: total, emptyAccounts: empty, emptyRatio: `${(emptyRatio * 100).toFixed(0)}%`, lockedSOL: (empty * 0.00203928).toFixed(5) },
                advice: score < 50 ? "Sweep your wallet NOW at arsweep.fun" : score < 80 ? "A quick sweep would boost your score!" : "Keep it clean!",
            }
        });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
// ── 4: Rug Pull Detector ──────────────────────────────────────────────────
async function rugPullDetectorFree(req, res) {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress)
            return res.status(400).json({ error: "walletAddress required" });
        const { Connection, PublicKey } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const axiosLib = (await Promise.resolve().then(() => __importStar(require("axios")))).default;
        const connection = new Connection(process.env.HELIUS_RPC_URL);
        const pubkey = new PublicKey(walletAddress);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID });
        const tokens = tokenAccounts.value.filter(a => Number(a.account.data.parsed.info.tokenAmount.uiAmount) > 0).map(a => ({ mint: a.account.data.parsed.info.mint, balance: a.account.data.parsed.info.tokenAmount.uiAmount }));
        const results = await Promise.allSettled(tokens.slice(0, 10).map(async (token) => {
            try {
                const r = await axiosLib.get(`https://api.rugcheck.xyz/v1/tokens/${token.mint}/report/summary`, { timeout: 5000 });
                return { mint: token.mint, balance: token.balance, score: r.data.score ?? 0, risks: r.data.risks ?? [], name: r.data.tokenMeta?.name ?? "Unknown", symbol: r.data.tokenMeta?.symbol ?? "???", verdict: r.data.score > 500 ? "DANGER" : r.data.score > 200 ? "CAUTION" : "SAFE" };
            }
            catch {
                return { mint: token.mint, balance: token.balance, score: 0, risks: [], name: "Unknown", symbol: "???", verdict: "UNVERIFIED" };
            }
        }));
        const analyzed = results.filter(r => r.status === "fulfilled").map(r => r.value);
        const dangerous = analyzed.filter(t => t.verdict === "DANGER");
        const caution = analyzed.filter(t => t.verdict === "CAUTION");
        return res.json({
            success: true,
            data: {
                walletAddress,
                summary: { tokensAnalyzed: analyzed.length, dangerous: dangerous.length, caution: caution.length, safe: analyzed.length - dangerous.length - caution.length },
                tokens: analyzed,
                alert: dangerous.length > 0 ? `ALERT: ${dangerous.length} potentially dangerous token(s) detected!` : caution.length > 0 ? `${caution.length} token(s) need your attention.` : "No obvious rug pull risks detected.",
                analyzedAt: new Date().toISOString(),
            }
        });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
// ── 5: Auto Sweep Planner ─────────────────────────────────────────────────
async function autoSweepPlannerFree(req, res) {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress)
            return res.status(400).json({ error: "walletAddress required" });
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await Promise.resolve().then(() => __importStar(require("@solana/web3.js")));
        const { TOKEN_PROGRAM_ID } = await Promise.resolve().then(() => __importStar(require("@solana/spl-token")));
        const connection = new Connection(process.env.HELIUS_RPC_URL);
        const pubkey = new PublicKey(walletAddress);
        const [solBalance, tokenAccounts] = await Promise.all([connection.getBalance(pubkey), connection.getParsedTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID })]);
        const solSOL = solBalance / LAMPORTS_PER_SOL;
        const RENT = 0.00203928;
        const FEE = 0.015;
        const accounts = tokenAccounts.value.map(a => ({ mint: a.account.data.parsed.info.mint, balance: Number(a.account.data.parsed.info.tokenAmount.uiAmount), isEmpty: Number(a.account.data.parsed.info.tokenAmount.uiAmount) === 0 }));
        const sweepable = accounts.filter(a => a.isEmpty);
        const grossSOL = sweepable.length * RENT;
        const netSOL = grossSOL - (grossSOL * FEE) - (sweepable.length * 0.000005);
        const batches = [];
        for (let i = 0; i < sweepable.length; i += 10) {
            const batch = sweepable.slice(i, i + 10);
            batches.push({ batchNumber: Math.floor(i / 10) + 1, accounts: batch.length, estimatedSOL: (batch.length * RENT * (1 - FEE)).toFixed(5) });
        }
        return res.json({
            success: true,
            data: {
                walletAddress, currentSOLBalance: solSOL.toFixed(4),
                plan: { totalAccounts: accounts.length, sweepableAccounts: sweepable.length, netReclaimableSOL: netSOL.toFixed(5), netReclaimableUSD: (netSOL * 150).toFixed(2), totalBatches: batches.length },
                batches,
                recommendation: sweepable.length === 0 ? "Your wallet is already clean!" : `Sweep ${sweepable.length} accounts to reclaim ${netSOL.toFixed(4)} SOL`,
                sweepNow: "https://arsweep.fun/app",
                generatedAt: new Date().toISOString(),
            }
        });
    }
    catch (err) {
        return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}
