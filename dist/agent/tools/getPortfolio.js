"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortfolio = getPortfolio;
const supabase_js_1 = require("@supabase/supabase-js");
const axios_1 = __importDefault(require("axios"));
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const HELIUS_RPC = process.env.HELIUS_RPC_URL;
async function getPortfolio(walletAddress) {
    try {
        const solRes = await axios_1.default.post(HELIUS_RPC, {
            jsonrpc: "2.0", id: "sol",
            method: "getBalance",
            params: [walletAddress],
        });
        const solBalance = (solRes.data?.result?.value ?? 0) / 1e9;
        const { data: stats } = await supabase
            .from("sweep_stats").select("*").eq("wallet_address", walletAddress).single();
        const { data: leaderboard } = await supabase
            .from("leaderboard").select("rank, total_swept_sol").eq("wallet_address", walletAddress).single();
        const { data: referral } = await supabase
            .from("referrals").select("referral_code, total_referrals, referral_earnings_sol").eq("wallet_address", walletAddress).single();
        return JSON.stringify({
            status: "success",
            wallet: walletAddress,
            sol_balance: solBalance.toFixed(4),
            arsweep_stats: stats ?? { message: "No sweep history yet" },
            leaderboard: leaderboard ?? null,
            referral: referral ?? null,
        });
    }
    catch (err) {
        return JSON.stringify({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
}
