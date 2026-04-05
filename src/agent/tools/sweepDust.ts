import axios from "axios";

const HELIUS_RPC = process.env.HELIUS_RPC_URL!;

export async function sweepDust(
  walletAddress: string,
  mode: string,
  maxTokens = 20
): Promise<string> {
  try {
    const response = await axios.post(HELIUS_RPC, {
      jsonrpc: "2.0",
      id: "sweep",
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed" },
      ],
    });

    const allAccounts = response.data?.result?.value ?? [];
    const zeroAccounts = allAccounts
      .filter(
        (acc: any) =>
          (acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 1) === 0
      )
      .slice(0, maxTokens);

    const rentPerAccount = 0.002039;
    const estimatedRecovery = zeroAccounts.length * rentPerAccount;

    if (mode === "simulation") {
      return JSON.stringify({
        status: "simulation",
        message: "Preview only — no transactions executed",
        accounts_to_close: zeroAccounts.length,
        estimated_sol_recovery: estimatedRecovery.toFixed(4),
        estimated_usd_recovery: (estimatedRecovery * 150).toFixed(2),
        next_step: "Confirm to proceed with actual sweep at arsweep.fun",
      });
    }

    if (mode === "reclaim_only" || mode === "full_sweep") {
      if (zeroAccounts.length === 0) {
        return JSON.stringify({
          status: "success",
          message: "No empty token accounts found",
          accounts_closed: 0,
          sol_recovered: "0.0000",
        });
      }
      return JSON.stringify({
        status: "pending_signature",
        message: "Transactions prepared — sign in the dApp to execute",
        accounts_to_close: zeroAccounts.length,
        estimated_sol_recovery: estimatedRecovery.toFixed(4),
        action_url: `https://arsweep.fun?wallet=${walletAddress}`,
      });
    }

    return JSON.stringify({ status: "error", message: `Invalid mode: ${mode}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ status: "error", message });
  }
}
