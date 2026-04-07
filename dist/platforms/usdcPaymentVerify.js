"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_TX_MAX_AGE_SEC = void 0;
exports.verifyUsdcTransferToTreasury = verifyUsdcTransferToTreasury;
/** Max age for a payment tx to count toward premium access (seconds). */
exports.PAYMENT_TX_MAX_AGE_SEC = 300;
/**
 * Confirms a confirmed transaction transferred at least `expectedMinAmountAtomic`
 * USDC (6 decimals) into the treasury wallet's USDC balance (any ATA owned by treasury).
 */
async function verifyUsdcTransferToTreasury(connection, signature, expectedMinAmountAtomic, treasuryPubkey, usdcMintPubkey) {
    const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
    });
    if (!tx)
        return { ok: false, reason: "Transaction not found" };
    if (tx.meta?.err)
        return { ok: false, reason: "Transaction failed on-chain" };
    const blockTime = tx.blockTime;
    if (blockTime == null)
        return { ok: false, reason: "Missing block time" };
    const now = Math.floor(Date.now() / 1000);
    if (now - blockTime > exports.PAYMENT_TX_MAX_AGE_SEC) {
        return { ok: false, reason: "Transaction older than 5 minutes" };
    }
    if (blockTime > now + 120) {
        return { ok: false, reason: "Invalid block time" };
    }
    const mintStr = usdcMintPubkey.toBase58();
    const ownerStr = treasuryPubkey.toBase58();
    const pre = tx.meta?.preTokenBalances ?? [];
    const post = tx.meta?.postTokenBalances ?? [];
    const sumAtomic = (rows) => {
        let s = 0n;
        for (const b of rows) {
            if (b.mint === mintStr && b.owner === ownerStr) {
                s += BigInt(b.uiTokenAmount.amount);
            }
        }
        return s;
    };
    const delta = sumAtomic(post) - sumAtomic(pre);
    if (delta < expectedMinAmountAtomic) {
        return {
            ok: false,
            reason: `Treasury USDC increase ${delta} is less than required ${expectedMinAmountAtomic}`,
        };
    }
    return { ok: true };
}
