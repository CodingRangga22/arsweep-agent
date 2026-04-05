import axios from "axios";

const HELIUS_RPC = process.env.HELIUS_RPC_URL!;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY!;

async function getTokenMetadata(mints: string[]): Promise<Record<string, { symbol: string; name: string }>> {
  if (mints.length === 0) return {};
  try {
    const res = await axios.post(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: "metadata",
        method: "getAssetBatch",
        params: { ids: mints.slice(0, 50) },
      },
      { timeout: 8000 }
    );

    const result: Record<string, { symbol: string; name: string }> = {};
    for (const asset of res.data?.result ?? []) {
      const mint = asset?.id;
      const symbol = asset?.content?.metadata?.symbol ?? "";
      const name   = asset?.content?.metadata?.name ?? "";
      if (mint) result[mint] = { symbol: symbol.trim(), name: name.trim() };
    }
    return result;
  } catch {
    return {};
  }
}

export async function scanWallet(
  walletAddress: string,
  includeZeroBalance = true
): Promise<string> {
  try {
    // 1. SOL balance
    const solRes = await axios.post(HELIUS_RPC, {
      jsonrpc: "2.0", id: "sol",
      method: "getBalance",
      params: [walletAddress],
    });
    const solBalance = (solRes.data?.result?.value ?? 0) / 1e9;

    // 2. All token accounts
    const tokenRes = await axios.post(HELIUS_RPC, {
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
    const allAccounts = rawAccounts.map((acc: any) => {
      const info     = acc.account?.data?.parsed?.info ?? {};
      const amount   = info.tokenAmount ?? {};
      const rawAmt   = Number(amount.amount ?? 0);
      const uiAmt    = Number(amount.uiAmount ?? 0);
      const decimals = Number(amount.decimals ?? 0);
      return {
        pubkey:        acc.pubkey,
        mint:          info.mint ?? "",
        rawAmount:     rawAmt,
        uiAmount:      uiAmt,
        decimals,
        isZeroBalance: rawAmt === 0,
        hasBalance:    rawAmt > 0,
      };
    });

    const zeroAccounts  = allAccounts.filter((a: any) => a.isZeroBalance);
    const tokenAccounts = allAccounts.filter((a: any) => a.hasBalance);

    // 4. Fetch metadata for tokens with balance
    const mints = tokenAccounts.map((a: any) => a.mint);
    const metadata = await getTokenMetadata(mints);

    const rentPerAccount = 0.002039;
    const recoverableSOL = zeroAccounts.length * rentPerAccount;

    // 5. Build enriched token list
    const enrichedTokens = tokenAccounts.map((a: any) => {
      const meta   = (metadata[a.mint] ?? {}) as any;
      const symbol = meta.symbol || "UNKNOWN";
      const name   = meta.name   || a.mint.slice(0, 8) + "...";
      const mintShort = a.mint.slice(0, 6) + "..." + a.mint.slice(-4);

      return {
        mint:       a.mint,
        mint_short: mintShort,
        symbol,
        name,
        ui_amount:  a.uiAmount,
        swap_url:   `https://arsweep.fun?mint=${a.mint}`,
      };
    });

    return JSON.stringify({
      status: "success",
      wallet: walletAddress,
      summary: {
        sol_balance:           solBalance.toFixed(6),
        sol_balance_usd:       (solBalance * 150).toFixed(2),
        total_token_accounts:  allAccounts.length,
        zero_balance_accounts: zeroAccounts.length,
        tokens_with_balance:   tokenAccounts.length,
        recoverable_rent_sol:  recoverableSOL.toFixed(6),
        recoverable_rent_usd:  (recoverableSOL * 150).toFixed(4),
      },
      tokens_with_balance: enrichedTokens,
      zero_balance_accounts: zeroAccounts.map((a: any) => ({
        pubkey:          a.pubkey,
        mint:            a.mint,
        recoverable_sol: rentPerAccount.toFixed(6),
      })),
    });

  } catch (err) {
    return JSON.stringify({
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
