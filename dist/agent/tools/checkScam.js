"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkScam = checkScam;
const axios_1 = __importDefault(require("axios"));
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
// Whitelist token terpercaya — tidak perlu dicek
const TRUSTED_TOKENS = new Set([
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
    "So11111111111111111111111111111111111111112", // SOL (wrapped)
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", // mSOL
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj", // stSOL
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // JUP
    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", // RAY
    "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", // ORCA
    "MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey", // MNDE
    "7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx", // GMT
    "AFbX8oGjGpmVFywabs9DVznLDa6Z4xHSCjEoFCxHt5kG", // GST
    "HZ1JovNiVvGrGs7yy8bFgXKYzNVh9hkzLr8jSPBjSLT", // RNDR (SOL)
    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", // bSOL
]);
// Token yang diketahui berbahaya
const KNOWN_SCAM_TOKENS = new Set([
// tambah mint address scam yang diketahui
]);
async function getTokenName(mint) {
    try {
        const res = await axios_1.default.post(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, { jsonrpc: "2.0", id: "meta", method: "getAsset", params: { id: mint } }, { timeout: 5000 });
        const meta = res.data?.result?.content?.metadata ?? {};
        return {
            symbol: meta.symbol?.trim() || "",
            name: meta.name?.trim() || "",
        };
    }
    catch {
        return { symbol: "", name: "" };
    }
}
async function analyzeToken(mint) {
    const signals = [];
    // Skip whitelist
    if (TRUSTED_TOKENS.has(mint)) {
        return {
            mint,
            symbol: "",
            name: "",
            displayName: "",
            risk_score: 0,
            risk_level: "safe",
            trusted: true,
            signals: [],
        };
    }
    // Known scam
    if (KNOWN_SCAM_TOKENS.has(mint)) {
        return {
            mint,
            symbol: "",
            name: "Known Scam",
            displayName: "Known Scam",
            risk_score: 100,
            risk_level: "dangerous",
            trusted: false,
            signals: [{
                    signal: "Token scam teridentifikasi",
                    severity: "critical",
                    reason: "Token ini sudah dikonfirmasi sebagai scam oleh komunitas.",
                }],
        };
    }
    try {
        const { symbol, name } = await getTokenName(mint);
        const displayName = symbol || name || mint.slice(0, 8) + "...";
        // Check mint & freeze authority
        const mintInfoRes = await axios_1.default.post(HELIUS_RPC, {
            jsonrpc: "2.0", id: "mintinfo",
            method: "getAccountInfo",
            params: [mint, { encoding: "jsonParsed" }],
        });
        const mintInfo = mintInfoRes.data?.result?.value?.data?.parsed?.info ?? {};
        // Only flag if NOT a known stablecoin/protocol
        if (mintInfo.mintAuthority) {
            signals.push({
                signal: "Mint authority aktif",
                severity: "high",
                reason: "Pemilik token bisa mencetak supply baru kapan saja — risiko inflasi mendadak dan harga crash.",
            });
        }
        if (mintInfo.freezeAuthority) {
            signals.push({
                signal: "Freeze authority aktif",
                severity: "high",
                reason: "Pembuat token bisa membekukan akun kamu sehingga token tidak bisa dipindah atau dijual.",
            });
        }
        // No metadata = suspicious
        if (!symbol && !name) {
            signals.push({
                signal: "Tidak ada metadata",
                severity: "medium",
                reason: "Token tidak memiliki nama atau simbol resmi. Umumnya ditemukan pada token airdrop scam.",
            });
        }
        // No recent transactions = abandoned/fake
        try {
            const sigRes = await axios_1.default.post(HELIUS_RPC, {
                jsonrpc: "2.0", id: "sigs",
                method: "getSignaturesForAddress",
                params: [mint, { limit: 5 }],
            });
            if ((sigRes.data?.result ?? []).length === 0) {
                signals.push({
                    signal: "Tidak ada aktivitas on-chain",
                    severity: "medium",
                    reason: "Token tidak memiliki riwayat transaksi — kemungkinan token palsu atau sudah ditinggalkan.",
                });
            }
        }
        catch { }
        // RugCheck
        try {
            const rugRes = await axios_1.default.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { timeout: 6000 });
            const score = rugRes.data?.score ?? 0;
            const risks = rugRes.data?.risks ?? [];
            if (score > 800) {
                signals.push({
                    signal: "RugCheck: Sangat Berbahaya",
                    severity: "critical",
                    reason: `Skor risiko: ${score}/1000. ${risks[0]?.description ?? "Token sangat berisiko."}`,
                });
            }
            else if (score > 500) {
                signals.push({
                    signal: "RugCheck: Berisiko",
                    severity: "high",
                    reason: `Skor risiko: ${score}/1000. ${risks[0]?.description ?? "Ada indikasi aktivitas mencurigakan."}`,
                });
            }
            else if (score > 200) {
                signals.push({
                    signal: "RugCheck: Perlu Perhatian",
                    severity: "medium",
                    reason: `Skor risiko: ${score}/1000. Pantau dengan hati-hati.`,
                });
            }
        }
        catch { }
        const scoreMap = { low: 10, medium: 25, high: 40, critical: 60 };
        const risk_score = Math.min(100, signals.reduce((s, r) => s + (scoreMap[r.severity] ?? 0), 0));
        const risk_level = risk_score >= 70 ? "dangerous" :
            risk_score >= 40 ? "suspicious" :
                risk_score >= 15 ? "caution" : "safe";
        return { mint, symbol, name, displayName, risk_score, risk_level, trusted: false, signals };
    }
    catch {
        return {
            mint,
            symbol: "", name: "",
            displayName: mint.slice(0, 8) + "...",
            risk_score: 30,
            risk_level: "caution",
            trusted: false,
            signals: [{ signal: "Gagal dianalisa", severity: "medium", reason: "Tidak dapat mengambil data token." }],
        };
    }
}
async function checkScam(walletAddress, specificMint) {
    try {
        let mints = [];
        if (specificMint) {
            mints = [specificMint];
        }
        else {
            const res = await axios_1.default.post(HELIUS_RPC, {
                jsonrpc: "2.0", id: "tokens",
                method: "getTokenAccountsByOwner",
                params: [
                    walletAddress,
                    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
                    { encoding: "jsonParsed" },
                ],
            });
            mints = (res.data?.result?.value ?? [])
                .map((acc) => acc.account?.data?.parsed?.info?.mint)
                .filter(Boolean)
                .slice(0, 15);
        }
        if (mints.length === 0) {
            return JSON.stringify({ status: "success", message: "Tidak ada token untuk dianalisa.", risks: [] });
        }
        const results = [];
        for (const mint of mints) {
            results.push(await analyzeToken(mint));
            await new Promise((r) => setTimeout(r, 200));
        }
        // Filter out trusted tokens from risk categories
        const nonTrusted = results.filter((r) => !r.trusted);
        const trusted = results.filter((r) => r.trusted);
        const dangerous = nonTrusted.filter((r) => r.risk_level === "dangerous");
        const suspicious = nonTrusted.filter((r) => r.risk_level === "suspicious");
        const caution = nonTrusted.filter((r) => r.risk_level === "caution");
        const safe = [...trusted, ...nonTrusted.filter((r) => r.risk_level === "safe")];
        return JSON.stringify({
            status: "success",
            summary: {
                total_analyzed: results.length,
                trusted: trusted.length,
                dangerous: dangerous.length,
                suspicious: suspicious.length,
                caution: caution.length,
                safe: safe.length,
            },
            dangerous_tokens: dangerous,
            suspicious_tokens: suspicious,
            caution_tokens: caution,
            safe_tokens: safe,
            trusted_tokens: trusted,
        });
    }
    catch (err) {
        return JSON.stringify({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
}
