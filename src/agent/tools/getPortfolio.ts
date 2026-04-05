import { createClient } from "@supabase/supabase-js";
import axios from "axios";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const HELIUS_RPC = process.env.HELIUS_RPC_URL!;

export async function getPortfolio(walletAddress: string): Promise<string> {
  try {
    const solRes = await axios.post(HELIUS_RPC, {
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
  } catch (err) {
    return JSON.stringify({ status: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
