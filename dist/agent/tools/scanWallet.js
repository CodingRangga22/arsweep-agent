"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanWallet = scanWallet;
const axios_1 = __importDefault(require("axios"));
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
async function getTokenMetadata(mints) {
    if (mints.length === 0)
        return {};
    try {
        const res = await axios_1.default.post(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`, {
            jsonrpc: "2.0",
            id: "metadata",
            method: "getAssetBatch",
            params: { ids: mints.slice(0, 50) },
        }, { timeout: 8000 });
        const result = {};
        for (const asset of res.data?.result ?? []) {
            const mint = asset?.id;
            const symbol = asset?.content?.metadata?.symbol ?? "";
            const name = asset?.content?.metadata?.name ?? "";
            if (mint)
                result[mint] = { symbol: symbol.trim(), name: name.trim() };
        }
        return result;
    }
    catch {
        return {};
    }
}
async function scanWallet(walletAddress, includeZeroBalance = true) {
    try {
        // 1. SOL balance
        const solRes = await axios_1.default.post(HELIUS_RPC, {
            jsonrpc: "2.0", id: "sol",
            method: "getBalance",
            params: [walletAddress],
        });
        const solBalance = (solRes.data?.result?.value ?? 0) / 1e9;
        // 2. All token accounts
        const tokenRes = await axios_1.default.post(HELIUS_RPC, {
            jsonrpc: "2.0", id: "tokens",
            method: "getTokenAccountsByOwner",
            params: [
                walletAddress,
                { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
                { encoding: "jsonParsed" },
            ],
        });
        const rawAccounts = tokenRes.data?.result?.value ?? [];
        // 3. Classify accounts
        const allAccounts = rawAccounts.map((acc) => {
            const info = acc.account?.data?.parsed?.info ?? {};
            const amount = info.tokenAmount ?? {};
            const rawAmt = Number(amount.amount ?? 0);
            const uiAmt = Number(amount.uiAmount ?? 0);
            const decimals = Number(amount.decimals ?? 0);
            return {
                pubkey: acc.pubkey,
                mint: info.mint ?? "",
                rawAmount: rawAmt,
                uiAmount: uiAmt,
                decimals,
                isZeroBalance: rawAmt === 0,
                hasBalance: rawAmt > 0,
            };
        });
        const zeroAccounts = allAccounts.filter((a) => a.isZeroBalance);
        const tokenAccounts = allAccounts.filter((a) => a.hasBalance);
        // 4. Fetch metadata for tokens with balance
        const mints = tokenAccounts.map((a) => a.mint);
        const metadata = await getTokenMetadata(mints);
        const rentPerAccount = 0.002039;
        const recoverableSOL = zeroAccounts.length * rentPerAccount;
        // 5. Build enriched token list
        const enrichedTokens = tokenAccounts.map((a) => {
            const meta = (metadata[a.mint] ?? {});
            const symbol = meta.symbol || "UNKNOWN";
            const name = meta.name || a.mint.slice(0, 8) + "...";
            const mintShort = a.mint.slice(0, 6) + "..." + a.mint.slice(-4);
            return {
                mint: a.mint,
                mint_short: mintShort,
                symbol,
                name,
                ui_amount: a.uiAmount,
                swap_url: `https://arsweep.fun?mint=${a.mint}`,
            };
        });
        return JSON.stringify({
            status: "success",
            wallet: walletAddress,
            summary: {
                sol_balance: solBalance.toFixed(6),
                sol_balance_usd: (solBalance * 150).toFixed(2),
                total_token_accounts: allAccounts.length,
                zero_balance_accounts: zeroAccounts.length,
                tokens_with_balance: tokenAccounts.length,
                recoverable_rent_sol: recoverableSOL.toFixed(6),
                recoverable_rent_usd: (recoverableSOL * 150).toFixed(4),
            },
            tokens_with_balance: enrichedTokens,
            zero_balance_accounts: zeroAccounts.map((a) => ({
                pubkey: a.pubkey,
                mint: a.mint,
                recoverable_sol: rentPerAccount.toFixed(6),
            })),
        });
    }
    catch (err) {
        return JSON.stringify({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
        });
    }
}
