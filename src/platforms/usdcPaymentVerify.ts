import { Connection, PublicKey } from "@solana/web3.js";

/** Max age for a payment tx to count toward premium access (seconds). */
export const PAYMENT_TX_MAX_AGE_SEC = 300;

export type VerifyUsdcResult = { ok: true } | { ok: false; reason: string };

/**
 * Confirms a confirmed transaction transferred at least `expectedMinAmountAtomic`
 * USDC (6 decimals) into the treasury wallet's USDC balance (any ATA owned by treasury).
 */
export async function verifyUsdcTransferToTreasury(
  connection: Connection,
  signature: string,
  expectedMinAmountAtomic: bigint,
  treasuryPubkey: PublicKey,
  usdcMintPubkey: PublicKey
): Promise<VerifyUsdcResult> {
  console.log("[usdcPaymentVerify] verifying signature", signature);

  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) return { ok: false, reason: "Transaction not found" };
  if (tx.meta?.err) return { ok: false, reason: "Transaction failed on-chain" };

  const blockTime = tx.blockTime;
  if (blockTime == null) return { ok: false, reason: "Missing block time" };

  const now = Math.floor(Date.now() / 1000);
  if (now - blockTime > PAYMENT_TX_MAX_AGE_SEC) {
    return { ok: false, reason: "Transaction older than 5 minutes" };
  }
  if (blockTime > now + 120) {
    return { ok: false, reason: "Invalid block time" };
  }

  const mintStr = usdcMintPubkey.toBase58();
  const ownerStr = treasuryPubkey.toBase58();

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  console.log("[usdcPaymentVerify] filter mint", mintStr, "treasury owner", ownerStr);
  console.log("[usdcPaymentVerify] preTokenBalances raw", JSON.stringify(pre, null, 2));
  console.log("[usdcPaymentVerify] postTokenBalances raw", JSON.stringify(post, null, 2));

  const sumAtomic = (rows: typeof pre) => {
    let s = 0n;
    for (const b of rows) {
      if (b.mint === mintStr && b.owner === ownerStr) {
        s += BigInt(b.uiTokenAmount.amount);
      }
    }
    return s;
  };

  const preSum = sumAtomic(pre);
  const postSum = sumAtomic(post);
  const delta = postSum - preSum;

  console.log("[usdcPaymentVerify] preSum (treasury USDC atomic)", preSum.toString());
  console.log("[usdcPaymentVerify] postSum (treasury USDC atomic)", postSum.toString());
  console.log("[usdcPaymentVerify] delta (postSum - preSum)", delta.toString());
  console.log("[usdcPaymentVerify] expectedMinAmountAtomic", expectedMinAmountAtomic.toString());

  if (delta < expectedMinAmountAtomic) {
    return {
      ok: false,
      reason: `Treasury USDC increase ${delta} is less than required ${expectedMinAmountAtomic}`,
    };
  }

  return { ok: true };
}
